# Forgespec UX Polish & Feature Expansion — Design Spec

**Date:** 2026-04-25
**Author:** Ryan Stoffel
**Status:** Approved (responses A / B / B / "do everything" with Run Both included)

## Goal

Add user-friendly build naming, an explicit post-finalize action selector, a profile/history page, and a PC-Part-Picker-style data density pass. Preserve the deployed Pub/Sub fan-out architecture so the existing rubric points (Cluster 2, Cluster 5) are not regressed.

## Decisions

| ID | Decision |
|---|---|
| Q1 | **Option A** — post-finalize screen offers exclusive actions (Run Bottleneck / Run Optimization / Save Only), plus an additional **Run Both** for demo-friendly fan-out |
| Q2 | **Option B** — Profile page = read-only history + display name edit + per-row rename/delete + re-trigger missing analyses |
| Q3 | **Option B** — Table-style data density + persistent compatibility/wattage/total banner; keep current orange/dark theme |

## Backend Changes

### `services/build-api`

**`POST /builds`** — extend body shape:

```ts
{
  buildName: string;       // REQUIRED, 1-80 chars, validated server-side
  parts: Record<string, any>;
  totalPrice?: number;
  analyses?: ("bottleneck" | "optimization")[];  // default []
}
```

Behavior:
1. Validate `buildName` length and that user has no existing build with the same name (cheap query — uses existing `userId+createdAt` index).
2. Write build doc with `requestedAnalyses: analyses ?? []`.
3. Always publish a Pub/Sub message containing `{ buildId, userId, requestedAnalyses }`. Fan-out preserved.
4. Return `202 { buildId, status: "Processing" | "Saved" }`.

**`POST /builds/:id/analyze`** — NEW. Body `{ types: ("bottleneck"|"optimization")[] }`.
1. UID-verify ownership.
2. Update `requestedAnalyses` to UNION of existing + new types.
3. Republish Pub/Sub message.
4. Return `202`.

**`PATCH /builds/:id`** — NEW. Body `{ buildName }`. UID-verify, update name only.

**`DELETE /builds/:id`** — NEW. UID-verify. Recursively delete: subcollection `assessments/*`, then build doc.

### `services/benchmark-api`

**`DELETE /benchmarks/:id`** — NEW. UID-verify. Delete Cloud Storage object at `<userId>/<benchmarkId>.jpg`, then Firestore doc.

### `services/bottleneck-analyzer` and `services/value-optimizer`

In the Pub/Sub handler, after fetching the build doc:

```js
const requested = buildData.requestedAnalyses;
// Backwards-compat: legacy builds (undefined or empty) get full processing.
if (Array.isArray(requested) && requested.length > 0 && !requested.includes("bottleneck")) {
  console.log(`Skip: bottleneck not requested for build ${buildId}`);
  return res.status(200).json({ ack: true });
}
```

Same pattern for value-optimizer with "optimization".

### `infra/api-gateway.yaml`

Add four operations:
- `POST /builds/{buildId}/analyze` → build-api
- `PATCH /builds/{buildId}` → build-api
- `DELETE /builds/{buildId}` → build-api
- `DELETE /benchmarks/{benchmarkId}` → benchmark-api

Plus matching `OPTIONS` entries for CORS.

## Frontend Changes

### Routing (App.tsx)

Extend `Page` union to include `"post-finalize"` and `"profile"`. Add `pageContext` state for `{ buildId?, selectedBuildId? }` payloads. Nav adds Profile (rightmost).

### `pages/BuilderPage.tsx`

- **Build name input** above parts area; required to enable Finalize.
- **Compatibility/wattage banner** (sticky just under the navbar) showing: status pill (`✓` / `⚠ N` / `✗ N`), estimated wattage, PSU headroom %, running total.
- **Build summary table** (above category tabs) — one row per part category with thumbnail, name, price, Edit, ×. Empty slots show "Choose a CPU…".
- **Parts list** (below category tabs) — converted from cards to a sortable table: Image | Name | Manufacturer | Key Specs | Price | + Add.
- **Finalize Build** button → calls `setPage("post-finalize", { buildName, parts, totalPrice })` (the actual POST happens on PostFinalizePage so the user can change their mind).

### `pages/PostFinalizePage.tsx` (NEW)

Centered card with:
- Build name (read-only)
- Total price + part count
- 2×2 grid of action buttons:
  - "Run Bottleneck Analysis" → POST /builds with `analyses: ["bottleneck"]`
  - "Run Value Optimization" → `analyses: ["optimization"]`
  - "Run Both Analyses" → `analyses: ["bottleneck","optimization"]` (demo-friendly fan-out)
  - "Save Without Analyzing" → `analyses: []`
- After successful POST: `setPage("analysis", { selectedBuildId: newBuildId })`.

### `pages/ProfilePage.tsx` (NEW)

- Header: avatar circle (first letter of email if no photoURL), editable display name (saves via `updateProfile()`), email read-only, sign-out button, counts ("X builds · Y benchmarks").
- Tabs: **My Builds** / **My Benchmarks**.
- Builds tab: table — name, parts count, total price, status badges (✓ Bottleneck / ✓ Optimization / Pending), created date, actions [Open · Rename · Delete · +Bottleneck · +Optimization]. Greyed-out re-trigger buttons if already complete.
- Benchmarks tab: table — file name, associated build, status, uploaded date, actions [Open · Delete].

