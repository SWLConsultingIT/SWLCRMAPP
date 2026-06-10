"use client";

// Step 3 (tailored mode) — auto-renders 3 sample leads from the batch
// with their tailored hook+fit substituted into every step body.
// Inline version of the TailorPreviewModal grid (same data source —
// /api/campaigns/preview-tailor) without the modal chrome.

import { useEffect, useState } from "react";
import { Sparkles, Loader2, Shuffle, AlertCircle, Phone, Mail, Share2, Megaphone } from "lucide-react";
import { C } from "@/lib/design";

const gold = C.gold;

type Lead = {
  leadId: string;
  name: string;
  company: string | null;
  role: string | null;
  slots: { hook: string; fit: string } | null;
  rendered: { connectionRequest?: string; steps: Array<{ channel: string; subject?: string | null; body: string }> };
};

type Props = {
  leadIds: string[];                                           // full pool — we pick 3 random ones each run
  companyBioId: string;
  icpProfileId?: string | null;
  sellerId?: string | null;
  steps: Array<{ channel: string; body: string; subject?: string | null }>;
  connectionRequest?: string;
  language?: string;
};

const channelIcon: Record<string, typeof Phone> = {
  linkedin: Share2,
  email: Mail,
  call: Phone,
  whatsapp: Megaphone,
};

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

export default function SampleLeadCards({ leadIds, companyBioId, icpProfileId, sellerId, steps, connectionRequest, language }: Props) {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (leadIds.length === 0) return;
    const sample = pickRandom(leadIds, 3);
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/campaigns/preview-tailor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: sample, companyBioId, icpProfileId: icpProfileId ?? undefined, sellerId: sellerId ?? undefined, steps, connectionRequest, language }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(data.error ?? `HTTP ${r.status}`); setLeads(null); return; }
      setLeads(data.leads ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
      setLeads(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (leadIds.length > 0) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-2xl border" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b" style={{ borderColor: C.border }}>
        <div className="flex items-center gap-2">
          <Sparkles size={14} style={{ color: gold }} />
          <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>Sample messages</h3>
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
            style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)`, color: gold }}>
            3 random leads
          </span>
        </div>
        <button
          onClick={run}
          disabled={loading || leadIds.length === 0}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-opacity hover:opacity-85 disabled:opacity-50"
          style={{ color: gold, border: `1px solid color-mix(in srgb, ${gold} 35%, transparent)`, backgroundColor: `color-mix(in srgb, ${gold} 10%, transparent)` }}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <Shuffle size={12} />}
          {loading ? "Generating…" : "Show different leads"}
        </button>
      </div>

      <div className="p-5">
        {loading && (
          <div className="flex items-center justify-center py-12 gap-2" style={{ color: C.textMuted }}>
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Generating tailored output for 3 leads…</span>
          </div>
        )}

        {err && !loading && (
          <div className="flex items-start gap-2 p-3 rounded-lg"
            style={{ backgroundColor: "color-mix(in srgb, #DC2626 8%, transparent)", border: "1px solid color-mix(in srgb, #DC2626 30%, transparent)" }}>
            <AlertCircle size={14} style={{ color: "#DC2626", marginTop: 2 }} />
            <p className="text-sm" style={{ color: "#DC2626" }}>{err}</p>
          </div>
        )}

        {!loading && !err && leads && leads.length === 0 && (
          <div className="text-center py-8">
            <p className="text-sm" style={{ color: C.textMuted }}>
              No <code>{`{{tailored:hook}}`}</code> or <code>{`{{tailored:fit}}`}</code> in your template — add either to a step body so per-lead copy has somewhere to land.
            </p>
          </div>
        )}

        {!loading && !err && leads && leads.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {leads.map(lead => (
              <div key={lead.leadId} className="rounded-xl border overflow-hidden flex flex-col"
                style={{ backgroundColor: C.bg, borderColor: C.border }}>
                <div className="px-3 py-2 border-b" style={{ borderColor: C.border }}>
                  <p className="text-[12px] font-bold truncate" style={{ color: C.textPrimary }}>{lead.name}</p>
                  <p className="text-[10px] truncate" style={{ color: C.textMuted }}>
                    {lead.role ? `${lead.role} · ` : ""}{lead.company ?? "—"}
                  </p>
                </div>

                {lead.slots ? (
                  <div className="px-3 py-2.5 border-b space-y-1.5" style={{ borderColor: C.border, backgroundColor: `color-mix(in srgb, ${gold} 4%, transparent)` }}>
                    <div>
                      <p className="text-[8.5px] font-bold uppercase tracking-wider" style={{ color: gold }}>Hook</p>
                      <p className="text-[11px] leading-snug" style={{ color: C.textBody }}>{lead.slots.hook}</p>
                    </div>
                    <div>
                      <p className="text-[8.5px] font-bold uppercase tracking-wider" style={{ color: gold }}>Fit</p>
                      <p className="text-[11px] leading-snug" style={{ color: C.textBody }}>{lead.slots.fit}</p>
                    </div>
                  </div>
                ) : (
                  <div className="px-3 py-2 border-b" style={{ borderColor: C.border, backgroundColor: "color-mix(in srgb, #DC2626 6%, transparent)" }}>
                    <p className="text-[10px]" style={{ color: "#DC2626" }}>
                      AI didn&apos;t return tailored slots for this lead — fix enrichment data and retry.
                    </p>
                  </div>
                )}

                <div className="flex-1 px-3 py-2.5 space-y-2.5 overflow-y-auto max-h-[360px]">
                  {lead.rendered.connectionRequest && (
                    <div>
                      <p className="text-[8.5px] font-bold uppercase tracking-wider mb-0.5" style={{ color: C.textMuted }}>Connection Request</p>
                      <p className="text-[11px] leading-snug whitespace-pre-wrap p-2 rounded" style={{ color: C.textBody, backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                        {lead.rendered.connectionRequest}
                      </p>
                    </div>
                  )}
                  {lead.rendered.steps.map((step, i) => {
                    const Icon = channelIcon[step.channel] ?? Megaphone;
                    return (
                      <div key={i}>
                        <p className="text-[8.5px] font-bold uppercase tracking-wider mb-0.5 flex items-center gap-1" style={{ color: C.textMuted }}>
                          <Icon size={9} />
                          Step {i + 1} · {step.channel}
                        </p>
                        {step.subject && (
                          <p className="text-[10.5px] font-semibold mb-0.5" style={{ color: C.textBody }}>
                            Subject: {step.subject}
                          </p>
                        )}
                        <p className="text-[11px] leading-snug whitespace-pre-wrap p-2 rounded" style={{ color: C.textBody, backgroundColor: C.card, border: `1px solid ${C.border}` }}>
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
    </div>
  );
}
