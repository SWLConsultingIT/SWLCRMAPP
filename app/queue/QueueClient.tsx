"use client";

import { useState } from "react";
import Link from "next/link";
import { C } from "@/lib/design";
import {
  Phone, Share2, Mail, Megaphone, Target,
  ChevronRight, ChevronDown, Clock, CheckCircle, Search, X,
} from "lucide-react";

const gold = "#C9A83A";

type OverdueStep = {
  id: string;
  campaignId: string;
  campaignName: string;
  channel: string;
  currentStep: number;
  totalSteps: number;
  dueAt: string;
  leadId: string | null;
  leadName: string;
  company: string | null;
};

type ReplyReview = {
  id: string;
  leadId: string;
  leadName: string;
  company: string | null;
  channel: string;
  classification: string | null;
  replyText: string | null;
  receivedAt: string;
  campaignName: string | null;
};

type PendingReview = {
  id: string;
  type: "campaign" | "profile";
  name: string;
  subtitle: string;
  createdAt: string;
  href: string;
};

type Props = {
  overdueSteps: OverdueStep[];
  replyReviews: ReplyReview[];
  pendingReviews: PendingReview[];
};

const channelMeta: Record<string, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

const classificationMeta: Record<string, { color: string; bg: string; label: string }> = {
  positive:       { color: C.green,   bg: C.greenLight, label: "Positive" },
  meeting_intent: { color: C.green,   bg: C.greenLight, label: "Meeting Intent" },
  negative:       { color: C.red,     bg: C.redLight,   label: "Negative" },
  question:       { color: "#D97706", bg: "#FFFBEB",    label: "Question" },
  unclassified:   { color: C.textMuted, bg: "#F3F4F6",  label: "Unclassified" },
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

function overdueLabel(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60)  return `${m}m overdue`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h overdue`;
  return `${Math.floor(h / 24)}d overdue`;
}

// ─── Overdue steps grouped by ticket ──────────────────────────────────────────
function OverdueGroup({ name, steps }: { name: string; steps: OverdueStep[] }) {
  const [open, setOpen] = useState(true);
  const channels = [...new Set(steps.map(s => s.channel))];

  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-black/[0.02]"
        style={{ backgroundColor: C.bg }}
      >
        {open ? <ChevronDown size={14} style={{ color: C.textDim }} /> : <ChevronRight size={14} style={{ color: C.textDim }} />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold" style={{ color: C.textPrimary }}>{name}</span>
            {channels.map(ch => {
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
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: C.redLight, color: C.red }}>
          {steps.length} overdue
        </span>
      </button>

      {open && (
        <div>
          {steps.map((step, i) => {
            const meta = channelMeta[step.channel] ?? channelMeta.email;
            const Icon = meta.icon;
            return (
              <Link
                key={step.id}
                href={`/campaigns/${step.campaignId}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-black/[0.015]"
                style={{ borderTop: `1px solid ${C.border}` }}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${meta.color}12` }}>
                  <Icon size={14} style={{ color: meta.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold" style={{ color: C.textPrimary }}>
                    {step.leadName}
                    {step.company && <span className="font-normal ml-1" style={{ color: C.textMuted }}>· {step.company}</span>}
                  </p>
                  <p className="text-[10px]" style={{ color: C.textMuted }}>
                    Step {step.currentStep + 1}/{step.totalSteps} · {meta.label}
                  </p>
                </div>
                <span className="text-[10px] font-semibold shrink-0" style={{ color: C.red }}>
                  <Clock size={9} className="inline mr-0.5" />{overdueLabel(step.dueAt)}
                </span>
                <ChevronRight size={13} style={{ color: C.textDim }} className="shrink-0" />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Reply review row ─────────────────────────────────────────────────────────
function ReplyRow({ reply }: { reply: ReplyReview }) {
  const cls = classificationMeta[reply.classification ?? "unclassified"] ?? classificationMeta.unclassified;
  const chMeta = channelMeta[reply.channel] ?? channelMeta.email;
  const ChIcon = chMeta.icon;

  return (
    <Link
      href={`/leads/${reply.leadId}`}
      className="flex gap-4 px-5 py-4 transition-colors hover:bg-black/[0.015] group"
      style={{ borderBottom: `1px solid ${C.border}` }}
    >
      {/* Avatar */}
      <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5"
        style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#fff" }}>
        {(reply.leadName[0] ?? "?").toUpperCase()}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Lead info line */}
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-sm font-semibold group-hover:underline" style={{ color: C.textPrimary }}>{reply.leadName}</span>
          {reply.company && <span className="text-xs" style={{ color: C.textMuted }}>· {reply.company}</span>}
          <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: cls.bg, color: cls.color }}>
            {cls.label}
          </span>
        </div>

        {/* Campaign + channel */}
        <div className="flex items-center gap-2 mb-2 text-[10px]" style={{ color: C.textMuted }}>
          <span className="flex items-center gap-1" style={{ color: chMeta.color }}>
            <ChIcon size={10} /> {chMeta.label}
          </span>
          {reply.campaignName && <span>· {reply.campaignName}</span>}
          <span>· {timeAgo(reply.receivedAt)}</span>
        </div>

        {/* Reply text */}
        {reply.replyText ? (
          <div className="rounded-lg px-3 py-2.5 border" style={{ backgroundColor: cls.bg, borderColor: cls.color + "20" }}>
            <p className="text-xs leading-relaxed" style={{ color: C.textBody }}>
              &ldquo;{reply.replyText}&rdquo;
            </p>
          </div>
        ) : (
          <p className="text-[10px] italic" style={{ color: C.textDim }}>No reply text available</p>
        )}
      </div>

      {/* Action */}
      <div className="flex items-center shrink-0 self-center">
        <span className="text-[10px] font-semibold mr-1 hidden sm:block" style={{ color: gold }}>Review</span>
        <ChevronRight size={14} style={{ color: C.textDim }} />
      </div>
    </Link>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function QueueClient({ overdueSteps, replyReviews, pendingReviews }: Props) {
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState("");

  const totalCount = overdueSteps.length + replyReviews.length + pendingReviews.length;

  // Group overdue by campaign name
  const overdueGrouped: Record<string, OverdueStep[]> = {};
  for (const s of overdueSteps) {
    if (!overdueGrouped[s.campaignName]) overdueGrouped[s.campaignName] = [];
    overdueGrouped[s.campaignName].push(s);
  }

  // Search filter
  const filterOverdue = (groups: Record<string, OverdueStep[]>) => {
    if (!search) return groups;
    const filtered: Record<string, OverdueStep[]> = {};
    for (const [name, steps] of Object.entries(groups)) {
      const matched = steps.filter(s =>
        `${s.leadName} ${s.company} ${s.campaignName}`.toLowerCase().includes(search.toLowerCase())
      );
      if (matched.length > 0 || name.toLowerCase().includes(search.toLowerCase())) {
        filtered[name] = matched.length > 0 ? matched : steps;
      }
    }
    return filtered;
  };

  const filterReplies = (replies: ReplyReview[]) =>
    !search ? replies : replies.filter(r =>
      `${r.leadName} ${r.company} ${r.campaignName} ${r.replyText}`.toLowerCase().includes(search.toLowerCase())
    );

  const filterReviews = (reviews: PendingReview[]) =>
    !search ? reviews : reviews.filter(r =>
      `${r.name} ${r.subtitle}`.toLowerCase().includes(search.toLowerCase())
    );

  const filteredOverdue = filterOverdue(overdueGrouped);
  const filteredReplies = filterReplies(replyReviews);
  const filteredReviews = filterReviews(pendingReviews);

  const tabs = [
    { label: "Overdue Steps", count: overdueSteps.length, color: C.red },
    { label: "Reply Reviews", count: replyReviews.length, color: "#D97706" },
    { label: "Pending Reviews", count: pendingReviews.length, color: C.blue },
  ];

  return (
    <div className="p-6 w-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>Operations</p>
          <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>Queue</h1>
          <p className="text-sm mt-1" style={{ color: C.textMuted }}>
            {totalCount > 0 ? (
              <>
                <span className="font-bold" style={{ color: C.red }}>{overdueSteps.length}</span> overdue
                {replyReviews.length > 0 && <> · <span className="font-bold" style={{ color: "#D97706" }}>{replyReviews.length}</span> replies to review</>}
                {pendingReviews.length > 0 && <> · <span className="font-bold" style={{ color: C.blue }}>{pendingReviews.length}</span> pending reviews</>}
              </>
            ) : "All clear — no pending tasks."}
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

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b mb-6" style={{ borderColor: C.border }}>
        {tabs.map((t, i) => {
          const isActive = tab === i;
          return (
            <button
              key={t.label}
              onClick={() => setTab(i)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all relative"
              style={{ color: isActive ? t.color : C.textMuted }}
            >
              {t.label}
              {t.count > 0 && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{
                    backgroundColor: isActive ? `${t.color}15` : "#F3F4F6",
                    color: isActive ? t.color : C.textDim,
                  }}>
                  {t.count}
                </span>
              )}
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: t.color }} />}
            </button>
          );
        })}
      </div>

      {/* Tab 0: Overdue Steps */}
      {tab === 0 && (
        Object.keys(filteredOverdue).length === 0 ? (
          <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <CheckCircle size={28} className="mx-auto mb-3" style={{ color: C.green }} />
            <p className="text-sm font-medium" style={{ color: C.textBody }}>
              {search ? "No overdue steps match your search" : "No overdue steps"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(filteredOverdue).map(([name, steps]) => (
              <OverdueGroup key={name} name={name} steps={steps} />
            ))}
          </div>
        )
      )}

      {/* Tab 1: Reply Reviews */}
      {tab === 1 && (
        filteredReplies.length === 0 ? (
          <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <CheckCircle size={28} className="mx-auto mb-3" style={{ color: C.green }} />
            <p className="text-sm font-medium" style={{ color: C.textBody }}>
              {search ? "No replies match your search" : "No replies pending review"}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
            {filteredReplies.map(r => <ReplyRow key={r.id} reply={r} />)}
          </div>
        )
      )}

      {/* Tab 2: Pending Reviews (Campaigns + Lead Gen) */}
      {tab === 2 && (() => {
        const campaigns = filteredReviews.filter(r => r.type === "campaign");
        const profiles = filteredReviews.filter(r => r.type === "profile");

        if (filteredReviews.length === 0) return (
          <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <CheckCircle size={28} className="mx-auto mb-3" style={{ color: C.green }} />
            <p className="text-sm font-medium" style={{ color: C.textBody }}>
              {search ? "No reviews match your search" : "No pending reviews"}
            </p>
          </div>
        );

        return (
          <div className="space-y-6">
            {/* Campaigns section */}
            {campaigns.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Megaphone size={14} style={{ color: gold }} />
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
                    Campaigns ({campaigns.length})
                  </h3>
                </div>
                <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
                  {campaigns.map((review, i) => (
                    <Link key={review.id} href={review.href}
                      className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-black/[0.015]"
                      style={{ borderBottom: i < campaigns.length - 1 ? `1px solid ${C.border}` : "none" }}>
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${gold}12` }}>
                        <Megaphone size={15} style={{ color: gold }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{review.name}</p>
                        <p className="text-xs" style={{ color: C.textMuted }}>{review.subtitle}</p>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded shrink-0"
                        style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}>
                        Under Review
                      </span>
                      <span className="text-[10px] shrink-0" style={{ color: C.textDim }}>{timeAgo(review.createdAt)}</span>
                      <ChevronRight size={13} style={{ color: C.textDim }} className="shrink-0" />
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Lead Gen Profiles section */}
            {profiles.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Target size={14} style={{ color: C.blue }} />
                  <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
                    Lead Gen Profiles ({profiles.length})
                  </h3>
                </div>
                <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
                  {profiles.map((review, i) => (
                    <Link key={review.id} href={review.href}
                      className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-black/[0.015]"
                      style={{ borderBottom: i < profiles.length - 1 ? `1px solid ${C.border}` : "none" }}>
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${C.blue}12` }}>
                        <Target size={15} style={{ color: C.blue }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{review.name}</p>
                        <p className="text-xs" style={{ color: C.textMuted }}>{review.subtitle}</p>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded shrink-0"
                        style={{ backgroundColor: C.blueLight, color: C.blue }}>
                        Under Review
                      </span>
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
    </div>
  );
}
