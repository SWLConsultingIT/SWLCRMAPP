"use client";

// UNIVERSAL Activity Composer (phase 1). The ONE reusable UX layer for creating
// an activity from anywhere — global modal, drawer (inbox/lead detail), or inline
// (inside the call-outcome modal). Same internal logic in all three; only the
// wrapper differs. It is UX ONLY: validation, tenant/ownership and side effects
// live server-side (createActivity → POST /api/activities). No business rules,
// no local store here.
//
// Rule: ASK ONLY WHAT WE DON'T KNOW. Fields are shown based on `context`:
//   - leadId known        → hide lead search (show a chip)
//   - type known (inline) → show type as a fixed label
//   - seller known        → hide the assignee picker
//   - tz known/inferred   → preselect it

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { countryToTimeZone } from "@/lib/prospect-time";
import { leadDisplayName } from "@/lib/lead-label";
import { createActivity } from "@/lib/create-activity";
import { presetToWall, PRESET_KEYS, type PresetKey } from "@/lib/activity-presets";
import {
  ACTIVITY_TYPES, COMMON_TIMEZONES, browserTimeZone, wallTimeToUtcIso, wallPartsInTz,
  type ActivityType,
} from "@/lib/activities";
import { X, Search, Building2, Calendar, Bell } from "lucide-react";

const gold = "var(--brand, #c9a83a)";

export type ActivityComposerContext = {
  leadId?: string | null;
  leadLabel?: string | null;
  company?: string | null;
  contactCountry?: string | null;
  type?: ActivityType;
  assignedSeller?: string | null;
  dueTz?: string | null;
  source?: string;
  sourceReferenceId?: string | null;
  suggestedDueAt?: string | null;
  title?: string;
  notes?: string;
  reminderOffset?: number | null;
};

type LeadHit = { id: string; primary_first_name: string | null; primary_last_name: string | null; company_name: string | null; company_country: string | null };
type Mode = "modal" | "drawer" | "inline";

const REMINDER_OPTS: { value: string; key: string }[] = [
  { value: "", key: "none" }, { value: "0", key: "at" }, { value: "10", key: "10" }, { value: "30", key: "30" }, { value: "60", key: "60" },
];

