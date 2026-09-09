"use client";

// Activities section for the Lead Detail (P0). Additive — sits alongside the
// existing "Pipeline Stage" block, does not replace it. Shows Next / Overdue /
// Today / Upcoming / (history) with create · complete · reschedule · cancel.
// All tokens (type/status/priority) are canonical; labels come from t().

import { useCallback, useEffect, useMemo, useState } from "react";
import { C } from "@/lib/design";
import { useToast } from "@/lib/toast";
import { useLocale } from "@/lib/i18n";
import {
  ACTIVITY_TYPES,
  ACTIVITY_PRIORITIES,
  bucketActivity,
  type Activity,
  type ActivityType,
  type ActivityBucket,
} from "@/lib/activities";
import {
  Plus, Check, Clock, Calendar, Phone, Mail, MessageSquare, FileText, Users, ListTodo, RotateCcw, X, Pencil,
} from "lucide-react";

const gold = "var(--brand, #c9a83a)";

const TYPE_ICON: Record<ActivityType, React.ElementType> = {
  call: Phone,
  email: Mail,
  follow_up: MessageSquare,
  prepare_proposal: FileText,
  meeting: Users,
  task: ListTodo,
  other: ListTodo,
};

type TeamMember = { userId: string; displayName: string | null; email: string | null };

