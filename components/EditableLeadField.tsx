"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X, Loader2 } from "lucide-react";
import { C } from "@/lib/design";
import { useToast } from "@/lib/toast";

// Inline editor for a single lead field. Wraps a display element with a
// hover-revealed pencil affordance; click → input + save/cancel.
// Used on the lead detail header so sellers can fix a typo (eg an
// Argentina mobile missing the +54 9 prefix) without going through CSV
// reimport. The backend (PATCH /api/leads/[id]) enforces a tight
// allowlist of editable fields.

type Props = {
  leadId: string;
  field: "primary_phone" | "primary_secondary_phone" | "primary_work_email" | "primary_linkedin_url";
  value: string | null;
  // Display style controls how the read-only state is rendered. Kept as
  // primitives (strings/booleans) so this component can be called from
  // a server component — passing a render fn across the RSC boundary
  // crashes the production error boundary (see feedback_rsc_no_event_handlers).
  displayAs?: "tel" | "email" | "url" | "text";
  placeholder?: string;
  inputType?: string;
  ariaLabel?: string;
  // CSS class / styling pass-throughs for the display anchor.
  displayClassName?: string;
};

function DisplayValue({ value, displayAs, className }: { value: string | null; displayAs: "tel" | "email" | "url" | "text"; className?: string }) {
  if (!value) {
    return <span className={className ?? "text-sm"} style={{ color: C.textDim }}>—</span>;
  }
  const cls = className ?? "text-sm font-medium hover:underline";
  const styl = { color: C.textBody };
  if (displayAs === "tel") return <a href={`tel:${value}`} className={cls} style={styl}>{value}</a>;
  if (displayAs === "email") return <a href={`mailto:${value}`} className={cls} style={styl}>{value}</a>;
  if (displayAs === "url") return <a href={value} target="_blank" rel="noreferrer" className={cls} style={styl}>{value}</a>;
  return <span className={cls} style={styl}>{value}</span>;
}

export default function EditableLeadField({ leadId, field, value, displayAs = "text", placeholder, inputType = "text", ariaLabel, displayClassName }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState<string | null>(value);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Sync prop changes (server re-renders the page with fresh data)
  useEffect(() => { setCurrent(value); setDraft(value ?? ""); }, [value]);
  useEffect(() => { if (editing) setTimeout(() => inputRef.current?.focus(), 0); }, [editing]);

  async function save() {
    if (saving) return;
    const next = draft.trim();
    if (next === (current ?? "")) { setEditing(false); return; }
    setSaving(true);
    try {
      const r = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: next || null }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        toast.show({ kind: "error", title: "Couldn't save", description: j.error || "Try again." });
        return;
      }
      setCurrent(next || null);
      setEditing(false);
      // refresh server components so the rest of the page (CallButton's
      // phones list, etc.) picks up the new value.
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(current ?? "");
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          type={inputType}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            else if (e.key === "Escape") cancel();
          }}
          aria-label={ariaLabel ?? `Edit ${field}`}
          placeholder={placeholder}
          disabled={saving}
          className="text-sm font-medium rounded-md px-2 py-1 border outline-none"
          style={{
            borderColor: C.gold,
            background: C.card,
            color: C.textPrimary,
            minWidth: 180,
          }}
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          aria-label="Save"
          className="rounded-md p-1 transition-opacity hover:opacity-85 disabled:opacity-50"
          style={{ background: C.green, color: "#fff" }}
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} strokeWidth={3} />}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          aria-label="Cancel"
          className="rounded-md p-1 transition-opacity hover:opacity-85 disabled:opacity-50"
          style={{ background: C.surface, color: C.textMuted }}
        >
          <X size={12} strokeWidth={3} />
        </button>
      </div>
    );
  }

  return (
    <div className="group inline-flex items-center gap-1.5">
      <DisplayValue value={current} displayAs={displayAs} className={displayClassName} />
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${field}`}
        // 2026-06-01: the 11px pencil at 50% opacity was indistinguishable
        // from background noise — Fran reported "sigo sin ver el botón de
        // editar número" on the lead detail Mobile card. Bumped to a 13px
        // glyph rendered on a brand-tinted pill (always visible) so the
        // affordance reads as "edit" without needing to hover-discover it.
        className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors hover:bg-black/[0.04]"
        style={{
          color: "var(--brand, #c9a83a)",
          borderColor: "color-mix(in srgb, var(--brand, #c9a83a) 35%, transparent)",
          backgroundColor: "color-mix(in srgb, var(--brand, #c9a83a) 10%, transparent)",
        }}
      >
        <Pencil size={11} />
        Edit
      </button>
    </div>
  );
}
