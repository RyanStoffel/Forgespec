import { useState, type ReactNode } from "react";
import { auth } from "../firebase";
import type { NavigateFn, PageContext } from "../App";

interface Props {
  navigate: NavigateFn;
  ctx: PageContext;
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
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          No build to finalize. Go back to the Builder.
        </p>
        <button
          onClick={() => navigate("builder")}
          className="mt-4 px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600"
        >
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
      // DIAGNOSTIC: log the UID + a snippet of the token so we can compare to backend
      console.log("[PostFinalize] auth.currentUser.uid =", auth.currentUser!.uid);
      console.log("[PostFinalize] token (first 40 chars) =", token.slice(0, 40) + "...");
      // Decode the token client-side to see its claims
      try {
        const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        console.log("[PostFinalize] decoded token sub=", payload.sub, "user_id=", payload.user_id, "iss=", payload.iss);
      } catch (e) { console.log("[PostFinalize] could not decode token", e); }
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
      <div className="mb-2">
        <button
          onClick={() => navigate("builder")}
          disabled={submitting !== null}
          className="text-xs text-neutral-500 dark:text-neutral-400 hover:text-orange-500 disabled:opacity-50 inline-flex items-center gap-1"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Back to Builder
        </button>
      </div>

      <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100 tracking-tight">
        Finalize: <span className="text-orange-500">{ctx.buildName}</span>
      </h1>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 mb-6 max-w-lg">
        Choose how to process this build. You can re-trigger any missing analysis later from your Profile.
      </p>

      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 mb-6 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1">Build Summary</p>
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            <span className="font-semibold">{partCount}</span> parts selected
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1">Total</p>
          <p className="text-lg font-bold text-orange-500">${(ctx.totalPrice ?? 0).toFixed(2)}</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ActionCard
          icon={<BoltIcon />}
          title="Run Bottleneck Analysis"
          subtitle="Detect CPU/GPU/RAM/PSU bottlenecks with Gemini"
          variant="primary"
          loading={submitting === "bottleneck"}
          disabled={submitting !== null}
          onClick={() => submit(["bottleneck"], "bottleneck")}
        />
        <ActionCard
          icon={<TagIcon />}
          title="Run Value Optimization"
          subtitle="Suggest better-value parts at the same budget"
          variant="primary"
          loading={submitting === "optimization"}
          disabled={submitting !== null}
          onClick={() => submit(["optimization"], "optimization")}
        />
        <ActionCard
          icon={<SparkleIcon />}
          title="Run Both Analyses"
          subtitle="Pub/Sub fan-out — bottleneck + optimization in parallel"
          variant="outline"
          loading={submitting === "both"}
          disabled={submitting !== null}
          onClick={() => submit(["bottleneck", "optimization"], "both")}
        />
        <ActionCard
          icon={<SaveIcon />}
          title="Save Without Analyzing"
          subtitle="Just store the build for later"
          variant="neutral"
          loading={submitting === "save"}
          disabled={submitting !== null}
          onClick={() => submit([], "save")}
        />
      </div>
    </div>
  );
}

function ActionCard({
  icon, title, subtitle, variant, loading, disabled, onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  variant: "primary" | "outline" | "neutral";
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const styles =
    variant === "primary"
      ? "bg-orange-500 hover:bg-orange-600 text-white border-orange-500"
      : variant === "outline"
      ? "bg-white dark:bg-neutral-900 hover:bg-orange-50 dark:hover:bg-orange-500/10 text-orange-600 dark:text-orange-500 border-orange-500"
      : "bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 border-neutral-300 dark:border-neutral-700";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-left p-5 rounded-xl border-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex gap-3 items-start ${styles}`}
    >
      <span className="shrink-0 mt-0.5">{loading ? <Spinner /> : icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-bold leading-tight">{loading ? "Working..." : title}</p>
        <p className="text-xs mt-1 opacity-80">{subtitle}</p>
      </div>
    </button>
  );
}

function BoltIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
    </svg>
  );
}
function TagIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.659A2.25 2.25 0 009.568 3z" />
      <path d="M6 6h.008v.008H6V6z" />
    </svg>
  );
}
function SparkleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3zM18 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" />
    </svg>
  );
}
function SaveIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25M9 19.5l3 3m0 0l3-3m-3 3v-7.5" />
      <path d="M5.625 21.375h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9 9 9 0 00-9 9v9c0 .621.504 1.125 1.125 1.125z" />
    </svg>
  );
}
function Spinner() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}
