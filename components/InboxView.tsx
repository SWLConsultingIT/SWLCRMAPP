"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search, CheckCircle2, XCircle, MessageSquare, ExternalLink,
  ThumbsUp, ThumbsDown, HelpCircle, Inbox as InboxIcon, Share2, Mail, Phone, Smartphone,
  Check, X as XIcon, ChevronRight, ChevronLeft, PanelLeftClose, PanelLeftOpen,
  ChevronDown, Megaphone, Target, Radio, Calendar,
} from "lucide-react";
import { C } from "@/lib/design";
import { useToast } from "@/lib/toast";

type InboxReply = {
  id: string;
  leadId: string;
  leadName: string;
  company: string | null;
  campaignName: string | null;
  icpProfileName: string | null;
  classification: string | null;
  channel: string | null;
  replyText: string | null;
  receivedAt: string;
  reviewStatus: string | null;
  requiresHumanReview: boolean;
  positive: boolean;
};

// Inbox is intentionally 2-tab now: a Pending Review queue (everything the
// AI couldn't decide for the seller) and All (the full history, including
// what was already triaged). The classify buttons inside each card move a
// row out of Pending Review and into All. Previously had 6 tabs which
// Fran said was too noisy — sellers were toggling instead of working.
type Tab = "pending" | "all";

const TAB_LABELS: Record<Tab, string> = {
  pending: "Pending review",
  all: "All",
};

function channelIcon(ch: string | null) {
  if (ch === "linkedin") return Share2;
  if (ch === "email") return Mail;
  if (ch === "call" || ch === "phone") return Phone;
  if (ch === "whatsapp" || ch === "sms") return Smartphone;
  return MessageSquare;
}

function classBadge(c: string | null): { label: string; color: string; bg: string } | null {
  if (!c) return null;
  if (c === "positive" || c === "meeting_intent") return { label: "Positive", color: C.green, bg: `color-mix(in srgb, ${C.green} 14%, transparent)` };
  if (c === "negative" || c === "not_now") return { label: "Negative", color: C.red, bg: `color-mix(in srgb, ${C.red} 14%, transparent)` };
  if (c === "question" || c === "needs_info") return { label: "Question", color: C.blue, bg: `color-mix(in srgb, ${C.blue} 14%, transparent)` };
  return { label: c, color: C.textMuted, bg: C.surface };
}

function relativeTime(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export type { InboxReply };

type ThreadAttachment = {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  url?: string | null;
  thumbUrl?: string | null;
  size?: number | null;
  isImage?: boolean;
};

type ThreadEntry = {
  id: string;
  direction: "outbound" | "inbound" | "event";
  channel: string | null;
  body: string;
  subject?: string | null;
  at: string;
  classification?: string | null;
  stepNumber?: number | null;
  kind?: string;
  source?: "db" | "unipile";
  attachments?: ThreadAttachment[];
  seen?: boolean;
  seenAt?: string | null;
  delivered?: boolean;
};

function channelLabel(ch: string | null): string {
  if (!ch) return "—";
  if (ch === "linkedin") return "LinkedIn";
  if (ch === "email") return "Email";
  if (ch === "call" || ch === "phone") return "Call";
  if (ch === "whatsapp") return "WhatsApp";
  if (ch === "sms") return "SMS";
  if (ch === "telegram") return "Telegram";
  return ch;
}

// Per-channel color so the inbox card can be tinted at a glance — LinkedIn
// stays blue, Email green, Call orange. Future Telegram / WhatsApp / SMS
// fall back to a neutral until we pick brand tones for those.
function channelColor(ch: string | null): string {
  if (ch === "linkedin") return C.linkedin;
  if (ch === "email") return C.email;
  if (ch === "call" || ch === "phone") return C.phone;
  if (ch === "whatsapp") return "#25D366";
  if (ch === "sms") return "#6366F1";
  if (ch === "telegram") return "#229ED9";
  return C.textMuted;
}

// Spanish-friendly absolute timestamp. The thread is best read at a glance
// with explicit "26-may, 12:30 a.m." rather than relative "2d ago", because
// sellers are reconciling against LinkedIn's own timestamps.
function formatAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Just the time component for chat bubbles — the day separator carries the
// date already.
function formatTimeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

// Day separator label. "Hoy" / "Ayer" / "Domingo 24 may" depending on age.
function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Hoy";
  if (sameDay(d, yest)) return "Ayer";
  const diffMs = today.getTime() - d.getTime();
  const days = Math.floor(diffMs / 86_400_000);
  // Recent week: weekday name. Otherwise the full date.
  if (days < 7) return d.toLocaleDateString("es-AR", { weekday: "long" });
  return d.toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "short" });
}

// First-letter initials for the avatar bubble. Falls back to "?" if empty.
function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() ?? "").join("") || "?";
}

// Deterministic pastel color per name so each lead's avatar is visually
// distinct. Hash the name → hue, fixed saturation/lightness for legibility.
function avatarColor(name: string | null | undefined): { bg: string; fg: string } {
  if (!name) return { bg: "#E5E7EB", fg: "#374151" };
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return { bg: `hsl(${hue}, 65%, 90%)`, fg: `hsl(${hue}, 55%, 32%)` };
}

// Chip-style filter for the History sidebar. Renders a pill button with
// icon + current value + chevron, with a hidden native <select> overlaid
// so the OS handles the picker UI (good a11y, no popover state to manage).
// Brand-tinted background + bolder text when the filter is non-default.
function FilterPill({
  icon, accent, placeholder, value, options, onChange, truncateAt,
}: {
  icon: React.ReactNode;
  accent: string;
  placeholder: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  /** Cap the visible label length so long campaign / ICP names don't
   *  blow out the sidebar. The full name stays in the title attribute. */
  truncateAt?: number;
}) {
  const isActive = value !== "all";
  const fullLabel = isActive ? (options.find(o => o.value === value)?.label ?? value) : placeholder;
  const cap = truncateAt ?? 22;
  const label = fullLabel.length > cap ? fullLabel.slice(0, cap - 1) + "…" : fullLabel;
  return (
    <span
      className="relative inline-flex items-center gap-1.5 rounded-full border text-[10px] font-semibold transition-[background-color,color,box-shadow] cursor-pointer hover:shadow-sm"
      style={{
        backgroundColor: isActive
          ? `color-mix(in srgb, ${accent} 14%, ${C.card})`
          : C.card,
        borderColor: isActive
          ? `color-mix(in srgb, ${accent} 40%, transparent)`
          : C.border,
        color: isActive ? accent : C.textMuted,
        paddingInline: "10px",
        paddingBlock: "4px",
        boxShadow: isActive
          ? `0 1px 0 color-mix(in srgb, ${accent} 14%, transparent)`
          : "none",
      }}
      title={fullLabel}
    >
      {icon}
      <span className="truncate" style={{ maxWidth: 130 }}>{label}</span>
      <ChevronDown size={10} style={{ opacity: 0.7 }} />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer"
        aria-label={placeholder}
      >
        <option value="all">{placeholder}</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </span>
  );
}

