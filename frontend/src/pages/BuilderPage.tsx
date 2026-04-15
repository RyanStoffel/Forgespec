import { useState, useEffect, useRef } from "react";

/* ─── Data ─── */

const CATEGORIES = ["CPU", "GPU", "Motherboard", "RAM", "Storage", "PSU", "Case", "Cooler"] as const;
type Category = (typeof CATEGORIES)[number];

interface Part {
  id: string;
  name: string;
  category: Category;
  price: number;
  specs: string;
}

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

const MOCK_PARTS: Part[] = [
  { id: "cpu-1", name: "AMD Ryzen 9 7950X", category: "CPU", price: 549, specs: "16C/32T · 4.5 GHz base · 5.7 GHz boost · 170W" },
  { id: "cpu-2", name: "Intel Core i9-14900K", category: "CPU", price: 569, specs: "24C/32T · 3.2 GHz base · 6.0 GHz boost · 125W" },
  { id: "cpu-3", name: "AMD Ryzen 7 7800X3D", category: "CPU", price: 349, specs: "8C/16T · 4.2 GHz base · 5.0 GHz boost · 120W" },
  { id: "cpu-4", name: "Intel Core i7-14700K", category: "CPU", price: 384, specs: "20C/28T · 3.4 GHz base · 5.6 GHz boost · 125W" },
  { id: "gpu-1", name: "NVIDIA RTX 4090", category: "GPU", price: 1599, specs: "24 GB GDDR6X · 2520 MHz boost · 450W" },
  { id: "gpu-2", name: "NVIDIA RTX 4070 Ti Super", category: "GPU", price: 799, specs: "16 GB GDDR6X · 2610 MHz boost · 285W" },
  { id: "gpu-3", name: "AMD RX 7900 XTX", category: "GPU", price: 949, specs: "24 GB GDDR6 · 2500 MHz boost · 355W" },
  { id: "gpu-4", name: "NVIDIA RTX 4060 Ti", category: "GPU", price: 399, specs: "8 GB GDDR6 · 2535 MHz boost · 160W" },
  { id: "mb-1", name: "ASUS ROG Crosshair X670E Hero", category: "Motherboard", price: 699, specs: "AM5 · DDR5 · PCIe 5.0 · Wi-Fi 6E" },
  { id: "mb-2", name: "MSI MAG Z790 Tomahawk", category: "Motherboard", price: 259, specs: "LGA 1700 · DDR5 · PCIe 5.0 · 2.5G LAN" },
  { id: "mb-3", name: "Gigabyte B650 Aorus Elite AX", category: "Motherboard", price: 179, specs: "AM5 · DDR5 · PCIe 4.0 · Wi-Fi 6E" },
  { id: "ram-1", name: "G.Skill Trident Z5 RGB 32 GB", category: "RAM", price: 124, specs: "2×16 GB · DDR5-6000 · CL30 · 1.35V" },
  { id: "ram-2", name: "Corsair Vengeance 64 GB", category: "RAM", price: 209, specs: "2×32 GB · DDR5-5600 · CL36 · 1.25V" },
  { id: "ram-3", name: "Kingston Fury Beast 32 GB", category: "RAM", price: 97, specs: "2×16 GB · DDR5-5200 · CL36 · 1.25V" },
  { id: "st-1", name: "Samsung 990 Pro 2 TB", category: "Storage", price: 159, specs: "NVMe M.2 · 7450 / 6900 MB/s · TLC" },
  { id: "st-2", name: "WD Black SN850X 1 TB", category: "Storage", price: 89, specs: "NVMe M.2 · 7300 / 6300 MB/s · TLC" },
  { id: "st-3", name: "Crucial T700 2 TB", category: "Storage", price: 224, specs: "NVMe M.2 PCIe 5.0 · 12400 / 11800 MB/s" },
  { id: "psu-1", name: "Corsair RM1000x", category: "PSU", price: 189, specs: "1000W · 80+ Gold · Fully Modular · ATX 3.0" },
  { id: "psu-2", name: "EVGA SuperNOVA 850 G7", category: "PSU", price: 149, specs: "850W · 80+ Gold · Fully Modular" },
  { id: "psu-3", name: "Seasonic PRIME TX-1000", category: "PSU", price: 299, specs: "1000W · 80+ Titanium · Fully Modular" },
  { id: "case-1", name: "Lian Li O11 Dynamic EVO", category: "Case", price: 169, specs: "Mid Tower · Tempered Glass · ATX" },
  { id: "case-2", name: "Fractal Design Torrent", category: "Case", price: 189, specs: "Mid Tower · Open Airflow · ATX" },
  { id: "case-3", name: "NZXT H7 Flow", category: "Case", price: 129, specs: "Mid Tower · Mesh Front · ATX" },
  { id: "cool-1", name: "Noctua NH-D15", category: "Cooler", price: 109, specs: "Air · Dual Tower · 250W TDP" },
  { id: "cool-2", name: "Corsair iCUE H150i Elite", category: "Cooler", price: 169, specs: "AIO 360 mm · LCD Display" },
  { id: "cool-3", name: "Arctic Liquid Freezer II 280", category: "Cooler", price: 94, specs: "AIO 280 mm · VRM Fan" },
];

