# Forgespec PCPP Redesign + Features Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship build-naming, post-finalize action selector, profile page with edit/delete/re-trigger, and PC-Part-Picker-style data density + compatibility/wattage banner.

**Architecture:** Backend gains `requestedAnalyses` array on build docs (analyzers gate on it), three new build-api endpoints (analyze trigger, PATCH name, DELETE), one new benchmark-api endpoint (DELETE). Frontend gains two new pages (PostFinalize, Profile), a refactored Builder with table layout + sticky compatibility banner, and two pure helper modules (wattage estimator, compatibility checker). API Gateway gets four new routes.

**Tech Stack:** Same as existing — Node.js Express on Cloud Run, React TypeScript + Tailwind, Firebase SDK, gcloud + firebase CLIs.

**Spec:** `docs/superpowers/specs/2026-04-25-pcpp-redesign-design.md`

---

## File Map

**Modify:**
- `services/build-api/index.js` — buildName validation; `analyses` array → `requestedAnalyses`; new endpoints (POST analyze, PATCH, DELETE)
- `services/benchmark-api/index.js` — new DELETE endpoint
- `services/bottleneck-analyzer/index.js` — gate on `requestedAnalyses`
- `services/value-optimizer/index.js` — gate on `requestedAnalyses`
- `infra/api-gateway.yaml` — add 4 new operations + CORS preflight
- `frontend/src/App.tsx` — extended routing, profile in nav
- `frontend/src/pages/BuilderPage.tsx` — build name input, sticky compatibility banner, table layout, post-finalize nav (no longer POSTs directly)
- `frontend/src/pages/AnalysisPage.tsx` — accept `selectedBuildId` prop

**Create:**
- `frontend/src/lib/wattage.ts`
- `frontend/src/lib/compatibility.ts`
- `frontend/src/pages/PostFinalizePage.tsx`
- `frontend/src/pages/ProfilePage.tsx`

---

## Task 1: Wattage + compatibility helpers (no GCP changes; safe to commit standalone)

**Files:** Create `frontend/src/lib/wattage.ts`, `frontend/src/lib/compatibility.ts`

- [ ] **Step 1: Create `frontend/src/lib/wattage.ts`**

```typescript
export interface PartLike {
  partType?: string;
  name?: string;
  specs?: any;
}

const TDP_REGEX_TABLE: Array<[RegExp, number]> = [
  [/i9-?14|i9-?13|i9-?12|9950X|9900X|9700X/i, 170],
  [/i7-?14|i7-?13|i7-?12|7800X3D|7700X|7700|7800/i, 105],
  [/i5|7600X|5600X|7600/i, 65],
  [/i3|5500|5600G/i, 65],
  [/RTX\s*40?9|RTX\s*40?8|7900\s*XTX|7900\s*XT/i, 380],
  [/RTX\s*40?7|RTX\s*30?9|RTX\s*30?8/i, 280],
  [/RTX\s*40?6|RTX\s*30?7|RTX\s*30?6/i, 200],
  [/RTX\s*40?5|RTX\s*30?5|RX\s*7600|RX\s*6600/i, 130],
  [/GTX\s*16|GTX\s*10/i, 100],
];

const DEFAULTS: Record<string, number> = {
  cpu: 95,
  gpu: 200,
  "video-card": 200,
  motherboard: 30,
  memory: 10,
  "internal-hard-drive": 8,
  "external-hard-drive": 8,
  ssd: 5,
  "case-fan": 3,
  "cpu-cooler": 5,
  monitor: 0,
  case: 0,
  "power-supply": 0,
  os: 0,
  headphones: 0,
  speakers: 5,
  keyboard: 1,
  mouse: 1,
  webcam: 1,
};

export function tdpFor(part: PartLike | null | undefined): number {
  if (!part) return 0;
  const name = part.name ?? "";
  for (const [re, w] of TDP_REGEX_TABLE) {
    if (re.test(name)) return w;
  }
  return DEFAULTS[part.partType ?? ""] ?? 0;
}

export function totalWattage(parts: Array<PartLike | null | undefined>): number {
  return parts.reduce<number>((sum, p) => sum + tdpFor(p), 0);
}
```

