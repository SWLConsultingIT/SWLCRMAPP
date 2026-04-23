"use client";

import { useState } from "react";
import Link from "next/link";
import { C } from "@/lib/design";
import {
  Phone, Share2, Mail, Megaphone, Target,
  ChevronRight, CheckCircle, Search, X,
  PhoneCall, User, PhoneOff, Bell, AlertTriangle, XCircle, Sparkles,
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
  lastStepAt: string | null;
  isOverdue?: boolean;
  overdueDays?: number;
  aircallNumberId?: number | null;
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
  positive:       { color: C.green,   bg: C.greenLight, label: "Positive" },
  meeting_intent: { color: C.green,   bg: C.greenLight, label: "Meeting Intent" },
  negative:       { color: C.red,     bg: C.redLight,   label: "Negative" },
  needs_info:     { color: "#D97706", bg: "#FFFBEB",    label: "Needs Info" },
  not_now:        { color: C.textMuted, bg: "#F3F4F6",  label: "Not Now" },
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

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function QueueClient({ pendingCalls, newReplies, pendingReviews, updates }: Props) {
  const [tab, setTab] = useState(0);
  const [search, setSearch] = useState("");

  const totalCount = pendingCalls.length + newReplies.length + pendingReviews.length + updates.length;
  const needsReviewCount = newReplies.filter(r => r.requiresHumanReview).length;

  const filteredCalls = !search ? pendingCalls
    : pendingCalls.filter(c => `${c.leadName} ${c.company} ${c.campaignName}`.toLowerCase().includes(search.toLowerCase()));
  const filteredReplies = !search ? newReplies
    : newReplies.filter(r => `${r.leadName} ${r.company} ${r.campaignName} ${r.replyText}`.toLowerCase().includes(search.toLowerCase()));
  const filteredReviews = !search ? pendingReviews
    : pendingReviews.filter(r => `${r.name} ${r.subtitle}`.toLowerCase().includes(search.toLowerCase()));
  const filteredUpdates = !search ? updates
    : updates.filter(u => `${u.name} ${u.subtitle}`.toLowerCase().includes(search.toLowerCase()));

  const tabs = [
    { label: "Pending Calls",   count: pendingCalls.length,   color: "#F97316",  reviewCount: 0 },
    { label: "New Replies",     count: newReplies.length,     color: C.blue,     reviewCount: needsReviewCount },
    { label: "Pending Reviews", count: pendingReviews.length, color: gold,       reviewCount: 0 },
    { label: "Updates",         count: updates.length,        color: "#7C3AED",  reviewCount: 0 },
  ];

  return (
    <div className="p-6 w-full">
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
              className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all relative"
              style={{ color: isActive ? t.color : C.textMuted }}>
              {t.label}
              {t.count > 0 && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: isActive ? `${t.color}15` : "#F3F4F6", color: isActive ? t.color : C.textDim }}>
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
        <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 mb-1"
          style={{ borderColor: C.border, backgroundColor: C.card }}>
          <Search size={13} style={{ color: C.textDim }} />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search..." className="bg-transparent text-sm outline-none w-36"
            style={{ color: C.textPrimary }} />
          {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
        </div>
      </div>

      {/* ═══ Tab 0: Pending Calls ═══ */}
      {tab === 0 && (
        filteredCalls.length === 0 ? (
          <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <CheckCircle size={28} className="mx-auto mb-3" style={{ color: C.green }} />
            <p className="text-sm font-medium" style={{ color: C.textBody }}>
              {search ? "No calls match your search" : "No pending calls"}
            </p>
            <p className="text-xs mt-1" style={{ color: C.textMuted }}>Calls appear when a campaign sequence reaches a call step.</p>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {filteredCalls.map(call => {
                const urgency = classifyUrgency(call.isOverdue ? call.overdueDays ?? 0 : null);
                const UIcon = urgency.icon;
                const isEscalated = urgency.level === "critical" || urgency.level === "stuck";
                return (
                  <div key={call.id} className="rounded-xl border" style={{ backgroundColor: C.card, borderColor: isEscalated ? urgency.border : C.border, borderLeftWidth: isEscalated ? 3 : 1, borderLeftColor: isEscalated ? urgency.color : undefined }}>
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
                          {call.isOverdue && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: urgency.bg, color: urgency.color, border: `1px solid ${urgency.border}` }}>
                              <UIcon size={9} /> {urgency.label}
                            </span>
                          )}
                        </div>
                        {call.role && <p className="text-xs" style={{ color: C.textMuted }}>{call.role}</p>}
                        <p className="text-[10px] mt-1" style={{ color: C.textDim }}>
                          {call.campaignName} · Step {call.currentStep + 1}/{call.totalSteps}
                          {call.lastStepAt && <> · Last activity {timeAgo(call.lastStepAt)}</>}
                          {call.isOverdue && <> · {urgency.hint}</>}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 shrink-0">
                        {call.leadId ? (
                          <CallButton phone={call.phone} leadId={call.leadId} size="md" defaultNumberId={call.aircallNumberId ?? null} />
                        ) : (
                          <span className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-xs"
                            style={{ backgroundColor: "#F3F4F6", color: C.textDim }}>
                            <PhoneOff size={12} /> No lead linked
                          </span>
                        )}
                      </div>
                    </div>

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
          </>
        )
      )}

      {/* ═══ Tab 1: New Replies ═══ */}
      {tab === 1 && (
        filteredReplies.length === 0 ? (
          <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <CheckCircle size={28} className="mx-auto mb-3" style={{ color: C.green }} />
            <p className="text-sm font-medium" style={{ color: C.textBody }}>
              {search ? "No replies match your search" : "No replies yet"}
            </p>
          </div>
        ) : (
          <>
            {needsReviewCount > 0 && !search && (
              <div className="flex items-center gap-3 rounded-xl border px-4 py-3 mb-4"
                style={{ backgroundColor: "#FFFBEB", borderColor: "#FCD34D" }}>
                <AlertTriangle size={16} style={{ color: "#D97706" }} className="shrink-0" />
                <p className="text-sm font-medium" style={{ color: "#92400E" }}>
                  {needsReviewCount} {needsReviewCount === 1 ? "reply needs" : "replies need"} your attention — the AI answered but flagged these for human review.
                </p>
              </div>
            )}
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
              {filteredReplies.map((r, i) => {
                const cls = classificationMeta[r.classification ?? ""] ?? { color: C.textMuted, bg: "#F3F4F6", label: r.classification ?? "Reply" };
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
                      ) : (
                        <p className="text-[10px] italic" style={{ color: C.textDim }}>No reply text</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end shrink-0 gap-1">
                      <span className="text-[10px]" style={{ color: C.textDim }}>{timeAgo(r.receivedAt)}</span>
                      <ChevronRight size={13} style={{ color: C.textDim }} />
                    </div>
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
          <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
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
                <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
                  {campaigns.map((review, i) => (
                    <Link key={review.id} href={review.href}
                      className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-black/[0.015]"
                      style={{ borderBottom: i < campaigns.length - 1 ? `1px solid ${C.border}` : "none" }}>
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${gold}12` }}>
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
                <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
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
          <div className="rounded-xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <CheckCircle size={28} className="mx-auto mb-3" style={{ color: C.green }} />
            <p className="text-sm font-medium" style={{ color: C.textBody }}>
              {search ? "No updates match your search" : "No recent updates"}
            </p>
            <p className="text-xs mt-1" style={{ color: C.textMuted }}>
              Updates from the last 14 days will appear here.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
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
                  className="flex items-start gap-4 px-5 py-4 transition-colors hover:bg-black/[0.015]"
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
                </Link>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
