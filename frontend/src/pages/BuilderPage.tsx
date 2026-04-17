import { useState, useRef } from "react";
import { auth } from "../firebase";

function gatewayBase(): string | null {
  const base = process.env.REACT_APP_GATEWAY_URL?.replace(/\/$/, "") ?? "";
  return base || null;
}

/* ─── Category config ─── */

const CATEGORIES = ["CPU", "GPU", "Motherboard", "RAM", "Storage", "PSU", "Case", "Cooler"] as const;
type Category = (typeof CATEGORIES)[number];

// Maps UI category labels to Firestore partType values
const CATEGORY_TO_PART_TYPE: Record<Category, string> = {
  CPU: "cpu",
  GPU: "gpu",
  Motherboard: "motherboard",
  RAM: "memory",
  Storage: "storage",
  PSU: "psu",
  Case: "case",
  Cooler: "cpu_cooler",
};

const CATEGORY_ICONS: Record<Category, string> = {
  CPU: "M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m-2 6h2M19 9h2m-2 6h2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z",
  GPU: "M4 7h16M4 7v10a1 1 0 001 1h14a1 1 0 001-1V7M4 7l2-3h12l2 3M10 11h4",
  Motherboard: "M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v6m0 0H3m6 0v6m0 0H3m6 0v6m0-6h12m0-6V5m0 4h-6m6 6v4a2 2 0 01-2 2H9m12-6h-6",
  RAM: "M4 6h16v12H4V6zm2 3v6m3-6v6m3-6v6m3-6v6",
  Storage: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4",
  PSU: "M13 10V3L4 14h7v7l9-11h-7z",
  Case: "M5 3h14a1 1 0 011 1v16a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1zm7 4a3 3 0 100 6 3 3 0 000-6z",
  Cooler: "M12 8a4 4 0 100 8 4 4 0 000-8zm-2-4v2m4-2v2m6 4h-2m2 4h-2M4 10h2M4 14h2m2 6v-2m4 2v-2",
};

/* ─── Types ─── */

interface Part {
  id: string;
  name: string;
  category: Category;
  price: number;
  specs: string;
  partType: string;
}

/* ─── Specs formatter ─── */

// Builds a human-readable specs string from raw Firestore fields per part type
function buildSpecs(doc: Record<string, any>, partType: string): string {
  switch (partType) {
    case "cpu": {
      const cores = doc.core_count ? `${doc.core_count}C` : null;
      const clocks =
        doc.core_clock && doc.boost_clock
          ? `${doc.core_clock} / ${doc.boost_clock} GHz`
          : doc.boost_clock
          ? `${doc.boost_clock} GHz boost`
          : null;
      const tdp = doc.tdp ? `${doc.tdp}W` : null;
      return [cores, clocks, tdp].filter(Boolean).join(" · ");
    }
    case "gpu": {
      const mem = doc.memory ? `${doc.memory} GB` : null;
      const boost = doc.boost_clock ? `${doc.boost_clock} MHz boost` : null;
      const chipset = doc.chipset || null;
      return [mem, boost, chipset].filter(Boolean).join(" · ");
    }
    case "motherboard": {
      const socket = doc.socket || null;
      const ff = doc.form_factor || null;
      const maxMem = doc.max_memory ? `${doc.max_memory} GB max RAM` : null;
      return [socket, ff, maxMem].filter(Boolean).join(" · ");
    }
    case "memory": {
      const speed =
        Array.isArray(doc.speed) && doc.speed.length === 2
          ? `DDR${doc.speed[0]}-${doc.speed[1]}`
          : null;
      const modules =
        Array.isArray(doc.modules) && doc.modules.length === 2
          ? `${doc.modules[0]}×${doc.modules[1]} GB`
          : null;
      const cas = doc.cas_latency ? `CL${doc.cas_latency}` : null;
      return [speed, modules, cas].filter(Boolean).join(" · ");
    }
    case "storage": {
      const cap = doc.capacity ? `${doc.capacity >= 1000 ? `${doc.capacity / 1000} TB` : `${doc.capacity} GB`}` : null;
      const type = doc.type || null;
      const iface = doc.interface || null;
      return [cap, type, iface].filter(Boolean).join(" · ");
    }
    case "psu": {
      const watts = doc.wattage ? `${doc.wattage}W` : null;
      const eff = doc.efficiency ? doc.efficiency.charAt(0).toUpperCase() + doc.efficiency.slice(1) : null;
      const mod = doc.modular ? `${doc.modular} Modular` : null;
      return [watts, eff, mod].filter(Boolean).join(" · ");
    }
    case "case": {
      const type = doc.type || null;
      const panel = doc.side_panel ? `${doc.side_panel} Panel` : null;
      return [type, panel].filter(Boolean).join(" · ");
    }
    case "cpu_cooler": {
      const size = doc.size ? `${doc.size} mm` : "Air";
      const rpm = Array.isArray(doc.rpm)
        ? `${doc.rpm[0]}–${doc.rpm[1]} RPM`
        : doc.rpm
        ? `${doc.rpm} RPM`
        : null;
      const noise = doc.noise_level ? `${doc.noise_level} dB` : null;
      return [size, rpm, noise].filter(Boolean).join(" · ");
    }
    default:
      return "";
  }
}

