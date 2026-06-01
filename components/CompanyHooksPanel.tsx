"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2, RefreshCw, AlertCircle, Phone } from "lucide-react";
import { C } from "@/lib/design";

// Distilled-research panel for the company-detail page. Fran was spending
// 20–30 minutes reading the portfolio site looking for a call hook; this
// panel asks Claude Haiku to read the enrichment fields we already store
// (description, tech, news, mission, etc.) and return 3–5 ready-to-use
// hooks the seller can open a call with.
//
// Cache strategy: localStorage by leadId, no DB write. First visit shows
// a CTA ("Generate hooks"). Subsequent visits restore from cache until
// the seller hits Refresh. Cheap to regenerate — one Haiku call.

type Props = {
  leadId: string | null;
  companyName: string;
};

const CACHE_PREFIX = "company-hooks-v1:";

export default function CompanyHooksPanel({ leadId, companyName }: Props) {
  const [hooks, setHooks] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);

  // Restore from localStorage on first mount so the panel feels instant
  // when the seller comes back to the page. Cache key = leadId so two
  // sellers on the same lead share identical hooks.
  useEffect(() => {
    if (!leadId) return;
    try {
      const cached = localStorage.getItem(CACHE_PREFIX + leadId);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed?.hooks)) setHooks(parsed.hooks);
      }
    } catch { /* corrupted entry — ignore */ }
  }, [leadId]);

  async function generate() {
    if (!leadId) return;
    setLoading(true);
    setErr(null);
    setReason(null);
    try {
      const r = await fetch("/api/companies/hooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(body.error ?? `HTTP ${r.status}`); return; }
      const next = Array.isArray(body.hooks) ? body.hooks : [];
      setHooks(next);
      if (body.reason) setReason(body.reason);
      try { localStorage.setItem(CACHE_PREFIX + leadId, JSON.stringify({ hooks: next, generatedAt: Date.now() })); } catch {}
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }

  if (!leadId) return null;

  const hasHooks = hooks && hooks.length > 0;
  const isEmptyAfterGen = hooks !== null && hooks.length === 0;

  return (
    <div
      className="rounded-2xl border p-5 mb-5"
      style={{
        background: "linear-gradient(135deg, color-mix(in srgb, var(--brand, #c9a83a) 6%, var(--card)), var(--card))",
        borderColor: "color-mix(in srgb, var(--brand, #c9a83a) 35%, transparent)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles size={16} style={{ color: "var(--brand, #c9a83a)" }} />
          <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--brand, #c9a83a)" }}>
            Call Hooks
          </h3>
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
            style={{ backgroundColor: "color-mix(in srgb, var(--brand, #c9a83a) 12%, transparent)", color: "var(--brand, #c9a83a)" }}>
            AI · Haiku
          </span>
        </div>
        {hasHooks && (
          <button
            type="button"
            onClick={generate}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide hover:bg-black/[0.04] disabled:opacity-50"
            style={{
              color: "var(--brand, #c9a83a)",
              borderColor: "color-mix(in srgb, var(--brand, #c9a83a) 35%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--brand, #c9a83a) 10%, transparent)",
            }}
          >
            {loading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            Refresh
          </button>
        )}
      </div>

      {!hasHooks && !loading && !err && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm flex-1" style={{ color: C.textBody }}>
            Distill {companyName}&apos;s enrichment into 3–5 ready-to-read hooks for your next call.
          </p>
          <button
            type="button"
            onClick={generate}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-85"
            style={{ background: `linear-gradient(135deg, var(--brand, #c9a83a), color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#1A1A2E" }}
          >
            <Sparkles size={11} /> Generate hooks
          </button>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm py-2" style={{ color: C.textMuted }}>
          <Loader2 size={14} className="animate-spin" /> Reading {companyName}&apos;s research…
        </div>
      )}

      {hasHooks && (
        <ul className="space-y-2.5">
          {hooks!.map((h, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <Phone size={12} style={{ color: "var(--brand, #c9a83a)", marginTop: 4 }} className="shrink-0" />
              <p className="text-sm leading-relaxed" style={{ color: C.textBody }}>{h}</p>
            </li>
          ))}
        </ul>
      )}

      {isEmptyAfterGen && reason === "insufficient_enrichment" && (
        <div className="flex items-start gap-2 text-xs" style={{ color: C.textMuted }}>
          <AlertCircle size={12} className="shrink-0" style={{ marginTop: 2 }} />
          <p>Not enough enrichment data on this company yet — re-run the enrichment workflow to pull description, news and tech stack, then refresh.</p>
        </div>
      )}

      {err && (
        <div className="flex items-start gap-2 text-xs" style={{ color: "#DC2626" }}>
          <AlertCircle size={12} className="shrink-0" style={{ marginTop: 2 }} />
          <p>{err}</p>
        </div>
      )}
    </div>
  );
}
