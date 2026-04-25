# Forgespec Final Project Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every gap between the deployed Forgespec system and the Technical Project Charter / Final Project Rubric so the project earns full marks (100/100).

**Architecture:** Most of the GCP architecture is already deployed (API Gateway, Pub/Sub fan-out, Eventarc trigger, three Gemini Cloud Run analyzers, custom SAs, Secret Manager, Cloud Scheduler, Firestore + 8 indexes on `parts`). Remaining work is targeted: fix one default-SA violation, add atomic increments + builds/benchmarks composite indexes, deploy proper Firestore rules, finish two frontend pages (BenchmarkPage upload flow + AnalysisPage real-time listener), and populate the infra docs that were left empty.

**Tech Stack:** Node.js 18 / Express on Cloud Run, Firebase Auth + Firestore (client + admin), Pub/Sub, Eventarc, Cloud Storage, Secret Manager, Cloud Scheduler, React 18 + TypeScript + Tailwind, gcloud CLI, firebase CLI.

**Reference Docs:**
- Technical Project Charter (sections 2-4 for cluster mappings)
- Final Project Assignment rubric (IAM/Identity 20, Edge 20, Events 20, Intelligence 15, DB 15, Video/UI 10)
- README.md (canonical schema and flow descriptions)

**Branch Strategy:** All work on `cluster2` (active branch). Each task ends with a commit. Final merge to `main` after end-to-end verification.

---

## File Map

**Modify (existing files):**
- `services/build-api/index.js` — add `FieldValue.increment(1)` for `metrics/global.totalBuildsFinalized`
- `services/bottleneck-analyzer/index.js` — add `FieldValue.increment(1)` for `metrics/global.totalBottleneckAnalyses`
- `services/value-optimizer/index.js` — add `FieldValue.increment(1)` for `metrics/global.totalValueOptimizations`
- `services/benchmark-analyzer/index.js` — add `FieldValue.increment(1)` for `metrics/global.totalBenchmarksAnalyzed`
- `scripts/firestore.rules` — replace deny-all with UID-scoped rules
- `infra/firestore.indexes.json` — populate with parts/builds/benchmarks composite indexes
- `infra/service-accounts.csv` — populate canonical SA → role mapping
- `frontend/src/pages/BenchmarkPage.tsx` — add POST `/benchmarks` upload + Firestore `onSnapshot` listener
- `frontend/src/pages/AnalysisPage.tsx` — convert `getDocs` → `onSnapshot`
- `scripts/package.json` (already has firebase-tools, no change unless missing)

**Create:** None.

**Deploy/configure (no file changes — gcloud + firebase CLI):**
- New `sa-parts-api` service account
- Redeploy `parts-api` Cloud Run with `sa-parts-api`
- Deploy new composite indexes via `firebase deploy --only firestore:indexes`
- Deploy new Firestore rules via `firebase deploy --only firestore:rules`
- Redeploy four backend services (build-api, bottleneck-analyzer, value-optimizer, benchmark-analyzer) with the new increment code
- Grant `roles/datastore.user` to all four SAs (already have it; verify only)

---

## Task 1: Fix `parts-api` default service account violation

**Why:** Rubric "IAM & Identity (20 pts)" — explicit zero-tolerance for default compute SAs. Currently `parts-api` runs as `1037256785875-compute@developer.gserviceaccount.com`. This is the single biggest grading risk.

**Files:** None modified — pure GCP infra.

- [ ] **Step 1: Create `sa-parts-api` service account**

```bash
gcloud iam service-accounts create sa-parts-api \
  --display-name="Parts API Service Account" \
  --project=csc323-final
```

Expected: `Created service account [sa-parts-api]`.

- [ ] **Step 2: Grant Firestore read access**

```bash
gcloud projects add-iam-policy-binding csc323-final \
  --member="serviceAccount:sa-parts-api@csc323-final.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

- [ ] **Step 3: Allow API Gateway SA to invoke parts-api**

```bash
gcloud run services add-iam-policy-binding parts-api \
  --member="serviceAccount:sa-api-gateway@csc323-final.iam.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --region=us-central1 \
  --project=csc323-final
```

- [ ] **Step 4: Redeploy parts-api with the new SA**

```bash
cd ~/dev/school/csc323/Forgespec/services/parts-api && \
gcloud run deploy parts-api \
  --source=. \
  --region=us-central1 \
  --project=csc323-final \
  --service-account=sa-parts-api@csc323-final.iam.gserviceaccount.com \
  --allow-unauthenticated
```

- [ ] **Step 5: Verify the deployment uses the custom SA**

```bash
gcloud run services describe parts-api \
  --project=csc323-final --region=us-central1 \
  --format='value(spec.template.spec.serviceAccountName)'
