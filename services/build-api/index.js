const express = require("express");
const { randomUUID } = require("crypto");
const { Firestore, FieldValue } = require("@google-cloud/firestore");
const { PubSub } = require("@google-cloud/pubsub");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

// CORS middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

const PROJECT_ID = "csc323-final";
const TOPIC_NAME = "builds-finalized";

const firestore = new Firestore({ projectId: PROJECT_ID });
const pubsub = new PubSub({ projectId: PROJECT_ID });

// Helper: Extract Firebase UID from the request.
//
// Behind Google API Gateway, the Authorization header is REPLACED with the
// gateway's own service-account JWT before forwarding to Cloud Run. The
// gateway puts the original validated user claims in the
// `X-Apigateway-Api-Userinfo` header (base64-encoded JSON), and the original
// raw Authorization header in `X-Forwarded-Authorization`.
//
// This function checks all three sources, in priority order:
//   1. X-Apigateway-Api-Userinfo (set by gateway when JWT validation succeeds)
//   2. X-Forwarded-Authorization (original user JWT preserved by gateway)
//   3. Authorization (direct call, no gateway in between)
//
// Service-account tokens (issued to the gateway itself) are rejected so we
// don't accidentally save user data under the gateway's SA identity.
function extractUserIdFromRequest(req) {
  // 1) Validated user claims from API Gateway
  const userInfoHeader = req.get("X-Apigateway-Api-Userinfo") || req.get("x-apigateway-api-userinfo");
  if (userInfoHeader) {
    try {
      // base64url with possibly-missing padding
      const padded = userInfoHeader + "===".slice((userInfoHeader.length + 3) % 4);
      const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
      const userId = decoded.user_id || decoded.sub || decoded.uid;
      if (userId) {
        console.log(`AUTH userInfo header: user_id=${userId} email=${decoded.email}`);
        return userId;
      }
    } catch (err) {
      console.warn("Failed to parse X-Apigateway-Api-Userinfo:", err.message);
    }
  }

  // 2) Original user JWT preserved by gateway
  const fwd = req.get("X-Forwarded-Authorization") || req.get("x-forwarded-authorization");
  if (fwd && fwd.startsWith("Bearer ")) {
    try {
      const decoded = jwt.decode(fwd.substring(7));
      const userId = decoded?.user_id || decoded?.sub || decoded?.uid;
      if (userId) {
        console.log(`AUTH x-forwarded-authorization: user_id=${userId}`);
        return userId;
      }
    } catch (err) {
      console.warn("Failed to decode X-Forwarded-Authorization:", err.message);
    }
  }

  // 3) Direct call — only trust if it's NOT a service-account token
  const authHeader = req.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const decoded = jwt.decode(authHeader.substring(7));
      // Reject service-account tokens (their email ends in iam.gserviceaccount.com).
      if (decoded?.email && decoded.email.endsWith(".iam.gserviceaccount.com")) {
        console.warn("Authorization header is a service-account token — rejecting (need user JWT or gateway-forwarded headers)");
        return null;
      }
      const userId = decoded?.user_id || decoded?.sub || decoded?.uid;
      if (userId) {
        console.log(`AUTH direct authorization: user_id=${userId}`);
        return userId;
      }
    } catch (err) {
      console.warn("Failed to decode Authorization:", err.message);
    }
  }

  console.error("No valid auth source found. Headers present:", Object.keys(req.headers).filter((h) => h.includes("auth") || h.includes("user")));
  return null;
}

// Backwards-compat shim — keep the old name working in case anywhere else uses it.
function extractUserIdFromToken(authHeader) {
  // This signature only had a header string, so it can't access the gateway
  // userinfo header. Callers must migrate to extractUserIdFromRequest(req).
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  try {
    const decoded = jwt.decode(authHeader.substring(7));
    if (decoded?.email && decoded.email.endsWith(".iam.gserviceaccount.com")) return null;
    return decoded?.user_id || decoded?.sub || decoded?.uid || null;
  } catch {
    return null;
  }
}

