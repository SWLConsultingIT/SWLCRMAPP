"use client";

// Compact NEXT ACTION for the lead hero — the single most important "what do I
// do now?" signal. Derived server-side from the SAME activities the Activities
// tab uses (no extra query); this is display + quick-add only, full management
// lives in the Activities tab. Add reuses the universal ActivityComposer.

import { useState } from "react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { Zap, Plus, Phone, RefreshCw, Mail, MessageSquare, Users, FileText, ListTodo, Clock } from "lucide-react";
import CallButton from "@/components/CallButton";
import ActivityComposer from "@/components/ActivityComposer";

const gold = "var(--brand, #c9a83a)";

const TYPE_ICON: Record<string, React.ElementType> = {
  call: Phone, follow_up: RefreshCw, email: Mail, message: MessageSquare, meeting: Users, send_proposal: FileText, task: ListTodo,
};

export type HeroNext = {
  id: string; title: string; type: string; dueAt: string | null; dueTz: string | null;
  bucket: "overdue" | "today" | "upcoming" | "no_date" | "completed" | "cancelled"; isCallback: boolean;
} | null;

export default function HeroNextAction({
  nextAction, leadId, leadLabel, company, leadPhone, leadCountry, terminalLead, canAssignActivities, localeTag,
}: {
  nextAction: HeroNext; leadId: string; leadLabel: string; company: string | null;
  leadPhone: string | null; leadCountry: string | null; terminalLead: boolean;
  canAssignActivities: boolean; localeTag: string;
}) {
  const { t } = useLocale();
  const [composer, setComposer] = useState(false);

  const color = nextAction
    ? (nextAction.isCallback ? C.orange : nextAction.bucket === "overdue" ? C.red : nextAction.bucket === "today" ? gold : nextAction.bucket === "upcoming" ? C.blue : C.textMuted)
    : C.textMuted;

  const dueLabel = nextAction?.dueAt
    ? new Date(nextAction.dueAt).toLocaleString(localeTag, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: nextAction.dueTz || undefined })
    : null;

  const Icon = nextAction ? (TYPE_ICON[nextAction.type] ?? ListTodo) : Zap;

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: C.textDim }}>{t("ld2.next")}</span>
      {nextAction ? (
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${color} 13%, transparent)`, color }}>
            <Icon size={13} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[13px] font-bold truncate max-w-[240px]" style={{ color: C.textPrimary }}>{nextAction.title}</span>
              {nextAction.isCallback && <span className="text-[8.5px] font-bold uppercase tracking-wider px-1 py-0.5 rounded" style={{ background: `color-mix(in srgb, ${C.orange} 15%, transparent)`, color: C.orange }}>{t("activities.callback")}</span>}
            </div>
            {dueLabel && <span className="inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums" style={{ color }}><Clock size={10} /> {dueLabel}</span>}
          </div>
          {nextAction.type === "call" && leadPhone && (
            <CallButton phone={leadPhone} leadId={leadId} size="sm" variant="soft" accent={gold} pulse={false} label={t("activities.callNow")} />
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-[12.5px]" style={{ color: terminalLead ? C.textDim : C.textMuted }}>{t("activities.noNext")}</span>
          {!terminalLead && (
            <button onClick={() => setComposer(true)} className="inline-flex items-center gap-1 text-[12px] font-bold rounded-lg px-2 py-1" style={{ background: `color-mix(in srgb, ${gold} 14%, transparent)`, color: "#8a6b18" }}>
              <Plus size={12} /> {t("activities.add")}
            </button>
          )}
        </div>
      )}
      {composer && (
        <ActivityComposer mode="drawer" open canAssignOthers={canAssignActivities}
          context={{ leadId, leadLabel, company, contactCountry: leadCountry, source: "lead_detail" }}
          onClose={() => setComposer(false)} onCreated={() => setComposer(false)} />
      )}
    </div>
  );
}
