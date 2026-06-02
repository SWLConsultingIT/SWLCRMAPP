"use client";

import { useState } from "react";
import { Sparkles, Loader2, X, AlertCircle, Phone, Mail, Share2, Megaphone } from "lucide-react";
import { C } from "@/lib/design";

// Modal that lets the seller see how the tailored slots render for 3
// sample leads before approving the campaign. Companion to the /api/
// campaigns/preview-tailor endpoint. Triggered from the wizard or the
// /campaigns/new lead-picker page.

type Lead = {
  leadId: string;
  name: string;
  company: string | null;
  role: string | null;
  slots: { hook: string; fit: string } | null;
  rendered: {
    connectionRequest?: string;
    steps: Array<{ channel: string; subject?: string | null; body: string }>;
  };
};

type Props = {
  open: boolean;
  onClose: () => void;
  leadIds: string[];
  companyBioId: string;
  icpProfileId?: string | null;
  sellerId?: string | null;
  steps: Array<{ channel: string; body: string; subject?: string | null }>;
  connectionRequest?: string;
};

const gold = "var(--brand, #c9a83a)";

const channelIcon: Record<string, typeof Phone> = {
  linkedin: Share2,
  email: Mail,
  call: Phone,
  whatsapp: Megaphone,
};

export default function TailorPreviewModal({
  open, onClose, leadIds, companyBioId, icpProfileId, sellerId, steps, connectionRequest,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function runPreview() {
    setLoading(true);
    setErr(null);
    setLeads(null);
    try {
      const r = await fetch("/api/campaigns/preview-tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadIds: leadIds.slice(0, 3),
          companyBioId,
          icpProfileId: icpProfileId ?? undefined,
          sellerId: sellerId ?? undefined,
          steps,
          connectionRequest,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(body.error ?? `HTTP ${r.status}`); return; }
      setLeads(body.leads ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl max-h-[90vh] rounded-2xl border overflow-hidden flex flex-col"
        style={{ backgroundColor: C.card, borderColor: C.border }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-2">
            <Sparkles size={16} style={{ color: gold }} />
            <h2 className="text-base font-bold" style={{ color: C.textPrimary }}>Preview tailored output</h2>
            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ml-1"
              style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)`, color: gold }}>
              AI · Haiku · 3 sample leads
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-black/[0.05]">
            <X size={16} style={{ color: C.textMuted }} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {!leads && !loading && !err && (
            <div className="text-center py-12">
              <p className="text-sm mb-4" style={{ color: C.textBody }}>
                Renders the {`{{tailored:hook}}`} + {`{{tailored:fit}}`} slots for 3 random leads from your selection so you can sanity-check the AI output before approving the whole campaign.
              </p>
              <button
                onClick={runPreview}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-85"
                style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`, color: "#1A1A2E" }}
              >
                <Sparkles size={14} /> Generate preview
              </button>
              <p className="text-[11px] mt-3" style={{ color: C.textMuted }}>
                ~5-10 seconds. Doesn&apos;t write anything to the campaign.
              </p>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-16 gap-2" style={{ color: C.textMuted }}>
              <Loader2 size={18} className="animate-spin" />
              <span className="text-sm">Generating tailored output for 3 leads…</span>
            </div>
          )}

          {err && (
            <div className="flex items-start gap-2 p-4 rounded-lg"
              style={{ backgroundColor: "color-mix(in srgb, #DC2626 8%, transparent)", border: "1px solid color-mix(in srgb, #DC2626 30%, transparent)" }}>
              <AlertCircle size={14} style={{ color: "#DC2626", marginTop: 2 }} />
              <p className="text-sm" style={{ color: "#DC2626" }}>{err}</p>
            </div>
          )}

          {leads && leads.length === 0 && (
            <div className="text-center py-12">
              <p className="text-sm" style={{ color: C.textMuted }}>
                No tailored slots in your template — there&apos;s nothing for the AI to fill. Add {`{{tailored:hook}}`} or {`{{tailored:fit}}`} to a step body to make the preview useful.
              </p>
            </div>
          )}

          {leads && leads.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {leads.map((lead) => (
                <div key={lead.leadId} className="rounded-xl border overflow-hidden flex flex-col"
                  style={{ backgroundColor: C.bg, borderColor: C.border }}>
                  {/* Lead header */}
                  <div className="px-4 py-3 border-b" style={{ borderColor: C.border }}>
                    <p className="text-sm font-bold truncate" style={{ color: C.textPrimary }}>{lead.name}</p>
                    <p className="text-[11px] truncate" style={{ color: C.textMuted }}>
                      {lead.role ? `${lead.role} · ` : ""}{lead.company ?? "—"}
                    </p>
                  </div>

                  {/* AI-generated slots (raw) */}
                  {lead.slots ? (
                    <div className="px-4 py-3 border-b space-y-2" style={{ borderColor: C.border, backgroundColor: `color-mix(in srgb, ${gold} 4%, transparent)` }}>
                      <div>
                        <p className="text-[9.5px] font-bold uppercase tracking-wider mb-0.5" style={{ color: gold }}>Hook</p>
                        <p className="text-[12px] leading-relaxed" style={{ color: C.textBody }}>{lead.slots.hook}</p>
                      </div>
                      <div>
                        <p className="text-[9.5px] font-bold uppercase tracking-wider mb-0.5" style={{ color: gold }}>Fit</p>
                        <p className="text-[12px] leading-relaxed" style={{ color: C.textBody }}>{lead.slots.fit}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="px-4 py-3 border-b" style={{ borderColor: C.border, backgroundColor: "color-mix(in srgb, #DC2626 6%, transparent)" }}>
                      <p className="text-[11px]" style={{ color: "#DC2626" }}>
                        AI didn&apos;t return tailored slots for this lead. The rendered output below will keep the raw template tokens — fix the lead&apos;s enrichment data and retry.
                      </p>
                    </div>
                  )}

                  {/* Rendered output (steps + CR) */}
                  <div className="flex-1 px-4 py-3 space-y-3 overflow-y-auto max-h-[420px]">
                    {lead.rendered.connectionRequest && (
                      <div>
                        <p className="text-[9.5px] font-bold uppercase tracking-wider mb-0.5" style={{ color: C.textMuted }}>Connection Request</p>
                        <p className="text-[11.5px] leading-relaxed whitespace-pre-wrap p-2 rounded" style={{ color: C.textBody, backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                          {lead.rendered.connectionRequest}
                        </p>
                      </div>
                    )}
                    {lead.rendered.steps.map((step, i) => {
                      const Icon = channelIcon[step.channel] ?? Megaphone;
                      return (
                        <div key={i}>
                          <p className="text-[9.5px] font-bold uppercase tracking-wider mb-0.5 flex items-center gap-1" style={{ color: C.textMuted }}>
                            <Icon size={10} />
                            Step {i + 1} · {step.channel}
                          </p>
                          {step.subject && (
                            <p className="text-[11px] font-semibold mb-0.5" style={{ color: C.textBody }}>
                              Subject: {step.subject}
                            </p>
                          )}
                          <p className="text-[11.5px] leading-relaxed whitespace-pre-wrap p-2 rounded" style={{ color: C.textBody, backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                            {step.body}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t flex items-center justify-between" style={{ borderColor: C.border }}>
          <p className="text-[11px]" style={{ color: C.textMuted }}>
            {leads && leads.length > 0
              ? "Like what you see? Approve the campaign — the same AI runs across every lead."
              : "Preview doesn't write anything. Run it before approving to validate quality."}
          </p>
          <div className="flex items-center gap-2">
            {leads && leads.length > 0 && (
              <button
                onClick={runPreview}
                disabled={loading}
                className="text-xs font-semibold px-3 py-1.5 rounded-md transition-opacity hover:opacity-85 disabled:opacity-50"
                style={{ color: gold, border: `1px solid color-mix(in srgb, ${gold} 35%, transparent)`, backgroundColor: `color-mix(in srgb, ${gold} 10%, transparent)` }}>
                {loading ? <Loader2 size={12} className="animate-spin inline" /> : "Re-run"}
              </button>
            )}
            <button
              onClick={onClose}
              className="text-xs font-semibold px-3 py-1.5 rounded-md transition-opacity hover:opacity-85"
              style={{ backgroundColor: C.surface, color: C.textBody, border: `1px solid ${C.border}` }}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
