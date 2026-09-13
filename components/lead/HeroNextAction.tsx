"use client";

// NEXT ACTION module — the heart of the Seller Command Card. A differentiated
// surface (color = urgency: overdue red · callback orange · today gold · upcoming
// blue · none neutral) that answers "what do I do now?" at a glance and lets the
// seller act without leaving the hero: Call now / Complete / Reschedule / Add.
//
// Data comes from the SAME server-seeded activities the Activities tab uses (no
// extra query). Mutations reuse the exact endpoints the Activities panel uses
// (PATCH /api/activities/:id) so hero + tab stay in sync via router.refresh().

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { wallTimeToUtcIso } from "@/lib/activities";
import { Zap, Plus, Phone, RefreshCw, Mail, MessageSquare, Users, FileText, ListTodo, Clock, Check, CalendarClock } from "lucide-react";
import CallButton from "@/components/CallButton";
import ActivityComposer from "@/components/ActivityComposer";
import WhenScheduler, { type WhenValue } from "@/components/WhenScheduler";

const gold = "var(--brand, #c9a83a)";
const goldInk = "#8a6b18";

const TYPE_ICON: Record<string, React.ElementType> = {
  call: Phone, follow_up: RefreshCw, email: Mail, message: MessageSquare, meeting: Users, send_proposal: FileText, task: ListTodo,
};

export type HeroNext = {
  id: string; title: string; type: string; dueAt: string | null; dueTz: string | null;
  bucket: "overdue" | "today" | "upcoming" | "no_date" | "completed" | "cancelled"; isCallback: boolean;
  note: string | null;
} | null;