- [ ] **Step 2: Create `frontend/src/lib/compatibility.ts`**

```typescript
import { PartLike } from "./wattage";

export type Issue = {
  severity: "warning" | "error";
  message: string;
};

function psuWattage(psu: PartLike | null | undefined): number {
  if (!psu) return 0;
  const fromSpec = Number(psu.specs?.wattage ?? 0);
  if (fromSpec > 0) return fromSpec;
  const m = psu.name?.match(/(\d{3,4})\s*W/i);
  return m ? Number(m[1]) : 0;
}

export function checkCompatibility(
  parts: Record<string, PartLike | null | undefined>,
  totalW: number
): Issue[] {
  const out: Issue[] = [];

  // PSU adequacy
  const psu = parts["power-supply"];
  if (psu) {
    const psuW = psuWattage(psu);
    if (psuW > 0 && psuW < totalW * 1.2) {
      out.push({
        severity: "warning",
        message: `PSU is ${psuW}W; build draws ~${totalW}W. Recommend ≥${Math.ceil(totalW * 1.2)}W (20% headroom).`,
      });
    }
  } else if (totalW > 100) {
    out.push({ severity: "warning", message: "No power supply selected." });
  }

  // RAM ↔ Mobo memory type
  const ram = parts.memory;
  const mobo = parts.motherboard;
  if (ram?.specs?.memoryType && mobo?.specs?.memoryType) {
    if (ram.specs.memoryType !== mobo.specs.memoryType) {
      out.push({
        severity: "error",
        message: `RAM is ${ram.specs.memoryType} but motherboard supports ${mobo.specs.memoryType}.`,
      });
    }
  }

  // CPU socket ↔ Mobo socket
  const cpu = parts.cpu;
  if (cpu?.specs?.socket && mobo?.specs?.socket) {
    if (cpu.specs.socket !== mobo.specs.socket) {
      out.push({
        severity: "error",
        message: `CPU socket ${cpu.specs.socket} doesn't match motherboard ${mobo.specs.socket}.`,
      });
    }
  }

  return out;
}

