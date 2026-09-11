"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n";
import { Settings, Info, Check, Loader2 } from "lucide-react";
import { C } from "@/lib/design";
import { useRouter } from "next/navigation";

// stageKey/whyKey, not prose: module scope, no translator here.
const RECOMMENDATIONS = [
  { stageKey: "lim.stage.week1",   range: "8–10",  whyKey: "lim.why.week1" },
  { stageKey: "lim.stage.weeks24", range: "10–15", whyKey: "lim.why.weeks24" },
  { stageKey: "lim.stage.month2",  range: "15–20", whyKey: "lim.why.month2" },
  { stageKey: "lim.stage.veteran", range: "20–30", whyKey: "lim.why.veteran" },
];

export default function LimitEditor({
  sellerId,
  initialLimit,
}: {
  sellerId: string;
  initialLimit: number;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [limit, setLimit] = useState<number>(initialLimit);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const dirty = limit !== initialLimit;

  async function save() {
    if (!dirty || saving) return;
    setSaving(true); setErr(null);
    try {
      const res = await fetch(`/api/sellers/${sellerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkedin_daily_limit: limit }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSavedAt(Date.now());
      router.refresh();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
      <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: C.border }}>
        <Settings size={14} style={{ color: C.textMuted }} />
        <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
          {t("lim.title")}
        </h3>
      </div>

      <div className="p-5">
        <label className="block">
          <span className="text-xs font-semibold" style={{ color: C.textBody }}>
            {t("lim.dailyInvites")}
          </span>
          <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
            {t("lim.dailyInvitesHint")}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <input
              type="number"
              min={1}
              max={100}
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              className="w-24 rounded-lg border px-3 py-2 text-sm tabular-nums focus:outline-none"
              style={{ backgroundColor: C.bg, borderColor: C.border, color: C.textPrimary }}
            />
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="rounded-lg px-3 py-2 text-xs font-semibold transition-opacity disabled:opacity-40"
              style={{
                backgroundColor: dirty ? "var(--brand, #c9a83a)" : C.border,
                color: dirty ? "#fff" : C.textMuted,
              }}
            >
              {saving ? (
                <span className="inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> {t("lim.saving")}</span>
              ) : savedAt && Date.now() - savedAt < 3000 ? (
                <span className="inline-flex items-center gap-1.5"><Check size={12} /> {t("lim.saved")}</span>
              ) : (
                "Save"
              )}
            </button>
          </div>
          {err && <p className="text-[11px] mt-1.5" style={{ color: C.red }}>{t("lim.errorLabel")} {err}</p>}
        </label>

        <div className="mt-5 rounded-xl p-4" style={{ backgroundColor: C.bg, borderColor: C.border, border: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-1.5 mb-3">
            <Info size={12} style={{ color: C.linkedin }} />
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.textBody }}>
              {t("lim.rampTitle")}
            </p>
          </div>
          <div className="space-y-1.5">
            {RECOMMENDATIONS.map((r) => (
              <div key={r.stageKey} className="grid grid-cols-[140px_70px_1fr] gap-3 items-baseline">
                <span className="text-[11px] font-semibold" style={{ color: C.textPrimary }}>{t(r.stageKey)}</span>
                <span className="text-[11px] tabular-nums font-mono" style={{ color: C.linkedin }}>{r.range}/day</span>
                <span className="text-[10px]" style={{ color: C.textMuted }}>{t(r.whyKey)}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] mt-3 leading-relaxed" style={{ color: C.textDim }}>
            {t("lim.burstNote")}
          </p>
        </div>
      </div>
    </div>
  );
}