export default function HeroNextAction({
  nextAction, leadId, leadLabel, company, leadPhone, leadCountry, terminalLead, canAssignActivities, localeTag,
}: {
  nextAction: HeroNext; leadId: string; leadLabel: string; company: string | null;
  leadPhone: string | null; leadCountry: string | null; terminalLead: boolean;
  canAssignActivities: boolean; localeTag: string;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [composer, setComposer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resched, setResched] = useState(false);
  const [reschedVal, setReschedVal] = useState<WhenValue | null>(null);

  // ── state → colour + eyebrow label (reuses the Activities bucket vocabulary) ──
  const state = nextAction
    ? (nextAction.bucket === "overdue" ? "overdue"
      : nextAction.isCallback ? "callback"
      : nextAction.bucket === "today" ? "today"
      : nextAction.bucket === "upcoming" ? "upcoming" : "neutral")
    : "empty";
  const accent =
    state === "overdue" ? C.red :
    state === "callback" ? C.orange :
    state === "today" ? gold :
    state === "upcoming" ? C.blue : C.textMuted;
  const surfaceBg =
    state === "empty" ? "transparent" :
    `color-mix(in srgb, ${accent} ${state === "today" ? 11 : 9}%, ${C.card})`;
  const kick =
    state === "overdue" ? t("activities.group.overdue") :
    state === "callback" ? t("activities.callback") :
    state === "today" ? t("activities.group.today") :
    state === "upcoming" ? t("activities.group.upcoming") :
    state === "neutral" ? t("activities.group.no_date") : t("activities.noNext");

  const dueLabel = nextAction?.dueAt
    ? new Date(nextAction.dueAt).toLocaleString(localeTag, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: nextAction.dueTz || undefined })
    : null;
  const Icon = nextAction ? (TYPE_ICON[nextAction.type] ?? ListTodo) : Zap;

  async function patch(body: Record<string, unknown>, msg: string) {
    if (!nextAction || busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/activities/${nextAction.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error("err");
      toast.show({ kind: "success", title: msg });
      setResched(false);
      router.refresh();
    } catch {
      toast.show({ kind: "error", title: t("activities.toast.error") });
    } finally {
      setBusy(false);
    }
  }

  function openResched() {
    if (!nextAction) return;
    const tz = nextAction.dueTz || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Argentina/Buenos_Aires";
    const base = nextAction.dueAt ? new Date(nextAction.dueAt) : new Date();
    setReschedVal({ date: base.toLocaleDateString("en-CA"), time: base.toTimeString().slice(0, 5), tz, reminderOffset: "" });
    setResched(true);
  }

  const naBtn = "inline-flex items-center gap-1.5 text-[12.5px] font-bold rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50";

  // ── EMPTY / TERMINAL ──
  if (!nextAction) {
    return (
      <div className="w-full rounded-xl border border-dashed p-4 flex flex-col gap-2 justify-center min-h-[92px]"
        style={{ borderColor: C.border2 }}>
        <span className="text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: C.textDim }}>{t("ld2.next")}</span>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="inline-flex items-center gap-2 text-[13.5px]" style={{ color: terminalLead ? C.textDim : C.textMuted }}>
            <Zap size={15} style={{ color: C.textDim }} /> {t("activities.noNext")}
          </span>
          {!terminalLead && (
            <button onClick={() => setComposer(true)} className={naBtn} style={{ background: `color-mix(in srgb, ${gold} 15%, transparent)`, color: goldInk }}>
              <Plus size={13} /> {t("activities.add")}
            </button>
          )}
        </div>
        {composer && (
          <ActivityComposer mode="drawer" open canAssignOthers={canAssignActivities}
            context={{ leadId, leadLabel, company, contactCountry: leadCountry, source: "lead_detail" }}
            onClose={() => setComposer(false)} onCreated={() => setComposer(false)} />
        )}
      </div>
    );
  }

  // ── ACTIVE ──
  return (
    <div className="w-full rounded-xl border p-4 relative overflow-hidden" style={{ backgroundColor: surfaceBg, borderColor: C.border }}>
      <span className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: accent }} aria-hidden />
      <div className="pl-2">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="w-7 h-7 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }}>
            <Icon size={15} />
          </span>
          <span className="text-[11px] font-extrabold uppercase tracking-[0.09em]" style={{ color: accent }}>{kick}</span>
          {nextAction.isCallback && state !== "callback" && (
            <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: `color-mix(in srgb, ${C.orange} 15%, transparent)`, color: C.orange }}>{t("activities.callback")}</span>
          )}
        </div>
        <p className="text-[15.5px] font-bold leading-snug" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{nextAction.title}</p>
        {dueLabel && (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-bold tabular-nums mt-1" style={{ color: accent }}>
            <Clock size={11} /> {dueLabel}
          </span>
        )}
        {nextAction.note && (
          <p className="text-[12.5px] leading-relaxed italic mt-2 opacity-90" style={{ color: C.textBody }}>{nextAction.note}</p>
        )}

        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {nextAction.type === "call" && leadPhone && (
            <CallButton phone={leadPhone} leadId={leadId} size="sm" variant="soft" accent={gold} pulse={false} label={t("activities.callNow")} />
          )}
          <button onClick={() => patch({ status: "completed" }, t("activities.toast.completed"))} disabled={busy}
            className={naBtn} style={{ background: C.greenLight, color: C.green }}>
            <Check size={13} /> {t("activities.action.complete")}
          </button>
          <button onClick={() => (resched ? setResched(false) : openResched())} disabled={busy}
            className={naBtn} style={{ background: "transparent", border: `1px solid color-mix(in srgb, ${accent} 34%, ${C.border})`, color: accent }}>
            <CalendarClock size={13} /> {t("activities.action.reschedule")}
          </button>
        </div>

        {resched && reschedVal && (
          <div className="mt-3 pt-3 border-t" style={{ borderColor: C.border }}>
            <WhenScheduler value={reschedVal} onChange={setReschedVal} showReminder={false} />
            <div className="flex items-center justify-end gap-3 mt-2">
              <button onClick={() => setResched(false)} className="text-[12px] font-semibold" style={{ color: C.textMuted }}>{t("activities.form.cancel")}</button>
              <button onClick={() => patch({ due_at: wallTimeToUtcIso(reschedVal.date, reschedVal.time || "10:00", reschedVal.tz), due_tz: reschedVal.tz }, t("activities.toast.updated"))}
                disabled={busy} className="rounded-lg px-3 py-1.5 text-[12px] font-bold disabled:opacity-50" style={{ background: C.green, color: "#fff" }}>
                {t("activities.form.save")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
