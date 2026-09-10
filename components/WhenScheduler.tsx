"use client";

// Shared "When?" scheduling block — the ONE reusable scheduling UX (presets +
// date/time + timezone + reminder). Used by both the ActivityComposer and the
// call-outcome callback flow, so presets/tz/reminder never diverge. Controlled
// component: it holds no business logic, just edits a { date, time, tz,
// reminderOffset } value and calls onChange.

import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { COMMON_TIMEZONES } from "@/lib/activities";
import { presetToWall, PRESET_KEYS, type PresetKey } from "@/lib/activity-presets";
import { Bell } from "lucide-react";

export type WhenValue = { date: string; time: string; tz: string; reminderOffset: string };

const REMINDER_OPTS: { value: string; key: string }[] = [
  { value: "", key: "none" }, { value: "0", key: "at" }, { value: "10", key: "10" }, { value: "30", key: "30" }, { value: "60", key: "60" },
];

export default function WhenScheduler({
  value, onChange, showReminder = true, compact = false,
}: {
  value: WhenValue;
  onChange: (v: WhenValue) => void;
  showReminder?: boolean;
  compact?: boolean;
}) {
  const { t } = useLocale();
  const field = { background: C.card, border: `1px solid ${C.border}`, color: C.textPrimary } as const;

  function applyPreset(p: PresetKey) {
    if (p === "pick") return; // reveal manual inputs (already visible)
    const w = presetToWall(p, value.tz);
    if (w) onChange({ ...value, date: w.date, time: w.time });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {PRESET_KEYS.filter(p => p !== "pick").map(p => (
          <button key={p} type="button" onClick={() => applyPreset(p)}
            className="text-[11px] font-semibold rounded-full px-2.5 py-1"
            style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.textMuted }}>
            {t(`activities.preset.${p}`)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={value.date} onChange={e => onChange({ ...value, date: e.target.value })} className="rounded-lg px-2 py-2 text-[13px]" style={field} />
        <input type="time" value={value.time} onChange={e => onChange({ ...value, time: e.target.value })} className="rounded-lg px-2 py-2 text-[13px]" style={field} />
      </div>
      <select value={value.tz} onChange={e => onChange({ ...value, tz: e.target.value })} className="w-full rounded-lg px-2 py-1.5 text-[12px]" style={field}>
        {COMMON_TIMEZONES.some(z => z.value === value.tz) ? null : <option value={value.tz}>{value.tz}</option>}
        {COMMON_TIMEZONES.map(z => <option key={z.value} value={z.value}>{z.label}</option>)}
      </select>
      {showReminder && (
        <label className={`flex items-center gap-2 ${compact ? "text-[11px]" : ""}`}>
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider shrink-0" style={{ color: C.textMuted }}><Bell size={11} /> {t("activities.form.reminder")}</span>
          <select value={value.reminderOffset} onChange={e => onChange({ ...value, reminderOffset: e.target.value })} className="flex-1 rounded-lg px-2 py-1.5 text-[12px]" style={field}>
            {REMINDER_OPTS.map(o => <option key={o.key} value={o.value}>{t(`activities.reminder.${o.key}`)}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