export default function InboxView({ replies }: { replies: InboxReply[] }) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("pending");
  const [search, setSearch] = useState("");
  // Filters added on 2026-05-27 per boss feedback — sellers needed to slice
  // the History tab by Campaign / ICP / Channel / date before triaging.
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const [icpFilter, setIcpFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  // Date range lives inside this component (was previously in QueueClient
  // as a standalone toolbar dropdown that felt disconnected from the
  // sidebar filters). Default "30d" — most sellers only triage the last
  // month of replies; older entries stay archived.
  type DateRange = "today" | "7d" | "30d" | "all";
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const dateCutoffMs = useMemo(() => {
    if (dateRange === "today") return new Date(new Date().toDateString()).getTime();
    if (dateRange === "7d")    return Date.now() - 7  * 86400000;
    if (dateRange === "30d")   return Date.now() - 30 * 86400000;
    return 0;
  }, [dateRange]);
  const DATE_LABEL: Record<DateRange, string> = {
    today: "Today",
    "7d":  "Last 7 days",
    "30d": "Last 30 days",
    all:   "All time",
  };
  const [selectedId, setSelectedId] = useState<string | null>(replies[0]?.id ?? null);
  const [working, setWorking] = useState(false);
  // Thread state — fetched on selection change. Lets the right pane show the
  // full back-and-forth (outbound + inbound) rather than a single isolated
  // reply line.
  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  // Channel filter inside the thread. Default "all" preserves the cross-
  // channel chronological view; clicking LinkedIn / Email / Call narrows to
  // that channel only. Boss feedback 2026-05-28: "es raro que esté todo
  // junto" when a lead got both a connection request and an email.
  const [threadChannel, setThreadChannel] = useState<"all" | "linkedin" | "email" | "call">("all");
  const [stage, setStage] = useState<{
    status: string | null;
    currentStep: number | null;
    totalSteps: number | null;
    nextStepLabel: string | null;
    nextStepChannel: string | null;
    nextStepDueAt: string | null;
    stopReason: string | null;
  } | null>(null);
  // Collapse the conversation list so the thread can take the full width.
  // Persisted in sessionStorage so it survives navigating into a lead and
  // back. Default open so first-time sellers see the inventory.
  const [listCollapsed, setListCollapsed] = useState(false);
  useEffect(() => {
    try {
      const v = sessionStorage.getItem("swl-inbox-list-collapsed");
      if (v === "1") setListCollapsed(true);
    } catch { /* no-op */ }
  }, []);
  function toggleListCollapsed() {
    setListCollapsed(prev => {
      const next = !prev;
      try { sessionStorage.setItem("swl-inbox-list-collapsed", next ? "1" : "0"); } catch { /* no-op */ }
      return next;
    });
  }

  // Counts by tab — computed once per render so the badges always reflect the
  // raw (unfiltered) totals, not the search-narrowed list.
  // "Pending" = either explicit human-review flag from the AI classifier OR
  // a reply that's never been touched (review_status pending). The moment the
  // seller hits any classify button, the API flips status→approved and
  // requires_human_review→false, so the row drops out of this tab into All.
  const isPending = (r: InboxReply) =>
    r.requiresHumanReview || r.reviewStatus === "pending";
  const counts = useMemo(() => ({
    pending: replies.filter(isPending).length,
    all: replies.length,
  }), [replies]);

  // Distinct values for the dropdown options. Recomputed when replies
  // change so adding a new campaign / ICP / channel surfaces automatically.
  const campaignOptions = useMemo(
    () => [...new Set(replies.map(r => r.campaignName).filter((x): x is string => !!x))].sort(),
    [replies],
  );
  const icpOptions = useMemo(
    () => [...new Set(replies.map(r => r.icpProfileName).filter((x): x is string => !!x))].sort(),
    [replies],
  );
  const channelOptions = useMemo(
    () => [...new Set(replies.map(r => r.channel).filter((x): x is string => !!x))].sort(),
    [replies],
  );

  const filtered = useMemo(() => {
    let list = replies;
    if (tab === "pending") list = list.filter(isPending);
    if (campaignFilter !== "all") list = list.filter(r => r.campaignName === campaignFilter);
    if (icpFilter !== "all") list = list.filter(r => r.icpProfileName === icpFilter);
    if (channelFilter !== "all") list = list.filter(r => r.channel === channelFilter);
    if (dateRange !== "all") {
      list = list.filter(r => new Date(r.receivedAt).getTime() >= dateCutoffMs);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(r =>
        r.leadName.toLowerCase().includes(q) ||
        (r.company ?? "").toLowerCase().includes(q) ||
        (r.replyText ?? "").toLowerCase().includes(q) ||
        (r.campaignName ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [replies, tab, search, campaignFilter, icpFilter, channelFilter, dateRange, dateCutoffMs]);

  // Ensure the currently-selected reply still belongs to the visible list; if
  // not (tab changed, search narrowed), jump to the first visible reply.
  useEffect(() => {
    if (filtered.length === 0) { setSelectedId(null); return; }
    if (!selectedId || !filtered.find(r => r.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const selected = filtered.find(r => r.id === selectedId) ?? null;
  const selectedIdx = selected ? filtered.findIndex(r => r.id === selectedId) : -1;

  // Fetch the full thread when the selected reply changes. Cancellation token
  // guards against out-of-order responses if the seller clicks quickly.
  useEffect(() => {
    if (!selected?.leadId) { setThread([]); setStage(null); return; }
    // Reset the channel filter whenever the selected lead changes so a
    // stale "Email only" view doesn't persist across leads.
    setThreadChannel("all");
    let cancelled = false;
    setThreadLoading(true);
    setStage(null);
    fetch(`/api/inbox/thread/${selected.leadId}`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : { thread: [], stage: null })
      .then(data => {
        if (cancelled) return;
        setThread(Array.isArray(data.thread) ? data.thread : []);
        setStage(data.stage ?? null);
      })
      .catch(() => { if (!cancelled) { setThread([]); setStage(null); } })
      .finally(() => { if (!cancelled) setThreadLoading(false); });
    return () => { cancelled = true; };
  }, [selected?.leadId]);

  function selectByIdx(idx: number) {
    if (idx < 0 || idx >= filtered.length) return;
    setSelectedId(filtered[idx].id);
  }

  // Keyboard shortcuts à la Superhuman: J/K nav, P/N/Q classify, X to clear
  // search. We ignore typing in inputs (the search box) so the J/K shortcuts
  // don't fire while the user types "j" in a search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (isInput) return;
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); selectByIdx(selectedIdx + 1); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); selectByIdx(selectedIdx - 1); }
      else if (e.key === "a" && selected) { e.preventDefault(); void review("approved"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIdx, filtered, selected]);

  // Quick-classify from the list row — assigns/overrides classification AND
  // marks the row reviewed in one call. Doesn't require the row to be the
  // currently-selected one; this is the row's own inline action.
  async function quickClassify(replyId: string, classification: "positive" | "negative" | "follow_up") {
    if (working) return;
    setWorking(true);
    try {
      const res = await fetch(`/api/replies/${replyId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved", classification }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Failed" }));
        toast.show({ kind: "error", title: "Couldn't classify", description: error || "Try again." });
        return;
      }
      // Mirror the API's cascade response: positive/negative now pause the
      // campaign + close the lead. Tell the seller so they don't expect
      // another step to fire.
      toast.show({
        kind: classification === "positive" ? "success" : classification === "negative" ? "warning" : "info",
        title: classification === "follow_up"
          ? "Marcado follow-up — la campaña sigue corriendo"
          : classification === "positive"
            ? "Marcado positive — campaña pausada, lead qualified"
            : "Marcado negative — campaña pausada, lead closed_lost",
      });
      router.refresh();
    } finally {
      setWorking(false);
    }
  }

  async function review(status: "approved" | "rejected" | "pending") {
    if (!selected || working) return;
    setWorking(true);
    try {
      const res = await fetch(`/api/replies/${selected.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Failed" }));
        toast.show({ kind: "error", title: "Couldn't update review", description: error || "Try again" });
        return;
      }
      toast.show({
        kind: status === "approved" ? "success" : status === "rejected" ? "warning" : "info",
        title: status === "approved" ? "Marked as reviewed" : status === "rejected" ? "Marked as rejected" : "Sent back to inbox",
      });
      router.refresh();
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      {/* Tabs */}
      <div className="flex items-center gap-1 px-2 sm:px-3 pt-2 border-b overflow-x-auto" style={{ borderColor: C.border }}>
        {(Object.keys(TAB_LABELS) as Tab[]).map(k => {
          const active = tab === k;
          const n = counts[k];
          return (
            <button
              key={k}
              onClick={() => setTab(k)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-t-lg transition-colors whitespace-nowrap"
              style={{
                color: active ? C.textPrimary : C.textMuted,
                backgroundColor: active ? `color-mix(in srgb, var(--brand, #c9a83a) 10%, transparent)` : "transparent",
                borderBottom: active ? "2px solid var(--brand, #c9a83a)" : "2px solid transparent",
                marginBottom: -1,
              }}
            >
              {TAB_LABELS[k]}
              {n > 0 && (
                <span
                  className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: active ? "var(--brand, #c9a83a)" : C.surface, color: active ? "#04070d" : C.textDim }}
                >
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Split pane — fixed height so the inner list + thread can scroll
          independently without growing the page. The list panel collapses
          via flex layout when the seller wants the thread full-width
          (previous grid-based collapse hid the toggle button along with the
          panel, leaving sellers unable to bring the list back — Fran caught
          this on 2026-05-26). Flex layout means the thread always flex-1's
          regardless of whether the list pane is rendered. */}
      <div className="flex flex-col md:flex-row h-[78vh]">
        {/* List */}
        <div className={`${listCollapsed ? "hidden md:hidden" : "flex"} border-b md:border-b-0 md:border-r overflow-hidden flex-col md:w-[42%] md:min-w-[300px]`} style={{ borderColor: C.border }}>
          {/* Search + filters (Campaign / ICP / Channel — added 2026-05-27
              per boss feedback so sellers can slice History before triaging) */}
          <div className="px-3 py-2 border-b space-y-2" style={{ borderColor: C.border }}>
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: C.textMuted }} />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search lead, company, message…"
                className="w-full pl-7 pr-3 py-1.5 rounded-lg border text-xs focus:outline-none"
                style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
              />
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <FilterPill
                icon={<Calendar size={11} />}
                accent="var(--brand, #c9a83a)"
                placeholder="Last 30 days"
                /* For the date filter the "default" is 30d, not "all". So we
                   treat any value other than 30d as an active state so the
                   pill looks tinted when the user has narrowed/widened it. */
                value={dateRange === "30d" ? "all" : dateRange}
                options={(["today", "7d", "30d", "all"] as DateRange[]).map(d => ({ value: d, label: DATE_LABEL[d] }))}
                onChange={(v) => setDateRange((v === "all" ? "all" : v) as DateRange)}
              />
              {campaignOptions.length > 0 && (
                <FilterPill
                  icon={<Megaphone size={11} />}
                  accent="var(--brand, #c9a83a)"
                  placeholder="All campaigns"
                  value={campaignFilter}
                  options={campaignOptions.map(n => ({ value: n, label: n }))}
                  onChange={setCampaignFilter}
                  truncateAt={18}
                />
              )}
              {icpOptions.length > 0 && (
                <FilterPill
                  icon={<Target size={11} />}
                  accent="var(--brand, #c9a83a)"
                  placeholder="All ICPs"
                  value={icpFilter}
                  options={icpOptions.map(n => ({ value: n, label: n }))}
                  onChange={setIcpFilter}
                  truncateAt={18}
                />
              )}
              {channelOptions.length > 0 && (
                <FilterPill
                  icon={<Radio size={11} />}
                  accent={channelColor(channelFilter !== "all" ? channelFilter : null)}
                  placeholder="All channels"
                  value={channelFilter}
                  options={channelOptions.map(c => ({ value: c, label: channelLabel(c) }))}
                  onChange={setChannelFilter}
                />
              )}
              {(campaignFilter !== "all" || icpFilter !== "all" || channelFilter !== "all" || dateRange !== "30d") && (
                <button
                  onClick={() => { setCampaignFilter("all"); setIcpFilter("all"); setChannelFilter("all"); setDateRange("30d"); }}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full hover:opacity-80 transition-opacity"
                  style={{ color: C.textMuted, backgroundColor: C.surface }}
                  title="Clear all filters"
                >
                  <XIcon size={10} /> Clear
                </button>
              )}
            </div>
          </div>

          <div className="overflow-y-auto flex-1 px-2 py-2" style={{ backgroundColor: `color-mix(in srgb, ${C.surface} 35%, ${C.bg})` }}>
            {filtered.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="w-10 h-10 mx-auto mb-3 rounded-2xl flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, ${C.green} 12%, transparent)` }}>
                  <CheckCircle2 size={18} style={{ color: C.green }} />
                </div>
                <p className="text-sm font-semibold mb-1" style={{ color: C.textBody }}>Inbox zero</p>
                <p className="text-[11px] max-w-[220px] mx-auto" style={{ color: C.textMuted }}>
                  Nothing matches this filter right now. Switch tabs or wait for new replies.
                </p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {filtered.map(r => {
                  const isSelected = r.id === selectedId;
                  const Icon = channelIcon(r.channel);
                  const badge = classBadge(r.classification);
                  const chColor = channelColor(r.channel);
                  return (
                    <li key={r.id} className="relative group/ix">
                      <button
                        type="button"
                        onClick={() => setSelectedId(r.id)}
                        className="w-full text-left px-3 py-2.5 rounded-lg border transition-all hover:shadow-sm"
                        style={{
                          borderColor: isSelected
                            ? `color-mix(in srgb, ${chColor} 45%, transparent)`
                            : C.border,
                          backgroundColor: isSelected ? `color-mix(in srgb, ${chColor} 10%, ${C.card})` : C.card,
                          // Channel-tinted left rail (slightly thicker when selected for clearer focus).
                          borderLeft: `3px solid ${isSelected ? chColor : `color-mix(in srgb, ${chColor} 35%, transparent)`}`,
                          boxShadow: isSelected
                            ? `0 1px 3px color-mix(in srgb, ${chColor} 18%, transparent)`
                            : "none",
                        }}
                      >
                        <div className="flex items-start gap-2">
                          <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: `color-mix(in srgb, ${chColor} 18%, transparent)`, color: chColor }}>
                            <Icon size={11} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-bold truncate" style={{ color: C.textPrimary }}>
                                {r.leadName}
                              </p>
                              {/* Date hides on hover so the quick-classify
                                  buttons (positioned absolute top-right of
                                  the row) don't collide with it. The space
                                  is preserved via opacity (not display:none)
                                  so the row height stays stable. */}
                              <span className="text-[10px] tabular-nums shrink-0 transition-opacity group-hover/ix:opacity-0" style={{ color: C.textDim }}>
                                {relativeTime(r.receivedAt)}
                              </span>
                            </div>
                            {r.company && (
                              <p className="text-[11px] truncate" style={{ color: C.textMuted }}>
                                {r.company}
                              </p>
                            )}
                            <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: C.textBody }}>
                              {r.classification === "connection_accepted"
                                ? "🤝 Aceptó la solicitud de conexión"
                                : (r.replyText && r.replyText.trim() ? r.replyText : "(sin texto)")}
                            </p>
                            <div className="flex items-center gap-1 mt-1 flex-wrap">
                              {/* Channel pill — first so it always shows even
                                  when no classification badge yet. Color-coded
                                  to match the row's left rail + icon. */}
                              <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color: chColor, backgroundColor: `color-mix(in srgb, ${chColor} 14%, transparent)` }}>
                                <Icon size={9} />
                                {channelLabel(r.channel)}
                              </span>
                              {badge && (
                                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color: badge.color, backgroundColor: badge.bg }}>
                                  {badge.label}
                                </span>
                              )}
                              {r.requiresHumanReview && (
                                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color: "#D97706", backgroundColor: "color-mix(in srgb, #D97706 14%, transparent)" }}>
                                  Needs review
                                </span>
                              )}
                              {r.campaignName && (
                                <span className="text-[10px] truncate max-w-[120px]" style={{ color: C.textDim }}>
                                  · {r.campaignName}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </button>
                      {/* Inline quick-classify — hover only, sits absolute on
                          top-right of the row so it doesn't fight for layout.
                          One click classifies AND marks reviewed, freeing the
                          seller from opening every thread. */}
                      <div className="absolute top-2 right-2 opacity-0 group-hover/ix:opacity-100 transition-opacity flex items-center gap-1 pointer-events-auto">
                        <button
                          type="button"
                          disabled={working}
                          onClick={(e) => { e.stopPropagation(); void quickClassify(r.id, "positive"); }}
                          title="Mark Positive (and reviewed)"
                          className="w-6 h-6 inline-flex items-center justify-center rounded-md transition-opacity hover:opacity-85 disabled:opacity-40"
                          style={{ backgroundColor: `color-mix(in srgb, ${C.green} 18%, transparent)`, color: C.green, border: `1px solid color-mix(in srgb, ${C.green} 32%, transparent)` }}
                        >
                          <ThumbsUp size={11} />
                        </button>
                        <button
                          type="button"
                          disabled={working}
                          onClick={(e) => { e.stopPropagation(); void quickClassify(r.id, "negative"); }}
                          title="Mark Negative (and reviewed)"
                          className="w-6 h-6 inline-flex items-center justify-center rounded-md transition-opacity hover:opacity-85 disabled:opacity-40"
                          style={{ backgroundColor: `color-mix(in srgb, ${C.red} 14%, transparent)`, color: C.red, border: `1px solid color-mix(in srgb, ${C.red} 30%, transparent)` }}
                        >
                          <ThumbsDown size={11} />
                        </button>
                        <button
                          type="button"
                          disabled={working}
                          onClick={(e) => { e.stopPropagation(); void quickClassify(r.id, "follow_up"); }}
                          title="Mark as Follow-up (and reviewed)"
                          className="w-6 h-6 inline-flex items-center justify-center rounded-md transition-opacity hover:opacity-85 disabled:opacity-40"
                          style={{ backgroundColor: "color-mix(in srgb, #D97706 14%, transparent)", color: "#D97706", border: "1px solid color-mix(in srgb, #D97706 30%, transparent)" }}
                        >
                          <HelpCircle size={11} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Thread / detail */}
        <div className="flex flex-col overflow-hidden flex-1 relative">
          {/* List toggle — ALWAYS rendered in the top-left so the seller can
              re-open a collapsed list even when no reply is selected (the
              old placement inside the `selected ?` branch hid the button
              and stranded sellers — Fran caught this 2026-05-26). */}
          {listCollapsed && (
            <button
              type="button"
              onClick={toggleListCollapsed}
              title="Mostrar lista"
              className="absolute top-3 left-3 z-10 w-8 h-8 rounded-lg flex items-center justify-center transition-opacity hover:opacity-85 border shadow-sm"
              style={{ borderColor: C.border, backgroundColor: C.card, color: C.textMuted }}
            >
              <PanelLeftOpen size={14} />
            </button>
          )}
          {selected ? (
            <>
              <div className="px-5 py-4 border-b flex items-start justify-between gap-3" style={{ borderColor: C.border, background: `linear-gradient(180deg, color-mix(in srgb, ${channelColor(selected.channel)} 4%, transparent), transparent)` }}>
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {/* Hide-list toggle — only when list is expanded. Reopen
                      lives outside the conditional (top-left floating). */}
                  {!listCollapsed && (
                    <button
                      type="button"
                      onClick={toggleListCollapsed}
                      title="Ocultar lista"
                      className="hidden md:flex w-8 h-8 rounded-lg items-center justify-center shrink-0 transition-opacity hover:opacity-85 border"
                      style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textMuted }}
                    >
                      <PanelLeftClose size={14} />
                    </button>
                  )}
                  {(() => {
                    const ac = avatarColor(selected.leadName);
                    return (
                      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold"
                        style={{ backgroundColor: ac.bg, color: ac.fg, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                        {initials(selected.leadName)}
                      </div>
                    );
                  })()}
                  <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-bold truncate" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
                      {selected.leadName}
                    </h2>
                    {(() => {
                      const b = classBadge(selected.classification);
                      return b ? (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ color: b.color, backgroundColor: b.bg }}>
                          {b.label}
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap text-xs" style={{ color: C.textMuted }}>
                    <span>{selected.company ?? "—"}</span>
                    {selected.campaignName && <span>· {selected.campaignName}</span>}
                    <span>· {relativeTime(selected.receivedAt)}</span>
                    {/* Channel pill — explicit so when we add WhatsApp/Email/
                        Telegram threads later, the seller knows at a glance
                        which inbox they're reading. */}
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider"
                      style={{ backgroundColor: `color-mix(in srgb, ${channelColor(selected.channel)} 14%, transparent)`, color: channelColor(selected.channel) }}>
                      {(() => { const Ic = channelIcon(selected.channel); return <Ic size={9} />; })()}
                      {channelLabel(selected.channel)}
                    </span>
                  </div>
                  {/* Campaign stage strip — quick "where in the flow" so the
                      seller doesn't open another tab to check. Reads from the
                      thread API's stage block (current_step + totalSteps,
                      next step label/channel, days-until-next, terminal
                      reason). */}
                  {stage && (
                    <div className="flex items-center gap-2 mt-2 flex-wrap text-[11px]">
                      {stage.status === "completed" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold"
                          style={{
                            backgroundColor: stage.stopReason?.includes("positive")
                              ? `color-mix(in srgb, ${C.green} 14%, transparent)`
                              : `color-mix(in srgb, ${C.red} 14%, transparent)`,
                            color: stage.stopReason?.includes("positive") ? C.green : C.red,
                          }}>
                          Campaña cerrada
                          {stage.stopReason?.includes("positive") && " · lead qualified"}
                          {stage.stopReason?.includes("negative") && " · lead closed_lost"}
                        </span>
                      ) : stage.status === "paused" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold"
                          style={{ backgroundColor: `color-mix(in srgb, #D97706 14%, transparent)`, color: "#D97706" }}>
                          Campaña pausada
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold"
                          style={{ backgroundColor: `color-mix(in srgb, ${C.green} 14%, transparent)`, color: C.green }}>
                          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: C.green }} />
                          Campaña activa
                        </span>
                      )}
                      {stage.currentStep != null && stage.totalSteps != null && stage.totalSteps > 0 && (
                        <span style={{ color: C.textMuted }}>
                          Paso {stage.currentStep} de {stage.totalSteps}
                        </span>
                      )}
                      {stage.nextStepLabel && stage.status !== "completed" && (
                        <span style={{ color: C.textMuted }}>
                          · Próximo: <span className="font-medium" style={{ color: channelColor(stage.nextStepChannel) }}>{stage.nextStepLabel}</span>
                          {stage.nextStepDueAt && (() => {
                            const when = new Date(stage.nextStepDueAt);
                            const ms = when.getTime() - Date.now();
                            const days = Math.ceil(ms / 86_400_000);
                            if (ms <= 0) return <span style={{ color: C.textDim }}> · listo para disparar</span>;
                            return <span style={{ color: C.textDim }}> · en {days} {days === 1 ? "día" : "días"}</span>;
                          })()}
                        </span>
                      )}
                    </div>
                  )}
                  </div>
                </div>
                <Link
                  href={`/leads/${selected.leadId}`}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-opacity hover:opacity-85 shrink-0"
                  style={{ borderColor: C.border, color: C.textMuted, backgroundColor: C.bg }}
                >
                  Open lead <ExternalLink size={10} />
                </Link>
              </div>

              {/* Channel filter — only renders when more than one channel
                  appears in the thread. Click narrows the chronological feed
                  to that channel only. */}
              {(() => {
                const channelsInThread = new Set<string>();
                for (const e of thread) if (e.channel) channelsInThread.add(e.channel);
                if (channelsInThread.size <= 1) return null;
                const tabs: Array<{ key: "all" | "linkedin" | "email" | "call"; label: string; count: number }> = [
                  { key: "all",      label: "All",      count: thread.length },
                  { key: "linkedin", label: "LinkedIn", count: thread.filter(e => e.channel === "linkedin").length },
                  { key: "email",    label: "Email",    count: thread.filter(e => e.channel === "email").length },
                  { key: "call",     label: "Calls",    count: thread.filter(e => e.channel === "call" || e.channel === "phone").length },
                ].filter(t => t.key === "all" || t.count > 0);
                return (
                  <div className="px-5 py-2 flex items-center gap-1 border-b" style={{ borderColor: C.border, backgroundColor: C.card }}>
                    {tabs.map(t => {
                      const isActive = threadChannel === t.key;
                      const accent = t.key === "linkedin" ? "#0A66C2" : t.key === "email" ? "#7C3AED" : t.key === "call" ? "#F97316" : gold;
                      return (
                        <button key={t.key} onClick={() => setThreadChannel(t.key)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-[background-color,color]"
                          style={{
                            backgroundColor: isActive ? `color-mix(in srgb, ${accent} 14%, transparent)` : "transparent",
                            color: isActive ? accent : C.textMuted,
                            border: isActive ? `1px solid color-mix(in srgb, ${accent} 32%, transparent)` : "1px solid transparent",
                          }}>
                          {t.label}
                          <span className="text-[9px] tabular-nums opacity-80">{t.count}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Thread — full conversation history. Outbound (our messages)
                  on the right in brand-tinted bubbles, inbound (lead) on the
                  left in neutral bubbles. Chronological top→bottom so the
                  seller reads it like a chat. */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3" style={{ backgroundColor: `color-mix(in srgb, ${C.surface} 40%, ${C.bg})` }}>
                {threadLoading ? (
                  <div className="space-y-4 animate-pulse">
                    {[0, 1, 2].map(i => (
                      <div key={i} className={`flex items-end gap-2 ${i % 2 === 0 ? "" : "flex-row-reverse"}`}>
                        <div className="w-7 h-7 rounded-full shrink-0" style={{ backgroundColor: C.border }} />
                        <div className="rounded-2xl h-16" style={{ width: `${50 + (i * 8)}%`, backgroundColor: C.border, opacity: 0.4 }} />
                      </div>
                    ))}
                  </div>
                ) : thread.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center py-12">
                    <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3"
                      style={{ backgroundColor: `color-mix(in srgb, ${channelColor(selected.channel)} 14%, transparent)`, color: channelColor(selected.channel) }}>
                      {selected.classification === "connection_accepted" ? <CheckCircle2 size={22} /> : <MessageSquare size={22} />}
                    </div>
                    <p className="text-sm font-semibold" style={{ color: C.textBody }}>
                      {selected.classification === "connection_accepted"
                        ? "Aceptó la conexión"
                        : "Sin mensajes todavía"}
                    </p>
                    <p className="text-xs mt-1 max-w-[280px]" style={{ color: C.textMuted }}>
                      {selected.classification === "connection_accepted"
                        ? "El primer mensaje del flow va a aparecer acá cuando se mande."
                        : (selected.replyText ?? "Cuando el lead responda o vos le mandes algo, va a aparecer acá.")}
                    </p>
                  </div>
                ) : (
                  (() => {
                    // Apply the channel filter first. "all" keeps everything;
                    // any specific channel narrows the chronological feed to
                    // just that one. We compute the visible list once so the
                    // "no entries on this channel" fallback below has access.
                    const visibleThread = threadChannel === "all"
                      ? thread
                      : thread.filter(e => threadChannel === "call"
                          ? (e.channel === "call" || e.channel === "phone")
                          : e.channel === threadChannel);
                    if (visibleThread.length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center text-center py-12">
                          <p className="text-sm font-semibold" style={{ color: C.textBody }}>
                            No hay mensajes de {channelLabel(threadChannel === "all" ? null : threadChannel)} en este hilo.
                          </p>
                          <button onClick={() => setThreadChannel("all")}
                            className="text-[11px] mt-2 font-semibold hover:underline" style={{ color: gold }}>
                            Ver todos los canales
                          </button>
                        </div>
                      );
                    }
                    // Group entries by day so we can drop a sticky "Hoy /
                    // Ayer / Domingo 24 may" separator between day boundaries.
                    // Same pattern LinkedIn/WhatsApp use — it makes scanning a
                    // long thread feel instant.
                    let lastDayKey: string | null = null;
                    const leadAvatar = avatarColor(selected.leadName);
                    return visibleThread.map((entry, idx) => {
                      const isOut = entry.direction === "outbound";
                      const Icon = channelIcon(entry.channel);
                      const stepLabel = entry.stepNumber === 0
                        ? "Connection Request"
                        : entry.stepNumber != null && entry.stepNumber > 0
                          ? `Step ${entry.stepNumber}`
                          : entry.kind === "auto_reply" || (entry.source === "unipile" && isOut)
                            ? "Auto-reply"
                            : null;
                      const time = formatTimeOnly(entry.at);
                      const dayDate = new Date(entry.at);
                      const dayKey = `${dayDate.getFullYear()}-${dayDate.getMonth()}-${dayDate.getDate()}`;
                      const showDayHeader = dayKey !== lastDayKey;
                      lastDayKey = dayKey;
                      const dayLabel = formatDayLabel(entry.at);
                      const isLast = idx === visibleThread.length - 1;
                      const isEmail = entry.channel === "email";
                      return (
                        <div key={entry.id}>
                          {showDayHeader && (
                            <div className="flex items-center gap-3 my-4 first:mt-0">
                              <div className="flex-1 h-px" style={{ backgroundColor: C.border }} />
                              <span className="text-[10px] font-bold uppercase tracking-[0.12em] px-2 py-0.5 rounded-full"
                                style={{ color: C.textDim, backgroundColor: C.surface }}>
                                {dayLabel}
                              </span>
                              <div className="flex-1 h-px" style={{ backgroundColor: C.border }} />
                            </div>
                          )}
                          {isEmail ? (
                            /* Email card — full-width with From / Subject / body so an email
                               actually reads like an email, not a chat bubble. */
                            <div
                              className="rounded-xl border overflow-hidden"
                              style={{
                                backgroundColor: isOut
                                  ? `color-mix(in srgb, var(--brand, #c9a83a) 5%, ${C.card})`
                                  : C.card,
                                borderColor: C.border,
                                borderLeftWidth: 3,
                                borderLeftColor: isOut
                                  ? "var(--brand, #c9a83a)"
                                  : channelColor("email"),
                              }}
                            >
                              {/* From / To / time */}
                              <div className="px-4 py-3 border-b flex items-center gap-3" style={{ borderColor: C.border }}>
                                {isOut ? (
                                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                                    style={{ backgroundColor: `color-mix(in srgb, ${channelColor("email")} 18%, transparent)`, color: channelColor("email") }}>
                                    <Icon size={13} />
                                  </div>
                                ) : (
                                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold"
                                    style={{ backgroundColor: leadAvatar.bg, color: leadAvatar.fg }}>
                                    {initials(selected.leadName)}
                                  </div>
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold truncate" style={{ color: C.textPrimary }}>
                                    {isOut ? "Tu equipo" : selected.leadName}
                                    <span className="ml-2 text-[10px] font-normal" style={{ color: C.textMuted }}>
                                      → {isOut ? selected.leadName : "Tu equipo"}
                                    </span>
                                  </p>
                                  <p className="text-[10px]" style={{ color: C.textMuted }}>
                                    <Mail size={9} className="inline mr-1 -mt-0.5" /> Email
                                    {stepLabel && (
                                      <>
                                        <span className="mx-1.5">·</span>
                                        <span className="px-1 py-0.5 rounded" style={{ backgroundColor: C.surface, color: C.textMuted }}>
                                          {stepLabel}
                                        </span>
                                      </>
                                    )}
                                  </p>
                                </div>
                                <span className="text-[10px] tabular-nums shrink-0" style={{ color: C.textDim }}>{time}</span>
                              </div>
                              {/* Subject */}
                              {entry.subject && (
                                <div className="px-4 py-2.5 border-b" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: C.textMuted }}>Subject</p>
                                  <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{entry.subject}</p>
                                </div>
                              )}
                              {/* Body */}
                              <div className="px-4 py-4">
                                {entry.body && entry.body.trim() ? (
                                  <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: C.textBody }}>{entry.body}</p>
                                ) : entry.attachments && entry.attachments.length > 0 ? null : (
                                  <p className="text-sm italic" style={{ color: C.textMuted }}>(sin contenido)</p>
                                )}
                                {entry.attachments && entry.attachments.length > 0 && (
                                  <div className="flex flex-wrap gap-2 mt-3">
                                    {entry.attachments.map((a, ai) => (
                                      a.isImage && a.url ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <a key={ai} href={a.url} target="_blank" rel="noreferrer" className="block">
                                          <img src={a.thumbUrl || a.url} alt={a.name ?? "image"}
                                            className="max-w-[240px] max-h-[240px] rounded-lg border"
                                            style={{ borderColor: C.border, objectFit: "cover" }} />
                                        </a>
                                      ) : (
                                        <a key={ai} href={a.url ?? "#"} target="_blank" rel="noreferrer"
                                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs hover:opacity-85"
                                          style={{ borderColor: C.border, backgroundColor: C.surface, color: C.textBody }}>
                                          <ExternalLink size={11} />
                                          <span className="truncate max-w-[180px]">{a.name ?? "Attachment"}</span>
                                          {a.size != null && (
                                            <span className="text-[10px]" style={{ color: C.textDim }}>{(a.size / 1024).toFixed(0)} KB</span>
                                          )}
                                        </a>
                                      )
                                    ))}
                                  </div>
                                )}
                              </div>
                              {/* Footer: receipts */}
                              {isOut && (entry.seen || entry.delivered) && (
                                <div className="px-4 py-2 border-t flex items-center justify-end gap-1.5 text-[10px]"
                                  style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textDim }}>
                                  {entry.seen ? (
                                    <span className="inline-flex items-center gap-1" style={{ color: channelColor("email") }} title={entry.seenAt ? `Visto ${formatTimeOnly(entry.seenAt)}` : "Visto"}>
                                      <span className="font-bold tracking-tighter">✓✓</span>
                                      <span>Visto{entry.seenAt ? ` ${formatTimeOnly(entry.seenAt)}` : ""}</span>
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1" title="Entregado">
                                      <span className="font-bold tracking-tighter">✓✓</span>
                                      <span>Entregado</span>
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                          <div className={`flex items-end gap-2 ${isOut ? "flex-row-reverse" : "flex-row"}`}>
                            {/* Avatar: lead initials on their bubbles, channel
                                icon on ours so it's clear the bot/seller sent it. */}
                            {isOut ? (
                              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                                style={{ backgroundColor: `color-mix(in srgb, ${channelColor(entry.channel)} 18%, transparent)`, color: channelColor(entry.channel) }}>
                                <Icon size={12} />
                              </div>
                            ) : (
                              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold"
                                style={{ backgroundColor: leadAvatar.bg, color: leadAvatar.fg }}>
                                {initials(selected.leadName)}
                              </div>
                            )}
                            <div className={`flex flex-col max-w-[78%] ${isOut ? "items-end" : "items-start"}`}>
                              <div
                                className="rounded-2xl px-4 py-2.5 space-y-2 shadow-sm"
                                style={{
                                  borderTopLeftRadius: isOut ? 18 : 4,
                                  borderTopRightRadius: isOut ? 4 : 18,
                                  backgroundColor: isOut
                                    ? `color-mix(in srgb, var(--brand, #c9a83a) 14%, transparent)`
                                    : C.card,
                                  border: `1px solid ${isOut ? `color-mix(in srgb, var(--brand, #c9a83a) 28%, transparent)` : C.border}`,
                                  color: C.textPrimary,
                                  boxShadow: `0 1px 2px color-mix(in srgb, ${isOut ? "var(--brand, #c9a83a)" : "#000"} 6%, transparent)`,
                                }}
                              >
                                {entry.body && entry.body.trim() ? (
                                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{entry.body}</p>
                                ) : entry.attachments && entry.attachments.length > 0 ? null : (
                                  <p className="text-sm" style={{ color: C.textMuted }}>(sin contenido)</p>
                                )}
                                {entry.attachments && entry.attachments.length > 0 && (
                                  <div className="flex flex-wrap gap-2">
                                    {entry.attachments.map((a, ai) => (
                                      a.isImage && a.url ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <a key={ai} href={a.url} target="_blank" rel="noreferrer" className="block">
                                          <img
                                            src={a.thumbUrl || a.url}
                                            alt={a.name ?? "image"}
                                            className="max-w-[240px] max-h-[240px] rounded-lg border"
                                            style={{ borderColor: C.border, objectFit: "cover" }}
                                          />
                                        </a>
                                      ) : (
                                        <a
                                          key={ai}
                                          href={a.url ?? "#"}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs hover:opacity-85"
                                          style={{ borderColor: C.border, backgroundColor: C.surface, color: C.textBody }}
                                        >
                                          <ExternalLink size={11} />
                                          <span className="truncate max-w-[180px]">{a.name ?? "Attachment"}</span>
                                          {a.size != null && (
                                            <span className="text-[10px]" style={{ color: C.textDim }}>
                                              {(a.size / 1024).toFixed(0)} KB
                                            </span>
                                          )}
                                        </a>
                                      )
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 mt-1 text-[10px]" style={{ color: C.textDim }}>
                                <span className="tabular-nums">{time}</span>
                                {stepLabel && (
                                  <>
                                    <span>·</span>
                                    <span className="px-1 py-0.5 rounded font-medium" style={{ backgroundColor: C.surface, color: C.textMuted }}>
                                      {stepLabel}
                                    </span>
                                  </>
                                )}
                                {/* Receipt indicator on outbound — single
                                    check = enviado, double check tinted =
                                    entregado, double check brand-tinted +
                                    timestamp = visto. Inspired by
                                    LinkedIn/WhatsApp conventions. */}
                                {isOut && (entry.seen || entry.delivered) && (
                                  <>
                                    <span>·</span>
                                    {entry.seen ? (
                                      <span className="inline-flex items-center gap-1" style={{ color: C.linkedin }} title={entry.seenAt ? `Visto ${formatTimeOnly(entry.seenAt)}` : "Visto"}>
                                        <span className="font-bold tracking-tighter">✓✓</span>
                                        <span>Visto{entry.seenAt ? ` ${formatTimeOnly(entry.seenAt)}` : ""}</span>
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1" title="Entregado">
                                        <span className="font-bold tracking-tighter">✓✓</span>
                                        <span>Entregado</span>
                                      </span>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          )}
                          {isLast && isOut && !entry.seen && (
                            <p className="text-[10px] mt-2 mr-9 text-right" style={{ color: C.textDim }}>
                              Esperando respuesta del lead…
                            </p>
                          )}
                          {isLast && isOut && entry.seen && (
                            <p className="text-[10px] mt-2 mr-9 text-right" style={{ color: C.textDim }}>
                              El lead vio el mensaje{entry.seenAt ? ` (${formatTimeOnly(entry.seenAt)})` : ""} pero todavía no respondió.
                            </p>
                          )}
                        </div>
                      );
                    });
                  })()
                )}
              </div>

              {/* Actions */}
              <div className="px-5 py-3 border-t flex items-center gap-2 flex-wrap" style={{ borderColor: C.border }}>
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>
                  Review
                </span>
                <button
                  onClick={() => review("approved")}
                  disabled={working || selected.reviewStatus === "approved"}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 transition-opacity hover:opacity-85"
                  style={{ backgroundColor: `color-mix(in srgb, ${C.green} 16%, transparent)`, color: C.green, border: `1px solid color-mix(in srgb, ${C.green} 32%, transparent)` }}
                  title="Mark this reply as reviewed (A)"
                >
                  <Check size={12} /> Mark reviewed
                </button>
                <button
                  onClick={() => review("rejected")}
                  disabled={working || selected.reviewStatus === "rejected"}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 transition-opacity hover:opacity-85"
                  style={{ backgroundColor: `color-mix(in srgb, ${C.red} 14%, transparent)`, color: C.red, border: `1px solid color-mix(in srgb, ${C.red} 30%, transparent)` }}
                  title="Reject (closes the review without acting)"
                >
                  <XIcon size={12} /> Reject
                </button>
                {selected.reviewStatus && selected.reviewStatus !== "pending" && (
                  <button
                    onClick={() => review("pending")}
                    disabled={working}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors hover:bg-black/[0.04]"
                    style={{ color: C.textMuted, border: `1px solid ${C.border}` }}
                    title="Send back to the inbox as pending"
                  >
                    Re-open
                  </button>
                )}
                <span className="ml-auto text-[10px]" style={{ color: C.textDim }}>
                  Shortcuts: <kbd className="px-1 py-0.5 rounded border" style={{ borderColor: C.border, color: C.textMuted }}>J</kbd>/<kbd className="px-1 py-0.5 rounded border" style={{ borderColor: C.border, color: C.textMuted }}>K</kbd> nav · <kbd className="px-1 py-0.5 rounded border" style={{ borderColor: C.border, color: C.textMuted }}>A</kbd> approve
                </span>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center px-6 py-12">
              <div className="text-center max-w-[280px]">
                <div className="w-12 h-12 mx-auto mb-3 rounded-2xl flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, var(--brand, #c9a83a) 10%, transparent)` }}>
                  <InboxIcon size={20} style={{ color: "var(--brand, #c9a83a)" }} />
                </div>
                <p className="text-sm font-semibold mb-1" style={{ color: C.textBody }}>Pick a reply to read</p>
                <p className="text-[11px]" style={{ color: C.textMuted }}>
                  Click any item on the left, or use <kbd className="px-1 py-0.5 rounded border" style={{ borderColor: C.border }}>J</kbd>/<kbd className="px-1 py-0.5 rounded border" style={{ borderColor: C.border }}>K</kbd> to navigate.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
