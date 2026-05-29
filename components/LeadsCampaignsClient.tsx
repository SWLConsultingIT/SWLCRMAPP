"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { C } from "@/lib/design";
import {
  Megaphone, ChevronRight, Target,
  Search, X, CheckCircle, Star, RefreshCw, Trash2, Square, CheckSquare,
  Phone, MoreHorizontal, Mail, Flame,
  Building2, Users as UsersIcon, MapPin, Globe, MessageCircle, ThumbsUp, Trophy,
  Plus, Sparkles, Send,
} from "lucide-react";
import { LeadFilterBar, emptyLeadFilterState, type LeadFilterState } from "@/components/LeadFilters";
import { type OpportunityLead } from "@/components/OpportunitiesTable";
import { useToast } from "@/lib/toast";
import { useLocale } from "@/lib/i18n";

const gold = "var(--brand, #c9a83a)";

type LeadInfo = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  role: string | null;
  industry?: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  score: number | null;
  is_priority: boolean;
  channel: string | null;
  reply_count?: number;
  has_positive?: boolean;
  has_campaign?: boolean;
  /** ICP / Lead Miner profile id — used by the ICP column link in the
   *  table. Null when the lead has no ICP assigned. */
  profile_id?: string | null;
  profile_name?: string | null;
  /** Most-actionable campaign on this lead (active > paused > any).
   *  Powers the clickable Campaign column. Null when the lead is not
   *  in any flow. */
  campaign_id?: string | null;
  campaign_name?: string | null;
  campaign_status?: string | null;
  created_at?: string;
};


type CampaignInfo = {
  id: string;
  name: string;
  status: string;
  channel: string;
  current_step: number;
  total_steps: number;
  last_step_at: string | null;
  seller: string | null;
  messages_sent: number;
};

type ProfileGroup = {
  profileId: string;
  profileName: string;
  leads: LeadInfo[];
  campaigns: CampaignInfo[];
  statusCounts: Record<string, number>;
  totalReplies: number;
  positiveCount: number;
  hotCount: number;
  contactedCount: number;
  lastReply: { text: string | null; classification: string; leadName: string; receivedAt: string } | null;
};

export type LostLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  role: string | null;
  email: string | null;
  score: number | null;
  is_priority: boolean;
  profile_name: string | null;
  reason: "negative" | "no_reply";
  reply_text: string | null;
  reply_date: string | null;
  campaign_name: string | null;
  channels: string[];
  steps_completed: number;
  steps_total: number;
  messages_sent: number;
};

export type RenurturingLead = LostLead & {
  new_campaign_name: string | null;
  new_campaign_status: string;
  new_campaign_step: number | null;
  new_campaign_total_steps: number | null;
};

type CompanyInfo = {
  name: string;
  industry: string | null;
  subIndustry: string | null;
  shortDesc: string | null;
  description: string | null;
  tagline: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  website: string | null;
  employees: string | null;
  logoUrl: string | null;
  leadCount: number;
  contactedCount: number;
  repliedCount: number;
  positiveCount: number;
  wonCount: number;
  leadIds: string[];
};

type Props = {
  profileGroups: ProfileGroup[];
  allLeads: LeadInfo[];
  lostLeads: LostLead[];
  renurturingLeads: RenurturingLead[];
  wonLeads: OpportunityLead[];
  companies: CompanyInfo[];
  stats: { totalLeads: number; responseRate: number; positiveReplies: number; activeCampaigns: number };
  /** Total leads in the tenant (unfiltered), from a separate count() query.
   *  When greater than `allLeads.length`, the page hit the 500-row cap and
   *  the user is looking at a partial view — we surface a banner so they
   *  know to filter/export instead of trusting an incomplete list. */
  totalLeadCount?: number;
};

function scoreBadge(score: number | null, priority: boolean) {
  if (priority || (score && score >= 80)) return { label: "HOT",     color: C.hot,     bg: C.hotBg };
  if (score && score >= 50)              return { label: "WARM",    color: C.warm,    bg: C.warmBg };
  return                                        { label: "NURTURE", color: C.nurture, bg: C.nurtureBg };
}

type Tr = (key: string, vars?: Record<string, string | number>) => string;

function timeAgo(iso: string | null, t: Tr) {
  if (!iso) return null;
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1)  return t("leadsPage.time.justNow");
  if (m < 60) return t("leadsPage.time.minutesAgo", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("leadsPage.time.hoursAgo", { n: h });
  return t("leadsPage.time.daysAgo", { n: Math.floor(h / 24) });
}

const classColors: Record<string, { color: string; bg: string; labelKey: string }> = {
  positive:       { color: C.green,   bg: C.greenLight, labelKey: "leadsPage.classBadge.positive" },
  meeting_intent: { color: C.green,   bg: C.greenLight, labelKey: "leadsPage.classBadge.meeting" },
  negative:       { color: C.red,     bg: C.redLight,   labelKey: "leadsPage.classBadge.negative" },
  question:       { color: "#D97706", bg: "#FFFBEB",    labelKey: "leadsPage.classBadge.question" },
};

// ─── Lost Lead Card (detailed report style) ──────────────────────────────────
function LostLeadCard({ lead, selected, onToggle, t }: { lead: LostLead; selected: boolean; onToggle: (id: string) => void; t: Tr }) {
  const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || t("leadsPage.unknown");
  const badge = scoreBadge(lead.score, lead.is_priority);
  const progress = lead.steps_total > 0 ? Math.round((lead.steps_completed / lead.steps_total) * 100) : 0;

  return (
    <div className="rounded-xl border overflow-hidden transition-shadow hover:shadow-md group/card"
      style={{
        backgroundColor: C.card,
        borderLeftWidth: 3, borderLeftColor: lead.reason === "negative" ? C.red : C.textDim,
        boxShadow: selected ? `0 0 0 2px ${C.red}` : undefined,
      }}>
      {/* Checkbox */}
      <div className="flex items-center px-4 pt-3 pb-0">
        <button onClick={() => onToggle(lead.id)}
          className="flex items-center gap-1.5 text-[10px] font-medium transition-opacity opacity-0 group-hover/card:opacity-100"
          style={{ color: selected ? C.red : C.textDim, opacity: selected ? 1 : undefined }}>
          {selected ? <CheckSquare size={13} /> : <Square size={13} />}
          {selected ? t("leadsPage.card.selected") : t("leadsPage.card.select")}
        </button>
      </div>
      <Link href={`/leads/lost/${lead.id}`} className="block p-4 group">
        {/* Lead info */}
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
            style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
            {((lead.company ?? name)[0] ?? "?").toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold group-hover:underline" style={{ color: C.textPrimary }}>{name}</span>
              {lead.is_priority && <Star size={10} fill={gold} stroke={gold} />}
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span>
            </div>
            <p className="text-xs" style={{ color: C.textMuted }}>
              {lead.role ? `${lead.role} · ` : ""}{lead.company ?? "—"}
            </p>
          </div>
          {/* Reason badge */}
          {lead.reason === "negative" ? (
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-md shrink-0" style={{ backgroundColor: C.redLight, color: C.red }}>
              {t("leadsPage.card.negativeReply")}
            </span>
          ) : (
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-md shrink-0" style={{ backgroundColor: C.surface, color: C.textMuted }}>
              {t("leadsPage.card.noReply")}
            </span>
          )}
        </div>

        {/* Reply text (if negative) */}
        {lead.reply_text && (
          <div className="rounded-lg px-3 py-2.5 mb-3 border" style={{ backgroundColor: C.redLight, borderColor: C.red + "20" }}>
            <p className="text-[10px] font-semibold mb-0.5" style={{ color: C.red }}>{t("leadsPage.card.theirResponse")}</p>
            <p className="text-xs leading-relaxed" style={{ color: C.textBody }}>&ldquo;{lead.reply_text}&rdquo;</p>
            {lead.reply_date && (
              <p className="text-[9px] mt-1" style={{ color: C.textDim }}>{timeAgo(lead.reply_date, t)}</p>
            )}
          </div>
        )}

        {/* Campaign details */}
        <div className="rounded-lg px-3 py-2.5 border" style={{ backgroundColor: C.bg, borderColor: C.border }}>
          <div className="flex items-center gap-4 text-[10px] flex-wrap" style={{ color: C.textMuted }}>
            {lead.campaign_name && (
              <span><span className="font-semibold" style={{ color: C.textBody }}>{t("leadsPage.card.campaign")}</span> {lead.campaign_name}</span>
            )}
            {lead.profile_name && (
              <span><span className="font-semibold" style={{ color: C.textBody }}>{t("leadsPage.card.profile")}</span> {lead.profile_name}</span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px]" style={{ color: C.textDim }}>
            <span>{t("leadsPage.card.steps")} <span className="font-bold" style={{ color: C.textBody }}>{lead.steps_completed}/{lead.steps_total}</span></span>
            {lead.messages_sent > 0 && (
              <span>{t("leadsPage.card.messagesSent")} <span className="font-bold" style={{ color: C.textBody }}>{lead.messages_sent}</span></span>
            )}
            <span>{t("leadsPage.card.channels")} <span className="font-bold" style={{ color: C.textBody }}>{lead.channels.join(", ") || "—"}</span></span>
          </div>
          {/* Progress bar */}
          <div className="flex items-center gap-2 mt-2">
            <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: C.border }}>
              <div className="h-1.5 rounded-full" style={{ width: `${progress}%`, backgroundColor: C.textMuted }} />
            </div>
            <span className="text-[9px] tabular-nums" style={{ color: C.textDim }}>{t("leadsPage.card.progressCompleted", { n: progress })}</span>
          </div>
        </div>
      </Link>

      {/* Renurture action */}
      <div className="px-4 pb-4">
        <Link
          href={`/campaigns/new/lead/${lead.id}`}
          className="flex items-center justify-center gap-2 w-full rounded-lg py-2 text-xs font-semibold transition-[opacity,transform,box-shadow,background-color,border-color] hover:opacity-80"
          style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, color: gold, border: `1px solid color-mix(in srgb, ${gold} 19%, transparent)` }}
        >
          <RefreshCw size={12} />
          {t("leadsPage.card.renurtureCta")}
        </Link>
      </div>
    </div>
  );
}

