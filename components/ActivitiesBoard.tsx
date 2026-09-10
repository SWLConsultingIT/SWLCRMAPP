"use client";

// Consolidated "My Activities" board (P1, PM-style redesign 2026-09-10). A real
// work view: three columns — Overdue / Today / Upcoming — plus a secondary strip
// for No-date and Completed. Filters by scope (mine/all), search, type, status.
// Rows link to the canonical lead detail. Server-enriched initial data; mutations
// hit the API then router.refresh().

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { useToast } from "@/lib/toast";
import { useLocale } from "@/lib/i18n";
import { intlTag, type Locale } from "@/lib/i18n-dicts";
import {
  ACTIVITY_TYPES,
  bucketActivity,
  type ActivityType,
  type ActivityStatus,
  type ActivityBucket,
} from "@/lib/activities";
import {
  Check, X, Clock, Phone, Mail, MessageSquare, FileText, Users, ListTodo, RefreshCw,
  Search, AlertTriangle, CalendarDays, CalendarClock, ChevronDown, ChevronRight, Building2,
} from "lucide-react";

const gold = "var(--brand, #c9a83a)";

const TYPE_ICON: Record<ActivityType, React.ElementType> = {
  call: Phone, follow_up: RefreshCw, email: Mail, message: MessageSquare, meeting: Users, send_proposal: FileText, task: ListTodo,
};

export type BoardActivity = {
  id: string;
  lead_id: string | null;
  type: ActivityType;
  title: string;
  description: string | null;
  assigned_to: string | null;
  due_at: string | null;
  due_tz: string | null;
  status: ActivityStatus;
  priority: string | null;
  source: string;
  leadName: string;
  company: string;
  campaign: string | null;
};

const COLUMNS: { key: "overdue" | "today" | "upcoming"; icon: React.ElementType; color: string }[] = [
  { key: "overdue", icon: AlertTriangle, color: "#DC2626" },
  { key: "today", icon: CalendarClock, color: "var(--brand, #c9a83a)" },
  { key: "upcoming", icon: CalendarDays, color: "#2563EB" },
];

