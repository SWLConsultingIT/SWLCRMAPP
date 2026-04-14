"use client";

import { useState } from "react";
import { C } from "@/lib/design";
import { ChevronDown, ChevronUp, CheckCircle2, Clock, Send, MessageSquare, Pencil, Save, Loader2 } from "lucide-react";
import { LinkedInIcon } from "@/components/SocialIcons";

const gold = "#C9A83A";
const goldLight = "rgba(201,168,58,0.08)";

type Campaign = {
  id: string;
  name: string | null;
  channel: string | null;
  status: string | null;
  current_step: number | null;
  sequence_steps: any[] | null;
  started_at: string | null;
  next_step_due_at: string | null;
  paused_until: string | null;
  completed_at: string | null;
  sellers: { name: string } | null;
};

type Message = {
  id: string;
  campaign_id: string;
  step_number: number | null;
  channel: string | null;
  content: string | null;
  status: string | null;
  sent_at: string | null;
};

type Reply = {
  id: string;
  campaign_id: string | null;
  channel: string | null;
  reply_text: string | null;
  received_at: string | null;
  classification: string | null;
  ai_confidence: number | null;
  requires_human_review: boolean | null;
};

function ChannelIcon({ channel, size = 14 }: { channel: string | null; size?: number }) {
  if (channel === "linkedin") return <LinkedInIcon size={size} />;
  if (channel === "email") return <span style={{ fontSize: size }}>✉️</span>;
  if (channel === "call") return <span style={{ fontSize: size }}>📱</span>;
  if (channel === "whatsapp") return <span style={{ fontSize: size }}>💬</span>;
  return <span style={{ fontSize: size }}>💬</span>;
}

const channelLabels: Record<string, string> = {
  linkedin: "LinkedIn DM", email: "Email", call: "Phone Call",
  whatsapp: "WhatsApp", sms: "SMS", instagram: "Instagram DM",
};

