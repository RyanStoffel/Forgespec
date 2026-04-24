const express = require("express");
const { Firestore } = require("@google-cloud/firestore");
const { Storage } = require("@google-cloud/storage");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

const PROJECT_ID = "csc323-final";
const BUCKET_NAME = "forgespec-benchmarks";

const firestore = new Firestore({ projectId: PROJECT_ID });
const storage = new Storage({ projectId: PROJECT_ID });
const secretClient = new SecretManagerServiceClient();

let geminiClient = null;

// Initialize Gemini on first use
async function initializeGemini() {
  if (geminiClient) return geminiClient;
  try {
    const apiKey = await getSecret("google-ai-api-key");
    geminiClient = new GoogleGenerativeAI(apiKey);
    return geminiClient;
  } catch (err) {
    console.error("Failed to initialize Gemini:", err);
    throw err;
  }
}

// Helper function to fetch secret from Secret Manager
async function getSecret(secretName) {
  const name = `projects/${PROJECT_ID}/secrets/${secretName}/versions/latest`;
  const [version] = await secretClient.accessSecretVersion({ name });
  return version.payload.data.toString("utf8").trim();
}

// POST / - Receive Eventarc Cloud Storage event
app.post("/", async (req, res) => {
  try {
    // Parse CloudEvents format from Eventarc
    const ceSubject = req.get("ce-subject");
    const cePath = req.get("ce-path");

    if (!cePath) {
      console.log("Ack: received event without path");
      return res.status(200).json({ ack: true });
    }

    // Extract bucket and object name from path: buckets/{bucket}/objects/{object}
    const pathMatch = cePath.match(/buckets\/([^/]+)\/objects\/(.+)/);
    if (!pathMatch) {
      console.error("Invalid path format:", cePath);
      return res.status(200).json({ ack: true });
    }

    const bucket = pathMatch[1];
    const objectName = pathMatch[2];

    console.log(`Processing benchmark image: ${bucket}/${objectName}`);

    // Parse userId and benchmarkId from object path: {userId}/{benchmarkId}.jpg
    const [userId, benchmarkFileName] = objectName.split("/");
    const benchmarkId = benchmarkFileName.replace(".jpg", "");

    // Fetch benchmark document from Firestore
    const benchmarkDoc = await firestore
      .collection("users")
      .doc(userId)
      .collection("benchmarks")
      .doc(benchmarkId)
      .get();

    if (!benchmarkDoc.exists) {
      console.error(`Benchmark ${benchmarkId} not found`);
      return res.status(200).json({ ack: true });
    }

    const benchmarkData = benchmarkDoc.data();

    // Check if assessment already exists (to avoid duplicate Gemini API calls on retries)
    const benchmarkAssessmentDoc = await firestore
      .collection("users")
      .doc(userId)
      .collection("benchmarks")
      .doc(benchmarkId)
      .collection("assessments")
      .doc("benchmark")
      .get();

    if (benchmarkAssessmentDoc.exists) {
      console.log(`Benchmark analysis already exists for ${benchmarkId}, skipping Gemini call`);
      return res.status(200).json({ ack: true });
    }

    // Download file from Cloud Storage
    const file = storage.bucket(bucket).file(objectName);
    const [fileBuffer] = await file.download();

    // Encode image to base64 for Gemini
    const imageBase64 = fileBuffer.toString("base64");

    // Fetch Gemini AI client
    const gemini = await initializeGemini();
    const model = gemini.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Prepare vision analysis prompt
    const prompt = `Analyze this benchmark screenshot and extract performance metrics. Identify:
1. Frame rates (FPS) if visible
2. GPU/CPU temperatures
3. Clock speeds
4. Memory usage
5. Any other visible performance numbers

Return a JSON object with these metrics and their values.`;

    // Call Gemini vision API
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: imageBase64,
        },
      },
      prompt,
    ]);

    const analysisText =
      result.response.candidates[0].content.parts[0].text;

    // Parse response (try JSON first, fallback to text)
    let benchmarkResult;
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        benchmarkResult = JSON.parse(jsonMatch[0]);
      } else {
        benchmarkResult = { analysis: analysisText };
      }
    } catch {
      benchmarkResult = { analysis: analysisText };
    }

    // Fetch related build if available
    let buildComparison = null;
    if (benchmarkData.buildId) {
      const buildDoc = await firestore
        .collection("users")
        .doc(userId)
        .collection("builds")
        .doc(benchmarkData.buildId)
        .get();

      if (buildDoc.exists) {
        buildComparison = {
          buildId: benchmarkData.buildId,
          expectedSpecs: buildDoc.data().parts,
        };
      }
    }

    // Write results back to Firestore (add benchmark metrics in build's assessments subcollection if buildId exists)
    console.log(`Writing benchmark analysis to Firestore for ${benchmarkId}...`);
    console.log(`Benchmark result:`, JSON.stringify(benchmarkResult, null, 2));

    const writePromises = [
      // Always update the benchmark document
      firestore
        .collection("users")
        .doc(userId)
        .collection("benchmarks")
        .doc(benchmarkId)
        .update({
          benchmarkMetrics: benchmarkResult,
          buildComparison,
        }),
    ];

    // If benchmark is associated with a build, also write to build's assessments
    if (benchmarkData.buildId) {
      writePromises.push(
        firestore
          .collection("users")
          .doc(userId)
          .collection("builds")
          .doc(benchmarkData.buildId)
          .collection("assessments")
          .doc("benchmark")
          .set({
            metrics: benchmarkResult,
            benchmarkId,
            createdAt: new Date(),
          })
      );
    }

    await Promise.all(writePromises);

    console.log(`Benchmark analysis completed for ${benchmarkId}`);
    res.status(200).json({ ack: true });
  } catch (err) {
    console.error("Error in benchmark-analyzer:", err);
    res.status(200).json({ ack: true });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`benchmark-analyzer listening on ${PORT}`)
);