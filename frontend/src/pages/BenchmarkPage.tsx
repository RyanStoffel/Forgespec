import { useState, useRef, useEffect } from "react";
import { onSnapshot, doc, collection, getDocs, query, orderBy, limit } from "firebase/firestore";
import { auth, db } from "../firebase";

function gatewayBase(): string | null {
  const base = process.env.REACT_APP_GATEWAY_URL?.replace(/\/$/, "") ?? "";
  return base || null;
}

interface BenchmarkDoc {
  benchmarkId: string;
  status?: string;
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

  // Real-time listener for the active benchmark (Firestore onSnapshot).
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
    // Reset previous result if user picks a new file.
    setActiveBenchmarkId(null);
    setBenchmarkDoc(null);
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
    setUploadError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const upload = async () => {
    if (!selectedFile) return;
    if (!selectedBuildId) {
      setUploadError("Select a build first (finalize one on the Builder page).");
      return;
    }
    const base = gatewayBase();
    if (!base) {
      setUploadError("REACT_APP_GATEWAY_URL is not set in frontend/.env");
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

  // Derive a human-readable status from the benchmark doc.
  const status: "Queued" | "Analyzing" | "Complete" | null = activeBenchmarkId
    ? benchmarkDoc?.benchmarkMetrics
      ? "Complete"
      : benchmarkDoc
      ? "Analyzing"
      : "Queued"
    : null;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Header */}
      <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100 tracking-tight">
        Benchmark Upload
      </h1>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 mb-8 max-w-lg">
        Upload a screenshot from any benchmark tool and the AI compares your
        real-world scores against expected results for your hardware.
      </p>

      {/* ── How it works ── */}
      <div className="flex gap-0 items-start mb-8">
        {[
          { n: "1", label: "Upload screenshot", desc: "Drag or browse" },
          { n: "2", label: "AI analyzes", desc: "OCR + score extraction" },
          { n: "3", label: "Get results", desc: "Expected vs actual" },
        ].map((s, i) => (
          <div key={s.n} className="flex-1 flex flex-col items-center text-center relative">
            {i > 0 && (
              <div className="absolute top-3 right-1/2 w-full h-px bg-neutral-200 dark:bg-neutral-800 -z-10" />
            )}
            <div className="w-7 h-7 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center mb-2 relative z-0">
              {s.n}
            </div>
            <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">{s.label}</p>
            <p className="text-[11px] text-neutral-400 dark:text-neutral-500">{s.desc}</p>
          </div>
        ))}
      </div>

      {/* Build selector */}
      <div className="mb-6">
        <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1.5">
          Associated Build
        </label>
        <select
          value={selectedBuildId}
          onChange={(e) => setSelectedBuildId(e.target.value)}
          className="w-full px-3 py-2.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
        >
          {builds.length === 0 && <option value="">No builds yet — finalize one on the Builder page</option>}
          {builds.map((b) => (
            <option key={b.id} value={b.id}>
              {b.buildName || b.id}{b.totalPrice ? ` ($${b.totalPrice})` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* ── Upload area ── */}
      {!selectedFile ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
          aria-label="Upload benchmark screenshot"
          className={`rounded-xl border-2 border-dashed p-10 sm:p-14 text-center cursor-pointer transition-all focus:outline-none ${
            dragOver
              ? "border-orange-500 bg-orange-50 dark:bg-orange-500/[0.04]"
              : "border-neutral-300 dark:border-neutral-700 hover:border-orange-400 dark:hover:border-orange-500/50 bg-white dark:bg-neutral-900/30 hover:bg-orange-50/30 dark:hover:bg-orange-500/[0.02]"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            className="hidden"
            aria-hidden="true"
          />
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-neutral-100 dark:bg-neutral-800 mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-neutral-400 dark:text-neutral-500" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
          </div>
          <p className="text-sm text-neutral-600 dark:text-neutral-300 mb-1">
            Drag and drop a screenshot, or{" "}
            <span className="text-orange-500 font-semibold">browse files</span>
          </p>
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            PNG, JPG, or WebP · Max 10 MB
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden shadow-sm">
          {/* File bar */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 dark:border-neutral-800">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-500/15 flex items-center justify-center shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-orange-500" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200 truncate">
                  {selectedFile.name}
                </p>
                <p className="text-xs text-neutral-400 dark:text-neutral-500">
                  {(selectedFile.size / 1024).toFixed(0)} KB
                </p>
              </div>
            </div>
            <button
              onClick={clearFile}
              aria-label="Remove file"
              className="p-1.5 rounded-md text-neutral-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors focus:outline-none"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>

          {/* Preview */}
          {preview && (
            <div className="p-4">
              <img src={preview} alt="Benchmark preview" className="w-full rounded-lg border border-neutral-200 dark:border-neutral-800" />
            </div>
          )}

          {/* Action */}
          <div className="px-4 pb-4">
            <button
              onClick={upload}
              disabled={uploading || !selectedBuildId || activeBenchmarkId !== null}
              className="w-full bg-orange-500 hover:bg-orange-600 active:bg-orange-700 disabled:bg-neutral-400 disabled:cursor-not-allowed text-white text-sm font-semibold py-3 rounded-lg transition-colors shadow-sm focus:outline-none"
            >
              {uploading ? "Uploading..." : activeBenchmarkId ? "Uploaded" : "Upload & Analyze"}
            </button>
            <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-2 text-center">
              Uploads to Cloud Storage · Eventarc triggers benchmark analysis
            </p>
          </div>
        </div>
      )}

      {/* ── Error display ── */}
      {uploadError && (
        <div className="mt-4 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
          {uploadError}
        </div>
      )}

      {/* ── Real-time status + results ── */}
      {status && (
        <div className="mt-8 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden shadow-sm">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-neutral-100 dark:border-neutral-800">
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                status === "Complete"
                  ? "bg-green-500"
                  : status === "Analyzing"
                  ? "bg-orange-500 animate-pulse"
                  : "bg-neutral-400 animate-pulse"
              }`}
            />
            <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
              Status: {status}
            </span>
            {activeBenchmarkId && (
              <span className="ml-auto text-[11px] font-mono text-neutral-400 dark:text-neutral-500 truncate max-w-[180px]">
                {activeBenchmarkId.slice(0, 8)}…
              </span>
            )}
          </div>
          {benchmarkDoc?.benchmarkMetrics && (
            <div className="p-4">
              <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 uppercase tracking-wide mb-2">
                Extracted Metrics
              </p>
              <pre className="text-xs bg-neutral-50 dark:bg-neutral-950 p-3 rounded-lg overflow-auto max-h-96 text-neutral-700 dark:text-neutral-300">
                {JSON.stringify(benchmarkDoc.benchmarkMetrics, null, 2)}
              </pre>
            </div>
          )}
          {benchmarkDoc?.buildComparison && (
            <div className="px-4 pb-4">
              <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 uppercase tracking-wide mb-2">
                Build Comparison
              </p>
              <pre className="text-xs bg-neutral-50 dark:bg-neutral-950 p-3 rounded-lg overflow-auto max-h-64 text-neutral-700 dark:text-neutral-300">
                {JSON.stringify(benchmarkDoc.buildComparison, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ── Results placeholder ── */}
      {!selectedFile && !status && (
        <div className="mt-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-8 sm:p-12 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-neutral-100 dark:bg-neutral-800 mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-neutral-400 dark:text-neutral-500" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-neutral-800 dark:text-neutral-200 mb-1.5">
            Results appear here
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-sm mx-auto leading-relaxed">
            Upload a benchmark screenshot above and the AI will compare your
            actual performance against expected scores for your hardware.
          </p>
        </div>
      )}
    </div>
  );
}
