"use strict";

const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");

/** Resolved API key string, false = lookup failed / skip retry, undefined = not loaded yet */
let cached;

/**
 * Gemini API key resolution order:
 * 1. GEMINI_API_KEY or GOOGLE_AI_API_KEY (local dev or Cloud Run env-from-secret injection)
 * 2. Secret Manager: GEMINI_SECRET_RESOURCE or projects/{PROJECT}/secrets/{GEMINI_SECRET_NAME}/versions/{GEMINI_SECRET_VERSION}
 *
 * IAM: Cloud Run SA needs roles/secretmanager.secretAccessor on the secret.
 */
async function getGeminiApiKey() {
  const inline = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
  if (inline && inline.trim()) return inline.trim();

  if (cached !== undefined && cached !== false) return cached;

  const project =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    "";

  const secretId = process.env.GEMINI_SECRET_NAME || "google-ai-api-key";
  const ver = process.env.GEMINI_SECRET_VERSION || "latest";

  let name =
    process.env.GEMINI_SECRET_RESOURCE ||
    (project ? `projects/${project}/secrets/${secretId}/versions/${ver}` : "");

  if (!name) {
    console.warn(
      "getGeminiApiKey: no env key and missing GOOGLE_CLOUD_PROJECT (or GEMINI_SECRET_RESOURCE); Gemini disabled."
    );
    cached = false;
    return null;
  }

  try {
    const client = new SecretManagerServiceClient();
    const [resp] = await client.accessSecretVersion({ name });
    const key = resp.payload?.data?.toString?.("utf8")?.trim();
    if (!key) {
      console.error("getGeminiApiKey: secret payload empty");
      cached = false;
      return null;
    }
    cached = key;
    return key;
  } catch (e) {
    console.error("getGeminiApiKey Secret Manager:", e.message);
    cached = false;
    return null;
  }
}

module.exports = { getGeminiApiKey };
