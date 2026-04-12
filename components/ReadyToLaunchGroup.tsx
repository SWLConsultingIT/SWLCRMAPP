"use client";

import { useState } from "react";
import Link from "next/link";
import { C } from "@/lib/design";
import { Target, Megaphone, Share2 } from "lucide-react";

const gold = "#C9A83A";

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

export default function ReadyToLaunchGroup({ profileId, profileName, profileDetail, leads }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleLead(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === leads.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(leads.map(l => l.id)));
    }
  }

  const allSelected = selected.size === leads.length && leads.length > 0;
  const someSelected = selected.size > 0;

  // Build URL with selected lead IDs
  const selectedIds = Array.from(selected);
  const launchUrl = selectedIds.length === 1
    ? `/campaigns/new/lead/${selectedIds[0]}`
    : profileId
      ? `/campaigns/new/${profileId}?leads=${selectedIds.join(",")}`
      : `/campaigns/new/lead/${selectedIds[0]}`;

  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.blue}` }}>
      {/* Group header */}
      <div className="px-6 py-4 flex items-center justify-between border-b"
        style={{ borderColor: C.border, background: `${C.blue}06` }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${C.blue}15` }}>
            <Target size={15} style={{ color: C.blue }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: C.textPrimary }}>
              {profileName ?? "Unassigned Leads"}
            </h3>
            {profileDetail && (
              <p className="text-xs" style={{ color: C.textMuted }}>{profileDetail}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ backgroundColor: C.blueLight, color: C.blue }}>
            {leads.length} leads
          </span>

          {/* Launch selected */}
          {someSelected && (
            <Link href={launchUrl}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition-all hover:shadow-md"
              style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#04070d" }}>
              <Megaphone size={13} /> Launch {selected.size === leads.length ? "All" : selected.size} Selected
            </Link>
          )}

          {/* Configure all (old behavior) */}
          {!someSelected && profileId && (
            <Link href={`/campaigns/new/${profileId}`}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-80"
              style={{ backgroundColor: gold, color: "#04070d" }}>
              <Megaphone size={13} /> Configure All
            </Link>
          )}
        </div>
      </div>

      {/* Leads table */}
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            <th className="text-left px-6 py-3 w-10">
              <input type="checkbox" checked={allSelected} onChange={toggleAll}
                className="rounded border-gray-300 cursor-pointer" style={{ accentColor: gold }} />
            </th>
            {["Lead", "Company", "Email / LinkedIn", "Score", "Status", ""].map((h, hi) => (
              <th key={hi} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider"
                style={{ color: C.textMuted }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const isSelected = selected.has(lead.id);
            return (
              <tr key={lead.id} className="table-row-hover cursor-pointer"
                style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: isSelected ? `${gold}08` : "transparent" }}
                onClick={() => toggleLead(lead.id)}>
                <td className="px-6 py-3">
                  <input type="checkbox" checked={isSelected} onChange={() => toggleLead(lead.id)}
                    onClick={e => e.stopPropagation()}
                    className="rounded border-gray-300 cursor-pointer" style={{ accentColor: gold }} />
                </td>
                <td className="px-4 py-3">
                  <Link href={`/leads/${lead.id}`} className="hover:underline" onClick={e => e.stopPropagation()}>
                    <p className="font-medium" style={{ color: C.textPrimary }}>
                      {lead.primary_first_name} {lead.primary_last_name}
                    </p>
                  </Link>
                </td>
                <td className="px-4 py-3 text-xs" style={{ color: C.textBody }}>{lead.company_name ?? "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-0.5">
                    {lead.primary_work_email && (
                      <span className="text-xs truncate max-w-48" style={{ color: C.textMuted }}>{lead.primary_work_email}</span>
                    )}
                    {lead.primary_linkedin_url && (
                      <span className="text-xs flex items-center gap-1" style={{ color: C.linkedin }}>
                        <Share2 size={10} /> LinkedIn
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {lead.lead_score ? (
                    <span className="text-xs font-bold px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: lead.lead_score >= 80 ? C.redLight : lead.lead_score >= 50 ? C.orangeLight : C.accentLight,
                        color: lead.lead_score >= 80 ? C.red : lead.lead_score >= 50 ? C.orange : C.accent,
                      }}>
                      {lead.lead_score}
                    </span>
                  ) : <span style={{ color: C.textDim }}>—</span>}
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md capitalize"
                    style={{ backgroundColor: "#F3F4F6", color: C.textBody }}>
                    {lead.status?.replace("_", " ") ?? "new"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/campaigns/new/lead/${lead.id}`}
                    onClick={e => e.stopPropagation()}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all hover:opacity-80"
                    style={{ backgroundColor: `${gold}18`, color: gold, border: `1px solid ${gold}30` }}>
                    <Megaphone size={11} /> Target Lead
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Selection bar */}
      {someSelected && (
        <div className="px-6 py-3 flex items-center gap-3 border-t" style={{ borderColor: C.border, backgroundColor: `${gold}06` }}>
          <span className="text-xs font-semibold" style={{ color: gold }}>
            {selected.size} of {leads.length} selected
          </span>
          <button onClick={() => setSelected(new Set())} className="text-xs font-medium underline" style={{ color: C.textMuted }}>
            Clear selection
          </button>
        </div>
      )}
    </div>
  );
}
