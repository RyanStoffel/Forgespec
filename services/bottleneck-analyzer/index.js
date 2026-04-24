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

    console.log(`Processing build ${buildId} for user ${userId}`);

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

    // Fetch Gemini AI client
    const gemini = await initializeGemini();
    const model = gemini.getGenerativeModel({ model: "gemini-2.5-flash" });

    // Prepare analysis prompt
    const prompt = `Analyze this PC build for performance bottlenecks. Build details:
${JSON.stringify(buildData.parts, null, 2)}

Identify:
1. CPU-GPU bottleneck potential
2. RAM bandwidth concerns
3. Storage performance issues
4. Power supply adequacy
5. Thermal management concerns

Provide a structured JSON analysis with severity levels (LOW, MEDIUM, HIGH) for each concern.`;

    // Call Gemini API
    const result = await model.generateContent(prompt);
    const analysisText =
      result.response.candidates[0].content.parts[0].text;

    // Parse response (try JSON first, fallback to text)
    let analysisResult;
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        analysisResult = { analysis: analysisText };
      }
    } catch {
      analysisResult = { analysis: analysisText };
    }

    // Write results back to Firestore
    await firestore
      .collection("users")
      .doc(userId)
      .collection("builds")
      .doc(buildId)
      .update({
        analysisResult,
        status: "completed",
        completedAt: new Date(),
      });

    console.log(`Bottleneck analysis completed for build ${buildId}`);
    res.status(200).json({ ack: true });
  } catch (err) {
    console.error("Error in bottleneck-analyzer:", err);
    res.status(200).json({ ack: true });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`bottleneck-analyzer listening on ${PORT}`)
);