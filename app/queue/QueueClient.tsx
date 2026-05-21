"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { C } from "@/lib/design";
import {
  Phone, Share2, Mail, Megaphone, Target,
  ChevronRight, CheckCircle, Search, X,
  PhoneCall, User, PhoneOff, Bell, AlertTriangle, XCircle, Sparkles,
  ThumbsUp, ThumbsDown, Clock, Loader2,
} from "lucide-react";
import PageHero from "@/components/PageHero";
import CallButton from "@/components/CallButton";
import { classifyUrgency } from "@/lib/overdue";

const gold = "var(--brand, #c9a83a)";

type PendingCall = {
  id: string;
  campaignId: string;
  campaignName: string;
  currentStep: number;
  totalSteps: number;
  leadId: string | null;
  leadName: string;
  company: string | null;
  role: string | null;
  phone: string | null;
  email: string | null;
  sellerName: string | null;
  lastStepAt: string | null;
  isOverdue?: boolean;
  overdueDays?: number;
  aircallNumberId?: number | null;
  latestCall: {
    id: string;
    startedAt: string | null;
    classification: "positive" | "negative" | "follow_up" | null;
  } | null;
};

type NewReply = {
  id: string;
  leadId: string;
  leadName: string;
  company: string | null;
  channel: string;
  classification: string | null;
  replyText: string | null;
  receivedAt: string;
  campaignName: string | null;
  requiresHumanReview?: boolean;
};

type PendingReview = {
  id: string;
  type: "campaign" | "profile";
  name: string;
  subtitle: string;
  createdAt: string;
  href: string;
};

type Update = {
  id: string;
  kind: "campaign" | "profile";
  name: string;
  status: "approved" | "rejected";
  subtitle: string;
  createdAt: string;
  href: string;
};

type Props = {
  pendingCalls: PendingCall[];
  newReplies: NewReply[];
  pendingReviews: PendingReview[];
  updates: Update[];
};

const channelMeta: Record<string, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

const classificationMeta: Record<string, { color: string; bg: string; label: string }> = {
  positive:            { color: C.green,    bg: C.greenLight, label: "Positive" },
  meeting_intent:      { color: C.green,    bg: C.greenLight, label: "Meeting Intent" },
  negative:            { color: C.red,      bg: C.redLight,   label: "Negative" },
  needs_info:          { color: "#D97706",  bg: "#FFFBEB",    label: "Needs Info" },
  not_now:             { color: C.textMuted, bg: C.surface,   label: "Not Now" },
  connection_accepted: { color: "#0A66C2",  bg: "#E7F2FB",    label: "Accepted Connection" },
};

function timeAgo(iso: string | null) {
  if (!iso) return "";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1)  return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Inline classifier for /queue Pending Calls. Reuses /api/calls/[id]/classify
