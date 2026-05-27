"use client";

import { useEffect } from "react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route error boundary]", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border p-6 bg-white shadow-sm text-center">
        <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center mx-auto text-amber-600 text-2xl font-bold">!</div>
        <h2 className="mt-4 text-[16px] font-bold text-slate-900">Something went wrong loading this page.</h2>
        <p className="mt-2 text-[13px] text-slate-600">
          The dashboard hit an unexpected error. The team has been notified — meanwhile, hit reload to try again.
        </p>
        {error.digest && (
          <p className="mt-3 text-[10.5px] tabular-nums text-slate-400">ref: {error.digest}</p>
        )}
        <button
          type="button"
          onClick={() => reset()}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 transition-colors"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
