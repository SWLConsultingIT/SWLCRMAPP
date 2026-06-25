"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function DashboardSubrouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard subroute error]", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div
        className="max-w-xl w-full rounded-2xl border p-6 shadow-sm text-center"
        style={{ backgroundColor: "var(--c-card)", borderColor: "var(--c-border)", boxShadow: "var(--c-shadow)" }}
      >
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto text-2xl font-bold"
          style={{ backgroundColor: "rgba(245,158,11,0.12)", color: "#D97706" }}
        >!</div>
        <h2 className="mt-4 text-[16px] font-bold" style={{ color: "var(--c-textPrimary)" }}>Couldn’t load this detail page.</h2>
        <p className="mt-2 text-[13px]" style={{ color: "var(--c-textBody)" }}>
          We hit an unexpected error pulling the data for this view. Reload to retry, or go back to the dashboard.
        </p>
        {/* Inline message + digest — exposed so we can diagnose live without
            spelunking Vercel logs. Safe: error.message in production is the
            cleaned-up React message (no stack). */}
        {error.message && (
          <pre
            className="mt-3 text-[10.5px] text-left border rounded-md p-2 max-h-32 overflow-auto whitespace-pre-wrap break-all"
            style={{ color: "var(--c-textBody)", backgroundColor: "var(--c-bg)", borderColor: "var(--c-border)" }}
          >
            {error.message}
          </pre>
        )}
        {error.digest && (
          <p className="mt-2 text-[10.5px] tabular-nums" style={{ color: "var(--c-textDim)" }}>ref: {error.digest}</p>
        )}
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--brand, #c9a83a)", color: "#0C0E1B" }}
          >
            Reload
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[13px] font-semibold transition-opacity hover:opacity-85"
            style={{ color: "var(--c-textBody)", borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}
          >
            <ArrowLeft size={13} /> Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
