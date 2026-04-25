"use strict";

/**
 * Loads full catalog rows from Firestore for each selected part id.
 * @param {FirebaseFirestore.Firestore} db
 * @param {Record<string, { id?: string }>} partsFromBody - keys: cpu, gpu, motherboard, memory, storage, psu, case, cpu_cooler
 */
async function loadPartDocuments(db, partsFromBody) {
  const byType = {};
  const entries = Object.entries(partsFromBody || {}).filter(([, v]) => v && v.id);

  await Promise.all(
    entries.map(async ([partType, ref]) => {
      const snap = await db.collection("parts").doc(ref.id).get();
      if (!snap.exists) {
        byType[partType] = { missing: true, id: ref.id };
        return;
      }
      byType[partType] = { id: snap.id, ...snap.data() };
    })
  );

  return byType;
}

/** DDR generation from memory.speed[0] (4=DDR4, 5=DDR5) when present */
function ramDdrGeneration(mem) {
  if (!mem || !Array.isArray(mem.speed)) return null;
  const gen = mem.speed[0];
  return gen === 4 || gen === 5 ? gen : null;
}

function ruleBasedCompatibility(docs) {
  const issues = [];

  const mb = docs.motherboard && !docs.motherboard.missing ? docs.motherboard : null;
  const ram = docs.memory && !docs.memory.missing ? docs.memory : null;
  const psu = docs.psu && !docs.psu.missing ? docs.psu : null;
  const cpu = docs.cpu && !docs.cpu.missing ? docs.cpu : null;
  const gpu = docs.gpu && !docs.gpu.missing ? docs.gpu : null;
  const caseDoc = docs.case && !docs.case.missing ? docs.case : null;

  if (docs.motherboard?.missing) {
    issues.push({ severity: "warning", code: "PART_NOT_FOUND", message: "Motherboard not found in catalog by id." });
  }
  if (docs.cpu?.missing) {
    issues.push({ severity: "warning", code: "PART_NOT_FOUND", message: "CPU not found in catalog by id." });
  }

  /* ── Motherboard vs case form factor ── */
  if (mb && caseDoc) {
    const ff = String(mb.form_factor || "").toLowerCase();
    const ct = String(caseDoc.type || "").toLowerCase();
    if (ff.includes("atx") && !ff.includes("micro") && !ff.includes("mini") && ct.includes("mini itx")) {
      issues.push({
        severity: "error",
        code: "CASE_MB_FORM",
        message: "Full ATX motherboard will not fit a Mini ITX case.",
      });
    }
    if (ff.includes("eatx") || ff.includes("e-atx")) {
      issues.push({
        severity: "warning",
        code: "CASE_EATX",
        message: "E-ATX boards need a large case with proper standoffs and clearance.",
      });
    }
  }

  /* ── RAM capacity vs board max ── */
  if (ram && mb && Array.isArray(ram.modules) && ram.modules.length >= 2) {
    const gb = ram.modules[0] * ram.modules[1];
    if (typeof mb.max_memory === "number" && gb > mb.max_memory + 1e-6) {
      issues.push({
        severity: "error",
        code: "RAM_MAX",
        message: `RAM kit is ${gb} GB but this board supports at most ${mb.max_memory} GB.`,
      });
    }
  }

  /* ── DDR generation vs motherboard naming (dataset often lacks explicit DDR field) ── */
  if (ram && mb) {
    const ddrRam = ramDdrGeneration(ram);
    const name = String(mb.name || "").toUpperCase();
    const nameDdr4 = name.includes("DDR4");
    const nameDdr5 = name.includes("DDR5");
    if (ddrRam === 5 && nameDdr4 && !nameDdr5) {
      issues.push({
        severity: "error",
        code: "DDR_MISMATCH",
        message: "DDR5 memory with a motherboard marketed as DDR4.",
      });
    }
    if (ddrRam === 4 && nameDdr5 && !nameDdr4) {
      issues.push({
        severity: "error",
        code: "DDR_MISMATCH",
        message: "DDR4 memory with a motherboard marketed as DDR5-only.",
      });
    }
  }

  /* ── Rough PSU headroom (CPU TDP + GPU placeholder + rest) ── */
  if (psu && psu.wattage) {
    const cpuT = typeof cpu?.tdp === "number" ? cpu.tdp : 125;
    let gpuEst = 200;
    if (gpu && /rtx\s*40|rx\s*7|5070|5080|5090|7900/i.test(JSON.stringify(gpu))) gpuEst = 320;
    const estimated = Math.round(cpuT + gpuEst + 120);
    if (psu.wattage < estimated * 0.85) {
      issues.push({
        severity: "warning",
        code: "PSU_HEADROOM",
        message: `${psu.wattage}W PSU may be undersized for ~${estimated}W estimated peak (CPU TDP + GPU class + overhead).`,
      });
    }
  }

  /* ── GPU length vs case (when both numbers exist) ── */
  if (gpu && caseDoc && typeof gpu.length === "number") {
    const clearance =
      typeof caseDoc.gpu_clearance === "number"
        ? caseDoc.gpu_clearance
        : typeof caseDoc.max_video_card_length === "number"
          ? caseDoc.max_video_card_length
          : null;
    if (clearance != null && gpu.length > clearance) {
      issues.push({
        severity: "error",
        code: "GPU_LENGTH",
        message: `GPU length ${gpu.length} mm exceeds case clearance ${clearance} mm.`,
      });
    }
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  let summary = "No rule-based conflicts.";
  if (errors.length) summary = `${errors.length} blocking issue(s) from catalog rules.`;
  else if (warnings.length) summary = `${warnings.length} warning(s); review before buying.`;

  return {
    compatible: errors.length === 0,
    issues,
    summary,
    errors: errors.length,
    warnings: warnings.length,
  };
}

/**
 * Calls Gemini with a compact JSON summary of parts. Requires GEMINI_API_KEY.
 */
async function geminiCompatibility(partSummaries, apiKey, modelName) {
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);

  const prompt = `You are a PC building compatibility expert. Given this JSON of PC parts (from a parts database), decide if they work together.

Rules:
- Flag CPU socket vs motherboard socket mismatches (infer CPU socket from model name/chipset when socket field is missing).
- Flag RAM DDR generation vs motherboard.
- Flag obvious PSU inadequacy or GPU-case clearance issues if dimensions are present.
- Use severity "error" for definite incompatibilities, "warning" for uncertainty or tight fits.

Respond with ONLY valid JSON:
{
  "compatible": boolean,
  "summary": string,
  "issues": [ { "severity": "error"|"warning", "code": string, "message": string } ]
}

Parts JSON:
${JSON.stringify(partSummaries, null, 2)}`;

  async function generateWithModel(name) {
    const model = genAI.getGenerativeModel({
      model: name,
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);
    return {
      compatible: !!parsed.compatible,
      summary: String(parsed.summary || ""),
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    };
  }

  const fallback =
    process.env.GEMINI_MODEL_FALLBACK ||
    "gemini-2.5-flash-lite";

  async function generateWithRetries(name) {
    const maxAttempts = 5;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await generateWithModel(name);
      } catch (e) {
        lastErr = e;
        const msg = e.message || String(e);
        const retryable =
          /503|429|UNAVAILABLE|high demand|overloaded|EAI_AGAIN|resource_exhausted|temporarily unavailable/i.test(
            msg
          );
        if (retryable && attempt < maxAttempts) {
          const ms = 600 * Math.pow(2, attempt - 1);
          console.warn(`geminiCompatibility (${name}) retry ${attempt}/${maxAttempts} in ${ms}ms`);
          await new Promise((r) => setTimeout(r, ms));
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  try {
    return await generateWithRetries(modelName);
  } catch (e) {
    const msg = e.message || String(e);
    const deprecated =
      /404|no longer available|not found/i.test(msg) && fallback && fallback !== modelName;
    if (deprecated) {
      console.warn(`geminiCompatibility: switching fallback model ${fallback}`);
      return await generateWithRetries(fallback);
    }
    throw e;
  }
}

/** Strip Firestore noise for prompts */
function summarizePartForAi(partType, doc) {
  if (!doc || doc.missing) return { partType, missingCatalogRow: true };
  const pick = [
    "name",
    "socket",
    "form_factor",
    "max_memory",
    "memory_slots",
    "tdp",
    "wattage",
    "length",
    "chipset",
    "speed",
    "modules",
    "interface",
    "type",
    "efficiency",
  ];
  const out = { partType };
  for (const k of pick) {
    if (doc[k] !== undefined && doc[k] !== null) out[k] = doc[k];
  }
  return out;
}

module.exports = {
  loadPartDocuments,
  ruleBasedCompatibility,
  geminiCompatibility,
  summarizePartForAi,
};