// ─── Won Lead Card (mirrors LostLeadCard layout, green palette) ─────────────
// Same scaffolding as LostLeadCard so Won and Lost feel like a single
// vocabulary. Only differences are: kind-specific badge (days-to-convert +
// transferred), green border / green quote tint, no select checkbox, no
// renurture footer (won leads don't get re-nurtured).
function WonLeadCard({ lead, t }: { lead: OpportunityLead; t: Tr }) {
  const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || t("leadsPage.unknown");
  const badge = scoreBadge(lead.score, lead.is_priority);
  const progress = lead.total_steps > 0 ? Math.round((lead.steps_to_convert / lead.total_steps) * 100) : 0;

  return (
    <div className="rounded-xl border overflow-hidden transition-shadow hover:shadow-md group/card"
      style={{
        backgroundColor: C.card,
        borderLeftWidth: 3, borderLeftColor: C.green,
      }}>
      <Link href={`/opportunities/${lead.id}`} className="block p-4 group">
        {/* Lead info */}
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
            style={{ background: `linear-gradient(135deg, ${C.green}, #34D399)`, color: "#fff" }}>
            {((lead.company ?? name)[0] ?? "?").toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold group-hover:underline" style={{ color: C.textPrimary }}>{name}</span>
              {lead.is_priority && <Star size={10} fill={gold} stroke={gold} />}
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span>
            </div>
            <p className="text-xs" style={{ color: C.textMuted }}>
              {lead.role ? `${lead.role} · ` : ""}{lead.company ?? "—"}
            </p>
          </div>
          {/* Status badge (transferred / pending) */}
          {lead.transferred ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-md shrink-0"
              style={{ backgroundColor: C.greenLight, color: C.green }}>
              <Trophy size={9} /> {t("leadsPage.card.inCrm")}
            </span>
          ) : (
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-md shrink-0"
              style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}>
              {t("leadsPage.card.pendingTransfer")}
            </span>
          )}
        </div>

        {/* Win reply text */}
        {lead.win_text && (
          <div className="rounded-lg px-3 py-2.5 mb-3 border" style={{ backgroundColor: C.greenLight, borderColor: C.green + "30" }}>
            <p className="text-[10px] font-semibold mb-0.5" style={{ color: C.green }}>{t("leadsPage.card.theirResponse")}</p>
            <p className="text-xs leading-relaxed" style={{ color: C.textBody }}>&ldquo;{lead.win_text}&rdquo;</p>
            {lead.win_date && (
              <p className="text-[9px] mt-1" style={{ color: C.textDim }}>{timeAgo(lead.win_date, t)}</p>
            )}
          </div>
        )}

        {/* Campaign details */}
        <div className="rounded-lg px-3 py-2.5 border" style={{ backgroundColor: C.bg, borderColor: C.border }}>
          <div className="flex items-center gap-4 text-[10px] flex-wrap" style={{ color: C.textMuted }}>
            {lead.campaign_name && (
              <span><span className="font-semibold" style={{ color: C.textBody }}>{t("leadsPage.card.campaign")}</span> {lead.campaign_name}</span>
            )}
            {lead.profile_name && (
              <span><span className="font-semibold" style={{ color: C.textBody }}>{t("leadsPage.card.profile")}</span> {lead.profile_name}</span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px]" style={{ color: C.textDim }}>
            {lead.days_to_convert != null && (
              <span>{t("leadsPage.card.daysToConvert")} <span className="font-bold tabular-nums" style={{ color: gold }}>{lead.days_to_convert}</span></span>
            )}
            {lead.total_steps > 0 && (
              <span>{t("leadsPage.card.steps")} <span className="font-bold" style={{ color: C.textBody }}>{lead.steps_to_convert}/{lead.total_steps}</span></span>
            )}
            <span>{t("leadsPage.card.channels")} <span className="font-bold" style={{ color: C.textBody }}>{lead.channels.join(", ") || "—"}</span></span>
          </div>
          {/* Progress bar */}
          {lead.total_steps > 0 && (
            <div className="flex items-center gap-2 mt-2">
              <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: C.border }}>
                <div className="h-1.5 rounded-full" style={{ width: `${progress}%`, backgroundColor: C.green }} />
              </div>
              <span className="text-[9px] tabular-nums" style={{ color: C.textDim }}>{t("leadsPage.card.progressCompleted", { n: progress })}</span>
            </div>
          )}
        </div>
      </Link>
    </div>
  );
}

