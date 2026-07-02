"use client";

// Fase 2 — "Send to Odoo" review panel (SWL only). A button on the opportunity
// detail opens a modal that ASSEMBLES everything we'll push to Odoo (contact,
// company, full conversation, seller notes) and lets the seller review/edit the
// GROWTH ENGINE summaries before sending. The actual push to Odoo's custom
// fields is Fase 3 (extends the n8n "Create Odoo Lead" workflow) — so the send
// action here previews + copies the payload; it doesn't write to Odoo yet.

import { useState } from "react";
import { Send, X, Loader2, Copy, Check, MessageSquare, Building2, User, ExternalLink, Trophy } from "lucide-react";
import { C, N } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

type Payload = {
  contact: { name: string; role: string | null; email: string | null; phone: string | null; linkedin: string | null; headline: string | null; seniority: string | null };
  company: { name: string | null; industry: string | null; website: string | null; description: string | null; employees: number | null; annualRevenue: number | null };
  conversation: { history: Array<{ from: "us" | "lead"; channel: string | null; text: string; at: string | null }>; count: number; lastChannel: string | null; link: string; threadId: string | null };
  drafts: { conversationSummary: string; companySummary: string; profileSummary: string; highlights: string; sellerComments: string; nextAction: string };
};

export default function SendToOdooPanel({ leadId, transferred = false }: { leadId: string; transferred?: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [p, setP] = useState<Payload | null>(null);
  const [drafts, setDrafts] = useState<Payload["drafts"] | null>(null);
  const [copied, setCopied] = useState(false);

  async function openPanel() {
    setOpen(true);
    if (p) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/odoo-payload`);
      const d = await r.json();
      if (r.ok) { setP(d); setDrafts(d.drafts); }
    } finally { setLoading(false); }
  }

  function copyPayload() {
    if (!p || !drafts) return;
    const text = [
      `— CONTACT —\n${p.contact.name}${p.contact.role ? ` · ${p.contact.role}` : ""}\n${p.contact.email ?? ""} ${p.contact.phone ?? ""}\n${p.contact.linkedin ?? ""}`,
      `— COMPANY —\n${p.company.name ?? ""}${p.company.industry ? ` · ${p.company.industry}` : ""}\n${p.company.website ?? ""}`,
      `— PROFILE SUMMARY —\n${drafts.profileSummary}`,
      `— COMPANY SUMMARY —\n${drafts.companySummary}`,
      `— CONVERSATION SUMMARY —\n${drafts.conversationSummary}`,
      `— HIGHLIGHTS —\n${drafts.highlights}`,
      `— SELLER COMMENTS —\n${drafts.sellerComments}`,
      `— NEXT ACTION —\n${drafts.nextAction}`,
      `— FULL CONVERSATION (${p.conversation.count}) —\n` + p.conversation.history.map(h => `[${h.from === "us" ? "US" : "LEAD"}·${h.channel ?? ""}] ${h.text}`).join("\n"),
    ].join("\n\n");
    navigator.clipboard?.writeText(text);
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  }

  const setDraft = (k: keyof Payload["drafts"], v: string) => setDrafts(d => (d ? { ...d, [k]: v } : d));

  const Field = ({ k, label, rows = 2, placeholder }: { k: keyof Payload["drafts"]; label: string; rows?: number; placeholder?: string }) => (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</label>
      <textarea value={drafts?.[k] ?? ""} onChange={e => setDraft(k, e.target.value)} rows={rows} placeholder={placeholder}
        className="w-full mt-1 px-3 py-2 rounded-lg border text-[12.5px] outline-none resize-y" style={{ backgroundColor: C.bg, borderColor: C.border, color: C.textBody }} />
    </div>
  );

  return (
    <>
      <button onClick={openPanel}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold transition-all hover:-translate-y-px"
        style={{ background: transferred ? C.greenLight : `linear-gradient(135deg, ${N.ink2}, ${N.ink})`, color: transferred ? C.green : "#fff", border: transferred ? `1px solid color-mix(in srgb, ${C.green} 35%, transparent)` : `1px solid ${N.hairline}`, boxShadow: transferred ? undefined : "0 8px 22px -10px rgba(0,0,0,0.5)" }}>
        {transferred ? <><Trophy size={15} /> Already in Odoo — review payload</> : <><Send size={15} style={{ color: gold }} /> Send to Odoo</>}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(11,15,26,0.5)", backdropFilter: "blur(3px)" }} onClick={() => setOpen(false)}>
          <div className="w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden max-h-[92vh] flex flex-col" style={{ backgroundColor: C.card, borderColor: C.border }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-5 py-4 flex items-center justify-between shrink-0" style={{ background: `linear-gradient(135deg, ${N.ink2}, ${N.ink})` }}>
              <div className="flex items-center gap-2.5">
                <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${gold}, ${C.goldDim})`, color: N.ink }}><Send size={15} /></span>
                <div>
                  <p className="text-[14px] font-bold" style={{ color: "#fff" }}>Send to Odoo</p>
                  <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.6)" }}>Review everything before it lands in the Odoo CRM (PROSPECT)</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "#fff" }}><X size={16} /></button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {loading || !p || !drafts ? (
                <div className="flex flex-col items-center gap-2 py-16" style={{ color: C.textMuted }}><Loader2 size={22} className="animate-spin" /><span className="text-[12px]">Assembling payload…</span></div>
              ) : (
                <>
                  {/* Contact + Company (read-only) */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border p-3" style={{ backgroundColor: C.bg, borderColor: C.border }}>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5 inline-flex items-center gap-1" style={{ color: C.gold }}><User size={11} /> Contact</p>
                      <p className="text-[13px] font-semibold" style={{ color: C.textPrimary }}>{p.contact.name || "—"}</p>
                      <p className="text-[11.5px]" style={{ color: C.textMuted }}>{p.contact.role ?? ""}</p>
                      <p className="text-[11px] mt-1 break-words" style={{ color: C.textBody }}>{[p.contact.email, p.contact.phone].filter(Boolean).join(" · ")}</p>
                    </div>
                    <div className="rounded-lg border p-3" style={{ backgroundColor: C.bg, borderColor: C.border }}>
                      <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5 inline-flex items-center gap-1" style={{ color: C.gold }}><Building2 size={11} /> Company</p>
                      <p className="text-[13px] font-semibold" style={{ color: C.textPrimary }}>{p.company.name || "—"}</p>
                      <p className="text-[11.5px]" style={{ color: C.textMuted }}>{p.company.industry ?? ""}</p>
                      {p.company.website && <p className="text-[11px] mt-1 truncate" style={{ color: C.blue }}>{p.company.website}</p>}
                    </div>
                  </div>

                  {/* Conversation */}
                  <div className="rounded-lg border p-3" style={{ backgroundColor: C.bg, borderColor: C.border }}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1" style={{ color: C.gold }}><MessageSquare size={11} /> Full conversation ({p.conversation.count})</p>
                      <a href={p.conversation.link} className="text-[11px] font-semibold inline-flex items-center gap-0.5" style={{ color: C.blue }}>Última conversación <ExternalLink size={10} /></a>
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                      {p.conversation.history.slice(-12).map((h, i) => (
                        <div key={i} className="text-[11.5px] leading-snug" style={{ color: h.from === "us" ? C.textMuted : C.textBody }}>
                          <span className="font-bold" style={{ color: h.from === "us" ? C.textDim : C.green }}>{h.from === "us" ? "Nosotros" : "Lead"}:</span> {h.text.slice(0, 220)}
                        </div>
                      ))}
                      {p.conversation.count === 0 && <p className="text-[11.5px]" style={{ color: C.textDim }}>Sin mensajes registrados.</p>}
                    </div>
                  </div>

                  {/* Editable GROWTH ENGINE drafts */}
                  <div className="space-y-3">
                    <Field k="profileSummary" label="Resumen del perfil" />
                    <Field k="companySummary" label="Resumen de la empresa" rows={3} />
                    <Field k="conversationSummary" label="Resumen de la conversación" rows={3} placeholder="Se genera con IA (n8n) en la Fase 3 — o escribilo acá." />
                    <Field k="highlights" label="Highlights del lead" rows={2} placeholder="Puntos clave del lead…" />
                    <Field k="sellerComments" label="Comentarios del vendedor" rows={3} />
                    <Field k="nextAction" label="Próxima acción" rows={1} />
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t flex items-center gap-2 shrink-0" style={{ borderColor: C.border, backgroundColor: C.bg }}>
              <button onClick={copyPayload} disabled={!p} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-2 rounded-lg disabled:opacity-50" style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, color: C.textBody }}>
                {copied ? <><Check size={13} style={{ color: C.green }} /> Copiado</> : <><Copy size={13} /> Copiar payload</>}
              </button>
              <div className="flex-1" />
              <button disabled title="El push real a Odoo se activa en la Fase 3"
                className="inline-flex items-center gap-1.5 text-[12.5px] font-bold px-4 py-2 rounded-lg opacity-60 cursor-not-allowed"
                style={{ background: `linear-gradient(135deg, ${gold}, ${C.goldDim})`, color: N.ink }}>
                <Send size={13} /> Enviar a Odoo
              </button>
            </div>
            <p className="px-5 pb-3 text-[10.5px] shrink-0" style={{ color: C.textDim, backgroundColor: C.bg }}>
              Fase 2: este panel arma y previsualiza todo lo que se va a mandar. El envío real a Odoo (campos custom) se activa en la Fase 3.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
