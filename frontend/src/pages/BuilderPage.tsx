import { useState, useRef, useMemo } from "react";
import { auth } from "../firebase";
import { tdpFor, totalWattage, PartLike } from "../lib/wattage";
import { checkCompatibility, statusFor, Issue } from "../lib/compatibility";
import type { NavigateFn } from "../App";

interface Props {
  navigate: NavigateFn;
}

function gatewayBase(): string | null {
  const base = process.env.REACT_APP_GATEWAY_URL?.replace(/\/$/, "") ?? "";
  return base || null;
}

/* ─── Category config ─── */

const CATEGORIES = ["CPU", "GPU", "Motherboard", "RAM", "Storage", "PSU", "Case", "Cooler"] as const;
type Category = (typeof CATEGORIES)[number];

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
  rawSpecs?: any;
  manufacturer?: string;
}

/* ─── Specs formatter ─── */

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

// Map a Part into the PartLike shape the lib helpers expect.
function asPartLike(part: Part | undefined): PartLike | null {
  if (!part) return null;
  const partType = part.partType === "psu" ? "power-supply" : part.partType === "gpu" ? "video-card" : part.partType;
  const specs: any = { ...(part.rawSpecs ?? {}) };
  if (part.partType === "psu" && part.rawSpecs?.wattage) specs.wattage = part.rawSpecs.wattage;
  if (part.partType === "memory" && Array.isArray(part.rawSpecs?.speed) && part.rawSpecs.speed[0]) {
    specs.memoryType = `DDR${part.rawSpecs.speed[0]}`;
  }
  if (part.partType === "motherboard") {
    if (part.rawSpecs?.memory_type) specs.memoryType = part.rawSpecs.memory_type;
    if (part.rawSpecs?.socket) specs.socket = part.rawSpecs.socket;
  }
  if (part.partType === "cpu" && part.rawSpecs?.socket) specs.socket = part.rawSpecs.socket;
  return { partType, name: part.name, specs };
}

/* ─── Component ─── */