/* ─── Component ─── */

export default function BuilderPage() {
  const [expandedCat, setExpandedCat] = useState<Category | null>("CPU");
  const [search, setSearch] = useState("");
  const [build, setBuild] = useState<Partial<Record<Category, Part>>>({});

  // Cached parts per category, fetched once on first expand
  const [partsByCategory, setPartsByCategory] = useState<Partial<Record<Category, Part[]>>>({});
  const [loadingCat, setLoadingCat] = useState<Category | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [finalizeSuccess, setFinalizeSuccess] = useState<{
    buildId?: string;
    status?: string;
    message?: string;
  } | null>(null);

  const rowRefs = useRef<Partial<Record<Category, HTMLDivElement | null>>>({});

  const totalPrice = Object.values(build).reduce((s, p) => s + (p?.price ?? 0), 0);
  const filledCount = Object.keys(build).length;

  /* ─── API fetch ─── */

  async function fetchCategory(cat: Category) {
    if (partsByCategory[cat]) return; // already cached
    setLoadingCat(cat);
    setFetchError(null);
    try {
      const base = gatewayBase();
      if (!base) throw new Error("REACT_APP_GATEWAY_URL is not set");
      const partType = CATEGORY_TO_PART_TYPE[cat];
      const token = await auth.currentUser!.getIdToken();
      const url = `${base}/parts?category=${encodeURIComponent(partType)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const parts: Part[] = data.parts.map((doc: any) => ({
        id: doc.id,
        name: doc.name ?? "Unknown",
        category: cat,
        price: doc.price ?? 0,
        specs: buildSpecs(doc, partType),
        partType,
      }));
      setPartsByCategory((prev) => ({ ...prev, [cat]: parts }));
    } catch (err: any) {
      setFetchError(`Failed to load ${cat} parts: ${err.message}`);
    } finally {
      setLoadingCat(null);
    }
  }

  /* ─── Handlers ─── */

  const selectPart = (part: Part) => {
    setBuild((prev) => ({ ...prev, [part.category]: part }));
    const idx = CATEGORIES.indexOf(part.category);
    const next = CATEGORIES.slice(idx + 1).find((c) => !build[c] && c !== part.category);
    setTimeout(() => {
      if (next) {
        setExpandedCat(next);
        fetchCategory(next);
        rowRefs.current[next]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } else {
        setExpandedCat(null);
      }
      setSearch("");
    }, 150);
  };

  const removePart = (cat: Category, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setBuild((prev) => {
      const n = { ...prev };
      delete n[cat];
      return n;
    });
  };

  const toggleCategory = (cat: Category) => {
    const opening = expandedCat !== cat;
    setExpandedCat(opening ? cat : null);
    setSearch("");
    if (opening) fetchCategory(cat);
  };

  async function finalizeBuild() {
    const base = gatewayBase();
    if (!base) {
      setFinalizeError("REACT_APP_GATEWAY_URL is not set. Add it to your .env file.");
      return;
    }
    if (filledCount !== CATEGORIES.length) return;

    setFinalizing(true);
    setFinalizeError(null);
    setFinalizeSuccess(null);
    try {
      const token = await auth.currentUser!.getIdToken();
      const parts: Record<
        string,
        { id: string; name: string; price: number; partType: string; specs: string }
      > = {};
      for (const cat of CATEGORIES) {
        const p = build[cat];
        if (p) {
          parts[p.partType] = {
            id: p.id,
            name: p.name,
            price: p.price,
            partType: p.partType,
            specs: p.specs,
          };
        }
      }
      const res = await fetch(`${base}/builds`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ parts, totalPrice }),
      });
      if (!res.ok) {
        const raw = await res.text();
        let detail = `HTTP ${res.status}`;
        try {
          const errBody = JSON.parse(raw) as { error?: string; message?: string };
          if (errBody?.error || errBody?.message) {
            detail = errBody.error ?? errBody.message ?? detail;
          } else if (raw) {
            detail = raw.slice(0, 200);
          }
        } catch {
          if (raw) detail = raw.slice(0, 200);
        }
        throw new Error(detail);
      }
      const data = await res.json();
      setFinalizeSuccess(data);
      try {
        sessionStorage.setItem(
          "forgespec_last_build_finalize",
          JSON.stringify({
            at: Date.now(),
            buildId: data.buildId,
            status: data.status,
            totalPrice,
            partCount: Object.keys(parts).length,
          })
        );
      } catch {
        /* ignore quota / private mode */
      }
    } catch (err: unknown) {
      setFinalizeError(err instanceof Error ? err.message : "Failed to finalize build");
    } finally {
      setFinalizing(false);
    }
  }

  /* ─── Filtered parts for the open category ─── */

  const cachedParts = expandedCat ? (partsByCategory[expandedCat] ?? []) : [];
  const filteredParts = search.trim() === ""
    ? cachedParts
    : cachedParts.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.specs.toLowerCase().includes(search.toLowerCase())
      );

  /* ─── Render ─── */

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100 tracking-tight">
            Build Your PC
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
            Select a component for each slot.{" "}
            {filledCount < CATEGORIES.length
              ? `${CATEGORIES.length - filledCount} remaining.`
              : "All slots filled — ready to finalize!"}
          </p>
        </div>

        {/* Totals card */}
        <div className="flex items-center gap-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl px-5 py-3 shadow-sm">
          <div className="text-right">
            <p className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
              Estimated Total
            </p>
            <p className="text-2xl font-bold tabular-nums text-neutral-900 dark:text-neutral-100">
              ${totalPrice.toLocaleString()}
            </p>
          </div>
          <div className="w-px h-10 bg-neutral-200 dark:bg-neutral-700" />
          <div>
            <p className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">
              Parts
            </p>
            <p className="text-2xl font-bold tabular-nums text-neutral-900 dark:text-neutral-100">
              {filledCount}
              <span className="text-sm font-normal text-neutral-400">/{CATEGORIES.length}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-neutral-200 dark:bg-neutral-800 rounded-full mb-6 overflow-hidden">
        <div
          className="h-full bg-orange-500 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${(filledCount / CATEGORIES.length) * 100}%` }}
        />
      </div>

      {/* Global fetch error */}
      {fetchError && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-sm text-red-600 dark:text-red-400">
          {fetchError}
        </div>
      )}

      {finalizeError && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-sm text-red-600 dark:text-red-400">
          {finalizeError}
        </div>
      )}

      {finalizeSuccess && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-900/40 text-sm text-emerald-800 dark:text-emerald-200">
          <p className="font-semibold">Build submitted</p>
          <p className="mt-1 text-emerald-700 dark:text-emerald-300/90">
            {finalizeSuccess.message ?? "Analysis pipeline started."}
            {finalizeSuccess.buildId && (
              <>
                {" "}
                <span className="text-xs font-mono opacity-90">ID: {finalizeSuccess.buildId}</span>
              </>
            )}
          </p>
          <p className="mt-2 text-xs text-emerald-600/90 dark:text-emerald-400/80">
            Open <strong className="font-medium">Analysis</strong> for status — full real-time updates ship with the Firestore listener in the polish milestone.
          </p>
        </div>
      )}

      {/* ── Category rows ── */}
      <div className="space-y-2">
        {CATEGORIES.map((cat, i) => {
          const part = build[cat];
          const isExpanded = expandedCat === cat;
          const isLoading = loadingCat === cat;
          const isNext =
            !part && expandedCat === null && CATEGORIES.findIndex((c) => !build[c]) === i;

          return (
            <div
              key={cat}
              ref={(el) => { rowRefs.current[cat] = el; }}
              className={`rounded-xl border transition-all overflow-hidden ${
                isExpanded
                  ? "border-orange-400/60 dark:border-orange-500/40 bg-white dark:bg-neutral-900 shadow-md dark:shadow-lg dark:shadow-black/30"
                  : part
                  ? "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60"
                  : isNext
                  ? "border-orange-300 dark:border-orange-500/30 bg-orange-50/50 dark:bg-orange-500/[0.03]"
                  : "border-neutral-200 dark:border-neutral-800 bg-white/50 dark:bg-neutral-900/30"
              }`}
            >
              {/* Row header */}
              <button
                onClick={() => toggleCategory(cat)}
                className="w-full flex items-center gap-3 sm:gap-4 px-4 py-3.5 text-left focus:outline-none group"
              >
                {/* Step indicator */}
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                    part
                      ? "bg-orange-500 text-white"
                      : isExpanded
                      ? "bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400"
                      : "bg-neutral-100 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-500"
                  }`}
                >
                  {part ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d={CATEGORY_ICONS[cat]} />
                    </svg>
                  )}
                </div>

                {/* Category name + selection */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold ${part ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-400"}`}>
                      {cat}
                    </span>
                    {!part && isNext && !isExpanded && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-orange-500 bg-orange-100 dark:bg-orange-500/15 px-1.5 py-0.5 rounded">
                        Next
                      </span>
                    )}
                  </div>
                  {part ? (
                    <p className="text-sm text-neutral-600 dark:text-neutral-400 truncate mt-0.5">
                      {part.name}
                      <span className="text-neutral-400 dark:text-neutral-500 mx-1.5">·</span>
                      <span className="text-xs text-neutral-400 dark:text-neutral-500">{part.specs}</span>
                    </p>
                  ) : (
                    <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">
                      {isExpanded ? "Choose from the options below" : "Click to choose"}
                    </p>
                  )}
                </div>

                {/* Right side: price + actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {part && (
                    <>
                      <span className="text-sm font-semibold tabular-nums text-neutral-800 dark:text-neutral-200">
                        ${part.price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                      </span>
                      <button
                        onClick={(e) => removePart(cat, e)}
                        aria-label={`Remove ${cat}`}
                        className="p-1 rounded text-neutral-300 dark:text-neutral-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </>
                  )}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className={`text-neutral-300 dark:text-neutral-600 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>
              </button>

              {/* Expanded picker panel */}
              {isExpanded && (
                <div className="border-t border-neutral-100 dark:border-neutral-800 px-4 pb-4 pt-3">
                  {/* Search */}
                  <div className="relative mb-3">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 dark:text-neutral-500 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                    </svg>
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={`Search ${cat} parts…`}
                      autoFocus
                      className="w-full rounded-lg pl-9 pr-4 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500/40 focus:border-orange-500 bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500"
                    />
                  </div>

                  {/* Loading state */}
                  {isLoading ? (
                    <div className="flex items-center justify-center py-10 gap-2 text-sm text-neutral-400 dark:text-neutral-500">
                      <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      Loading {cat} parts…
                    </div>
                  ) : filteredParts.length === 0 ? (
                    <p className="text-center text-sm text-neutral-400 dark:text-neutral-500 py-6">
                      {search ? `No ${cat} parts match "${search}"` : `No ${cat} parts found`}
                    </p>
                  ) : (
                    <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                      {filteredParts.map((p) => {
                        const sel = build[cat]?.id === p.id;
                        return (
                          <button
                            key={p.id}
                            onClick={() => (sel ? removePart(cat) : selectPart(p))}
                            className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group/part focus:outline-none ${
                              sel
                                ? "bg-orange-50 dark:bg-orange-500/10 ring-1 ring-orange-400/50 dark:ring-orange-500/30"
                                : "hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                            }`}
                          >
                            {/* Radio indicator */}
                            <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                              sel
                                ? "border-orange-500 bg-orange-500"
                                : "border-neutral-300 dark:border-neutral-600 group-hover/part:border-orange-400"
                            }`}>
                              {sel && (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M20 6L9 17l-5-5" />
                                </svg>
                              )}
                            </div>

                            {/* Part info */}
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium truncate ${sel ? "text-orange-700 dark:text-orange-300" : "text-neutral-800 dark:text-neutral-200"}`}>
                                {p.name}
                              </p>
                              <p className="text-xs text-neutral-400 dark:text-neutral-500 truncate mt-0.5">
                                {p.specs}
                              </p>
                            </div>

                            {/* Price */}
                            <span className="text-sm font-semibold tabular-nums text-neutral-700 dark:text-neutral-300 shrink-0">
                              ${p.price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Finalize */}
      <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 shadow-sm">
        <div>
          <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
            {filledCount === CATEGORIES.length
              ? "Your build is complete!"
              : filledCount === 0
              ? "Start by choosing a CPU above"
              : `${CATEGORIES.length - filledCount} component${CATEGORIES.length - filledCount > 1 ? "s" : ""} still needed`}
          </p>
          <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">
            Finalizing runs AI bottleneck detection &amp; value optimization
          </p>
        </div>
        <button
          type="button"
          onClick={() => void finalizeBuild()}
          disabled={filledCount !== CATEGORIES.length || finalizing}
          className={`px-8 py-2.5 text-sm font-semibold rounded-lg transition-all focus:outline-none whitespace-nowrap ${
            filledCount === CATEGORIES.length && !finalizing
              ? "bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white shadow-sm"
              : filledCount === CATEGORIES.length && finalizing
              ? "bg-orange-500/70 text-white cursor-wait"
              : "bg-neutral-100 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-600 cursor-not-allowed"
          }`}
        >
          {finalizing ? "Submitting…" : "Finalize Build →"}
        </button>
      </div>
    </div>
  );
}
