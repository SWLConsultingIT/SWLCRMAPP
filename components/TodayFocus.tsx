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

  const overdueCount = useMemo(
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

  // "All clear" — show a friendly empty state instead of an aggressive
  // recommendation card. Quiet win surface for sellers with nothing to do.
  if (!recommendation && calls.length === 0 && replies.length === 0) {
    return (
      <div className="rounded-2xl border mb-5 px-5 py-4 flex items-center gap-3"
        style={{
          background: `linear-gradient(135deg, color-mix(in srgb, ${C.green} 7%, var(--card)), var(--card))`,
          borderColor: `color-mix(in srgb, ${C.green} 22%, var(--border))`,
        }}>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: `color-mix(in srgb, ${C.green} 14%, transparent)` }}>
          <CheckCircle2 size={18} style={{ color: C.green }} />
        </div>
        <div>
          <p className="text-sm font-bold" style={{ color: C.textPrimary }}>You&apos;re all caught up</p>
          <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
            No pending calls or replies right now. Take a breather or check Flows for next steps.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border mb-5 overflow-hidden"
      style={{
        background: `linear-gradient(135deg, color-mix(in srgb, ${gold} 7%, var(--card)) 0%, var(--card) 50%)`,
        borderColor: `color-mix(in srgb, ${gold} 25%, var(--border))`,
        boxShadow: `0 6px 24px -10px color-mix(in srgb, ${gold} 25%, transparent), 0 2px 6px rgba(0,0,0,0.04)`,
      }}>
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-0">
        {/* Recommended next action */}
        <div className="px-5 py-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 65%, white))` }}>
              <Sun size={14} style={{ color: "#fff" }} />
            </div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: gold, letterSpacing: "0.12em" }}>
              Today&apos;s Focus
            </p>
          </div>

          {recommendation ? (
            <div className="rounded-xl border p-3.5 flex items-center gap-3"
              style={{ borderColor: C.border, backgroundColor: C.card }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  background: recommendation.kind === "reply"
                    ? `linear-gradient(135deg, ${C.blue}, color-mix(in srgb, ${C.blue} 65%, white))`
                    : "linear-gradient(135deg, #F97316, #FB923C)",
                }}>
                {recommendation.kind === "reply"
                  ? <MessageSquare size={16} style={{ color: "#fff" }} />
                  : <Phone size={16} style={{ color: "#fff" }} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold truncate" style={{ color: C.textPrimary }}>
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
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg shrink-0 transition-opacity hover:opacity-85"
                  style={{ backgroundColor: gold, color: "#04070d" }}>
                  {recommendation.cta} <ArrowRight size={12} />
                </Link>
              ) : (
                <button onClick={recommendation.onAction}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg shrink-0 transition-opacity hover:opacity-85"
                  style={{ backgroundColor: gold, color: "#04070d" }}>
                  {recommendation.cta} <ArrowRight size={12} />
                </button>
              )}
            </div>
          ) : (
            <p className="text-sm" style={{ color: C.textMuted }}>Nothing urgent. Use the tabs below to triage what&apos;s queued.</p>
          )}
        </div>

        {/* Counts strip */}
        <div className="px-5 py-4 border-t lg:border-t-0 lg:border-l flex items-center justify-around gap-2"
          style={{ borderColor: `color-mix(in srgb, ${gold} 15%, var(--border))` }}>
          <CountStat icon={Phone} label="Calls to make" value={calls.filter(c => !c.latestCall).length}
            accent={overdueCount > 0 ? "#DC2626" : C.textBody}
            badge={overdueCount > 0 ? `${overdueCount} overdue` : null}
            onClick={onJumpToCalls} />
          <Divider />
          <CountStat icon={Clock} label="To classify" value={awaitingClassification}
            accent={C.textBody}
            onClick={onJumpToCalls} />
          <Divider />
          <CountStat icon={MessageSquare} label="New replies" value={replies.length}
            accent={positiveReplies > 0 ? C.green : C.blue}
            badge={positiveReplies > 0
              ? `${positiveReplies} positive`
              : reviewNeeded > 0 ? `${reviewNeeded} need review` : null}
            onClick={onJumpToReplies} />
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return <div className="h-9 w-px" style={{ backgroundColor: C.border }} />;
}

function CountStat({ icon: Icon, label, value, accent, badge, onClick }: {
  icon: typeof Phone;
  label: string;
  value: number;
  accent: string;
  badge?: string | null;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="flex flex-col items-center text-center px-2 py-1 rounded-md transition-colors hover:bg-black/[0.02]">
      <div className="flex items-center gap-1.5">
        <Icon size={12} style={{ color: accent, opacity: 0.7 }} />
        <p className="text-[9px] font-bold uppercase tracking-[0.08em]" style={{ color: C.textDim }}>{label}</p>
      </div>
      <p className="text-[22px] font-bold tabular-nums leading-none mt-1"
        style={{ color: accent, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
        {value}
      </p>
      {badge && (
        <span className="text-[9px] font-bold uppercase tracking-wider mt-1 px-1.5 py-0.5 rounded-md"
          style={{ backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }}>
          {badge}
        </span>
      )}
    </button>
  );
}

