"use client";

// Lead Detail operational panel (phase 3): a prominent NEXT ACTION block + the
// full Activities section (Open / Completed). Consumes the SAME Activities
// source of truth (no lead-local task model). Next Action is DERIVED — the
// soonest pending activity (overdue first) — never a stored pointer. Add uses
// the universal ActivityComposer with the lead pre-filled ("ask only what we
// don't know"). Callback activities show their call context so the seller knows
// WHY they're calling.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { bucketActivity, wallTimeToUtcIso, type ActivityType, type ActivityStatus } from "@/lib/activities";
import WhenScheduler, { type WhenValue } from "@/components/WhenScheduler";
import ActivityComposer from "@/components/ActivityComposer";
import CallButton from "@/components/CallButton";
import {
  Check, Clock, Phone, Mail, MessageSquare, FileText, Users, ListTodo, RefreshCw,
  CalendarClock, Plus, ChevronDown, ChevronRight, RotateCcw, X, Zap,
} from "lucide-react";

const gold = "var(--brand, #c9a83a)";

const TYPE_ICON: Record<ActivityType, React.ElementType> = {
  call: Phone, follow_up: RefreshCw, email: Mail, message: MessageSquare, meeting: Users, send_proposal: FileText, task: ListTodo,
};

type A = {
  id: string; lead_id: string | null; type: ActivityType; title: string; description: string | null;
  assigned_to: string | null; due_at: string | null; due_tz: string | null; status: ActivityStatus;
  priority: string | null; source: string; source_reference_id: string | null; created_at: string;
};

// Lead statuses where a missing next action is EXPECTED — no warning there.
const TERMINAL_STATUSES = new Set(["closed_lost", "closed_won", "discarded"]);

