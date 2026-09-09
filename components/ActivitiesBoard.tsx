"use client";

// Consolidated "My Activities" board (P0). A PM/to-do work view across leads:
// Overdue / Today / Upcoming / No date / Completed, with seller/type/status/
// search filters. Rows link to the lead detail. Server-enriched initial data
// (lead names decrypted once); mutations hit the API then router.refresh().

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { useToast } from "@/lib/toast";
import { useLocale } from "@/lib/i18n";
import {
  ACTIVITY_TYPES,
  bucketActivity,
  type ActivityType,
  type ActivityStatus,
  type ActivityBucket,
} from "@/lib/activities";
import { Check, X, Clock, Phone, Mail, MessageSquare, FileText, Users, ListTodo, ChevronRight, Search } from "lucide-react";

const gold = "var(--brand, #c9a83a)";

const TYPE_ICON: Record<ActivityType, React.ElementType> = {
  call: Phone, email: Mail, follow_up: MessageSquare, prepare_proposal: FileText, meeting: Users, task: ListTodo, other: ListTodo,
};

export type BoardActivity = {
  id: string;
  lead_id: string | null;
  type: ActivityType;
  title: string;
  description: string | null;
  assigned_to: string | null;
  due_at: string | null;
  status: ActivityStatus;
  priority: string | null;
  source: string;
  leadName: string;
  company: string;
};

const ORDER: ActivityBucket[] = ["overdue", "today", "upcoming", "no_date", "completed"];

export default function ActivitiesBoard({
  initial, seesAll, currentScope,
}: { initial: BoardActivity[]; seesAll: boolean; currentScope: "mine" | "all" }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeF, setTypeF] = useState("");
  const [statusF, setStatusF] = useState("");
  const [team, setTeam] = useState<Record<string, string>>({});

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

  const intlLocale = locale === "es" ? "es-AR" : "en-US";
  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString(intlLocale, { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

  const now = Date.now();
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return initial.filter(a => {
      if (typeF && a.type !== typeF) return false;
      if (statusF && a.status !== statusF) return false;
      if (q && !`${a.title} ${a.leadName} ${a.company}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [initial, search, typeF, statusF]);

  const grouped = useMemo(() => {
    const g: Record<ActivityBucket, BoardActivity[]> = { overdue: [], today: [], upcoming: [], no_date: [], completed: [], cancelled: [] };
    for (const a of filtered) g[bucketActivity(a, now)].push(a);
    return g;
  }, [filtered, now]);

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

  const bucketColor: Partial<Record<ActivityBucket, string>> = { overdue: C.red, today: gold, upcoming: C.blue };

  return (
    <div className="w-full">
      {/* Filters */}
      <div className="flex items-center gap-2.5 flex-wrap mb-4">
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
        <select value={statusF} onChange={e => setStatusF(e.target.value)} className="rounded-lg px-3 py-1.5 text-xs" style={{ color: C.textPrimary, backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <option value="">{t("activities.filter.status")}</option>
          <option value="pending">{t("activities.group.pending")}</option>
          <option value="completed">{t("activities.group.completed")}</option>
          <option value="cancelled">{t("activities.group.cancelled")}</option>
        </select>
      </div>

      {filtered.length === 0 && (
        <div className="rounded-2xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{t("activities.none")}</p>
        </div>
      )}

      {ORDER.map(bucket => {
        const rows = grouped[bucket];
        if (rows.length === 0) return null;
        return (
          <div key={bucket} className="mb-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: bucketColor[bucket] ?? C.textMuted }}>
              {t(`activities.group.${bucket}`)} · {rows.length}
            </p>
            <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: C.shadow }}>
              {rows.map((a, i) => {
                const Icon = TYPE_ICON[a.type] ?? ListTodo;
                const done = a.status !== "pending";
                return (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: i === 0 ? "none" : `1px solid ${C.border}` }}>
                    <span className="w-7 h-7 rounded-md grid place-items-center shrink-0" style={{ background: "color-mix(in srgb, var(--brand, #c9a83a) 12%, transparent)", color: "var(--fg1)" }}>
                      <Icon size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold" style={{ color: C.textPrimary, textDecoration: done ? "line-through" : "none" }}>{a.title}</span>
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: C.surface, color: C.textMuted }}>{t(`activities.type.${a.type}`)}</span>
                        {a.source === "call_callback" && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: "color-mix(in srgb, var(--brand,#c9a83a) 14%, transparent)", color: "var(--fg1)" }}>callback</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11.5px]" style={{ color: C.textMuted }}>
                        {a.lead_id
                          ? <Link href={`/leads/${a.lead_id}`} className="hover:underline font-medium" style={{ color: C.textPrimary }}>{a.leadName}</Link>
                          : <span>{a.leadName}</span>}
                        {a.company && <span style={{ color: C.textDim }}>· {a.company}</span>}
                        {seesAll && a.assigned_to && team[a.assigned_to] && <span style={{ color: C.textDim }}>· {team[a.assigned_to]}</span>}
                      </div>
                    </div>
                    <span className="hidden sm:flex items-center gap-1.5 text-[11px] tabular-nums shrink-0" style={{ color: bucket === "overdue" ? C.red : C.textMuted }}>
                      <Clock size={11} /> {fmt(a.due_at)}
                    </span>
                    {a.status === "pending" && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button disabled={busyId === a.id} onClick={() => patch(a.id, { status: "completed" }, t("activities.toast.completed"))} title={t("activities.action.complete")} className="w-7 h-7 grid place-items-center rounded-md" style={{ background: C.greenLight, color: C.green }}><Check size={14} /></button>
                        <button disabled={busyId === a.id} onClick={() => patch(a.id, { status: "cancelled" })} title={t("activities.action.cancel")} className="w-7 h-7 grid place-items-center rounded-md" style={{ background: C.surface, color: C.textDim }}><X size={13} /></button>
                      </div>
                    )}
                    {a.lead_id && <Link href={`/leads/${a.lead_id}`} className="shrink-0" style={{ color: C.textDim }}><ChevronRight size={16} /></Link>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