// ─── Won View ────────────────────────────────────────────────────────────────
export function WonView({ leads }: { leads: OpportunityLead[] }) {
  const { t } = useLocale();
  const [search, setSearch] = useState("");
  const [profileFilter, setProfileFilter] = useState("all");
  const [transferFilter, setTransferFilter] = useState<"all" | "yes" | "no">("all");

  const profileNames = [...new Set(leads.map(l => l.profile_name).filter(Boolean))] as string[];

  const filtered = leads.filter(l => {
    if (search) {
      const q = search.toLowerCase();
      if (!`${l.first_name} ${l.last_name} ${l.company} ${l.campaign_name}`.toLowerCase().includes(q)) return false;
    }
    if (profileFilter !== "all" && l.profile_name !== profileFilter) return false;
    if (transferFilter === "yes" && !l.transferred) return false;
    if (transferFilter === "no" && l.transferred) return false;
    return true;
  });

  const selectStyle = { color: C.textPrimary, backgroundColor: C.bg, border: `1px solid ${C.border}` };

  if (leads.length === 0) {
    return (
      <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <Trophy size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
        <p className="text-sm font-medium" style={{ color: C.textBody }}>{t("leadsPage.won.empty.title")}</p>
        <p className="text-xs mt-1" style={{ color: C.textMuted }}>
          {t("leadsPage.won.empty.desc")}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Filters bar (same shape as Lost view) */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 flex-1 min-w-[200px] max-w-md"
          style={{ borderColor: C.border, backgroundColor: C.card }}>
          <Search size={14} style={{ color: C.textDim }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t("leadsPage.won.search")} className="bg-transparent text-sm outline-none flex-1"
            style={{ color: C.textPrimary }} />
          {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
        </div>
        {profileNames.length > 1 && (
          <select value={profileFilter} onChange={e => setProfileFilter(e.target.value)}
            className="rounded-lg px-3 py-1.5 text-xs" style={selectStyle}>
            <option value="all">{t("leadsPage.won.filter.allProfiles")}</option>
            {profileNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
        <select value={transferFilter} onChange={e => setTransferFilter(e.target.value as "all" | "yes" | "no")}
          className="rounded-lg px-3 py-1.5 text-xs" style={selectStyle}>
          <option value="all">{t("leadsPage.won.filter.allStatus")}</option>
          <option value="yes">{t("leadsPage.won.filter.transferred")}</option>
          <option value="no">{t("leadsPage.won.filter.pendingTransfer")}</option>
        </select>
        <span className="text-xs" style={{ color: C.textMuted }}>{t("leadsPage.results", { n: filtered.length })}</span>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {filtered.map(l => <WonLeadCard key={l.id} lead={l} t={t} />)}
      </div>
    </div>
  );
}

// ─── Re-nurturing Lead Card ───────────────────────────────────────────────────
function RenurturingLeadCard({ lead, t }: { lead: RenurturingLead; t: Tr }) {
  const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || t("leadsPage.unknown");
  const badge = scoreBadge(lead.score, lead.is_priority);
  const isPendingReview = lead.new_campaign_status === "pending_review";
  // Ready-to-reengage: a "no_reply" lead that landed in Renurture but
  // doesn't have a new follow-up flow started yet. Server sets
  // new_campaign_status === "ready_to_reengage" for this case (memory:
  // feedback_no_reply_goes_to_renurture).
  const isReadyToReengage = lead.new_campaign_status === "ready_to_reengage";
  const newProgress = lead.new_campaign_total_steps && lead.new_campaign_step != null
    ? Math.round((lead.new_campaign_step / lead.new_campaign_total_steps) * 100)
    : 0;

  const statusLabel = isPendingReview ? t("leadsPage.renurtureStatus.pendingApproval")
    : isReadyToReengage ? t("leadsPage.renurtureStatus.readyToReengage")
    : lead.new_campaign_status === "approved" || lead.new_campaign_status === "active" ? t("leadsPage.renurtureStatus.running")
    : lead.new_campaign_status === "paused" ? t("leadsPage.renurtureStatus.paused")
    : lead.new_campaign_status === "cancelled" ? t("leadsPage.renurtureStatus.cancelled")
    : lead.new_campaign_status ?? t("leadsPage.renurtureStatus.active");
  const statusColor = isPendingReview ? "#D97706"
    : isReadyToReengage ? gold
    : lead.new_campaign_status === "cancelled" ? C.red
    : lead.new_campaign_status === "paused" ? "#D97706" : C.green;
  const statusBg = isPendingReview ? "#FFFBEB"
    : isReadyToReengage ? `color-mix(in srgb, ${gold} 14%, transparent)`
    : lead.new_campaign_status === "cancelled" ? C.redLight
    : lead.new_campaign_status === "paused" ? "#FFFBEB" : C.greenLight;

  return (
    <div className="rounded-xl border overflow-hidden transition-shadow hover:shadow-md"
      style={{ backgroundColor: C.card, borderColor: C.border, borderLeftWidth: 3, borderLeftColor: C.green }}>
      <Link href={`/leads/lost/${lead.id}`} className="block p-4 group">
        {/* Lead info */}
        <div className="flex items-start gap-3 mb-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
            style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
            {((lead.company ?? name)[0] ?? "?").toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold group-hover:underline" style={{ color: C.textPrimary }}>{name}</span>
              {lead.is_priority && <Star size={10} fill={gold} stroke={gold} />}
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span>
            </div>
            <p className="text-xs" style={{ color: C.textMuted }}>
              {lead.role ? `${lead.role} · ` : ""}{lead.company ?? "—"}
            </p>
          </div>
          <span className="text-[10px] font-bold px-2.5 py-1 rounded-md shrink-0"
            style={{ backgroundColor: statusBg, color: statusColor }}>
            {statusLabel}
          </span>
        </div>

        {/* Previous reply */}
        {lead.reply_text && (
          <div className="rounded-lg px-3 py-2.5 mb-3 border" style={{ backgroundColor: C.redLight, borderColor: C.red + "20" }}>
            <p className="text-[10px] font-semibold mb-0.5" style={{ color: C.red }}>{t("leadsPage.card.previousResponse")}</p>
            <p className="text-xs leading-relaxed" style={{ color: C.textBody }}>&ldquo;{lead.reply_text}&rdquo;</p>
            {lead.reply_date && (
              <p className="text-[9px] mt-1" style={{ color: C.textDim }}>{timeAgo(lead.reply_date, t)}</p>
            )}
          </div>
        )}

        {/* Bottom block:
            - Ready-to-reengage (no_reply, no flow yet): show a gold-tinted
              CTA panel pointing the seller to start a new flow.
            - Otherwise: the existing "New campaign" panel with progress. */}
        {isReadyToReengage ? (
          <div
            className="rounded-lg px-3 py-2.5 border"
            style={{
              backgroundColor: `color-mix(in srgb, ${gold} 10%, transparent)`,
              borderColor: `color-mix(in srgb, ${gold} 30%, transparent)`,
            }}
          >
            <p className="text-[10px] font-semibold mb-0.5" style={{ color: gold }}>
              {t("leadsPage.card.readyToReengage")}
            </p>
            <p className="text-[10.5px]" style={{ color: C.textBody }}>
              {t("leadsPage.card.readyToReengageHint")}
            </p>
          </div>
        ) : (
          <div className="rounded-lg px-3 py-2.5 border" style={{ backgroundColor: C.greenLight + "80", borderColor: C.green + "30" }}>
            <p className="text-[10px] font-semibold mb-1.5" style={{ color: C.green }}>{t("leadsPage.card.newCampaign")}</p>
            <div className="flex items-center gap-3 text-[10px] flex-wrap mb-1" style={{ color: C.textMuted }}>
              {lead.new_campaign_name && (
                <span><span className="font-semibold" style={{ color: C.textBody }}>{lead.new_campaign_name}</span></span>
              )}
              {lead.profile_name && (
                <span>{t("leadsPage.card.profile")} <span className="font-semibold" style={{ color: C.textBody }}>{lead.profile_name}</span></span>
              )}
            </div>
            {!isPendingReview && lead.new_campaign_step != null && lead.new_campaign_total_steps != null && (
              <div className="flex items-center gap-2 mt-1.5">
                <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: C.border }}>
                  <div className="h-1.5 rounded-full" style={{ width: `${newProgress}%`, backgroundColor: C.green }} />
                </div>
                <span className="text-[9px] tabular-nums" style={{ color: C.textDim }}>
                  {t("leadsPage.card.stepsCount", { n: lead.new_campaign_step, total: lead.new_campaign_total_steps })}
                </span>
              </div>
            )}
            {isPendingReview && (
              <p className="text-[10px]" style={{ color: "#D97706" }}>{t("leadsPage.card.awaitingApproval")}</p>
            )}
          </div>
        )}
      </Link>
    </div>
  );
}

// ─── Re-nurturing View ────────────────────────────────────────────────────────
export function RenurturingView({ leads }: { leads: RenurturingLead[] }) {
  const { t } = useLocale();
  const [search, setSearch] = useState("");

  const filtered = leads.filter(l => {
    if (!search) return true;
    const q = search.toLowerCase();
    return `${l.first_name} ${l.last_name} ${l.company} ${l.new_campaign_name}`.toLowerCase().includes(q);
  });

  if (leads.length === 0) {
    return (
      <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <RefreshCw size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
        <p className="text-sm font-medium" style={{ color: C.textBody }}>{t("leadsPage.renurture.empty.title")}</p>
        <p className="text-xs mt-1" style={{ color: C.textMuted }}>{t("leadsPage.renurture.empty.desc")}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 flex-1 min-w-[200px] max-w-sm"
          style={{ borderColor: C.border, backgroundColor: C.card }}>
          <Search size={14} style={{ color: C.textDim }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t("leadsPage.renurture.search")} className="bg-transparent text-sm outline-none flex-1" style={{ color: C.textPrimary }} />
          {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
        </div>
        <span className="text-xs" style={{ color: C.textMuted }}>{t("leadsPage.results", { n: filtered.length })}</span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {filtered.map(l => <RenurturingLeadCard key={l.id} lead={l} t={t} />)}
      </div>
    </div>
  );
}

// ─── Lost Leads View ──────────────────────────────────────────────────────────
export function LostLeadsView({ leads }: { leads: LostLead[] }) {
  const { t } = useLocale();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [recovering, setRecovering] = useState(false);

  const filtered = leads.filter(l => {
    if (filter === "negative" && l.reason !== "negative") return false;
    if (filter === "no_reply" && l.reason !== "no_reply") return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${l.first_name} ${l.last_name} ${l.company} ${l.campaign_name}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const negativeCount = leads.filter(l => l.reason === "negative").length;
  const noReplyCount = leads.filter(l => l.reason === "no_reply").length;
  const filteredIds = filtered.map(l => l.id);
  const allSelected = filteredIds.length > 0 && filteredIds.every(id => selected.has(id));

  function toggleOne(id: string) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(prev => { const next = new Set(prev); filteredIds.forEach(id => next.delete(id)); return next; });
    } else {
      setSelected(prev => new Set([...prev, ...filteredIds]));
    }
  }

  async function deleteSelected() {
    if (!window.confirm(t("leadsPage.lost.confirmDelete", { n: selected.size }))) return;
    setDeleting(true);
    const ids = [...selected];
    // Use API route with service key to bypass RLS (browser client blocked for
    // super_admin viewing cross-tenant leads — company_bio_id mismatch).
    const res = await fetch("/api/leads/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadIds: ids }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: t("leadsPage.lost.deleteFailed") }));
      window.alert(`${t("leadsPage.lost.deleteFailed")}: ${error}`);
    }
    setDeleting(false);
    setSelected(new Set());
    window.location.reload();
  }

  async function recoverSelected() {
    const n = selected.size;
    if (!window.confirm(t("leadsPage.lost.confirmRecover", { n }))) return;
    setRecovering(true);
    const ids = [...selected];
    const res = await fetch("/api/leads/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadIds: ids }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: t("leadsPage.lost.recoverFailed") }));
      setRecovering(false);
      window.alert(`${t("leadsPage.lost.recoverFailed")}: ${error}`);
      return;
    }
    setRecovering(false);
    setSelected(new Set());
    window.location.reload();
  }

  if (leads.length === 0) {
    return (
      <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <CheckCircle size={28} className="mx-auto mb-3" style={{ color: C.green }} />
        <p className="text-sm font-medium" style={{ color: C.textBody }}>{t("leadsPage.lost.empty.title")}</p>
        <p className="text-xs mt-1" style={{ color: C.textMuted }}>{t("leadsPage.lost.empty.desc")}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Summary + filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 flex-1 min-w-[200px] max-w-sm"
          style={{ borderColor: C.border, backgroundColor: C.card }}>
          <Search size={14} style={{ color: C.textDim }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t("leadsPage.lost.search")} className="bg-transparent text-sm outline-none flex-1" style={{ color: C.textPrimary }} />
          {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
        </div>
        <div className="flex items-center gap-1 rounded-lg border p-0.5" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          {[
            { key: "all",      label: t("leadsPage.lost.filter.all",      { n: leads.length }) },
            { key: "negative", label: t("leadsPage.lost.filter.negative", { n: negativeCount }) },
            { key: "no_reply", label: t("leadsPage.lost.filter.noReply",  { n: noReplyCount }) },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className="px-3 py-1 rounded-md text-[10px] font-semibold transition-colors"
              style={{
                backgroundColor: filter === f.key ? C.card : "transparent",
                color: filter === f.key ? C.textPrimary : C.textMuted,
                boxShadow: filter === f.key ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
              }}>
              {f.label}
            </button>
          ))}
        </div>
        <span className="text-xs" style={{ color: C.textMuted }}>{t("leadsPage.results", { n: filtered.length })}</span>

        {/* Select all + delete toolbar */}
        <button onClick={toggleAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-semibold transition-colors"
          style={{ borderColor: C.border, backgroundColor: C.card, color: allSelected ? C.textPrimary : C.textMuted }}>
          {allSelected ? <CheckSquare size={12} /> : <Square size={12} />}
          {allSelected ? t("leadsPage.lost.deselectAll") : t("leadsPage.lost.selectAll")}
        </button>

        {selected.size > 0 && (
          <>
            <button onClick={recoverSelected} disabled={recovering || deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-[opacity,transform,box-shadow,background-color,border-color]"
              style={{ backgroundColor: gold, color: "#04070d", opacity: (recovering || deleting) ? 0.6 : 1 }}
              title={t("leadsPage.lost.recoverTitle")}>
              <RefreshCw size={12} className={recovering ? "animate-spin" : ""} />
              {recovering
                ? t("leadsPage.lost.recovering")
                : t(selected.size === 1 ? "leadsPage.lost.recoverN" : "leadsPage.lost.recoverNPlural", { n: selected.size })}
            </button>
            <button onClick={deleteSelected} disabled={deleting || recovering}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-[opacity,transform,box-shadow,background-color,border-color]"
              style={{ backgroundColor: C.red, color: "#fff", opacity: (deleting || recovering) ? 0.6 : 1 }}>
              <Trash2 size={12} />
              {deleting
                ? t("leadsPage.lost.deleting")
                : t(selected.size === 1 ? "leadsPage.lost.deleteN" : "leadsPage.lost.deleteNPlural", { n: selected.size })}
            </button>
          </>
        )}
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {filtered.map(l => <LostLeadCard key={l.id} lead={l} selected={selected.has(l.id)} onToggle={toggleOne} t={t} />)}
      </div>
    </div>
  );
}

// ─── Companies Grid ─────────────────────────────────────────────────────────
// Aggregated company-level view of the same `allLeads` set, one card per
// distinct company_name. Each card links to /companies/[name] which has the
// existing detail page (contacts, activity, intel).
function CompaniesGrid({ companies }: { companies: CompanyInfo[] }) {
  const { t } = useLocale();
  const [search, setSearch] = useState("");

  const filtered = !search ? companies : companies.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.industry ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (c.city ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (c.shortDesc ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="w-full">
      {/* Search */}
      <div className="flex items-center gap-2 mb-4 rounded-lg border px-3 py-1.5 max-w-sm"
        style={{ borderColor: C.border, backgroundColor: C.card }}>
        <Search size={14} style={{ color: C.textDim }} />
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder={t("leadsPage.companies.search")}
          className="bg-transparent text-sm outline-none flex-1"
          style={{ color: C.textPrimary }}
        />
        {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <Building2 size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
          <p className="text-sm font-medium" style={{ color: C.textBody }}>
            {search ? t("leadsPage.companies.empty.match") : t("leadsPage.companies.empty.none")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(c => <CompanyCard key={c.name} company={c} t={t} />)}
        </div>
      )}
    </div>
  );
}

function CompanyCard({ company, t }: { company: CompanyInfo; t: Tr }) {
  const initial = (company.name?.[0] ?? "?").toUpperCase();
  const location = [company.city, company.country].filter(Boolean).join(", ");
  const summary = company.shortDesc ?? company.description ?? company.tagline;
  return (
    <Link
      href={`/companies/${encodeURIComponent(company.name)}`}
      className="block rounded-xl border overflow-hidden transition-[box-shadow,transform] hover:shadow-md hover:-translate-y-px"
      style={{ backgroundColor: C.card, borderColor: C.border }}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-start gap-3 border-b" style={{ borderColor: C.border }}>
        {company.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={company.logoUrl} alt="" className="w-11 h-11 rounded-lg object-cover border shrink-0" style={{ borderColor: C.border }} />
        ) : (
          <div className="w-11 h-11 rounded-lg flex items-center justify-center text-base font-bold shrink-0"
            style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
            {initial}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold truncate" style={{ color: C.textPrimary }}>{company.name}</h3>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px]" style={{ color: C.textMuted }}>
            {company.industry && (
              <span className="flex items-center gap-1">
                <Building2 size={10} /> {company.industry}
              </span>
            )}
            {location && (
              <span className="flex items-center gap-1">
                <MapPin size={10} /> {location}
              </span>
            )}
          </div>
        </div>
        <ChevronRight size={14} style={{ color: C.textDim }} className="shrink-0 mt-1" />
      </div>

      {/* Description */}
      {summary && (
        <div className="px-4 py-3 text-[12px] leading-relaxed line-clamp-3" style={{ color: C.textBody }}>
          {summary}
        </div>
      )}

      {/* Stats */}
      <div className="px-4 py-3 border-t flex items-center justify-between gap-2 flex-wrap"
        style={{ borderColor: C.border, backgroundColor: C.bg }}>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1" style={{ color: C.textBody }}>
            <UsersIcon size={11} style={{ color: gold }} />
            <span className="font-semibold tabular-nums">{company.leadCount}</span>
            <span style={{ color: C.textMuted }}>{company.leadCount === 1 ? t("leadsPage.companies.lead") : t("leadsPage.companies.leads")}</span>
          </span>
          {company.contactedCount > 0 && (
            <span className="flex items-center gap-1" style={{ color: C.textBody }}>
              <MessageCircle size={11} style={{ color: C.blue }} />
              <span className="font-semibold tabular-nums">{company.contactedCount}</span>
              <span style={{ color: C.textMuted }}>{t("leadsPage.companies.contacted")}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {company.positiveCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-1"
              style={{ backgroundColor: C.greenLight, color: C.green }}>
              <ThumbsUp size={9} /> {company.positiveCount}
            </span>
          )}
          {company.wonCount > 0 && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded inline-flex items-center gap-1"
              style={{ backgroundColor: C.greenLight, color: C.green }}>
              <Trophy size={9} /> {company.wonCount}
            </span>
          )}
          {company.website && (
            <span className="text-[10px] font-medium inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
              style={{ backgroundColor: C.cardHov, color: C.textMuted }}>
              <Globe size={9} /> {t("leadsPage.companies.site")}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

// ─── All Leads Table with Filters ─────────────────────────────────────────────
const PAGE_SIZE = 25;

function AllLeadsTable({ leads }: { leads: LeadInfo[] }) {
  const { t } = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [showCount, setShowCount] = useState(PAGE_SIZE);
  const [filters, setFilters] = useState<LeadFilterState>(emptyLeadFilterState());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Inline per-row actions menu state. Only one row's menu is open at a time.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [rowUpdating, setRowUpdating] = useState<string | null>(null);
  // Modal for "Add to existing flow" bulk action. Fetches active flows on
  // open so the picker reflects the current state (a campaign created in
  // another tab shows up without a refresh).
  // Re-introduced 2026-05-29 (boss revised rule): the bulk popup may surface
  // Create New Flow / Add to existing flow buttons — but ONLY when every
  // selected lead shares a single ICP. Mixed-ICP selections still hide both
  // buttons (preserves the LAW: one ICP per campaign).
  const [showAddToFlow, setShowAddToFlow] = useState(false);

  const profileNames = [...new Set(leads.map(l => l.profile_name).filter(Boolean))] as string[];
  // Distinct role + industry values from the current lead set, sorted
  // alphabetically. Roles can be very noisy ("Senior Partner — Investments"
  // vs "Senior Partner Investments") so we leave them verbatim — manager
  // can pick the closest match. Industries are usually canonical.
  const roleOptions = [...new Set(leads.map(l => (l.role ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const industryOptions = [...new Set(leads.map(l => (l.industry ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  // Filter pipeline — multi-select. Each facet is an array; empty array
  // means "no filter applied" for that axis. Within a facet we OR
  // (lead matches if any selected value matches); across facets we AND
  // (every facet must let the lead through). Boss feedback 2026-05-28 r5.
  const filtered = leads.filter(l => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!`${l.first_name} ${l.last_name} ${l.company} ${l.email}`.toLowerCase().includes(q)) return false;
    }
    if (filters.score.length > 0) {
      const isHot     = l.is_priority || (l.score != null && l.score >= 80);
      const isWarm    = !isHot && l.score != null && l.score >= 50;
      const isNurture = !isHot && (l.score == null || l.score < 50);
      const scoreOk =
        (filters.score.includes("hot") && isHot) ||
        (filters.score.includes("warm") && isWarm) ||
        (filters.score.includes("nurture") && isNurture);
      if (!scoreOk) return false;
    }
    if (filters.results.length > 0) {
      // Positive = lead has at least one positive/meeting_intent reply.
      // Negative = lead has at least one negative reply OR a finished
      // campaign with no positive. (Mirrors how /results buckets Lost.)
      const isPositive = !!l.has_positive;
      // We only have a boolean has_positive on the lead row; a "negative"
      // signal lives in lead_replies which isn't shipped here. Until we
      // ship reply classifications on the lead row, treat "negative" as
      // "replied but not positive" — same proxy /leads has used for the
      // No-Response chip.
      const isNegative = !isPositive && (l.reply_count ?? 0) > 0;
      const resOk =
        (filters.results.includes("positive") && isPositive) ||
        (filters.results.includes("negative") && isNegative);
      if (!resOk) return false;
    }
    if (filters.campaign.length > 0) {
      const campOk =
        (filters.campaign.includes("yes") && l.has_campaign) ||
        (filters.campaign.includes("no") && !l.has_campaign);
      if (!campOk) return false;
    }
    if (filters.profile.length > 0 && !filters.profile.includes(l.profile_name ?? "")) return false;
    if (filters.role.length > 0 && !filters.role.includes((l.role ?? "").trim())) return false;
    if (filters.industry.length > 0 && !filters.industry.includes((l.industry ?? "").trim())) return false;
    return true;
  });

  const visible = filtered.slice(0, showCount);
  const hasMore = showCount < filtered.length;

  // Header checkbox semantics — boss feedback 2026-05-28 r5: "si pongo
  // filtros las que están en el filtro pero todo ahora solo agarra las
  // que se ven". So the header checkbox selects every lead in the
  // current filtered set, not only the showCount slice. visibleIds
  // stays around for shift-click range select (line by line).
  const visibleIds = visible.map(v => v.id);
  const filteredIds = filtered.map(v => v.id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selected.has(id));

  function toggleOne(id: string, shiftKey = false) {
    // Shift-click range select — Gmail/Linear pattern. Selects every visible
    // row between the previously-clicked checkbox and the new one. Without
    // this, sellers were clicking 50 checkboxes one by one for a bulk action.
    if (shiftKey && lastSelectedId && lastSelectedId !== id) {
      const ids = visibleIds;
      const fromIdx = ids.indexOf(lastSelectedId);
      const toIdx = ids.indexOf(id);
      if (fromIdx !== -1 && toIdx !== -1) {
        const [a, b] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
        const range = ids.slice(a, b + 1);
        setSelected(prev => {
          const next = new Set(prev);
          const allSelected = range.every(x => next.has(x));
          range.forEach(x => (allSelected ? next.delete(x) : next.add(x)));
          return next;
        });
        setLastSelectedId(id);
        return;
      }
    }
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setLastSelectedId(id);
  }

  // Quick single-lead status change from the row hover menu. Reuses the bulk
  // endpoint (it accepts an array, so we pass [id]) so the tenant scope guard
  // is identical and there's no second endpoint to maintain.
  async function quickChangeStatus(id: string, status: string) {
    if (rowUpdating) return;
    setRowUpdating(id);
    setOpenMenuId(null);
    try {
      const res = await fetch("/api/leads/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id], status }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Update failed" }));
        toast.show({ kind: "error", title: t("leadsPage.bulk.toast.statusFailed"), description: error || t("leadsPage.bulk.toast.statusFailedDesc") });
        return;
      }
      toast.show({ kind: "success", title: t("leadsPage.row.toast.statusUpdate", { status }) });
      router.refresh();
    } finally {
      setRowUpdating(null);
    }
  }

  async function quickTogglePriority(id: string, current: boolean) {
    if (rowUpdating) return;
    setRowUpdating(id);
    setOpenMenuId(null);
    try {
      const res = await fetch(`/api/leads/${id}/priority`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_priority: !current }),
      });
      if (!res.ok) {
        // Endpoint may not exist yet — silent-fail with a friendly toast
        // instead of an exception. Tracked in pending tasks as a backend TODO.
        toast.show({ kind: "warning", title: t("leadsPage.row.toast.hotPending"), description: t("leadsPage.row.toast.hotPendingDesc") });
        return;
      }
      toast.show({ kind: "success", title: !current ? t("leadsPage.row.toast.markedHot") : t("leadsPage.row.toast.removedHot") });
      router.refresh();
    } finally {
      setRowUpdating(null);
    }
  }
  function toggleAllFiltered() {
    setSelected(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredIds.forEach(id => next.delete(id));
      else filteredIds.forEach(id => next.add(id));
      return next;
    });
  }
  async function bulkDelete() {
    if (selected.size === 0 || deleting) return;
    if (!confirm(t("leadsPage.bulk.confirmDelete", { n: selected.size }))) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/leads/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Delete failed" }));
        toast.show({ kind: "error", title: t("leadsPage.bulk.toast.deleteFailed"), description: error || t("leadsPage.bulk.toast.statusFailedDesc") });
        return;
      }
      toast.show({ kind: "success", title: t("leadsPage.bulk.toast.deleted", { n: selected.size }) });
      setSelected(new Set());
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  // "Create new flow" — feeds the wizard. The bulk popup only surfaces
  // this button when every selected lead shares a single ICP (the
  // one-ICP-per-campaign LAW), so we can deep-link to
  // /campaigns/new/[icpId]?leads=… skipping the ICP picker.
  function createNewFlowFromSelection(sharedIcpId: string) {
    const ids = Array.from(selected);
    if (ids.length === 0 || !sharedIcpId) return;
    router.push(`/campaigns/new/${sharedIcpId}?leads=${ids.join(",")}`);
  }

  async function bulkChangeStatus(status: string) {
    if (selected.size === 0 || deleting) return;
    // Snapshot prior status for each selected lead so an Undo can restore
    // each row to where it was instead of forcing the user to manually
    // revert. Reads from the in-memory leads array — no extra round trip.
    const selectedIds = Array.from(selected);
    const prevById = new Map<string, string | null>();
    for (const l of leads) {
      if (selected.has(l.id)) prevById.set(l.id, l.status ?? null);
    }
    setDeleting(true);
    try {
      const res = await fetch("/api/leads/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, status }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Update failed" }));
        toast.show({ kind: "error", title: t("leadsPage.bulk.toast.statusFailed"), description: error || t("leadsPage.bulk.toast.statusFailedDesc") });
        return;
      }
      const data = await res.json().catch(() => ({ updated: selectedIds.length })) as { updated?: number };
      const updatedCount = data.updated ?? selectedIds.length;
      toast.show({
        kind: "success",
        title: t("leadsPage.bulk.toast.statusUpdated", { n: updatedCount, status }),
        action: {
          label: t("leadsPage.bulk.toast.undo"),
          onClick: async () => {
            // Group by prior status so we make at most 1 round-trip per
            // distinct status (in practice almost everyone shares the same
            // status before a bulk change).
            const groups = new Map<string, string[]>();
            for (const [id, prev] of prevById.entries()) {
              if (!prev) continue;
              const arr = groups.get(prev) ?? [];
              arr.push(id);
              groups.set(prev, arr);
            }
            for (const [prevStatus, ids] of groups.entries()) {
              await fetch("/api/leads/bulk-status", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids, status: prevStatus }),
              }).catch(() => null);
            }
            toast.show({ kind: "info", title: t("leadsPage.bulk.toast.undone") });
            router.refresh();
          },
        },
      });
      setSelected(new Set());
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      {/* Saved-view chip row removed 2026-05-28: the new Status chip group
          at the LeadsCampaignsClient level already covers Hot / Replied /
          Positive / Without flow / In a flow. Keeping a second chip row
          here would just duplicate navigation. The advanced filters (ICP,
          Role, Industry, Search, Score, Reply, Campaign) live inside the
          plegable filter bar below. */}
      <LeadFilterBar
        filters={filters}
        onChange={f => {
          setFilters(f);
          setShowCount(PAGE_SIZE);
        }}
        resultCount={filtered.length}
        totalCount={leads.length}
        profileNames={profileNames}
        roleOptions={roleOptions}
        industryOptions={industryOptions}
      />

      {selected.size > 0 && (() => {
        // Flow-creation surfaces re-enabled 2026-05-29 with the one-ICP guard
        // (boss revised rule: ok desde /leads SI son del mismo ICP).
        //   • Both buttons appear ONLY when every selected lead shares the
        //     same `profile_id` (and that profile_id is non-null) AND none of
        //     them already sits in a flow. That keeps the LAW intact
        //     ("one ICP per campaign") without the hard ban on /leads.
        //   • Mixed-ICP selections → buttons hidden, hint explains why.
        //   • Some-already-in-flow selections → buttons hidden, hint explains.
        const selectedLeadObjs = leads.filter(l => selected.has(l.id));
        const someAlreadyInFlow = selectedLeadObjs.some(l => l.has_campaign === true);
        const allWithoutFlow = selectedLeadObjs.length > 0 && !someAlreadyInFlow;
        const icpSet = new Set(selectedLeadObjs.map(l => l.profile_id ?? null));
        const sharedIcp = icpSet.size === 1 && [...icpSet][0] ? ([...icpSet][0] as string) : null;
        const canCreateFlow = allWithoutFlow && sharedIcp !== null;
        // Hint text picks the right reason for hiding the flow buttons so
        // the seller knows what to do (move to Lead Miner ticket vs split
        // by ICP first vs status-only because already in a flow).
        const hint = someAlreadyInFlow
          ? t("leadsPage.bulk.someInFlow", { n: selectedLeadObjs.filter(l => l.has_campaign).length })
          : !sharedIcp
            ? t("leadsPage.bulk.mixedIcp")
            : t("leadsPage.bulk.pushHint");
        return (
        // Floating bulk action bar — dark-gradient pop-up anchored to the
        // bottom-center of the viewport.
        <div className="fixed left-1/2 -translate-x-1/2 z-50 pointer-events-none" style={{ bottom: 24 }}>
          <div className="pointer-events-auto rounded-2xl border flex flex-col gap-2.5 px-4 py-3 shadow-2xl"
            style={{
              background: "linear-gradient(135deg, #0B0F1A 0%, #111827 60%, #0B0F1A 100%)",
              borderColor: `color-mix(in srgb, ${gold} 38%, transparent)`,
              boxShadow: `0 24px 64px -12px rgba(11,15,26,0.6), 0 0 0 1px color-mix(in srgb, ${gold} 26%, transparent), 0 6px 22px -8px color-mix(in srgb, ${gold} 42%, transparent)`,
              minWidth: 520,
              maxWidth: "calc(100vw - 48px)",
            }}>
            {/* Header row: icon + text. Always one line; text container has
                its own row so it can never collapse competing with buttons. */}
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`, color: "#1A1505" }}>
                <Sparkles size={15} />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold leading-tight truncate" style={{ color: "#fff", fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                  {t(selected.size === 1 ? "leadsPage.bulk.leadSelected" : "leadsPage.bulk.leadsSelected", { n: selected.size })}
                </p>
                <p className="text-[11px] mt-0.5 truncate" style={{ color: "color-mix(in srgb, white 55%, transparent)" }} title={hint}>
                  {hint}
                </p>
              </div>
            </div>

            {/* Actions row: buttons wrap to a second line if the bar gets
                squeezed, but never push the header text into single-word
                breaks (which is what the old single-row + flex-wrap did). */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Flow buttons — only when every selected lead shares one ICP
                  AND none already sits in a flow (one-ICP-per-campaign LAW). */}
              {canCreateFlow && sharedIcp && (
                <>
                  <button onClick={() => setShowAddToFlow(true)} disabled={deleting}
                    className="text-[12.5px] font-bold px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: "rgba(255,255,255,0.08)", color: gold, border: `1px solid color-mix(in srgb, ${gold} 45%, transparent)` }}>
                    <Megaphone size={13} /> {t("leadsPage.bulk.addToExisting")}
                  </button>
                  <button onClick={() => createNewFlowFromSelection(sharedIcp)} disabled={deleting}
                    className="text-[12.5px] font-bold px-3.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{
                      background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 75%, white))`,
                      color: "#1A1505",
                      boxShadow: `0 4px 14px color-mix(in srgb, ${gold} 38%, transparent)`,
                    }}>
                    <Send size={13} /> {t("leadsPage.bulk.createNewFlow")}
                  </button>
                </>
              )}

              {/* Spacer pushes status/clear/delete to the right edge when the
                  flow buttons exist. Collapses to 0 when only secondary
                  actions are present. */}
              <div className="flex-1 min-w-0" />

              {/* Status / delete — secondary, sit on the right edge. Native
                  select inherits OS styling; we just paint it dark to match. */}
              <label className="relative inline-flex items-center">
                <select
                  disabled={deleting}
                  onChange={e => {
                    const v = e.target.value;
                    e.target.value = "";
                    if (v) void bulkChangeStatus(v);
                  }}
                  defaultValue=""
                  className="appearance-none text-[12px] font-semibold px-3 py-1.5 pr-7 rounded-lg cursor-pointer disabled:opacity-50"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.18)",
                    color: "rgba(255,255,255,0.9)",
                  }}
                >
                  <option value="" disabled>{t("leadsPage.bulk.changeStatusPlaceholder")}</option>
                  <option value="new">{t("leadsPage.status.new")}</option>
                  <option value="contacted">{t("leadsPage.status.contacted")}</option>
                  <option value="connected">{t("leadsPage.status.connected")}</option>
                  <option value="responded">{t("leadsPage.status.responded")}</option>
                  <option value="qualified">{t("leadsPage.status.qualified")}</option>
                  <option value="proposal_sent">{t("leadsPage.status.proposalSent")}</option>
                  <option value="closed_won">{t("leadsPage.status.won")}</option>
                  <option value="closed_lost">{t("leadsPage.status.lost")}</option>
                  <option value="nurturing">{t("leadsPage.status.nurturing")}</option>
                </select>
                <ChevronRight size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none rotate-90" style={{ color: "rgba(255,255,255,0.6)" }} />
              </label>
              <button onClick={() => setSelected(new Set())} disabled={deleting}
                className="text-[11.5px] font-semibold px-3 py-1.5 rounded-lg transition-colors hover:bg-white/[0.06]"
                style={{ color: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.18)" }}>
                {t("leadsPage.bulk.clear")}
              </button>
              <button onClick={bulkDelete} disabled={deleting}
                className="text-[12px] font-bold px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #DC2626, #B91C1C)", color: "#fff", boxShadow: "0 4px 14px rgba(220,38,38,0.35)" }}>
                {deleting ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
                {deleting ? t("leadsPage.bulk.working") : t("leadsPage.bulk.deleteN", { n: selected.size })}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {showAddToFlow && (() => {
        // Compute sharedIcp again at modal-open time (selection might have
        // shifted) so the modal can filter its flow list to that ICP only —
        // belt-and-braces enforcement of the one-ICP-per-campaign LAW.
        const selectedLeadObjs = leads.filter(l => selected.has(l.id));
        const icpSet = new Set(selectedLeadObjs.map(l => l.profile_id ?? null));
        const sharedIcp = icpSet.size === 1 && [...icpSet][0] ? ([...icpSet][0] as string) : null;
        if (!sharedIcp) { setShowAddToFlow(false); return null; }
        return (
          <AddToFlowModalLeads
            leadIds={Array.from(selected)}
            icpProfileId={sharedIcp}
            onClose={() => setShowAddToFlow(false)}
            onAdded={() => { setShowAddToFlow(false); setSelected(new Set()); router.refresh(); }}
          />
        );
      })()}

      <div className="rounded-xl border overflow-hidden card-shadow" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <table className="w-full text-left">
          <thead>
            <tr style={{ backgroundColor: C.bg }}>
              <th className="px-3 py-2.5 w-8">
                <button onClick={toggleAllFiltered} className="block" aria-label={t("leadsPage.table.selectAllAria", { n: filteredIds.length })} title={t("leadsPage.table.selectAllTitle", { n: filteredIds.length })}>
                  {allFilteredSelected ? <CheckSquare size={14} style={{ color: gold }} /> : <Square size={14} style={{ color: C.textDim }} />}
                </button>
              </th>
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{t("leadsPage.table.head.lead")}</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider hidden md:table-cell" style={{ color: C.textMuted }}>{t("leadsPage.table.head.company")}</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider hidden lg:table-cell" style={{ color: C.textMuted }}>{t("leadsPage.table.head.role")}</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: C.textMuted }}>{t("leadsPage.table.head.score")}</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider hidden sm:table-cell" style={{ color: C.textMuted }}>{t("leadsPage.table.head.icp")}</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{t("leadsPage.table.head.campaign")}</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{t("leadsPage.table.head.reply")}</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-sm" style={{ color: C.textDim }}>{t("leadsPage.table.empty")}</td></tr>
            ) : visible.map(lead => {
              const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || t("leadsPage.unknown");
              const badge = scoreBadge(lead.score, lead.is_priority);
              const hasReply = (lead.reply_count ?? 0) > 0;
              const replyColor = lead.has_positive ? C.green : hasReply ? "#D97706" : C.textDim;
              const replyLabel = lead.has_positive ? t("leadsPage.table.replyPositive") : hasReply ? t("leadsPage.table.replyReplied") : "—";
              const isSelected = selected.has(lead.id);
              const isUpdating = rowUpdating === lead.id;
              const menuOpen = openMenuId === lead.id;
              return (
                <tr key={lead.id} className="border-t transition-colors hover:bg-black/[0.015] group/lr"
                  style={{ borderColor: C.border, backgroundColor: isSelected ? "#FEF2F2" : undefined }}>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={(e) => toggleOne(lead.id, e.shiftKey)}
                      className="block"
                      aria-label={t("leadsPage.table.selectLead")}
                      title={t("leadsPage.table.shiftClick")}
                    >
                      {isSelected ? <CheckSquare size={14} style={{ color: gold }} /> : <Square size={14} style={{ color: C.textDim }} />}
                    </button>
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/leads/${lead.id}`} className="flex items-center gap-2 group/row">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                        style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
                        {((lead.company ?? name)[0] ?? "?").toUpperCase()}
                      </div>
                      <span className="text-xs font-semibold group-hover/row:underline truncate" style={{ color: C.textPrimary }}>{name}</span>
                      {lead.is_priority && <Star size={9} fill={gold} stroke={gold} className="shrink-0" />}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <span className="text-xs truncate block max-w-[140px]" style={{ color: C.textMuted }}>{lead.company ?? "—"}</span>
                  </td>
                  <td className="px-4 py-2.5 hidden lg:table-cell">
                    <span className="text-xs truncate block max-w-[140px]" style={{ color: C.textMuted }}>{lead.role ?? "—"}</span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span>
                  </td>
                  {/* ICP and Campaign cells are clickable now (boss
                      feedback 2026-05-28 r10) — full name with a tooltip
                      for overflow, link to the ICP ticket / campaign
                      overview. stopPropagation so they don't trigger the
                      row's lead-detail link. */}
                  <td className="px-4 py-2.5 hidden sm:table-cell">
                    {lead.profile_id && lead.profile_name ? (
                      <Link
                        href={`/leads/ticket/${lead.profile_id}`}
                        onClick={(e) => e.stopPropagation()}
                        title={lead.profile_name}
                        className="text-[11px] font-medium hover:underline inline-flex items-center gap-1 max-w-[180px]"
                        style={{ color: gold }}
                      >
                        <Target size={9} className="shrink-0" />
                        <span className="truncate">{lead.profile_name}</span>
                      </Link>
                    ) : (
                      <span className="text-[10px]" style={{ color: C.textDim }}>—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {lead.campaign_id && lead.campaign_name ? (
                      <Link
                        href={`/campaigns/${lead.campaign_id}`}
                        onClick={(e) => e.stopPropagation()}
                        title={`${lead.campaign_name}${lead.campaign_status ? ` · ${lead.campaign_status}` : ""}`}
                        className="text-[11px] font-medium hover:underline inline-flex items-center gap-1 max-w-[200px]"
                        style={{ color: lead.campaign_status === "active" ? C.green : lead.campaign_status === "paused" ? "#D97706" : C.textBody }}
                      >
                        <Megaphone size={9} className="shrink-0" />
                        <span className="truncate">{lead.campaign_name}</span>
                      </Link>
                    ) : lead.has_campaign ? (
                      // Edge case: has_campaign true but server didn't
                      // attach the id (older data). Show a non-link
                      // active badge so we don't dead-link the cell.
                      <span className="text-[10px] font-semibold" style={{ color: C.green }}>{t("leadsPage.table.activeBadge")}</span>
                    ) : (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md" style={{ backgroundColor: "#FEF3C7", color: "#92400E" }}>{t("leadsPage.table.noCampaign")}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-[10px] font-semibold" style={{ color: replyColor }}>{replyLabel}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right relative">
                    <div className="flex items-center justify-end gap-1">
                      {/* Quick actions — invisible until the row is hovered.
                          On touch devices (no hover) they're not reachable;
                          fall back to opening the lead detail. */}
                      <div className="opacity-0 group-hover/lr:opacity-100 transition-opacity flex items-center gap-1">
                        {lead.phone && (
                          <a
                            href={`tel:${lead.phone}`}
                            title={t("leadsPage.table.callTitle", { phone: lead.phone })}
                            className="w-7 h-7 inline-flex items-center justify-center rounded-md transition-colors hover:bg-black/[0.05]"
                            style={{ color: "#F97316" }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Phone size={12} />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); quickTogglePriority(lead.id, lead.is_priority); }}
                          disabled={isUpdating}
                          title={lead.is_priority ? t("leadsPage.table.removeHot") : t("leadsPage.table.markHot")}
                          className="w-7 h-7 inline-flex items-center justify-center rounded-md transition-colors hover:bg-black/[0.05] disabled:opacity-50"
                          style={{ color: lead.is_priority ? gold : C.textDim }}
                        >
                          <Flame size={12} fill={lead.is_priority ? gold : "transparent"} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setOpenMenuId(menuOpen ? null : lead.id); }}
                          title={t("leadsPage.table.moreActions")}
                          className="w-7 h-7 inline-flex items-center justify-center rounded-md transition-colors hover:bg-black/[0.05]"
                          style={{ color: C.textMuted }}
                        >
                          <MoreHorizontal size={13} />
                        </button>
                      </div>
                      <Link href={`/leads/${lead.id}`} className="text-[10px] font-medium hover:underline ml-1" style={{ color: gold }}>
                        {t("leadsPage.table.view")}
                      </Link>
                    </div>
                    {menuOpen && (
                      <div
                        className="absolute right-2 top-full mt-1 z-30 rounded-lg border shadow-xl min-w-[180px] py-1"
                        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}
                        onMouseLeave={() => setOpenMenuId(null)}
                      >
                        <p className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>{t("leadsPage.table.changeStatus")}</p>
                        {[
                          { v: "new",         label: t("leadsPage.status.new") },
                          { v: "contacted",   label: t("leadsPage.status.contacted") },
                          { v: "connected",   label: t("leadsPage.status.connected") },
                          { v: "responded",   label: t("leadsPage.status.responded") },
                          { v: "qualified",   label: t("leadsPage.status.qualified") },
                          { v: "closed_won",  label: t("leadsPage.status.won") },
                          { v: "closed_lost", label: t("leadsPage.status.lost") },
                          { v: "nurturing",   label: t("leadsPage.status.nurturing") },
                        ].map(opt => (
                          <button
                            key={opt.v}
                            disabled={isUpdating || lead.status === opt.v}
                            onClick={() => quickChangeStatus(lead.id, opt.v)}
                            className="w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-black/[0.04] disabled:opacity-40"
                            style={{ color: lead.status === opt.v ? gold : C.textPrimary }}
                          >
                            {lead.status === opt.v ? "✓ " : ""}{opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {hasMore && (
          <div className="border-t px-4 py-2.5 text-center" style={{ borderColor: C.border, backgroundColor: C.bg }}>
            <button onClick={() => setShowCount(c => c + PAGE_SIZE)} className="text-xs font-medium hover:underline" style={{ color: gold }}>
              {t("leadsPage.table.showMore", { n: filtered.length - showCount })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Profile Card (ICP ticket) ───────────────────────────────────────────────
function ProfileCard({ group, t }: { group: ProfileGroup; t: Tr }) {
  const totalLeads    = group.leads.length;
  const campaignNames = [...new Set(group.campaigns.map(c => c.name))];
  const replyRate     = group.contactedCount > 0 ? Math.round((group.totalReplies / group.contactedCount) * 100) : 0;

  const contacted = group.contactedCount;
  const replied   = group.totalReplies;
  const positive  = group.positiveCount;
  const funnelMax = Math.max(contacted, 1);

  return (
    <Link
      href={`/leads/ticket/${group.profileId}`}
      className="rounded-xl border overflow-hidden flex flex-col card-lift group"
      style={{ backgroundColor: C.card, borderColor: C.border }}
    >
      <div className="px-4 pt-4 pb-3 flex-1">
        <div className="flex items-center gap-1.5 mb-2">
          <Target size={11} style={{ color: gold }} />
          <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: gold }}>{t("leadsPage.profile.leadMiner")}</span>
        </div>

        <h3 className="text-sm font-bold mb-0.5 group-hover:underline" style={{ color: C.textPrimary }}>
          {group.profileName}
        </h3>
        {campaignNames.length > 0 && (
          <p className="text-[10px] mb-3 line-clamp-1" style={{ color: C.textDim }}>
            {campaignNames.join(" · ")}
          </p>
        )}

        {/* Lead funnel */}
        <div className="space-y-1.5 mb-3">
          {[
            { label: t("leadsPage.profile.contacted"), value: contacted, color: C.blue },
            { label: t("leadsPage.profile.replied"),   value: replied,   color: gold },
            { label: t("leadsPage.profile.positive"),  value: positive,  color: C.green },
          ].map(row => (
            <div key={row.label} className="flex items-center gap-2">
              <span className="text-[10px] w-[70px] shrink-0" style={{ color: C.textMuted }}>{row.label}</span>
              <div className="flex-1 h-2 rounded-full" style={{ backgroundColor: C.border }}>
                <div className="h-2 rounded-full" style={{ width: `${(row.value / funnelMax) * 100}%`, backgroundColor: row.color }} />
              </div>
              <span className="text-[10px] font-bold w-6 text-right tabular-nums" style={{ color: row.color }}>{row.value}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 text-[10px]" style={{ color: C.textMuted }}>
          <span><span className="font-bold" style={{ color: C.textBody }}>{totalLeads}</span> {t("leadsPage.profile.leadsSuffix")}</span>
          <span><span className="font-bold" style={{ color: C.blue }}>{replyRate}%</span> {t("leadsPage.profile.replyRate")}</span>
          {group.hotCount > 0 && (
            <span className="font-bold" style={{ color: C.hot }}>🔥 {t("leadsPage.profile.hotCount", { n: group.hotCount })}</span>
          )}
        </div>
      </div>

      {/* Last reply */}
      <div className="px-4 py-2.5 border-t flex items-center gap-2"
        style={{ borderColor: C.border, backgroundColor: C.bg }}>
        {group.lastReply ? (
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[10px] font-semibold" style={{ color: C.textBody }}>{group.lastReply.leadName}</span>
              {classColors[group.lastReply.classification] && (
                <span className="text-[8px] font-bold px-1 py-0.5 rounded"
                  style={{ backgroundColor: classColors[group.lastReply.classification].bg, color: classColors[group.lastReply.classification].color }}>
                  {t(classColors[group.lastReply.classification].labelKey)}
                </span>
              )}
              <span className="text-[9px] ml-auto shrink-0" style={{ color: C.textDim }}>{timeAgo(group.lastReply.receivedAt, t)}</span>
            </div>
            {group.lastReply.text && (
              <p className="text-[10px] line-clamp-1" style={{ color: C.textDim }}>&ldquo;{group.lastReply.text}&rdquo;</p>
            )}
          </div>
        ) : (
          <span className="text-[10px]" style={{ color: C.textDim }}>{t("leadsPage.profile.noReplies")}</span>
        )}
        <ChevronRight size={13} style={{ color: C.textDim }} className="shrink-0 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
// "Add to existing flow" modal scoped to the /leads bulk-action surface.
// Fetches active + paused campaigns lazily on open via /api/campaigns
// (no extra prop drilling) and posts to /api/campaigns/[id]/add-leads —
// the same endpoint the Lead Miner ticket bulk-action uses.
function AddToFlowModalLeads({
  leadIds, icpProfileId, onClose, onAdded,
}: {
  leadIds: string[];
  /** ICP shared by every selected lead. Filters the flow list server-side
   * so the operator can't violate the one-ICP-per-campaign LAW from this
   * modal (the bulk popup already gates the entry point). */
  icpProfileId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<Array<{
    id: string; name: string; status: string; channel: string;
    sequence_steps: any[] | null; lead_count: number;
  }>>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Lazy-load on mount.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/active-list?icp=${encodeURIComponent(icpProfileId)}`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : { campaigns: [] })
      .then(data => { if (!cancelled) setCampaigns(Array.isArray(data.campaigns) ? data.campaigns : []); })
      .catch(() => { /* ignore — empty list */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [icpProfileId]);

  // Dedupe by flow name (a flow can have many campaign rows, one per
  // lead). Pick the most populous to attach against — the API resolves
  // tenant scope from any of the rows.
  const flowsByName: Record<string, { id: string; name: string; channel: string; sequence_steps: any[] | null; total: number; active: number }> = {};
  for (const c of campaigns) {
    if (!flowsByName[c.name]) flowsByName[c.name] = { id: c.id, name: c.name, channel: c.channel, sequence_steps: c.sequence_steps, total: 0, active: 0 };
    flowsByName[c.name].total++;
    if (c.status === "active" || c.status === "paused") flowsByName[c.name].active++;
  }
  const flows = Object.values(flowsByName).filter(f => f.active > 0).sort((a, b) => b.active - a.active);

  async function submit() {
    if (!pickedId || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${pickedId}/add-leads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadIds }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.show({ kind: "error", title: t("leadsPage.addToFlow.toast.failed"), description: json.error ?? t("leadsPage.bulk.toast.statusFailedDesc") });
        return;
      }
      toast.show({ kind: "success", title: t("leadsPage.addToFlow.toast.added", { n: json.added ?? leadIds.length }) });
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border overflow-hidden"
        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between border-b" style={{ borderColor: C.border }}>
          <div>
            <h3 className="text-base font-bold" style={{ color: C.textPrimary }}>{t("leadsPage.addToFlow.title")}</h3>
            <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
              {t(leadIds.length === 1 ? "leadsPage.addToFlow.descLead" : "leadsPage.addToFlow.descLeads", { n: leadIds.length })}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-black/[0.04]">
            <X size={14} style={{ color: C.textDim }} />
          </button>
        </div>

        <div className="p-5 space-y-2 max-h-[50vh] overflow-y-auto">
          {loading ? (
            <p className="text-sm py-6 text-center" style={{ color: C.textMuted }}>{t("leadsPage.addToFlow.loading")}</p>
          ) : flows.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: C.textMuted }}>
              {t("leadsPage.addToFlow.emptyHint")}
            </p>
          ) : flows.map(f => {
            const picked = pickedId === f.id;
            const steps = Array.isArray(f.sequence_steps) ? f.sequence_steps.length : 0;
            return (
              <button key={f.id}
                onClick={() => setPickedId(f.id)}
                className="w-full text-left rounded-xl border px-4 py-3 transition-[border-color,background-color]"
                style={{
                  borderColor: picked ? gold : C.border,
                  backgroundColor: picked ? `color-mix(in srgb, ${gold} 8%, transparent)` : C.bg,
                }}>
                <div className="flex items-center gap-2 mb-1">
                  <Megaphone size={11} style={{ color: gold }} />
                  <span className="text-[13px] font-semibold flex-1 truncate" style={{ color: C.textPrimary }}>{f.name}</span>
                  {picked && <CheckSquare size={13} style={{ color: gold }} />}
                </div>
                <p className="text-[11px]" style={{ color: C.textMuted }}>
                  {steps > 0
                    ? t("leadsPage.addToFlow.flowMetaSteps", { leads: f.total, channel: f.channel, steps })
                    : t("leadsPage.addToFlow.flowMeta",      { leads: f.total, channel: f.channel })}
                </p>
              </button>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-end gap-2" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          <button onClick={onClose}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border"
            style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.card }}>
            {t("leadsPage.addToFlow.cancel")}
          </button>
          <button onClick={submit}
            disabled={!pickedId || busy || flows.length === 0}
            className="text-xs font-bold px-3 py-1.5 rounded-lg transition-opacity disabled:opacity-50"
            style={{ backgroundColor: gold, color: "#1A1A2E" }}>
            {busy
              ? t("leadsPage.addToFlow.adding")
              : t(leadIds.length === 1 ? "leadsPage.addToFlow.addN" : "leadsPage.addToFlow.addNPlural", { n: leadIds.length })}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LeadsCampaignsClient({ profileGroups, allLeads, lostLeads, renurturingLeads, wonLeads, companies, stats, totalLeadCount }: Props) {
  const { t } = useLocale();
  // Boss feedback 2026-05-27 (Leads rework):
  //   - Companies is a top-level tab (was sub-toggle inside All Leads).
  //   - Lead sub-tabs are FLAT (no "Results" wrapper): All / Without
  //     Campaign / In flow.
  // Campaigns tab removed 2026-05-28 — campaign management lives at
  // `/campaigns` (Outreach Flow page) now; the in-page Campaigns view
  // duplicated that surface and was unused.
  // `?view=companies` lands directly on the Companies sub-tab — used by
  // the back breadcrumb on /companies/[name] so the operator returns to
  // where they came from (boss back-button audit 2026-05-29).
  const sp = useSearchParams();
  const initialMainView = sp?.get("view") === "companies" ? "companies" : "leads";
  const [mainView, setMainView] = useState<"leads" | "companies">(initialMainView);
  // Status chips trimmed to the three pipeline-membership states only.
  // Won/Lost/Re-nurture live in /results; Hot/Replied/Positive are
  // facets in the filter bar (Score + Reply), not top-level navigation
  // (boss feedback 2026-05-28 round 2: "saca hot de ahi, ponelo abajo").
  type LeadSubTab = "all" | "without_campaign" | "with_campaign";
  const [leadSubTab, setLeadSubTab] = useState<LeadSubTab>("all");

  // Leads without an active campaign — derived once. The legacy "All Leads"
  // view already exposes this via the saved-view chip "Without Campaign",
  // but elevating it to a first-class sub-tab matches how the boss thinks
  // about queue work ("who do I still need to schedule?").
  const leadsWithoutCampaign = allLeads.filter(l => !l.has_campaign);

  // Truncation banner — render only when the loaded set was capped (see
  // app/leads/page.tsx hard 500 limit). Hides itself otherwise.
  const truncated = typeof totalLeadCount === "number" && totalLeadCount > allLeads.length;

  return (
    // w-full on the root + every view wrapper below — fixes the layout shift
    // when toggling Leads ↔ Campaigns. Previously the Campaigns grid sized to
    // its content (3 cards × ~360px) and felt narrower than the Leads table
    // (which already had `w-full` on the <table>). Locking everything to
    // 100% of the parent keeps the visual frame steady.
    <div className="w-full">
      {truncated && (
        <div
          className="mb-4 px-4 py-3 rounded-xl border flex items-center gap-3 flex-wrap"
          style={{
            backgroundColor: `color-mix(in srgb, ${gold} 8%, ${C.card})`,
            borderColor: `color-mix(in srgb, ${gold} 35%, ${C.border})`,
          }}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `color-mix(in srgb, ${gold} 18%, transparent)`, color: gold }}
          >
            <span className="text-[11px] font-bold">!</span>
          </div>
          <p className="text-[13px] flex-1 min-w-0" style={{ color: C.textPrimary }}>
            Showing <strong>{allLeads.length.toLocaleString()}</strong> of <strong>{totalLeadCount!.toLocaleString()}</strong> leads.
            <span className="ml-1" style={{ color: C.textMuted }}>
              Filter by ICP or status above to narrow the view, or use Import / Export to handle the full set.
            </span>
          </p>
        </div>
      )}

      {/* Stat strip — compacted 2026-05-28. PageHero already renders these
          four metrics in its prominent stats row; this client-side bar
          stays as a secondary "always-visible" reminder for sellers who
          scroll past the hero, but the chrome is much smaller (single row,
          half the vertical space) so it doesn't compete with the chips
          below. */}
      <div
        className="flex items-center gap-4 mb-4 px-4 py-2 rounded-xl border flex-wrap"
        style={{
          backgroundColor: C.card,
          borderColor: C.border,
        }}
      >
        {[
          { label: t("leadsPage.stats.totalLeads"),       value: stats.totalLeads,         color: C.textBody },
          { label: t("leadsPage.stats.activeFlows"),      value: stats.activeCampaigns,    color: gold },
          { label: t("leadsPage.stats.responseRate"),     value: `${stats.responseRate}%`, color: C.blue },
          { label: t("leadsPage.stats.positiveReplies"), value: stats.positiveReplies,    color: C.green },
        ].map((s, i, arr) => (
          <div key={s.label} className="flex items-center gap-3">
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-base font-bold tabular-nums"
                style={{
                  color: s.color,
                  fontFamily: "var(--font-outfit), system-ui, sans-serif",
                  letterSpacing: "-0.01em",
                }}
              >
                {s.value}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.06em]" style={{ color: C.textMuted }}>{s.label}</span>
            </div>
            {i < arr.length - 1 && <div className="h-4 w-px" style={{ backgroundColor: C.border }} />}
          </div>
        ))}
      </div>

      {/* ═══ Main view toggle: Leads / Companies ═══
          Campaigns tab removed 2026-05-28 — campaign management lives
          at `/campaigns` (Outreach Flow page); the in-page Campaigns
          view duplicated that surface and was redundant. */}
      <div className="flex items-center gap-1.5 mb-5">
        {([
          { key: "leads" as const,     label: t("leadsPage.topTab.leads"),     icon: UsersIcon, count: allLeads.length },
          { key: "companies" as const, label: t("leadsPage.topTab.companies"), icon: Building2, count: companies.length },
        ]).map(v => {
          const isActive = mainView === v.key;
          const Icon = v.icon;
          return (
            <button
              key={v.key}
              onClick={() => setMainView(v.key)}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-[opacity,transform,box-shadow,background-color,border-color] duration-150 hover:opacity-95 inline-flex items-center gap-2"
              style={{
                background: isActive ? `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 80%, white))` : C.card,
                color: isActive ? "#04070d" : C.textBody,
                border: `1px solid ${isActive ? "transparent" : C.border}`,
                boxShadow: isActive ? `0 4px 16px color-mix(in srgb, ${gold} 28%, transparent)` : "none",
              }}
            >
              <Icon size={13} />
              {v.label}
              <span
                className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: isActive ? "rgba(4,7,13,0.14)" : C.cardHov,
                  color: isActive ? "#04070d" : C.textDim,
                }}
              >
                {v.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ═══ LEADS VIEW — single Status chip group consolidates the old
          5 sub-tabs + the 6 saved-views into one navigation row above the
          table. Each chip either filters the AllLeadsTable (Hot, Replied,
          Positive, In flow, Without flow) or swaps to a specialized card
          renderer (Won, Lost, Nurture). The filter bar below is plegable
          for advanced facets (ICP, Role, Industry, Search). Boss feedback
          2026-05-28: "muchos filtros y secciones — organizarlo mejor". */}
      {mainView === "leads" && (
        <div>
          {/* Status chips — primary navigation inside Leads. Brand-tinted
              for the active chip; the count comes from the un-searched
              lead pool so it stays meaningful when filters change. */}
          <div className="flex items-center gap-1.5 mb-4 flex-wrap">
            {(() => {
              const chips: Array<{
                key: typeof leadSubTab;
                label: string;
                count: number;
                color: string;
              }> = [
                { key: "all",              label: t("leadsPage.chip.all"),         count: allLeads.length,                                color: gold },
                { key: "without_campaign", label: t("leadsPage.chip.withoutFlow"), count: leadsWithoutCampaign.length,                    color: gold },
                { key: "with_campaign",    label: t("leadsPage.chip.inFlow"),      count: allLeads.filter(l => l.has_campaign).length,    color: gold },
              ];
              return chips.map(chip => {
                const isActive = leadSubTab === chip.key;
                return (
                  <button
                    key={chip.key}
                    onClick={() => setLeadSubTab(chip.key)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-[opacity,background-color]"
                    style={{
                      backgroundColor: isActive ? `color-mix(in srgb, ${chip.color} 14%, transparent)` : C.card,
                      borderColor:     isActive ? `color-mix(in srgb, ${chip.color} 45%, transparent)` : C.border,
                      color:           isActive ? chip.color : C.textBody,
                    }}
                  >
                    {chip.label}
                    <span
                      className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full"
                      style={{
                        backgroundColor: isActive ? chip.color : C.surface,
                        color:           isActive ? "#fff"  : C.textDim,
                      }}
                    >
                      {chip.count}
                    </span>
                  </button>
                );
              });
            })()}
          </div>

          {/* Render — the table-backed chips share AllLeadsTable so the
              filter bar + bulk actions + per-row menu carry over for free.
              Won / Lost / Nurture keep their card-grid renderers since
              they encode outcome-specific UX (winning reply quote, recover
              button, re-nurture badge). */}
          {leadSubTab === "all"              && <AllLeadsTable leads={allLeads} />}
          {leadSubTab === "without_campaign" && <AllLeadsTable leads={leadsWithoutCampaign} />}
          {leadSubTab === "with_campaign"    && <AllLeadsTable leads={allLeads.filter(l => l.has_campaign)} />}
        </div>
      )}

      {/* ═══ COMPANIES VIEW (top-level) ═══ */}
      {mainView === "companies" && (
        <div>
          <CompaniesGrid companies={companies} />
        </div>
      )}
    </div>
  );
}