export default function LeadActivitiesPanel({
  leadId, leadLabel, company, leadPhone, leadCountry, leadStatus, canAssignOthers,
}: {
  leadId: string;
  leadLabel?: string | null;
  company?: string | null;
  leadPhone?: string | null;
  leadCountry?: string | null;
  leadStatus?: string | null;
  canAssignOthers?: boolean;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [items, setItems] = useState<A[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reschedId, setReschedId] = useState<string | null>(null);
  const [reschedVal, setReschedVal] = useState<WhenValue | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/activities?leadId=${encodeURIComponent(leadId)}`, { cache: "no-store" });
      const j = await r.json();
      setItems(Array.isArray(j?.activities) ? j.activities : []);
    } catch { /* keep */ }
    setLoading(false);
  }, [leadId]);
  useEffect(() => { load(); }, [load]);

  const intlLocale = locale === "es" ? "es-AR" : "en-US";
  const now = Date.now();

  const pending = useMemo(
    () => items.filter(a => a.status === "pending")
      .sort((x, y) => (x.due_at ? Date.parse(x.due_at) : Infinity) - (y.due_at ? Date.parse(y.due_at) : Infinity)),
    [items],
  );
  const completed = useMemo(() => items.filter(a => a.status !== "pending"), [items]);
  const nextAction = pending[0] ?? null;
  const terminal = TERMINAL_STATUSES.has((leadStatus ?? "").toLowerCase());

  function fmtDue(a: A) {
    if (!a.due_at) return "—";
    try {
      return new Date(a.due_at).toLocaleString(intlLocale, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: a.due_tz || undefined });
    } catch { return new Date(a.due_at).toLocaleString(intlLocale); }
  }

  async function patch(id: string, body: Record<string, unknown>, msg?: string) {
    setBusyId(id);
    try {
      const r = await fetch(`/api/activities/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error("error");
      if (msg) toast.show({ kind: "success", title: msg });
      await load();
      router.refresh(); // keep the rest of the lead page (metrics/journey) in sync
    } catch { toast.show({ kind: "error", title: t("activities.toast.error") }); }
    setBusyId(null);
    setReschedId(null);
  }

  function openResched(a: A) {
    const tz = a.due_tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Argentina/Buenos_Aires";
    const base = a.due_at ? new Date(a.due_at) : new Date();
    setReschedVal({ date: base.toLocaleDateString("en-CA"), time: base.toTimeString().slice(0, 5), tz, reminderOffset: "" });
    setReschedId(a.id);
  }

  const bucketColor = (a: A) => {
    const b = bucketActivity(a, now);
    return b === "overdue" ? C.red : b === "today" ? gold : C.blue;
  };

  function Actions({ a }: { a: A }) {
    return (
      <div className="flex items-center gap-1.5 shrink-0">
        {a.type === "call" && leadPhone
          ? <CallButton phone={leadPhone} leadId={leadId} size="sm" variant="soft" label={t("activities.callNow")} />
          : null}
        <button disabled={busyId === a.id} onClick={() => patch(a.id, { status: "completed" }, t("activities.toast.completed"))} title={t("activities.action.complete")} className="w-7 h-7 grid place-items-center rounded-md" style={{ background: C.greenLight, color: C.green }}><Check size={14} /></button>
        <button disabled={busyId === a.id} onClick={() => openResched(a)} title={t("activities.action.reschedule")} className="w-7 h-7 grid place-items-center rounded-md" style={{ background: C.surface, color: C.textMuted }}><CalendarClock size={13} /></button>
      </div>
    );
  }

  return (
    <section className="space-y-3 mb-4">
      {/* ── NEXT ACTION — the single most important thing on the page ── */}
      <div className="rounded-2xl border p-3.5" style={{ backgroundColor: C.card, borderColor: nextAction ? `color-mix(in srgb, ${bucketColor(nextAction)} 40%, ${C.border})` : C.border, boxShadow: C.shadow }}>
        <div className="flex items-center gap-1.5 mb-2">
          <Zap size={12} style={{ color: gold }} />
          <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>{t("activities.nextAction")}</span>
        </div>
        {nextAction ? (
          <div className="flex items-start gap-3">
            <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0 mt-0.5" style={{ background: `color-mix(in srgb, ${bucketColor(nextAction)} 13%, transparent)`, color: bucketColor(nextAction) }}>
              {(() => { const I = TYPE_ICON[nextAction.type] ?? ListTodo; return <I size={16} />; })()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[14px] font-bold" style={{ color: C.textPrimary }}>{nextAction.title}</span>
                {nextAction.source === "call_callback" && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: `color-mix(in srgb, ${gold} 16%, transparent)`, color: "var(--fg1)" }}>callback</span>}
              </div>
              <div className="flex items-center gap-1.5 text-[12px] mt-1" style={{ color: bucketColor(nextAction) }}>
                <Clock size={12} /> <span className="tabular-nums font-semibold">{fmtDue(nextAction)}</span>
                {nextAction.due_tz && <span style={{ color: C.textDim }}>· {nextAction.due_tz}</span>}
              </div>
              {nextAction.description && <p className="text-[12px] mt-1.5" style={{ color: C.textMuted }}>{nextAction.description}</p>}
              {nextAction.source === "call_callback" && (
                <p className="text-[10.5px] mt-1" style={{ color: C.textDim }}>{t("activities.fromCall")} · {new Date(nextAction.created_at).toLocaleString(intlLocale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
              )}
            </div>
            <Actions a={nextAction} />
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px]" style={{ color: terminal ? C.textDim : C.textMuted }}>{t("activities.noNext")}</span>
            {!terminal && (
              <button onClick={() => setComposerOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold shrink-0" style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 80%, white))`, color: "#1a1205" }}>
                <Plus size={14} /> {t("activities.add")}
              </button>
            )}
          </div>
        )}
        {reschedId === nextAction?.id && reschedVal && (
          <div className="mt-3 rounded-xl p-3" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <WhenScheduler value={reschedVal} onChange={setReschedVal} showReminder={false} />
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => setReschedId(null)} className="text-[12px] font-semibold" style={{ color: C.textMuted }}>{t("activities.form.cancel")}</button>
              <button onClick={() => patch(nextAction!.id, whenToPatch(reschedVal), t("activities.toast.updated"))} className="rounded-lg px-3 py-1.5 text-[12px] font-bold" style={{ background: C.green, color: "#fff" }}>{t("activities.form.save")}</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Activities section — only when there ARE activities, so the empty
          state lives solely in the NEXT ACTION block above (no duplicate "Add
          activity"). Open + Completed. ── */}
      {(pending.length > 0 || completed.length > 0) && (
      <div className="rounded-2xl border p-3.5" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: C.shadow }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[13px] font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{t("activities.section.title")}</span>
          <button onClick={() => setComposerOpen(true)} className="inline-flex items-center gap-1 text-[12px] font-bold" style={{ color: gold }}><Plus size={13} /> {t("activities.add")}</button>
        </div>

        {pending.length > 0 && (
          <div className="mb-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] mb-1" style={{ color: C.textMuted }}>{t("activities.open")} · {pending.length}</p>
            {pending.map(a => (
              <div key={a.id}>
                <div className="flex items-center gap-2.5 py-2 border-t first:border-t-0" style={{ borderColor: C.border }}>
                  <span className="w-6 h-6 rounded-md grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${bucketColor(a)} 12%, transparent)`, color: bucketColor(a) }}>
                    {(() => { const I = TYPE_ICON[a.type] ?? ListTodo; return <I size={12} />; })()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="text-[12.5px] font-semibold" style={{ color: C.textPrimary }}>{a.title}</span>
                    <span className="text-[11px] ml-2 tabular-nums" style={{ color: bucketColor(a) }}>{fmtDue(a)}</span>
                  </div>
                  <Actions a={a} />
                </div>
                {reschedId === a.id && reschedVal && (
                  <div className="mb-2 rounded-xl p-3" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                    <WhenScheduler value={reschedVal} onChange={setReschedVal} showReminder={false} />
                    <div className="flex justify-end gap-2 mt-2">
                      <button onClick={() => setReschedId(null)} className="text-[12px] font-semibold" style={{ color: C.textMuted }}>{t("activities.form.cancel")}</button>
                      <button onClick={() => patch(a.id, { ...whenToPatch(reschedVal) }, t("activities.toast.updated"))} className="rounded-lg px-3 py-1.5 text-[12px] font-bold" style={{ background: C.green, color: "#fff" }}>{t("activities.form.save")}</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {completed.length > 0 && (
          <div className="mt-2">
            <button onClick={() => setShowCompleted(v => !v)} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: C.textMuted }}>
              {showCompleted ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {t("activities.group.completed")} · {completed.length}
            </button>
            {showCompleted && completed.map(a => (
              <div key={a.id} className="flex items-center gap-2.5 py-1.5" style={{ opacity: 0.65 }}>
                {(() => { const I = TYPE_ICON[a.type] ?? ListTodo; return <I size={12} style={{ color: C.textDim }} />; })()}
                <span className="text-[12px] flex-1 min-w-0 truncate" style={{ color: C.textPrimary, textDecoration: "line-through" }}>{a.title}</span>
                <button onClick={() => patch(a.id, { status: "pending" })} title={t("activities.action.reopen")} className="w-6 h-6 grid place-items-center rounded-md" style={{ background: C.surface, color: C.textMuted }}><RotateCcw size={11} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {composerOpen && (
        <ActivityComposer
          mode="drawer"
          open
          canAssignOthers={canAssignOthers}
          context={{ leadId, leadLabel, company, contactCountry: leadCountry, source: "lead_detail" }}
          onClose={() => setComposerOpen(false)}
          onCreated={() => { setComposerOpen(false); load(); router.refresh(); }}
        />
      )}
    </section>
  );
}

// Build a tz-aware due_at (+ due_tz) patch from a WhenScheduler value.
function whenToPatch(v: WhenValue): Record<string, unknown> {
  return { due_at: wallTimeToUtcIso(v.date, v.time || "10:00", v.tz), due_tz: v.tz };
}
