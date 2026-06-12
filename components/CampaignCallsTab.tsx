"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Phone, Loader2, ChevronRight, FileText } from "lucide-react";
import { C } from "@/lib/design";
import CallCard, { CallRecord } from "@/components/CallCard";
import CallButton from "@/components/CallButton";
import PreCallBrief from "@/components/PreCallBrief";

type LeadRef = {
  id: string;
  primary_first_name: string | null;
  primary_last_name: string | null;
  company_name: string | null;
  primary_title_role?: string | null;
  primary_phone?: string | null;
};

type CallWithLead = CallRecord & { lead_id: string };

function fullName(l: LeadRef | undefined): string {
  if (!l) return "Unknown";
  return `${l.primary_first_name ?? ""} ${l.primary_last_name ?? ""}`.trim() || "Unknown";
}

function initials(l: LeadRef | undefined): string {
  if (!l) return "?";
  const f = (l.primary_first_name || "").trim()[0] || "";
  const ln = (l.primary_last_name || "").trim()[0] || "";
  return (f + ln).toUpperCase() || "?";
}

export default function CampaignCallsTab({ leads }: { leads: LeadRef[] }) {
  const [calls, setCalls] = useState<CallWithLead[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  // Paginate so a 200+ lead flow doesn't render one giant scroll (boss
  // 2026-06-11). Show 30, "load more" reveals the next batch.
  const [visibleCount, setVisibleCount] = useState(30);

  useEffect(() => {
    const ids = leads.map(l => l.id).filter(Boolean);
    if (ids.length === 0) {
      setCalls([]);
      setLoading(false);
      return;
    }
    fetch(`/api/calls?leadIds=${ids.join(",")}`)
      .then(r => r.json())
      .then(d => setCalls(d.calls ?? []))
      .catch(() => setCalls([]))
      .finally(() => setLoading(false));
  }, [leads]);

  // Group by lead_id
  const byLead = useMemo(() => {
    if (!calls) return new Map<string, CallWithLead[]>();
    const m = new Map<string, CallWithLead[]>();
    for (const c of calls) {
      if (!c.lead_id) continue;
      if (!m.has(c.lead_id)) m.set(c.lead_id, []);
      m.get(c.lead_id)!.push(c);
    }
    return m;
  }, [calls]);

  // Show every lead in the campaign — distinguish "has calls" vs "no calls".
  // The previous design only listed leads with existing calls, leaving no
  // entry point to dial leads who hadn't been called yet. Surface every lead
  // with a Call button so the call step of the campaign is actionable from
  // here without bouncing to the lead detail page.
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16" style={{ color: C.textMuted }}>
        <Loader2 size={16} className="animate-spin mr-2" />
        <span className="text-sm">Loading calls…</span>
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <Phone size={24} className="mx-auto mb-3" style={{ color: C.textDim }} />
        <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>No leads in this flow yet</p>
      </div>
    );
  }

  const totalCalls = calls?.length ?? 0;
  const leadsWithCallsCount = leads.filter(l => byLead.has(l.id)).length;

  // Full-width single list (boss 2026-06-09: "saca lo de la derecha y pone las
  // leads a lo largo"). Each lead spans the full width with its Call button;
  // clicking a row expands the pre-call brief + past calls inline (one profile
  // view per click — human pace, never batched).
  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="px-5 py-3 border-b" style={{ borderColor: C.border, backgroundColor: C.bg }}>
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>Leads in this flow</p>
        <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
          {leads.length} lead{leads.length === 1 ? "" : "s"} · {leadsWithCallsCount} called · {totalCalls} total calls
        </p>
      </div>
      <div>
        {leads.slice(0, visibleCount).map(l => {
          const leadCalls = byLead.get(l.id) ?? [];
          const latest = leadCalls[0];
          const hasCalls = leadCalls.length > 0;
          const hasTranscript = leadCalls.some(c => !!c.transcript);
          const expanded = selectedLeadId === l.id;
          return (
            <div key={l.id} className="border-b" style={{ borderColor: C.border, borderLeft: expanded ? `3px solid ${C.gold}` : "3px solid transparent" }}>
              {/* Full-width row: identity (left) · call controls (right) */}
              <div className="flex items-center gap-4 px-5 py-3">
                <button onClick={() => setSelectedLeadId(expanded ? null : l.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                    style={{ background: hasCalls ? "linear-gradient(135deg, #F97316, #FB923C)" : `color-mix(in srgb, ${C.textDim} 35%, transparent)`, color: "#fff" }}>
                    {initials(l)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: C.textPrimary }}>{fullName(l)}</p>
                    <p className="text-[11px] truncate" style={{ color: C.textMuted }}>
                      {[l.primary_title_role, l.company_name].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                </button>

                {/* Call activity summary */}
                <div className="hidden sm:flex items-center gap-2 shrink-0 text-[11px]" style={{ color: C.textDim }}>
                  {hasCalls ? (
                    <>
                      <span className="font-medium">{leadCalls.length} call{leadCalls.length === 1 ? "" : "s"}</span>
                      {hasTranscript && (
                        <span className="flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: `color-mix(in srgb, ${C.gold} 8%, transparent)`, color: C.gold }}>
                          <FileText size={8} /> transcript
                        </span>
                      )}
                      {latest?.started_at && <span>{new Date(latest.started_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span>}
                    </>
                  ) : (
                    <span>No calls yet</span>
                  )}
                </div>

                <CallButton phone={l.primary_phone ?? null} leadId={l.id} size="sm" variant="soft" />
                <button onClick={() => setSelectedLeadId(expanded ? null : l.id)} className="shrink-0 p-1" aria-label="Toggle brief">
                  <ChevronRight size={14} style={{ color: expanded ? C.gold : C.textDim, transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                </button>
              </div>

              {/* Expanded: pre-call brief + past calls (one lead at a time) */}
              {expanded && (
                <div className="px-5 pb-4 space-y-3" style={{ backgroundColor: C.bg }}>
                  <div className="pt-3 flex justify-end">
                    <Link href={`/leads/${l.id}`} className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-80"
                      style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.card }}>
                      Open lead →
                    </Link>
                  </div>
                  <PreCallBrief leadId={l.id} />
                  {leadCalls.length > 0
                    ? leadCalls.map(c => <CallCard key={c.id} call={c} />)
                    : <div className="rounded-xl border px-4 py-5 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
                        <p className="text-xs" style={{ color: C.textMuted }}>No calls logged yet — use the brief above to prep, then hit Call.</p>
                      </div>}
                </div>
              )}
            </div>
          );
        })}
        {leads.length > visibleCount && (
          <button onClick={() => setVisibleCount(c => c + 30)}
            className="w-full px-5 py-3 text-xs font-semibold transition-colors hover:bg-black/[0.02]"
            style={{ color: C.gold }}>
            Mostrar más ({leads.length - visibleCount} restantes)
          </button>
        )}
      </div>
    </div>
  );
}
