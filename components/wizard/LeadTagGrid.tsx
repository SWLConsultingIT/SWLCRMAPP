"use client";

// Step 3 (tailored mode) — TAG GRID + "Validate full batch" button.
// Runs every lead through the per-lead tailor prompt, validates the
// substituted output via lib/message-validator, and renders each as a
// compact chip (initials + green/red status). Click a chip → inline
// expansion with hook, fit, full rendered messages, and per-step
// violations highlighted. Filter by search + "only issues".
//
// Persists outputs to campaign_requests.message_prompts.preview_outputs
// when campaignRequestId is provided so /api/campaigns/approve can
// reuse them without burning Haiku a second time.

import { useMemo, useState } from "react";
import { Sparkles, Loader2, AlertCircle, ChevronDown, ChevronUp, Search, Filter, Check, Phone, Mail, Share2, Megaphone } from "lucide-react";
import { C } from "@/lib/design";
import { VIOLATION_LABELS, type ViolationCode } from "@/lib/message-validator";

const gold = C.gold;

type ResultRow = {
  leadId: string;
  name: string;
  company: string | null;
  role: string | null;
  rendered: { connectionRequest?: string; steps: Array<{ channel: string; subject?: string | null; body: string }> };
  violations: ViolationCode[];
};

type BatchResponse = {
  ok: boolean;
  results?: ResultRow[];
  summary?: { total: number; ok: number; withIssues: number; byCode: Partial<Record<ViolationCode, number>> };
  error?: string;
  reason?: string;
};

type Props = {
  leadIds: string[];
  companyBioId: string;
  icpProfileId?: string | null;
  sellerId?: string | null;
  steps: Array<{ channel: string; body: string; subject?: string | null }>;
  connectionRequest?: string;
  campaignRequestId?: string | null;
  /** Wizard hook — invoked when a batch completes so the parent can
   *  persist `preview_outputs` to campaign_requests.message_prompts at
   *  submit time, letting the approve route reuse the work. */
  onResults?: (outputs: Record<string, { full_messages: Array<{ channel: string; subject?: string | null; body: string }>; connectionRequest: string | null; violations: string[] }>) => void;
};

