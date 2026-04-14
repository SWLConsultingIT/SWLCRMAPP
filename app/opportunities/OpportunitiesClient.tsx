"use client";

import { useState } from "react";
import Link from "next/link";
import { C } from "@/lib/design";
import {
  Trophy, ChevronRight, ChevronDown, Share2, Mail, Phone,
  Star, ExternalLink, Search, X,
  ArrowRight,
} from "lucide-react";

const gold = "#C9A83A";

type ReplyEntry = {
  channel: string;
  reply_text: string | null;
  classification: string;
  received_at: string;
};

type SequenceStep = {
  channel: string;
  daysAfter: number;
  body?: string;
  subject?: string;
};

type OpportunityLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  role: string | null;
  email: string | null;
  is_priority: boolean;
  channel: string;
  currentStep: number;
  totalSteps: number;
  transferred: boolean;
  transferred_at: string | null;
  replies: ReplyEntry[];
};

type CampaignGroupData = {
  name: string;
  channels: string[];
  leads: OpportunityLead[];
  totalLeadsInCampaign: number;
  channelBreakdown: Record<string, { total: number; converted: number }>;
  avgStepsToConversion: number;
  sequence: SequenceStep[];
  connectionNote: string | null;
};

type Props = { groups: CampaignGroupData[] };

const channelMeta: Record<string, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

const classificationColors: Record<string, { color: string; bg: string; label: string }> = {
  positive:       { color: C.green,  bg: C.greenLight,  label: "Positive" },
  meeting_intent: { color: C.green,  bg: C.greenLight,  label: "Meeting Intent" },
  negative:       { color: C.red,    bg: C.redLight,    label: "Negative" },
  question:       { color: "#D97706", bg: "#FFFBEB",    label: "Question" },
};

function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

