import { useState, useEffect, type ReactNode } from "react";
import { onAuthStateChanged, updateProfile, signOut, User } from "firebase/auth";
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
} from "firebase/firestore";
import { auth, db } from "../firebase";
import type { NavigateFn } from "../App";

interface Props {
  navigate: NavigateFn;
}

function gatewayBase(): string | null {
  const base = process.env.REACT_APP_GATEWAY_URL?.replace(/\/$/, "") ?? "";
  return base || null;
}

interface BuildRow {
  id: string;
  buildName?: string;
  totalPrice?: number;
  partsCount?: number;
  createdAt?: any;
  requestedAnalyses?: string[];
  hasBottleneck?: boolean;
  hasOptimization?: boolean;
}

interface BenchmarkRow {
  id: string;
  fileName?: string;
  buildId?: string;
  status?: string;
  createdAt?: any;
  hasResult?: boolean;
}

type Tab = "builds" | "benchmarks";

export default function ProfilePage({ navigate }: Props) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [displayName, setDisplayName] = useState(auth.currentUser?.displayName ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("builds");

  const [builds, setBuilds] = useState<BuildRow[]>([]);
  const [benchmarks, setBenchmarks] = useState<BenchmarkRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Auth state subscription (also picks up displayName updates).
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setDisplayName(u?.displayName ?? "");
    });
    return unsub;
  }, []);

  // Real-time builds list.
  useEffect(() => {
    if (!user) return;
    const buildsRef = collection(db, "users", user.uid, "builds");
    const q = query(buildsRef, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const rows: BuildRow[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          buildName: data.buildName,
          totalPrice: data.totalPrice,
          partsCount: data.parts ? Object.keys(data.parts).length : 0,
          createdAt: data.createdAt,
          requestedAnalyses: data.requestedAnalyses ?? [],
        };
      });
      setBuilds(rows);
      setLoading(false);
    });
    return unsub;
  }, [user]);

  // Real-time benchmarks list.
  useEffect(() => {
    if (!user) return;
    const benchRef = collection(db, "users", user.uid, "benchmarks");
    const q = query(benchRef, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const rows: BenchmarkRow[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          fileName: data.fileName,
          buildId: data.buildId,
          status: data.benchmarkMetrics ? "Complete" : "Analyzing",
          createdAt: data.createdAt,
          hasResult: !!data.benchmarkMetrics,
        };
      });
      setBenchmarks(rows);
    });
    return unsub;
  }, [user]);

  // Per-build assessment listeners (parallel, lightweight) so badges stay live.
  useEffect(() => {
    if (!user || builds.length === 0) return;
    const unsubs: Array<() => void> = [];
    builds.forEach((b) => {
      const ref = collection(db, "users", user.uid, "builds", b.id, "assessments");
      const u = onSnapshot(ref, (snap) => {
        const ids = new Set(snap.docs.map((d) => d.id));
        setBuilds((prev) =>
          prev.map((row) =>
            row.id === b.id
              ? { ...row, hasBottleneck: ids.has("bottleneck"), hasOptimization: ids.has("optimization") }
              : row
          )
        );
      });
      unsubs.push(u);
    });
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, builds.length]);

  const saveDisplayName = async () => {
    if (!user) return;
    if (!displayName.trim()) {
      setNameMessage("Display name can't be empty");
      return;
    }
    setSavingName(true);
    setNameMessage(null);
    try {
      await updateProfile(user, { displayName: displayName.trim() });
      // Force a refresh of the User object in our state.
      setUser({ ...user });
      setNameMessage("Saved");
      setTimeout(() => setNameMessage(null), 2000);
    } catch (err: any) {
      setNameMessage(err.message ?? "Failed to save");
    } finally {
      setSavingName(false);
    }
  };

  const handleLogout = () => signOut(auth);

  // ── API helpers ──
  async function api(path: string, body: any) {
    const base = gatewayBase();
    if (!base) throw new Error("REACT_APP_GATEWAY_URL is not set");
    const token = await auth.currentUser!.getIdToken();
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text}`);
    }
    return res.json();
  }

  const renameBuild = async (buildId: string) => {
    const newName = window.prompt("New build name:");
    if (!newName) return;
    try {
      await api(`/builds/${buildId}/rename`, { buildName: newName });
    } catch (err: any) {
      alert(`Rename failed: ${err.message}`);
    }
  };

  const deleteBuild = async (buildId: string, buildName?: string) => {
    if (!window.confirm(`Delete "${buildName ?? buildId}"? This cannot be undone.`)) return;
    try {
      await api(`/builds/${buildId}/delete`, {});
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const triggerAnalysis = async (buildId: string, type: "bottleneck" | "optimization") => {
    try {
      await api(`/builds/${buildId}/analyze`, { types: [type] });
    } catch (err: any) {
      alert(`Trigger failed: ${err.message}`);
    }
  };

  const deleteBenchmark = async (benchmarkId: string, fileName?: string) => {
    if (!window.confirm(`Delete benchmark "${fileName ?? benchmarkId}"?`)) return;
    try {
      await api(`/benchmarks/${benchmarkId}/delete`, {});
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const fmtDate = (ts: any) => {
    if (!ts) return "—";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  const initial = (user?.displayName || user?.email || "U").charAt(0).toUpperCase();

  const totalAnalyzed = builds.filter((b) => b.hasBottleneck || b.hasOptimization).length;
  const totalBenchAnalyzed = benchmarks.filter((b) => b.hasResult).length;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* ── Header ── */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 mb-6">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 text-white text-2xl font-bold flex items-center justify-center shrink-0">
            {initial}
          </div>
          <div className="flex-1 min-w-[240px]">
            <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1">
              Display Name
            </p>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Add a name"
                className="flex-1 max-w-xs px-3 py-1.5 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
              <button
                onClick={saveDisplayName}
                disabled={savingName || displayName === (user?.displayName ?? "")}
                className="px-3 py-1.5 rounded-md bg-orange-500 text-white text-xs font-semibold hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingName ? "Saving..." : "Save"}
              </button>
              {nameMessage && <span className="text-xs text-neutral-500">{nameMessage}</span>}
            </div>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-2 truncate">
              {user?.email}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs px-3 py-1.5 rounded-md border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 hover:border-red-300 dark:hover:border-red-800 transition-colors"
          >
            Sign Out
          </button>
        </div>

        {/* Counters */}
        <div className="grid grid-cols-3 gap-3 mt-5 pt-4 border-t border-neutral-200 dark:border-neutral-800">
          <Counter label="Builds" value={builds.length} />
          <Counter label="Analyses" value={totalAnalyzed} />
          <Counter label="Benchmarks" value={totalBenchAnalyzed} />
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-2 mb-4 border-b border-neutral-200 dark:border-neutral-800">
        {(["builds", "benchmarks"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              activeTab === t
                ? "border-orange-500 text-orange-500"
                : "border-transparent text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            {t === "builds" ? "My Builds" : "My Benchmarks"} ({t === "builds" ? builds.length : benchmarks.length})
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      {loading ? (
        <p className="text-sm text-neutral-500 px-4 py-12 text-center">Loading...</p>
      ) : activeTab === "builds" ? (
        <BuildsTable
          builds={builds}
          fmtDate={fmtDate}
          onOpen={(id) => navigate("analysis", { selectedBuildId: id })}
          onRename={renameBuild}
          onDelete={deleteBuild}
          onTrigger={triggerAnalysis}
        />
      ) : (
        <BenchmarksTable benchmarks={benchmarks} fmtDate={fmtDate} onDelete={deleteBenchmark} />
      )}
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{value}</p>
      <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}

function BuildsTable({
  builds, fmtDate, onOpen, onRename, onDelete, onTrigger,
}: {
  builds: BuildRow[];
  fmtDate: (ts: any) => string;
  onOpen: (id: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string, name?: string) => void;
  onTrigger: (id: string, type: "bottleneck" | "optimization") => void;
}) {
  if (builds.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-10 text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          No builds yet. Head to the Builder to create one.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden bg-white dark:bg-neutral-900">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 dark:bg-neutral-950 text-neutral-500 dark:text-neutral-400">
            <tr className="text-left text-[11px] uppercase tracking-wide">
              <th className="px-4 py-2.5 font-semibold">Name</th>
              <th className="px-4 py-2.5 font-semibold">Parts</th>
              <th className="px-4 py-2.5 font-semibold">Total</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold">Created</th>
              <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {builds.map((b) => (
              <tr key={b.id} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-800/30">
                <td className="px-4 py-3">
                  <button
                    onClick={() => onOpen(b.id)}
                    className="font-semibold text-neutral-900 dark:text-neutral-100 hover:text-orange-500 transition-colors text-left"
                  >
                    {b.buildName || b.id.slice(0, 8)}
                  </button>
                </td>
                <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400">{b.partsCount}</td>
                <td className="px-4 py-3 font-semibold">${(b.totalPrice ?? 0).toFixed(2)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    <Badge ok={b.hasBottleneck}>Bottleneck</Badge>
                    <Badge ok={b.hasOptimization}>Optimization</Badge>
                  </div>
                </td>
                <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400 text-xs">
                  {fmtDate(b.createdAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex gap-1 flex-wrap justify-end">
                    {!b.hasBottleneck && (
                      <RowAction onClick={() => onTrigger(b.id, "bottleneck")}>+Bottleneck</RowAction>
                    )}
                    {!b.hasOptimization && (
                      <RowAction onClick={() => onTrigger(b.id, "optimization")}>+Optimization</RowAction>
                    )}
                    <RowAction onClick={() => onRename(b.id)}>Rename</RowAction>
                    <RowAction onClick={() => onDelete(b.id, b.buildName)} variant="danger">Delete</RowAction>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BenchmarksTable({
  benchmarks, fmtDate, onDelete,
}: {
  benchmarks: BenchmarkRow[];
  fmtDate: (ts: any) => string;
  onDelete: (id: string, name?: string) => void;
}) {
  if (benchmarks.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-10 text-center">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          No benchmarks uploaded yet.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden bg-white dark:bg-neutral-900">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 dark:bg-neutral-950 text-neutral-500 dark:text-neutral-400">
            <tr className="text-left text-[11px] uppercase tracking-wide">
              <th className="px-4 py-2.5 font-semibold">File</th>
              <th className="px-4 py-2.5 font-semibold">Build</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold">Uploaded</th>
              <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {benchmarks.map((b) => (
              <tr key={b.id} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-800/30">
                <td className="px-4 py-3 font-semibold truncate max-w-xs">{b.fileName ?? b.id.slice(0, 8)}</td>
                <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400 font-mono text-xs">
                  {b.buildId ? b.buildId.slice(0, 8) : "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge ok={b.hasResult}>{b.status}</Badge>
                </td>
                <td className="px-4 py-3 text-neutral-500 dark:text-neutral-400 text-xs">
                  {fmtDate(b.createdAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  <RowAction onClick={() => onDelete(b.id, b.fileName)} variant="danger">Delete</RowAction>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Badge({ ok, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${
        ok
          ? "bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400"
          : "bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400"
      }`}
    >
      {ok && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12l5 5L20 7" />
        </svg>
      )}
      {children}
    </span>
  );
}

function RowAction({
  onClick, children, variant = "neutral",
}: {
  onClick: () => void;
  children: ReactNode;
  variant?: "neutral" | "danger";
}) {
  const styles =
    variant === "danger"
      ? "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
      : "text-neutral-600 dark:text-neutral-400 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-500/10";
  return (
    <button onClick={onClick} className={`px-2 py-1 rounded text-xs font-medium transition-colors ${styles}`}>
      {children}
    </button>
  );
}
