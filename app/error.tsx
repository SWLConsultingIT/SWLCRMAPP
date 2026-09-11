"use client";

import { useEffect } from "react";
import { useLocale } from "@/lib/i18n";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useLocale();
  useEffect(() => {
    console.error("[route error boundary]", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div
        className="max-w-md w-full rounded-2xl border p-6 shadow-sm text-center"
        style={{ backgroundColor: "var(--c-card)", borderColor: "var(--c-border)", boxShadow: "var(--c-shadow)" }}
      >
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto text-2xl font-bold"
          style={{ backgroundColor: "rgba(245,158,11,0.12)", color: "#D97706" }}
        >!</div>
        <h2 className="mt-4 text-[16px] font-bold" style={{ color: "var(--c-textPrimary)" }}>{t("err.genericTitle")}</h2>
        <p className="mt-2 text-[13px]" style={{ color: "var(--c-textBody)" }}>
          {t("err.genericBody")}
        </p>
        {error.digest && (
          <p className="mt-3 text-[10.5px] tabular-nums" style={{ color: "var(--c-textDim)" }}>{t("err.refLabel")} {error.digest}</p>
        )}
        <button
          type="button"
          onClick={() => reset()}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-opacity hover:opacity-90"
          style={{ backgroundColor: "var(--brand, #c9a83a)", color: "#0C0E1B" }}
        >
          {t("err.reload")}
        </button>
      </div>
    </div>
  );
}