/* ─── Component ─── */

export default function BuilderPage() {
  const [expandedCat, setExpandedCat] = useState<Category | null>("CPU");
  const [search, setSearch] = useState("");
  const [build, setBuild] = useState<Partial<Record<Category, Part>>>({});
  const rowRefs = useRef<Partial<Record<Category, HTMLDivElement | null>>>({});

  const totalPrice = Object.values(build).reduce((s, p) => s + (p?.price ?? 0), 0);
  const filledCount = Object.keys(build).length;

  const selectPart = (part: Part) => {
    setBuild((prev) => ({ ...prev, [part.category]: part }));
    // Auto-advance: after picking, jump to the next empty category
    const idx = CATEGORIES.indexOf(part.category);
    const next = CATEGORIES.slice(idx + 1).find((c) => !build[c] && c !== part.category);
    setTimeout(() => {
      if (next) {
        setExpandedCat(next);
        rowRefs.current[next]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } else {
        setExpandedCat(null); // all done
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
    setExpandedCat((prev) => (prev === cat ? null : cat));
    setSearch("");
  };

  // Filter parts for expanded category
  const filteredParts =
    expandedCat
      ? MOCK_PARTS.filter(
          (p) =>
            p.category === expandedCat &&
            (search === "" ||
              p.name.toLowerCase().includes(search.toLowerCase()) ||
              p.specs.toLowerCase().includes(search.toLowerCase()))
        )
      : [];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100 tracking-tight">
            Build Your PC
          </h1>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
            Select a component for each slot. {filledCount < CATEGORIES.length
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
              {filledCount}<span className="text-sm font-normal text-neutral-400">/{CATEGORIES.length}</span>
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

      {/* ── Category rows (PCPartPicker-style checklist) ── */}
      <div className="space-y-2">
        {CATEGORIES.map((cat, i) => {
          const part = build[cat];
          const isExpanded = expandedCat === cat;
          const isNext = !part && expandedCat === null && CATEGORIES.findIndex((c) => !build[c]) === i;

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
              {/* Row header — always visible */}
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
                    <span className={`text-sm font-semibold ${
                      part
                        ? "text-neutral-900 dark:text-neutral-100"
                        : "text-neutral-600 dark:text-neutral-400"
                    }`}>
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
                        ${part.price}
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

                  {/* Parts list */}
                  {filteredParts.length === 0 ? (
                    <p className="text-center text-sm text-neutral-400 dark:text-neutral-500 py-6">
                      No {cat} parts match "{search}"
                    </p>
                  ) : (
                    <div className="space-y-1">
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
                              <p className={`text-sm font-medium truncate ${
                                sel ? "text-orange-700 dark:text-orange-300" : "text-neutral-800 dark:text-neutral-200"
                              }`}>
                                {p.name}
                              </p>
                              <p className="text-xs text-neutral-400 dark:text-neutral-500 truncate mt-0.5">
                                {p.specs}
                              </p>
                            </div>

                            {/* Price */}
                            <span className="text-sm font-semibold tabular-nums text-neutral-700 dark:text-neutral-300 shrink-0">
                              ${p.price}
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
          disabled={filledCount === 0}
          className={`px-8 py-2.5 text-sm font-semibold rounded-lg transition-all focus:outline-none whitespace-nowrap ${
            filledCount === CATEGORIES.length
              ? "bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white shadow-sm"
              : filledCount > 0
              ? "bg-orange-500/80 hover:bg-orange-500 text-white"
              : "bg-neutral-100 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-600 cursor-not-allowed"
          }`}
        >
          Finalize Build →
        </button>
      </div>
    </div>
  );
}
