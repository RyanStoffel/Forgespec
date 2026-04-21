const functions = require("@google-cloud/functions-framework");
const { Firestore } = require("@google-cloud/firestore");
const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
const axios = require("axios");

const db = new Firestore({ projectId: "csc323-final" });
const secretClient = new SecretManagerServiceClient();

/**
 * Fetch secret from Secret Manager
 */
async function getSecret(secretName) {
  const name = `projects/csc323-final/secrets/${secretName}/versions/latest`;
  const [version] = await secretClient.accessSecretVersion({ name });
  return version.payload.data.toString("utf8");
}

/**
 * Scrape PC part pricing from external source
 * This is a placeholder - integrate with real scraping logic
 */
async function scrapePricing() {
  try {
    // Example: fetch from a PC part data source
    // This could be: PCPartPicker, Newegg, Amazon, etc.
    const response = await axios.get("https://api.example.com/parts", {
      timeout: 30000,
    });
    return response.data.parts || [];
  } catch (err) {
    console.error("Failed to scrape pricing:", err.message);
    return [];
  }
}

/**
 * Update or insert parts into Firestore
 */
async function upsertParts(parts) {
  const batch = db.batch();
  const partsRef = db.collection("parts");

  for (const part of parts) {
    const docRef = partsRef.doc(part.id);
    batch.set(
      docRef,
      {
        ...part,
        updatedAt: new Date(),
      },
      { merge: true }
    );
  }

  await batch.commit();
  console.log(`Upserted ${parts.length} parts to Firestore`);
}

/**
 * Cloud Function: Refresh Parts Pricing
 * Triggered by Cloud Scheduler nightly
 */
functions.http("refreshParts", async (req, res) => {
  try {
    // Verify cloud scheduler auth header
    const authHeader = req.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    console.log("Starting nightly parts refresh...");

    // Scrape latest pricing data
    const parts = await scrapePricing();
    if (parts.length === 0) {
      console.warn("No parts fetched from source");
      return res.status(200).json({ status: "completed", parts_updated: 0 });
    }

    // Upsert to Firestore
    await upsertParts(parts);

    // Log metrics (optional)
    const metricsRef = db.collection("metrics").doc("global");
    await metricsRef.update({
      parts_refreshed_at: new Date(),
      parts_count: parts.length,
    });

    res.status(200).json({
      status: "completed",
      parts_updated: parts.length,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("Error in refreshParts:", err);
    res.status(500).json({ error: err.message });
  }
});
