"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import InboxView, { type InboxReply } from "@/components/InboxView";
import ChatPanel from "@/components/ChatPanel";
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
  secondaryPhone: string | null;
  // Surfaced from leads.allow_call so the Notifications card can flash a
  // "Wrong number" badge next to the phone. false = the post-call popup
  // flagged the number; the badge clicks through to the lead detail
  // where the WrongNumberPill opens its inline replace flow.
  allowCall?: boolean | null;
  email: string | null;
  sellerName: string | null;
  talkingPoints: Array<string | { type: "pain" | "fit" | "opener"; text: string }> | null;
  callAdvanceMode: "auto" | "manual";
  lastStepAt: string | null;
  isOverdue?: boolean;
  overdueDays?: number;
  aircallNumberId?: number | null;
  latestCall: {
    id: string;
    startedAt: string | null;
    classification: "positive" | "negative" | "follow_up" | "wrong_number" | null;
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
  icpProfileName?: string | null;
  requiresHumanReview?: boolean;
  // Persisted review state on the lead_replies row. The Inbox view reads
  // this to disable "Mark reviewed" when the reply is already approved
  // (and "Reject" when already rejected). Without it the buttons render
  // active even on rows that have nothing left to do — the API call
  // succeeds idempotently but the seller sees no visible change.
  reviewStatus?: "pending" | "approved" | "rejected" | null;
};

type Props = {
  pendingCalls: PendingCall[];
  newReplies: NewReply[];
};

const channelMeta: Record<string, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

