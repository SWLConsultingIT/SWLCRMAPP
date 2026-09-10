"use client";

// Dense, operational LIST view (block 4) — the default work queue. High info
// density so a seller scans many activities fast. Hierarchy derived from due_at:
// Overdue → Next up (≤2h) → Later today → Upcoming (+ No date). Quick actions:
// Complete, Reschedule (minimal inline; full preset UX is a later block), Open
// lead. Same GrowthAI look & feel. Board stays as the alternate view.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { useToast } from "@/lib/toast";
import { useLocale } from "@/lib/i18n";
import { bucketActivity, wallTimeToUtcIso, type ActivityType } from "@/lib/activities";
import type { BoardActivity } from "@/components/ActivitiesBoard";
import { Check, Clock, Phone, Mail, MessageSquare, FileText, Users, ListTodo, RefreshCw, ChevronRight, Building2, CalendarClock } from "lucide-react";
import { intlTag, type Locale } from "@/lib/i18n-dicts";

const gold = "var(--brand, #c9a83a)";

const TYPE_ICON: Record<ActivityType, React.ElementType> = {
  call: Phone, follow_up: RefreshCw, email: Mail, message: MessageSquare, meeting: Users, send_proposal: FileText, task: ListTodo,
};
const TYPE_COLOR: Record<ActivityType, string> = {
  call: "#F97316", follow_up: "#0D9488", email: "#7C3AED", message: "#2563EB", meeting: "#DB2777", send_proposal: gold, task: C.textMuted,
};

type Section = { key: string; label: string; color: string; rows: BoardActivity[] };