function toDueIso(date: string, time: string): string | null {
  if (!date) return null;
  const t = time || "09:00";
  const ms = Date.parse(`${date}T${t}`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export default function LeadActivities({ leadId, canAssignOthers = false }: { leadId: string; canAssignOthers?: boolean }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const [items, setItems] = useState<Activity[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // form state
  const [fType, setFType] = useState<ActivityType>("follow_up");
  const [fTitle, setFTitle] = useState("");
  const [fDate, setFDate] = useState("");
  const [fTime, setFTime] = useState("09:00");
  const [fAssignee, setFAssignee] = useState("");
  const [fPriority, setFPriority] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/activities?leadId=${encodeURIComponent(leadId)}`, { cache: "no-store" });
      const j = await r.json();
      setItems(Array.isArray(j?.activities) ? j.activities : []);
    } catch { /* keep prior */ }
    setLoading(false);
  }, [leadId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!canAssignOthers) return;
    fetch("/api/team", { cache: "no-store" }).then(r => r.json()).then(j => {
      if (Array.isArray(j?.team)) setTeam(j.team.map((m: any) => ({ userId: m.userId, displayName: m.displayName, email: m.email })));
    }).catch(() => {});
  }, [canAssignOthers]);

  function resetForm() {
    setFType("follow_up"); setFTitle(""); setFDate(""); setFTime("09:00");
    setFAssignee(""); setFPriority(""); setFNotes(""); setEditingId(null);
  }

  async function submit() {
    if (!fTitle.trim()) return;
    setSaving(true);
    const payload: Record<string, unknown> = {
      type: fType,
      title: fTitle.trim(),
      due_at: toDueIso(fDate, fTime),
      priority: fPriority || null,
      description: fNotes.trim() || null,
      lead_id: leadId,
    };
    if (canAssignOthers && fAssignee) payload.assigned_to = fAssignee;
    try {
      const editing = editingId;
      const url = editing ? `/api/activities/${editing}` : "/api/activities";
      const method = editing ? "PATCH" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "error");
      toast.show({ kind: "success", title: t(editing ? "activities.toast.updated" : "activities.toast.created") });
      resetForm(); setShowForm(false);
      await load();
    } catch {
      toast.show({ kind: "error", title: t("activities.toast.error") });
    }
    setSaving(false);
  }

  async function patch(id: string, body: Record<string, unknown>, doneMsg?: string) {
    setBusyId(id);
    try {
      const r = await fetch(`/api/activities/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error("error");
      if (doneMsg) toast.show({ kind: "success", title: doneMsg });
      await load();
    } catch {
      toast.show({ kind: "error", title: t("activities.toast.error") });
    }
    setBusyId(null);
  }

  function startEdit(a: Activity) {
    setEditingId(a.id);
    setFType(a.type);
    setFTitle(a.title);
    if (a.due_at) {
      const d = new Date(a.due_at);
      setFDate(d.toLocaleDateString("en-CA")); // YYYY-MM-DD
      setFTime(d.toTimeString().slice(0, 5));
    } else { setFDate(""); setFTime("09:00"); }
    setFAssignee(a.assigned_to ?? "");
    setFPriority(a.priority ?? "");
    setFNotes(a.description ?? "");
    setShowForm(true);
  }

  const now = Date.now();
  const grouped = useMemo(() => {
    const g: Record<ActivityBucket, Activity[]> = { overdue: [], today: [], upcoming: [], no_date: [], completed: [], cancelled: [] };
    for (const a of items) g[bucketActivity(a, now)].push(a);
    return g;
  }, [items, now]);

  // "Next" = soonest pending activity with a due date.
  const next = useMemo(() => {
    const pend = items.filter(a => a.status === "pending" && a.due_at).sort((x, y) => Date.parse(x.due_at!) - Date.parse(y.due_at!));
    return pend[0] ?? null;
  }, [items]);

  // IT locale lands in Phase 9; until then Locale is "en" | "es".
  const intlLocale = locale === "es" ? "es-AR" : "en-US";
  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString(intlLocale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

  const bucketColor: Partial<Record<ActivityBucket, string>> = { overdue: C.red, today: gold, upcoming: C.blue };

  function Row({ a }: { a: Activity }) {
    const Icon = TYPE_ICON[a.type] ?? ListTodo;
    const done = a.status === "completed";
    const cancelled = a.status === "cancelled";
    return (
      <div className="flex items-start gap-2.5 py-2 px-2 rounded-lg" style={{ opacity: cancelled ? 0.55 : 1 }}>
        <span className="mt-0.5 w-6 h-6 rounded-md grid place-items-center shrink-0"
          style={{ background: "color-mix(in srgb, var(--brand, #c9a83a) 12%, transparent)", color: "var(--fg1)" }}>
          <Icon size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-semibold" style={{ color: C.textPrimary, textDecoration: done || cancelled ? "line-through" : "none" }}>{a.title}</span>
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: C.surface, color: C.textMuted }}>{t(`activities.type.${a.type}`)}</span>
            {a.priority === "high" && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: C.redLight, color: C.red }}>{t("activities.priority.high")}</span>}
          </div>
          {a.description && <p className="text-[11.5px] mt-0.5" style={{ color: C.textMuted }}>{a.description}</p>}
          <div className="flex items-center gap-2 mt-1 text-[11px]" style={{ color: C.textDim }}>
            <Clock size={11} /> <span>{fmt(a.due_at)}</span>
          </div>
        </div>
        {!done && !cancelled && (
          <div className="flex items-center gap-1 shrink-0">
            <button disabled={busyId === a.id} onClick={() => patch(a.id, { status: "completed" }, t("activities.toast.completed"))}
              title={t("activities.action.complete")} className="w-7 h-7 grid place-items-center rounded-md" style={{ background: C.greenLight, color: C.green }}>
              <Check size={14} />
            </button>
            <button disabled={busyId === a.id} onClick={() => startEdit(a)} title={t("activities.action.edit")}
              className="w-7 h-7 grid place-items-center rounded-md" style={{ background: C.surface, color: C.textMuted }}>
              <Pencil size={13} />
            </button>
            <button disabled={busyId === a.id} onClick={() => patch(a.id, { status: "cancelled" })} title={t("activities.action.cancel")}
              className="w-7 h-7 grid place-items-center rounded-md" style={{ background: C.surface, color: C.textDim }}>
              <X size={13} />
            </button>
          </div>
        )}
        {(done || cancelled) && (
          <button disabled={busyId === a.id} onClick={() => patch(a.id, { status: "pending" })} title={t("activities.action.reopen")}
            className="shrink-0 w-7 h-7 grid place-items-center rounded-md" style={{ background: C.surface, color: C.textMuted }}>
            <RotateCcw size={13} />
          </button>
        )}
      </div>
    );
  }

  function Group({ bucket }: { bucket: ActivityBucket }) {
    const rows = grouped[bucket];
    if (rows.length === 0) return null;
    return (
      <div className="mt-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] px-2" style={{ color: bucketColor[bucket] ?? C.textMuted }}>
          {t(`activities.group.${bucket}`)} · {rows.length}
        </p>
        <div className="mt-0.5">{rows.map(a => <Row key={a.id} a={a} />)}</div>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: C.shadow }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Calendar size={16} style={{ color: gold }} />
          <h3 className="text-[15px] font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{t("activities.section.title")}</h3>
        </div>
        <button onClick={() => { if (showForm) { resetForm(); } setShowForm(v => !v); }}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold"
          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 80%, white))`, color: "#1a1205" }}>
          <Plus size={14} /> {t("activities.add")}
        </button>
      </div>

      {next && !showForm && (
        <div className="mt-3 rounded-xl p-3" style={{ background: "color-mix(in srgb, var(--brand, #c9a83a) 8%, transparent)", border: `1px solid color-mix(in srgb, ${gold} 24%, transparent)` }}>
          <p className="text-[9px] font-bold uppercase tracking-[0.14em]" style={{ color: gold }}>{t("activities.next")}</p>
          <div className="flex items-center justify-between gap-2 mt-1">
            <span className="text-[13px] font-semibold" style={{ color: C.textPrimary }}>{next.title}</span>
            <span className="text-[11px] tabular-nums" style={{ color: C.textMuted }}>{fmt(next.due_at)}</span>
          </div>
        </div>
      )}

      {showForm && (
        <div className="mt-3 rounded-xl p-3 space-y-2.5" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{t("activities.form.type")}</span>
              <select value={fType} onChange={e => setFType(e.target.value as ActivityType)} className="mt-1 w-full rounded-lg px-2 py-1.5 text-[13px]" style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textPrimary }}>
                {ACTIVITY_TYPES.map(ty => <option key={ty} value={ty}>{t(`activities.type.${ty}`)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{t("activities.form.priority")}</span>
              <select value={fPriority} onChange={e => setFPriority(e.target.value)} className="mt-1 w-full rounded-lg px-2 py-1.5 text-[13px]" style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textPrimary }}>
                <option value="">—</option>
                {ACTIVITY_PRIORITIES.map(p => <option key={p} value={p}>{t(`activities.priority.${p}`)}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{t("activities.form.title")}</span>
            <input value={fTitle} onChange={e => setFTitle(e.target.value)} placeholder={t("activities.form.title.ph")} className="mt-1 w-full rounded-lg px-2 py-1.5 text-[13px]" style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textPrimary }} />
          </label>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{t("activities.form.date")}</span>
              <input type="date" value={fDate} onChange={e => setFDate(e.target.value)} className="mt-1 w-full rounded-lg px-2 py-1.5 text-[13px]" style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textPrimary }} />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{t("activities.form.time")}</span>
              <input type="time" value={fTime} onChange={e => setFTime(e.target.value)} className="mt-1 w-full rounded-lg px-2 py-1.5 text-[13px]" style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textPrimary }} />
            </label>
          </div>
          {canAssignOthers && team.length > 0 && (
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{t("activities.form.assignee")}</span>
              <select value={fAssignee} onChange={e => setFAssignee(e.target.value)} className="mt-1 w-full rounded-lg px-2 py-1.5 text-[13px]" style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textPrimary }}>
                <option value="">{t("activities.form.assignee.me")}</option>
                {team.map(m => <option key={m.userId} value={m.userId}>{m.displayName || m.email || m.userId}</option>)}
              </select>
            </label>
          )}
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{t("activities.form.notes")}</span>
            <textarea value={fNotes} onChange={e => setFNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-lg px-2 py-1.5 text-[13px]" style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textPrimary }} />
          </label>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => { resetForm(); setShowForm(false); }} className="rounded-lg px-3 py-1.5 text-[12px] font-semibold" style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textMuted }}>{t("activities.form.cancel")}</button>
            <button disabled={saving || !fTitle.trim()} onClick={submit} className="rounded-lg px-3 py-1.5 text-[12px] font-bold" style={{ background: C.green, color: "#fff", opacity: saving || !fTitle.trim() ? 0.6 : 1 }}>
              {saving ? t("activities.form.saving") : t("activities.form.save")}
            </button>
          </div>
        </div>
      )}

      {!loading && items.length === 0 && !showForm && (
        <div className="mt-4 text-center py-6">
          <p className="text-[13px] font-semibold" style={{ color: C.textPrimary }}>{t("activities.none")}</p>
          <p className="text-[11.5px] mt-1" style={{ color: C.textDim }}>{t("activities.none.hint")}</p>
        </div>
      )}

      <Group bucket="overdue" />
      <Group bucket="today" />
      <Group bucket="upcoming" />
      <Group bucket="no_date" />
      <Group bucket="completed" />
      <Group bucket="cancelled" />
    </section>
  );
}
