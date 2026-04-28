"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { supabase } from "@/lib/supabase";
import {
  Megaphone, ChevronRight, Target,
  Search, X, CheckCircle, Star, RefreshCw, Trash2, Square, CheckSquare,
} from "lucide-react";
import { LeadFilterBar, type LeadFilterState } from "@/components/LeadFilters";

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

type Props = {
  profileGroups: ProfileGroup[];
  allLeads: LeadInfo[];
  lostLeads: LostLead[];
  renurturingLeads: RenurturingLead[];
  stats: { totalLeads: number; responseRate: number; positiveReplies: number; activeCampaigns: number };
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
            <span className="text-[10px] font-bold px-2.5 py-1 rounded-md shrink-0" style={{ backgroundColor: "#F3F4F6", color: C.textMuted }}>
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
            <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
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
              <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
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
    await supabase.from("leads").delete().in("id", ids);
    setDeleting(false);
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
          <button onClick={deleteSelected} disabled={deleting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-[opacity,transform,box-shadow,background-color,border-color]"
            style={{ backgroundColor: C.red, color: "#fff", opacity: deleting ? 0.6 : 1 }}>
            <Trash2 size={12} />
            {deleting ? "Deleting…" : `Delete ${selected.size} lead${selected.size > 1 ? "s" : ""}`}
          </button>
        )}
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {filtered.map(l => <LostLeadCard key={l.id} lead={l} selected={selected.has(l.id)} onToggle={toggleOne} />)}
      </div>
    </div>
  );
}

// ─── All Leads Table with Filters ─────────────────────────────────────────────
const PAGE_SIZE = 25;

function AllLeadsTable({ leads }: { leads: LeadInfo[] }) {
  const router = useRouter();
  const [showCount, setShowCount] = useState(PAGE_SIZE);
  const [filters, setFilters] = useState<LeadFilterState>({ search: "", score: "all", campaign: "all", reply: "all", profile: "all" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const profileNames = [...new Set(leads.map(l => l.profile_name).filter(Boolean))] as string[];

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

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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
        alert(error || "Delete failed");
        return;
      }
      setSelected(new Set());
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <LeadFilterBar
        filters={filters}
        onChange={f => { setFilters(f); setShowCount(PAGE_SIZE); }}
        resultCount={filtered.length}
        totalCount={leads.length}
        profileNames={profileNames}
      />

      {selected.size > 0 && (
        <div className="mb-3 rounded-xl border flex items-center justify-between px-4 py-2.5"
          style={{ backgroundColor: "#FEF2F2", borderColor: "#FECACA" }}>
          <span className="text-xs font-semibold" style={{ color: "#991B1B" }}>
            {selected.size} lead{selected.size === 1 ? "" : "s"} selected
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected(new Set())}
              className="text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-white/60"
              style={{ color: "#991B1B" }}>
              Clear
            </button>
            <button onClick={bulkDelete} disabled={deleting}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-[opacity,transform,box-shadow,background-color,border-color] disabled:opacity-50"
              style={{ backgroundColor: "#DC2626", color: "#fff" }}>
              {deleting ? <RefreshCw size={12} className="animate-spin" /> : <Trash2 size={12} />}
              {deleting ? "Deleting…" : `Delete ${selected.size}`}
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
              return (
                <tr key={lead.id} className="border-t transition-colors hover:bg-black/[0.015]"
                  style={{ borderColor: C.border, backgroundColor: isSelected ? "#FEF2F2" : undefined }}>
                  <td className="px-3 py-2.5">
                    <button onClick={() => toggleOne(lead.id)} className="block" aria-label="Select lead">
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
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/leads/${lead.id}`} className="text-[10px] font-medium hover:underline" style={{ color: gold }}>View</Link>
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
              <div className="flex-1 h-2 rounded-full" style={{ backgroundColor: "#E5E7EB" }}>
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
export default function LeadsCampaignsClient({ profileGroups, allLeads, lostLeads, renurturingLeads, stats }: Props) {
  const [mainView, setMainView] = useState<"leads" | "campaigns">("leads");
  const [leadsTab, setLeadsTab] = useState(0);
  const [search, setSearch] = useState("");

  const activeGroups = profileGroups.filter(g => (g.statusCounts.active ?? 0) + (g.statusCounts.paused ?? 0) > 0);

  const filterGroups = (list: ProfileGroup[]) =>
    !search ? list : list.filter(g =>
      g.profileName.toLowerCase().includes(search.toLowerCase()) ||
      g.campaigns.some(c => c.name.toLowerCase().includes(search.toLowerCase())) ||
      g.leads.some(l => `${l.first_name} ${l.last_name} ${l.company}`.toLowerCase().includes(search.toLowerCase()))
    );

  return (
    <div>
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
          { label: "Active Campaigns", value: stats.activeCampaigns,   color: gold },
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
              { label: "All Leads",    count: allLeads.length,        color: gold },
              { label: "Lost Leads",   count: lostLeads.length,       color: C.red },
              { label: "Re-nurturing", count: renurturingLeads.length, color: C.green },
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

          {leadsTab === 0 && <AllLeadsTable leads={allLeads} />}
          {leadsTab === 1 && <LostLeadsView leads={lostLeads} />}
          {leadsTab === 2 && <RenurturingView leads={renurturingLeads} />}
        </div>
      )}

      {/* ═══ CAMPAIGNS VIEW ═══ */}
      {mainView === "campaigns" && (
        <div>
          <div className="flex items-center gap-1 border-b mb-6" style={{ borderColor: C.border }}>
            <div className="flex items-center gap-2 px-5 py-3 text-sm font-medium relative" style={{ color: gold }}>
              Active Campaigns
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