// Tinted backgrounds derived from the accent color (not hardcoded light
// hexes) so the reply / classification chips read correctly in BOTH light
// and dark mode. color-mix(... transparent) yields a translucent wash that
// sits on top of whatever the underlying card surface is.
const tint = (color: string, pct = 12) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
const classificationMeta: Record<string, { color: string; bg: string; label: string }> = {
  // Labels mirror the post-call outcome popup so the History entry the
  // seller sees in Notifications matches the button they tapped.
  positive:            { color: C.green,    bg: tint(C.green, 12),   label: "Interested" },
  meeting_intent:      { color: C.green,    bg: tint(C.green, 12),   label: "Meeting Intent" },
  negative:            { color: C.red,      bg: tint(C.red, 12),     label: "Not interested" },
  needs_info:          { color: "#D97706",  bg: tint("#D97706", 12), label: "Needs Info" },
  not_now:             { color: C.textMuted, bg: tint(C.textMuted, 10), label: "Not Now" },
  follow_up:           { color: "#D97706",  bg: tint("#D97706", 12), label: "Bad timing" },
  wrong_number:        { color: C.textMuted, bg: tint(C.textMuted, 10), label: "Wrong number" },
  connection_accepted: { color: "#0A66C2",  bg: tint("#0A66C2", 12), label: "Accepted Connection" },
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
  // 2026-06-01: aligned with the 4 outcomes the post-call popup uses.
  // Wire values stay legacy-compatible (interested → positive, etc.) so
  // the existing classify endpoint + downstream cascades don't need to
  // change. `wrong_number` is the new fourth value — it disables the
  // call channel on the lead and skips queued call steps.
  const [busy, setBusy] = useState<"positive" | "negative" | "follow_up" | "wrong_number" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function classify(c: "positive" | "negative" | "follow_up" | "wrong_number") {
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

  // Already classified: show the matching badge + a re-classify hint.
  // follow_up renders "Bad timing logged", wrong_number renders "Wrong
  // number logged". Positive/negative don't reach this branch — those
  // collapse the campaign and remove the entry from /queue entirely.
  if (call.latestCall.classification === "follow_up" || call.latestCall.classification === "wrong_number") {
    const isFollow = call.latestCall.classification === "follow_up";
    const color = isFollow ? "#D97706" : C.textMuted;
    const Icon = isFollow ? Clock : PhoneOff;
    const label = isFollow ? "Bad timing logged" : "Wrong number logged";
    const hint = isFollow ? "Call again to update outcome" : "Call channel disabled — update the phone to re-enable";
    return (
      <div className="border-t px-5 py-2.5 flex items-center gap-2 text-[11px] flex-wrap"
        style={{ borderColor: C.border, backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)` }}>
        <Icon size={11} style={{ color }} />
        <span style={{ color, fontWeight: 600 }}>
          {label} {timeAgo(call.latestCall.startedAt)}
        </span>
        <span style={{ color: C.textMuted }}>· {hint}</span>
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
        style={{ backgroundColor: `color-mix(in srgb, ${C.green} 12%, transparent)`, borderColor: `color-mix(in srgb, ${C.green} 35%, transparent)`, color: C.green }}>
        {busy === "positive" ? <Loader2 size={10} className="animate-spin" /> : <ThumbsUp size={10} />}
        Interested
      </button>
      <button
        onClick={() => classify("negative")}
        disabled={busy !== null}
        className="text-[11px] font-medium px-2.5 py-1 rounded-md border inline-flex items-center gap-1 disabled:opacity-50"
        style={{ backgroundColor: `color-mix(in srgb, ${C.red} 12%, transparent)`, borderColor: `color-mix(in srgb, ${C.red} 35%, transparent)`, color: C.red }}>
        {busy === "negative" ? <Loader2 size={10} className="animate-spin" /> : <ThumbsDown size={10} />}
        Not interested
      </button>
      <button
        onClick={() => classify("follow_up")}
        disabled={busy !== null}
        className="text-[11px] font-medium px-2.5 py-1 rounded-md border inline-flex items-center gap-1 disabled:opacity-50"
        style={{ backgroundColor: "color-mix(in srgb, #D97706 12%, transparent)", borderColor: "color-mix(in srgb, #D97706 35%, transparent)", color: "#D97706" }}>
        {busy === "follow_up" ? <Loader2 size={10} className="animate-spin" /> : <Clock size={10} />}
        Bad timing
      </button>
      <button
        onClick={() => classify("wrong_number")}
        disabled={busy !== null}
        className="text-[11px] font-medium px-2.5 py-1 rounded-md border inline-flex items-center gap-1 disabled:opacity-50"
        style={{ backgroundColor: C.surface, borderColor: C.border, color: C.textMuted }}>
        {busy === "wrong_number" ? <Loader2 size={10} className="animate-spin" /> : <PhoneOff size={10} />}
        Wrong number
      </button>
      {err && <span className="text-[11px]" style={{ color: C.red }}>{err}</span>}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function QueueClient({ pendingCalls, newReplies }: Props) {
  const searchParams = useSearchParams();
  // Deep-linked tab via `?tab=calls` / `?tab=inbox` / `?tab=history`. Per
  // boss feedback 2026-05-27, History is now the first tab — that's the
  // surface sellers want when they open Notifications (positive replies +
  // acceptances). Calls is second. Removed `?tab=reviews` / `?tab=updates`
  // — those tabs were deleted; bookmarks land on History.
  const initialTab = (() => {
    const t = searchParams.get("tab");
    if (t === "calls") return 1;
    if (t === "chat") return 2;
    return 0;
  })();
  const [tab, setTab] = useState(initialTab);
  // Sub-tabs inside "Calls":
  //   0 = To Call (no latestCall — never been dialed for this campaign step)
  //   1 = Awaiting Outcome (latestCall exists, classification null)
  //   2 = Follow-ups (latestCall.classification === 'follow_up' — seller logged
  //       intent to call again later; was previously inflating To Call with
  //       items that don't need attention right now per Pathway feedback
  //       2026-05-15).
  const [callSubTab, setCallSubTab] = useState<0 | 1 | 2>(0);
  const [search, setSearch] = useState("");

  // History tab manages its own date filter inside InboxView now (used to
  // be a toolbar dropdown here but it felt disconnected from the filter
  // chips in the sidebar). Calls tab ignores date — call work is
  // operational and shouldn't be hidden by an age cutoff.

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
  //
  // Sort logic per bucket:
  //   • To Call: most overdue first (so the call that's been waiting longest
  //     and likely blocking the sequence is at the top). Within ties, those
  //     marked overdue rank above non-overdue.
  //   • Awaiting Outcome: oldest call-attempt first (longest waiting for the
  //     seller to classify so the queue doesn't stack indefinitely).
  //   • Follow-ups: same as Awaiting Outcome (oldest first), so the lead
  //     deferred longest gets prioritized.
  const overduenessRank = (c: PendingCall) =>
    (c.isOverdue ? 1_000_000 : 0) + (c.overdueDays ?? 0);
  const callsToMake = pendingCalls
    .filter(c => !c.latestCall)
    .sort((a, b) => overduenessRank(b) - overduenessRank(a));
  const callsAwaitingOutcome = pendingCalls
    .filter(c => c.latestCall && c.latestCall.classification === null)
    .sort((a, b) => {
      const at = a.latestCall?.startedAt ? new Date(a.latestCall.startedAt).getTime() : 0;
      const bt = b.latestCall?.startedAt ? new Date(b.latestCall.startedAt).getTime() : 0;
      return at - bt;
    });
  const callsFollowUp = pendingCalls
    .filter(c => c.latestCall?.classification === "follow_up")
    .sort((a, b) => {
      const at = a.latestCall?.startedAt ? new Date(a.latestCall.startedAt).getTime() : 0;
      const bt = b.latestCall?.startedAt ? new Date(b.latestCall.startedAt).getTime() : 0;
      return at - bt;
    });

  // Sort replies: positive / meeting_intent first (closing window!), then
  // any human-review-required, then everything else by most recent.
  const replyPriority = (r: NewReply) => {
    if (r.classification === "positive" || r.classification === "meeting_intent") return 0;
    if (r.requiresHumanReview) return 1;
    if (r.classification === "question") return 2;
    return 3;
  };
  const sortedReplies = [...newReplies].sort((a, b) => {
    const pa = replyPriority(a); const pb = replyPriority(b);
    if (pa !== pb) return pa - pb;
    return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
  });

  const totalCount = pendingCalls.length + newReplies.length;
  const needsReviewCount = newReplies.filter(r => r.requiresHumanReview).length;

  const applyCallSearch = (list: PendingCall[]) => !search ? list
    : list.filter(c => `${c.leadName} ${c.company} ${c.campaignName}`.toLowerCase().includes(search.toLowerCase()));

  const filteredCallsToMake = applyCallSearch(callsToMake);
  const filteredCallsAwaiting = applyCallSearch(callsAwaitingOutcome);
  const filteredCallsFollowUp = applyCallSearch(callsFollowUp);
  // History tab gets the dismissal filter applied here at the QueueClient
  // level. Date + search + campaign/icp/channel filters live inside
  // InboxView so the seller can change them without round-tripping
  // through page state.
  const filteredReplies = sortedReplies.filter(r => !dismissed.has(r.id));

  // Notifications now only carries History + Calls. Boss feedback 2026-05-27:
  // History is first (sellers open Notifications to triage replies +
  // acceptances, not to start cold calls). Pending Reviews + Updates tabs
  // were deleted entirely. Today's Focus card was removed too.
  const tabs = [
    { label: "History", count: newReplies.length,   color: C.blue,    reviewCount: needsReviewCount },
    { label: "Calls",   count: pendingCalls.length, color: "#F97316", reviewCount: 0 },
    { label: "Chat",    count: 0,                    color: "#7C3AED", reviewCount: 0 },
  ];

  return (
    <div className="p-4 sm:p-6 w-full">
      <PageHero
        icon={Bell}
        section="Operations"
        title="Notifications"
        description="Review pending calls, new replies, and campaigns awaiting action."
        accentColor={C.orange}
        status={{ label: totalCount > 0 ? `${totalCount} pending` : "All Clear", active: totalCount > 0 }}
        stats={[
          { label: "Calls to make", value: pendingCalls.length, tone: pendingCalls.length > 0 ? "warning" : "neutral" },
          { label: "New replies", value: newReplies.length, tone: newReplies.length > 0 ? "positive" : "neutral" },
          { label: "Need review", value: needsReviewCount, tone: needsReviewCount > 0 ? "danger" : "neutral" },
        ]}
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
                  style={{ backgroundColor: "color-mix(in srgb, #D97706 14%, transparent)", color: "#D97706" }}>
                  <AlertTriangle size={9} /> {t.reviewCount}
                </span>
              )}
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: t.color }} />}
            </button>
          );
        })}
        <div className="flex-1" />
        <div className="flex items-center gap-2 mb-1">
          {/* History manages its own filters (date, campaign, ICP, channel,
              search) inside the sidebar. Out here we only keep the
              "Restore dismissed" + the global search input for the Calls
              tab. */}
          {dismissed.size > 0 && tab !== 1 && (
            <button onClick={clearDismissed}
              className="text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors"
              style={{ borderColor: C.border, color: C.textMuted, backgroundColor: C.card }}
              title={`Restore ${dismissed.size} dismissed item${dismissed.size === 1 ? "" : "s"}`}>
              Restore {dismissed.size}
            </button>
          )}
          {tab === 1 && (
            <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
              style={{ borderColor: C.border, backgroundColor: C.card }}>
              <Search size={13} style={{ color: C.textDim }} />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search..." className="bg-transparent text-sm outline-none w-36"
                style={{ color: C.textPrimary }} />
              {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
            </div>
          )}
        </div>
      </div>

      {/* ═══ Tab 1: Calls (To Call / Awaiting Outcome / Follow-ups) ═══ */}
      {tab === 1 && (() => {
        const activeList = callSubTab === 0 ? filteredCallsToMake
          : callSubTab === 1 ? filteredCallsAwaiting
          : filteredCallsFollowUp;
        const emptyCopy = callSubTab === 0
          ? {
              title: search ? "No calls match your search" : "No calls due right now",
              hint: search
                ? "Try clearing the search to see all pending calls."
                : "Calls show up here the moment a sequence reaches a call step. Nothing for you to do right now — good time to triage your inbox or check Flows.",
              ctaLabel: search ? null : "Open Inbox",
              ctaTab: null,
              ctaHref: "/inbox",
            }
          : callSubTab === 1
          ? {
              title: search ? "No calls match your search" : "Nothing to classify",
              hint: "Once you call a lead, it lands here until you log the outcome (Positive / Negative / Follow-up). Classifying calls is what keeps the AI's reply matching accurate.",
              ctaLabel: null,
              ctaTab: null,
              ctaHref: null,
            }
          : {
              title: search ? "No follow-ups match your search" : "No follow-ups waiting",
              hint: "Leads you marked Follow-up live here until you dial them again. Empty means you're caught up — back to To Call.",
              ctaLabel: "Back to To Call",
              ctaTab: 0 as 0,
              ctaHref: null,
            };

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
              <div className="rounded-2xl border py-12 px-6 text-center max-w-xl mx-auto"
                style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
                <div className="w-12 h-12 mx-auto mb-3 rounded-2xl flex items-center justify-center"
                  style={{ backgroundColor: `color-mix(in srgb, ${C.green} 12%, transparent)` }}>
                  <CheckCircle size={22} style={{ color: C.green }} />
                </div>
                <p className="text-sm font-bold mb-1.5" style={{ color: C.textPrimary }}>{emptyCopy.title}</p>
                <p className="text-xs leading-relaxed" style={{ color: C.textMuted }}>{emptyCopy.hint}</p>
                {emptyCopy.ctaLabel && (emptyCopy.ctaTab !== null || emptyCopy.ctaHref) && (
                  <button onClick={() => {
                    if (emptyCopy.ctaHref) { router.push(emptyCopy.ctaHref); return; }
                    if (emptyCopy.ctaTab === 0) setCallSubTab(0);
                    else if (emptyCopy.ctaTab !== null) setTab(emptyCopy.ctaTab as number);
                  }}
                    className="inline-flex items-center gap-1.5 mt-4 text-xs font-semibold px-3.5 py-1.5 rounded-lg transition-opacity hover:opacity-85"
                    style={{ backgroundColor: gold, color: "#04070d" }}>
                    {emptyCopy.ctaLabel} <ChevronRight size={12} />
                  </button>
                )}
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
                            {call.sellerName && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: "#EFF6FF", color: "#1D4ED8", border: "1px solid #BFDBFE" }}>
                                {call.sellerName}
                              </span>
                            )}
                            {call.callAdvanceMode === "manual" && (
                              <span title="Sequence frozen until the seller dials. No auto-advance."
                                className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: "color-mix(in srgb, #D97706 14%, transparent)", color: "#D97706", border: "1px solid color-mix(in srgb, #D97706 32%, transparent)" }}>
                                Manual gate
                              </span>
                            )}
                          </div>
                          {call.role && <p className="text-xs" style={{ color: C.textMuted }}>{call.role}</p>}
                          <p className="text-[10px] mt-1" style={{ color: C.textDim }}>
                            {call.campaignName} · Step {call.currentStep + 1}/{call.totalSteps}
                            {call.lastStepAt && <> · Last activity {timeAgo(call.lastStepAt)}</>}
                            {call.isOverdue && !awaitingOutcome && <> · {urgency.hint}</>}
                          </p>
                        </div>

                        {/* Actions — in "awaiting outcome" the Call button is
                            demoted to a small "Call again" link so the inline
                            classify buttons below become the primary action.
                            An "Open lead" button is added next to it (boss
                            feedback 2026-05-27 — sellers wanted an explicit
                            jump per row, not just the name link). */}
                        <div className="flex items-center gap-2 shrink-0 relative group/call">
                          {/* Wrong-number badge — only when the lead's
                              allow_call is false. Click → lead detail
                              (anchored at the top so the WrongNumberPill
                              is the first action the seller sees). */}
                          {call.leadId && call.allowCall === false && (
                            <Link
                              href={`/leads/${call.leadId}`}
                              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-opacity hover:opacity-85"
                              style={{
                                backgroundColor: "color-mix(in srgb, #DC2626 14%, transparent)",
                                color: "#DC2626",
                                border: "1px solid color-mix(in srgb, #DC2626 35%, transparent)",
                              }}
                              title="Phone marked wrong via post-call outcome. Open lead detail to replace."
                            >
                              <AlertTriangle size={11} />
                              Wrong number
                            </Link>
                          )}
                          {call.leadId && (
                            <Link
                              href={`/leads/${call.leadId}`}
                              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-opacity hover:opacity-80"
                              style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textBody }}
                              title="Open lead detail"
                            >
                              <User size={11} /> Open lead
                            </Link>
                          )}
                          {call.leadId ? (() => {
                            // Build phones array so the seller can pick Mobile vs Work
                            // when the lead has both. Single-phone leads fall back to
                            // the `phone` prop and the picker stays hidden inside the
                            // CallButton component.
                            const phonesList = [
                              ...(call.phone ? [{ label: "Personal", value: call.phone }] : []),
                              ...(call.secondaryPhone ? [{ label: "Company", value: call.secondaryPhone }] : []),
                            ];
                            return awaitingOutcome ? (
                              <CallButton phone={call.phone ?? call.secondaryPhone ?? null} leadId={call.leadId} size="sm" variant="ghost" label="Call again" defaultNumberId={call.aircallNumberId ?? null} phones={phonesList} />
                            ) : (
                              <CallButton phone={call.phone ?? call.secondaryPhone ?? null} leadId={call.leadId} size="md" defaultNumberId={call.aircallNumberId ?? null} phones={phonesList} />
                            );
                          })() : (
                            <span className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-xs"
                              style={{ backgroundColor: C.surface, color: C.textDim }}>
                              <PhoneOff size={12} /> No lead linked
                            </span>
                          )}
                          {/* Hover preview of the AI talking points — surfaces the
                              same brief that lives on the lead detail page so the
                              seller doesn't have to leave the Queue to read it. */}
                          {call.talkingPoints && call.talkingPoints.length > 0 && (
                            <div className="absolute right-0 top-full mt-2 w-96 z-50 hidden group-hover/call:block pointer-events-none">
                              <div className="rounded-xl border p-3 shadow-lg"
                                style={{
                                  background: "linear-gradient(135deg, color-mix(in srgb, var(--brand, #c9a83a) 6%, var(--card)), var(--card))",
                                  borderColor: "color-mix(in srgb, var(--brand, #c9a83a) 50%, transparent)",
                                }}>
                                <p className="text-[10px] font-bold uppercase tracking-wider mb-2"
                                  style={{ color: "var(--brand, #c9a83a)", letterSpacing: "0.08em" }}>
                                  Pre-Call Brief
                                </p>
                                <ol className="space-y-2">
                                  {call.talkingPoints.map((p, i) => {
                                    const structured = typeof p === "object" && p !== null && "type" in p;
                                    const label = structured
                                      ? p.type === "pain" ? "Pain"
                                      : p.type === "fit" ? "Fit"
                                      : "Opener"
                                      : `${i + 1}.`;
                                    const labelColor = structured
                                      ? p.type === "pain" ? "#B91C1C"
                                      : p.type === "fit" ? "#1D4ED8"
                                      : "#B45309"
                                      : "var(--brand, #c9a83a)";
                                    const text = typeof p === "string" ? p : p.text;
                                    return (
                                      <li key={i}>
                                        <span className="text-[9px] font-bold uppercase tracking-wider mr-1.5"
                                          style={{ color: labelColor, letterSpacing: "0.06em" }}>
                                          {label}
                                        </span>
                                        <span className="text-[11px] leading-snug" style={{ color: C.textPrimary }}>{text}</span>
                                      </li>
                                    );
                                  })}
                                </ol>
                              </div>
                            </div>
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

      {/* ═══ Tab 0: History (split-pane reply triage with keyboard shortcuts) ═══ */}
      {tab === 0 && (
        <InboxView
          replies={(sortedReplies as NewReply[]).map((r): InboxReply => ({
            id: r.id,
            leadId: r.leadId ?? "",
            leadName: r.leadName,
            company: r.company,
            campaignName: r.campaignName ?? null,
            icpProfileName: (r as any).icpProfileName ?? null,
            classification: r.classification,
            channel: r.channel,
            replyText: r.replyText,
            receivedAt: r.receivedAt,
            // Pass through the real persisted review_status. Falling back
            // to the derived value (pending / null) made History-tab
            // replies appear "not reviewed yet" even when they were —
            // and made the Mark-reviewed / Reject buttons always look
            // clickable, even on rows that had nothing left to do.
            reviewStatus: r.reviewStatus ?? (r.requiresHumanReview ? "pending" : null),
            requiresHumanReview: !!r.requiresHumanReview,
            positive: r.classification === "positive" || r.classification === "meeting_intent",
          }))}
        />
      )}

      {tab === 2 && <ChatPanel initialThreadId={searchParams.get("thread")} />}
    </div>
  );
}
