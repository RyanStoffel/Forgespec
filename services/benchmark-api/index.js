const express = require("express");
const { randomUUID } = require("crypto");
const { Firestore } = require("@google-cloud/firestore");
const { Storage } = require("@google-cloud/storage");
const busboy = require("busboy");
const jwt = require("jsonwebtoken");

const app = express();

// CORS middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

const PROJECT_ID = "csc323-final";
const BUCKET_NAME = "forgespec-benchmarks";

const firestore = new Firestore({ projectId: PROJECT_ID });
const storage = new Storage({ projectId: PROJECT_ID });

// Helper: Extract userId from Firebase JWT token
// API Gateway swaps Authorization with its own SA token; the original user
// claims come back via X-Apigateway-Api-Userinfo (base64 JSON) or
// X-Forwarded-Authorization (raw JWT). See build-api for the full rationale.
function extractUserIdFromRequest(req) {
  const userInfoHeader = req.get("X-Apigateway-Api-Userinfo") || req.get("x-apigateway-api-userinfo");
  if (userInfoHeader) {
    try {
      const padded = userInfoHeader + "===".slice((userInfoHeader.length + 3) % 4);
      const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
      const userId = decoded.user_id || decoded.sub || decoded.uid;
      if (userId) return userId;
    } catch (err) {
      console.warn("Failed to parse X-Apigateway-Api-Userinfo:", err.message);
    }
  }
  const fwd = req.get("X-Forwarded-Authorization") || req.get("x-forwarded-authorization");
  if (fwd && fwd.startsWith("Bearer ")) {
    try {
      const decoded = jwt.decode(fwd.substring(7));
      const userId = decoded?.user_id || decoded?.sub || decoded?.uid;
      if (userId) return userId;
    } catch {}
  }
  const authHeader = req.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const decoded = jwt.decode(authHeader.substring(7));
      if (decoded?.email && decoded.email.endsWith(".iam.gserviceaccount.com")) return null;
      return decoded?.user_id || decoded?.sub || decoded?.uid || null;
    } catch {}
  }
  return null;
}

// POST /benchmarks - Upload benchmark screenshot and write to Firestore
app.post("/benchmarks", async (req, res) => {
  try {
    const { buildId } = req.query;
    const userId = extractUserIdFromRequest(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized: Invalid or missing token" });
    }

    if (!buildId) {
      return res.status(400).json({ error: "Missing query parameter: buildId" });
    }

    const bb = busboy({ headers: req.headers });
    let fileBuffer = null;
    let uploadedFileName = null;

    bb.on("file", async (field, file, info) => {
      const chunks = [];
      file.on("data", (data) => chunks.push(data));
      file.on("end", async () => {
        fileBuffer = Buffer.concat(chunks);
        uploadedFileName = info.filename;
      });
    });

    bb.on("close", async () => {
      if (!fileBuffer) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      try {
        const benchmarkId = randomUUID();
        const timestamp = new Date();
        const filePath = `${userId}/${benchmarkId}.jpg`;

        // Upload file to Cloud Storage
        const bucket = storage.bucket(BUCKET_NAME);
        const file = bucket.file(filePath);
        await file.save(fileBuffer, {
          metadata: {
            contentType: "image/jpeg",
          },
        });

        // Write benchmark document to Firestore
        const benchmarkData = {
          benchmarkId,
          userId,
          buildId,
          fileName: uploadedFileName,
          storagePath: filePath,
          createdAt: timestamp,
          status: "pending",
          result: null,
        };

        await firestore
          .collection("users")
          .doc(userId)
          .collection("benchmarks")
          .doc(benchmarkId)
          .set(benchmarkData);

        console.log(`Benchmark ${benchmarkId} uploaded and stored in Firestore`);

        res.status(202).json({
          benchmarkId,
          status: "Processing",
          message: "Benchmark accepted for analysis",
        });
      } catch (err) {
        console.error("Error processing upload:", err);
        res.status(500).json({ error: err.message });
      }
    });

    req.pipe(bb);
  } catch (err) {
    console.error("Error in POST /benchmarks:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /benchmarks/:benchmarkId - Fetch benchmark by ID
app.get("/benchmarks/:benchmarkId", async (req, res) => {
  try {
    const { benchmarkId } = req.params;
    const userId = extractUserIdFromRequest(req);

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized: Invalid or missing token" });
    }

    const doc = await firestore
      .collection("users")
      .doc(userId)
      .collection("benchmarks")
      .doc(benchmarkId)
      .get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Benchmark not found" });
    }

    res.json(doc.data());
  } catch (err) {
    console.error("Error in GET /benchmarks/:benchmarkId:", err);
    res.status(500).json({ error: err.message });
  }
});

// Delete handler — used by DELETE /benchmarks/:id and POST /benchmarks/:id/delete (gateway tunnel)
async function deleteBenchmarkHandler(req, res) {
  try {
    const { benchmarkId } = req.params;
    const userId = extractUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const ref = firestore.collection("users").doc(userId).collection("benchmarks").doc(benchmarkId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Benchmark not found" });

    const data = snap.data();

    // Delete the storage object (best-effort).
    try {
      if (data.storagePath) {
        await storage.bucket(BUCKET_NAME).file(data.storagePath).delete();
      }
    } catch (storageErr) {
      console.warn(`Could not delete storage object ${data.storagePath}:`, storageErr.message);
    }

    // Delete any assessment subcollection docs (best-effort).
    try {
      const assessSnap = await ref.collection("assessments").get();
      const batch = firestore.batch();
      assessSnap.docs.forEach((d) => batch.delete(d.ref));
      if (!assessSnap.empty) await batch.commit();
    } catch (subErr) {
      console.warn("Could not delete benchmark assessments:", subErr.message);
    }

    await ref.delete();
    console.log(`Deleted benchmark ${benchmarkId}`);
    res.json({ benchmarkId, deleted: true });
  } catch (err) {
    console.error("Error in deleteBenchmarkHandler:", err);
    res.status(500).json({ error: err.message });
  }
}
app.delete("/benchmarks/:benchmarkId", deleteBenchmarkHandler);
app.post("/benchmarks/:benchmarkId/delete", deleteBenchmarkHandler);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`benchmark-api listening on ${PORT}`));