export default function ActivitiesList({
  initial, team, activeBucket,
}: {
  initial: BoardActivity[];
  team: Record<string, string>;
  activeBucket: "overdue" | "today" | "upcoming" | null;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<string | null>(null);

  const intlLocale = intlTag(locale);
  const now = Date.now();

  const sections = useMemo<Section[]>(() => {
    const b: Record<string, BoardActivity[]> = { overdue: [], next_up: [], later_today: [], upcoming: [], no_date: [] };
    const soon = now + 2 * 3600 * 1000;
    for (const a of initial) {
      const bucket = bucketActivity(a, now);
      if (bucket === "overdue") b.overdue.push(a);
      else if (bucket === "today") {
        const due = a.due_at ? Date.parse(a.due_at) : Infinity;
        (due <= soon ? b.next_up : b.later_today).push(a);
      } else if (bucket === "upcoming") b.upcoming.push(a);
      else if (bucket === "no_date") b.no_date.push(a);
    }
    const sortByDue = (arr: BoardActivity[]) => arr.sort((x, y) => (x.due_at ? Date.parse(x.due_at) : Infinity) - (y.due_at ? Date.parse(y.due_at) : Infinity));
    Object.values(b).forEach(sortByDue);
    // Summary-card filter → show only that bucket.
    if (activeBucket === "overdue") return [{ key: "overdue", label: t("activities.group.overdue"), color: C.red, rows: b.overdue }];
    if (activeBucket === "today") return [
      { key: "next_up", label: t("activities.group.next_up"), color: gold, rows: b.next_up },
      { key: "later_today", label: t("activities.group.later_today"), color: gold, rows: b.later_today },
    ];
    if (activeBucket === "upcoming") return [{ key: "upcoming", label: t("activities.group.upcoming"), color: C.blue, rows: b.upcoming }];
    return [
      { key: "overdue", label: t("activities.group.overdue"), color: C.red, rows: b.overdue },
      { key: "next_up", label: t("activities.group.next_up"), color: gold, rows: b.next_up },
      { key: "later_today", label: t("activities.group.later_today"), color: gold, rows: b.later_today },
      { key: "upcoming", label: t("activities.group.upcoming"), color: C.blue, rows: b.upcoming },
      { key: "no_date", label: t("activities.group.no_date"), color: C.textMuted, rows: b.no_date },
    ];
  }, [initial, now, activeBucket, t]);

  const total = sections.reduce((s, sec) => s + sec.rows.length, 0);

  const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString(intlLocale, { hour: "2-digit", minute: "2-digit" }) : "—";
  const fmtDay = (iso: string | null) => iso ? new Date(iso).toLocaleDateString(intlLocale, { day: "2-digit", month: "short" }) : "";
  const isToday = (iso: string | null) => { if (!iso) return false; const d = new Date(iso), n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); };

  async function patch(id: string, body: Record<string, unknown>, msg?: string) {
    setBusyId(id);
    try {
      const r = await fetch(`/api/activities/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error("error");
      if (msg) toast.show({ kind: "success", title: msg });
      router.refresh();
    } catch { toast.show({ kind: "error", title: t("activities.toast.error") }); }
    setBusyId(null);
    setRescheduling(null);
  }

  function Row({ a }: { a: BoardActivity }) {
    const Icon = TYPE_ICON[a.type] ?? ListTodo;
    const color = TYPE_COLOR[a.type] ?? C.textMuted;
    const callback = a.source === "call_callback";
    const editing = rescheduling === a.id;
    return (
      <div className="border-t first:border-t-0" style={{ borderColor: C.border }}>
        <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-black/[0.02]">
          {/* time */}
          <div className="w-16 shrink-0 text-right">
            <div className="text-[13px] font-bold tabular-nums" style={{ color: C.textPrimary }}>{fmtTime(a.due_at)}</div>
            {!isToday(a.due_at) && <div className="text-[10px] tabular-nums" style={{ color: C.textDim }}>{fmtDay(a.due_at)}</div>}
          </div>
          {/* type chip */}
          <span className="w-7 h-7 rounded-md grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${color} 13%, transparent)`, color }} title={t(`activities.type.${a.type}`)}>
            <Icon size={14} />
          </span>
          {/* body */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-semibold truncate" style={{ color: C.textPrimary }}>{a.title}</span>
              {callback && <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: `color-mix(in srgb, ${gold} 16%, transparent)`, color: "var(--fg1)" }}>callback</span>}
              {a.priority === "high" && <span className="text-[8.5px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: C.redLight, color: C.red }}>!</span>}
            </div>
            <div className="flex items-center gap-1.5 text-[11.5px] mt-0.5 min-w-0" style={{ color: C.textMuted }}>
              {a.lead_id
                ? <Link href={`/leads/${a.lead_id}`} className="font-medium hover:underline truncate" style={{ color: C.textPrimary }}>{a.leadName}</Link>
                : <span className="truncate">{a.leadName}</span>}
              {a.company && <span className="truncate" style={{ color: C.textDim }}>· {a.company}</span>}
              {a.campaign && <span className="truncate hidden md:inline" style={{ color: C.textDim }}>· {a.campaign}</span>}
            </div>
            {a.description && <p className="text-[11px] mt-0.5 truncate" style={{ color: C.textDim }}>{a.description}</p>}
          </div>
          {/* seller */}
          {a.assigned_to && team[a.assigned_to] && <span className="hidden lg:block text-[11px] shrink-0 max-w-[120px] truncate" style={{ color: C.textMuted }}>{team[a.assigned_to]}</span>}
          {/* actions */}
          <div className="flex items-center gap-1 shrink-0">
            <button disabled={busyId === a.id} onClick={() => patch(a.id, { status: "completed" }, t("activities.toast.completed"))} title={t("activities.action.complete")} className="w-7 h-7 grid place-items-center rounded-md" style={{ background: C.greenLight, color: C.green }}><Check size={14} /></button>
            <button disabled={busyId === a.id} onClick={() => setRescheduling(editing ? null : a.id)} title={t("activities.action.reschedule")} className="w-7 h-7 grid place-items-center rounded-md" style={{ background: C.surface, color: C.textMuted }}><CalendarClock size={13} /></button>
            {a.lead_id && <Link href={`/leads/${a.lead_id}`} title={t("activities.openLead")} className="w-7 h-7 grid place-items-center rounded-md" style={{ background: C.surface, color: C.textDim }}><ChevronRight size={14} /></Link>}
          </div>
        </div>
        {editing && <RescheduleInline a={a} onSave={(iso, tz) => patch(a.id, { due_at: iso, due_tz: tz }, t("activities.toast.updated"))} onCancel={() => setRescheduling(null)} />}
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="rounded-2xl border py-14 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{t("activities.empty.today")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {sections.map(sec => sec.rows.length === 0 ? null : (
        <div key={sec.key}>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] mb-1.5 px-1" style={{ color: sec.color }}>{sec.label} · {sec.rows.length}</p>
          <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: C.shadow }}>
            {sec.rows.map(a => <Row key={a.id} a={a} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

// Minimal inline reschedule (full preset UX — +30m/afternoon/etc — is a later
// block). Respects the activity's own due_tz (falls back to browser tz).
function RescheduleInline({ a, onSave, onCancel }: { a: BoardActivity; onSave: (iso: string, tz: string) => void; onCancel: () => void }) {
  const { t } = useLocale();
  const tz = a.due_tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Argentina/Buenos_Aires";
  const base = a.due_at ? new Date(a.due_at) : new Date();
  const [date, setDate] = useState(base.toLocaleDateString("en-CA"));
  const [time, setTime] = useState(base.toTimeString().slice(0, 5));
  const field = { background: C.card, border: `1px solid ${C.border}`, color: C.textPrimary } as const;
  return (
    <div className="flex items-center gap-2 px-3 py-2.5" style={{ background: C.surface, borderTop: `1px solid ${C.border}` }}>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-lg px-2 py-1.5 text-[12px]" style={field} />
      <input type="time" value={time} onChange={e => setTime(e.target.value)} className="rounded-lg px-2 py-1.5 text-[12px]" style={field} />
      <span className="text-[10.5px]" style={{ color: C.textDim }}>{tz}</span>
      <div className="ml-auto flex items-center gap-2">
        <button onClick={onCancel} className="text-[12px] font-semibold" style={{ color: C.textMuted }}>{t("activities.form.cancel")}</button>
        <button onClick={() => { const iso = wallTimeToUtcIso(date, time, tz); if (iso) onSave(iso, tz); }} className="rounded-lg px-3 py-1.5 text-[12px] font-bold" style={{ background: C.green, color: "#fff" }}>{t("activities.form.save")}</button>
      </div>
    </div>
  );
}
