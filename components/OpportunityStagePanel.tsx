"use client";

import { useState } from "react";
import { CheckCircle, Calendar, FileText, Loader2, Trophy } from "lucide-react";
import { C } from "@/lib/design";
import { OPP_STAGES as STAGES, normalizeStage, stageLabel } from "@/lib/opportunity-stages";
import { useLocale } from "@/lib/i18n";

type Props = {
  leadId: string;
  initialStage?: string | null;
  initialNotes?: string | null;
  initialNextAction?: string | null;
  transferred?: boolean;
};

export default function OpportunityStagePanel({ leadId, initialStage, initialNotes, initialNextAction, transferred = false }: Props) {
  const { t } = useLocale();
  const [stage, setStage]           = useState(normalizeStage(initialStage));
  const [notes, setNotes]           = useState(initialNotes ?? "");
  const [nextAction, setNextAction] = useState(initialNextAction ?? "");
  const [saving, setSaving]         = useState(false);
  const [saved, setSaved]           = useState(false);
  const [error, setError]           = useState("");

  async function save(patch: Record<string, string>) {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const res = await fetch(`/api/leads/${leadId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error?.includes("column") ? "Run DB migration first (see console)" : "Failed to save");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  }

  const currentStage = STAGES.find(s => s.id === stage) ?? STAGES[0];

  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
        <div className="flex items-center gap-2">
          <CheckCircle size={13} style={{ color: C.green }} />
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{t("oppPanel.title")}</h3>
        </div>
        <div className="flex items-center gap-2">
          {transferred && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ backgroundColor: C.greenLight, color: C.green }}>
              <Trophy size={9} /> {t("oppPanel.sentToOdoo")}
            </span>
          )}
          {saving && <Loader2 size={12} className="animate-spin" style={{ color: C.textDim }} />}
          {saved && <span className="text-[10px] font-medium" style={{ color: C.green }}>{t("oppPanel.saved")}</span>}
          {error && <span className="text-[10px] font-medium" style={{ color: C.red }}>{error}</span>}
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Stage selector */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: C.textDim }}>{t("oppPanel.stage")}</p>
          <div className="flex flex-wrap gap-2">
            {STAGES.map((s, i) => {
              const isActive = stage === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => { setStage(s.id); save({ opportunity_stage: s.id }); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-[opacity,transform,box-shadow,background-color,border-color]"
                  style={{
                    backgroundColor: isActive ? `${s.color}15` : C.surface,
                    color:           isActive ? s.color : C.textMuted,
                    border:          `1px solid ${isActive ? s.color + "40" : "transparent"}`,
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: isActive ? s.color : C.textDim }} />
                  {i + 1}. {stageLabel(s, t)}
                </button>
              );
            })}
          </div>

          {/* Progress bar */}
          <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: C.border }}>
            <div
              className="h-full rounded-full transition-[opacity,transform,box-shadow,background-color,border-color] duration-500"
              style={{
                width: `${((STAGES.findIndex(s => s.id === stage) + 1) / STAGES.length) * 100}%`,
                backgroundColor: currentStage.color,
              }}
            />
          </div>
          <p className="text-[10px] mt-1.5 text-right" style={{ color: C.textDim }}>
            {t("oppPanel.stepOf", { n: STAGES.findIndex(s => s.id === stage) + 1, total: STAGES.length })}
          </p>
        </div>

        {/* Next action */}
        <div>
          <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: C.textDim }}>
            <Calendar size={10} /> {t("oppPanel.nextAction")}
          </label>
          <input
            value={nextAction}
            onChange={e => setNextAction(e.target.value)}
            onBlur={() => save({ opportunity_next_action: nextAction })}
            placeholder={t("oppPanel.nextActionPh")}
            className="w-full px-3 py-2 rounded-lg border text-xs outline-none transition-[opacity,transform,box-shadow,background-color,border-color]"
            style={{
              backgroundColor: C.cardHov,
              borderColor: C.border,
              color: C.textBody,
            }}
            onFocus={e => { e.currentTarget.style.borderColor = currentStage.color + "60"; }}
          />
        </div>

        {/* Notes */}
        <div>
          <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: C.textDim }}>
            <FileText size={10} /> {t("oppPanel.notes")}
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={() => save({ opportunity_notes: notes })}
            placeholder={t("oppPanel.notesPh")}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border text-xs outline-none transition-[opacity,transform,box-shadow,background-color,border-color] resize-none"
            style={{
              backgroundColor: C.cardHov,
              borderColor: C.border,
              color: C.textBody,
            }}
            onFocus={e => { e.currentTarget.style.borderColor = currentStage.color + "60"; }}
          />
        </div>
      </div>
    </div>
  );
}
