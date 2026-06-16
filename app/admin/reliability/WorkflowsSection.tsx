// n8n Workflows status — shows which SWL-CRM workflows are active, when
// they last ran, and whether the last run failed. Hits the n8n REST API
// (cached 60s) via lib/n8n-workflows-status.ts.

import { Workflow, CheckCircle2, XCircle, AlertCircle, Power, ExternalLink } from "lucide-react";
import { getT } from "@/lib/i18n-server";
import { C } from "@/lib/design";
import { getSwlWorkflowStatuses } from "@/lib/n8n-workflows-status";

const gold = "var(--brand, #c9a83a)";
const N8N_BASE = (process.env.N8N_API_BASE_URL ?? "https://n8n.srv949269.hstgr.cloud").replace(/\/+$/, "");

function formatRelative(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  const diff = Date.now() - t;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "seg";
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default async function WorkflowsSection() {
  const t = await getT();
  const workflows = await getSwlWorkflowStatuses();

  const hasIssues = workflows?.some(w => w.lastExecutionStatus === "error" || !w.active);
  const accentColor = hasIssues ? "#D97706" : C.green;

  return (
    <section className="rounded-2xl border overflow-hidden" style={{
      backgroundColor: C.card,
      borderColor: C.border,
      borderLeftWidth: 4,
      borderLeftColor: accentColor,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 6px 18px -8px rgba(0,0,0,0.06)",
    }}>
      <header className="px-7 py-6 border-b flex items-center gap-3" style={{
        borderColor: C.border,
        background: `linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${accentColor} 3%, ${C.card}) 100%)`,
      }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`,
            color: "#1A1A2E",
            boxShadow: `0 3px 8px -2px color-mix(in srgb, ${gold} 30%, transparent)`,
          }}>
          <Workflow size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-[17px] font-bold leading-tight" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>
            {t("rel.workflows.title")}
          </h2>
          <p className="text-[11.5px] mt-0.5" style={{ color: C.textMuted }}>{t("rel.workflows.subtitle")}</p>
        </div>
      </header>

      {workflows === null ? (
        <div className="px-7 py-5 text-[12.5px]" style={{ color: C.textMuted }}>
          {t("rel.workflows.empty")}
        </div>
      ) : workflows.length === 0 ? (
        <div className="px-7 py-5 text-[12.5px]" style={{ color: C.textMuted }}>
          No SWL-CRM workflows found in n8n.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px" style={{ backgroundColor: C.border }}>
          {workflows.map(w => {
            const failed = w.lastExecutionStatus === "error";
            const inactive = !w.active;
            const tone = failed
              ? { fg: "#DC2626", bg: "color-mix(in srgb, #DC2626 6%, transparent)", border: "color-mix(in srgb, #DC2626 28%, transparent)", icon: XCircle }
              : inactive
                ? { fg: "#D97706", bg: "color-mix(in srgb, #D97706 6%, transparent)", border: "color-mix(in srgb, #D97706 28%, transparent)", icon: Power }
                : { fg: C.green, bg: `color-mix(in srgb, ${C.green} 6%, transparent)`, border: `color-mix(in srgb, ${C.green} 28%, transparent)`, icon: CheckCircle2 };
            const StatusIcon = tone.icon;
            const rel = formatRelative(w.lastExecutionAt);
            const lastLabel = !rel
              ? t("rel.workflows.lastRun.empty")
              : failed
                ? t("rel.workflows.lastRun.failed", { when: rel })
                : t("rel.workflows.lastRun", { when: rel });
            return (
              <a key={w.id} href={`${N8N_BASE}/workflow/${w.id}`} target="_blank" rel="noreferrer"
                className="p-5 flex items-center gap-3 transition-colors hover:bg-[color-mix(in_srgb,var(--brand,_#c9a83a)_3%,transparent)]"
                style={{ backgroundColor: C.card }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg }}>
                  <StatusIcon size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className="text-[12.5px] font-bold leading-tight truncate" style={{ color: C.textPrimary }}>{w.name}</p>
                    <span className="text-[9px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: tone.bg, color: tone.fg, border: `1px solid ${tone.border}` }}>
                      {w.active ? t("rel.workflows.state.active") : t("rel.workflows.state.inactive")}
                    </span>
                  </div>
                  <p className="text-[10.5px]" style={{ color: failed ? "#DC2626" : C.textMuted }}>{lastLabel}</p>
                </div>
                <ExternalLink size={11} style={{ color: C.textMuted }} />
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}
