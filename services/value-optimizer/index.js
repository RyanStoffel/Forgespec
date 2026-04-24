const express = require("express");
const { Firestore } = require("@google-cloud/firestore");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

const PROJECT_ID = "csc323-final";
const firestore = new Firestore({ projectId: PROJECT_ID });
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

// POST / - Receive Pub/Sub push message
app.post("/", async (req, res) => {
  try {
    // Decode Pub/Sub message
    const pubsubMessage = req.body.message;
    if (!pubsubMessage || !pubsubMessage.data) {
      console.log("Ack: received message without data");
      return res.status(200).json({ ack: true });
    }

    const messageData = Buffer.from(pubsubMessage.data, "base64").toString(
      "utf8"
    );
    const { buildId, userId } = JSON.parse(messageData);

    console.log(`Processing value optimization for build ${buildId}`);

    // Fetch build from Firestore
    const buildDoc = await firestore
      .collection("users")
      .doc(userId)
      .collection("builds")
      .doc(buildId)
      .get();

    if (!buildDoc.exists) {
      console.error(`Build ${buildId} not found`);
      return res.status(200).json({ ack: true });
    }

    const buildData = buildDoc.data();

    // Check if assessment already exists (to avoid duplicate Gemini API calls on retries)
    const assessmentDoc = await firestore
      .collection("users")
      .doc(userId)
      .collection("builds")
      .doc(buildId)
      .collection("assessments")
      .doc("optimization")
      .get();

    if (assessmentDoc.exists) {
      console.log(`Value optimization already exists for build ${buildId}, skipping Gemini call`);
      return res.status(200).json({ ack: true });
    }

    // Fetch parts catalog
    const partsSnapshot = await firestore
      .collection("parts")
      .limit(500)
      .get();
    const partsCatalog = partsSnapshot.docs.map((doc) => doc.data());

    // Fetch Gemini AI client
    const gemini = await initializeGemini();
    const model = gemini.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Prepare optimization prompt
    const prompt = `You are a PC build value optimizer. Analyze this build and suggest better-value alternatives.

Current Build:
${JSON.stringify(buildData.parts, null, 2)}

Available Parts Catalog (sample):
${JSON.stringify(partsCatalog.slice(0, 50), null, 2)}

For each part, suggest alternatives that:
1. Provide similar or better performance
2. Are at the same or lower price point
3. Improve overall value score

Respond with a JSON object where keys are part categories and values contain suggestions with new part specs, price savings, and performance improvement percentage.`;

    // Call Gemini API
    const result = await model.generateContent(prompt);
    const optimizationText =
      result.response.candidates[0].content.parts[0].text;

    // Parse response (try JSON first, fallback to text)
    let valueOptimization;
    try {
      const jsonMatch = optimizationText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        valueOptimization = JSON.parse(jsonMatch[0]);
      } else {
        valueOptimization = { suggestions: optimizationText };
      }
    } catch {
      valueOptimization = { suggestions: optimizationText };
    }

    // Write results back to Firestore (add optimization in subcollection)
    await firestore
      .collection("users")
      .doc(userId)
      .collection("builds")
      .doc(buildId)
      .collection("assessments")
      .doc("optimization")
      .set({
        suggestions: valueOptimization,
        createdAt: new Date(),
      });

    console.log(`Value optimization completed for build ${buildId}`);
    res.status(200).json({ ack: true });
  } catch (err) {
    console.error("Error in value-optimizer:", err);
    res.status(200).json({ ack: true });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`value-optimizer listening on ${PORT}`)
);