"use client";

import Link from "next/link";
import { C } from "@/lib/design";
import {
  ArrowLeft, Share2, Mail, Phone, Star, Clock,
  ChevronRight, HelpCircle,
  PlayCircle, CheckCircle, PauseCircle, XCircle, MessageSquare,
} from "lucide-react";

const gold = "#C9A83A";

type LeadInfo = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  role: string | null;
  email: string | null;
  linkedin_url: string | null;
  status: string | null;
  score: number | null;
  is_priority: boolean;
  channel: string | null;
  reply_count: number;
  has_positive: boolean;
  last_reply: any | null;
};

type CampaignEntry = {
  id: string;
  name: string;
  status: string;
  channel: string;
  current_step: number;
  total_steps: number;
  last_step_at: string | null;
  seller: string | null;
  messages_sent: number;
  messages_total: number;
  lead: LeadInfo | null;
};

type Props = {
  ticketName: string;
  campaigns: CampaignEntry[];
};

const channelMeta: Record<string, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

const statusMeta: Record<string, { color: string; bg: string; icon: typeof PlayCircle; label: string }> = {
  active:    { color: C.green,     bg: C.greenLight, icon: PlayCircle,  label: "Active" },
  paused:    { color: "#D97706",   bg: "#FFFBEB",    icon: PauseCircle, label: "Paused" },
  completed: { color: C.textMuted, bg: "#F3F4F6",    icon: CheckCircle, label: "Completed" },
  failed:    { color: C.red,       bg: C.redLight,   icon: XCircle,     label: "Failed" },
};

function scoreBadge(score: number | null, priority: boolean) {
  if (priority || (score && score >= 80)) return { label: "HOT",     color: C.hot,     bg: C.hotBg };
  if (score && score >= 50)              return { label: "WARM",    color: C.warm,    bg: C.warmBg };
  return                                        { label: "NURTURE", color: C.nurture, bg: C.nurtureBg };
}

function timeAgo(iso: string | null) {
  if (!iso) return null;
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1)  return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StepDots({ current, total }: { current: number; total: number }) {
  if (total === 0) return null;
  const dots = Math.min(total, 7);
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: dots }).map((_, i) => {
        const done   = i < current;
        const active = i === current;
        return (
          <div
            key={i}
            className="rounded-full"
            style={{
              width:  active ? 8 : 6,
              height: active ? 8 : 6,
              backgroundColor: done ? gold : active ? `${gold}70` : "#E5E7EB",
            }}
          />
        );
      })}
      {total > 7 && <span className="text-[9px] ml-0.5" style={{ color: C.textDim }}>+{total - 7}</span>}
    </div>
  );
}

const FINAL_CLASSIFICATIONS = new Set(["positive", "negative", "meeting_intent"]);

function isQuestionReply(lead: LeadInfo | null): boolean {
  if (!lead || (lead.reply_count ?? 0) === 0) return false;
  const cls = lead.last_reply?.classification;
  return !!cls && !FINAL_CLASSIFICATIONS.has(cls);
}

function isFinalReply(lead: LeadInfo | null): boolean {
  if (!lead || (lead.reply_count ?? 0) === 0) return false;
  const cls = lead.last_reply?.classification;
  return !!cls && FINAL_CLASSIFICATIONS.has(cls);
}

