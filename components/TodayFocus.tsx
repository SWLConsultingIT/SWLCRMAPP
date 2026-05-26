"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Sun, Phone, MessageSquare, ArrowRight, Sparkles, CheckCircle2, Clock } from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

// Minimum shape — caller passes the same arrays it has from QueueClient state.
type Call = {
  id: string;
  leadId: string | null;
  leadName: string;
  company: string | null;
  role: string | null;
  phone: string | null;
  isOverdue?: boolean;
  overdueDays?: number;
  latestCall: { classification: "positive" | "negative" | "follow_up" | null } | null;
};
type Reply = {
  id: string;
  leadId: string;
  leadName: string;
  company: string | null;
  classification: string | null;
  receivedAt: string;
  requiresHumanReview?: boolean;
};

type Props = {
  calls: Call[];
  replies: Reply[];
  onJumpToCalls: () => void;
  onJumpToReplies: () => void;
};

/**
 * Today's Focus — the at-a-glance "what's most urgent right now" strip that
 * sits above the Queue's tabs. It picks ONE recommended next action based
 * on a simple priority ladder (positive reply > overdue call > untouched
 * call) so the seller never has to scan four tabs to find the highest-impact
 * thing to do. Counts on the side give context without forcing them to
 * switch tabs.
 */
export default function TodayFocus({ calls, replies, onJumpToCalls, onJumpToReplies }: Props) {
  // Priority ladder for "what to do next":
  //   1. A new POSITIVE reply (closing window!)
  //   2. The most-overdue untouched call (sequence is stalled)
  //   3. Any untouched call (clear the backlog)
  // We surface the suggestion as a literal action card with a button.
  const recommendation = useMemo(() => {
    const positiveReply = replies.find(r =>
      r.classification === "positive" || r.classification === "meeting_intent"
    );
    if (positiveReply) {
      return {
        kind: "reply" as const,
        leadName: positiveReply.leadName,
        company: positiveReply.company,
        leadId: positiveReply.leadId,
        reason: "Positive reply — respond fast while you're top-of-mind.",
        cta: "Open reply",
        onAction: onJumpToReplies,
      };
    }
    const callsToMake = calls.filter(c => !c.latestCall);
    const mostOverdue = [...callsToMake]
      .filter(c => c.isOverdue)
      .sort((a, b) => (b.overdueDays ?? 0) - (a.overdueDays ?? 0))[0];
    if (mostOverdue) {
      return {
        kind: "call" as const,
        leadName: mostOverdue.leadName,
        company: mostOverdue.company,
        role: mostOverdue.role,
        leadId: mostOverdue.leadId,
        reason: `${mostOverdue.overdueDays ?? 0}d overdue — the sequence is waiting on this call.`,
        cta: "Open lead",
        onAction: onJumpToCalls,
      };
    }
    if (callsToMake.length > 0) {
      const first = callsToMake[0];
      return {
        kind: "call" as const,
        leadName: first.leadName,
        company: first.company,
        role: first.role,
        leadId: first.leadId,
        reason: "First on the call list — easy first win to start the day.",
        cta: "Open lead",
        onAction: onJumpToCalls,
      };
    }
    return null;
  }, [calls, replies, onJumpToCalls, onJumpToReplies]);

  // Split "untouched calls" by urgency so sellers see what's *waiting on them*
  // (stalled, overdue) separately from what's *fresh in the pipeline* (new).
  // Before: one "Calls to make" tile mixed both → sellers couldn't triage.
  const newCalls = useMemo(
    () => calls.filter(c => !c.latestCall && !c.isOverdue).length,
    [calls],
  );
  const stalledCalls = useMemo(
    () => calls.filter(c => !c.latestCall && c.isOverdue).length,
    [calls],
  );
  const awaitingClassification = useMemo(
    () => calls.filter(c => c.latestCall && c.latestCall.classification === null).length,
    [calls],
  );
  const positiveReplies = useMemo(
    () => replies.filter(r => r.classification === "positive" || r.classification === "meeting_intent").length,
    [replies],
  );
  const reviewNeeded = useMemo(
    () => replies.filter(r => r.requiresHumanReview).length,
    [replies],
  );

  // "All clear" — quiet green pill. Compact (no full card) because the hero
  // above already shows zero counts; one more "you're caught up" billboard
  // would be visual noise.
  if (!recommendation && calls.length === 0 && replies.length === 0) {
    return (
      <div
        className="rounded-xl border mb-5 px-4 py-2.5 flex items-center gap-2.5"
        style={{
          background: `color-mix(in srgb, ${C.green} 6%, var(--card))`,
          borderColor: `color-mix(in srgb, ${C.green} 40%, transparent)`,
        }}
      >
        <CheckCircle2 size={14} style={{ color: C.green }} />
        <p className="text-xs font-semibold" style={{ color: C.green }}>You&apos;re all caught up.</p>
        <span className="text-[11px]" style={{ color: C.textMuted }}>Take a breather or check Flows.</span>
      </div>
    );
  }

  // No urgent recommendation, but there are items queued — show a slim hint
  // strip instead of a giant card. The hero already surfaced the counts, so
  // duplicating them here would be redundant.
  if (!recommendation) {
    const total = newCalls + stalledCalls + awaitingClassification + replies.length;
    return (
      <div
        className="rounded-xl border mb-5 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap"
        style={{
          background: `color-mix(in srgb, ${gold} 5%, var(--card))`,
          borderColor: `color-mix(in srgb, ${gold} 40%, transparent)`,
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Sun size={14} style={{ color: gold }} />
          <p className="text-xs font-semibold" style={{ color: C.textPrimary }}>
            Nothing urgent right now.
          </p>
          <span className="text-[11px]" style={{ color: C.textMuted }}>
            {total} item{total === 1 ? "" : "s"} queued — pick a tab below.
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {replies.length > 0 && (
            <button
              onClick={onJumpToReplies}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md transition-opacity hover:opacity-85"
              style={{ backgroundColor: `color-mix(in srgb, ${C.blue} 14%, transparent)`, color: C.blue, border: `1px solid color-mix(in srgb, ${C.blue} 30%, transparent)` }}
            >
              <MessageSquare size={11} /> Triage {replies.length} repl{replies.length === 1 ? "y" : "ies"}
            </button>
          )}
          {(newCalls + stalledCalls + awaitingClassification) > 0 && (
            <button
              onClick={onJumpToCalls}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md transition-opacity hover:opacity-85"
              style={{ backgroundColor: "color-mix(in srgb, #F97316 14%, transparent)", color: "#F97316", border: "1px solid color-mix(in srgb, #F97316 30%, transparent)" }}
            >
              <Phone size={11} /> {newCalls + stalledCalls + awaitingClassification} call{(newCalls + stalledCalls + awaitingClassification) === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Recommendation present — premium single-row card. The redundant 4-tile
  // "counts strip" used to live on the right; removed because the hero above
  // already shows those numbers (NEW CALLS / NEW REPLIES / NEED REVIEW / etc).
  return (
    <div
      className="rounded-2xl border mb-5 px-4 py-3 flex items-center gap-3 flex-wrap"
      style={{
        background: `linear-gradient(135deg, color-mix(in srgb, ${gold} 9%, var(--card)) 0%, var(--card) 65%)`,
        // Pure gold border (translucent) instead of mixing into var(--border).
        // The previous color-mix against the dark-mode border (#1F2842) muddied
        // the result into a brownish-gray that read as "white border" against
        // the dark card. Gold @ 55% alpha keeps the brand identity in both
        // themes and degrades gracefully on light bg too.
        borderColor: `color-mix(in srgb, ${gold} 55%, transparent)`,
        boxShadow: `0 4px 20px -8px color-mix(in srgb, ${gold} 28%, transparent)`,
      }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{
          background: recommendation.kind === "reply"
            ? `linear-gradient(135deg, ${C.blue}, color-mix(in srgb, ${C.blue} 65%, white))`
            : "linear-gradient(135deg, #F97316, #FB923C)",
          boxShadow: `0 0 18px color-mix(in srgb, ${recommendation.kind === "reply" ? C.blue : "#F97316"} 28%, transparent)`,
        }}
      >
        {recommendation.kind === "reply"
          ? <MessageSquare size={16} style={{ color: "#fff" }} />
          : <Phone size={16} style={{ color: "#fff" }} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <Sun size={11} style={{ color: gold }} />
          <span className="text-[9px] font-bold uppercase tracking-[0.16em]" style={{ color: gold }}>
            Today&apos;s Focus
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-bold truncate" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
            {recommendation.leadName}
          </p>
          {recommendation.company && (
            <p className="text-xs truncate" style={{ color: C.textMuted }}>
              · {recommendation.company}
            </p>
          )}
        </div>
        <p className="text-[11px] mt-0.5 flex items-center gap-1" style={{ color: C.textBody }}>
          <Sparkles size={10} style={{ color: gold }} /> {recommendation.reason}
        </p>
      </div>
      {recommendation.leadId ? (
        <Link href={`/leads/${recommendation.leadId}`}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg shrink-0 transition-opacity hover:opacity-90"
          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`, color: "#04070d", boxShadow: `0 2px 10px color-mix(in srgb, ${gold} 28%, transparent)` }}>
          {recommendation.cta} <ArrowRight size={12} />
        </Link>
      ) : (
        <button onClick={recommendation.onAction}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg shrink-0 transition-opacity hover:opacity-90"
          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 70%, white))`, color: "#04070d", boxShadow: `0 2px 10px color-mix(in srgb, ${gold} 28%, transparent)` }}>
          {recommendation.cta} <ArrowRight size={12} />
        </button>
      )}
    </div>
  );
}