export default function BuilderPage({ navigate }: Props) {
  const [buildName, setBuildName] = useState("");
  const [expandedCat, setExpandedCat] = useState<Category | null>("CPU");
  const [search, setSearch] = useState("");
  const [build, setBuild] = useState<Partial<Record<Category, Part>>>({});

  const [partsByCategory, setPartsByCategory] = useState<Partial<Record<Category, Part[]>>>({});
  const [loadingCat, setLoadingCat] = useState<Category | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const rowRefs = useRef<Partial<Record<Category, HTMLDivElement | null>>>({});

  const totalPrice = Object.values(build).reduce((s, p) => s + (p?.price ?? 0), 0);
  const filledCount = Object.keys(build).length;

  // ── Compatibility & wattage (PCPP-style banner) ──
  const { wattage, issues, status, partsByPartType } = useMemo(() => {
    const partLikes = (CATEGORIES.map((c) => asPartLike(build[c])) as Array<PartLike | null>).filter(Boolean) as PartLike[];
    const w = totalWattage(partLikes);
    // Build a partType-keyed map for compatibility checks.
    const byType: Record<string, PartLike> = {};
    for (const c of CATEGORIES) {
      const pl = asPartLike(build[c]);
      if (pl) byType[pl.partType ?? ""] = pl;
    }
    const iss = checkCompatibility(byType, w);
    return { wattage: w, issues: iss, status: statusFor(iss), partsByPartType: byType };
  }, [build]);

  void partsByPartType; // silence unused lint

  const psuPart = build.PSU;
  const psuWattage = psuPart ? Number(psuPart.rawSpecs?.wattage ?? 0) : 0;
  const psuHeadroom = psuWattage > 0 && wattage > 0 ? Math.round(((psuWattage - wattage) / wattage) * 100) : null;

  /* ─── API fetch ─── */

  async function fetchCategory(cat: Category) {
    if (partsByCategory[cat]) return;
    setLoadingCat(cat);
    setFetchError(null);
    try {
      const base = gatewayBase();
      if (!base) throw new Error("REACT_APP_GATEWAY_URL is not set");
      const partType = CATEGORY_TO_PART_TYPE[cat];
      const token = await auth.currentUser!.getIdToken();
      const url = `${base}/parts?category=${encodeURIComponent(partType)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const parts: Part[] = data.parts.map((doc: any) => ({
        id: doc.id,
        name: doc.name ?? "Unknown",
        category: cat,
        price: doc.price ?? 0,
        specs: buildSpecs(doc, partType),
        partType,
        rawSpecs: doc,
        manufacturer: doc.manufacturer ?? doc.brand ?? null,
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

  function handleFinalize() {
    if (!buildName.trim()) return;
    if (filledCount === 0) return;
    if (status === "error") return;

    // Build the parts payload for POST /builds (handed off to PostFinalizePage).
    const parts: Record<string, { id: string; name: string; price: number; partType: string; specs: string; rawSpecs?: any; }> = {};
    for (const cat of CATEGORIES) {
      const p = build[cat];
      if (p) {
        parts[p.partType] = {
          id: p.id,
          name: p.name,
          price: p.price,
          partType: p.partType,
          specs: p.specs,
          rawSpecs: p.rawSpecs,
        };
      }
    }
    navigate("post-finalize", { buildName: buildName.trim(), parts, totalPrice });
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

  const canFinalize = buildName.trim() !== "" && filledCount > 0 && status !== "error";

  /* ─── Render ─── */

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100 tracking-tight">
            Build Your PC
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
            Name your build, pick parts, and finalize for AI analysis.
          </p>
        </div>
      </div>

      {/* Build name input */}
      <div className="mb-4">
        <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300 uppercase tracking-wide mb-1.5">
          Build Name
        </label>
        <input
          type="text"
          value={buildName}
          onChange={(e) => setBuildName(e.target.value)}
          placeholder="e.g. Streaming Rig 2026, Budget Esports Build"
          maxLength={80}
          className="w-full px-4 py-2.5 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
        />
        {buildName.trim() === "" && (
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1">A name is required to finalize.</p>
        )}
      </div>

      {/* Sticky compatibility/wattage banner — PCPP signature element */}
      <CompatibilityBanner
        wattage={wattage}
        psuWattage={psuWattage}
        psuHeadroom={psuHeadroom}
        totalPrice={totalPrice}
        filledCount={filledCount}
        status={status}
        issues={issues}
      />

      {/* Global fetch error */}
      {fetchError && (
        <div className="mt-4 mb-4 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 text-sm text-red-600 dark:text-red-400">
          {fetchError}
        </div>
      )}

      {/* ── Category rows ── */}
      <div className="space-y-2 mt-6">
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
              <button
                onClick={() => toggleCategory(cat)}
                className="w-full flex items-center gap-3 sm:gap-4 px-4 py-3.5 text-left focus:outline-none group"
              >
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
                    {part && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded">
                        {tdpFor(asPartLike(part))}W
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
                    width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                    className={`text-neutral-300 dark:text-neutral-600 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-neutral-100 dark:border-neutral-800 px-4 pb-4 pt-3">
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
                    <div className="max-h-72 overflow-y-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
                      <table className="w-full text-sm table-fixed">
                        <colgroup>
                          <col />
                          <col className="w-[35%]" />
                          <col className="w-20" />
                          <col className="w-24" />
                          <col className="w-14" />
                        </colgroup>
                        <thead className="text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-950 sticky top-0 z-10">
                          <tr className="text-left border-b border-neutral-200 dark:border-neutral-800">
                            <th className="pl-3 pr-4 py-2 font-semibold">Name</th>
                            <th className="px-2 py-2 font-semibold">Specs</th>
                            <th className="px-2 py-2 font-semibold text-right">TDP</th>
                            <th className="px-2 py-2 font-semibold text-right">Price</th>
                            <th className="pl-2 pr-3 py-2"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                          {filteredParts.map((p) => {
                            const sel = build[cat]?.id === p.id;
                            const tdp = tdpFor({ partType: p.partType === "psu" ? "power-supply" : p.partType === "gpu" ? "video-card" : p.partType, name: p.name });
                            return (
                              <tr
                                key={p.id}
                                onClick={() => (sel ? removePart(cat) : selectPart(p))}
                                className={`cursor-pointer transition-colors ${
                                  sel
                                    ? "bg-orange-50 dark:bg-orange-500/10"
                                    : "hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                                }`}
                              >
                                <td className={`pl-3 pr-4 py-2 font-semibold truncate ${sel ? "text-orange-700 dark:text-orange-300" : "text-neutral-800 dark:text-neutral-200"}`}>
                                  {p.name}
                                </td>
                                <td className="px-2 py-2 text-xs text-neutral-500 dark:text-neutral-400 truncate">
                                  {p.specs || "—"}
                                </td>
                                <td className="px-2 py-2 text-right text-xs text-neutral-500 dark:text-neutral-400 tabular-nums">
                                  {tdp > 0 ? `${tdp}W` : "—"}
                                </td>
                                <td className="px-2 py-2 text-right text-sm font-semibold tabular-nums">
                                  ${p.price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                                </td>
                                <td className="pl-2 pr-3 py-2 text-right">
                                  <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                                    sel
                                      ? "bg-orange-500 text-white"
                                      : "bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300"
                                  }`}>
                                    {sel ? "✓" : "+"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Finalize bar */}
      <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 shadow-sm">
        <div>
          <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
            {!buildName.trim()
              ? "Name your build first"
              : filledCount === 0
              ? "Pick at least one part"
              : status === "error"
              ? "Resolve compatibility errors first"
              : `Ready to finalize — ${filledCount} part${filledCount > 1 ? "s" : ""}, $${totalPrice.toFixed(2)}`}
          </p>
          <p className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">
            Choose analysis options on the next step
          </p>
        </div>
        <button
          type="button"
          onClick={handleFinalize}
          disabled={!canFinalize}
          className={`px-8 py-2.5 text-sm font-semibold rounded-lg transition-all focus:outline-none whitespace-nowrap ${
            canFinalize
              ? "bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white shadow-sm"
              : "bg-neutral-100 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-600 cursor-not-allowed"
          }`}
        >
          Finalize Build →
        </button>
      </div>
    </div>
  );
}

/* ─── Compatibility Banner subcomponent (PCPP signature) ─── */

function CompatibilityBanner({
  wattage, psuWattage, psuHeadroom, totalPrice, filledCount, status, issues,
}: {
  wattage: number;
  psuWattage: number;
  psuHeadroom: number | null;
  totalPrice: number;
  filledCount: number;
  status: "ok" | "warn" | "error";
  issues: Issue[];
}) {
  const [expanded, setExpanded] = useState(false);

  const statusConfig = {
    ok: { color: "green", icon: "✓", label: "No issues" },
    warn: { color: "amber", icon: "⚠", label: `${issues.length} warning${issues.length === 1 ? "" : "s"}` },
    error: { color: "red", icon: "✗", label: `${issues.filter((i) => i.severity === "error").length} error${issues.filter((i) => i.severity === "error").length === 1 ? "" : "s"}` },
  }[status];

  const colorClasses = {
    green: "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 border-green-200 dark:border-green-500/30",
    amber: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30",
    red: "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/30",
  }[statusConfig.color];

  return (
    <div className="sticky top-14 z-30 -mx-4 sm:mx-0">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-none sm:rounded-xl shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <button
            onClick={() => issues.length > 0 && setExpanded(!expanded)}
            disabled={issues.length === 0}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold border ${colorClasses} ${issues.length > 0 ? "cursor-pointer" : "cursor-default"}`}
          >
            <span>{statusConfig.icon}</span>
            <span>{statusConfig.label}</span>
            {issues.length > 0 && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`transition-transform ${expanded ? "rotate-180" : ""}`}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            )}
          </button>

          <Stat label="Wattage" value={wattage > 0 ? `${wattage}W` : "—"} />
          {psuWattage > 0 && (
            <Stat
              label="PSU Headroom"
              value={psuHeadroom !== null ? `${psuHeadroom > 0 ? "+" : ""}${psuHeadroom}%` : "—"}
              tone={psuHeadroom !== null && psuHeadroom < 20 ? "warn" : "default"}
            />
          )}
          <Stat label="Parts" value={`${filledCount}`} />
          <div className="ml-auto text-right">
            <p className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500 uppercase tracking-wider">Total</p>
            <p className="text-lg font-bold tabular-nums text-orange-500">${totalPrice.toFixed(2)}</p>
          </div>
        </div>

        {expanded && issues.length > 0 && (
          <div className="border-t border-neutral-200 dark:border-neutral-800 px-4 py-3 bg-neutral-50 dark:bg-neutral-950 space-y-1.5">
            {issues.map((iss, idx) => (
              <div key={idx} className="flex gap-2 items-start text-xs">
                <span className={iss.severity === "error" ? "text-red-500" : "text-amber-500"}>
                  {iss.severity === "error" ? "✗" : "⚠"}
                </span>
                <span className="text-neutral-700 dark:text-neutral-300">{iss.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "default" | "warn" }) {
  return (
    <div>
      <p className="text-[10px] font-medium text-neutral-400 dark:text-neutral-500 uppercase tracking-wider leading-tight">
        {label}
      </p>
      <p className={`text-sm font-bold tabular-nums leading-tight ${tone === "warn" ? "text-amber-500" : "text-neutral-800 dark:text-neutral-200"}`}>
        {value}
      </p>
    </div>
  );
}
