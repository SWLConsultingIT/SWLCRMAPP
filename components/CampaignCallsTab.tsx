"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Phone, Loader2, ChevronRight, FileText } from "lucide-react";
import { C } from "@/lib/design";
import CallCard, { CallRecord } from "@/components/CallCard";

type LeadRef = {
  id: string;
  primary_first_name: string | null;
  primary_last_name: string | null;
  company_name: string | null;
  primary_title_role?: string | null;
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

  const leadsWithCalls = leads.filter(l => byLead.has(l.id));
  const selectedLead = selectedLeadId ? leads.find(l => l.id === selectedLeadId) : null;
  const selectedCalls = selectedLeadId ? byLead.get(selectedLeadId) ?? [] : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16" style={{ color: C.textMuted }}>
        <Loader2 size={16} className="animate-spin mr-2" />
        <span className="text-sm">Loading calls…</span>
      </div>
    );
  }

  if (leadsWithCalls.length === 0) {
    return (
      <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <Phone size={24} className="mx-auto mb-3" style={{ color: C.textDim }} />
        <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>No calls yet</p>
        <p className="text-xs mt-1" style={{ color: C.textMuted }}>
          Calls made to leads in this flow will appear here with transcripts and recordings.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[280px_1fr] gap-4">
      {/* ═══ Leads with calls list ═══ */}
      <div className="rounded-xl border overflow-hidden h-fit" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>
            Leads with calls
          </p>
          <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
            {leadsWithCalls.length} lead{leadsWithCalls.length === 1 ? "" : "s"} · {calls?.length ?? 0} total
          </p>
        </div>
        <div className="max-h-[600px] overflow-y-auto">
          {leadsWithCalls.map(l => {
            const leadCalls = byLead.get(l.id) ?? [];
            const latest = leadCalls[0];
            const hasTranscript = leadCalls.some(c => !!c.transcript);
            const isActive = selectedLeadId === l.id;
            return (
              <button
                key={l.id}
                onClick={() => setSelectedLeadId(l.id)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors"
                style={{
                  backgroundColor: isActive ? `${C.gold}12` : "transparent",
                  borderLeft: isActive ? `3px solid ${C.gold}` : "3px solid transparent",
                  borderBottom: `1px solid ${C.border}`,
                  paddingLeft: isActive ? "13px" : "16px",
                }}
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{ background: "linear-gradient(135deg, #F97316, #FB923C)", color: "#fff" }}>
                  {initials(l)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate" style={{ color: C.textPrimary }}>{fullName(l)}</p>
                  {l.company_name && (
                    <p className="text-[10px] truncate" style={{ color: C.textMuted }}>{l.company_name}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-medium" style={{ color: C.textDim }}>
                      {leadCalls.length} call{leadCalls.length === 1 ? "" : "s"}
                    </span>
                    {hasTranscript && (
                      <span className="flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: `${C.gold}15`, color: C.gold }}>
                        <FileText size={8} /> transcript
                      </span>
                    )}
                    {latest?.started_at && (
                      <span className="text-[10px]" style={{ color: C.textDim }}>
                        {new Date(latest.started_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronRight size={12} style={{ color: isActive ? C.gold : C.textDim }} />
              </button>
            );
          })}
        </div>
      </div>

      {/* ═══ Selected lead calls ═══ */}
      <div>
        {selectedLead ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl border p-4"
              style={{ backgroundColor: C.card, borderColor: C.border }}>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
                  Calls with
                </p>
                <p className="text-base font-bold" style={{ color: C.textPrimary }}>{fullName(selectedLead)}</p>
                {selectedLead.company_name && (
                  <p className="text-xs" style={{ color: C.textMuted }}>{selectedLead.company_name}</p>
                )}
              </div>
              <Link href={`/leads/${selectedLead.id}`}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-80"
                style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.bg }}>
                Open lead →
              </Link>
            </div>

            {selectedCalls.map(c => <CallCard key={c.id} call={c} />)}
          </div>
        ) : (
          <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <Phone size={24} className="mx-auto mb-3" style={{ color: C.textDim }} />
            <p className="text-sm" style={{ color: C.textMuted }}>Pick a lead to view their calls and transcripts.</p>
          </div>
        )}
      </div>
    </div>
  );
}
