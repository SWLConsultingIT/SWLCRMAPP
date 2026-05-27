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
      <div className="max-w-xl w-full rounded-2xl border p-6 bg-white shadow-sm text-center">
        <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center mx-auto text-amber-600 text-2xl font-bold">!</div>
        <h2 className="mt-4 text-[16px] font-bold text-slate-900">Couldn’t load this detail page.</h2>
        <p className="mt-2 text-[13px] text-slate-600">
          We hit an unexpected error pulling the data for this view. Reload to retry, or go back to the dashboard.
        </p>
        {/* Inline message + digest — exposed so we can diagnose live without
            spelunking Vercel logs. Safe: error.message in production is the
            cleaned-up React message (no stack). */}
        {error.message && (
          <pre className="mt-3 text-[10.5px] text-left text-slate-600 bg-slate-50 border border-slate-200 rounded-md p-2 max-h-32 overflow-auto whitespace-pre-wrap break-all">
            {error.message}
          </pre>
        )}
        {error.digest && (
          <p className="mt-2 text-[10.5px] tabular-nums text-slate-400">ref: {error.digest}</p>
        )}
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors"
          >
            Reload
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[13px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <ArrowLeft size={13} /> Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