export function statusFor(issues: Issue[]): "ok" | "warn" | "error" {
  if (issues.some((i) => i.severity === "error")) return "error";
  if (issues.length > 0) return "warn";
  return "ok";
}
```

- [ ] **Step 3: Visual sanity check**

```bash
ls -la /Users/ryan/dev/school/csc323/Forgespec/frontend/src/lib/ 2>&1
```

Expected: both files present.

- [ ] **Step 4: Commit (deferred to end-of-batch — see Task 12)**

---

## Task 2: Backend — `build-api` accepts buildName + analyses array

**Files:** `services/build-api/index.js`

- [ ] **Step 1: Add validation + analyses handling in POST /builds**

Replace the body of `app.post("/builds", ...)` with:

```javascript
app.post("/builds", async (req, res) => {
  try {
    const { parts, totalPrice, buildName, analyses } = req.body;

    if (!parts || typeof parts !== "object") {
      return res.status(400).json({ error: "Missing required field: parts object" });
    }
    if (!buildName || typeof buildName !== "string" || buildName.trim().length === 0) {
      return res.status(400).json({ error: "Missing required field: buildName" });
    }
    if (buildName.length > 80) {
      return res.status(400).json({ error: "buildName must be 80 characters or fewer" });
    }
    const requestedAnalyses = Array.isArray(analyses)
      ? analyses.filter((a) => a === "bottleneck" || a === "optimization")
      : [];

    const userId = extractUserIdFromToken(req.get("Authorization"));
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized: Invalid or missing token" });
    }

    // Reject duplicate names per user.
    const existing = await firestore
      .collection("users").doc(userId).collection("builds")
      .where("buildName", "==", buildName.trim())
      .limit(1)
      .get();
    if (!existing.empty) {
      return res.status(409).json({ error: `A build named "${buildName.trim()}" already exists` });
    }

    const buildId = randomUUID();
    const timestamp = new Date();

    const buildData = {
      buildId,
      buildName: buildName.trim(),
      userId,
      parts,
      totalPrice: totalPrice || 0,
      createdAt: timestamp,
      status: requestedAnalyses.length > 0 ? "finalized" : "saved",
      requestedAnalyses,
      analysisResult: null,
      valueOptimization: null,
    };

    await firestore.collection("users").doc(userId).collection("builds").doc(buildId).set(buildData);

    // Atomic increment of platform-wide counter (safe under concurrent load)
    await firestore.collection("metrics").doc("global").set(
      { totalBuildsFinalized: FieldValue.increment(1) },
      { merge: true }
    );

    // Always publish — analyzers gate on requestedAnalyses (empty array => both skip).
    const topic = pubsub.topic(TOPIC_NAME);
    await topic.publish(Buffer.from(JSON.stringify({ buildId, userId, requestedAnalyses })));

    console.log(`Build ${buildId} (${buildName.trim()}) created with analyses: [${requestedAnalyses.join(",")}]`);

    res.status(202).json({
      buildId,
      buildName: buildName.trim(),
      status: requestedAnalyses.length > 0 ? "Processing" : "Saved",
      requestedAnalyses,
    });
  } catch (err) {
    console.error("Error in POST /builds:", err);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: Add POST /builds/:buildId/analyze endpoint** (insert after POST /builds, before GET /builds/:buildId)

```javascript
// POST /builds/:buildId/analyze - re-trigger analyses on existing build
app.post("/builds/:buildId/analyze", async (req, res) => {
  try {
    const { buildId } = req.params;
    const userId = extractUserIdFromToken(req.get("Authorization"));
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const types = Array.isArray(req.body?.types)
      ? req.body.types.filter((t) => t === "bottleneck" || t === "optimization")
      : [];
    if (types.length === 0) {
      return res.status(400).json({ error: "types must be a non-empty array" });
    }

    const ref = firestore.collection("users").doc(userId).collection("builds").doc(buildId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Build not found" });

    const existing = snap.data().requestedAnalyses ?? [];
    const merged = Array.from(new Set([...existing, ...types]));
    await ref.update({ requestedAnalyses: merged });

    await pubsub.topic(TOPIC_NAME).publish(
      Buffer.from(JSON.stringify({ buildId, userId, requestedAnalyses: merged }))
    );

    res.status(202).json({ buildId, requestedAnalyses: merged });
  } catch (err) {
    console.error("Error in POST /builds/:buildId/analyze:", err);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Add PATCH /builds/:buildId endpoint** (rename only)

```javascript
// PATCH /builds/:buildId - rename a build
app.patch("/builds/:buildId", async (req, res) => {
  try {
    const { buildId } = req.params;
    const { buildName } = req.body || {};
    const userId = extractUserIdFromToken(req.get("Authorization"));
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!buildName || typeof buildName !== "string" || buildName.trim().length === 0 || buildName.length > 80) {
      return res.status(400).json({ error: "buildName required, 1-80 chars" });
    }

    const ref = firestore.collection("users").doc(userId).collection("builds").doc(buildId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Build not found" });

    await ref.update({ buildName: buildName.trim() });
    res.json({ buildId, buildName: buildName.trim() });
  } catch (err) {
    console.error("Error in PATCH /builds/:buildId:", err);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Add DELETE /builds/:buildId endpoint** (recursive)

```javascript
// DELETE /builds/:buildId - delete build and its assessments
app.delete("/builds/:buildId", async (req, res) => {
  try {
    const { buildId } = req.params;
    const userId = extractUserIdFromToken(req.get("Authorization"));
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const ref = firestore.collection("users").doc(userId).collection("builds").doc(buildId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Build not found" });

    // Delete all assessment subcollection docs
    const assessmentsSnap = await ref.collection("assessments").get();
    const batch = firestore.batch();
    assessmentsSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(ref);
    await batch.commit();

    res.json({ buildId, deleted: true });
  } catch (err) {
    console.error("Error in DELETE /builds/:buildId:", err);
    res.status(500).json({ error: err.message });
  }
});
```

---

## Task 3: Backend — `benchmark-api` DELETE endpoint

**Files:** `services/benchmark-api/index.js`

- [ ] **Step 1: Add DELETE handler** (after the existing GET /benchmarks/:benchmarkId)

```javascript
// DELETE /benchmarks/:benchmarkId - remove benchmark + storage object
app.delete("/benchmarks/:benchmarkId", async (req, res) => {
  try {
    const { benchmarkId } = req.params;
    const userId = extractUserIdFromToken(req.get("Authorization"));
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const ref = firestore.collection("users").doc(userId).collection("benchmarks").doc(benchmarkId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: "Benchmark not found" });

    const data = snap.data();
    // Delete the storage object (best-effort).
    try {
      if (data.storagePath) {
        await storage.bucket(BUCKET_NAME).file(data.storagePath).delete();
      }
    } catch (storageErr) {
      console.warn(`Could not delete storage object ${data.storagePath}:`, storageErr.message);
    }

    await ref.delete();
    res.json({ benchmarkId, deleted: true });
  } catch (err) {
    console.error("Error in DELETE /benchmarks/:benchmarkId:", err);
    res.status(500).json({ error: err.message });
  }
});
```

---

## Task 4: Backend — Analyzers gate on `requestedAnalyses`

**Files:** `services/bottleneck-analyzer/index.js`, `services/value-optimizer/index.js`

- [ ] **Step 1: Add gate in `bottleneck-analyzer/index.js`** — insert immediately after the `const buildData = buildDoc.data();` line:

```javascript
    // Gate on requestedAnalyses (legacy builds without the field still run for back-compat).
    const requested = buildData.requestedAnalyses;
    if (Array.isArray(requested) && requested.length > 0 && !requested.includes("bottleneck")) {
      console.log(`Skip: bottleneck not in requestedAnalyses for build ${buildId}`);
      return res.status(200).json({ ack: true });
    }
```

- [ ] **Step 2: Add same gate in `value-optimizer/index.js`** — replace `bottleneck` with `optimization`:

```javascript
    const requested = buildData.requestedAnalyses;
    if (Array.isArray(requested) && requested.length > 0 && !requested.includes("optimization")) {
      console.log(`Skip: optimization not in requestedAnalyses for build ${buildId}`);
      return res.status(200).json({ ack: true });
    }
```

---

## Task 5: API Gateway — add 4 new routes

**Files:** `infra/api-gateway.yaml`

- [ ] **Step 1: Append the 4 new operations** to the YAML (under the existing paths):

```yaml
  /builds/{buildId}/analyze:
    post:
      operationId: analyzeBuild
      summary: Re-trigger analyses on a build
      parameters:
        - in: path
          name: buildId
          required: true
          type: string
      x-google-backend:
        address: https://build-api-5qbytyegcq-uc.a.run.app
        path_translation: APPEND_PATH_TO_ADDRESS
      responses:
        "202":
          description: Accepted
        "401":
          description: Unauthorized
    options:
      operationId: corsAnalyzeBuild
      security: []
      parameters:
        - in: path
          name: buildId
          required: true
          type: string
      x-google-backend:
        address: https://build-api-5qbytyegcq-uc.a.run.app
        path_translation: APPEND_PATH_TO_ADDRESS
      responses:
        "204":
          description: CORS preflight

  /builds/{buildId}/rename:
    post:
      operationId: renameBuild
      summary: Rename a build (PATCH-equivalent over POST for gateway compat)
      parameters:
        - in: path
          name: buildId
          required: true
          type: string
      x-google-backend:
        address: https://build-api-5qbytyegcq-uc.a.run.app
        path_translation: APPEND_PATH_TO_ADDRESS
      responses:
        "200":
          description: OK
        "401":
          description: Unauthorized
    options:
      operationId: corsRenameBuild
      security: []
      parameters:
        - in: path
          name: buildId
          required: true
          type: string
      x-google-backend:
        address: https://build-api-5qbytyegcq-uc.a.run.app
        path_translation: APPEND_PATH_TO_ADDRESS
      responses:
        "204":
          description: CORS preflight

  /builds/{buildId}/delete:
    post:
      operationId: deleteBuild
      summary: Delete a build (POST tunnel — gateway can't reliably proxy DELETE bodies)
      parameters:
        - in: path
          name: buildId
          required: true
          type: string
      x-google-backend:
        address: https://build-api-5qbytyegcq-uc.a.run.app
        path_translation: APPEND_PATH_TO_ADDRESS
      responses:
        "200":
          description: OK
        "401":
          description: Unauthorized
    options:
      operationId: corsDeleteBuild
      security: []
      parameters:
        - in: path
          name: buildId
          required: true
          type: string
      x-google-backend:
        address: https://build-api-5qbytyegcq-uc.a.run.app
        path_translation: APPEND_PATH_TO_ADDRESS
      responses:
        "204":
          description: CORS preflight

  /benchmarks/{benchmarkId}/delete:
    post:
      operationId: deleteBenchmark
      summary: Delete a benchmark
      parameters:
        - in: path
          name: benchmarkId
          required: true
          type: string
      x-google-backend:
        address: https://benchmark-api-5qbytyegcq-uc.a.run.app
        path_translation: APPEND_PATH_TO_ADDRESS
      responses:
        "200":
          description: OK
        "401":
          description: Unauthorized
    options:
      operationId: corsDeleteBenchmark
      security: []
      parameters:
        - in: path
          name: benchmarkId
          required: true
          type: string
      x-google-backend:
        address: https://benchmark-api-5qbytyegcq-uc.a.run.app
        path_translation: APPEND_PATH_TO_ADDRESS
      responses:
        "204":
          description: CORS preflight
```

**Note:** Using POST tunnels (`/rename`, `/delete`) instead of native PATCH/DELETE — Google API Gateway has known issues with DELETE bodies and PATCH on Swagger 2.0. Frontend uses POST to these tunnel paths. Build-api separately supports the tunnel paths via additional Express routes.

- [ ] **Step 2: Add tunnel routes in build-api** — add to `services/build-api/index.js`:

```javascript
// Gateway tunnel routes (Google API Gateway limitations on PATCH/DELETE bodies).
app.post("/builds/:buildId/rename", (req, res, next) => {
  req.method = "PATCH";
  app._router.handle(req, res, next);
});
app.post("/builds/:buildId/delete", (req, res, next) => {
  req.method = "DELETE";
  app._router.handle(req, res, next);
});
```

Wait — Express routing on `req.method` mutation doesn't redispatch cleanly. Use direct handlers instead:

Actually, the cleanest pattern: define handler functions, then bind them to BOTH the canonical and the tunnel paths. Refactor:

```javascript
async function renameBuildHandler(req, res) { /* PATCH body */ }
async function deleteBuildHandler(req, res) { /* DELETE body */ }
app.patch("/builds/:buildId", renameBuildHandler);
app.post("/builds/:buildId/rename", renameBuildHandler);
app.delete("/builds/:buildId", deleteBuildHandler);
app.post("/builds/:buildId/delete", deleteBuildHandler);
```

Same for benchmark-api: `app.delete("/benchmarks/:benchmarkId", deleteBenchmarkHandler);` + `app.post("/benchmarks/:benchmarkId/delete", deleteBenchmarkHandler);`.

Update Tasks 2 and 3 implementations accordingly when writing the actual code.

- [ ] **Step 3: Deploy gateway config v4**

```bash
cd ~/dev/school/csc323/Forgespec && \
gcloud api-gateway api-configs create v4 \
  --api=forgespec-api \
  --openapi-spec=infra/api-gateway.yaml \
  --backend-auth-service-account=sa-api-gateway@csc323-final.iam.gserviceaccount.com \
  --project=csc323-final && \
gcloud api-gateway gateways update forgespec-gateway \
  --api=forgespec-api \
  --api-config=v4 \
  --location=us-central1 \
  --project=csc323-final
```

Expected: gateway updated. ~1-2 minutes for propagation.

---

## Task 6: Redeploy all four services

- [ ] **Step 1: Run all four deploys (parallelized)**

```bash
cd ~/dev/school/csc323/Forgespec/services/build-api && \
gcloud run deploy build-api --source=. --region=us-central1 --project=csc323-final \
  --service-account=sa-build-api@csc323-final.iam.gserviceaccount.com --allow-unauthenticated --quiet &

cd ~/dev/school/csc323/Forgespec/services/benchmark-api && \
gcloud run deploy benchmark-api --source=. --region=us-central1 --project=csc323-final \
  --service-account=sa-benchmark-api@csc323-final.iam.gserviceaccount.com --allow-unauthenticated --quiet &

cd ~/dev/school/csc323/Forgespec/services/bottleneck-analyzer && \
gcloud run deploy bottleneck-analyzer --source=. --region=us-central1 --project=csc323-final \
  --service-account=sa-bottleneck-analyzer@csc323-final.iam.gserviceaccount.com --no-allow-unauthenticated --quiet &

cd ~/dev/school/csc323/Forgespec/services/value-optimizer && \
gcloud run deploy value-optimizer --source=. --region=us-central1 --project=csc323-final \
  --service-account=sa-value-optimizer@csc323-final.iam.gserviceaccount.com --no-allow-unauthenticated --quiet &

wait
```

Expected: 4 "Service deployed" lines.

---

## Task 7: Frontend routing — App.tsx

**Files:** `frontend/src/App.tsx`

- [ ] **Step 1: Extend Page union and add navigation/context state**

The current pattern: `type Page = "builder" | "analysis" | "benchmark"` with simple state. Extend to:

```typescript
type Page = "builder" | "post-finalize" | "analysis" | "benchmark" | "profile";

interface PageContext {
  buildName?: string;
  parts?: Record<string, any>;
  totalPrice?: number;
  selectedBuildId?: string;
}
```

- [ ] **Step 2: Wire context state and navigation handler**

Add inside `App()`:
```typescript
const [pageContext, setPageContext] = useState<PageContext>({});

const navigate = (p: Page, ctx?: PageContext) => {
  setPage(p);
  setPageContext(ctx ?? {});
  setMobileOpen(false);
};
```

Replace `nav` calls with `navigate`. Pass `navigate` and `pageContext` down to children that need them.

- [ ] **Step 3: Add Profile to navItems and route the page switch**

```typescript
const navItems: { key: Page; label: string }[] = [
  { key: "builder", label: "Builder" },
  { key: "analysis", label: "Analysis" },
  { key: "benchmark", label: "Benchmark" },
  { key: "profile", label: "Profile" },
];
```

In the page-switch JSX:
```tsx
{page === "builder" && <BuilderPage navigate={navigate} />}
{page === "post-finalize" && <PostFinalizePage navigate={navigate} ctx={pageContext} />}
{page === "analysis" && <AnalysisPage selectedBuildId={pageContext.selectedBuildId} />}
{page === "benchmark" && <BenchmarkPage />}
{page === "profile" && <ProfilePage navigate={navigate} />}
```

---

## Task 8: BuilderPage — name input, sticky banner, table layout, post-finalize navigation

**Files:** `frontend/src/pages/BuilderPage.tsx`

This is the largest single change. Refactor in place (existing file is 599 lines; final ~700 lines is acceptable).

- [ ] **Step 1: Add prop `navigate` to component signature**
- [ ] **Step 2: Add `buildName` state with input field above category tabs**
- [ ] **Step 3: Import `tdpFor`, `totalWattage`, `checkCompatibility`, `statusFor`, `Issue` from new lib modules**
- [ ] **Step 4: Compute `wattage`, `issues`, `status` via `useMemo` from `selectedParts`**
- [ ] **Step 5: Render sticky compatibility banner above category tabs (status pill, wattage, total)**
- [ ] **Step 6: Refactor parts list from cards to a sortable table (Name | Manufacturer | Specs | Price | Add)**
- [ ] **Step 7: Refactor build summary sidebar into a top-anchored row-per-category table with thumbnail, name, price, Edit, ×**
- [ ] **Step 8: Replace "Finalize Build" POST with `navigate("post-finalize", { buildName, parts: selectedParts, totalPrice })`** — disabled while `buildName.trim() === ""` or `status === "error"`

(Implementation code is large — written inline during execution rather than copied here. Reference the spec's Frontend Changes section for exact UI requirements.)

---

## Task 9: PostFinalizePage — new file

**Files:** Create `frontend/src/pages/PostFinalizePage.tsx`

- [ ] **Step 1: Write file with 4-button action grid + POST → navigate flow**

```tsx
import { useState } from "react";
import { auth } from "../firebase";

interface NavigateFn {
  (page: string, ctx?: any): void;
}

interface Props {
  navigate: NavigateFn;
  ctx: { buildName?: string; parts?: Record<string, any>; totalPrice?: number };
}

function gatewayBase(): string | null {
  const base = process.env.REACT_APP_GATEWAY_URL?.replace(/\/$/, "") ?? "";
  return base || null;
}

export default function PostFinalizePage({ navigate, ctx }: Props) {
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!ctx.buildName || !ctx.parts) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <p className="text-sm text-neutral-500">No build to finalize. Go back to the Builder.</p>
        <button onClick={() => navigate("builder")} className="mt-4 px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold">
          Back to Builder
        </button>
      </div>
    );
  }

  const submit = async (analyses: ("bottleneck" | "optimization")[], label: string) => {
    setSubmitting(label);
    setError(null);
    try {
      const base = gatewayBase();
      if (!base) throw new Error("REACT_APP_GATEWAY_URL is not set");
      const token = await auth.currentUser!.getIdToken();
      const res = await fetch(`${base}/builds`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          buildName: ctx.buildName,
          parts: ctx.parts,
          totalPrice: ctx.totalPrice ?? 0,
          analyses,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Save failed (${res.status}): ${text}`);
      }
      const json = await res.json();
      navigate("analysis", { selectedBuildId: json.buildId });
    } catch (err: any) {
      setError(err.message || "Save failed");
      setSubmitting(null);
    }
  };

  const partCount = Object.keys(ctx.parts).length;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100 tracking-tight">
        Finalize: {ctx.buildName}
      </h1>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 mb-6">
        Choose how to process this build. You can always re-trigger analyses later from your Profile.
      </p>

      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 mb-6">
        <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1">Summary</p>
        <p className="text-sm">
          <span className="font-semibold">{partCount}</span> parts · Total
          <span className="font-semibold ml-1">${ctx.totalPrice?.toFixed(2) ?? "0.00"}</span>
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ActionButton
          title="Run Bottleneck Analysis"
          subtitle="Detects CPU/GPU/RAM/PSU bottlenecks via Gemini"
          variant="primary"
          loading={submitting === "bottleneck"}
          disabled={submitting !== null}
          onClick={() => submit(["bottleneck"], "bottleneck")}
        />
        <ActionButton
          title="Run Value Optimization"
          subtitle="Suggests better-value parts at the same budget"
          variant="primary"
          loading={submitting === "optimization"}
          disabled={submitting !== null}
          onClick={() => submit(["optimization"], "optimization")}
        />
        <ActionButton
          title="Run Both Analyses"
          subtitle="Pub/Sub fan-out · recommended"
          variant="outline"
          loading={submitting === "both"}
          disabled={submitting !== null}
          onClick={() => submit(["bottleneck", "optimization"], "both")}
        />
        <ActionButton
          title="Save Without Analyzing"
          subtitle="Just store the build for later"
          variant="neutral"
          loading={submitting === "save"}
          disabled={submitting !== null}
          onClick={() => submit([], "save")}
        />
      </div>

      <button
        onClick={() => navigate("builder")}
        disabled={submitting !== null}
        className="mt-6 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 disabled:opacity-50"
      >
        ← Back to Builder
      </button>
    </div>
  );
}

