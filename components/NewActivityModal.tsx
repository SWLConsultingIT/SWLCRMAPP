"use client";

// Global "+ New activity" modal (block 3). Create an activity from anywhere:
// search a lead, pick type/date/time/timezone/seller/notes. Timezone is inferred
// from the lead's country (existing prospect-time infra) and editable; the local
// wall-time is converted to an absolute due_at (DST-correct) while due_tz keeps
// the human's intended zone. Lead labelling goes through leadDisplayName so it
// degrades gracefully for encrypted leads without this modal knowing anything.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { countryToTimeZone } from "@/lib/prospect-time";
import { leadDisplayName } from "@/lib/lead-label";
import {
  ACTIVITY_TYPES, ACTIVITY_PRIORITIES, COMMON_TIMEZONES, browserTimeZone, wallTimeToUtcIso,
  type ActivityType,
} from "@/lib/activities";
import { X, Search, Building2, Calendar } from "lucide-react";

const gold = "var(--brand, #c9a83a)";

type LeadHit = {
  id: string;
  primary_first_name: string | null;
  primary_last_name: string | null;
  company_name: string | null;
  company_country: string | null;
};

export default function NewActivityModal({
  open, onClose, onCreated, canAssignOthers = false,
  presetLead = null, source = "manual",
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  canAssignOthers?: boolean;
  presetLead?: { id: string; label: string; company?: string | null; country?: string | null } | null;
  source?: string;
}) {
  const { t } = useLocale();
  const toast = useToast();

  const [type, setType] = useState<ActivityType>("call");
  const [title, setTitle] = useState("");
  const [lead, setLead] = useState<{ id: string; label: string; company: string | null } | null>(null);
  const [tz, setTz] = useState<string>(browserTimeZone());
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // lead search
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<LeadHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [team, setTeam] = useState<{ userId: string; label: string }[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    setType("call"); setTitle(""); setLead(null); setTz(browserTimeZone());
    setDate(""); setTime("09:00"); setPriority(""); setAssignee(""); setNotes("");
    setQ(""); setHits([]);
  }, []);

  useEffect(() => {
    if (!open) return;
    reset();
    if (presetLead) {
      setLead({ id: presetLead.id, label: presetLead.label, company: presetLead.company ?? null });
      const inferred = countryToTimeZone(presetLead.country);
      if (inferred) setTz(inferred);
    }
  }, [open, presetLead, reset]);

  useEffect(() => {
    if (!open || !canAssignOthers) return;
    fetch("/api/team", { cache: "no-store" }).then(r => r.json()).then(j => {
      if (Array.isArray(j?.team)) setTeam(j.team.map((m: any) => ({ userId: m.userId, label: m.displayName || m.email || m.userId })));
    }).catch(() => {});
  }, [open, canAssignOthers]);

  useEffect(() => {
    if (!open) return;
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  function runSearch(term: string) {
    setQ(term);
    if (debounce.current) clearTimeout(debounce.current);
    if (term.trim().length < 2) { setHits([]); return; }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`/api/leads/search?q=${encodeURIComponent(term.trim())}&limit=8`, { cache: "no-store" });
        const j = await r.json();
        setHits(Array.isArray(j?.leads) ? j.leads : []);
      } catch { setHits([]); }
      setSearching(false);
    }, 250);
  }

  function pickLead(h: LeadHit) {
    setLead({ id: h.id, label: leadDisplayName(h), company: h.company_name });
    const inferred = countryToTimeZone(h.company_country);
    if (inferred) setTz(inferred);
    setQ(""); setHits([]);
  }

  async function save() {
    if (!title.trim() || saving) return;
    setSaving(true);
    const due_at = date ? wallTimeToUtcIso(date, time || "09:00", tz) : null;
    const payload: Record<string, unknown> = {
      type, title: title.trim(),
      lead_id: lead?.id ?? null,
      due_at, due_tz: date ? tz : null,
      priority: priority || null,
      description: notes.trim() || null,
      source,
    };
    if (canAssignOthers && assignee) payload.assigned_to = assignee;
    try {
      const r = await fetch("/api/activities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || "error");
      toast.show({ kind: "success", title: t("activities.toast.created") });
      onCreated();
      onClose();
    } catch {
      toast.show({ kind: "error", title: t("activities.toast.error") });
    }
    setSaving(false);
  }

  if (!open || typeof document === "undefined") return null;

  const field = { background: C.card, border: `1px solid ${C.border}`, color: C.textPrimary } as const;
  const labelCls = "text-[10px] font-bold uppercase tracking-wider";

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" style={{ backgroundColor: "rgba(15,23,42,0.35)" }} onClick={onClose} aria-hidden />
      <div className="fixed z-[9999] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-lg rounded-2xl border max-h-[90vh] overflow-y-auto"
        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 24px 64px -16px rgba(0,0,0,0.4)" }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b sticky top-0" style={{ borderColor: C.border, background: C.card }}>
          <div className="flex items-center gap-2">
            <Calendar size={16} style={{ color: gold }} />
            <h3 className="text-[15px] font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{t("activities.new")}</h3>
          </div>
          <button onClick={onClose} className="w-7 h-7 grid place-items-center rounded-md" style={{ color: C.textMuted }}><X size={16} /></button>
        </div>

        <div className="p-5 space-y-3">
          {/* Lead */}
          <div>
            <span className={labelCls} style={{ color: C.textMuted }}>{t("activities.form.lead")}</span>
            {lead ? (
              <div className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2" style={field}>
                <Building2 size={14} style={{ color: gold }} />
                <span className="text-[13px] font-semibold flex-1 min-w-0 truncate" style={{ color: C.textPrimary }}>
                  {lead.label}{lead.company ? <span className="font-normal" style={{ color: C.textDim }}> · {lead.company}</span> : null}
                </span>
                <button onClick={() => setLead(null)} className="text-[11px] font-semibold" style={{ color: gold }}>{t("activities.form.lead.clear")}</button>
              </div>
            ) : (
              <div className="mt-1 relative">
                <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={field}>
                  <Search size={14} style={{ color: C.textDim }} />
                  <input value={q} onChange={e => runSearch(e.target.value)} placeholder={t("activities.form.lead.ph")} className="bg-transparent text-[13px] outline-none flex-1" style={{ color: C.textPrimary }} autoFocus />
                </div>
                {(hits.length > 0 || searching) && (
                  <div className="absolute z-10 mt-1 w-full rounded-lg border overflow-hidden max-h-56 overflow-y-auto" style={{ background: C.card, borderColor: C.border, boxShadow: C.shadowMd }}>
                    {searching && hits.length === 0 && <p className="px-3 py-2 text-[12px]" style={{ color: C.textDim }}>…</p>}
                    {hits.map(h => (
                      <button key={h.id} onClick={() => pickLead(h)} className="w-full text-left px-3 py-2 hover:bg-black/[0.04]">
                        <span className="text-[13px] font-semibold" style={{ color: C.textPrimary }}>{leadDisplayName(h)}</span>
                        {h.company_name && <span className="text-[11.5px]" style={{ color: C.textDim }}> · {h.company_name}</span>}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[10.5px] mt-1" style={{ color: C.textDim }}>{t("activities.form.lead.none")}</p>
              </div>
            )}
          </div>

          {/* Type + priority */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelCls} style={{ color: C.textMuted }}>{t("activities.form.type")}</span>
              <select value={type} onChange={e => setType(e.target.value as ActivityType)} className="mt-1 w-full rounded-lg px-2 py-2 text-[13px]" style={field}>
                {ACTIVITY_TYPES.map(ty => <option key={ty} value={ty}>{t(`activities.type.${ty}`)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelCls} style={{ color: C.textMuted }}>{t("activities.form.priority")}</span>
              <select value={priority} onChange={e => setPriority(e.target.value)} className="mt-1 w-full rounded-lg px-2 py-2 text-[13px]" style={field}>
                <option value="">—</option>
                {ACTIVITY_PRIORITIES.map(p => <option key={p} value={p}>{t(`activities.priority.${p}`)}</option>)}
              </select>
            </label>
          </div>

          {/* Title */}
          <label className="block">
            <span className={labelCls} style={{ color: C.textMuted }}>{t("activities.form.title")}</span>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t("activities.form.title.ph")} className="mt-1 w-full rounded-lg px-3 py-2 text-[13px]" style={field} />
          </label>

          {/* Date + time + tz */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelCls} style={{ color: C.textMuted }}>{t("activities.form.date")}</span>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="mt-1 w-full rounded-lg px-2 py-2 text-[13px]" style={field} />
            </label>
            <label className="block">
              <span className={labelCls} style={{ color: C.textMuted }}>{t("activities.form.time")}</span>
              <input type="time" value={time} onChange={e => setTime(e.target.value)} className="mt-1 w-full rounded-lg px-2 py-2 text-[13px]" style={field} />
            </label>
          </div>
          <label className="block">
            <span className={labelCls} style={{ color: C.textMuted }}>{t("activities.form.timezone")}</span>
            <select value={tz} onChange={e => setTz(e.target.value)} className="mt-1 w-full rounded-lg px-2 py-2 text-[13px]" style={field}>
              {COMMON_TIMEZONES.some(z => z.value === tz) ? null : <option value={tz}>{tz}</option>}
              {COMMON_TIMEZONES.map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
            </select>
          </label>

          {/* Assignee */}
          {canAssignOthers && team.length > 0 && (
            <label className="block">
              <span className={labelCls} style={{ color: C.textMuted }}>{t("activities.form.assignee")}</span>
              <select value={assignee} onChange={e => setAssignee(e.target.value)} className="mt-1 w-full rounded-lg px-2 py-2 text-[13px]" style={field}>
                <option value="">{t("activities.form.assignee.me")}</option>
                {team.map(m => <option key={m.userId} value={m.userId}>{m.label}</option>)}
              </select>
            </label>
          )}

          {/* Notes */}
          <label className="block">
            <span className={labelCls} style={{ color: C.textMuted }}>{t("activities.form.notes")}</span>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-lg px-3 py-2 text-[13px]" style={field} />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t sticky bottom-0" style={{ borderColor: C.border, background: C.card }}>
          <button onClick={onClose} className="rounded-lg px-3.5 py-2 text-[12px] font-semibold" style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textMuted }}>{t("activities.form.cancel")}</button>
          <button disabled={saving || !title.trim()} onClick={save} className="rounded-lg px-4 py-2 text-[12px] font-bold" style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 80%, white))`, color: "#1a1205", opacity: saving || !title.trim() ? 0.6 : 1 }}>
            {saving ? t("activities.form.saving") : t("activities.form.save")}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
