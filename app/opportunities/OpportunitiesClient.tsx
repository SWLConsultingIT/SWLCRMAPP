"use client";

import { useState } from "react";
import Link from "next/link";
import { C } from "@/lib/design";
import {
  Trophy, ChevronRight, Share2, Mail, Phone,
  ExternalLink, Search, X,
} from "lucide-react";

const gold = "#C9A83A";

type CampaignGroupData = {
  name: string;
  firstId: string;
  channels: string[];
  converted: number;
  totalLeads: number;
  transferred: number;
  avgStepsToConversion: number;
};

type Props = { groups: CampaignGroupData[] };

const channelMeta: Record<string, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

// ─── Campaign Card (links to /opportunities/[id]) ─────────────────────────────
function OpportunityCard({ group }: { group: CampaignGroupData }) {
  const rate      = group.totalLeads > 0 ? Math.round((group.converted / group.totalLeads) * 100) : 0;
  const pending   = group.converted - group.transferred;

  return (
    <Link
      href={`/opportunities/${group.firstId}`}
      className="rounded-xl border overflow-hidden flex flex-col transition-all hover:shadow-md group"
      style={{ backgroundColor: C.card, borderColor: C.border }}
    >
      <div className="px-4 pt-4 pb-3 flex-1">
        <div className="flex items-start gap-3">
          {/* Conversion ring */}
          <div className="shrink-0 relative" style={{ width: 44, height: 44 }}>
            <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#E5E7EB" strokeWidth="3" />
              <circle cx="18" cy="18" r="15.5" fill="none"
                stroke={rate >= 20 ? C.green : rate > 0 ? "#D97706" : C.textDim}
                strokeWidth="3" strokeLinecap="round"
                strokeDasharray={`${rate * 0.975} 100`} />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold"
              style={{ color: rate >= 20 ? C.green : rate > 0 ? "#D97706" : C.textDim }}>
              {rate}%
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold mb-0.5 group-hover:underline" style={{ color: C.textPrimary }}>{group.name}</h3>
            <div className="flex items-center gap-2 text-xs" style={{ color: C.textMuted }}>
              <span><span className="font-bold" style={{ color: C.green }}>{group.converted}</span>/{group.totalLeads} converted</span>
              {group.avgStepsToConversion > 0 && <span>· {group.avgStepsToConversion} steps avg</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t flex items-center justify-between"
        style={{ borderColor: C.border, backgroundColor: C.bg }}>
        <div className="flex items-center gap-3 text-[10px]">
          {group.channels.map(ch => {
            const meta = channelMeta[ch] ?? channelMeta.email;
            const Icon = meta.icon;
            return <Icon key={ch} size={11} style={{ color: meta.color }} />;
          })}
          {group.transferred > 0 && (
            <span className="flex items-center gap-1" style={{ color: C.green }}>
              <ExternalLink size={9} /> {group.transferred} in CRM
            </span>
          )}
          {pending > 0 && (
            <span style={{ color: "#D97706" }}>{pending} pending</span>
          )}
        </div>
        <ChevronRight size={13} style={{ color: C.textDim }} className="transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function OpportunitiesClient({ groups }: Props) {
  const [search, setSearch] = useState("");

  const totalOpps        = groups.reduce((s, g) => s + g.converted, 0);
  const totalTransferred = groups.reduce((s, g) => s + g.transferred, 0);

  const filtered = !search
    ? groups
    : groups.filter(g => g.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="p-6 w-full">
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>Operations</p>
          <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>Opportunities</h1>
          <p className="text-sm mt-1" style={{ color: C.textMuted }}>
            <span className="font-bold" style={{ color: C.green }}>{totalOpps}</span> leads converted
            {totalTransferred > 0 && (
              <> · <span className="font-bold" style={{ color: C.green }}>{totalTransferred}</span> transferred to CRM</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
          style={{ borderColor: C.border, backgroundColor: C.card }}>
          <Search size={14} style={{ color: C.textDim }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search..." className="bg-transparent text-sm outline-none w-40"
            style={{ color: C.textPrimary }} />
          {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
        </div>
      </div>

      <div className="h-px mb-6" style={{ background: `linear-gradient(90deg, ${gold} 0%, rgba(201,168,58,0.15) 40%, transparent 100%)` }} />

      {filtered.length === 0 ? (
        <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <Trophy size={32} className="mx-auto mb-3" style={{ color: C.textDim }} />
          <p className="text-sm font-medium" style={{ color: C.textBody }}>
            {search ? "No opportunities match your search" : "No opportunities yet"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(g => <OpportunityCard key={g.name} group={g} />)}
        </div>
      )}
    </div>
  );
}