```

Expected: `sa-parts-api@csc323-final.iam.gserviceaccount.com`

- [ ] **Step 6: Smoke-test the endpoint via the gateway**

```bash
# Should return parts data (after auth) — we'll do real auth tests in Task 9
curl -s "https://forgespec-gateway-d8ibwq8j.uc.gateway.dev/parts?category=cpu" -H "x-api-key: invalid" | head -c 200
```

Expected: `401` JSON (gateway rejects without valid JWT/key) — confirms gateway is still routing.

- [ ] **Step 7: Commit**

```bash
cd ~/dev/school/csc323/Forgespec && \
git add -A && git commit -m "infra: replace parts-api default compute SA with custom sa-parts-api"
```

---

## Task 2: Add atomic increments to all four AI services

**Why:** Charter §5 Persistence — "Atomic increments via FieldValue.increment() safely update the total builds analyzed counter under concurrent load." Rubric "Database & Scaling (15 pts)" requires atomic increment. Currently zero `FieldValue.increment` calls exist in code.

**Files:** `services/build-api/index.js`, `services/bottleneck-analyzer/index.js`, `services/value-optimizer/index.js`, `services/benchmark-analyzer/index.js`

- [ ] **Step 1: Modify `services/build-api/index.js` — import FieldValue**

Replace line 3 (`const { Firestore } = require("@google-cloud/firestore");`) with:

```javascript
const { Firestore, FieldValue } = require("@google-cloud/firestore");
```

- [ ] **Step 2: Increment counter after build write in `services/build-api/index.js`**

In the POST `/builds` handler, immediately after `await firestore.collection("users").doc(userId).collection("builds").doc(buildId).set(buildData);`, add:

```javascript
    // Atomic increment of platform-wide counter (safe under concurrent load)
    await firestore.collection("metrics").doc("global").set(
      { totalBuildsFinalized: FieldValue.increment(1) },
      { merge: true }
    );
```

- [ ] **Step 3: Modify `services/bottleneck-analyzer/index.js` — import FieldValue**

Same edit: `const { Firestore, FieldValue } = require("@google-cloud/firestore");`

- [ ] **Step 4: Increment counter after analysis write in bottleneck-analyzer**

Immediately after `await firestore.collection("users").doc(userId).collection("builds").doc(buildId).collection("assessments").doc("bottleneck").set({...});`, add:

```javascript
    await firestore.collection("metrics").doc("global").set(
      { totalBottleneckAnalyses: FieldValue.increment(1) },
      { merge: true }
    );
```

- [ ] **Step 5: Modify `services/value-optimizer/index.js` — same import + increment**

Import: `const { Firestore, FieldValue } = require("@google-cloud/firestore");`

After `optimization.set({...})`:

```javascript
    await firestore.collection("metrics").doc("global").set(
      { totalValueOptimizations: FieldValue.increment(1) },
      { merge: true }
    );
```

- [ ] **Step 6: Modify `services/benchmark-analyzer/index.js` — same import + increment**

Import: `const { Firestore, FieldValue } = require("@google-cloud/firestore");`

After `await Promise.all(writePromises);`, add:

```javascript
    await firestore.collection("metrics").doc("global").set(
      { totalBenchmarksAnalyzed: FieldValue.increment(1) },
      { merge: true }
    );
```

- [ ] **Step 7: Redeploy all four services**

```bash
cd ~/dev/school/csc323/Forgespec/services/build-api && \
gcloud run deploy build-api --source=. --region=us-central1 --project=csc323-final \
  --service-account=sa-build-api@csc323-final.iam.gserviceaccount.com --allow-unauthenticated && \
cd ../bottleneck-analyzer && \
gcloud run deploy bottleneck-analyzer --source=. --region=us-central1 --project=csc323-final \
  --service-account=sa-bottleneck-analyzer@csc323-final.iam.gserviceaccount.com --no-allow-unauthenticated && \
cd ../value-optimizer && \
gcloud run deploy value-optimizer --source=. --region=us-central1 --project=csc323-final \
  --service-account=sa-value-optimizer@csc323-final.iam.gserviceaccount.com --no-allow-unauthenticated && \
cd ../benchmark-analyzer && \
gcloud run deploy benchmark-analyzer --source=. --region=us-central1 --project=csc323-final \
  --service-account=sa-benchmark-analyzer@csc323-final.iam.gserviceaccount.com --no-allow-unauthenticated
