import { useState, useEffect } from "react";
import { auth, db } from "../firebase";
import { collection, onSnapshot, query, orderBy } from "firebase/firestore";

type AssessmentType = "bottleneck" | "optimization";

interface AssessmentData {
  analysis?: any;
  suggestions?: any;
  createdAt?: any;
}

type PipelineStatus = "queued" | "analyzing" | "complete" | "error";

interface PipelineEntry {
  status: PipelineStatus;
  queuedAt?: any;
  startedAt?: any;
  completedAt?: any;
  error?: string;
}

interface Build {
  id: string;
  buildName?: string;
  parts: any;
  totalPrice: number;
  requestedAnalyses?: string[];
  pipeline?: { bottleneck?: PipelineEntry; optimization?: PipelineEntry };
  bottleneckAnalysis?: AssessmentData;
  valueOptimization?: AssessmentData;
}

export default function AnalysisPage({
  selectedBuildId: initialBuildId,
}: { selectedBuildId?: string } = {}) {
  const [builds, setBuilds] = useState<Build[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(initialBuildId ?? null);
  const [activeTab, setActiveTab] = useState<AssessmentType>("bottleneck");

  // Real-time listener for the user's builds list.
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }

    const buildsRef = collection(db, "users", user.uid, "builds");
    const buildsQuery = query(buildsRef, orderBy("createdAt", "desc"));

    const unsubBuilds = onSnapshot(
      buildsQuery,
      (snapshot) => {
        const buildsList: Build[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            buildName: data.buildName,
            parts: data.parts || [],
            totalPrice: data.totalPrice || 0,
            requestedAnalyses: data.requestedAnalyses ?? [],
            pipeline: data.pipeline ?? {},
          };
        });
        setBuilds((prev) => {
          // Preserve any assessments already loaded for known builds.
          const prevById = new Map(prev.map((b) => [b.id, b]));
          return buildsList.map((b) => ({
            ...b,
            bottleneckAnalysis: prevById.get(b.id)?.bottleneckAnalysis,
            valueOptimization: prevById.get(b.id)?.valueOptimization,
          }));
        });
        setLoading(false);
        setSelectedBuildId((prev) => prev ?? initialBuildId ?? buildsList[0]?.id ?? null);
      },
      (err) => {
        console.error("Error listening to builds:", err);
        setLoading(false);
      }
    );

    return unsubBuilds;
  }, []);

  // Real-time listener for assessments on the currently selected build.
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

    const unsub = onSnapshot(
      assessmentsRef,
      (snap) => {
        const assessments: Record<string, AssessmentData> = {};
        snap.docs.forEach((d) => {
          assessments[d.id] = d.data() as AssessmentData;
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
      },
      (err) => console.error("Error listening to assessments:", err)
    );

    return unsub;
  }, [selectedBuildId]);

  const selectedBuild = builds.find((b) => b.id === selectedBuildId);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Header */}
      <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100 tracking-tight">
        Build Analysis
      </h1>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 mb-8 max-w-lg">
        AI-powered analysis of your PC builds. Get bottleneck detection and value optimization suggestions.
      </p>

      {loading ? (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-8 text-center">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading your builds...</p>
        </div>
      ) : builds.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-8 sm:p-14 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-neutral-100 dark:bg-neutral-800 mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-neutral-400 dark:text-neutral-500" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-neutral-800 dark:text-neutral-200 mb-1.5">
            No builds yet
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-sm mx-auto">
            Head to the Builder, create and finalize a build. Once analyzed, it will appear here.
          </p>
        </div>
      ) : (
        <div className="grid lg:grid-cols-4 gap-6">
          {/* Builds list */}
          <div className="lg:col-span-1">
            <div className="bg-white dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden">
              <div className="p-4 border-b border-neutral-200 dark:border-neutral-800">
                <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">Your Builds</p>
              </div>
              <div className="divide-y divide-neutral-200 dark:divide-neutral-800 max-h-96 overflow-y-auto">
                {builds.map((build) => (
                  <button
                    key={build.id}
                    onClick={() => setSelectedBuildId(build.id)}
                    className={`w-full text-left px-4 py-3 transition-colors ${
                      selectedBuildId === build.id
                        ? "bg-orange-50/50 dark:bg-orange-500/10"
                        : "hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                    }`}
                  >
                    <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-0.5 truncate">
                      {build.buildName || build.id.slice(0, 8)}
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 tabular-nums">
                      ${build.totalPrice.toFixed(2)}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Analysis view */}
          <div className="lg:col-span-3">
            {selectedBuild ? (
              <div className="space-y-4">
                {/* Tab toggle */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setActiveTab("bottleneck")}
                    className={`flex-1 px-4 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
                      activeTab === "bottleneck"
                        ? "bg-orange-500 text-white"
                        : "bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                    }`}
                  >
                    Bottleneck Detection
                  </button>
                  <button
                    onClick={() => setActiveTab("optimization")}
                    className={`flex-1 px-4 py-2.5 rounded-lg font-semibold text-sm transition-colors ${
                      activeTab === "optimization"
                        ? "bg-orange-500 text-white"
                        : "bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                    }`}
                  >
                    Price Optimization
                  </button>
                </div>

                {/* Content */}
                <PipelineProgress
                  type={activeTab}
                  entry={selectedBuild.pipeline?.[activeTab]}
                  requested={(selectedBuild.requestedAnalyses ?? []).includes(activeTab)}
                  hasResult={
                    activeTab === "bottleneck"
                      ? !!selectedBuild.bottleneckAnalysis
                      : !!selectedBuild.valueOptimization
                  }
                />

                {activeTab === "bottleneck" ? (
                  <BottleneckView analysis={selectedBuild.bottleneckAnalysis} />
                ) : (
                  <OptimizationView optimization={selectedBuild.valueOptimization} />
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-8 text-center">
                <p className="text-sm text-neutral-500 dark:text-neutral-400">Select a build to view analysis</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Smart structured renderers ─── */

function humanizeKey(k: string): string {
  return k
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bCpu\b/g, "CPU")
    .replace(/\bGpu\b/g, "GPU")
    .replace(/\bRam\b/g, "RAM")
    .replace(/\bPsu\b/g, "PSU")
    .replace(/\bSsd\b/g, "SSD")
    .replace(/\bHdd\b/g, "HDD")
    .replace(/\bAi\b/g, "AI");
}

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "CANNOT_DETERMINE" | "N_A" | string;

function severityClasses(sev: Severity): { dot: string; pill: string; label: string } {
  const s = String(sev).toUpperCase();
  if (s === "HIGH" || s === "CRITICAL") {
    return { dot: "bg-red-500", pill: "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-400 border-red-300 dark:border-red-500/40", label: s };
  }
  if (s === "MEDIUM") {
    return { dot: "bg-amber-500", pill: "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-500/40", label: s };
  }
  if (s === "LOW") {
    return { dot: "bg-green-500", pill: "bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400 border-green-300 dark:border-green-500/40", label: s };
  }
  // unknown / cannot_determine / N/A
  return { dot: "bg-neutral-400", pill: "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border-neutral-300 dark:border-neutral-700", label: s.replace(/_/g, " ") };
}

function SeverityPill({ severity }: { severity: Severity }) {
  const c = severityClasses(severity);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold border ${c.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

// Concern-shaped objects are anything Gemini returns that has a severity,
// description, concern, recommendations, or summary field. These get rendered
// as styled concern cards with severity pills.
function isConcernShape(v: any): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return (
    "concern" in v ||
    "description" in v ||
    "details" in v ||
    "severity" in v ||
    "recommendations" in v ||
    "summary" in v ||
    "issue" in v ||
    "impact" in v
  );
}

// "Map of concerns" = an object whose VALUES are mostly concern-shaped.
// E.g. { ram_bandwidth_concerns: {...}, cpu_gpu_bottleneck: {...} }.
// We render the whole thing as a grid of cards.
function isConcernMap(v: any): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const entries = Object.entries(v);
  if (entries.length === 0) return false;
  const concernCount = entries.filter(([, vv]) => isConcernShape(vv)).length;
  return concernCount >= Math.max(1, Math.floor(entries.length * 0.5));
}

function ConcernCard({ title, value }: { title: string; value: any }) {
  const concern = value.concern ?? value.description ?? value.details ?? value.summary ?? value.issue ?? value.impact ?? null;
  const severity: Severity | null = value.severity ?? null;
  const recs: any[] = Array.isArray(value.recommendations) ? value.recommendations : [];
  const HANDLED = new Set(["concern", "description", "details", "summary", "severity", "recommendations", "issue", "impact"]);
  const extras = Object.entries(value).filter(([k]) => !HANDLED.has(k));

  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h4 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 leading-snug">{title}</h4>
        {severity && <SeverityPill severity={severity} />}
      </div>
      {concern && typeof concern === "string" && (
        <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">{concern}</p>
      )}
      {concern && typeof concern !== "string" && (
        <div className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
          <SmartValue value={concern} />
        </div>
      )}
      {recs.length > 0 && (
        <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800">
          <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-1.5">
            Recommendations
          </p>
          <ul className="space-y-1.5">
            {recs.map((r, i) => (
              <li key={i} className="text-sm text-neutral-700 dark:text-neutral-300 flex gap-2 leading-relaxed">
                <span className="text-orange-500 shrink-0 font-bold">→</span>
                <span>{typeof r === "string" ? r : <SmartValue value={r} />}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {extras.length > 0 && (
        <div className="mt-3 pt-3 border-t border-neutral-100 dark:border-neutral-800 space-y-1.5">
          {extras.map(([k, v]) => (
            <div key={k} className="text-xs">
              <p className="font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-0.5">
                {humanizeKey(k)}
              </p>
              <div className="text-neutral-700 dark:text-neutral-300">
                <SmartValue value={v} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SmartValue({ value }: { value: any }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-neutral-400 dark:text-neutral-500 italic">—</span>;
  }
  if (typeof value === "string") {
    return <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed whitespace-pre-wrap">{value}</p>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <span className="text-sm font-mono tabular-nums text-neutral-700 dark:text-neutral-300">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <p className="text-xs italic text-neutral-400 dark:text-neutral-500">(none)</p>;
    }
    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      return (
        <ul className="space-y-1">
          {value.map((v, i) => (
            <li key={i} className="text-sm text-neutral-700 dark:text-neutral-300 flex gap-2">
              <span className="text-orange-500 shrink-0">•</span>
              <span>{String(v)}</span>
            </li>
          ))}
        </ul>
      );
    }
    return (
      <div className="space-y-2">
        {value.map((v, i) =>
          isConcernShape(v) ? (
            <ConcernCard key={i} title={v.title ?? v.name ?? `Item ${i + 1}`} value={v} />
          ) : typeof v === "object" ? (
            <div key={i} className="rounded-md border border-neutral-200 dark:border-neutral-800 p-2.5">
              <SmartValue value={v} />
            </div>
          ) : (
            <p key={i} className="text-sm text-neutral-700 dark:text-neutral-300">{String(v)}</p>
          )
        )}
      </div>
    );
  }

  // It's a plain object. Three cases:
  //   a) it's a concern shape → render as ConcernCard
  //   b) it's a "map of concerns" (values are concern-shaped) → grid of cards
  //   c) it's a plain key-value record → vertical list of label/value rows
  if (isConcernShape(value)) {
    return <ConcernCard title={value.title ?? value.name ?? "Concern"} value={value} />;
  }
  if (isConcernMap(value)) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {Object.entries(value).map(([k, v]) =>
          isConcernShape(v) ? (
            <ConcernCard key={k} title={humanizeKey(k)} value={v} />
          ) : (
            <div key={k} className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
              <h4 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200 mb-2">{humanizeKey(k)}</h4>
              <SmartValue value={v} />
            </div>
          )
        )}
      </div>
    );
  }

  // Plain key-value record: render each entry as a labelled row, recursing into the value.
  return (
    <div className="space-y-2.5">
      {Object.entries(value).map(([k, v]) => {
        const keyLabel = humanizeKey(k);
        const isInline = typeof v === "string" || typeof v === "number" || typeof v === "boolean";
        return (
          <div key={k}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-0.5">
              {keyLabel}
            </p>
            <div className={isInline ? "" : "pl-2 border-l-2 border-neutral-200 dark:border-neutral-800"}>
              <SmartValue value={v} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StructuredAnalysis({
  data,
  title,
  emptyMessage,
  iconPath,
}: {
  data: any;
  title: string;
  emptyMessage: string;
  iconPath: string;
}) {
  // Plain string from Gemini that didn't parse as JSON
  if (typeof data === "string") {
    return (
      <div className="bg-white dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-800 rounded-xl p-6">
        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2 mb-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-orange-500" strokeLinecap="round" strokeLinejoin="round">
            <path d={iconPath} />
          </svg>
          {title}
        </h3>
        <p className="text-sm text-neutral-700 dark:text-neutral-300 leading-relaxed whitespace-pre-wrap">{data}</p>
      </div>
    );
  }

  if (!data || (typeof data === "object" && Object.keys(data).length === 0)) {
    return (
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-8 text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{emptyMessage}</p>
      </div>
    );
  }

  const entries = Object.entries(data);
  // Total concern count includes concerns nested one level deep (e.g. inside
  // a "bottlenecks_and_concerns" container). Counts what'll actually render
  // as cards.
  const directConcerns = entries.filter(([, v]) => isConcernShape(v));
  const nestedConcernCounts = entries
    .filter(([, v]) => !isConcernShape(v) && isConcernMap(v))
    .reduce<number>(
      (sum, [, v]) =>
        sum + Object.values(v as Record<string, any>).filter((vv) => isConcernShape(vv)).length,
      0
    );
  const totalConcerns = directConcerns.length + nestedConcernCounts;

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-800 rounded-xl px-6 py-4 flex items-center gap-2">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-orange-500" strokeLinecap="round" strokeLinejoin="round">
          <path d={iconPath} />
        </svg>
        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
        {totalConcerns > 0 && (
          <span className="ml-auto text-xs text-neutral-500 dark:text-neutral-400">
            {totalConcerns} concern{totalConcerns === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {entries.map(([k, v]) => {
        // Direct concern at top level → render as a single card
        if (isConcernShape(v)) {
          return <ConcernCard key={k} title={humanizeKey(k)} value={v} />;
        }
        // Section header + recursive rendering for everything else
        return (
          <div
            key={k}
            className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5"
          >
            <p className="text-xs font-bold uppercase tracking-wide text-orange-500 mb-3">
              {humanizeKey(k)}
            </p>
            <SmartValue value={v} />
          </div>
        );
      })}
    </div>
  );
}

function BottleneckView({ analysis }: { analysis?: AssessmentData }) {
  if (!analysis) {
    return (
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-8 text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Analysis pending... Check back soon!
        </p>
      </div>
    );
  }
  return (
    <StructuredAnalysis
      data={analysis.analysis}
      title="Bottleneck Analysis"
      emptyMessage="No detailed analysis available"
      iconPath="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
    />
  );
}

function OptimizationView({ optimization }: { optimization?: AssessmentData }) {
  if (!optimization) {
    return (
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-8 text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          Optimization pending... Check back soon!
        </p>
      </div>
    );
  }
  return (
    <StructuredAnalysis
      data={optimization.suggestions}
      title="Value Optimization"
      emptyMessage="No optimization suggestions available"
      iconPath="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  );
}

/* ─── Live Pipeline Progress ─── */

function tsToDate(ts: any): Date | null {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (typeof ts === "string" || typeof ts === "number") return new Date(ts);
  if (ts.seconds) return new Date(ts.seconds * 1000);
  return null;
}

function fmtTime(d: Date | null): string {
  return d ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
}

function PipelineProgress({
  type,
  entry,
  requested,
  hasResult,
}: {
  type: AssessmentType;
  entry?: PipelineEntry;
  requested: boolean;
  hasResult: boolean;
}) {
  // Tick every second so elapsed time stays live during "analyzing".
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const status = entry?.status;
    if (status === "complete" || status === "error" || (!requested && !hasResult)) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [entry?.status, requested, hasResult]);

  // Resolve effective status: if the assessment exists but pipeline is missing/old, treat as complete.
  let status: PipelineStatus | "idle" = entry?.status ?? "idle";
  if (hasResult && status !== "error") status = "complete";
  if (!entry && !hasResult && !requested) status = "idle";
  if (!entry && !hasResult && requested) status = "queued";

  const queuedAt = tsToDate(entry?.queuedAt);
  const startedAt = tsToDate(entry?.startedAt);
  const completedAt = tsToDate(entry?.completedAt);

  const startedMs = startedAt?.getTime();
  const elapsed =
    status === "complete" && completedAt && startedAt
      ? Math.round((completedAt.getTime() - startedAt.getTime()) / 1000)
      : status === "analyzing" && startedMs
      ? Math.round((now - startedMs) / 1000)
      : null;

  const stages = [
    { key: "queued", label: "Queued", at: queuedAt },
    { key: "analyzing", label: "Analyzing", at: startedAt },
    { key: "complete", label: "Complete", at: completedAt },
  ] as const;

  const currentIdx =
    status === "complete" ? 2 : status === "analyzing" ? 1 : status === "queued" ? 0 : -1;

  const label = type === "bottleneck" ? "Bottleneck Analysis" : "Value Optimization";

  if (status === "idle") {
    return (
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-4 mb-4 text-sm text-neutral-500 dark:text-neutral-400 flex items-center justify-between gap-3">
        <span>{label} hasn't been requested for this build.</span>
        <span className="text-xs text-neutral-400">Re-trigger from your Profile page.</span>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border p-4 mb-4 ${
        status === "error"
          ? "border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30"
          : status === "complete"
          ? "border-green-200 dark:border-green-700/50 bg-green-50/40 dark:bg-green-500/5"
          : "border-orange-200 dark:border-orange-700/50 bg-orange-50/40 dark:bg-orange-500/5"
      }`}
    >
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            {label}
          </p>
          <p
            className={`text-sm font-bold mt-0.5 ${
              status === "error"
                ? "text-red-600 dark:text-red-400"
                : status === "complete"
                ? "text-green-700 dark:text-green-400"
                : "text-orange-600 dark:text-orange-400"
            }`}
          >
            {status === "queued" && "Waiting in Pub/Sub queue…"}
            {status === "analyzing" && "Gemini is analyzing your build…"}
            {status === "complete" && "Analysis complete"}
            {status === "error" && `Failed: ${entry?.error ?? "unknown error"}`}
          </p>
        </div>
        {elapsed !== null && (
          <p className="text-xs font-mono tabular-nums text-neutral-500 dark:text-neutral-400">
            {status === "complete" ? `Took ${elapsed}s` : `${elapsed}s elapsed`}
          </p>
        )}
      </div>

      {/* Stage track */}
      <div className="flex items-center gap-1.5 mb-3">
        {stages.map((s, i) => {
          const reached = currentIdx >= i || (status === "error" && i <= 1);
          const isActive = currentIdx === i && status !== "complete" && status !== "error";
          const isError = status === "error" && i === Math.max(0, currentIdx);
          return (
            <div key={s.key} className="flex items-center gap-1.5 flex-1 last:flex-initial">
              <div
                className={`w-3 h-3 rounded-full shrink-0 transition-colors ${
                  isError
                    ? "bg-red-500"
                    : isActive
                    ? "bg-orange-500 animate-pulse ring-4 ring-orange-500/20"
                    : reached
                    ? "bg-green-500"
                    : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              />
              <span
                className={`text-xs font-medium ${
                  isError
                    ? "text-red-600 dark:text-red-400"
                    : reached || isActive
                    ? "text-neutral-800 dark:text-neutral-200"
                    : "text-neutral-400 dark:text-neutral-500"
                }`}
              >
                {s.label}
              </span>
              {i < stages.length - 1 && (
                <div
                  className={`flex-1 h-px transition-colors ${
                    reached && currentIdx > i ? "bg-green-500" : "bg-neutral-200 dark:bg-neutral-700"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Timestamps */}
      <div className="grid grid-cols-3 gap-2 text-[11px] text-neutral-500 dark:text-neutral-400">
        <Stamp label="Queued" value={fmtTime(queuedAt)} />
        <Stamp label="Started" value={fmtTime(startedAt)} />
        <Stamp label="Completed" value={fmtTime(completedAt)} />
      </div>
    </div>
  );
}

function Stamp({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-semibold uppercase tracking-wide text-[10px] text-neutral-400 dark:text-neutral-500">
        {label}
      </p>
      <p className="font-mono tabular-nums text-neutral-700 dark:text-neutral-300">{value}</p>
    </div>
  );
}
