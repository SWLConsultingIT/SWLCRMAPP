"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Check, X } from "lucide-react";
import { C } from "@/lib/design";

// Red "Wrong number" pill that opens an inline replace flow on click.
// Renders in the lead detail header in place of the Call button when
// allow_call=false. Saving a new number hits PATCH /api/leads/[id],
// which auto re-enables allow_call (see app/api/leads/[id]/route.ts).
// Designed for the header layout — single line in the default state,
// expands to a small two-line block while editing so we don't reflow
// the entire actions row.
type Props = {
  leadId: string;
  currentPhone: string | null;
};

export default function WrongNumberPill({ leadId, currentPhone }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentPhone ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const next = value.trim();
    if (!next) {
      setErr("Enter a new number first");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primary_phone: next }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(body.error ?? `HTTP ${r.status}`);
        return;
      }
      setEditing(false);
      // Server-rerender so the header re-flips back to the Call button
      // (allow_call is re-enabled by the PATCH route).
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div
        className="inline-flex flex-col gap-1 rounded-lg border px-3 py-2"
        style={{
          backgroundColor: "color-mix(in srgb, #DC2626 6%, transparent)",
          borderColor: "color-mix(in srgb, #DC2626 35%, transparent)",
          minWidth: 240,
        }}
      >
        {currentPhone && (
          <div className="flex items-center gap-2 text-[11px]" style={{ color: C.textMuted }}>
            <span>Old:</span>
            <span style={{ textDecoration: "line-through", color: C.textMuted }}>{currentPhone}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <input
            type="tel"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void save(); }
              if (e.key === "Escape") { setEditing(false); setValue(currentPhone ?? ""); setErr(null); }
            }}
            placeholder="+54 9 11 1234 5678"
            className="text-[13px] bg-transparent outline-none flex-1 min-w-0 px-2 py-1 rounded-md border"
            style={{ color: C.textPrimary, borderColor: C.border, backgroundColor: C.card }}
            disabled={saving}
          />
          <button
            type="button"
            onClick={save}
            disabled={saving}
            aria-label="Save new number"
            className="rounded-md p-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
            style={{ backgroundColor: "#16A34A", color: "#fff" }}
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          </button>
          <button
            type="button"
            onClick={() => { setEditing(false); setValue(currentPhone ?? ""); setErr(null); }}
            disabled={saving}
            aria-label="Cancel"
            className="rounded-md p-1.5 transition-opacity hover:opacity-85 disabled:opacity-50"
            style={{ backgroundColor: C.surface, color: C.textMuted, border: `1px solid ${C.border}` }}
          >
            <X size={12} />
          </button>
        </div>
        {err && <span className="text-[10.5px]" style={{ color: "#DC2626" }}>{err}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Phone marked wrong. Click to replace and re-enable the Call channel."
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold whitespace-nowrap transition-opacity hover:opacity-85"
      style={{
        backgroundColor: "color-mix(in srgb, #DC2626 14%, transparent)",
        color: "#DC2626",
        border: "1px solid color-mix(in srgb, #DC2626 35%, transparent)",
      }}
    >
      <AlertTriangle size={14} />
      Wrong number
      <span className="opacity-60 font-normal hidden sm:inline">· click to replace</span>
    </button>
  );
}
