const express = require("express");
const { randomUUID } = require("crypto");
const { Firestore } = require("@google-cloud/firestore");
const { PubSub } = require("@google-cloud/pubsub");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const PROJECT_ID = "csc323-final";
const TOPIC_NAME = "builds-finalized";

const firestore = new Firestore({ projectId: PROJECT_ID });
const pubsub = new PubSub({ projectId: PROJECT_ID });

// Helper: Extract userId from Firebase JWT token
function extractUserIdFromToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log("No Authorization header or invalid format");
    return null;
  }
  try {
    const token = authHeader.substring(7);
    const decoded = jwt.decode(token);
    console.log("Decoded token:", JSON.stringify(decoded, null, 2));
    const userId = decoded?.sub || decoded?.uid || decoded?.user_id;
    if (!userId) {
      console.error("Token decoded but no userId found. Token keys:", Object.keys(decoded || {}));
    }
    return userId;
  } catch (err) {
    console.error("Failed to decode token:", err.message);
    return null;
  }
}

// POST /builds - Create a new build and publish to Pub/Sub
app.post("/builds", async (req, res) => {
  try {
    const { parts, totalPrice } = req.body;

    if (!parts || typeof parts !== "object") {
      return res.status(400).json({
        error: "Missing required field: parts object",
      });
    }

    const userId = extractUserIdFromToken(req.get("Authorization"));
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized: Invalid or missing token" });
    }

    const buildId = randomUUID();
    const timestamp = new Date();
    const buildName = `Build_${new Date().toLocaleDateString().replace(/\//g, "-")}`;

    // Write build document to Firestore
    const buildData = {
      buildId,
      buildName,
      userId,
      parts,
      totalPrice: totalPrice || 0,
      createdAt: timestamp,
      status: "finalized",
      analysisResult: null,
      valueOptimization: null,
    };

    await firestore.collection("users").doc(userId).collection("builds").doc(buildId).set(buildData);

    // Publish message to Pub/Sub topic
    const topic = pubsub.topic(TOPIC_NAME);
    const messageData = JSON.stringify({ buildId, userId });
    await topic.publish(Buffer.from(messageData));

    console.log(`Build ${buildId} created and published to Pub/Sub`);

    res.status(202).json({
      buildId,
      status: "Processing",
      message: "Build accepted for analysis",
    });
  } catch (err) {
    console.error("Error in POST /builds:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /builds/:buildId - Fetch build by ID
app.get("/builds/:buildId", async (req, res) => {
  try {
    const { buildId } = req.params;
    const userId = extractUserIdFromToken(req.get("Authorization"));

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
