import { useState, useEffect } from "react";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { auth } from "./firebase";
import { useTheme } from "./ThemeContext";
import AuthPage from "./pages/AuthPage";
import BuilderPage from "./pages/BuilderPage";
import AnalysisPage from "./pages/AnalysisPage";
import BenchmarkPage from "./pages/BenchmarkPage";
import PostFinalizePage from "./pages/PostFinalizePage";
import ProfilePage from "./pages/ProfilePage";

export type Page = "builder" | "post-finalize" | "analysis" | "benchmark" | "profile";

export interface PageContext {
  buildName?: string;
  parts?: Record<string, any>;
  totalPrice?: number;
  selectedBuildId?: string;
}

export type NavigateFn = (p: Page, ctx?: PageContext) => void;

export default function App() {
  const [page, setPage] = useState<Page>("builder");
  const [pageContext, setPageContext] = useState<PageContext>({});
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return unsub;
  }, []);

  const handleLogout = () => signOut(auth);

  const navigate: NavigateFn = (p, ctx) => {
    setPage(p);
    setPageContext(ctx ?? {});
    setMobileOpen(false);
  };

  if (!authReady) return null;
  if (!user) return <AuthPage />;

  // Top-level nav. "post-finalize" is only reachable from BuilderPage; "profile" via the avatar button on the right.
  const navItems: { key: Page; label: string }[] = [
    { key: "builder", label: "Builder" },
    { key: "analysis", label: "Analysis" },
    { key: "benchmark", label: "Benchmark" },
  ];

  const userInitial = (user.displayName || user.email || "U").charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 transition-colors">
      {/* ── Navbar ── */}
      <nav className="sticky top-0 z-50 border-b border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          {/* Logo */}
          <button
            onClick={() => navigate("builder")}
            className="flex items-center gap-2 focus:outline-none group"
            aria-label="Home"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-orange-500">
              <path d="M12 2L2 7l10 5 10-5-10-5z" fill="currentColor" opacity="0.25" />
              <path d="M2 17l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-sm font-extrabold tracking-[.18em] text-orange-500 group-hover:text-orange-400 transition-colors">
              FORGESPEC
            </span>
          </button>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-0.5">
            {navItems.map((n) => (
              <button
                key={n.key}
                onClick={() => navigate(n.key)}
                className={`relative px-3.5 py-1.5 text-[13px] font-semibold rounded-md transition-colors focus:outline-none ${
                  page === n.key
                    ? "text-orange-500 bg-orange-500/10 dark:bg-orange-500/10"
                    : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                }`}
              >
                {n.label}
              </button>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-md text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 transition-colors focus:outline-none"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                </svg>
              )}
            </button>

            <div className="hidden md:flex items-center gap-2 ml-1 pl-2 border-l border-neutral-200 dark:border-neutral-800">
              <button
                onClick={() => navigate("profile")}
                title={user.email ?? "Profile"}
                aria-label="Open profile"
                className={`group flex items-center gap-2 pr-2 pl-1 py-1 rounded-full transition-colors focus:outline-none ${
                  page === "profile"
                    ? "bg-orange-500/10 ring-1 ring-orange-500/40"
                    : "hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                }`}
              >
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    page === "profile"
                      ? "bg-orange-500 text-white"
                      : "bg-gradient-to-br from-orange-400 to-orange-600 text-white"
                  }`}
                >
                  {userInitial}
                </span>
                <span className="text-xs text-neutral-500 dark:text-neutral-400 max-w-[140px] truncate group-hover:text-neutral-700 dark:group-hover:text-neutral-200">
                  {user.email}
                </span>
              </button>
              <button
                onClick={handleLogout}
                className="text-xs text-neutral-400 dark:text-neutral-500 hover:text-red-500 dark:hover:text-red-400 transition-colors px-2 py-1 rounded focus:outline-none"
              >
                Sign out
              </button>
            </div>

            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 -mr-2 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 focus:outline-none"
              aria-label="Menu"
            >
              {mobileOpen ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
              )}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="md:hidden border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-4 pb-4 pt-2 space-y-0.5">
            {navItems.map((n) => (
              <button
                key={n.key}
                onClick={() => navigate(n.key)}
                className={`w-full text-left px-3 py-2.5 text-sm font-medium rounded-md transition-colors ${
                  page === n.key
                    ? "text-orange-500 bg-orange-500/10"
                    : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/60"
                }`}
              >
                {n.label}
              </button>
            ))}
            <div className="border-t border-neutral-200 dark:border-neutral-800 mt-2 pt-3 flex items-center justify-between">
              <button
                onClick={() => navigate("profile")}
                className="flex items-center gap-2 text-left flex-1 min-w-0"
              >
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 text-white text-xs font-bold flex items-center justify-center shrink-0">
                  {userInitial}
                </span>
                <span className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                  {user.email}
                </span>
              </button>
              <button
                onClick={handleLogout}
                className="text-xs text-neutral-400 hover:text-red-500 dark:hover:text-red-400 transition-colors px-2 py-1 rounded"
              >
                Sign out
              </button>
            </div>
          </div>
        )}
      </nav>

      <main>
        {page === "builder" && <BuilderPage navigate={navigate} />}
        {page === "post-finalize" && <PostFinalizePage navigate={navigate} ctx={pageContext} />}
        {page === "analysis" && <AnalysisPage selectedBuildId={pageContext.selectedBuildId} />}
        {page === "benchmark" && <BenchmarkPage />}
        {page === "profile" && <ProfilePage navigate={navigate} />}
      </main>
    </div>
  );
}