```

- [ ] **Step 8: Verify the metrics document gets created on next build (deferred to Task 9 E2E)**

- [ ] **Step 9: Commit**

```bash
cd ~/dev/school/csc323/Forgespec && \
git add services/build-api/index.js services/bottleneck-analyzer/index.js services/value-optimizer/index.js services/benchmark-analyzer/index.js && \
git commit -m "feat(metrics): add FieldValue.increment for global counters in all four pipeline services"
```

---

## Task 3: Add composite indexes for `builds` and `benchmarks`

**Why:** Charter §5 — "A composite index on (uid, createdAt DESC) in the builds collection supports the dashboard listing query. A composite index on (uid, uploadedAt DESC) in the benchmarks collection supports benchmark history queries." Currently 8 indexes deployed but ALL on `parts` collection — none on `builds` or `benchmarks`.

**Note:** Builds/benchmarks live as subcollections under `users/{uid}`. For collection-group queries, Firestore needs `queryScope: COLLECTION_GROUP`. We'll add both COLLECTION (for per-user) and COLLECTION_GROUP indexes.

**Files:** `infra/firestore.indexes.json` (currently empty), `scripts/firestore.indexes.json` (canonical for firebase deploy)

- [ ] **Step 1: Inspect current `scripts/firestore.indexes.json`**

```bash
cat ~/dev/school/csc323/Forgespec/scripts/firestore.indexes.json
```

- [ ] **Step 2: Write the unified indexes file to `scripts/firestore.indexes.json`**

```json
{
  "indexes": [
    {
      "collectionGroup": "parts",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "partType", "order": "ASCENDING" },
        { "fieldPath": "price", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "parts",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "partType", "order": "ASCENDING" },
        { "fieldPath": "inStock", "order": "ASCENDING" },
        { "fieldPath": "price", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "parts",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "partType", "order": "ASCENDING" },
        { "fieldPath": "searchName", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "builds",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "builds",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "benchmarks",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "benchmarks",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

- [ ] **Step 3: Mirror the file to `infra/firestore.indexes.json` (canonical doc artifact)**

```bash
cp ~/dev/school/csc323/Forgespec/scripts/firestore.indexes.json ~/dev/school/csc323/Forgespec/infra/firestore.indexes.json
```

- [ ] **Step 4: Deploy indexes via firebase CLI**

```bash
cd ~/dev/school/csc323/Forgespec/scripts && \
npx firebase deploy --only firestore:indexes --project=csc323-final
```

Expected: New indexes show "Creating" then "READY" (may take 1-3 minutes per index).

- [ ] **Step 5: Verify deployment**

```bash
gcloud firestore indexes composite list --project=csc323-final --format='value(name,collectionGroup,fields[].fieldPath)' | head -20
```

Expected: builds and benchmarks rows present.

- [ ] **Step 6: Commit**

```bash
cd ~/dev/school/csc323/Forgespec && \
git add scripts/firestore.indexes.json infra/firestore.indexes.json && \
git commit -m "feat(firestore): add composite indexes for builds and benchmarks per charter"
```

---

## Task 4: Deploy proper Firestore security rules

**Why:** Charter §4 — "Firestore security rules also enforce that users can only read and write documents whose UID field matches their authenticated identity." Current `scripts/firestore.rules` is `allow read, write: if false` (deny-all), which (a) blocks AnalysisPage from reading directly via client SDK and (b) misses the rubric requirement.

**Files:** `scripts/firestore.rules`

- [ ] **Step 1: Replace `scripts/firestore.rules` content**

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // Parts catalog: read-only to all authenticated users; only refresh-parts SA writes (it bypasses rules via Admin SDK).
    match /parts/{partId} {
      allow read: if request.auth != null;
      allow write: if false;
    }

    // User-scoped builds and their assessment subcollections.
    match /users/{uid}/builds/{buildId} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow create: if request.auth != null && request.auth.uid == uid;
      allow update, delete: if request.auth != null && request.auth.uid == uid;

      match /assessments/{assessmentId} {
        allow read: if request.auth != null && request.auth.uid == uid;
        // Writes happen server-side via Admin SDK (bypasses rules); deny client writes.
        allow write: if false;
      }
    }

    // User-scoped benchmarks.
    match /users/{uid}/benchmarks/{benchmarkId} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow create: if request.auth != null && request.auth.uid == uid;
      allow update, delete: if request.auth != null && request.auth.uid == uid;

      match /assessments/{assessmentId} {
        allow read: if request.auth != null && request.auth.uid == uid;
        allow write: if false;
      }
    }

    // Platform-wide metrics: readable by any authenticated user (e.g. for dashboards); only services write.
    match /metrics/{docId} {
      allow read: if request.auth != null;
      allow write: if false;
    }

    // Default deny.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 2: Deploy rules via firebase CLI**

```bash
cd ~/dev/school/csc323/Forgespec/scripts && \
npx firebase deploy --only firestore:rules --project=csc323-final
```

Expected: `✔ Deploy complete!`

- [ ] **Step 3: Sanity check via Firestore emulator-style read (web client) — deferred to Task 9**

- [ ] **Step 4: Commit**

```bash
cd ~/dev/school/csc323/Forgespec && \
git add scripts/firestore.rules && \
git commit -m "feat(security): replace deny-all rules with UID-scoped per-user rules"
```

---

## Task 5: Wire `BenchmarkPage` to upload + real-time results

**Why:** Charter Cluster 6 — "Benchmark Upload view (drag-and-drop screenshot upload, real-time processing status via Firestore onSnapshot listener, and final comparison result)." Currently the page has only a file picker; no upload, no listener, no results display.

**Files:** `frontend/src/pages/BenchmarkPage.tsx`

- [ ] **Step 1: Read the existing file to confirm its current shape**

```bash
wc -l ~/dev/school/csc323/Forgespec/frontend/src/pages/BenchmarkPage.tsx
```

Expected: 177 lines (UI only, no fetch/onSnapshot).

- [ ] **Step 2: Replace the file with the integrated version**

Full new content (matches the project's existing Tailwind aesthetic and JWT pattern from BuilderPage):

```tsx
import { useState, useRef, useEffect } from "react";
import { onSnapshot, doc, collection, getDocs, query, orderBy, limit } from "firebase/firestore";
import { auth, db } from "../firebase";

function gatewayBase(): string | null {
  const base = process.env.REACT_APP_GATEWAY_URL?.replace(/\/$/, "") ?? "";
  return base || null;
}

interface BenchmarkDoc {
  benchmarkId: string;
  status: string;
  buildId?: string;
  benchmarkMetrics?: any;
  buildComparison?: any;
}

interface BuildOption {
  id: string;
  buildName?: string;
  totalPrice?: number;
}

export default function BenchmarkPage() {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [builds, setBuilds] = useState<BuildOption[]>([]);
  const [selectedBuildId, setSelectedBuildId] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [activeBenchmarkId, setActiveBenchmarkId] = useState<string | null>(null);
  const [benchmarkDoc, setBenchmarkDoc] = useState<BenchmarkDoc | null>(null);

  // Load user's existing builds for the dropdown.
  useEffect(() => {
    async function loadBuilds() {
      const user = auth.currentUser;
      if (!user) return;
      try {
        const buildsRef = collection(db, "users", user.uid, "builds");
        const q = query(buildsRef, orderBy("createdAt", "desc"), limit(20));
        const snap = await getDocs(q);
        const list: BuildOption[] = snap.docs.map((d) => ({
          id: d.id,
          buildName: d.data().buildName,
          totalPrice: d.data().totalPrice,
        }));
        setBuilds(list);
        if (list.length > 0) setSelectedBuildId(list[0].id);
      } catch (err) {
        console.error("Failed to load builds:", err);
      }
    }
    loadBuilds();
  }, []);

  // Real-time listener for the active benchmark.
  useEffect(() => {
    if (!activeBenchmarkId) return;
    const user = auth.currentUser;
    if (!user) return;
    const ref = doc(db, "users", user.uid, "benchmarks", activeBenchmarkId);
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        setBenchmarkDoc({ benchmarkId: snap.id, ...(snap.data() as any) });
      }
    });
    return unsub;
  }, [activeBenchmarkId]);

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);
    setUploadError(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const clearFile = () => {
    setSelectedFile(null);
    setPreview(null);
    setActiveBenchmarkId(null);
    setBenchmarkDoc(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const upload = async () => {
    if (!selectedFile) return;
    if (!selectedBuildId) {
      setUploadError("Select a build first (Builder page).");
      return;
    }
    const base = gatewayBase();
    if (!base) {
      setUploadError("REACT_APP_GATEWAY_URL is not set.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const token = await auth.currentUser!.getIdToken();
      const formData = new FormData();
      formData.append("file", selectedFile);
      const res = await fetch(`${base}/benchmarks?buildId=${encodeURIComponent(selectedBuildId)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Upload failed (${res.status}): ${text}`);
      }
      const json = await res.json();
      setActiveBenchmarkId(json.benchmarkId);
    } catch (err: any) {
      setUploadError(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const status = benchmarkDoc?.benchmarkMetrics ? "Complete" : benchmarkDoc ? "Analyzing" : null;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100 tracking-tight">
        Benchmark Upload
      </h1>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 mb-8 max-w-lg">
        Upload a screenshot from any benchmark tool and the AI compares your real-world scores against expected results for your hardware.
      </p>

      {/* Build selector */}
      <div className="mb-6">
        <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1">
          Associated Build
        </label>
        <select
          value={selectedBuildId}
          onChange={(e) => setSelectedBuildId(e.target.value)}
          className="w-full px-3 py-2 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm"
        >
          {builds.length === 0 && <option value="">No builds yet — finalize a build first</option>}
          {builds.map((b) => (
            <option key={b.id} value={b.id}>
              {b.buildName || b.id} {b.totalPrice ? `($${b.totalPrice})` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-12 text-center transition-colors ${
          dragOver ? "border-orange-500 bg-orange-500/5" : "border-neutral-300 dark:border-neutral-700"
        }`}
      >
        {preview ? (
          <img src={preview} alt="preview" className="mx-auto max-h-64 rounded-md" />
        ) : (
          <>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Drag a screenshot here or click to browse
            </p>
            <p className="text-xs text-neutral-400 mt-2">PNG / JPG up to ~10MB</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </div>

      {selectedFile && (
        <div className="mt-4 flex gap-3">
          <button
            onClick={upload}
            disabled={uploading || !selectedBuildId}
            className="px-4 py-2 rounded-md bg-orange-500 text-white text-sm font-medium disabled:opacity-50 hover:bg-orange-600"
          >
            {uploading ? "Uploading..." : "Analyze Benchmark"}
          </button>
          <button
            onClick={clearFile}
            className="px-4 py-2 rounded-md border border-neutral-300 dark:border-neutral-700 text-sm"
          >
            Clear
          </button>
        </div>
      )}

      {uploadError && (
        <div className="mt-4 rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
          {uploadError}
        </div>
      )}

      {/* Real-time status + result */}
      {status && (
        <div className="mt-8 rounded-lg border border-neutral-200 dark:border-neutral-800 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-2 h-2 rounded-full ${status === "Complete" ? "bg-green-500" : "bg-orange-500 animate-pulse"}`} />
            <span className="text-sm font-medium">{status}</span>
          </div>
          {benchmarkDoc?.benchmarkMetrics && (
            <pre className="text-xs bg-neutral-50 dark:bg-neutral-900 p-3 rounded overflow-auto max-h-96">
              {JSON.stringify(benchmarkDoc.benchmarkMetrics, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run TypeScript check (no compile errors)**

```bash
cd ~/dev/school/csc323/Forgespec/frontend && npx tsc --noEmit
```

Expected: No errors. (If `firebase/firestore` collection helpers aren't already used, the import is correct.)

- [ ] **Step 4: Commit**

```bash
cd ~/dev/school/csc323/Forgespec && \
git add frontend/src/pages/BenchmarkPage.tsx && \
git commit -m "feat(frontend): wire BenchmarkPage to POST /benchmarks with onSnapshot listener"
```

---

## Task 6: Convert `AnalysisPage` from `getDocs` to `onSnapshot`

**Why:** Charter §4 — "frontend onSnapshot listener updates UI" (real-time updates as Gemini writes results back). Current AnalysisPage uses one-shot `getDocs`, so users have to refresh to see analysis results — defeats the entire async pipeline UX.

**Files:** `frontend/src/pages/AnalysisPage.tsx`

- [ ] **Step 1: Read full current file to know the existing shape**

```bash
cat ~/dev/school/csc323/Forgespec/frontend/src/pages/AnalysisPage.tsx | head -80
```

- [ ] **Step 2: Modify the import (line 3) to add `onSnapshot, query, orderBy, doc`**

Replace:
```typescript
import { collection, getDocs } from "firebase/firestore";
```
with:
```typescript
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";
```

- [ ] **Step 3: Replace the `useEffect` and `fetchBuilds` block (lines 27-65 approx) with a real-time subscription**

Find the existing block:
```typescript
  useEffect(() => {
    fetchBuilds();
  }, []);

  async function fetchBuilds() {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const buildsRef = collection(db, "users", user.uid, "builds");
      const snapshot = await getDocs(buildsRef);
      ...
```

Replace with:
```typescript
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }

    const buildsRef = collection(db, "users", user.uid, "builds");
    const q = query(buildsRef, orderBy("createdAt", "desc"));

    // Real-time listener: top-level builds list.
    const unsubBuilds = onSnapshot(q, (snapshot) => {
      const buildsList: Build[] = snapshot.docs.map((d) => ({
        id: d.id,
        parts: d.data().parts,
        totalPrice: d.data().totalPrice,
      }));
      setBuilds(buildsList);
      setLoading(false);
      if (!selectedBuildId && buildsList.length > 0) {
        setSelectedBuildId(buildsList[0].id);
      }
    });

    return unsubBuilds;
  }, []);

  // Listen for assessments on the selected build.
  useEffect(() => {
    const user = auth.currentUser;
    if (!user || !selectedBuildId) return;

    const assessmentsRef = collection(
      db,
      "users",
      user.uid,
      "builds",
      selectedBuildId,
      "assessments"
    );

    const unsub = onSnapshot(assessmentsRef, (snap) => {
      const assessments: Record<string, AssessmentData> = {};
      snap.docs.forEach((d) => {
        assessments[d.id] = d.data();
      });
      setBuilds((prev) =>
        prev.map((b) =>
          b.id === selectedBuildId
            ? {
                ...b,
                bottleneckAnalysis: assessments.bottleneck,
                valueOptimization: assessments.optimization,
              }
            : b
        )
      );
    });

    return unsub;
  }, [selectedBuildId]);
```

- [ ] **Step 4: Remove the old `fetchBuilds` function entirely (it's no longer called)**

The block starting `async function fetchBuilds() {` through its closing `}` should be deleted.

- [ ] **Step 5: TypeScript check**

```bash
cd ~/dev/school/csc323/Forgespec/frontend && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
cd ~/dev/school/csc323/Forgespec && \
git add frontend/src/pages/AnalysisPage.tsx && \
git commit -m "feat(frontend): replace getDocs with onSnapshot for real-time analysis updates"
```

---

## Task 7: Populate empty `infra/` documentation files

**Why:** Both `infra/firestore.indexes.json` and `infra/service-accounts.csv` are empty files committed to the repo. The Charter §3 promises "Service accounts (full CSV to be attached)" — these are the canonical documentation artifacts.

**Files:** `infra/service-accounts.csv` (and `infra/firestore.indexes.json` was already populated in Task 3 Step 3)

- [ ] **Step 1: Write the canonical service accounts CSV to `infra/service-accounts.csv`**

```csv
service_account_email,display_name,roles,used_by,purpose
sa-api-gateway@csc323-final.iam.gserviceaccount.com,API Gateway invoker,roles/run.invoker,API Gateway,Invokes Cloud Run services behind API Gateway
sa-build-api@csc323-final.iam.gserviceaccount.com,Build API Service Account,roles/datastore.user;roles/pubsub.publisher;roles/storage.objectViewer,build-api Cloud Run,Reads/writes Firestore builds and metrics; publishes to builds-finalized Pub/Sub topic
sa-benchmark-api@csc323-final.iam.gserviceaccount.com,Benchmark API Service Account,roles/datastore.user;roles/storage.objectAdmin,benchmark-api Cloud Run,Reads/writes Firestore benchmarks; uploads files to forgespec-benchmarks bucket
sa-bottleneck-analyzer@csc323-final.iam.gserviceaccount.com,Bottleneck Analyzer Service Account,roles/datastore.user;roles/secretmanager.secretAccessor,bottleneck-analyzer Cloud Run,Reads Firestore builds; reads google-ai-api-key secret; calls Gemini; writes bottleneck assessments and metrics
sa-benchmark-analyzer@csc323-final.iam.gserviceaccount.com,Benchmark Analyzer Service Account,roles/datastore.user;roles/secretmanager.secretAccessor;roles/storage.objectViewer,benchmark-analyzer Cloud Run,Reads Cloud Storage benchmark images; reads google-ai-api-key secret; calls Gemini Vision; writes benchmark assessments and metrics
sa-value-optimizer@csc323-final.iam.gserviceaccount.com,Value Optimizer Service Account,roles/datastore.user;roles/secretmanager.secretAccessor,value-optimizer Cloud Run,Reads Firestore parts and builds; reads google-ai-api-key secret; calls Gemini; writes optimization assessments and metrics
sa-refresh-parts@csc323-final.iam.gserviceaccount.com,refresh-parts scraper,roles/datastore.user;roles/secretmanager.secretAccessor,refresh-parts Cloud Function,Cloud Scheduler invoker; scrapes part pricing; upserts parts collection nightly
sa-parts-api@csc323-final.iam.gserviceaccount.com,Parts API Service Account,roles/datastore.user,parts-api Cloud Run,Reads Firestore parts catalog for /parts endpoint
eventarc-trigger-sa@csc323-final.iam.gserviceaccount.com,Eventarc Trigger Service Account,roles/eventarc.eventReceiver;roles/run.invoker,Eventarc benchmark-upload-trigger,Receives Cloud Storage events and invokes benchmark-analyzer
```

- [ ] **Step 2: Commit**

```bash
cd ~/dev/school/csc323/Forgespec && \
git add infra/service-accounts.csv infra/firestore.indexes.json && \
git commit -m "docs(infra): populate canonical service-accounts.csv and firestore.indexes.json"
```

---

## Task 8: Verify Firestore SA permissions for new metrics writes

**Why:** Each AI service now writes to `metrics/global`. They already have `roles/datastore.user` (which includes write), but verify before hitting prod.

**Files:** None.

- [ ] **Step 1: Verify each SA has datastore.user**

```bash
for sa in sa-build-api sa-bottleneck-analyzer sa-value-optimizer sa-benchmark-analyzer; do
  echo "=== $sa ==="
  gcloud projects get-iam-policy csc323-final \
    --flatten="bindings[].members" \
    --filter="bindings.members:serviceAccount:$sa@csc323-final.iam.gserviceaccount.com" \
    --format='value(bindings.role)' 2>&1
done
```

Expected: each SA shows `roles/datastore.user` (or stronger). If any is missing, run:

```bash
gcloud projects add-iam-policy-binding csc323-final \
  --member="serviceAccount:<MISSING_SA>@csc323-final.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

- [ ] **Step 2: No commit needed** (this is verification only)

---

## Task 9: End-to-end smoke test

**Why:** Verification-before-completion — prove the full Charter-described flow works before declaring done.

**Files:** None — runtime checks only.

- [ ] **Step 1: Start the frontend locally**

```bash
cd ~/dev/school/csc323/Forgespec/frontend && npm start
```

Wait for "Compiled successfully" and browser opens to `http://localhost:3000`.

- [ ] **Step 2: Auth flow — sign up or log in**

Click "Sign in with Google" or use email/password. Verify navbar shows authenticated state.

- [ ] **Step 3: Builder flow — create a build**

Pick at least CPU + GPU + RAM. Click "Finalize Build". Note the buildId returned.

- [ ] **Step 4: Verify Firestore writes**

Check logs:
```bash
gcloud logging read "resource.type=cloud_run_revision AND (resource.labels.service_name=build-api OR resource.labels.service_name=bottleneck-analyzer OR resource.labels.service_name=value-optimizer)" \
  --project=csc323-final --limit=20 --format='value(textPayload)' --freshness=10m
```

Expected: `Build <id> created and published to Pub/Sub` then `Bottleneck analysis completed` and `Value optimization completed`.

- [ ] **Step 5: Verify atomic increment landed**

Console-inspect the Firestore `metrics/global` doc via the Firebase console (https://console.firebase.google.com/project/csc323-final/firestore/data/metrics/global). Expect: `totalBuildsFinalized >= 1`, `totalBottleneckAnalyses >= 1`, `totalValueOptimizations >= 1`.

- [ ] **Step 6: Analysis page — verify real-time results**

Navigate to Analysis tab. Expected: build appears live; assessment fields populate without page refresh as analyzers finish.

- [ ] **Step 7: Benchmark flow — upload image, watch it flow**

Navigate to Benchmark tab. Pick a benchmark screenshot. Click "Analyze Benchmark". Expected: status indicator goes from "Analyzing" to "Complete" within ~30 seconds; metrics JSON renders.

- [ ] **Step 8: Verify benchmark increment**

Re-check `metrics/global`: `totalBenchmarksAnalyzed >= 1`.

- [ ] **Step 9: Negative auth test**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://forgespec-gateway-d8ibwq8j.uc.gateway.dev/parts?category=cpu"
```

Expected: `401` (no JWT, no API key).

- [ ] **Step 10: Verify parts-api custom SA**

```bash
gcloud run services describe parts-api --project=csc323-final --region=us-central1 \
  --format='value(spec.template.spec.serviceAccountName)'
```

Expected: `sa-parts-api@csc323-final.iam.gserviceaccount.com`.

---

## Task 10: Final rubric self-check

**Why:** Confirm every rubric criterion is met before considering complete.

**Files:** None — checklist only.

- [ ] **IAM & Identity (20 pts):** Every Cloud Run service uses a custom SA. Verify with:
  ```bash
  gcloud run services list --project=csc323-final --format='value(metadata.name,spec.template.spec.serviceAccountName)'
  ```
  Expected: zero rows containing `compute@developer`.

- [ ] **Edge Security (20 pts):** API Gateway validates Firebase JWT (config v3 ACTIVE) + Secret Manager holds all keys (`google-ai-api-key`, `firebase-admin-sdk`, etc.); no hardcoded keys in any service `index.js`. Spot-check via:
  ```bash
  grep -r "AIza\|api_key" ~/dev/school/csc323/Forgespec/services/*/index.js
  ```
  Expected: zero matches.

- [ ] **Event Orchestration (20 pts):** Pub/Sub fan-out (`builds-finalized` → 2 subs) ✓; Eventarc trigger ACTIVE ✓; idempotency guards in all three analyzers ✓ (skip-if-assessment-exists pattern). Confirm:
  ```bash
  gcloud pubsub subscriptions list --project=csc323-final --format='value(name,topic)' | grep builds-finalized
  ```

- [ ] **Intelligence Logic (15 pts):** All three analyzers call Gemini with structured-JSON prompts and parse JSON via regex match. ✓ (already in code — no further work needed).

- [ ] **Database & Scaling (15 pts):** Atomic increments in 4 services ✓ (Task 2); composite indexes deployed for parts + builds + benchmarks ✓ (Task 3). Verify final state:
  ```bash
  gcloud firestore indexes composite list --project=csc323-final --format='value(collectionGroup)' | sort -u
  ```
  Expected: `parts`, `builds`, `benchmarks`.

- [ ] **Video & UI Polish (10 pts):** Builder + Analysis (onSnapshot) + Benchmark (POST + onSnapshot) all wired. Demo video shows: auth → build → live analysis → benchmark upload → live result → 401 reject.

---

## Task 11: Demo video shot list (manual — for the user)

**Why:** Final Project Update 2 + 3 require video proof. Project timeline (Charter §5) puts demo on 4/25/26.

**Sequence to record (5–7 minutes total):**

1. Open browser, hit frontend URL. Click "Sign in with Google" → land on Builder.
2. **(Show 401 test)** In a side terminal: `curl -i https://forgespec-gateway-d8ibwq8j.uc.gateway.dev/parts?category=cpu` → 401 Unauthorized. (Proves edge security.)
3. Builder: pick CPU, GPU, RAM, motherboard, PSU, case, storage. Click "Finalize Build".
4. **(Side terminal)** `gcloud logging tail "resource.type=cloud_run_revision"` to show Pub/Sub fan-out → bottleneck-analyzer + value-optimizer firing in parallel.
5. Switch to Analysis tab — show the build appearing and analysis fields populating live (no refresh).
6. Switch to Benchmark tab — upload a 3DMark/Cinebench screenshot → status indicator pulses → JSON metrics appear.
7. Open Firebase console → `metrics/global` doc → show counters increased.
8. Open API Gateway console → show `forgespec-api` config v3 ACTIVE with `securityDefinitions: firebase`.
9. Open Cloud Run → show all 7 services with custom SAs.
10. Open Cloud Scheduler → show `refresh-parts-nightly` ENABLED.

---

## Task 12: Final commit and merge to main

- [ ] **Step 1: Confirm working tree clean and tests/lint not broken**

```bash
cd ~/dev/school/csc323/Forgespec && git status && cd frontend && npx tsc --noEmit
```

- [ ] **Step 2: Push cluster2 to origin**

```bash
cd ~/dev/school/csc323/Forgespec && git push origin cluster2
```

- [ ] **Step 3: Open PR cluster2 → main (or fast-forward merge if appropriate)**

```bash
gh pr create --base main --head cluster2 --title "Final project completion: rubric gaps closed" --body "Closes IAM, increment, indexes, rules, and frontend integration gaps. See plan: docs/superpowers/plans/2026-04-25-final-project-completion.md"
```

- [ ] **Step 4: After merge, tag a release**

```bash
git checkout main && git pull && git tag -a v1.0-final -m "Final project submission" && git push origin v1.0-final
```

---

## Self-Review

**Spec coverage:**
- Rubric IAM (20): Task 1 + Task 7 + Task 10 verification ✓
- Rubric Edge (20): Already done; Task 10 verifies ✓
- Rubric Events (20): Already done; Task 10 verifies ✓
- Rubric Intelligence (15): Already done; Task 10 verifies ✓
- Rubric DB (15): Task 2 (increments) + Task 3 (indexes) + Task 10 verify ✓
- Rubric Video/UI (10): Task 5 (BenchmarkPage) + Task 6 (AnalysisPage onSnapshot) + Task 11 (video) ✓
- Charter Cluster 5 metrics/global: Task 2 ✓
- Charter Cluster 5 composite indexes for builds/benchmarks: Task 3 ✓
- Charter Cluster 4 Firestore rules UID enforcement: Task 4 ✓
- Charter Cluster 6 onSnapshot listeners: Tasks 5 + 6 ✓
- Charter Cluster 6 frontend on Cloud Run: NOT included — running locally for demo is acceptable per assignment ("serving a cloud run URL is perfectly fine. No need to have a custom domain") and the rubric doesn't mandate the frontend be on Cloud Run; it just needs to be functional and accessible. Demo will run from `npm start`. (Flag: if time permits, containerize and deploy.)

**Placeholder scan:** None remain. All code blocks are complete.

**Type consistency:** `BenchmarkDoc.benchmarkMetrics` and `BuildOption.id` are consistent across Tasks 5 and 6. Both pages import from the same `firebase` module path.

**Risks called out:**
- Task 3 deploy may take 1-3 minutes for indexes to build; safe to proceed with other tasks while waiting.
- Task 5: if `firestore.rules` haven't been deployed yet, `onSnapshot` reads will be denied. Run Task 4 before testing Task 5.
- Task 9 Step 7 requires a real benchmark screenshot — user should have one ready.