// ─── Campaign Card (whole card clickable → /campaigns/[id]) ───────────────────
function CampaignCard({ camp }: { camp: CampaignEntry }) {
  const lead    = camp.lead;
  const name    = lead ? `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unknown" : "—";
  const ch      = channelMeta[camp.channel] ?? channelMeta.email;
  const ChIcon  = ch.icon;
  const badge   = lead ? scoreBadge(lead.score, lead.is_priority) : null;
  const ago     = timeAgo(camp.last_step_at);
  const pct     = camp.total_steps > 0 ? Math.round((camp.current_step / camp.total_steps) * 100) : 0;

  const question = isQuestionReply(lead);
  const effectiveStatus = question ? "paused" : camp.status;
  const st      = statusMeta[effectiveStatus] ?? statusMeta.active;
  const StIcon  = st.icon;

  const replyStatus: "positive" | "negative" | "question" | null =
    lead?.has_positive              ? "positive"
    : question                      ? "question"
    : (lead?.reply_count ?? 0) > 0  ? "negative"
    : null;

  const replyMeta = {
    positive: { label: "Replied — Positive", color: C.green,   bg: C.greenLight },
    negative: { label: "Replied — Negative", color: C.red,     bg: C.redLight },
    question: { label: "Replied — Question", color: "#D97706", bg: "#FFFBEB" },
  } as const;

  const topBorderColor = replyStatus === "positive" ? C.green
                       : replyStatus === "negative"  ? C.red
                       : replyStatus === "question"   ? "#D97706"
                       : "transparent";

  return (
    <div
      className="rounded-xl border overflow-hidden flex flex-col transition-shadow hover:shadow-md"
      style={{ backgroundColor: C.card, borderColor: C.border, borderTopColor: topBorderColor, borderTopWidth: replyStatus ? 2 : 1 }}
    >
      {/* ── Top bar: campaign name (links to campaign detail) + status ── */}
      <Link
        href={`/campaigns/${camp.id}`}
        className="flex items-center justify-between px-4 py-2.5 border-b group/top transition-colors hover:bg-black/[0.02]"
        style={{ borderColor: C.border, backgroundColor: C.bg }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChIcon size={12} style={{ color: ch.color }} />
          <span className="text-xs font-semibold truncate group-hover/top:underline" style={{ color: C.textPrimary }}>
            {camp.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ backgroundColor: st.bg }}>
            <StIcon size={10} style={{ color: st.color }} />
            <span className="text-[10px] font-semibold" style={{ color: st.color }}>{st.label}</span>
          </div>
          <ChevronRight size={13} style={{ color: C.textDim }} className="transition-transform group-hover/top:translate-x-0.5" />
        </div>
      </Link>

      {/* ── Lead block (stopPropagation so clicking lead goes to lead detail) ── */}
      <div
        className="px-4 py-4 flex-1"
        onClick={e => e.stopPropagation()}
      >
        {lead ? (
          <Link href={`/leads/${lead.id}`} className="flex items-start gap-3 group/lead">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 mt-0.5"
              style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#fff" }}
            >
              {((lead.company ?? name)[0] ?? "?").toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-semibold group-hover/lead:underline" style={{ color: C.textPrimary }}>
                  {name}
                </span>
                {lead.is_priority && <Star size={11} fill={gold} stroke={gold} />}
                {badge && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: badge.bg, color: badge.color }}>
                    {badge.label}
                  </span>
                )}
              </div>
              <p className="text-xs mt-0.5 truncate" style={{ color: C.textMuted }}>
                {lead.role ?? ""}{lead.role && lead.company ? " · " : ""}{lead.company ?? "—"}
              </p>
              {lead.last_reply && (
                <p className="text-[10px] mt-1 truncate" style={{ color: C.textDim }}>
                  <MessageSquare size={9} className="inline mr-1" />
                  {lead.last_reply.reply_text ?? "Replied"}
                </p>
              )}
            </div>
          </Link>
        ) : (
          <p className="text-sm" style={{ color: C.textDim }}>No lead attached</p>
        )}
      </div>

      {/* ── Progress ── */}
      <div className="px-4 pb-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1.5">
          <StepDots current={camp.current_step} total={camp.total_steps} />
          <span className="text-[10px] tabular-nums" style={{ color: C.textDim }}>
            {camp.current_step}/{camp.total_steps} steps
          </span>
        </div>
        <div className="h-1 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
          <div className="h-1 rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${gold}, #e8c84a)` }} />
        </div>
        <div className="flex items-center gap-3 mt-2 text-[10px]" style={{ color: C.textDim }}>
          {camp.messages_sent > 0 && <span><Mail size={9} className="inline mr-0.5" />{camp.messages_sent} sent</span>}
          {(lead?.reply_count ?? 0) > 0 && (
            <span style={{ color: lead?.has_positive ? C.green : C.blue }}>
              <MessageSquare size={9} className="inline mr-0.5" />{lead?.reply_count} repl.
            </span>
          )}
          {ago && <span><Clock size={9} className="inline mr-0.5" />{ago}</span>}
        </div>
      </div>

      {/* ── Footer: reply status (automatic from Supabase) ── */}
      <div
        className="px-4 py-2.5 border-t flex flex-col gap-1.5"
        style={{ borderColor: C.border, backgroundColor: C.bg }}
        onClick={e => e.stopPropagation()}
      >
        {replyStatus ? (
          <>
            <span
              className="text-xs font-semibold px-2.5 py-1 rounded-md self-start"
              style={{ backgroundColor: replyMeta[replyStatus].bg, color: replyMeta[replyStatus].color }}
            >
              {replyStatus === "question" && <HelpCircle size={10} className="inline mr-1" />}
              {replyMeta[replyStatus].label}
            </span>
            {replyStatus === "question" && lead?.last_reply?.reply_text && (
              <p className="text-[11px] leading-snug line-clamp-2" style={{ color: "#D97706" }}>
                &ldquo;{lead.last_reply.reply_text}&rdquo;
              </p>
            )}
          </>
        ) : (
          <span className="text-xs" style={{ color: C.textDim }}>Awaiting reply…</span>
        )}
      </div>
    </div>
  );
}