export default function ActivityComposer({
  mode, open = true, onClose, onCreated, context = {}, canAssignOthers = false,
}: {
  mode: Mode;
  open?: boolean;
  onClose?: () => void;
  onCreated?: (activity: Record<string, unknown>) => void;
  context?: ActivityComposerContext;
  canAssignOthers?: boolean;
}) {
  const { t } = useLocale();
  const toast = useToast();

  const knownLead = !!context.leadId;
  const fixedType = mode === "inline" && !!context.type;
  const knownSeller = !!context.assignedSeller;

  const initialTz = context.dueTz || countryToTimeZone(context.contactCountry ?? null) || browserTimeZone();
  const suggested = context.suggestedDueAt ? wallPartsInTz(new Date(context.suggestedDueAt), initialTz) : null;

  const [type, setType] = useState<ActivityType>(context.type ?? "call");
  const [title, setTitle] = useState(context.title ?? "");
  const [lead, setLead] = useState<{ id: string; label: string; company: string | null } | null>(
    context.leadId ? { id: context.leadId, label: context.leadLabel ?? t("activities.lead"), company: context.company ?? null } : null,
  );
  const [tz, setTz] = useState(initialTz);
  const [date, setDate] = useState(suggested?.date ?? "");
  const [time, setTime] = useState(suggested?.time ?? "10:00");
  const [assignee, setAssignee] = useState("");
  const [notes, setNotes] = useState(context.notes ?? "");
  const [reminder, setReminder] = useState<string>(context.reminderOffset != null ? String(context.reminderOffset) : "");
  const [saving, setSaving] = useState(false);

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<LeadHit[]>([]);
  const [team, setTeam] = useState<{ userId: string; label: string }[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open || knownSeller || !canAssignOthers) return;
    fetch("/api/team", { cache: "no-store" }).then(r => r.json()).then(j => {
      if (Array.isArray(j?.team)) setTeam(j.team.map((m: { userId: string; displayName: string | null; email: string | null }) => ({ userId: m.userId, label: m.displayName || m.email || m.userId })));
    }).catch(() => {});
  }, [open, knownSeller, canAssignOthers]);

  const applyPreset = useCallback((preset: PresetKey) => {
    if (preset === "pick") { setDate(prev => prev || wallPartsInTz(new Date(), tz).date); return; }
    const w = presetToWall(preset, tz);
    if (w) { setDate(w.date); setTime(w.time); }
  }, [tz]);

  function runSearch(term: string) {
    setQ(term);
    if (debounce.current) clearTimeout(debounce.current);
    if (term.trim().length < 2) { setHits([]); return; }
    debounce.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/leads/search?q=${encodeURIComponent(term.trim())}&limit=8`, { cache: "no-store" });
        const j = await r.json();
        setHits(Array.isArray(j?.leads) ? j.leads : []);
      } catch { setHits([]); }
    }, 250);
  }
  function pickLead(h: LeadHit) {
    setLead({ id: h.id, label: leadDisplayName(h), company: h.company_name });
    const inferred = countryToTimeZone(h.company_country);
    if (inferred) setTz(inferred);
    setQ(""); setHits([]);
  }

  async function save() {
    const finalTitle = title.trim() || (fixedType ? t(`activities.type.${type}`) : "");
    if (!finalTitle || saving) return;
    setSaving(true);
    const dueAt = date ? wallTimeToUtcIso(date, time || "10:00", tz) : (context.suggestedDueAt ?? null);
    const res = await createActivity({
      type, title: finalTitle,
      leadId: lead?.id ?? null,
      assignedTo: knownSeller ? context.assignedSeller : (canAssignOthers && assignee ? assignee : null),
      dueAt, dueTz: dueAt ? tz : null,
      reminderOffsetMinutes: reminder === "" ? null : Number(reminder),
      description: notes.trim() || null,
      source: context.source ?? "manual",
      sourceReferenceId: context.sourceReferenceId ?? null,
    });
    setSaving(false);
    if (res.ok) { toast.show({ kind: "success", title: t("activities.toast.created") }); onCreated?.(res.activity); onClose?.(); }
    else toast.show({ kind: "error", title: t("activities.toast.error") });
  }

  const field = { background: C.card, border: `1px solid ${C.border}`, color: C.textPrimary } as const;
  const labelCls = "text-[10px] font-bold uppercase tracking-wider";
  const canSave = !!(title.trim() || (fixedType && type));

  const body = (
    <div className="space-y-3">
      {/* Lead — only when unknown */}
      {!knownLead ? (
        <div>
          <span className={labelCls} style={{ color: C.textMuted }}>{t("activities.form.lead")}</span>
          {lead ? (
            <div className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2" style={field}>
              <Building2 size={14} style={{ color: gold }} />
              <span className="text-[13px] font-semibold flex-1 min-w-0 truncate" style={{ color: C.textPrimary }}>{lead.label}{lead.company ? <span className="font-normal" style={{ color: C.textDim }}> · {lead.company}</span> : null}</span>
              <button onClick={() => setLead(null)} className="text-[11px] font-semibold" style={{ color: gold }}>{t("activities.form.lead.clear")}</button>
            </div>
          ) : (
            <div className="mt-1 relative">
              <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={field}>
                <Search size={14} style={{ color: C.textDim }} />
                <input value={q} onChange={e => runSearch(e.target.value)} placeholder={t("activities.form.lead.ph")} className="bg-transparent text-[13px] outline-none flex-1" style={{ color: C.textPrimary }} />
              </div>
              {hits.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border overflow-hidden max-h-56 overflow-y-auto" style={{ background: C.card, borderColor: C.border, boxShadow: C.shadowMd }}>
                  {hits.map(h => (
                    <button key={h.id} onClick={() => pickLead(h)} className="w-full text-left px-3 py-2 hover:bg-black/[0.04]">
                      <span className="text-[13px] font-semibold" style={{ color: C.textPrimary }}>{leadDisplayName(h)}</span>
                      {h.company_name && <span className="text-[11.5px]" style={{ color: C.textDim }}> · {h.company_name}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (context.leadLabel || context.company) && mode !== "inline" ? (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
          <Building2 size={14} style={{ color: gold }} />
          <span className="text-[13px] font-semibold" style={{ color: C.textPrimary }}>{context.leadLabel}{context.company ? <span className="font-normal" style={{ color: C.textDim }}> · {context.company}</span> : null}</span>
        </div>
      ) : null}

      {/* Type — selector unless fixed inline */}
      {fixedType ? (
        <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: gold }}>{t(`activities.type.${type}`)}</div>
      ) : (
        <label className="block">
          <span className={labelCls} style={{ color: C.textMuted }}>{t("activities.form.type")}</span>
          <select value={type} onChange={e => setType(e.target.value as ActivityType)} className="mt-1 w-full rounded-lg px-2 py-2 text-[13px]" style={field}>
            {ACTIVITY_TYPES.map(ty => <option key={ty} value={ty}>{t(`activities.type.${ty}`)}</option>)}
          </select>
        </label>
      )}

      {/* Title — auto-titled for fixed-type inline, so we hide it there */}
      {!fixedType && (
        <label className="block">
          <span className={labelCls} style={{ color: C.textMuted }}>{t("activities.form.title")}</span>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t("activities.form.title.ph")} className="mt-1 w-full rounded-lg px-3 py-2 text-[13px]" style={field} />
        </label>
      )}

      {/* When — presets + date/time + tz */}
      <div>
        <span className={labelCls} style={{ color: C.textMuted }}>{t("activities.form.when")}</span>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {PRESET_KEYS.map(p => (
            <button key={p} onClick={() => applyPreset(p)} className="text-[11px] font-semibold rounded-full px-2.5 py-1" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.textMuted }}>
              {t(`activities.preset.${p}`)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="rounded-lg px-2 py-2 text-[13px]" style={field} />
          <input type="time" value={time} onChange={e => setTime(e.target.value)} className="rounded-lg px-2 py-2 text-[13px]" style={field} />
        </div>
        <select value={tz} onChange={e => setTz(e.target.value)} className="mt-2 w-full rounded-lg px-2 py-1.5 text-[12px]" style={field}>
          {COMMON_TIMEZONES.some(z => z.value === tz) ? null : <option value={tz}>{tz}</option>}
          {COMMON_TIMEZONES.map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
        </select>
      </div>

      {/* Reminder */}
      <label className="block">
        <span className={labelCls + " flex items-center gap-1"} style={{ color: C.textMuted }}><Bell size={11} /> {t("activities.form.reminder")}</span>
        <select value={reminder} onChange={e => setReminder(e.target.value)} className="mt-1 w-full rounded-lg px-2 py-2 text-[13px]" style={field}>
          {REMINDER_OPTS.map(o => <option key={o.key} value={o.value}>{t(`activities.reminder.${o.key}`)}</option>)}
        </select>
      </label>

      {/* Seller — only when unknown + allowed */}
      {!knownSeller && canAssignOthers && team.length > 0 && (
        <label className="block">
          <span className={labelCls} style={{ color: C.textMuted }}>{t("activities.form.assignee")}</span>
          <select value={assignee} onChange={e => setAssignee(e.target.value)} className="mt-1 w-full rounded-lg px-2 py-2 text-[13px]" style={field}>
            <option value="">{t("activities.form.assignee.me")}</option>
            {team.map(m => <option key={m.userId} value={m.userId}>{m.label}</option>)}
          </select>
        </label>
      )}

      {/* Note */}
      <label className="block">
        <span className={labelCls} style={{ color: C.textMuted }}>{t("activities.form.notes")}</span>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-lg px-3 py-2 text-[13px]" style={field} />
      </label>
    </div>
  );

  const footer = (
    <div className="flex items-center justify-end gap-2">
      {onClose && <button onClick={onClose} className="rounded-lg px-3.5 py-2 text-[12px] font-semibold" style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textMuted }}>{t("activities.form.cancel")}</button>}
      <button disabled={saving || !canSave} onClick={save} className="rounded-lg px-4 py-2 text-[12px] font-bold" style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 80%, white))`, color: "#1a1205", opacity: saving || !canSave ? 0.6 : 1 }}>
        {saving ? t("activities.form.saving") : t("activities.form.save")}
      </button>
    </div>
  );

  // INLINE — no portal/overlay; caller embeds it (e.g. inside the outcome modal).
  if (mode === "inline") {
    return <div className="space-y-3">{body}{footer}</div>;
  }

  if (!open || typeof document === "undefined") return null;

  const header = (
    <div className="flex items-center justify-between px-5 py-3.5 border-b sticky top-0" style={{ borderColor: C.border, background: C.card }}>
      <div className="flex items-center gap-2"><Calendar size={16} style={{ color: gold }} /><h3 className="text-[15px] font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{t("activities.new")}</h3></div>
      {onClose && <button onClick={onClose} className="w-7 h-7 grid place-items-center rounded-md" style={{ color: C.textMuted }}><X size={16} /></button>}
    </div>
  );

  // DRAWER — right side panel.
  if (mode === "drawer") {
    return createPortal(
      <>
        <div className="fixed inset-0 z-[9998]" style={{ backgroundColor: "rgba(15,23,42,0.35)" }} onClick={onClose} aria-hidden />
        <div className="fixed z-[9999] right-0 top-0 h-full w-[92vw] max-w-md border-l overflow-y-auto flex flex-col" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "-16px 0 48px -16px rgba(0,0,0,0.4)" }}>
          {header}
          <div className="p-5 flex-1">{body}</div>
          <div className="px-5 py-3.5 border-t sticky bottom-0" style={{ borderColor: C.border, background: C.card }}>{footer}</div>
        </div>
      </>,
      document.body,
    );
  }

  // MODAL — centered.
  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" style={{ backgroundColor: "rgba(15,23,42,0.35)" }} onClick={onClose} aria-hidden />
      <div className="fixed z-[9999] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-lg rounded-2xl border max-h-[90vh] overflow-y-auto" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 24px 64px -16px rgba(0,0,0,0.4)" }}>
        {header}
        <div className="p-5">{body}</div>
        <div className="px-5 py-3.5 border-t sticky bottom-0" style={{ borderColor: C.border, background: C.card }}>{footer}</div>
      </div>
    </>,
    document.body,
  );
}
