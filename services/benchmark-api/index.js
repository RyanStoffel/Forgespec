const express = require("express");
const { randomUUID } = require("crypto");
const { Firestore } = require("@google-cloud/firestore");
const { Storage } = require("@google-cloud/storage");
const busboy = require("busboy");
const jwt = require("jsonwebtoken");

const app = express();

const PROJECT_ID = "csc323-final";
const BUCKET_NAME = "forgespec-benchmarks";

const firestore = new Firestore({ projectId: PROJECT_ID });
const storage = new Storage({ projectId: PROJECT_ID });

// Helper: Extract userId from Firebase JWT token
function extractUserIdFromToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  try {
    const token = authHeader.substring(7);
    const decoded = jwt.decode(token);
    return decoded?.sub || decoded?.uid;
  } catch (err) {
    return null;
  }
}

// POST /benchmarks - Upload benchmark screenshot and write to Firestore
app.post("/benchmarks", async (req, res) => {
  try {
    const { buildId } = req.query;
    const userId = extractUserIdFromToken(req.get("Authorization"));

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
    const userId = extractUserIdFromToken(req.get("Authorization"));

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

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`benchmark-api listening on ${PORT}`));
