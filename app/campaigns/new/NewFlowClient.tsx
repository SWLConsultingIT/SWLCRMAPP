"use client";

import { useState } from "react";
import Link from "next/link";
import { C } from "@/lib/design";
import {
  Target, User, Megaphone, ChevronDown, ChevronRight, ArrowRight,
} from "lucide-react";

const gold = "#C9A83A";

type Profile = {
  id: string;
  profile_name: string;
  target_industries: string[];
  target_roles: string[];
  geography: string[];
  leadCount: number;
  availableCount: number;
};

type Lead = {
  id: string;
  primary_first_name: string | null;
  primary_last_name: string | null;
  primary_title_role: string | null;
  company_name: string | null;
  icp_profile_id: string | null;
};

export default function NewFlowClient({ profiles, leads }: { profiles: Profile[]; leads: Lead[] }) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null);
  const [customSelected, setCustomSelected] = useState<Set<string>>(new Set());

  const toggle = (key: string) => setExpandedSection(expandedSection === key ? null : key);

  // Group leads by ICP for the "Target a Lead" section
  const profileMap: Record<string, string> = {};
  profiles.forEach(p => { profileMap[p.id] = p.profile_name; });

  return (
    <div className="space-y-4">

      {/* ── Option 1: From ICP Profile ── */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <button onClick={() => toggle("icp")}
          className="w-full px-6 py-5 flex items-center gap-4 text-left transition-colors hover:bg-gray-50">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${gold}15`, border: `1px solid ${gold}25` }}>
            <Target size={20} style={{ color: gold }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold" style={{ color: C.textPrimary }}>From ICP Profile</h2>
            <p className="text-xs" style={{ color: C.textMuted }}>Target leads matching a mining ticket</p>
          </div>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${gold}15`, color: gold }}>
            {profiles.length} tickets
          </span>
          <ChevronDown size={16} style={{ color: C.textDim, transform: expandedSection === "icp" ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
        </button>

        {expandedSection === "icp" && (
          <div className="border-t" style={{ borderColor: C.border }}>
            {profiles.length === 0 ? (
              <div className="px-6 py-6 text-center">
                <p className="text-sm" style={{ color: C.textDim }}>No approved profiles yet. Create one in Lead Miner first.</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: C.border }}>
                {profiles.map(p => {
                  const isOpen = expandedProfile === p.id;
                  const profileLeads = leads.filter(l => l.icp_profile_id === p.id);
                  return (
                    <div key={p.id}>
                      <div className="flex items-center gap-3 px-6 py-3 hover:bg-gray-50">
                        <button onClick={() => setExpandedProfile(isOpen ? null : p.id)} className="shrink-0" style={{ color: C.textDim }}>
                          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{p.profile_name}</p>
                          <p className="text-xs" style={{ color: C.textMuted }}>
                            {[...(p.target_industries ?? []), ...(p.geography ?? [])].slice(0, 3).join(", ")}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs" style={{ color: C.textMuted }}>{p.leadCount} leads · {p.availableCount} available</span>
                          <Link href={`/campaigns/new/${p.id}`}
                            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-all hover:shadow-sm"
                            style={{ backgroundColor: gold, color: "#04070d" }}>
                            Configure <ArrowRight size={12} />
                          </Link>
                        </div>
                      </div>
                      {isOpen && profileLeads.length > 0 && (
                        <div className="pl-16 pr-6 pb-3">
                          <div className="rounded-lg border divide-y" style={{ borderColor: C.border }}>
                            {profileLeads.slice(0, 10).map(l => (
                              <div key={l.id} className="flex items-center gap-3 px-4 py-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium" style={{ color: C.textBody }}>
                                    {l.primary_first_name} {l.primary_last_name}
                                  </p>
                                  <p className="text-[10px]" style={{ color: C.textDim }}>
                                    {l.primary_title_role ?? ""}{l.company_name ? ` · ${l.company_name}` : ""}
                                  </p>
                                </div>
                              </div>
                            ))}
                            {profileLeads.length > 10 && (
                              <div className="px-4 py-2 text-center">
                                <p className="text-[10px]" style={{ color: C.textDim }}>+{profileLeads.length - 10} more</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Option 2: Custom Campaign ── */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <button onClick={() => toggle("custom")}
          className="w-full px-6 py-5 flex items-center gap-4 text-left transition-colors hover:bg-gray-50">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${C.blue}12`, border: `1px solid ${C.blue}20` }}>
            <User size={20} style={{ color: C.blue }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold" style={{ color: C.textPrimary }}>Custom Campaign</h2>
            <p className="text-xs" style={{ color: C.textMuted }}>Pick one or more leads manually — no ICP restriction</p>
          </div>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: C.blueLight, color: C.blue }}>
            {leads.length} available
          </span>
          <ChevronDown size={16} style={{ color: C.textDim, transform: expandedSection === "custom" ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
        </button>

        {expandedSection === "custom" && (
          <div className="border-t" style={{ borderColor: C.border }}>
            {leads.length === 0 ? (
              <div className="px-6 py-6 text-center">
                <p className="text-sm" style={{ color: C.textDim }}>All leads already have active campaigns.</p>
              </div>
            ) : (
              <>
                {customSelected.size > 0 && (
                  <div className="px-6 py-3 flex items-center gap-3 border-b" style={{ borderColor: C.border, backgroundColor: `${gold}06` }}>
                    <span className="text-xs font-medium" style={{ color: gold }}>{customSelected.size} selected</span>
                    {customSelected.size === 1 ? (
                      <Link href={`/campaigns/new/lead/${Array.from(customSelected)[0]}`}
                        className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold hover:shadow-sm"
                        style={{ backgroundColor: gold, color: "#04070d" }}>
                        Configure <ArrowRight size={12} />
                      </Link>
                    ) : (
                      <Link href={`/campaigns/new/lead/${Array.from(customSelected)[0]}?leads=${Array.from(customSelected).join(",")}`}
                        className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold hover:shadow-sm"
                        style={{ backgroundColor: gold, color: "#04070d" }}>
                        Configure {customSelected.size} Leads <ArrowRight size={12} />
                      </Link>
                    )}
                    <button onClick={() => setCustomSelected(new Set())} className="text-xs underline" style={{ color: C.textMuted }}>Clear</button>
                    <div className="flex-1" />
                    <button onClick={() => customSelected.size === leads.length ? setCustomSelected(new Set()) : setCustomSelected(new Set(leads.map(l => l.id)))}
                      className="text-xs font-medium" style={{ color: C.textMuted }}>
                      {customSelected.size === leads.length ? "Deselect All" : "Select All"}
                    </button>
                  </div>
                )}
                {customSelected.size === 0 && (
                  <div className="px-6 py-2 flex items-center justify-end border-b" style={{ borderColor: C.border }}>
                    <button onClick={() => setCustomSelected(new Set(leads.map(l => l.id)))}
                      className="text-xs font-medium" style={{ color: C.textMuted }}>Select All</button>
                  </div>
                )}
                <div className="divide-y" style={{ borderColor: C.border }}>
                  {leads.slice(0, 30).map(l => {
                    const checked = customSelected.has(l.id);
                    return (
                      <div key={l.id} className="flex items-center gap-3 px-6 py-3 hover:bg-gray-50 transition-colors cursor-pointer"
                        style={{ backgroundColor: checked ? `${gold}06` : "transparent" }}
                        onClick={() => { const n = new Set(customSelected); checked ? n.delete(l.id) : n.add(l.id); setCustomSelected(n); }}>
                        <input type="checkbox" checked={checked} readOnly style={{ accentColor: gold }} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium" style={{ color: C.textPrimary }}>
                            {l.primary_first_name} {l.primary_last_name}
                          </p>
                          <p className="text-xs" style={{ color: C.textMuted }}>
                            {l.primary_title_role ?? ""}{l.company_name ? ` at ${l.company_name}` : ""}
                            {l.icp_profile_id && profileMap[l.icp_profile_id] ? (
                              <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: `${gold}12`, color: gold }}>
                                from: {profileMap[l.icp_profile_id]}
                              </span>
                            ) : null}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  {leads.length > 30 && (
                    <div className="px-6 py-3 text-center">
                      <p className="text-xs" style={{ color: C.textDim }}>+{leads.length - 30} more leads available</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