// ─── Lead row (expandable → shows replies) ────────────────────────────────────
function LeadRow({ lead }: { lead: OpportunityLead }) {
  const [expanded, setExpanded] = useState(false);
  const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unknown";
  const chMeta = channelMeta[lead.channel] ?? channelMeta.email;
  const ChIcon = chMeta.icon;
  const winReply = lead.replies.find(r => r.classification === "positive" || r.classification === "meeting_intent");

  return (
    <div className="border-t" style={{ borderColor: C.border }}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-black/[0.015]"
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
          style={{ background: `linear-gradient(135deg, ${C.green}, #34D399)`, color: "#fff" }}
        >
          {(lead.first_name ?? "?")[0]?.toUpperCase()}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold" style={{ color: C.textPrimary }}>{name}</span>
            {lead.is_priority && <Star size={10} fill={gold} stroke={gold} />}
          </div>
          <p className="text-[10px] truncate" style={{ color: C.textMuted }}>
            {lead.role ? `${lead.role} · ` : ""}{lead.company ?? "—"}
          </p>
        </div>

        <span className="hidden sm:flex items-center gap-1 text-[10px] font-medium shrink-0" style={{ color: chMeta.color }}>
          <ChIcon size={10} /> {chMeta.label}
        </span>

        <span className="hidden md:block text-[10px] shrink-0" style={{ color: C.textMuted }}>
          Step {lead.currentStep}/{lead.totalSteps}
        </span>

        <div className="shrink-0">
          {lead.transferred ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md"
              style={{ backgroundColor: C.greenLight, color: C.green }}>
              <ExternalLink size={9} /> In CRM
            </span>
          ) : (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md"
              style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}>
              Pending
            </span>
          )}
        </div>

        <span className="hidden sm:block text-[10px] shrink-0" style={{ color: C.textDim }}>
          {winReply ? timeAgo(winReply.received_at) : "—"}
        </span>

        {expanded
          ? <ChevronDown size={14} style={{ color: C.textDim }} className="shrink-0" />
          : <ChevronRight size={14} style={{ color: C.textDim }} className="shrink-0" />
        }
      </button>

      {expanded && (
        <div className="px-5 pb-4" style={{ backgroundColor: C.bg }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
              Replies ({lead.replies.length})
            </p>
            <Link href={`/leads/${lead.id}`} className="text-[10px] font-medium flex items-center gap-1 hover:underline" style={{ color: gold }}>
              View full profile <ArrowRight size={10} />
            </Link>
          </div>

          {lead.replies.length === 0 ? (
            <p className="text-xs" style={{ color: C.textDim }}>No replies recorded</p>
          ) : (
            <div className="space-y-2">
              {lead.replies.map((r, i) => {
                const cls = classificationColors[r.classification] ?? classificationColors.positive;
                const rChMeta = channelMeta[r.channel] ?? channelMeta.email;
                const RIcon = rChMeta.icon;
                return (
                  <div key={i} className="rounded-lg border px-4 py-3" style={{ backgroundColor: C.card, borderColor: cls.color + "30" }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: cls.bg, color: cls.color }}>
                        {cls.label}
                      </span>
                      <span className="flex items-center gap-1 text-[10px]" style={{ color: rChMeta.color }}>
                        <RIcon size={10} /> {rChMeta.label}
                      </span>
                      <span className="text-[10px] ml-auto" style={{ color: C.textDim }}>{formatDate(r.received_at)}</span>
                    </div>
                    {r.reply_text && (
                      <p className="text-xs leading-relaxed" style={{ color: C.textBody }}>
                        &ldquo;{r.reply_text}&rdquo;
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Ticket Card ──────────────────────────────────────────────────────────────
function TicketOpportunityCard({ group }: { group: CampaignGroupData }) {
  const [open, setOpen] = useState(false);

  const converted   = group.leads.length;
  const total       = group.totalLeadsInCampaign;
  const rate        = total > 0 ? Math.round((converted / total) * 100) : 0;
  const transferred = group.leads.filter(l => l.transferred).length;
  const pending     = converted - transferred;

  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      {/* ── Header ── */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-5 py-4 flex items-center gap-4 transition-colors hover:bg-black/[0.02]"
      >
        {/* Conversion ring */}
        <div className="shrink-0 relative" style={{ width: 48, height: 48 }}>
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="#E5E7EB" strokeWidth="3" />
            <circle cx="18" cy="18" r="15.5" fill="none"
              stroke={rate >= 20 ? C.green : rate > 0 ? "#D97706" : C.textDim}
              strokeWidth="3" strokeLinecap="round"
              strokeDasharray={`${rate * 0.975} 100`}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold"
            style={{ color: rate >= 20 ? C.green : rate > 0 ? "#D97706" : C.textDim }}>
            {rate}%
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>{group.name}</h3>
            {group.channels.map(ch => {
              const meta = channelMeta[ch] ?? channelMeta.email;
              const Icon = meta.icon;
              return (
                <span key={ch} className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: `${meta.color}12`, color: meta.color }}>
                  <Icon size={10} /> {meta.label}
                </span>
              );
            })}
          </div>
          <div className="flex items-center gap-4 mt-1.5 text-xs" style={{ color: C.textMuted }}>
            <span><span className="font-bold" style={{ color: C.green }}>{converted}</span>/{total} converted</span>
            {group.avgStepsToConversion > 0 && (
              <span>Avg {group.avgStepsToConversion} steps</span>
            )}
            {transferred > 0 && (
              <span className="flex items-center gap-1">
                <ExternalLink size={10} style={{ color: C.green }} />
                <span className="font-semibold" style={{ color: C.green }}>{transferred}</span> in CRM
              </span>
            )}
            {pending > 0 && (
              <span className="font-semibold" style={{ color: "#D97706" }}>{pending} pending</span>
            )}
          </div>
        </div>

        {open
          ? <ChevronDown size={16} style={{ color: C.textDim }} className="shrink-0" />
          : <ChevronRight size={16} style={{ color: C.textDim }} className="shrink-0" />
        }
      </button>

      {/* ── Expanded ── */}
      {open && (
        <>
          <div className="border-t" style={{ borderColor: C.border }} />

          <div className="px-5 py-4" style={{ backgroundColor: C.bg }}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* LEFT: Channel breakdown */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-3" style={{ color: C.textMuted }}>
                  Conversion by Channel
                </p>
                <div className="space-y-3">
                  {Object.entries(group.channelBreakdown).map(([ch, data]) => {
                    const meta = channelMeta[ch] ?? channelMeta.email;
                    const Icon = meta.icon;
                    const chRate = data.total > 0 ? Math.round((data.converted / data.total) * 100) : 0;
                    return (
                      <div key={ch}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: meta.color }}>
                            <Icon size={12} /> {meta.label}
                          </span>
                          <span className="text-xs" style={{ color: C.textBody }}>
                            <span className="font-bold">{data.converted}</span>/{data.total}
                            <span className="ml-1 font-bold" style={{ color: chRate >= 20 ? C.green : "#D97706" }}>({chRate}%)</span>
                          </span>
                        </div>
                        <div className="h-2.5 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
                          <div className="h-2.5 rounded-full transition-all" style={{ width: `${chRate}%`, backgroundColor: meta.color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Quick wins summary */}
                {group.leads.some(l => l.replies.some(r => r.reply_text)) && (
                  <div className="mt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: C.textMuted }}>
                      Winning Replies
                    </p>
                    <div className="space-y-2">
                      {group.leads.map(l => {
                        const win = l.replies.find(r => r.classification === "positive" || r.classification === "meeting_intent");
                        if (!win?.reply_text) return null;
                        const nm = `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || "Unknown";
                        return (
                          <div key={l.id} className="rounded-lg px-3 py-2 border" style={{ backgroundColor: C.greenLight, borderColor: C.green + "25" }}>
                            <p className="text-[10px] font-semibold mb-0.5" style={{ color: C.green }}>{nm}</p>
                            <p className="text-[11px] leading-relaxed" style={{ color: C.textBody }}>
                              &ldquo;{win.reply_text}&rdquo;
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT: Outreach sequence */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-3" style={{ color: C.textMuted }}>
                  Outreach Sequence ({group.sequence.length} steps)
                </p>

                {group.connectionNote && (
                  <div className="rounded-lg px-3 py-2.5 mb-2 border" style={{ backgroundColor: C.card, borderColor: "#0A66C2" + "30" }}>
                    <p className="text-[10px] font-semibold mb-1 flex items-center gap-1" style={{ color: "#0A66C2" }}>
                      <Share2 size={10} /> Connection Request
                    </p>
                    <p className="text-[11px] leading-relaxed line-clamp-3" style={{ color: C.textBody }}>{group.connectionNote}</p>
                  </div>
                )}

                {group.sequence.length > 0 ? (
                  <div className="space-y-2">
                    {group.sequence.map((step, i) => {
                      const meta = channelMeta[step.channel] ?? channelMeta.email;
                      const Icon = meta.icon;
                      const hasBody = !!step.body;
                      return (
                        <div key={i} className="rounded-lg border px-3 py-2.5" style={{ backgroundColor: C.card, borderColor: C.border }}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[9px] font-bold w-5 h-5 rounded-full flex items-center justify-center"
                              style={{ backgroundColor: `${meta.color}15`, color: meta.color }}>
                              {i + 1}
                            </span>
                            <Icon size={11} style={{ color: meta.color }} />
                            <span className="text-[10px] font-semibold" style={{ color: meta.color }}>{meta.label}</span>
                            {step.daysAfter > 0 && (
                              <span className="text-[10px] ml-auto" style={{ color: C.textDim }}>+{step.daysAfter}d</span>
                            )}
                          </div>
                          {step.subject && (
                            <p className="text-[10px] font-semibold mt-1" style={{ color: C.textBody }}>Subject: {step.subject}</p>
                          )}
                          {hasBody ? (
                            <p className="text-[11px] mt-1 line-clamp-4 leading-relaxed whitespace-pre-line" style={{ color: C.textMuted }}>
                              {step.body}
                            </p>
                          ) : (
                            <p className="text-[10px] mt-0.5 italic" style={{ color: C.textDim }}>Message sent via {meta.label}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs" style={{ color: C.textDim }}>No sequence data available</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Converted leads ── */}
          <div className="border-t px-5 py-2.5" style={{ borderColor: C.border }}>
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
              Converted Leads ({group.leads.length})
            </p>
          </div>
          {group.leads.map(lead => (
            <LeadRow key={lead.id} lead={lead} />
          ))}
        </>
      )}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function OpportunitiesClient({ groups }: Props) {
  const [search, setSearch] = useState("");

  const totalOpps        = groups.reduce((s, g) => s + g.leads.length, 0);
  const totalTransferred = groups.reduce((s, g) => s + g.leads.filter(l => l.transferred).length, 0);

  const filtered = !search
    ? groups
    : groups
        .map(g => ({
          ...g,
          leads: g.leads.filter(l =>
            `${l.first_name} ${l.last_name} ${l.company} ${l.email}`
              .toLowerCase().includes(search.toLowerCase())
          ),
        }))
        .filter(g => g.name.toLowerCase().includes(search.toLowerCase()) || g.leads.length > 0);

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
          <p className="text-xs mt-1" style={{ color: C.textMuted }}>Positive replies from your campaigns will appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(g => <TicketOpportunityCard key={g.name} group={g} />)}
        </div>
      )}
    </div>
  );
}