### `pages/AnalysisPage.tsx`

- Accept optional `selectedBuildId` prop. On mount, prefer `selectedBuildId` over the first-build default.

### `pages/BenchmarkPage.tsx`

- Already updated; no changes here unless time permits adding a "history" panel (skip for now).

### Helpers (NEW)

`frontend/src/lib/wattage.ts`:

```ts
export interface PartLike { partType?: string; name?: string; specs?: any; }

const TDP_REGEX_TABLE: Array<[RegExp, number]> = [
  [/i9-?14|i9-?13|i9-?12|9950X|9900X/i, 170],
  [/i7-?14|i7-?13|7800X3D|7700X/i, 105],
  [/i5|7600X|5600X/i, 65],
  [/RTX\s*40?9|RTX\s*40?8|7900\s*XTX|7900\s*XT/i, 380],
  [/RTX\s*40?7|RTX\s*30?9|RTX\s*30?8/i, 280],
  [/RTX\s*40?6|RTX\s*30?7|RTX\s*30?6/i, 200],
  [/RTX\s*40?5|RTX\s*30?5|RX\s*7600|RX\s*6600/i, 130],
];

const DEFAULTS: Record<string, number> = {
  cpu: 95, gpu: 200, "video-card": 200, motherboard: 30, memory: 10,
  "internal-hard-drive": 8, ssd: 5, "case-fan": 3, "cpu-cooler": 5, monitor: 0,
};

export function tdpFor(part: PartLike): number {
  if (!part) return 0;
  const name = part.name ?? "";
  for (const [re, w] of TDP_REGEX_TABLE) if (re.test(name)) return w;
  return DEFAULTS[part.partType ?? ""] ?? 0;
}

export function totalWattage(parts: PartLike[]): number {
  return parts.reduce((sum, p) => sum + tdpFor(p), 0);
}
```

`frontend/src/lib/compatibility.ts`:

```ts
export type Issue = { severity: "warning" | "error"; message: string };

export function checkCompatibility(parts: Record<string, PartLike>, totalW: number): Issue[] {
  const out: Issue[] = [];
  const psu = parts["power-supply"];
  if (psu) {
    const psuW = psu.specs?.wattage ?? Number((psu.name?.match(/(\d{3,4})\s*W/i) ?? [])[1] ?? 0);
    if (psuW > 0 && psuW < totalW * 1.2) {
      out.push({ severity: "warning", message: `PSU is ${psuW}W; build draws ~${totalW}W. Recommend ≥${Math.ceil(totalW * 1.2)}W.` });
    }
  }
  const ram = parts.memory;
  const mobo = parts.motherboard;
  if (ram?.specs?.memoryType && mobo?.specs?.memoryType && ram.specs.memoryType !== mobo.specs.memoryType) {
    out.push({ severity: "error", message: `RAM type ${ram.specs.memoryType} doesn't match motherboard ${mobo.specs.memoryType}.` });
  }
  const cpu = parts.cpu;
  if (cpu?.specs?.socket && mobo?.specs?.socket && cpu.specs.socket !== mobo.specs.socket) {
    out.push({ severity: "error", message: `CPU socket ${cpu.specs.socket} doesn't match motherboard ${mobo.specs.socket}.` });
  }
  return out;
}
```

## Data flow (post-finalize)

```
User clicks "Run Both" on PostFinalizePage
  → POST /builds { buildName, parts, totalPrice, analyses: ["bottleneck","optimization"] }
  → API Gateway validates JWT
  → build-api: validates name, writes build doc with requestedAnalyses, increments metrics, publishes Pub/Sub
  → Pub/Sub fan-out
    → bottleneck-analyzer-sub → checks requestedAnalyses → runs Gemini → writes assessment + increments metrics
    → value-optimizer-sub     → checks requestedAnalyses → runs Gemini → writes assessment + increments metrics
  → Frontend navigates to AnalysisPage(selectedBuildId=newId)
  → AnalysisPage onSnapshot listeners stream live results in
```

## Out-of-scope (deliberate YAGNI)

- GPU-length / case-clearance / radiator-clearance checks
- CPU-cooler socket compatibility (cooler specs are inconsistent in the dataset)
- Email/password change on profile (requires Firebase re-auth flow)
- Pagination of profile tables (limit to 50 most recent for now)
- Drag-and-drop reordering of build parts
- Light-theme PCPP color shift (Option C, deferred)

## Acceptance criteria

- [ ] Cannot finalize a build without a non-empty buildName.
- [ ] Two builds with the same name under the same user is rejected (409).
- [ ] Post-finalize page shows 4 buttons; only the chosen analyses run.
- [ ] Choosing "Save Only" still persists the build to Firestore (verifiable on Profile/Analysis).
- [ ] "Run Both" produces a single Pub/Sub publish + two analyzer logs (visible in `gcloud logging tail`).
- [ ] Profile page shows builds and benchmarks tables; rename/delete works; re-trigger button is greyed if assessment exists.
- [ ] Compatibility/wattage banner shows correct status (test: 1000W PSU + RTX 4090 + i9 = ✓; 450W PSU + RTX 4090 = ⚠).
- [ ] Existing builds without `requestedAnalyses` continue to receive both analyses (back-compat).
- [ ] Demo video flow works end-to-end without manual refreshes.
