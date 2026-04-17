"use strict";

const { Firestore } = require("@google-cloud/firestore");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
const BATCH_SIZE = 400;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function deleteCollection(db, collectionName) {
  const collection = db.collection(collectionName);
  let deleted = 0;

  while (true) {
    const snap = await collection.limit(BATCH_SIZE).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;
    process.stdout.write(`\r  ${deleted} docs deleted...`);
    await sleep(500);
  }

  console.log(`\n[OK] Deleted ${deleted} docs from "${collectionName}"`);
  return deleted;
}

async function main() {
  if (!PROJECT_ID) {
    console.error("ERROR: Set GCLOUD_PROJECT env var before running.");
    process.exit(1);
  }

  console.log(`Clearing Firestore project: ${PROJECT_ID}`);
  const db = new Firestore({ projectId: PROJECT_ID });

  await deleteCollection(db, "parts");
  console.log("Done.");
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
