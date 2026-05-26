"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import {
  Megaphone, ChevronRight, Target,
  Search, X, CheckCircle, Star, RefreshCw, Trash2, Square, CheckSquare,
  Phone, MoreHorizontal, Mail, Flame,
  Building2, Users as UsersIcon, MapPin, Globe, MessageCircle, ThumbsUp, Trophy,
} from "lucide-react";
import { LeadFilterBar, type LeadFilterState } from "@/components/LeadFilters";
import OpportunitiesTable, { type OpportunityLead } from "@/components/OpportunitiesTable";
import { useToast } from "@/lib/toast";

const gold = "var(--brand, #c9a83a)";

type LeadInfo = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  score: number | null;
  is_priority: boolean;
  channel: string | null;
  reply_count?: number;
  has_positive?: boolean;
  has_campaign?: boolean;
  profile_name?: string | null;
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

type LostLead = {
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

type RenurturingLead = LostLead & {
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

function timeAgo(iso: string | null) {
  if (!iso) return null;
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1)  return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const classColors: Record<string, { color: string; bg: string; label: string }> = {
  positive:       { color: C.green,   bg: C.greenLight, label: "Positive" },
  meeting_intent: { color: C.green,   bg: C.greenLight, label: "Meeting" },
  negative:       { color: C.red,     bg: C.redLight,   label: "Negative" },
  question:       { color: "#D97706", bg: "#FFFBEB",    label: "Question" },
};

// ─── Lost Lead Card (detailed report style) ──────────────────────────────────
function LostLeadCard({ lead, selected, onToggle }: { lead: LostLead; selected: boolean; onToggle: (id: string) => void }) {
  const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unknown";
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
          {selected ? "Selected" : "Select"}
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
              Negative Reply
            </span>
          ) : (
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-md shrink-0" style={{ backgroundColor: C.surface, color: C.textMuted }}>
              No Reply
            </span>
          )}
        </div>

        {/* Reply text (if negative) */}
        {lead.reply_text && (
          <div className="rounded-lg px-3 py-2.5 mb-3 border" style={{ backgroundColor: C.redLight, borderColor: C.red + "20" }}>
            <p className="text-[10px] font-semibold mb-0.5" style={{ color: C.red }}>Their response:</p>
            <p className="text-xs leading-relaxed" style={{ color: C.textBody }}>&ldquo;{lead.reply_text}&rdquo;</p>
            {lead.reply_date && (
              <p className="text-[9px] mt-1" style={{ color: C.textDim }}>{timeAgo(lead.reply_date)}</p>
            )}
          </div>
        )}

        {/* Campaign details */}
        <div className="rounded-lg px-3 py-2.5 border" style={{ backgroundColor: C.bg, borderColor: C.border }}>
          <div className="flex items-center gap-4 text-[10px] flex-wrap" style={{ color: C.textMuted }}>
            {lead.campaign_name && (
              <span><span className="font-semibold" style={{ color: C.textBody }}>Campaign:</span> {lead.campaign_name}</span>
            )}
            {lead.profile_name && (
              <span><span className="font-semibold" style={{ color: C.textBody }}>Profile:</span> {lead.profile_name}</span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px]" style={{ color: C.textDim }}>
            <span>Steps: <span className="font-bold" style={{ color: C.textBody }}>{lead.steps_completed}/{lead.steps_total}</span></span>
            {lead.messages_sent > 0 && (
              <span>Messages sent: <span className="font-bold" style={{ color: C.textBody }}>{lead.messages_sent}</span></span>
            )}
            <span>Channels: <span className="font-bold" style={{ color: C.textBody }}>{lead.channels.join(", ") || "—"}</span></span>
          </div>
          {/* Progress bar */}
          <div className="flex items-center gap-2 mt-2">
            <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: C.border }}>
              <div className="h-1.5 rounded-full" style={{ width: `${progress}%`, backgroundColor: C.textMuted }} />
            </div>
            <span className="text-[9px] tabular-nums" style={{ color: C.textDim }}>{progress}% completed</span>
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
          Renurture — Create New Campaign
        </Link>
      </div>
    </div>
  );
}

