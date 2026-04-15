export default function AnalysisPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Header */}
      <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100 tracking-tight">
        Build Analysis
      </h1>
      <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1 mb-8 max-w-lg">
        Once you finalize a build, the AI reviews your component choices and
        returns two reports.
      </p>

      {/* How it works — numbered steps */}
      <div className="grid sm:grid-cols-2 gap-4 mb-10">
        <StepCard
          step={1}
          title="Bottleneck Detection"
          description="Gemini inspects your CPU, GPU, RAM, and storage combination and flags mismatches — e.g., a budget GPU paired with a top-tier CPU — with severity ratings."
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-orange-500" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
          }
        />
        <StepCard
          step={2}
          title="Value Optimization"
          description="The optimizer compares your picks to the full catalog and suggests swaps that deliver more performance per dollar at your budget level."
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-orange-500" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* Empty state — clear CTA */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-8 sm:p-14 text-center">
        {/* Icon */}
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-neutral-100 dark:bg-neutral-800 mb-5">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-neutral-400 dark:text-neutral-500" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
          </svg>
        </div>

        <h2 className="text-base font-semibold text-neutral-800 dark:text-neutral-200 mb-1.5">
          No build finalized yet
        </h2>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-sm mx-auto mb-6 leading-relaxed">
          Head to the Builder, pick your components, and click
          <strong className="text-neutral-700 dark:text-neutral-300"> Finalize Build</strong>.
          Your analysis report will appear here automatically.
        </p>

        {/* Preview of what the output will look like */}
        <div className="max-w-xs mx-auto space-y-2 mb-6">
          <div className="h-4 rounded bg-neutral-100 dark:bg-neutral-800 w-full" />
          <div className="h-4 rounded bg-neutral-100 dark:bg-neutral-800 w-4/5" />
          <div className="h-4 rounded bg-neutral-100 dark:bg-neutral-800 w-3/5" />
          <div className="h-8 rounded bg-orange-100 dark:bg-orange-500/10 w-full mt-3" />
        </div>

        <p className="text-xs text-neutral-400 dark:text-neutral-600">
          ↑ Your bottleneck &amp; value reports will render here
        </p>
      </div>
    </div>
  );
}

function StepCard({
  step,
  title,
  description,
  icon,
}: {
  step: number;
  title: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 flex flex-col">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-7 h-7 rounded-md bg-orange-100 dark:bg-orange-500/15 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-orange-500">
            Step {step}
          </span>
          <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{title}</h3>
        </div>
      </div>
      <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed flex-1">
        {description}
      </p>
    </div>
  );
}