// ─── Campaigns grid ────────────────────────────────────────────────────────────
function CampaignGrid({ campaigns, emptyMsg }: { campaigns: CampaignEntry[]; emptyMsg: string }) {
  if (campaigns.length === 0) {
    return (
      <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-sm" style={{ color: C.textDim }}>{emptyMsg}</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {campaigns.map(c => <CampaignCard key={c.id} camp={c} />)}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function TicketDetailClient({ ticketName, campaigns }: Props) {
  const activeCampaigns = campaigns.filter(c =>
    (c.status === "active" || c.status === "paused") && !isFinalReply(c.lead)
  );

  const total         = campaigns.length;
  const positiveCount = campaigns.filter(c => c.lead?.has_positive).length;
  const sentCount     = campaigns.reduce((s, c) => s + c.messages_sent, 0);
  const replyCount    = campaigns.reduce((s, c) => s + (c.lead?.reply_count ?? 0), 0);

  return (
    <div className="p-6 w-full">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs mb-5" style={{ color: C.textMuted }}>
        <Link href="/leads" className="hover:underline flex items-center gap-1">
          <ArrowLeft size={12} /> Leads &amp; Campaigns
        </Link>
        <span>/</span>
        <span style={{ color: C.textBody }}>{ticketName}</span>
      </div>

      {/* Header */}
      <div className="rounded-xl border mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="p-6">
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>Ticket</p>
          <h1 className="text-2xl font-bold mb-5" style={{ color: C.textPrimary }}>{ticketName}</h1>
          <div className="flex items-center gap-6 flex-wrap">
            {[
              { label: "Total",    value: total,                     color: C.textBody },
              { label: "Active",   value: activeCampaigns.length,    color: C.green },
              { label: "Sent",     value: sentCount,                 color: gold },
              { label: "Replies",  value: replyCount,                color: C.blue },
              { label: "Positive", value: positiveCount,             color: C.green },
            ].map((s, i, arr) => (
              <div key={s.label} className="flex items-center gap-5">
                <div>
                  <p className="text-2xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{s.label}</p>
                </div>
                {i < arr.length - 1 && <div className="h-8 w-px" style={{ backgroundColor: C.border }} />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Active campaigns grid */}
      <CampaignGrid
        campaigns={activeCampaigns}
        emptyMsg="No active campaigns in this ticket"
      />
    </div>
  );
}
