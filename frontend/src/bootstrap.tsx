import React, { Component, ErrorInfo, ReactNode } from "react";
import type { Root } from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./ThemeContext";

class RootErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("React render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 24,
            fontFamily: "system-ui, sans-serif",
            background: "#fafafa",
            color: "#171717",
            minHeight: "100vh",
          }}
        >
          <h1 style={{ fontSize: 18, marginBottom: 12 }}>Something went wrong</h1>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontSize: 13,
              background: "#fff",
              border: "1px solid #e5e5e5",
              borderRadius: 8,
              padding: 16,
            }}
          >
            {this.state.error.message}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export function mountApp(root: Root) {
  root.render(
    <React.StrictMode>
      <RootErrorBoundary>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </RootErrorBoundary>
    </React.StrictMode>
  );
}
