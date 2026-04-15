#!/usr/bin/env node

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PART_TYPES = [
  "cpu",
  "cpu-cooler",
  "motherboard",
  "memory",
  "internal-hard-drive",
  "video-card",
  "case",
  "power-supply",
  "optical-drive",
  "os",
  "monitor",
  "external-hard-drive",
  "case-accessory",
  "case-fan",
  "fan-controller",
  "thermal-paste",
  "ups",
  "sound-card",
  "wired-network-card",
  "wireless-network-card",
  "headphones",
  "keyboard",
  "mouse",
  "speakers",
  "webcam",
];

const DATA_DIR = path.join(__dirname, "data");

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    client
      .get(url, { headers: { "User-Agent": "pc-part-dataset-downloader" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return resolve(fetchJson(res.headers.location));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON parse error for ${url}: ${e.message}`));
          }
        });
      })
      .on("error", reject);
  });
}

async function downloadAll() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const results = { success: [], failed: [] };

  for (const partType of PART_TYPES) {
    const filePath = path.join(DATA_DIR, `${partType}.json`);
    if (fs.existsSync(filePath)) {
      console.log(`[SKIP] ${partType} already downloaded`);
      results.success.push(partType);
      continue;
    }

    const url = `https://raw.githubusercontent.com/docyx/pc-part-dataset/main/data/json/${partType}.json`;
    try {
      console.log(`[FETCH] ${partType}...`);
      const data = await fetchJson(url);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      console.log(`[OK]   ${partType} — ${data.length ?? "?"} records`);
      results.success.push(partType);
    } catch (err) {
      console.error(`[FAIL] ${partType}: ${err.message}`);
      results.failed.push(partType);
    }
  }

  console.log(`\nDone: ${results.success.length} ok, ${results.failed.length} failed`);
  if (results.failed.length > 0) {
    console.log("Failed:", results.failed.join(", "));
    console.log("If raw.githubusercontent.com is blocked, manually download files from:");
    console.log("https://github.com/docyx/pc-part-dataset/tree/main/data/json");
    console.log(`and place them in: ${DATA_DIR}`);
  }
}

downloadAll();