// ─── Re-nurturing Lead Card ───────────────────────────────────────────────────
function RenurturingLeadCard({ lead }: { lead: RenurturingLead }) {
  const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unknown";
  const badge = scoreBadge(lead.score, lead.is_priority);
  const isPendingReview = lead.new_campaign_status === "pending_review";
  const newProgress = lead.new_campaign_total_steps && lead.new_campaign_step != null
    ? Math.round((lead.new_campaign_step / lead.new_campaign_total_steps) * 100)
    : 0;

  const statusLabel = isPendingReview ? "Pending Approval"
    : lead.new_campaign_status === "approved" || lead.new_campaign_status === "active" ? "Running"
    : lead.new_campaign_status === "paused" ? "Paused"
    : lead.new_campaign_status === "cancelled" ? "Cancelled"
    : lead.new_campaign_status ?? "Active";
  const statusColor = isPendingReview ? "#D97706"
    : lead.new_campaign_status === "cancelled" ? C.red
    : lead.new_campaign_status === "paused" ? "#D97706" : C.green;
  const statusBg = isPendingReview ? "#FFFBEB"
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
            <p className="text-[10px] font-semibold mb-0.5" style={{ color: C.red }}>Previous response:</p>
            <p className="text-xs leading-relaxed" style={{ color: C.textBody }}>&ldquo;{lead.reply_text}&rdquo;</p>
            {lead.reply_date && (
              <p className="text-[9px] mt-1" style={{ color: C.textDim }}>{timeAgo(lead.reply_date)}</p>
            )}
          </div>
        )}

        {/* New campaign info */}
        <div className="rounded-lg px-3 py-2.5 border" style={{ backgroundColor: C.greenLight + "80", borderColor: C.green + "30" }}>
          <p className="text-[10px] font-semibold mb-1.5" style={{ color: C.green }}>New Campaign</p>
          <div className="flex items-center gap-3 text-[10px] flex-wrap mb-1" style={{ color: C.textMuted }}>
            {lead.new_campaign_name && (
              <span><span className="font-semibold" style={{ color: C.textBody }}>{lead.new_campaign_name}</span></span>
            )}
            {lead.profile_name && (
              <span>Profile: <span className="font-semibold" style={{ color: C.textBody }}>{lead.profile_name}</span></span>
            )}
          </div>
          {!isPendingReview && lead.new_campaign_step != null && lead.new_campaign_total_steps != null && (
            <div className="flex items-center gap-2 mt-1.5">
              <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: C.border }}>
                <div className="h-1.5 rounded-full" style={{ width: `${newProgress}%`, backgroundColor: C.green }} />
              </div>
              <span className="text-[9px] tabular-nums" style={{ color: C.textDim }}>
                {lead.new_campaign_step}/{lead.new_campaign_total_steps} steps
              </span>
            </div>
          )}
          {isPendingReview && (
            <p className="text-[10px]" style={{ color: "#D97706" }}>Awaiting admin approval before launch</p>
          )}
        </div>
      </Link>
    </div>
  );
}

// ─── Re-nurturing View ────────────────────────────────────────────────────────
function RenurturingView({ leads }: { leads: RenurturingLead[] }) {
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
        <p className="text-sm font-medium" style={{ color: C.textBody }}>No re-nurturing leads</p>
        <p className="text-xs mt-1" style={{ color: C.textMuted }}>Leads you start a new campaign for will appear here.</p>
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
            placeholder="Search re-nurturing leads..." className="bg-transparent text-sm outline-none flex-1" style={{ color: C.textPrimary }} />
          {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
        </div>
        <span className="text-xs" style={{ color: C.textMuted }}>{filtered.length} results</span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {filtered.map(l => <RenurturingLeadCard key={l.id} lead={l} />)}
      </div>
    </div>
  );
}