const channelIcon: Record<string, typeof Phone> = {
  linkedin: Share2,
  email: Mail,
  call: Phone,
  whatsapp: Megaphone,
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function LeadTagGrid({ leadIds, companyBioId, icpProfileId, sellerId, steps, connectionRequest, campaignRequestId, onResults }: Props) {
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [summary, setSummary] = useState<BatchResponse["summary"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);

  async function runBatch() {
    if (leadIds.length === 0) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/campaigns/wizard-batch-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignRequestId: campaignRequestId ?? undefined, leadIds, companyBioId, icpProfileId: icpProfileId ?? undefined, sellerId: sellerId ?? undefined, steps, connectionRequest }),
      });
      const data = (await r.json().catch(() => ({}))) as BatchResponse;
      if (!r.ok) { setErr(data.error ?? `HTTP ${r.status}`); return; }
      if (data.reason) { setErr(data.reason); return; }
      const fresh = data.results ?? [];
      setResults(fresh);
      setSummary(data.summary ?? null);
      if (onResults && fresh.length > 0) {
        const out: Record<string, { full_messages: Array<{ channel: string; subject?: string | null; body: string }>; connectionRequest: string | null; violations: string[] }> = {};
        for (const r of fresh) {
          out[r.leadId] = {
            full_messages: r.rendered.steps,
            connectionRequest: r.rendered.connectionRequest ?? null,
            violations: r.violations,
          };
        }
        onResults(out);
      }
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!results) return [];
    const q = search.trim().toLowerCase();
    return results.filter(r => {
      if (onlyIssues && r.violations.length === 0) return false;
      if (q) {
        const hay = `${r.name} ${r.company ?? ""} ${r.role ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [results, search, onlyIssues]);

  return (
    <div className="rounded-2xl border" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="px-5 py-3 border-b" style={{ borderColor: C.border }}>
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles size={14} style={{ color: gold }} />
            <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>All {leadIds.length} leads</h3>
            {summary && (
              <span className="text-[11px]" style={{ color: C.textMuted }}>
                · <span style={{ color: C.green, fontWeight: 700 }}>{summary.ok} OK</span>
                {summary.withIssues > 0 && (
                  <> · <span style={{ color: "#DC2626", fontWeight: 700 }}>{summary.withIssues} with issues</span></>
                )}
              </span>
            )}
          </div>
          {!results ? (
            <button
              onClick={runBatch}
              disabled={loading || leadIds.length === 0}
              className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-md transition-opacity hover:opacity-85 disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`, color: "#1A1A2E" }}
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {loading ? `Running on ${leadIds.length} leads…` : `Validate full batch (${leadIds.length} leads)`}
            </button>
          ) : (
            <button
              onClick={runBatch}
              disabled={loading}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-opacity hover:opacity-85"
              style={{ color: gold, border: `1px solid color-mix(in srgb, ${gold} 35%, transparent)`, backgroundColor: `color-mix(in srgb, ${gold} 10%, transparent)` }}
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              Re-run batch
            </button>
          )}
        </div>

        {results && results.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-1 min-w-[180px] max-w-md rounded-md border px-2 py-1.5"
              style={{ backgroundColor: C.bg, borderColor: C.border }}>
              <Search size={12} style={{ color: C.textMuted }} />
              <input
                type="text"
                placeholder="Search by name, company, role…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="flex-1 bg-transparent outline-none text-xs"
                style={{ color: C.textPrimary }}
              />
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer text-xs select-none"
              style={{ color: onlyIssues ? "#DC2626" : C.textBody }}>
              <input type="checkbox" checked={onlyIssues} onChange={e => setOnlyIssues(e.target.checked)} className="cursor-pointer" />
              <Filter size={11} />
              Only issues
            </label>
          </div>
        )}
      </div>

      <div className="p-5">
        {!results && !loading && !err && (
          <div className="text-center py-10">
            <p className="text-sm mb-1.5" style={{ color: C.textBody }}>
              Click <strong>Validate full batch</strong> to generate the per-lead hook + fit for every lead.
            </p>
            <p className="text-[11px]" style={{ color: C.textMuted }}>
              ~30 seconds for {leadIds.length} leads · ~${(leadIds.length * 0.001).toFixed(2)}
            </p>
          </div>
        )}

        {loading && !results && (
          <div className="flex items-center justify-center py-12 gap-2" style={{ color: C.textMuted }}>
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Generating per-lead copy for {leadIds.length} leads…</span>
          </div>
        )}

        {err && (
          <div className="flex items-start gap-2 p-3 rounded-lg mb-3"
            style={{ backgroundColor: "color-mix(in srgb, #DC2626 8%, transparent)", border: "1px solid color-mix(in srgb, #DC2626 30%, transparent)" }}>
            <AlertCircle size={14} style={{ color: "#DC2626", marginTop: 2 }} />
            <p className="text-sm" style={{ color: "#DC2626" }}>{err}</p>
          </div>
        )}

        {results && results.length > 0 && (
          <>
            {summary && summary.withIssues > 0 && (
              <div className="mb-4 p-3 rounded-lg border"
                style={{ backgroundColor: "color-mix(in srgb, #DC2626 6%, transparent)", borderColor: "color-mix(in srgb, #DC2626 25%, transparent)" }}>
                <p className="text-[11px] font-semibold mb-1.5" style={{ color: "#DC2626" }}>
                  {summary.withIssues} leads have validation issues
                </p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {Object.entries(summary.byCode).map(([code, count]) => (
                    <span key={code} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "color-mix(in srgb, #DC2626 12%, transparent)", color: "#DC2626" }}>
                      {VIOLATION_LABELS[code as ViolationCode] ?? code} · {count}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {filtered.map(lead => {
                const isOpen = openLeadId === lead.leadId;
                const hasIssues = lead.violations.length > 0;
                return (
                  <button
                    key={lead.leadId}
                    onClick={() => setOpenLeadId(isOpen ? null : lead.leadId)}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] font-semibold transition-all hover:scale-105"
                    style={isOpen
                      ? { background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`, color: "#1A1A2E", borderColor: gold }
                      : hasIssues
                      ? { backgroundColor: "color-mix(in srgb, #DC2626 10%, transparent)", color: "#DC2626", borderColor: "color-mix(in srgb, #DC2626 30%, transparent)" }
                      : { backgroundColor: `color-mix(in srgb, ${C.green} 8%, transparent)`, color: C.green, borderColor: `color-mix(in srgb, ${C.green} 25%, transparent)` }}
                    title={`${lead.name} · ${lead.company ?? ""} · ${lead.role ?? ""}`}
                  >
                    {hasIssues ? <AlertCircle size={9} /> : <Check size={9} />}
                    {initialsOf(lead.name)}
                  </button>
                );
              })}
            </div>

            {openLeadId && (() => {
              const lead = results.find(r => r.leadId === openLeadId);
              if (!lead) return null;
              return (
                <div className="mt-4 rounded-xl border overflow-hidden"
                  style={{
                    background: `linear-gradient(135deg, ${C.bg} 0%, color-mix(in srgb, ${gold} 3%, ${C.bg}) 100%)`,
                    borderColor: `color-mix(in srgb, ${gold} 28%, ${C.border})`,
                    boxShadow: `0 4px 16px -8px color-mix(in srgb, ${gold} 22%, transparent)`,
                  }}>
                  <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: C.border }}>
                    <div>
                      <p className="text-sm font-bold" style={{ color: C.textPrimary }}>{lead.name}</p>
                      <p className="text-[11px]" style={{ color: C.textMuted }}>
                        {lead.role ? `${lead.role} · ` : ""}{lead.company ?? "—"}
                      </p>
                    </div>
                    <button onClick={() => setOpenLeadId(null)} className="p-1 rounded hover:bg-black/[0.05]" title="Close">
                      <ChevronUp size={14} style={{ color: C.textMuted }} />
                    </button>
                  </div>

                  {lead.violations.length > 0 && (
                    <div className="px-4 py-2 border-b flex items-center gap-1.5 flex-wrap"
                      style={{ borderColor: C.border, backgroundColor: "color-mix(in srgb, #DC2626 6%, transparent)" }}>
                      <AlertCircle size={11} style={{ color: "#DC2626" }} />
                      {lead.violations.map(code => (
                        <span key={code} className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "color-mix(in srgb, #DC2626 12%, transparent)", color: "#DC2626" }}>
                          {VIOLATION_LABELS[code]}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="px-4 py-2 border-b flex items-center gap-1.5" style={{ borderColor: C.border, backgroundColor: `color-mix(in srgb, ${gold} 4%, transparent)` }}>
                    <span className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`, color: "#1A1A2E" }}>
                      AI per-lead
                    </span>
                    <span className="text-[10.5px]" style={{ color: C.textMuted }}>
                      Every body below was generated specifically for this lead using their signals.
                    </span>
                  </div>

                  <div className="px-4 py-3 space-y-2.5">
                    {lead.rendered.connectionRequest && (
                      <div>
                        <p className="text-[9.5px] font-bold uppercase tracking-wider mb-0.5" style={{ color: C.textMuted }}>Connection Request</p>
                        <p className="text-[11.5px] leading-snug whitespace-pre-wrap p-2 rounded" style={{ color: C.textBody, backgroundColor: C.card, border: `1px solid ${C.border}` }}>
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
                            <p className="text-[11px] font-semibold mb-0.5" style={{ color: C.textBody }}>Subject: {step.subject}</p>
                          )}
                          <p className="text-[11.5px] leading-snug whitespace-pre-wrap p-2 rounded" style={{ color: C.textBody, backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                            {step.body}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {filtered.length === 0 && (
              <p className="text-center text-xs py-6" style={{ color: C.textMuted }}>
                No leads match your search.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
