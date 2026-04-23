"use client";

import { useState } from "react";
import Link from "next/link";
import { C } from "@/lib/design";
import { Target, Megaphone, Share2, Mail, Check } from "lucide-react";

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

type Props = {
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

export default function ReadyToLaunchGroup({ profileId, profileName, profileDetail, leads }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll() {
    selected.size === leads.length ? setSelected(new Set()) : setSelected(new Set(leads.map(l => l.id)));
  }

  const allSelected = selected.size === leads.length && leads.length > 0;
  const someSelected = selected.size > 0;

  const selectedIds = Array.from(selected);
  const launchUrl = selectedIds.length === 1
    ? `/campaigns/new/lead/${selectedIds[0]}`
    : profileId
      ? `/campaigns/new/${profileId}?leads=${selectedIds.join(",")}`
      : `/campaigns/new/lead/${selectedIds[0]}`;

  const hasLinkedin = leads.filter(l => l.primary_linkedin_url).length;
  const hasEmail = leads.filter(l => l.primary_work_email).length;

  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      {/* ── Header ── */}
      <div className="px-5 py-4 flex items-center gap-4 border-b" style={{ borderColor: C.border, backgroundColor: C.bg }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: `linear-gradient(135deg, ${C.blue}20, ${C.blue}08)` }}>
          <Target size={18} style={{ color: C.blue }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>{profileName ?? "Unassigned Leads"}</h3>
          {profileDetail && <p className="text-xs truncate" style={{ color: C.textDim }}>{profileDetail}</p>}
        </div>

        {/* Channel availability pills */}
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
          {leads.length} leads
        </span>
      </div>

      {/* ── Action bar ── */}
      <div className="px-5 py-3 flex items-center gap-3 border-b" style={{ borderColor: C.border, backgroundColor: `color-mix(in srgb, ${gold} 2%, transparent)` }}>
        <button onClick={selectAll} className="flex items-center gap-2 text-xs font-medium" style={{ color: C.textMuted }}>
          <div className="w-4 h-4 rounded border flex items-center justify-center"
            style={{ borderColor: allSelected ? gold : C.border, backgroundColor: allSelected ? gold : "transparent" }}>
            {allSelected && <Check size={10} color="#fff" />}
          </div>
          {allSelected ? "Deselect all" : "Select all"}
        </button>

        <div className="flex-1" />

        <Link href={someSelected ? launchUrl : (profileId ? `/campaigns/new/${profileId}` : "#")}
          className="flex items-center gap-2 rounded-lg px-5 py-2 text-xs font-bold transition-all hover:shadow-md"
          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#1A1A2E" }}>
          <Megaphone size={13} /> Create Outreach Flow{someSelected ? ` with ${selected.size} ${selected.size === 1 ? "Lead" : "Leads"}` : ` with All ${leads.length} Leads`}
        </Link>
      </div>

      {/* ── Lead cards grid ── */}
      <div className="p-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {leads.map(lead => {
          const isSelected = selected.has(lead.id);
          const name = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown";
          const badge = lead.lead_score ? scoreBadge(lead.lead_score) : null;

          return (
            <div
              key={lead.id}
              onClick={() => toggle(lead.id)}
              className="rounded-lg border p-3 cursor-pointer transition-all hover:shadow-sm"
              style={{
                borderColor: isSelected ? gold : C.border,
                backgroundColor: isSelected ? `color-mix(in srgb, ${gold} 2%, transparent)` : "transparent",
                boxShadow: isSelected ? `0 0 0 1px ${gold}` : "none",
              }}
            >
              <div className="flex items-start gap-3">
                {/* Checkbox */}
                <div className="w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5"
                  style={{ borderColor: isSelected ? gold : C.border, backgroundColor: isSelected ? gold : "transparent" }}>
                  {isSelected && <Check size={10} color="#fff" />}
                </div>

                {/* Lead info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <Link href={`/leads/${lead.id}`} onClick={e => e.stopPropagation()}
                      className="text-xs font-semibold hover:underline truncate" style={{ color: C.textPrimary }}>{name}</Link>
                    {badge && (
                      <span className="text-[8px] font-bold px-1 py-0.5 rounded shrink-0" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span>
                    )}
                  </div>
                  <p className="text-[10px] truncate" style={{ color: C.textMuted }}>
                    {lead.company_name ?? "—"}
                  </p>

                  {/* Channels available */}
                  <div className="flex items-center gap-2 mt-1.5">
                    {lead.primary_linkedin_url && (
                      <span className="text-[9px] flex items-center gap-0.5" style={{ color: "#0A66C2" }}><Share2 size={8} /> LinkedIn</span>
                    )}
                    {lead.primary_work_email && (
                      <span className="text-[9px] flex items-center gap-0.5" style={{ color: "#7C3AED" }}><Mail size={8} /> Email</span>
                    )}
                    {!lead.primary_linkedin_url && !lead.primary_work_email && (
                      <span className="text-[9px]" style={{ color: C.textDim }}>No channels</span>
                    )}
                  </div>
                </div>

              </div>
            </div>
          );
        })}
      </div>

      {/* ── Selection footer ── */}
      {someSelected && (
        <div className="px-5 py-3 flex items-center gap-3 border-t" style={{ borderColor: C.border, backgroundColor: `color-mix(in srgb, ${gold} 2%, transparent)` }}>
          <span className="text-xs font-semibold" style={{ color: gold }}>
            {selected.size} of {leads.length} selected
          </span>
          <button onClick={() => setSelected(new Set())} className="text-xs font-medium underline" style={{ color: C.textMuted }}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
