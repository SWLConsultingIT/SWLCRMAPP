"use client";

// Referral capture — the "Contactos detectados" block that renders inside the
// Inbox right pane when a reply contains referred contacts (extracted by the
// n8n reply handler into lead_replies.metadata.referred_contacts).
//
// Per contact the seller can: discard it, or "Agregar" → a preview modal shows
// the proposed lead (name/email/role editable, company + ICP inherited from the
// original lead, enrichment badge) and creates it with one of two actions:
//   • "Crear + sumar al flow"  → POST { enrol: true }  (clones the original flow,
//        email-only until Apollo enrichment is wired)
//   • "Solo crear lead"        → POST { enrol: false } (lands in the ICP pool)
//
// Self-contained so InboxView.tsx (1550 lines) only needs a one-line mount.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Sparkles, X as XIcon, Check, Mail, Building2 } from "lucide-react";
import { C } from "@/lib/design";
import { useToast } from "@/lib/toast";

export type ReferredContact = {
  name?: string | null;
  email?: string | null;
  role?: string | null;
  reason?: string | null;
  is_decision_maker?: boolean;
  is_generic_inbox?: boolean;
  status?: string | null;
  created_lead_id?: string | null;
};

function splitName(full: string): { first: string; last: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] ?? "", last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export default function ReferralContactsPanel({
  replyId,
  contacts,
  company,
  icpName,
}: {
  replyId: string;
  contacts: ReferredContact[];
  company: string | null;
  icpName: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [discarded, setDiscarded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  // Editable fields in the modal
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");

  if (!contacts || contacts.length === 0) return null;

  function openModal(idx: number) {
    const c = contacts[idx];
    const n = splitName(c.name ?? "");
    setFirst(n.first);
    setLast(n.last);
    setEmail((c.email ?? "").trim());
    setRole(c.role ?? "");
    setActiveIdx(idx);
  }

  function closeModal() {
    if (busy) return;
    setActiveIdx(null);
  }

  async function submit(enrol: boolean) {
    if (activeIdx === null || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/inbox/referrals/${replyId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactIndex: activeIdx,
          enrol,
          overrides: { firstName: first.trim(), lastName: last.trim(), email: email.trim(), role: role.trim() || null },
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.show({ kind: "error", title: "No se pudo crear", description: (j as { error?: string }).error ?? "Probá de nuevo." });
        return;
      }
      if ((j as { alreadyExisted?: boolean }).alreadyExisted) {
        toast.show({ kind: "warning", title: "Ya existía", description: "Ese email ya es un lead en este tenant." });
        setActiveIdx(null);
        router.refresh();
        return;
      }
      const enrolled = (j as { enrolled?: boolean }).enrolled;
      toast.show({
        kind: "success",
        title: enrolled ? "Lead creado y sumado al flow" : "Lead creado",
        description: enrol && !enrolled
          ? ((j as { message?: string }).message ?? "No se pudo enrolar — quedó en el pool del ICP.")
          : enrolled
            ? "Email-only por ahora (sin enrichment)."
            : "Quedó en el pool del ICP.",
      });
      setActiveIdx(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mx-4 my-2 rounded-xl overflow-hidden border"
      style={{
        borderColor: `color-mix(in srgb, ${C.gold} 35%, transparent)`,
        background: `linear-gradient(180deg, color-mix(in srgb, ${C.gold} 9%, transparent), transparent)`,
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="inline-flex items-center justify-center rounded-md" style={{ width: 20, height: 20, backgroundColor: C.gold, color: "#0C0E1B" }}>
          <UserPlus size={12} />
        </span>
        <span className="text-[12.5px] font-bold" style={{ color: C.textPrimary }}>
          Contactos detectados <span style={{ color: C.textDim, fontWeight: 500 }}>({contacts.length})</span>
        </span>
        <span className="text-[11px]" style={{ color: C.textMuted }}>
          — derivados en esta respuesta
        </span>
      </div>

      <ul className="flex flex-col">
        {contacts.map((c, idx) => {
          const created = c.status === "created";
          const isDiscarded = discarded.has(idx);
          const generic = c.is_generic_inbox;
          return (
            <li
              key={idx}
              className="flex items-center gap-2 px-3 py-2"
              style={{
                borderTop: `1px solid color-mix(in srgb, ${C.gold} 22%, transparent)`,
                opacity: created || isDiscarded || generic ? 0.6 : 1,
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium truncate" style={{ color: C.textPrimary }}>
                    {c.name || c.email || "Contacto"}
                  </span>
                  {c.is_decision_maker && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: "#16A34A22", color: "#16A34A" }}>
                      DECISOR
                    </span>
                  )}
                  {generic && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: C.border, color: C.textDim }}>
                      CASILLA GENÉRICA
                    </span>
                  )}
                </div>
                <div className="text-[11px] truncate" style={{ color: C.textDim }}>
                  {c.email}{c.role ? ` · ${c.role}` : ""}
                </div>
              </div>

              {created ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold shrink-0" style={{ color: "#16A34A" }}>
                  <Check size={12} /> Creado
                </span>
              ) : isDiscarded ? (
                <button
                  type="button"
                  onClick={() => setDiscarded(prev => { const n = new Set(prev); n.delete(idx); return n; })}
                  className="text-[11px] font-medium px-2 py-1 rounded-lg shrink-0"
                  style={{ color: C.textMuted }}
                >
                  Deshacer
                </button>
              ) : (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setDiscarded(prev => new Set(prev).add(idx))}
                    className="text-[11px] font-medium px-2 py-1 rounded-lg border transition-opacity hover:opacity-80"
                    style={{ borderColor: C.border, color: C.textDim, backgroundColor: C.card }}
                  >
                    Descartar
                  </button>
                  <button
                    type="button"
                    onClick={() => openModal(idx)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-85"
                    style={{ borderColor: C.gold, color: C.gold, backgroundColor: C.card }}
                  >
                    <UserPlus size={11} /> Agregar
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Preview modal */}
      {activeIdx !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={closeModal}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border overflow-hidden flex flex-col"
            style={{ backgroundColor: C.card, borderColor: C.border }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: C.border }}>
              <span className="text-[13px] font-semibold" style={{ color: C.textPrimary }}>Nuevo lead desde referral</span>
              <button type="button" onClick={closeModal} className="rounded-lg p-1 hover:opacity-70" style={{ color: C.textMuted }}>
                <XIcon size={15} />
              </button>
            </div>

            <div className="px-4 py-3 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Nombre" value={first} onChange={setFirst} />
                <Field label="Apellido" value={last} onChange={setLast} />
              </div>
              <Field label="Email" value={email} onChange={setEmail} type="email" />
              <Field label="Rol / Cargo" value={role} onChange={setRole} placeholder="(opcional)" />

              {/* Inherited, read-only */}
              <div className="rounded-lg border px-3 py-2 flex flex-col gap-1.5" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                <div className="flex items-center gap-2 text-[11px]" style={{ color: C.textMuted }}>
                  <Building2 size={12} /> Empresa: <span style={{ color: C.textPrimary }}>{company ?? "—"}</span>
                </div>
                <div className="flex items-center gap-2 text-[11px]" style={{ color: C.textMuted }}>
                  <span className="inline-block w-3" /> ICP: <span style={{ color: C.textPrimary }}>{icpName ?? "—"}</span>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: "#C9A83A1A" }}>
                <Sparkles size={13} style={{ color: "#C9A83A", marginTop: 1 }} />
                <span className="text-[11px]" style={{ color: C.textMuted }}>
                  Enrichment pendiente — el lead se crea <strong style={{ color: C.textPrimary }}>email-only</strong>. Cuando se active Apollo, sumará LinkedIn y teléfono automáticamente.
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t" style={{ borderColor: C.border }}>
              <button
                type="button"
                onClick={() => submit(false)}
                disabled={busy}
                className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-85 disabled:opacity-50"
                style={{ borderColor: C.border, color: C.textMuted, backgroundColor: C.bg }}
              >
                Solo crear lead
              </button>
              <button
                type="button"
                onClick={() => submit(true)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: C.gold, color: "#0C0E1B" }}
              >
                <Mail size={12} /> {busy ? "Creando…" : "Crear + sumar al flow"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label, value, onChange, type = "text", placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: C.textDim }}>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="text-[12px] px-2.5 py-1.5 rounded-lg border outline-none"
        style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
      />
    </label>
  );
}
