"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X, Loader2, AlertCircle } from "lucide-react";
import { C } from "@/lib/design";

// Panel that surfaces and edits the "why was this lead lost" reason on
// /leads/lost/[id]. Storage: lead_replies row with [LOST_REASON] prefix
// — see app/api/leads/[id]/status (POST writes; this component reads
// the latest one server-side via the parent page).
//
// States:
//   - reason exists  → readonly card + small Edit pencil
//   - reason empty   → invite + textarea + Save
type Props = {
  leadId: string;
  initialReason: string | null;
};

export default function LostReasonPanel({ leadId, initialReason }: Props) {
  const router = useRouter();
  const [reason, setReason] = useState(initialReason ?? "");
  const [editing, setEditing] = useState(!initialReason);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setErr("Write the reason first");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed_lost", reason: trimmed }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(body.error ?? `HTTP ${r.status}`); return; }
      setEditing(false);
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rounded-2xl border p-4 mb-4"
      style={{
        backgroundColor: C.card,
        borderColor: initialReason ? C.border : "color-mix(in srgb, #DC2626 25%, transparent)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.04)",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <AlertCircle size={14} style={{ color: initialReason ? C.textMuted : "#DC2626" }} />
          <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: C.textBody }}>
            Why this lead was lost
          </h3>
        </div>
        {initialReason && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide hover:bg-black/[0.04]"
            style={{
              color: "var(--brand, #c9a83a)",
              borderColor: "color-mix(in srgb, var(--brand, #c9a83a) 35%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--brand, #c9a83a) 10%, transparent)",
            }}
          >
            <Pencil size={10} /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Budget, timing, wrong fit, competitor… capture the reason so future research can spot patterns."
            rows={3}
            className="w-full text-sm rounded-lg border px-3 py-2 outline-none focus:ring-2 focus:ring-offset-1 transition-shadow"
            style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
            disabled={saving}
            autoFocus
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold transition-opacity hover:opacity-85 disabled:opacity-50"
              style={{ backgroundColor: "#16A34A", color: "#fff" }}
            >
              {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              Save reason
            </button>
            {initialReason && (
              <button
                type="button"
                onClick={() => { setReason(initialReason); setEditing(false); setErr(null); }}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold transition-colors hover:bg-black/[0.04]"
                style={{ color: C.textMuted, border: `1px solid ${C.border}` }}
              >
                <X size={11} /> Cancel
              </button>
            )}
            {err && <span className="text-[11px]" style={{ color: "#DC2626" }}>{err}</span>}
          </div>
        </div>
      ) : (
        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>
          {initialReason}
        </p>
      )}
    </div>
  );
}