// POST /builds - Create a new build and publish to Pub/Sub
app.post("/builds", async (req, res) => {
  try {
    const { parts, totalPrice, buildName, analyses } = req.body;

    if (!parts || typeof parts !== "object") {
      return res.status(400).json({ error: "Missing required field: parts object" });
    }
    if (!buildName || typeof buildName !== "string" || buildName.trim().length === 0) {
      return res.status(400).json({ error: "Missing required field: buildName" });
    }
    if (buildName.length > 80) {
      return res.status(400).json({ error: "buildName must be 80 characters or fewer" });
    }
    const requestedAnalyses = Array.isArray(analyses)
      ? analyses.filter((a) => a === "bottleneck" || a === "optimization")
      : [];

    const userId = extractUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized: Invalid or missing token" });
    }

    const trimmed = buildName.trim();
    const buildId = randomUUID();
    const timestamp = new Date();

    // Initial pipeline state — analyzers update this as they progress.
    const pipeline = {};
    for (const t of requestedAnalyses) {
      pipeline[t] = { status: "queued", queuedAt: timestamp };
    }

    const buildData = {
      buildId,
      buildName: trimmed,
      userId,
      parts,
      totalPrice: totalPrice || 0,
      createdAt: timestamp,
      status: requestedAnalyses.length > 0 ? "finalized" : "saved",
      requestedAnalyses,
      pipeline,
      analysisResult: null,
      valueOptimization: null,
    };

    await firestore.collection("users").doc(userId).collection("builds").doc(buildId).set(buildData);

    // Atomic increment of platform-wide counter (safe under concurrent load)
    await firestore.collection("metrics").doc("global").set(
      { totalBuildsFinalized: FieldValue.increment(1) },
      { merge: true }
    );

    // Always publish to Pub/Sub — analyzers gate on requestedAnalyses (empty array => both skip).
    const topic = pubsub.topic(TOPIC_NAME);
    await topic.publish(Buffer.from(JSON.stringify({ buildId, userId, requestedAnalyses })));

    console.log(`Build ${buildId} (${trimmed}) created with analyses: [${requestedAnalyses.join(",")}]`);

    res.status(202).json({
      buildId,
      buildName: trimmed,
      status: requestedAnalyses.length > 0 ? "Processing" : "Saved",
      requestedAnalyses,
    });
  } catch (err) {
    console.error("Error in POST /builds:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /builds/:buildId/analyze - re-trigger analyses on existing build
app.post("/builds/:buildId/analyze", async (req, res) => {
  try {
    const { buildId } = req.params;
    const userId = extractUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const types = Array.isArray(req.body?.types)
      ? req.body.types.filter((t) => t === "bottleneck" || t === "optimization")
      : [];
    if (types.length === 0) {
      return res.status(400).json({ error: "types must be a non-empty array of bottleneck|optimization" });
    }

    const ref = firestore.collection("users").doc(userId).collection("builds").doc(buildId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Build not found" });

    const existing = snap.data().requestedAnalyses ?? [];
    const merged = Array.from(new Set([...existing, ...types]));

    // Mark every newly-requested type as queued (preserve existing pipeline state for already-complete ones).
    const pipelineUpdates = { requestedAnalyses: merged, status: "finalized" };
    const now = new Date();
    for (const t of types) {
      // Reset only if not already complete — re-trigger of a complete one is a no-op (analyzer skips on idempotency).
      const cur = snap.data().pipeline?.[t]?.status;
      if (cur !== "complete") {
        pipelineUpdates[`pipeline.${t}`] = { status: "queued", queuedAt: now };
      }
    }
    await ref.update(pipelineUpdates);

    await pubsub.topic(TOPIC_NAME).publish(
      Buffer.from(JSON.stringify({ buildId, userId, requestedAnalyses: merged }))
    );

    console.log(`Re-trigger build ${buildId} with analyses: [${merged.join(",")}]`);
    res.status(202).json({ buildId, requestedAnalyses: merged });
  } catch (err) {
    console.error("Error in POST /builds/:buildId/analyze:", err);
    res.status(500).json({ error: err.message });
  }
});

// Rename handler — used by both PATCH /builds/:id and POST /builds/:id/rename (gateway tunnel)
async function renameBuildHandler(req, res) {
  try {
    const { buildId } = req.params;
    const { buildName } = req.body || {};
    const userId = extractUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!buildName || typeof buildName !== "string" || buildName.trim().length === 0 || buildName.length > 80) {
      return res.status(400).json({ error: "buildName required, 1-80 chars" });
    }

    const ref = firestore.collection("users").doc(userId).collection("builds").doc(buildId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Build not found" });

    const trimmed = buildName.trim();

    await ref.update({ buildName: trimmed });
    res.json({ buildId, buildName: trimmed });
  } catch (err) {
    console.error("Error in renameBuildHandler:", err);
    res.status(500).json({ error: err.message });
  }
}
app.patch("/builds/:buildId", renameBuildHandler);
app.post("/builds/:buildId/rename", renameBuildHandler);

// Delete handler — used by both DELETE /builds/:id and POST /builds/:id/delete (gateway tunnel)
async function deleteBuildHandler(req, res) {
  try {
    const { buildId } = req.params;
    const userId = extractUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const ref = firestore.collection("users").doc(userId).collection("builds").doc(buildId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Build not found" });

    // Delete all assessment subcollection docs.
    const assessmentsSnap = await ref.collection("assessments").get();
    const batch = firestore.batch();
    assessmentsSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(ref);
    await batch.commit();

    console.log(`Deleted build ${buildId} (and ${assessmentsSnap.size} assessments)`);
    res.json({ buildId, deleted: true, assessmentsDeleted: assessmentsSnap.size });
  } catch (err) {
    console.error("Error in deleteBuildHandler:", err);
    res.status(500).json({ error: err.message });
  }
}
app.delete("/builds/:buildId", deleteBuildHandler);
app.post("/builds/:buildId/delete", deleteBuildHandler);

// GET /builds/:buildId - Fetch build by ID
app.get("/builds/:buildId", async (req, res) => {
  try {
    const { buildId } = req.params;
    const userId = extractUserIdFromRequest(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized: Invalid or missing token" });
    }

    const doc = await firestore
      .collection("users")
      .doc(userId)
      .collection("builds")
      .doc(buildId)
      .get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Build not found" });
    }

    res.json(doc.data());
  } catch (err) {
    console.error("Error in GET /builds/:buildId:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`build-api listening on ${PORT}`));
