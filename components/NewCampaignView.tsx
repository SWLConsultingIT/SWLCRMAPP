"use client";

import { useState } from "react";
import Link from "next/link";
import { C } from "@/lib/design";
import {
  Users, Zap, Megaphone, ArrowRight, Target, CheckCircle,
  Share2, Mail, Check,
} from "lucide-react";

const gold = "var(--brand, #c9a83a)";

type Lead = {
  id: string;
  primary_first_name: string | null;
  primary_last_name: string | null;
  company_name: string | null;
  primary_work_email: string | null;
  primary_linkedin_url: string | null;
  lead_score: number | null;
  status: string | null;
};

type LeadGroup = {
  profileId: string | null;
  profileName: string | null;
  profileDetail: string | null;
  leads: Lead[];
};

function scoreBadge(score: number | null) {
  if (score && score >= 80) return { label: "HOT", color: C.hot, bg: C.hotBg };
  if (score && score >= 50) return { label: "WARM", color: C.warm, bg: C.warmBg };
  return { label: "NURTURE", color: C.nurture, bg: C.nurtureBg };
}

export default function NewCampaignView({ groups, totalUncampaigned }: { groups: LeadGroup[]; totalUncampaigned: number }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const PREVIEW_COUNT = 6;

  function toggleExpand(gi: number) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(gi) ? next.delete(gi) : next.add(gi);
      return next;
    });
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleGroup(leads: Lead[]) {
    setSelected(prev => {
      const next = new Set(prev);
      const ids = leads.map(l => l.id);
      const allIn = ids.every(id => next.has(id));
      if (allIn) ids.forEach(id => next.delete(id));
      else ids.forEach(id => next.add(id));
      return next;
    });
  }

  // Build launch URL — always use profile wizard with leads param for multi-select
  const selectedIds = Array.from(selected);
  const launchUrl = (() => {
    // Find profileId from the first group that has selected leads
    const matchingGroup = groups.find(g => g.profileId && g.leads.some(l => selected.has(l.id)));
    const pid = matchingGroup?.profileId;

    if (selectedIds.length === 1 && !pid) {
      // Single lead, no profile — use individual lead wizard
      return `/campaigns/new/lead/${selectedIds[0]}`;
    }
    if (pid) {
      // Route to profile wizard with all selected lead IDs
      return `/campaigns/new/${pid}?leads=${selectedIds.join(",")}`;
    }
    // Fallback: use individual lead route for first lead (shouldn't happen in practice)
    return `/campaigns/new/lead/${selectedIds[0]}`;
  })();

  return (
    <div>
      {/* ── Hero banner — 3-step guide ── */}
      <div className="rounded-xl border overflow-hidden mb-6" style={{ borderColor: C.border, background: `linear-gradient(135deg, #1A1A2E 0%, #2D2B55 100%)` }}>
        <div className="px-8 py-7">
          <h2 className="text-lg font-bold mb-1" style={{ color: "#fff" }}>Create a New Campaign</h2>
          <p className="text-sm mb-6" style={{ color: "rgba(255,255,255,0.6)" }}>Launch personalized outreach to your leads in 3 simple steps</p>

          <div className="flex items-center gap-4">
            {[
              { step: "1", label: "Select Leads", desc: "Pick leads from any ICP group below", icon: Users, color: "#0A66C2" },
              { step: "2", label: "Configure Flow", desc: "Choose channels, messages & timing", icon: Zap, color: gold },
              { step: "3", label: "Launch", desc: "Review and activate your campaign", icon: Megaphone, color: C.green },
            ].map((s, i, arr) => (
              <div key={s.step} className="flex items-center gap-4 flex-1">
                <div className="flex items-center gap-3 flex-1">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${s.color}20` }}>
                    <s.icon size={18} style={{ color: s.color }} />
                  </div>
                  <div>
                    <p className="text-xs font-bold" style={{ color: "#fff" }}>
                      <span className="text-[10px] font-bold mr-1.5 px-1.5 py-0.5 rounded" style={{ backgroundColor: `${s.color}30`, color: s.color }}>Step {s.step}</span>
                      {s.label}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.45)" }}>{s.desc}</p>
                  </div>
                </div>
                {i < arr.length - 1 && <ArrowRight size={16} style={{ color: "rgba(255,255,255,0.2)" }} className="shrink-0" />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Content ── */}
      {totalUncampaigned === 0 ? (
        <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <CheckCircle size={32} className="mx-auto mb-3" style={{ color: C.green }} />
          <p className="text-base font-semibold mb-1" style={{ color: C.textBody }}>All leads have active campaigns</p>
          <p className="text-sm mb-5" style={{ color: C.textMuted }}>Upload new leads via Lead Miner to start a new campaign</p>
          <Link href="/icp"
            className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ backgroundColor: `${gold}15`, color: gold, border: `1px solid ${gold}30` }}>
            <Target size={14} /> Go to Lead Miner
          </Link>
        </div>
      ) : (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>
            Select leads from any group to get started
          </p>

          <div className="space-y-5">
            {groups.map((group, gi) => {
              const groupIds = group.leads.map(l => l.id);
              const allGroupSelected = groupIds.length > 0 && groupIds.every(id => selected.has(id));
              const someGroupSelected = groupIds.some(id => selected.has(id));
              const hasLinkedin = group.leads.filter(l => l.primary_linkedin_url).length;
              const hasEmail = group.leads.filter(l => l.primary_work_email).length;

              return (
                <div key={group.profileId ?? gi} className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
                  {/* Group header */}
                  <div className="px-5 py-3.5 flex items-center gap-4 border-b" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: `linear-gradient(135deg, ${C.blue}20, ${C.blue}08)` }}>
                      <Target size={16} style={{ color: C.blue }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>{group.profileName ?? "Unassigned Leads"}</h3>
                      {group.profileDetail && <p className="text-xs truncate" style={{ color: C.textDim }}>{group.profileDetail}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {hasLinkedin > 0 && (
                        <span className="text-[10px] font-semibold flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ backgroundColor: "#0A66C212", color: "#0A66C2" }}>
                          <Share2 size={9} /> {hasLinkedin}
                        </span>
                      )}
                      {hasEmail > 0 && (
                        <span className="text-[10px] font-semibold flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ backgroundColor: "#7C3AED12", color: "#7C3AED" }}>
                          <Mail size={9} /> {hasEmail}
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full shrink-0" style={{ backgroundColor: `${C.blue}12`, color: C.blue }}>
                      {group.leads.length} leads
                    </span>
                    <button onClick={() => toggleGroup(group.leads)}
                      className="text-[10px] font-semibold px-3 py-1 rounded-md transition-colors"
                      style={{ backgroundColor: allGroupSelected ? `${gold}15` : "#F3F4F6", color: allGroupSelected ? gold : C.textMuted }}>
                      {allGroupSelected ? "Deselect all" : someGroupSelected ? `Select all ${group.leads.length}` : `Select all ${group.leads.length}`}
                    </button>
                  </div>

                  {/* Lead cards grid */}
                  {(() => {
                    const isExpanded = expanded.has(gi);
                    const visibleLeads = isExpanded ? group.leads : group.leads.slice(0, PREVIEW_COUNT);
                    const hiddenCount = group.leads.length - PREVIEW_COUNT;
                    const selectedInHidden = !isExpanded && hiddenCount > 0
                      ? group.leads.slice(PREVIEW_COUNT).filter(l => selected.has(l.id)).length : 0;

                    return (
                      <>
                        <div className="p-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {visibleLeads.map(lead => {
                            const isSelected = selected.has(lead.id);
                            const name = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown";
                            const badge = lead.lead_score ? scoreBadge(lead.lead_score) : null;

                            return (
                              <div key={lead.id} onClick={() => toggle(lead.id)}
                                className="rounded-lg border p-3 cursor-pointer transition-all hover:shadow-sm"
                                style={{
                                  borderColor: isSelected ? gold : C.border,
                                  backgroundColor: isSelected ? `${gold}06` : "transparent",
                                  boxShadow: isSelected ? `0 0 0 1px ${gold}` : "none",
                                }}>
                                <div className="flex items-start gap-3">
                                  <div className="w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5"
                                    style={{ borderColor: isSelected ? gold : C.border, backgroundColor: isSelected ? gold : "transparent" }}>
                                    {isSelected && <Check size={10} color="#fff" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 mb-0.5">
                                      <Link href={`/leads/${lead.id}`} onClick={e => e.stopPropagation()}
                                        className="text-xs font-semibold hover:underline truncate" style={{ color: C.textPrimary }}>{name}</Link>
                                      {badge && (
                                        <span className="text-[8px] font-bold px-1 py-0.5 rounded shrink-0" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span>
                                      )}
                                    </div>
                                    <p className="text-[10px] truncate" style={{ color: C.textMuted }}>{lead.company_name ?? "—"}</p>
                                    <div className="flex items-center gap-2 mt-1.5">
                                      {lead.primary_linkedin_url && <span className="text-[9px] flex items-center gap-0.5" style={{ color: "#0A66C2" }}><Share2 size={8} /> LinkedIn</span>}
                                      {lead.primary_work_email && <span className="text-[9px] flex items-center gap-0.5" style={{ color: "#7C3AED" }}><Mail size={8} /> Email</span>}
                                      {!lead.primary_linkedin_url && !lead.primary_work_email && <span className="text-[9px]" style={{ color: C.textDim }}>No channels</span>}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {hiddenCount > 0 && (
                          <div className="px-4 pb-4">
                            <button onClick={() => toggleExpand(gi)}
                              className="w-full rounded-lg border border-dashed py-2.5 text-xs font-semibold transition-colors hover:bg-gray-50"
                              style={{ borderColor: C.border, color: isExpanded ? C.textMuted : gold }}>
                              {isExpanded
                                ? "Show less"
                                : `Show ${hiddenCount} more leads${selectedInHidden > 0 ? ` (${selectedInHidden} selected)` : ""}`}
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Floating action bar ── */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 rounded-2xl border px-6 py-3.5 shadow-xl"
          style={{ backgroundColor: "#1A1A2E", borderColor: `${gold}40` }}>
          <span className="text-sm font-bold" style={{ color: "#fff" }}>
            {selected.size} {selected.size === 1 ? "lead" : "leads"} selected
          </span>
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            from {groups.filter(g => g.leads.some(l => selected.has(l.id))).length} {groups.filter(g => g.leads.some(l => selected.has(l.id))).length === 1 ? "group" : "groups"}
          </span>
          <Link href={launchUrl}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all hover:shadow-lg"
            style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#1A1A2E" }}>
            <Megaphone size={15} /> Create Outreach Flow
          </Link>
          <button onClick={() => setSelected(new Set())} className="text-xs font-medium underline" style={{ color: "rgba(255,255,255,0.5)" }}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