const classificationStyles: Record<string, { label: string; color: string; bg: string }> = {
  positive:       { label: "POSITIVE",       color: C.green,  bg: C.greenLight },
  meeting_intent: { label: "MEETING INTENT", color: C.green,  bg: C.greenLight },
  needs_info:     { label: "NEEDS INFO",     color: C.blue,   bg: C.blueLight },
  nurturing:      { label: "NURTURING",      color: gold,     bg: goldLight },
  not_now:        { label: "NOT NOW",        color: C.orange, bg: C.orangeLight },
  negative:       { label: "NEGATIVE",       color: C.red,    bg: C.redLight },
  unsubscribe:    { label: "UNSUBSCRIBE",    color: C.red,    bg: C.redLight },
  spam:           { label: "SPAM",           color: C.textMuted, bg: "#F3F4F6" },
  auto_reply:     { label: "AUTO-REPLY",     color: C.textMuted, bg: "#F3F4F6" },
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function statusBadge(status: string | null) {
  if (status === "active")    return { label: "ACTIVE",    color: C.green,  bg: C.greenLight };
  if (status === "paused")    return { label: "PAUSED",    color: C.orange, bg: C.orangeLight };
  if (status === "completed") return { label: "COMPLETED", color: C.blue,   bg: C.blueLight };
  if (status === "failed")    return { label: "FAILED",    color: C.red,    bg: C.redLight };
  return { label: "UNKNOWN", color: C.textMuted, bg: "#F3F4F6" };
}

/* ── Single Campaign Block ── */
function CampaignBlock({
  campaign, campMessages, campReplies, expandedSteps, toggleStep, defaultOpen,
}: {
  campaign: Campaign;
  campMessages: Message[];
  campReplies: Reply[];
  expandedSteps: Set<string>;
  toggleStep: (k: string) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  // Normalize: sequence_steps can be ["linkedin", ...] or [{channel: "linkedin", daysAfter: 0}, ...]
  const rawSteps = campaign.sequence_steps ?? [];
  const steps: string[] = rawSteps.map((s: any) => typeof s === "string" ? s : s?.channel ?? "unknown");
  const currentStep = campaign.current_step ?? 0;
  const st = statusBadge(campaign.status);

  async function saveMessage(msgId: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/messages/${msgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent }),
      });
      if (res.ok) {
        // Update local message content
        const msg = campMessages.find(m => m.id === msgId);
        if (msg) msg.content = editContent;
        setEditingId(null);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border" style={{ backgroundColor: C.card, borderColor: C.border, borderLeft: `4px solid ${gold}` }}>

      {/* Campaign header — clickable */}
      <button className="w-full text-left px-5 py-4" onClick={() => setOpen(!open)}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "#EFF6FF" }}>
              <ChannelIcon channel={campaign.channel} size={16} />
            </div>
            <div>
              <p className="text-base font-bold" style={{ color: C.textPrimary }}>
                {campaign.name ?? "Outreach Campaign"}
              </p>
              <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
                Channel: <span className="font-medium capitalize">{campaign.channel ?? "—"}</span>
                {campaign.sellers?.name && (
                  <> · Seller: <span className="font-medium">{campaign.sellers.name}</span></>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-bold px-2 py-1 rounded"
              style={{ color: st.color, backgroundColor: st.bg }}>
              {st.label}
            </span>
            {open ? <ChevronUp size={16} style={{ color: C.textDim }} /> : <ChevronDown size={16} style={{ color: C.textDim }} />}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-6 flex-wrap text-xs" style={{ color: C.textMuted }}>
          {campaign.started_at && (
            <span>Started: <span className="font-medium" style={{ color: C.textBody }}>{formatDate(campaign.started_at)}</span></span>
          )}
          {campaign.next_step_due_at && (
            <span className="flex items-center gap-1">
              <Clock size={11} style={{ color: C.orange }} />
              Next step: <span className="font-medium" style={{ color: C.orange }}>{formatDate(campaign.next_step_due_at)}</span>
            </span>
          )}
          {campaign.completed_at && (
            <span>Completed: <span className="font-medium" style={{ color: C.textBody }}>{formatDate(campaign.completed_at)}</span></span>
          )}
          {steps.length > 0 && (
            <span>{currentStep > 0 ? currentStep - 1 : 0} of {steps.length} steps completed</span>
          )}
        </div>
      </button>

      {/* Expanded content: step-by-step */}
      {open && (
        <div className="border-t" style={{ borderColor: C.border }}>
          {steps.length > 0 ? (
            <div className="px-5 py-4">
              {steps.map((stepChannel, idx) => {
                const stepNum = idx + 1;
                const isCompleted = stepNum < currentStep;
                const isCurrent = stepNum === currentStep;
                const isPending = stepNum > currentStep;
                const isLast = idx === steps.length - 1;

                const msg = campMessages.find(m => m.step_number === stepNum);

                const stepKey = `${campaign.id}-${stepNum}`;
                const isExpanded = expandedSteps.has(stepKey);
                const label = channelLabels[stepChannel] ?? stepChannel;
                const lineColor = isCompleted ? "#22C55E" : isCurrent ? gold : "#E5E7EB";

                return (
                  <div key={idx} className="flex gap-4" style={{ minHeight: 56 }}>
                    {/* Left timeline */}
                    <div className="flex flex-col items-center shrink-0" style={{ width: 36 }}>
                      {isCompleted ? (
                        <div className="rounded-full flex items-center justify-center shrink-0"
                          style={{ width: 36, height: 36, backgroundColor: "#DCFCE7" }}>
                          <CheckCircle2 size={20} style={{ color: "#22C55E" }} />
                        </div>
                      ) : isCurrent ? (
                        <div className="rounded-full flex items-center justify-center shrink-0"
                          style={{ width: 36, height: 36, border: `3px solid ${gold}`, backgroundColor: goldLight }}>
                          <span className="font-bold text-xs" style={{ color: gold }}>
                            {String(stepNum).padStart(2, "0")}
                          </span>
                        </div>
                      ) : (
                        <div className="rounded-full flex items-center justify-center shrink-0"
                          style={{ width: 36, height: 36, backgroundColor: "#F3F4F6", border: "2px solid #E5E7EB" }}>
                          <span className="text-xs font-medium" style={{ color: "#9CA3AF" }}>
                            {String(stepNum).padStart(2, "0")}
                          </span>
                        </div>
                      )}
                      {!isLast && (
                        <div className="flex-1" style={{ width: 3, backgroundColor: lineColor, borderRadius: 2, minHeight: 16 }} />
                      )}
                    </div>

                    {/* Right content */}
                    <div className="flex-1 pb-4" style={{ paddingTop: 2 }}>
                      {/* Header row */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <span className="text-xs font-bold px-2 py-0.5 rounded"
                            style={{
                              backgroundColor: isCompleted ? "#DCFCE7" : isCurrent ? goldLight : "#F3F4F6",
                              color: isCompleted ? "#22C55E" : isCurrent ? gold : "#9CA3AF",
                            }}>
                            Step {stepNum}
                          </span>
                          <ChannelIcon channel={stepChannel} size={13} />
                          <span className="text-sm font-medium"
                            style={{ color: isPending ? C.textDim : C.textBody }}>
                            {label}
                          </span>
                        </div>
                        <div className="shrink-0">
                          {msg?.status === "sent" && (
                            <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ color: "#22C55E", backgroundColor: "#DCFCE7" }}>SENT</span>
                          )}
                          {isCurrent && msg?.status !== "sent" && (
                            <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ color: gold, backgroundColor: goldLight }}>CURRENT</span>
                          )}
                          {msg && msg.status !== "sent" && !isCurrent && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded" style={{ color: C.orange, backgroundColor: C.orangeLight }}>DRAFT</span>
                          )}
                          {!msg && (
                            <span className="text-xs font-medium px-2 py-0.5 rounded" style={{ color: "#9CA3AF", backgroundColor: "#F3F4F6" }}>PENDING</span>
                          )}
                        </div>
                      </div>

                      {/* Date row */}
                      <div className="flex items-center gap-4 mt-1.5 text-xs" style={{ color: C.textMuted }}>
                        {msg?.sent_at && (
                          <span>
                            Sent: <span className="font-medium" style={{ color: C.textBody }}>
                              {new Date(msg.sent_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                              {" · "}
                              {new Date(msg.sent_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </span>
                        )}
                        {isCurrent && campaign.next_step_due_at && (
                          <span className="flex items-center gap-1">
                            <Clock size={10} style={{ color: C.orange }} />
                            Response deadline: <span className="font-medium" style={{ color: C.orange }}>{formatDate(campaign.next_step_due_at)}</span>
                          </span>
                        )}
                        {isPending && !msg && (
                          <span style={{ color: C.textDim }}>Awaiting previous steps</span>
                        )}
                      </div>

                      {/* Message content */}
                      {msg?.content && (() => {
                        const isSent = msg.status === "sent";
                        const isEditing = editingId === msg.id;
                        return (
                          <div className="mt-2.5">
                            <div className="flex items-center gap-2 mb-1.5">
                              <button onClick={() => toggleStep(stepKey)}
                                className="flex items-center gap-1.5 text-xs font-medium"
                                style={{ color: C.textMuted }}>
                                <Send size={10} />
                                {isSent ? "Message sent" : "Message created"}
                                {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              </button>
                              {!isSent && isExpanded && !isEditing && (
                                <button onClick={() => { setEditingId(msg.id); setEditContent(msg.content ?? ""); }}
                                  className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded"
                                  style={{ color: gold, backgroundColor: goldLight }}>
                                  <Pencil size={10} /> Edit
                                </button>
                              )}
                              {isSent && isExpanded && (
                                <span className="text-xs px-2 py-0.5 rounded" style={{ color: C.textDim, backgroundColor: "#F3F4F6" }}>
                                  Read-only
                                </span>
                              )}
                            </div>
                            {isExpanded && (
                              isEditing ? (
                                <div>
                                  <textarea
                                    value={editContent}
                                    onChange={e => setEditContent(e.target.value)}
                                    rows={6}
                                    className="w-full px-3.5 py-3 rounded-lg border text-sm leading-relaxed resize-y"
                                    style={{ backgroundColor: "#fff", borderColor: gold, color: C.textBody, outline: "none" }}
                                  />
                                  <div className="flex items-center gap-2 mt-2">
                                    <button onClick={() => saveMessage(msg.id)} disabled={saving}
                                      className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg text-white"
                                      style={{ backgroundColor: gold, opacity: saving ? 0.7 : 1 }}>
                                      {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                      {saving ? "Saving..." : "Save"}
                                    </button>
                                    <button onClick={() => setEditingId(null)}
                                      className="text-xs font-medium px-3 py-1.5 rounded-lg"
                                      style={{ color: C.textMuted }}>
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="px-3.5 py-3 rounded-lg border text-sm leading-relaxed whitespace-pre-wrap"
                                  style={{ backgroundColor: C.bg, borderColor: C.border, color: C.textBody }}>
                                  {msg.content}
                                </div>
                              )
                            )}
                          </div>
                        );
                      })()}

                      {/* Current step pending */}
                      {isCurrent && !msg && (
                        <div className="mt-2.5 px-3.5 py-3 rounded-lg border border-dashed flex items-center gap-2"
                          style={{ borderColor: gold, backgroundColor: goldLight }}>
                          <Clock size={13} style={{ color: gold }} />
                          <span className="text-xs font-medium" style={{ color: gold }}>Message pending — waiting to be sent</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : campMessages.length > 0 ? (
            /* No sequence_steps but has messages */
            <div className="divide-y" style={{ borderColor: C.border }}>
              {[...campMessages].reverse().map(msg => {
                const isExpanded = expandedSteps.has(msg.id);
                return (
                  <div key={msg.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-xs font-bold px-2 py-0.5 rounded"
                          style={{ backgroundColor: goldLight, color: gold }}>
                          Step {msg.step_number}
                        </span>
                        <ChannelIcon channel={msg.channel} size={13} />
                        {msg.sent_at && (
                          <span className="text-xs" style={{ color: C.textDim }}>
                            {new Date(msg.sent_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} ·{" "}
                            {new Date(msg.sent_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        )}
                      </div>
                      {msg.content && (
                        <button onClick={() => toggleStep(msg.id)} className="shrink-0" style={{ color: C.textDim }}>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      )}
                    </div>
                    {msg.content && (
                      <div className="mt-2 ml-2">
                        <p className="text-sm leading-relaxed" style={{ color: C.textBody }}>
                          {isExpanded ? msg.content : `${msg.content.substring(0, 120)}${msg.content.length > 120 ? "…" : ""}`}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            /* No steps and no messages */
            <div className="px-5 py-6 text-center">
              <p className="text-xs" style={{ color: C.textDim }}>No sequence steps or messages defined for this campaign yet.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main Export ── */
export default function CampaignJourney({
  campaign, messages, replies,
}: {
  campaign: Campaign | null;
  messages: Message[];
  replies: Reply[];
}) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const toggleStep = (key: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!campaign) {
    return (
      <div className="rounded-xl border p-12 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="text-3xl mb-3">🚀</div>
        <p className="text-sm font-semibold mb-1" style={{ color: C.textPrimary }}>No campaign assigned</p>
        <p className="text-xs" style={{ color: C.textDim }}>This contact hasn't been assigned to a campaign yet.</p>
      </div>
    );
  }

  const campMsgs = messages
    .filter(m => m.campaign_id === campaign.id)
    .sort((a, b) => (a.step_number ?? 0) - (b.step_number ?? 0));
  const campReps = replies.filter(r => r.campaign_id === campaign.id);

  return (
    <CampaignBlock
      campaign={campaign}
      campMessages={campMsgs}
      campReplies={campReps}
      expandedSteps={expandedSteps}
      toggleStep={toggleStep}
      defaultOpen={true}
    />
  );
}
