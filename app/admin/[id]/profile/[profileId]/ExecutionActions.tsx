"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { Clock, Upload, CheckCircle, Loader2 } from "lucide-react";

// Module scope: `key` is the stored execution_status, `labelKey` is the label.
const steps = [
  { key: "not_started",  labelKey: "exa.notStarted",    color: C.textMuted, bg: C.surface,    icon: Clock },
  { key: "in_progress",  labelKey: "exa.inProgress",    color: "#D97706",   bg: "color-mix(in srgb, #D97706 13%, transparent)",    icon: Clock },
  { key: "uploaded",     labelKey: "exa.leadsUploaded", color: C.blue,      bg: C.blueLight,  icon: Upload },
  { key: "completed",    labelKey: "exa.completed",     color: C.green,     bg: C.greenLight, icon: CheckCircle },
];

export default function ExecutionActions({ id, currentStatus, leadsUploaded }: {
  id: string;
  currentStatus: string;
  leadsUploaded: number;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const [acting, setActing] = useState(false);
  const [count, setCount] = useState(leadsUploaded);
  const [showCountInput, setShowCountInput] = useState(false);

  async function updateStatus(status: string, extras?: { leads_uploaded?: number }) {
    setActing(true);
    const r = await fetch("/api/icp/execution-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, ...(extras ?? {}) }),
    });
    setActing(false);
    setShowCountInput(false);
    if (!r.ok) {
      const { error } = await r.json().catch(() => ({ error: "Request failed" }));
      alert(t("exa.updateFailed", { error: error ?? t("exa.unknownError") }));
      return;
    }
    router.refresh();
  }

  const currentIdx = steps.findIndex(s => s.key === currentStatus);

  return (
    <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <h3 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>{t("exa.executionStatus")}</h3>

      {/* Progress steps */}
      <div className="flex items-center gap-1 mb-5">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const isActive = step.key === currentStatus;
          const isDone = i <= currentIdx;
          return (
            <div key={step.key} className="flex items-center gap-1 flex-1">
              <div className="flex items-center gap-2 flex-1">
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: isDone ? step.bg : C.surface }}>
                  <Icon size={13} style={{ color: isDone ? step.color : C.textDim }} />
                </div>
                <span className="text-xs font-medium truncate"
                  style={{ color: isActive ? step.color : isDone ? C.textBody : C.textDim }}>
                  {t(step.labelKey)}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className="w-6 h-0.5 shrink-0" style={{ backgroundColor: i < currentIdx ? step.color : C.border }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {currentStatus === "not_started" && (
          <button onClick={() => updateStatus("in_progress")} disabled={acting}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity disabled:opacity-50"
            style={{ backgroundColor: "color-mix(in srgb, #D97706 13%, transparent)", color: "#D97706" }}>
            {acting ? <Loader2 size={12} className="animate-spin" /> : <Clock size={12} />}
            {t("exa.markInProgress")}
          </button>
        )}
        {currentStatus === "in_progress" && (
          <button onClick={() => setShowCountInput(true)} disabled={acting}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity disabled:opacity-50"
            style={{ backgroundColor: C.blueLight, color: C.blue }}>
            <Upload size={12} /> {t("exa.markUploaded")}
          </button>
        )}
        {currentStatus === "uploaded" && (
          <button onClick={() => updateStatus("completed")} disabled={acting}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity disabled:opacity-50"
            style={{ backgroundColor: C.greenLight, color: C.green }}>
            {acting ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
            {t("exa.markCompleted")}
          </button>
        )}
        {currentStatus === "completed" && (
          <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: C.green }}>
            <CheckCircle size={13} /> {t("exa.doneUploaded", { n: leadsUploaded })}
          </span>
        )}

        {/* Leads count input */}
        {showCountInput && (
          <div className="flex items-center gap-2">
            <input type="number" className="w-24 rounded-lg border px-3 py-2 text-sm focus:outline-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
              value={count} onChange={e => setCount(Number(e.target.value))}
              placeholder={t("exa.leadsPh")} min={0} />
            <button onClick={() => updateStatus("uploaded", { leads_uploaded: count })} disabled={acting}
              className="rounded-lg px-4 py-2 text-xs font-semibold"
              style={{ backgroundColor: C.blue, color: "#fff" }}>
              {acting ? <Loader2 size={12} className="animate-spin" /> : t("exa.confirm")}
            </button>
            <button onClick={() => setShowCountInput(false)} className="text-xs" style={{ color: C.textMuted }}>{t("exa.cancel")}</button>
          </div>
        )}
      </div>

    </div>
  );
}