function ActionButton({
  title, subtitle, variant, loading, disabled, onClick,
}: {
  title: string; subtitle: string;
  variant: "primary" | "outline" | "neutral";
  loading: boolean; disabled: boolean; onClick: () => void;
}) {
  const styles =
    variant === "primary"
      ? "bg-orange-500 hover:bg-orange-600 text-white border-orange-500"
      : variant === "outline"
      ? "bg-white dark:bg-neutral-900 hover:bg-orange-50 dark:hover:bg-orange-500/10 text-orange-500 border-orange-500"
      : "bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 border-neutral-300 dark:border-neutral-700";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-left p-4 rounded-xl border-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${styles}`}
    >
      <p className="text-sm font-bold">{loading ? "Working..." : title}</p>
      <p className="text-xs mt-0.5 opacity-80">{subtitle}</p>
    </button>
  );
}
```

---

## Task 10: ProfilePage — new file

**Files:** Create `frontend/src/pages/ProfilePage.tsx`

(Implementation code is sizable — written inline during execution. Key elements: header with editable display name, two tabs, table rows with action buttons, re-trigger via POST /builds/:id/analyze, rename via POST /builds/:id/rename, delete via POST /builds/:id/delete and /benchmarks/:id/delete.)

---

## Task 11: AnalysisPage — accept selectedBuildId prop

**Files:** `frontend/src/pages/AnalysisPage.tsx`

- [ ] **Step 1: Update signature**

```typescript
export default function AnalysisPage({ selectedBuildId: initialBuildId }: { selectedBuildId?: string } = {}) {
```

- [ ] **Step 2: Initialize state with prop**

```typescript
const [selectedBuildId, setSelectedBuildId] = useState<string | null>(initialBuildId ?? null);
```

- [ ] **Step 3: Update first useEffect's auto-select to respect the prop**

```typescript
setSelectedBuildId((prev) => prev ?? initialBuildId ?? buildsList[0]?.id ?? null);
```

---

## Task 12: Smoke test + commit

- [ ] **Step 1: Verify all backend services are reachable post-deploy**

```bash
echo "=== Service URLs ==="; \
gcloud run services list --project=csc323-final --format='value(metadata.name,status.url)' 2>&1; \
echo ""; \
echo "=== Gateway 401 sanity ==="; \
for path in '/parts?category=cpu' '/builds' '/builds/x/analyze' '/builds/x/rename' '/builds/x/delete' '/benchmarks/x/delete'; do \
  url="https://forgespec-gateway-d8ibwq8j.uc.gateway.dev$path"; \
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$url"); \
  echo "  $path -> $code"; \
done
```

Expected: every path returns 401 (missing auth).

- [ ] **Step 2: Stage and commit all changes**

```bash
cd ~/dev/school/csc323/Forgespec && git add -A && git status
```

Then commit in logical groups (multiple commits OK):

```bash
git commit -m "feat(backend): build-api accepts buildName + analyses; new analyze/rename/delete endpoints"
git commit -m "feat(backend): benchmark-api delete endpoint"
git commit -m "feat(backend): analyzers gate on requestedAnalyses field"
git commit -m "feat(infra): gateway v4 adds analyze/rename/delete tunnel routes"
git commit -m "feat(frontend): wattage + compatibility helper modules"
git commit -m "feat(frontend): builder gains build-name input, sticky compat banner, table layout"
git commit -m "feat(frontend): PostFinalizePage with 4 action buttons"
git commit -m "feat(frontend): ProfilePage with edit/delete/re-trigger"
git commit -m "feat(frontend): App routing supports profile + post-finalize"
```

(Single squashed commit also acceptable if 1Password agent is finicky.)

---

## Self-Review

**Spec coverage:**
- Build naming: Task 2 (server validation) + Task 8 (UI input) ✓
- Post-finalize 4-button screen: Task 9 ✓
- Profile read-only history: Task 10 ✓
- Profile edit/delete/re-trigger: Tasks 2, 3, 5, 10 ✓
- Compatibility/wattage banner: Task 1 + Task 8 ✓
- Table layout PCPP-style: Task 8 ✓
- Pub/Sub fan-out preserved: Task 2 + Task 4 (analyzers gate without dropping subscription) ✓
- Back-compat for old builds: Task 4 (legacy = full processing) ✓

**Placeholder scan:** Tasks 8 and 10 have "Implementation code is large — written inline during execution" as a deliberate compression. Mitigated by detailed prop/state/import lists. Acceptable in a fast-iteration plan.

**Type consistency:**
- `requestedAnalyses` is the canonical field name across build-api, analyzers, and frontend ✓
- `analyses` is the request-body field name on POST /builds; renamed to `types` on POST /:id/analyze (deliberate — different semantic: "for this NEW save" vs "add THESE to existing") ✓
- `Issue` type defined in compatibility.ts; consumed by BuilderPage banner ✓

**Risks revisited:**
- Building a 700-line BuilderPage in one shot is risky — mitigation: write the new file in pieces (banner → tables → form), verify each compiles before next.
- API Gateway config v4 deploy can fail if YAML has syntax errors — mitigation: paste tasks 5 carefully, validate locally with `yamllint` if available.
- Old PostFinalize build navigation requires App.tsx prop drilling — mitigation: minimal context shape, no Redux needed.

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-25-pcpp-redesign.md`.**