// ─── Lost Leads View ──────────────────────────────────────────────────────────
function LostLeadsView({ leads }: { leads: LostLead[] }) {
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
    if (!window.confirm(`Delete ${selected.size} lead${selected.size > 1 ? "s" : ""} permanently? This cannot be undone.`)) return;
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
      const { error } = await res.json().catch(() => ({ error: "Delete failed" }));
      window.alert(`Delete failed: ${error}`);
    }
    setDeleting(false);
    setSelected(new Set());
    window.location.reload();
  }

  async function recoverSelected() {
    const n = selected.size;
    if (!window.confirm(`Recover ${n} lead${n > 1 ? "s" : ""}? Their finished campaigns will be archived (kept for history) and the lead becomes contactable again. You'll be able to add them to a new campaign.`)) return;
    setRecovering(true);
    const ids = [...selected];
    const res = await fetch("/api/leads/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadIds: ids }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Recover failed" }));
      setRecovering(false);
      window.alert(`Recover failed: ${error}`);
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
        <p className="text-sm font-medium" style={{ color: C.textBody }}>No lost leads</p>
        <p className="text-xs mt-1" style={{ color: C.textMuted }}>Leads that don't respond or reply negatively will appear here for future re-engagement.</p>
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
            placeholder="Search lost leads..." className="bg-transparent text-sm outline-none flex-1" style={{ color: C.textPrimary }} />
          {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
        </div>
        <div className="flex items-center gap-1 rounded-lg border p-0.5" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          {[
            { key: "all",      label: `All (${leads.length})` },
            { key: "negative", label: `Negative (${negativeCount})` },
            { key: "no_reply", label: `No Reply (${noReplyCount})` },
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
        <span className="text-xs" style={{ color: C.textMuted }}>{filtered.length} results</span>

        {/* Select all + delete toolbar */}
        <button onClick={toggleAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-semibold transition-colors"
          style={{ borderColor: C.border, backgroundColor: C.card, color: allSelected ? C.textPrimary : C.textMuted }}>
          {allSelected ? <CheckSquare size={12} /> : <Square size={12} />}
          {allSelected ? "Deselect all" : "Select all"}
        </button>

        {selected.size > 0 && (
          <>
            <button onClick={recoverSelected} disabled={recovering || deleting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-[opacity,transform,box-shadow,background-color,border-color]"
              style={{ backgroundColor: gold, color: "#04070d", opacity: (recovering || deleting) ? 0.6 : 1 }}
              title="Mark these leads as contactable again so you can add them to a new campaign">
              <RefreshCw size={12} className={recovering ? "animate-spin" : ""} />
              {recovering ? "Recovering…" : `Recover ${selected.size} lead${selected.size > 1 ? "s" : ""}`}
            </button>
            <button onClick={deleteSelected} disabled={deleting || recovering}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-[opacity,transform,box-shadow,background-color,border-color]"
              style={{ backgroundColor: C.red, color: "#fff", opacity: (deleting || recovering) ? 0.6 : 1 }}>
              <Trash2 size={12} />
              {deleting ? "Deleting…" : `Delete ${selected.size} lead${selected.size > 1 ? "s" : ""}`}
            </button>
          </>
        )}
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {filtered.map(l => <LostLeadCard key={l.id} lead={l} selected={selected.has(l.id)} onToggle={toggleOne} />)}
      </div>
    </div>
  );
}

// ─── Companies Grid ─────────────────────────────────────────────────────────
// Aggregated company-level view of the same `allLeads` set, one card per
// distinct company_name. Each card links to /companies/[name] which has the
// existing detail page (contacts, activity, intel).
function CompaniesGrid({ companies }: { companies: CompanyInfo[] }) {
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
          placeholder="Search company, industry, city…"
          className="bg-transparent text-sm outline-none flex-1"
          style={{ color: C.textPrimary }}
        />
        {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <Building2 size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
          <p className="text-sm font-medium" style={{ color: C.textBody }}>
            {search ? "No companies match your search" : "No companies yet"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(c => <CompanyCard key={c.name} company={c} />)}
        </div>
      )}
    </div>
  );
}

function CompanyCard({ company }: { company: CompanyInfo }) {
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
            <span style={{ color: C.textMuted }}>{company.leadCount === 1 ? "lead" : "leads"}</span>
          </span>
          {company.contactedCount > 0 && (
            <span className="flex items-center gap-1" style={{ color: C.textBody }}>
              <MessageCircle size={11} style={{ color: C.blue }} />
              <span className="font-semibold tabular-nums">{company.contactedCount}</span>
              <span style={{ color: C.textMuted }}>contacted</span>
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
              <Globe size={9} /> site
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

// ─── All Leads Table with Filters ─────────────────────────────────────────────
const PAGE_SIZE = 25;

// Saved views — Linear-style preset filter tabs. Each "view" is a named
// LeadFilterState that becomes a one-click tab above the main filter bar.
// Stored statically here (no DB yet) because the set is small and changing
// across releases anyway; a future iteration can persist per-user.
const SAVED_VIEWS: { id: string; label: string; filters: Partial<LeadFilterState>; predicate?: (l: LeadInfo) => boolean }[] = [
  { id: "all",        label: "All",                filters: {} },
  { id: "hot",        label: "Hot only",           filters: { score: "hot" } },
  { id: "positives",  label: "Positive replies",   filters: { reply: "positive" } },
  { id: "replied",    label: "Replied",            filters: { reply: "replied" } },
  { id: "noresponse", label: "No response yet",    filters: { reply: "none", campaign: "yes" } },
  { id: "uncampaigned", label: "Not in a flow",    filters: { campaign: "no" } },
];

function AllLeadsTable({ leads }: { leads: LeadInfo[] }) {
  const router = useRouter();
  const toast = useToast();
  const [showCount, setShowCount] = useState(PAGE_SIZE);
  const [filters, setFilters] = useState<LeadFilterState>({ search: "", score: "all", campaign: "all", reply: "all", profile: "all" });
  const [activeView, setActiveView] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Inline per-row actions menu state. Only one row's menu is open at a time.
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [rowUpdating, setRowUpdating] = useState<string | null>(null);

  const profileNames = [...new Set(leads.map(l => l.profile_name).filter(Boolean))] as string[];

  function applyView(viewId: string) {
    const v = SAVED_VIEWS.find(x => x.id === viewId);
    if (!v) return;
    // Reset to neutral state and overlay the view's partial filter.
    setFilters({ search: filters.search, score: "all", campaign: "all", reply: "all", profile: "all", ...v.filters });
    setActiveView(viewId);
    setShowCount(PAGE_SIZE);
    setSelected(new Set());
  }

  // Pre-compute per-view counts (ignoring search) so the chips show their
  // populated counts up-front and the user can see at a glance where the
  // pipeline pressure is.
  const viewCounts = SAVED_VIEWS.map(v => {
    const f = { search: "", score: "all", campaign: "all", reply: "all", profile: "all", ...v.filters } as LeadFilterState;
    const count = leads.filter(l => {
      if (f.score === "hot" && !(l.is_priority || (l.score && l.score >= 80))) return false;
      if (f.score === "warm" && !(l.score && l.score >= 50 && l.score < 80 && !l.is_priority)) return false;
      if (f.score === "nurture" && !(!l.score || l.score < 50) && !l.is_priority) return false;
      if (f.reply === "replied" && !(l.reply_count && l.reply_count > 0)) return false;
      if (f.reply === "positive" && !l.has_positive) return false;
      if (f.reply === "none" && (l.reply_count ?? 0) > 0) return false;
      if (f.campaign === "yes" && !l.has_campaign) return false;
      if (f.campaign === "no" && l.has_campaign) return false;
      return true;
    }).length;
    return { ...v, count };
  });

  const filtered = leads.filter(l => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!`${l.first_name} ${l.last_name} ${l.company} ${l.email}`.toLowerCase().includes(q)) return false;
    }
    if (filters.score === "hot" && !(l.is_priority || (l.score && l.score >= 80))) return false;
    if (filters.score === "warm" && !(l.score && l.score >= 50 && l.score < 80 && !l.is_priority)) return false;
    if (filters.score === "nurture" && !(!l.score || l.score < 50) && !l.is_priority) return false;
    if (filters.reply === "replied" && !(l.reply_count && l.reply_count > 0)) return false;
    if (filters.reply === "positive" && !l.has_positive) return false;
    if (filters.reply === "none" && (l.reply_count ?? 0) > 0) return false;
    if (filters.campaign === "yes" && !l.has_campaign) return false;
    if (filters.campaign === "no" && l.has_campaign) return false;
    if (filters.profile !== "all" && l.profile_name !== filters.profile) return false;
    return true;
  });

  const visible = filtered.slice(0, showCount);
  const hasMore = showCount < filtered.length;

  const visibleIds = visible.map(v => v.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));

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
        toast.show({ kind: "error", title: "Couldn't update status", description: error || "Try again." });
        return;
      }
      toast.show({ kind: "success", title: `Status → ${status}` });
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
        toast.show({ kind: "warning", title: "Mark hot endpoint pending", description: "Will be wired in the next backend pass." });
        return;
      }
      toast.show({ kind: "success", title: !current ? "Marked hot 🔥" : "Removed hot flag" });
      router.refresh();
    } finally {
      setRowUpdating(null);
    }
  }
  function toggleAllVisible() {
    setSelected(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach(id => next.delete(id));
      else visibleIds.forEach(id => next.add(id));
      return next;
    });
  }
  async function bulkDelete() {
    if (selected.size === 0 || deleting) return;
    if (!confirm(`Delete ${selected.size} lead${selected.size === 1 ? "" : "s"}? This will cascade-remove their campaigns, messages, replies and notes. This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/leads/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Delete failed" }));
        toast.show({ kind: "error", title: "Couldn't delete leads", description: error || "Try again in a moment." });
        return;
      }
      toast.show({ kind: "success", title: `Deleted ${selected.size} lead${selected.size === 1 ? "" : "s"}` });
      setSelected(new Set());
      router.refresh();
    } finally {
      setDeleting(false);
    }
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
        toast.show({ kind: "error", title: "Couldn't update status", description: error || "Try again in a moment." });
        return;
      }
      const data = await res.json().catch(() => ({ updated: selectedIds.length })) as { updated?: number };
      const updatedCount = data.updated ?? selectedIds.length;
      toast.show({
        kind: "success",
        title: `Updated ${updatedCount} lead${updatedCount === 1 ? "" : "s"} → ${status}`,
        action: {
          label: "Undo",
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
            toast.show({ kind: "info", title: "Status change undone" });
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
      {/* Saved views — quick-access preset filter tabs. Click switches to that
          view; counts update from the un-searched lead pool so the user can
          see where to look without typing. Label above hints at the chip
          purpose so first-time users notice them. */}
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-1.5" style={{ color: C.textMuted }}>
        Quick filters
      </p>
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {viewCounts.map(v => {
          const isActive = activeView === v.id;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => applyView(v.id)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border transition-[opacity,background-color]"
              style={{
                backgroundColor: isActive
                  ? `color-mix(in srgb, ${gold} 16%, transparent)`
                  : C.card,
                borderColor: isActive
                  ? `color-mix(in srgb, ${gold} 50%, transparent)`
                  : C.border,
                color: isActive ? gold : C.textBody,
              }}
            >
              {v.label}
              <span
                className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: isActive ? gold : C.surface,
                  color: isActive ? "#04070d" : C.textDim,
                }}
              >
                {v.count}
              </span>
            </button>
          );
        })}
      </div>

      <LeadFilterBar
        filters={filters}
        onChange={f => {
          setFilters(f);
          setShowCount(PAGE_SIZE);
          // Touching the manual filter bar drops the user out of any preset
          // view so the chip highlight doesn't lie about the active state.
          setActiveView("custom");
        }}
        resultCount={filtered.length}
        totalCount={leads.length}
        profileNames={profileNames}
      />

      {selected.size > 0 && (
        <div className="mb-3 rounded-xl border flex items-center justify-between px-4 py-2.5 gap-3 flex-wrap"
          style={{ backgroundColor: `color-mix(in srgb, ${gold} 9%, ${C.card})`, borderColor: `color-mix(in srgb, ${gold} 35%, ${C.border})` }}>
          <span className="text-xs font-semibold" style={{ color: C.textPrimary }}>
            <span style={{ color: gold }}>{selected.size}</span> lead{selected.size === 1 ? "" : "s"} selected
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Status change dropdown — uses native select so it inherits OS
                styling on each platform; the wrapper styles it like a button. */}
            <label className="relative inline-flex items-center">
              <select
                disabled={deleting}
                onChange={e => {
                  const v = e.target.value;
                  e.target.value = ""; // reset so re-picking the same status fires again
                  if (v) void bulkChangeStatus(v);
                }}
                defaultValue=""
                className="appearance-none text-xs font-semibold px-3 py-1.5 pr-7 rounded-lg border cursor-pointer disabled:opacity-50"
                style={{
                  backgroundColor: C.card,
                  borderColor: C.border,
                  color: C.textPrimary,
                }}
              >
                <option value="" disabled>Change status…</option>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="connected">Connected</option>
                <option value="responded">Responded</option>
                <option value="qualified">Qualified</option>
                <option value="proposal_sent">Proposal</option>
                <option value="closed_won">Won</option>
                <option value="closed_lost">Lost</option>
                <option value="nurturing">Nurturing</option>
              </select>
              <ChevronRight size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none rotate-90" style={{ color: C.textMuted }} />
            </label>
            <button onClick={() => setSelected(new Set())} disabled={deleting}
              className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-black/[0.04] disabled:opacity-50"
              style={{ color: C.textMuted }}>
              Clear
            </button>
            <button onClick={bulkDelete} disabled={deleting}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-[opacity,transform,box-shadow,background-color,border-color] disabled:opacity-50"
              style={{ backgroundColor: "#DC2626", color: "#fff" }}>
              {deleting ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
              {deleting ? "Working…" : `Delete ${selected.size}`}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border overflow-hidden card-shadow" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <table className="w-full text-left">
          <thead>
            <tr style={{ backgroundColor: C.bg }}>
              <th className="px-3 py-2.5 w-8">
                <button onClick={toggleAllVisible} className="block" aria-label="Select all visible">
                  {allVisibleSelected ? <CheckSquare size={14} style={{ color: gold }} /> : <Square size={14} style={{ color: C.textDim }} />}
                </button>
              </th>
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Lead</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider hidden md:table-cell" style={{ color: C.textMuted }}>Company</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider hidden lg:table-cell" style={{ color: C.textMuted }}>Role</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-center" style={{ color: C.textMuted }}>Score</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider hidden sm:table-cell" style={{ color: C.textMuted }}>Profile</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Campaign</th>
              <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Reply</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-sm" style={{ color: C.textDim }}>No leads match your filters</td></tr>
            ) : visible.map(lead => {
              const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "Unknown";
              const badge = scoreBadge(lead.score, lead.is_priority);
              const hasReply = (lead.reply_count ?? 0) > 0;
              const replyColor = lead.has_positive ? C.green : hasReply ? "#D97706" : C.textDim;
              const replyLabel = lead.has_positive ? "Positive" : hasReply ? "Replied" : "—";
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
                      aria-label="Select lead"
                      title="Shift-click to select range"
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
                  <td className="px-4 py-2.5 hidden sm:table-cell">
                    <span className="text-[10px] truncate block max-w-[120px]" style={{ color: C.textDim }}>{lead.profile_name ?? "—"}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    {lead.has_campaign ? (
                      <span className="text-[10px] font-semibold" style={{ color: C.green }}>Active</span>
                    ) : (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md" style={{ backgroundColor: "#FEF3C7", color: "#92400E" }}>No Campaign</span>
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
                            title={`Call ${lead.phone}`}
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
                          title={lead.is_priority ? "Remove hot flag" : "Mark as hot"}
                          className="w-7 h-7 inline-flex items-center justify-center rounded-md transition-colors hover:bg-black/[0.05] disabled:opacity-50"
                          style={{ color: lead.is_priority ? gold : C.textDim }}
                        >
                          <Flame size={12} fill={lead.is_priority ? gold : "transparent"} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setOpenMenuId(menuOpen ? null : lead.id); }}
                          title="More actions"
                          className="w-7 h-7 inline-flex items-center justify-center rounded-md transition-colors hover:bg-black/[0.05]"
                          style={{ color: C.textMuted }}
                        >
                          <MoreHorizontal size={13} />
                        </button>
                      </div>
                      <Link href={`/leads/${lead.id}`} className="text-[10px] font-medium hover:underline ml-1" style={{ color: gold }}>
                        View
                      </Link>
                    </div>
                    {menuOpen && (
                      <div
                        className="absolute right-2 top-full mt-1 z-30 rounded-lg border shadow-xl min-w-[180px] py-1"
                        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}
                        onMouseLeave={() => setOpenMenuId(null)}
                      >
                        <p className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>Change status</p>
                        {[
                          { v: "new", label: "New" },
                          { v: "contacted", label: "Contacted" },
                          { v: "connected", label: "Connected" },
                          { v: "responded", label: "Responded" },
                          { v: "qualified", label: "Qualified" },
                          { v: "closed_won", label: "Won" },
                          { v: "closed_lost", label: "Lost" },
                          { v: "nurturing", label: "Nurturing" },
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
              Show more ({filtered.length - showCount} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Profile Card (ICP ticket) ───────────────────────────────────────────────
function ProfileCard({ group }: { group: ProfileGroup }) {
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
          <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: gold }}>Lead Miner Profile</span>
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
            { label: "Contacted", value: contacted, color: C.blue },
            { label: "Replied",   value: replied,   color: gold },
            { label: "Positive",  value: positive,  color: C.green },
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
          <span><span className="font-bold" style={{ color: C.textBody }}>{totalLeads}</span> leads</span>
          <span><span className="font-bold" style={{ color: C.blue }}>{replyRate}%</span> reply rate</span>
          {group.hotCount > 0 && (
            <span className="font-bold" style={{ color: C.hot }}>🔥 {group.hotCount} hot</span>
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
                  {classColors[group.lastReply.classification].label}
                </span>
              )}
              <span className="text-[9px] ml-auto shrink-0" style={{ color: C.textDim }}>{timeAgo(group.lastReply.receivedAt)}</span>
            </div>
            {group.lastReply.text && (
              <p className="text-[10px] line-clamp-1" style={{ color: C.textDim }}>&ldquo;{group.lastReply.text}&rdquo;</p>
            )}
          </div>
        ) : (
          <span className="text-[10px]" style={{ color: C.textDim }}>No replies yet</span>
        )}
        <ChevronRight size={13} style={{ color: C.textDim }} className="shrink-0 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function LeadsCampaignsClient({ profileGroups, allLeads, lostLeads, renurturingLeads, wonLeads, companies, stats, totalLeadCount }: Props) {
  const [mainView, setMainView] = useState<"leads" | "campaigns">("leads");
  // leadsTab: 0 = All Leads, 1 = Results. Results contains Won/Lost/Re-nurturing.
  const [leadsTab, setLeadsTab] = useState(0);
  const [allLeadsSubview, setAllLeadsSubview] = useState<"people" | "companies">("people");
  const [resultsSubview, setResultsSubview] = useState<"won" | "lost" | "renurturing">("won");
  const [search, setSearch] = useState("");

  const activeGroups = profileGroups.filter(g => (g.statusCounts.active ?? 0) + (g.statusCounts.paused ?? 0) > 0);

  const filterGroups = (list: ProfileGroup[]) =>
    !search ? list : list.filter(g =>
      g.profileName.toLowerCase().includes(search.toLowerCase()) ||
      g.campaigns.some(c => c.name.toLowerCase().includes(search.toLowerCase())) ||
      g.leads.some(l => `${l.first_name} ${l.last_name} ${l.company}`.toLowerCase().includes(search.toLowerCase()))
    );

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

      {/* Stat bar */}
      <div
        className="flex items-center gap-6 mb-6 px-6 py-4 rounded-2xl border flex-wrap"
        style={{
          backgroundColor: C.card,
          borderColor: C.border,
          boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
        }}
      >
        {[
          { label: "Total Leads",      value: stats.totalLeads,        color: C.textBody },
          { label: "Active Flows", value: stats.activeCampaigns,   color: gold },
          { label: "Response Rate",    value: `${stats.responseRate}%`, color: C.blue },
          { label: "Positive Replies", value: stats.positiveReplies,   color: C.green },
        ].map((s, i, arr) => (
          <div key={s.label} className="flex items-center gap-4">
            <div>
              <span
                className="text-2xl font-bold tabular-nums"
                style={{
                  color: s.color,
                  fontFamily: "var(--font-outfit), system-ui, sans-serif",
                  letterSpacing: "-0.02em",
                }}
              >
                {s.value}
              </span>
              <span className="text-[11px] ml-2 font-semibold uppercase tracking-[0.08em]" style={{ color: C.textMuted }}>{s.label}</span>
            </div>
            {i < arr.length - 1 && <div className="h-6 w-px" style={{ backgroundColor: C.border }} />}
          </div>
        ))}
      </div>

      {/* ═══ Main view toggle: Leads / Campaigns ═══ */}
      <div className="flex items-center gap-1.5 mb-5">
        {([
          { key: "leads" as const,     label: "Leads",     count: allLeads.length },
          { key: "campaigns" as const, label: "Campaigns", count: activeGroups.length },
        ]).map(v => {
          const isActive = mainView === v.key;
          return (
            <button
              key={v.key}
              onClick={() => { setMainView(v.key); setSearch(""); }}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-[opacity,transform,box-shadow,background-color,border-color] duration-150 hover:opacity-95"
              style={{
                background: isActive ? `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 80%, white))` : C.card,
                color: isActive ? "#04070d" : C.textBody,
                border: `1px solid ${isActive ? "transparent" : C.border}`,
                boxShadow: isActive ? `0 4px 16px color-mix(in srgb, ${gold} 28%, transparent)` : "none",
              }}
            >
              {v.label}
              <span
                className="ml-2 text-xs font-bold px-1.5 py-0.5 rounded-full"
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

      {/* ═══ LEADS VIEW ═══ */}
      {mainView === "leads" && (
        <div>
          <div className="flex items-center gap-1 border-b mb-6" style={{ borderColor: C.border }}>
            {[
              { label: "All Leads", count: allLeads.length, color: gold },
              { label: "Results",   count: wonLeads.length + lostLeads.length + renurturingLeads.length, color: C.green },
            ].map((t, i) => {
              const isActive = leadsTab === i;
              return (
                <button
                  key={t.label}
                  onClick={() => setLeadsTab(i)}
                  className="flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-[color,background-color] duration-150 relative"
                  style={{
                    color: isActive ? t.color : C.textMuted,
                    backgroundColor: isActive ? `color-mix(in srgb, ${t.color} 6%, transparent)` : "transparent",
                  }}
                >
                  {t.label}
                  {t.count > 0 && (
                    <span
                      className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                      style={{
                        backgroundColor: isActive ? `color-mix(in srgb, ${t.color} 15%, transparent)` : C.cardHov,
                        color: isActive ? t.color : C.textDim,
                      }}
                    >
                      {t.count}
                    </span>
                  )}
                  {isActive && <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ backgroundColor: t.color }} />}
                </button>
              );
            })}
          </div>

          {leadsTab === 0 && (
            <div>
              {/* People / Companies sub-toggle */}
              <div className="flex items-center gap-1 mb-5 p-1 rounded-lg border max-w-fit"
                style={{ backgroundColor: C.card, borderColor: C.border }}>
                {([
                  { key: "people" as const,    label: "People",    icon: UsersIcon,   count: allLeads.length },
                  { key: "companies" as const, label: "Companies", icon: Building2,   count: companies.length },
                ]).map(opt => {
                  const isActive = allLeadsSubview === opt.key;
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => setAllLeadsSubview(opt.key)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-[background-color,color] duration-150"
                      style={{
                        backgroundColor: isActive ? gold : "transparent",
                        color: isActive ? "#04070d" : C.textBody,
                      }}
                    >
                      <Icon size={12} />
                      {opt.label}
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{
                          backgroundColor: isActive ? "rgba(4,7,13,0.14)" : C.cardHov,
                          color: isActive ? "#04070d" : C.textDim,
                        }}
                      >
                        {opt.count}
                      </span>
                    </button>
                  );
                })}
              </div>
              {allLeadsSubview === "people" && <AllLeadsTable leads={allLeads} />}
              {allLeadsSubview === "companies" && <CompaniesGrid companies={companies} />}
            </div>
          )}
          {leadsTab === 1 && (
            <div>
              {/* Won / Lost / Re-nurturing sub-toggle */}
              <div className="flex items-center gap-1 mb-5 p-1 rounded-lg border max-w-fit"
                style={{ backgroundColor: C.card, borderColor: C.border }}>
                {([
                  { key: "won" as const,         label: "Won",          icon: Trophy,        count: wonLeads.length,         color: C.green },
                  { key: "lost" as const,        label: "Lost",         icon: X,             count: lostLeads.length,        color: C.red },
                  { key: "renurturing" as const, label: "Re-nurturing", icon: RefreshCw,     count: renurturingLeads.length, color: gold },
                ]).map(opt => {
                  const isActive = resultsSubview === opt.key;
                  const Icon = opt.icon;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => setResultsSubview(opt.key)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-[background-color,color] duration-150"
                      style={{
                        backgroundColor: isActive ? opt.color : "transparent",
                        color: isActive ? "#fff" : C.textBody,
                      }}
                    >
                      <Icon size={12} />
                      {opt.label}
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{
                          backgroundColor: isActive ? "rgba(255,255,255,0.22)" : C.cardHov,
                          color: isActive ? "#fff" : C.textDim,
                        }}
                      >
                        {opt.count}
                      </span>
                    </button>
                  );
                })}
              </div>
              {resultsSubview === "won" && <OpportunitiesTable leads={wonLeads} />}
              {resultsSubview === "lost" && <LostLeadsView leads={lostLeads} />}
              {resultsSubview === "renurturing" && <RenurturingView leads={renurturingLeads} />}
            </div>
          )}
        </div>
      )}

      {/* ═══ CAMPAIGNS VIEW ═══ */}
      {mainView === "campaigns" && (
        <div>
          <div className="flex items-center gap-1 border-b mb-6" style={{ borderColor: C.border }}>
            <div className="flex items-center gap-2 px-5 py-3 text-sm font-medium relative" style={{ color: gold }}>
              Active Flows
              <span className="text-xs font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, color: gold }}>{activeGroups.length}</span>
              <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: gold }} />
            </div>
            <div className="flex-1 flex justify-end">
              <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 mb-1" style={{ borderColor: C.border, backgroundColor: C.card }}>
                <Search size={14} style={{ color: C.textDim }} />
                <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
                  className="bg-transparent text-sm outline-none w-40" style={{ color: C.textPrimary }} />
                {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
              </div>
            </div>
          </div>

          {filterGroups(activeGroups).length === 0 ? (
            <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <Megaphone size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
              <p className="text-sm font-medium" style={{ color: C.textBody }}>
                {search ? "No profiles match your search" : "No active campaigns yet"}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filterGroups(activeGroups).map(g => <ProfileCard key={g.profileId} group={g} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