// (same endpoint used in the lead detail CallCard) so the cascade is shared:
// Positive → campaign paused + lead qualified → entry drops out of /queue.
// Negative → campaign failed + lead closed_lost → entry drops out of /queue.
// Follow-up → just labels the call; campaign stays active so the entry
// stays in /queue with a "Follow-up logged" badge until the seller calls
// again and classifies it definitively.
function InlineClassifier({ call }: { call: PendingCall }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"positive" | "negative" | "follow_up" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function classify(c: "positive" | "negative" | "follow_up") {
    if (!call.latestCall) return;
    setBusy(c);
    setErr(null);
    try {
      const res = await fetch(`/api/calls/${call.latestCall.id}/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classification: c }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(body.error ?? `Failed (${res.status})`);
        setBusy(null);
        return;
      }
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
      setBusy(null);
    }
  }

  if (!call.latestCall) return null;

  // Follow-up already logged: show the badge + a re-classify hint.
  if (call.latestCall.classification === "follow_up") {
    return (
      <div className="border-t px-5 py-2.5 flex items-center gap-2 text-[11px] flex-wrap"
        style={{ borderColor: C.border, backgroundColor: "#FFFBEB" }}>
        <Clock size={11} style={{ color: "#D97706" }} />
        <span style={{ color: "#92400E", fontWeight: 600 }}>
          Follow-up logged {timeAgo(call.latestCall.startedAt)}
        </span>
        <span style={{ color: C.textMuted }}>
          · Call again to update outcome
        </span>
        {err && <span className="ml-auto" style={{ color: C.red }}>{err}</span>}
      </div>
    );
  }

  // Call exists, no classification yet → render the 3 buttons.
  // The 'positive'/'negative' actions close the campaign (entry will then
  // disappear from /queue on the next router.refresh()).
  return (
    <div className="border-t px-5 py-2.5 flex items-center gap-2 flex-wrap"
      style={{ borderColor: C.border, backgroundColor: C.bg }}>
      <span className="text-[11px] font-semibold mr-1" style={{ color: C.textBody }}>
        Called {timeAgo(call.latestCall.startedAt)} — outcome?
      </span>
      <button
        onClick={() => classify("positive")}
        disabled={busy !== null}
        className="text-[11px] font-medium px-2.5 py-1 rounded-md border inline-flex items-center gap-1 disabled:opacity-50"
        style={{ backgroundColor: C.greenLight, borderColor: `${C.green}40`, color: C.green }}>
        {busy === "positive" ? <Loader2 size={10} className="animate-spin" /> : <ThumbsUp size={10} />}
        Positive
      </button>
      <button
        onClick={() => classify("negative")}
        disabled={busy !== null}
        className="text-[11px] font-medium px-2.5 py-1 rounded-md border inline-flex items-center gap-1 disabled:opacity-50"
        style={{ backgroundColor: C.redLight, borderColor: `${C.red}40`, color: C.red }}>
        {busy === "negative" ? <Loader2 size={10} className="animate-spin" /> : <ThumbsDown size={10} />}
        Negative
      </button>
      <button
        onClick={() => classify("follow_up")}
        disabled={busy !== null}
        className="text-[11px] font-medium px-2.5 py-1 rounded-md border inline-flex items-center gap-1 disabled:opacity-50"
        style={{ backgroundColor: "#FEF3C7", borderColor: "#FDE68A", color: "#D97706" }}>
        {busy === "follow_up" ? <Loader2 size={10} className="animate-spin" /> : <Clock size={10} />}
        Follow-up
      </button>
      {err && <span className="text-[11px]" style={{ color: C.red }}>{err}</span>}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function QueueClient({ pendingCalls, newReplies, pendingReviews, updates }: Props) {
  const [tab, setTab] = useState(0);
  // Sub-tabs inside "Calls":
  //   0 = To Call (no latestCall — never been dialed for this campaign step)
  //   1 = Awaiting Outcome (latestCall exists, classification null)
  //   2 = Follow-ups (latestCall.classification === 'follow_up' — seller logged
  //       intent to call again later; was previously inflating To Call with
  //       items that don't need attention right now per Pathway feedback
  //       2026-05-15).
  const [callSubTab, setCallSubTab] = useState<0 | 1 | 2>(0);
  const [search, setSearch] = useState("");

  // Date filter for the notification tabs (Replies / Reviews / Updates).
  // Calls tab ignores this — call work is operational and shouldn't be
  // hidden by an age cutoff.
  type DateRange = "today" | "7d" | "30d" | "all";
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const dateCutoffMs = (() => {
    if (dateRange === "today") return new Date(new Date().toDateString()).getTime();
    if (dateRange === "7d")    return Date.now() - 7  * 86400000;
    if (dateRange === "30d")   return Date.now() - 30 * 86400000;
    return 0;
  })();

  // Per-browser dismissal so a seller can clear notifications they've
  // already actioned without affecting other teammates. Stored in
  // localStorage as a set of "queue-dismissed-{id}" entries. Cleared on
  // logout (browser already drops localStorage on incognito close).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("swl-queue-dismissed");
      if (raw) setDismissed(new Set(JSON.parse(raw)));
    } catch { /* ignore */ }
  }, []);
  const dismiss = (id: string) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id);
      try { window.localStorage.setItem("swl-queue-dismissed", JSON.stringify(Array.from(next))); } catch { /* ignore */ }
      return next;
    });
  };
  const clearDismissed = () => {
    setDismissed(new Set());
    try { window.localStorage.removeItem("swl-queue-dismissed"); } catch { /* ignore */ }
  };

  // Split pending calls by classification state. Positive/negative would
  // already have dropped the entry from the queue (campaign ended).
  const callsToMake = pendingCalls.filter(c => !c.latestCall);
  const callsAwaitingOutcome = pendingCalls.filter(c => c.latestCall && c.latestCall.classification === null);
  const callsFollowUp = pendingCalls.filter(c => c.latestCall?.classification === "follow_up");

  const totalCount = pendingCalls.length + newReplies.length + pendingReviews.length + updates.length;
  const needsReviewCount = newReplies.filter(r => r.requiresHumanReview).length;

  const applyCallSearch = (list: PendingCall[]) => !search ? list
    : list.filter(c => `${c.leadName} ${c.company} ${c.campaignName}`.toLowerCase().includes(search.toLowerCase()));

  const filteredCallsToMake = applyCallSearch(callsToMake);
  const filteredCallsAwaiting = applyCallSearch(callsAwaitingOutcome);
  const filteredCallsFollowUp = applyCallSearch(callsFollowUp);
  // Notification tabs (Replies / Reviews / Updates) get date + dismissal
  // filters on top of the search. Calls ignore these.
  const passesDate = (iso: string) => new Date(iso).getTime() >= dateCutoffMs;
  const passesSearch = (haystack: string) => !search || haystack.toLowerCase().includes(search.toLowerCase());

  const filteredReplies = newReplies
    .filter(r => !dismissed.has(r.id))
    .filter(r => passesDate(r.receivedAt))
    .filter(r => passesSearch(`${r.leadName} ${r.company} ${r.campaignName} ${r.replyText}`));
  const filteredReviews = pendingReviews
    .filter(r => !dismissed.has(r.id))
    .filter(r => passesDate(r.createdAt))
    .filter(r => passesSearch(`${r.name} ${r.subtitle}`));
  const filteredUpdates = updates
    .filter(u => !dismissed.has(u.id))
    .filter(u => passesDate(u.createdAt))
    .filter(u => passesSearch(`${u.name} ${u.subtitle}`));

  const tabs = [
    { label: "Calls",           count: pendingCalls.length,   color: "#F97316",  reviewCount: 0 },
    { label: "New Replies",     count: newReplies.length,     color: C.blue,     reviewCount: needsReviewCount },
    { label: "Pending Reviews", count: pendingReviews.length, color: gold,       reviewCount: 0 },
    { label: "Updates",         count: updates.length,        color: "#7C3AED",  reviewCount: 0 },
  ];

  return (
    <div className="p-4 sm:p-6 w-full">
      <PageHero
        icon={Bell}
        section="Operations"
        title="Queue"
        description="Review pending calls, new replies, and campaigns awaiting action."
        accentColor={C.orange}
        status={{ label: totalCount > 0 ? `${totalCount} pending` : "All Clear", active: totalCount > 0 }}
      />

      {/* Tabs + search */}
      <div className="flex items-center gap-1 border-b mb-6" style={{ borderColor: C.border }}>
        {tabs.map((t, i) => {
          const isActive = tab === i;
          return (
            <button key={t.label} onClick={() => setTab(i)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-[opacity,transform,box-shadow,background-color,border-color] relative"
              style={{ color: isActive ? t.color : C.textMuted }}>
              {t.label}
              {t.count > 0 && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: isActive ? `${t.color}15` : C.surface, color: isActive ? t.color : C.textDim }}>
                  {t.count}
                </span>
              )}
              {t.reviewCount > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: "#FEF3C7", color: "#D97706" }}>
                  <AlertTriangle size={9} /> {t.reviewCount}
                </span>
              )}
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: t.color }} />}
            </button>
          );
        })}
        <div className="flex-1" />
        <div className="flex items-center gap-2 mb-1">
          {/* Date filter — only affects notification tabs. Calls keep all. */}
          {tab !== 0 && (
            <select
              value={dateRange}
              onChange={e => setDateRange(e.target.value as DateRange)}
              className="rounded-lg border px-2.5 py-1.5 text-xs font-medium outline-none"
              style={{ borderColor: C.border, backgroundColor: C.card, color: C.textBody }}>
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="all">All time</option>
            </select>
          )}
          {/* Restore button when stuff has been dismissed locally. */}
          {dismissed.size > 0 && tab !== 0 && (
            <button onClick={clearDismissed}
              className="text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors"
              style={{ borderColor: C.border, color: C.textMuted, backgroundColor: C.card }}
              title={`Restore ${dismissed.size} dismissed item${dismissed.size === 1 ? "" : "s"}`}>
              Restore {dismissed.size}
            </button>
          )}
          <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
            style={{ borderColor: C.border, backgroundColor: C.card }}>
            <Search size={13} style={{ color: C.textDim }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search..." className="bg-transparent text-sm outline-none w-36"
              style={{ color: C.textPrimary }} />
            {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
          </div>
        </div>
      </div>

      {/* ═══ Tab 0: Calls (To Call / Awaiting Outcome / Follow-ups) ═══ */}
      {tab === 0 && (() => {
        const activeList = callSubTab === 0 ? filteredCallsToMake
          : callSubTab === 1 ? filteredCallsAwaiting
          : filteredCallsFollowUp;
        const emptyCopy = callSubTab === 0
          ? { title: search ? "No calls match your search" : "No calls to make", hint: "Calls appear when a campaign sequence reaches a call step." }
          : callSubTab === 1
          ? { title: search ? "No calls match your search" : "Nothing to classify", hint: "Once you call a lead, it shows up here until you log the outcome." }
          : { title: search ? "No follow-ups match your search" : "No follow-ups scheduled", hint: "Leads you classified as Follow-up live here until you call them again." };

        return (
          <>
            {/* Sub-tab nav */}
            <div className="flex items-center gap-1 mb-4 rounded-lg border p-1 w-fit"
              style={{ borderColor: C.border, backgroundColor: C.card }}>
              {([
                { idx: 0 as const, label: "To Call",           count: callsToMake.length,           icon: PhoneCall },
                { idx: 1 as const, label: "Awaiting Outcome",  count: callsAwaitingOutcome.length,  icon: Clock     },
                { idx: 2 as const, label: "Follow-ups",        count: callsFollowUp.length,         icon: Clock     },
              ]).map(s => {
                const active = callSubTab === s.idx;
                const Icon = s.icon;
                return (
                  <button key={s.idx} onClick={() => setCallSubTab(s.idx)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors"
                    style={{
                      backgroundColor: active ? "#F9731618" : "transparent",
                      color: active ? "#F97316" : C.textMuted,
                    }}>
                    <Icon size={11} /> {s.label}
                    {s.count > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-0.5"
                        style={{ backgroundColor: active ? "#F9731628" : C.surface, color: active ? "#F97316" : C.textDim }}>
                        {s.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {activeList.length === 0 ? (
              <div className="rounded-2xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
                <CheckCircle size={28} className="mx-auto mb-3" style={{ color: C.green }} />
                <p className="text-sm font-medium" style={{ color: C.textBody }}>{emptyCopy.title}</p>
                <p className="text-xs mt-1" style={{ color: C.textMuted }}>{emptyCopy.hint}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeList.map(call => {
                  const urgency = classifyUrgency(call.isOverdue ? call.overdueDays ?? 0 : null);
                  const UIcon = urgency.icon;
                  const isEscalated = urgency.level === "critical" || urgency.level === "stuck";
                  const awaitingOutcome = callSubTab === 1;
                  const isFollowUp = callSubTab === 2;
                  return (
                    <div key={call.id} className="rounded-2xl border transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-md" style={{ backgroundColor: C.card, borderColor: isEscalated ? urgency.border : C.border, borderLeftWidth: isEscalated ? 3 : 1, borderLeftColor: isEscalated ? urgency.color : undefined, boxShadow: "0 4px 16px rgba(0,0,0,0.04)" }}>
                      <div className="flex items-center gap-4 px-5 py-4">
                        {/* Avatar */}
                        <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
                          style={{ background: "linear-gradient(135deg, #F97316, #FB923C)", color: "#fff" }}>
                          <PhoneCall size={22} />
                        </div>

                        {/* Lead info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <Link href={call.leadId ? `/leads/${call.leadId}` : "#"}
                              className="text-sm font-bold hover:underline" style={{ color: C.textPrimary }}>
                              {call.leadName}
                            </Link>
                            {call.company && <span className="text-xs" style={{ color: C.textMuted }}>· {call.company}</span>}
                            {call.isOverdue && !awaitingOutcome && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: urgency.bg, color: urgency.color, border: `1px solid ${urgency.border}` }}>
                                <UIcon size={9} /> {urgency.label}
                              </span>
                            )}
                          </div>
                          {call.role && <p className="text-xs" style={{ color: C.textMuted }}>{call.role}</p>}
                          <p className="text-[10px] mt-1" style={{ color: C.textDim }}>
                            {call.campaignName} · Step {call.currentStep + 1}/{call.totalSteps}
                            {call.sellerName && <> · Assigned to <span style={{ color: C.text, fontWeight: 500 }}>{call.sellerName}</span></>}
                            {call.lastStepAt && <> · Last activity {timeAgo(call.lastStepAt)}</>}
                            {call.isOverdue && !awaitingOutcome && <> · {urgency.hint}</>}
                          </p>
                        </div>

                        {/* Actions — in "awaiting outcome" the Call button is
                            demoted to a small "Call again" link so the inline
                            classify buttons below become the primary action. */}
                        <div className="flex items-center gap-2 shrink-0">
                          {call.leadId ? (
                            awaitingOutcome ? (
                              <CallButton phone={call.phone} leadId={call.leadId} size="sm" variant="ghost" label="Call again" defaultNumberId={call.aircallNumberId ?? null} />
                            ) : (
                              <CallButton phone={call.phone} leadId={call.leadId} size="md" defaultNumberId={call.aircallNumberId ?? null} />
                            )
                          ) : (
                            <span className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-xs"
                              style={{ backgroundColor: C.surface, color: C.textDim }}>
                              <PhoneOff size={12} /> No lead linked
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Inline classifier — shows in Awaiting Outcome with
                          the 3 outcome buttons. In To Call sub-tab it only
                          appears for entries with a follow-up logged. */}
                      <InlineClassifier call={call} />

                      {/* Footer bar */}
                      <div className="border-t px-5 py-3 flex items-center gap-4 rounded-b-xl"
                        style={{ borderColor: C.border, backgroundColor: C.bg }}>
                        <Link href={call.leadId ? `/leads/${call.leadId}` : "#"}
                          className="text-[10px] font-medium hover:underline flex items-center gap-1" style={{ color: gold }}>
                          <User size={10} /> Lead Profile
                        </Link>
                        <Link href={`/campaigns/${call.campaignId}`}
                          className="text-[10px] font-medium hover:underline flex items-center gap-1" style={{ color: gold }}>
                          <Megaphone size={10} /> Campaign
                        </Link>
                        {call.email && (
                          <span className="text-[10px] ml-auto" style={{ color: C.textDim }}>{call.email}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        );
      })()}

      {/* ═══ Tab 1: New Replies ═══ */}
      {tab === 1 && (
        filteredReplies.length === 0 ? (
          <div className="rounded-2xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
            <CheckCircle size={28} className="mx-auto mb-3" style={{ color: C.green }} />
            <p className="text-sm font-medium" style={{ color: C.textBody }}>
              {search ? "No replies match your search" : "No replies yet"}
            </p>
          </div>
        ) : (
          <>
            {needsReviewCount > 0 && !search && (
              <div className="flex items-center gap-3 rounded-2xl border px-4 py-3 mb-4"
                style={{ background: "linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)", borderColor: "#FCD34D", boxShadow: "0 4px 16px rgba(217, 119, 6, 0.08)" }}>
                <AlertTriangle size={16} style={{ color: "#D97706" }} className="shrink-0" />
                <p className="text-sm font-medium" style={{ color: "#92400E" }}>
                  {needsReviewCount} {needsReviewCount === 1 ? "reply needs" : "replies need"} your attention — the AI answered but flagged these for human review.
                </p>
              </div>
            )}
            <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
              {filteredReplies.map((r, i) => {
                const cls = classificationMeta[r.classification ?? ""] ?? { color: C.textMuted, bg: C.surface, label: r.classification ?? "Reply" };
                const chMeta = channelMeta[r.channel] ?? channelMeta.email;
                const ChIcon = chMeta.icon;

                return (
                  <Link key={r.id} href={`/leads/${r.leadId}`}
                    className="flex gap-4 px-5 py-4 transition-colors hover:bg-black/[0.015] group"
                    style={{
                      borderTop: i > 0 ? `1px solid ${C.border}` : "none",
                      borderLeft: r.requiresHumanReview ? "3px solid #F59E0B" : "3px solid transparent",
                    }}>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5"
                      style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#fff" }}>
                      {(r.leadName[0] ?? "?").toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-semibold group-hover:underline" style={{ color: C.textPrimary }}>{r.leadName}</span>
                        {r.company && <span className="text-xs" style={{ color: C.textMuted }}>· {r.company}</span>}
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: cls.bg, color: cls.color }}>
                          {cls.label}
                        </span>
                        {r.requiresHumanReview && (
                          <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded"
                            style={{ backgroundColor: "#FEF3C7", color: "#D97706" }}>
                            <AlertTriangle size={9} /> Review
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mb-2 text-[10px]" style={{ color: C.textMuted }}>
                        <span className="flex items-center gap-1" style={{ color: chMeta.color }}>
                          <ChIcon size={10} /> {chMeta.label}
                        </span>
                        {r.campaignName && <span>· {r.campaignName}</span>}
                      </div>
                      {r.replyText ? (
                        <div className="rounded-lg px-3 py-2.5 border" style={{ backgroundColor: cls.bg, borderColor: cls.color + "20" }}>
                          <p className="text-xs leading-relaxed" style={{ color: C.textBody }}>
                            &ldquo;{r.replyText}&rdquo;
                          </p>
                        </div>
                      ) : r.classification === "connection_accepted" ? (
                        <div className="rounded-lg px-3 py-2.5 border" style={{ backgroundColor: cls.bg, borderColor: cls.color + "20" }}>
                          <p className="text-xs leading-relaxed" style={{ color: C.textBody }}>
                            Accepted your LinkedIn connection request. First DM will go out in the next dispatch tick.
                          </p>
                        </div>
                      ) : (
                        <p className="text-[10px] italic" style={{ color: C.textDim }}>No reply text</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end shrink-0 gap-1">
                      <span className="text-[10px]" style={{ color: C.textDim }}>{timeAgo(r.receivedAt)}</span>
                      <ChevronRight size={13} style={{ color: C.textDim }} />
                    </div>
                    {/* Dismiss button — preventDefault so it doesn't follow
                        the parent <Link>. Reveals on hover (group-hover). */}
                    <button
                      onClick={e => { e.preventDefault(); e.stopPropagation(); dismiss(r.id); }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-black/[0.05] shrink-0 self-start"
                      title="Dismiss this notification"
                      style={{ color: C.textDim }}>
                      <X size={13} />
                    </button>
                  </Link>
                );
              })}
            </div>
          </>
        )
      )}

      {/* ═══ Tab 2: Pending Reviews ═══ */}
      {tab === 2 && (() => {
        const campaigns = filteredReviews.filter(r => r.type === "campaign");
        const profiles = filteredReviews.filter(r => r.type === "profile");

        if (filteredReviews.length === 0) return (
          <div className="rounded-2xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
            <CheckCircle size={28} className="mx-auto mb-3" style={{ color: C.green }} />
            <p className="text-sm font-medium" style={{ color: C.textBody }}>
              {search ? "No reviews match your search" : "All caught up"}
            </p>
          </div>
        );

        return (
          <div className="space-y-6">
            {campaigns.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Megaphone size={14} style={{ color: gold }} />
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Campaigns ({campaigns.length})</h3>
                </div>
                <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
                  {campaigns.map((review, i) => (
                    <Link key={review.id} href={review.href}
                      className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-black/[0.015]"
                      style={{ borderBottom: i < campaigns.length - 1 ? `1px solid ${C.border}` : "none" }}>
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `color-mix(in srgb, ${gold} 7%, transparent)` }}>
                        <Megaphone size={15} style={{ color: gold }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{review.name}</p>
                        <p className="text-xs" style={{ color: C.textMuted }}>{review.subtitle}</p>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded shrink-0" style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}>Under Review</span>
                      <span className="text-[10px] shrink-0" style={{ color: C.textDim }}>{timeAgo(review.createdAt)}</span>
                      <ChevronRight size={13} style={{ color: C.textDim }} className="shrink-0" />
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {profiles.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Target size={14} style={{ color: C.blue }} />
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Lead Gen Profiles ({profiles.length})</h3>
                </div>
                <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
                  {profiles.map((review, i) => (
                    <Link key={review.id} href={review.href}
                      className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-black/[0.015]"
                      style={{ borderBottom: i < profiles.length - 1 ? `1px solid ${C.border}` : "none" }}>
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${C.blue}12` }}>
                        <Target size={15} style={{ color: C.blue }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{review.name}</p>
                        <p className="text-xs" style={{ color: C.textMuted }}>{review.subtitle}</p>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded shrink-0" style={{ backgroundColor: C.blueLight, color: C.blue }}>Under Review</span>
                      <span className="text-[10px] shrink-0" style={{ color: C.textDim }}>{timeAgo(review.createdAt)}</span>
                      <ChevronRight size={13} style={{ color: C.textDim }} className="shrink-0" />
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ═══ Tab 3: Updates (approved / rejected) ═══ */}
      {tab === 3 && (
        filteredUpdates.length === 0 ? (
          <div className="rounded-2xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
            <CheckCircle size={28} className="mx-auto mb-3" style={{ color: C.green }} />
            <p className="text-sm font-medium" style={{ color: C.textBody }}>
              {search ? "No updates match your search" : "No recent updates"}
            </p>
            <p className="text-xs mt-1" style={{ color: C.textMuted }}>
              Updates from the last 14 days will appear here.
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
            {filteredUpdates.map((u, i) => {
              const isApproved = u.status === "approved";
              const color = isApproved ? C.green : C.red;
              const bg = isApproved ? C.greenLight : C.redLight;
              const StatusIcon = isApproved ? Sparkles : XCircle;
              const KindIcon = u.kind === "campaign" ? Megaphone : Target;
              const message = isApproved
                ? (u.kind === "campaign" ? "Campaign approved — leads are now in sequence" : "ICP profile approved — you can use it in campaigns")
                : (u.kind === "campaign" ? "Campaign rejected" : "ICP profile rejected");

              return (
                <Link key={u.id} href={u.href}
                  className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-black/[0.015] group"
                  style={{
                    borderTop: i > 0 ? `1px solid ${C.border}` : "none",
                    borderLeft: `3px solid ${color}`,
                  }}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                    style={{ backgroundColor: bg }}>
                    <StatusIcon size={15} style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold" style={{ color: C.textPrimary }}>{u.name}</span>
                      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: bg, color }}>
                        <KindIcon size={9} /> {u.kind === "campaign" ? "Outreach Flow" : "ICP Profile"} · {isApproved ? "APPROVED" : "REJECTED"}
                      </span>
                    </div>
                    <p className="text-xs" style={{ color: C.textBody }}>{message}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: C.textDim }}>{u.subtitle}</p>
                  </div>
                  <div className="flex flex-col items-end shrink-0 gap-1">
                    <span className="text-[10px]" style={{ color: C.textDim }}>{timeAgo(u.createdAt)}</span>
                    <ChevronRight size={13} style={{ color: C.textDim }} />
                  </div>
                  <button
                    onClick={e => { e.preventDefault(); e.stopPropagation(); dismiss(u.id); }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-black/[0.05] shrink-0 self-start"
                    title="Dismiss this update"
                    style={{ color: C.textDim }}>
                    <X size={13} />
                  </button>
                </Link>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
