import { useState, useEffect } from "react";
import { auth, db } from "../firebase";
import { collection, getDocs } from "firebase/firestore";

type AssessmentType = "bottleneck" | "optimization";

interface AssessmentData {
  analysis?: any;
  suggestions?: any;
  createdAt?: any;
}

interface Build {
  id: string;
  parts: any;
  totalPrice: number;
  bottleneckAnalysis?: AssessmentData;
  valueOptimization?: AssessmentData;
}

export default function AnalysisPage() {
  const [builds, setBuilds] = useState<Build[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AssessmentType>("bottleneck");

  useEffect(() => {
    fetchBuilds();
  }, []);

  async function fetchBuilds() {
    try {
      const user = auth.currentUser;
      if (!user) return;

      const buildsRef = collection(db, "users", user.uid, "builds");
      const snapshot = await getDocs(buildsRef);

      const buildsList: Build[] = [];

      for (const doc of snapshot.docs) {
        const buildData = doc.data();
        const assessmentsRef = collection(doc.ref, "assessments");
        const assessmentsSnap = await getDocs(assessmentsRef);

        const assessments: Record<string, AssessmentData> = {};
        assessmentsSnap.docs.forEach((assessDoc) => {
          assessments[assessDoc.id] = assessDoc.data();
        });

        buildsList.push({
          id: doc.id,
          parts: buildData.parts || [],
          totalPrice: buildData.totalPrice || 0,
          bottleneckAnalysis: assessments.bottleneck,
          valueOptimization: assessments.optimization,
        });
      }

      setBuilds(buildsList);
      if (buildsList.length > 0) {
        setSelectedBuildId(buildsList[0].id);
      }
    } catch (err) {
      console.error("Error fetching builds:", err);
    } finally {
      setLoading(false);
    }
  }

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
                    <p className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 mb-1 truncate">
                      {build.id.slice(0, 8)}
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400">
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

  const data = analysis.analysis || {};

  return (
    <div className="bg-white dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden">
      <div className="p-6 border-b border-neutral-200 dark:border-neutral-800">
        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-orange-500" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
          </svg>
          Bottleneck Analysis
        </h3>
      </div>
      <div className="p-6 space-y-4">
        {typeof data === "string" ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">{data}</p>
        ) : Object.keys(data).length > 0 ? (
          Object.entries(data).map(([key, value]) => (
            <div key={key}>
              <p className="text-xs font-semibold text-orange-500 uppercase tracking-wide mb-1">
                {key.replace(/_/g, " ")}
              </p>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                {typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}
              </p>
            </div>
          ))
        ) : (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No detailed analysis available</p>
        )}
      </div>
    </div>
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

  const data = optimization.suggestions || {};

  return (
    <div className="bg-white dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden">
      <div className="p-6 border-b border-neutral-200 dark:border-neutral-800">
        <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-orange-500" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Price Optimization
        </h3>
      </div>
      <div className="p-6 space-y-4">
        {typeof data === "string" ? (
          <p className="text-sm text-neutral-600 dark:text-neutral-400 whitespace-pre-wrap">{data}</p>
        ) : Object.keys(data).length > 0 ? (
          Object.entries(data).map(([key, value]) => (
            <div key={key}>
              <p className="text-xs font-semibold text-orange-500 uppercase tracking-wide mb-1">
                {key.replace(/_/g, " ")}
              </p>
              <p className="text-sm text-neutral-600 dark:text-neutral-400">
                {typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)}
              </p>
            </div>
          ))
        ) : (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No optimization suggestions available</p>
        )}
      </div>
    </div>
  );
}
