"use strict";

const { Firestore } = require("@google-cloud/firestore");
const fs = require("fs");
const path = require("path");

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
const DATA_DIR = path.join(__dirname, "data");
const BATCH_SIZE = 50;
const DELAY_MS = 1500;

const PART_TYPE_MAP = {
  "cpu": "cpu",
  "cpu-cooler": "cpu_cooler",
  "motherboard": "motherboard",
  "memory": "memory",
  "internal-hard-drive": "storage",
  "video-card": "gpu",
  "case": "case",
  "power-supply": "psu",
  "optical-drive": "optical_drive",
  "os": "os",
  "monitor": "monitor",
  "external-hard-drive": "external_storage",
  "case-accessory": "case_accessory",
  "case-fan": "case_fan",
  "fan-controller": "fan_controller",
  "thermal-paste": "thermal_paste",
  "ups": "ups",
  "sound-card": "sound_card",
  "wired-network-card": "wired_nic",
  "wireless-network-card": "wireless_nic",
  "headphones": "headphones",
  "keyboard": "keyboard",
  "mouse": "mouse",
  "speakers": "speakers",
  "webcam": "webcam",
};

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function normalizePrice(val) {
  if (val === null || val === undefined || val === "") return null;
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n;
}

function transformPart(raw, partType) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  const price = normalizePrice(out.price ?? null);
  return {
    ...out,
    price,
    partType,
    searchName: (out.name ?? "").toLowerCase(),
    inStock: price !== null,
    seededAt: Firestore.Timestamp.now(),
  };
}

async function seedPartType(db, filename, partType) {
  const filePath = path.join(DATA_DIR, `${filename}.json`);
  if (!fs.existsSync(filePath)) {
    console.warn(`[SKIP] ${filename}.json not found`);
    return 0;
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(raw) || raw.length === 0) {
    console.warn(`[SKIP] ${filename}.json is empty`);
    return 0;
  }

  const docs = raw.map((item) => transformPart(item, partType));
  const collection = db.collection("parts");
  let count = 0;
  let batchNum = 0;

  while (count < docs.length) {
    const chunk = docs.slice(count, count + BATCH_SIZE);
    const batch = db.batch();
    for (const doc of chunk) {
      batch.set(collection.doc(), doc);
    }

    let retries = 0;
    while (retries < 5) {
      try {
        await batch.commit();
        break;
      } catch (err) {
        if (err.code === 8) {
          retries++;
          const wait = DELAY_MS * retries * 2;
          console.warn(`  [QUOTA] batch ${batchNum} throttled, waiting ${wait}ms...`);
          await sleep(wait);
        } else {
          throw err;
        }
      }
    }

    count += chunk.length;
    batchNum++;
    process.stdout.write(`\r  ${count}/${docs.length} docs written...`);
    await sleep(DELAY_MS);
  }

  console.log(`\n[OK]   ${filename} → partType="${partType}" — ${count} docs`);
  return count;
}

async function main() {
  if (!PROJECT_ID) {
    console.error("ERROR: Set GCLOUD_PROJECT env var before running.");
    process.exit(1);
  }

  const db = new Firestore({ projectId: PROJECT_ID });

  const only = process.argv[2];
  if (only) {
    const partType = PART_TYPE_MAP[only];
    if (!partType) {
      console.error(`Unknown key: ${only}`);
      console.error("Valid keys:", Object.keys(PART_TYPE_MAP).join(", "));
      process.exit(1);
    }
    await seedPartType(db, only, partType);
    return;
  }

  let total = 0;
  for (const [filename, partType] of Object.entries(PART_TYPE_MAP)) {
    total += await seedPartType(db, filename, partType);
    await sleep(3000);
  }

  await db.collection("catalog_meta").doc("part_types").set({
    types: Object.values(PART_TYPE_MAP),
    updatedAt: Firestore.Timestamp.now(),
  });

  console.log(`\nSeed complete — ${total} total documents`);
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