export default function ActivitiesBoard({
  initial, seesAll, currentScope,
}: { initial: BoardActivity[]; seesAll: boolean; currentScope: "mine" | "all" }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeF, setTypeF] = useState("");
  const [team, setTeam] = useState<Record<string, string>>({});
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    if (!seesAll) return;
    fetch("/api/team", { cache: "no-store" }).then(r => r.json()).then(j => {
      if (Array.isArray(j?.team)) {
        const m: Record<string, string> = {};
        for (const p of j.team) m[p.userId] = p.displayName || p.email || p.userId;
        setTeam(m);
      }
    }).catch(() => {});
  }, [seesAll]);

  const intlLocale = intlTag(locale);
  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString(intlLocale, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

  const now = Date.now();
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initial.filter(a => {
      if (typeF && a.type !== typeF) return false;
      if (q && !`${a.title} ${a.leadName} ${a.company}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [initial, search, typeF]);

  const grouped = useMemo(() => {
    const g: Record<ActivityBucket, BoardActivity[]> = { overdue: [], today: [], upcoming: [], no_date: [], completed: [], cancelled: [] };
    for (const a of filtered) g[bucketActivity(a, now)].push(a);
    return g;
  }, [filtered, now]);

  const counts = {
    overdue: grouped.overdue.length,
    today: grouped.today.length,
    upcoming: grouped.upcoming.length,
  };

  async function patch(id: string, body: Record<string, unknown>, msg?: string) {
    setBusyId(id);
    try {
      const r = await fetch(`/api/activities/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error("error");
      if (msg) toast.show({ kind: "success", title: msg });
      router.refresh();
    } catch {
      toast.show({ kind: "error", title: t("activities.toast.error") });
    }
    setBusyId(null);
  }

  const chip = (active: boolean) => ({
    background: active ? gold : C.card,
    color: active ? "#1a1205" : C.textMuted,
    border: `1px solid ${active ? gold : C.border}`,
  });

  function Card({ a, columnColor }: { a: BoardActivity; columnColor: string }) {
    const Icon = TYPE_ICON[a.type] ?? ListTodo;
    const overdue = bucketActivity(a, now) === "overdue";
    return (
      <div className="group relative rounded-xl border p-3" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: C.shadow }}>
        <span aria-hidden className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full" style={{ backgroundColor: columnColor }} />
        <div className="flex items-start gap-2.5 pl-2">
          <span className="w-7 h-7 rounded-md grid place-items-center shrink-0 mt-0.5" style={{ background: `color-mix(in srgb, ${columnColor} 12%, transparent)`, color: columnColor }}>
            <Icon size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: C.surface, color: C.textMuted }}>{t(`activities.type.${a.type}`)}</span>
              {a.priority === "high" && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: C.redLight, color: C.red }}>{t("activities.priority.high")}</span>}
              {a.source === "call_callback" && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: `color-mix(in srgb, ${gold} 14%, transparent)`, color: "var(--fg1)" }}>callback</span>}
            </div>
            <p className="text-[13px] font-semibold mt-1 leading-snug" style={{ color: C.textPrimary }}>{a.title}</p>
            {a.lead_id ? (
              <Link href={`/leads/${a.lead_id}`} className="mt-1 flex items-center gap-1 text-[11.5px] hover:underline" style={{ color: C.textMuted }}>
                <Building2 size={11} /> <span className="font-medium" style={{ color: C.textPrimary }}>{a.leadName}</span>
                {a.company && <span style={{ color: C.textDim }}>· {a.company}</span>}
              </Link>
            ) : (
              <span className="mt-1 block text-[11.5px]" style={{ color: C.textMuted }}>{a.leadName}</span>
            )}
            <div className="flex items-center gap-2 mt-1.5 text-[11px]" style={{ color: overdue ? C.red : C.textDim }}>
              <Clock size={11} /> <span className="tabular-nums">{fmt(a.due_at)}</span>
              {seesAll && a.assigned_to && team[a.assigned_to] && <span style={{ color: C.textDim }}>· {team[a.assigned_to]}</span>}
            </div>
          </div>
          {/* quick actions */}
          <div className="flex flex-col gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button disabled={busyId === a.id} onClick={() => patch(a.id, { status: "completed" }, t("activities.toast.completed"))} title={t("activities.action.complete")} className="w-7 h-7 grid place-items-center rounded-md" style={{ background: C.greenLight, color: C.green }}><Check size={14} /></button>
            <button disabled={busyId === a.id} onClick={() => patch(a.id, { status: "cancelled" })} title={t("activities.action.cancel")} className="w-7 h-7 grid place-items-center rounded-md" style={{ background: C.surface, color: C.textDim }}><X size={13} /></button>
          </div>
        </div>
      </div>
    );
  }

  const noDate = grouped.no_date;
  const done = [...grouped.completed, ...grouped.cancelled];

  return (
    <div className="w-full">
      {/* Filters */}
      <div className="flex items-center gap-2.5 flex-wrap mb-5">
        {seesAll && (
          <div className="inline-flex rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
            <Link href="/activities?scope=mine" className="px-3 py-1.5 text-[12px] font-bold" style={{ background: currentScope === "mine" ? gold : C.card, color: currentScope === "mine" ? "#1a1205" : C.textMuted }}>{t("activities.scope.mine")}</Link>
            <Link href="/activities?scope=all" className="px-3 py-1.5 text-[12px] font-bold" style={{ background: currentScope === "all" ? gold : C.card, color: currentScope === "all" ? "#1a1205" : C.textMuted }}>{t("activities.scope.all")}</Link>
          </div>
        )}
        <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 flex-1 min-w-[200px] max-w-sm" style={{ borderColor: C.border, backgroundColor: C.card }}>
          <Search size={14} style={{ color: C.textDim }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`${t("activities.lead")} / ${t("activities.company")}`} className="bg-transparent text-sm outline-none flex-1" style={{ color: C.textPrimary }} />
        </div>
        <select value={typeF} onChange={e => setTypeF(e.target.value)} className="rounded-lg px-3 py-1.5 text-xs" style={{ color: C.textPrimary, backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <option value="">{t("activities.filter.type")}</option>
          {ACTIVITY_TYPES.map(ty => <option key={ty} value={ty}>{t(`activities.type.${ty}`)}</option>)}
        </select>
      </div>

      {/* PM board — three columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {COLUMNS.map(col => {
          const ColIcon = col.icon;
          const rows = grouped[col.key];
          return (
            <div key={col.key} className="rounded-2xl p-3" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
              <div className="flex items-center gap-2 mb-3 px-1">
                <ColIcon size={15} style={{ color: col.color }} />
                <span className="text-[12px] font-bold uppercase tracking-[0.08em]" style={{ color: C.textPrimary }}>{t(`activities.group.${col.key}`)}</span>
                <span className="ml-auto text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full" style={{ background: `color-mix(in srgb, ${col.color} 14%, transparent)`, color: col.color }}>{counts[col.key]}</span>
              </div>
              <div className="flex flex-col gap-2.5 min-h-[60px]">
                {rows.length === 0
                  ? <p className="text-[11.5px] text-center py-6" style={{ color: C.textDim }}>—</p>
                  : rows.map(a => <Card key={a.id} a={a} columnColor={col.color} />)}
              </div>
            </div>
          );
        })}
      </div>

      {/* No date (pending, undated) */}
      {noDate.length > 0 && (
        <div className="mt-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: C.textMuted }}>{t("activities.group.no_date")} · {noDate.length}</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {noDate.map(a => <Card key={a.id} a={a} columnColor={C.textMuted} />)}
          </div>
        </div>
      )}

      {/* Completed / cancelled — collapsed history */}
      {done.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowCompleted(v => !v)} className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: C.textMuted }}>
            {showCompleted ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {t("activities.group.completed")} · {done.length}
          </button>
          {showCompleted && (
            <div className="mt-2 rounded-2xl border overflow-hidden divide-y" style={{ backgroundColor: C.card, borderColor: C.border }}>
              {done.map(a => {
                const Icon = TYPE_ICON[a.type] ?? ListTodo;
                return (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-2.5" style={{ opacity: 0.7 }}>
                    <Icon size={13} style={{ color: C.textDim }} />
                    <span className="text-[12.5px] flex-1 min-w-0 truncate" style={{ color: C.textPrimary, textDecoration: "line-through" }}>{a.title}</span>
                    {a.lead_id && <Link href={`/leads/${a.lead_id}`} className="text-[11px] hover:underline shrink-0" style={{ color: C.textMuted }}>{a.leadName}</Link>}
                    <button onClick={() => patch(a.id, { status: "pending" })} title={t("activities.action.reopen")} className="shrink-0 w-6 h-6 grid place-items-center rounded-md" style={{ background: C.surface, color: C.textMuted }}><RefreshCw size={12} /></button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {filtered.length === 0 && (
        <div className="rounded-2xl border py-16 text-center mt-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{t("activities.none")}</p>
        </div>
      )}
    </div>
  );
}
