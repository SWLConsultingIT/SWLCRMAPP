"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import {
  Share2, Mail, Phone, Check, Pencil, X, Save,
  PlayCircle, Loader2, Pause, Play, Trash2, Send,
  MessageCircle, Inbox, GitBranch, ThumbsUp, ThumbsDown, HelpCircle,
} from "lucide-react";

const gold = "#C9A83A";

const channelMeta: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  linkedin: { icon: Share2, color: C.linkedin, label: "LinkedIn" },
  email:    { icon: Mail,   color: C.email,    label: "Email" },
  whatsapp: { icon: Mail,   color: "#22c55e",  label: "WhatsApp" },
  call:     { icon: Phone,  color: C.phone,    label: "Call" },
};

type Message = {
  id: string; campaign_id: string; lead_id: string; step_number: number;
  channel: string; content: string; status: string; sent_at: string | null; created_at: string;
};

type Reply = {
  id: string; lead_id: string; campaign_id: string; channel: string;
  reply_text: string; classification: string; received_at: string;
  ai_confidence?: number; requires_human_review?: boolean;
};

const classificationMeta: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  positive: { label: "Positive", color: C.green, icon: ThumbsUp },
  meeting_intent: { label: "Meeting Intent", color: C.green, icon: ThumbsUp },
  needs_info: { label: "Question", color: C.blue, icon: HelpCircle },
  not_now: { label: "Not Now", color: "#D97706", icon: Pause },
  negative: { label: "Negative", color: C.red, icon: ThumbsDown },
  unsubscribe: { label: "Unsubscribe", color: C.red, icon: X },
};

export default function CampaignDetailClient({
  campaignId, campaignStatus, sequence, messages, dayPerStep, currentStep,
  replies, autoReplies, leadName,
}: {
  campaignId: string; campaignStatus: string;
  sequence: { channel: string; daysAfter: number }[];
  messages: Message[]; dayPerStep: number[]; currentStep: number;
  replies: Reply[]; autoReplies: { positive?: string; negative?: string };
  leadName: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState(0);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  function startEdit(msg: Message) {
    setEditingIdx(msg.step_number);
    setEditContent(msg.content ?? "");
  }

  async function saveEdit(msg: Message) {
    setSaving(true);
    const res = await fetch(`/api/messages/${msg.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editContent }),
    });
    if (res.ok) { setEditingIdx(null); router.refresh(); }
    setSaving(false);
  }

  async function handleCampaignAction(action: "pause" | "resume" | "cancel") {
    setActing(action);
    const newStatus = action === "pause" ? "paused" : action === "resume" ? "active" : "completed";
    await supabase.from("campaigns").update({ status: newStatus }).eq("id", campaignId);
    setActing(null);
    router.refresh();
  }

  const isEditable = campaignStatus === "active" || campaignStatus === "paused";
  const tabs = [
    { label: "Sent Messages", icon: Send, count: messages.filter(m => m.status === "sent").length },
    { label: "Received", icon: Inbox, count: replies.length },
    { label: "Funnel", icon: GitBranch, count: 0 },
  ];

  return (
    <div>
      {/* Campaign actions bar */}
      {isEditable && (
        <div className="rounded-xl border px-5 py-3 mb-6 flex items-center gap-3"
          style={{ backgroundColor: C.card, borderColor: C.border }}>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Campaign Actions</span>
          <div className="flex-1" />
          {campaignStatus === "active" ? (
            <button onClick={() => handleCampaignAction("pause")} disabled={!!acting}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50"
              style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}>
              {acting === "pause" ? <Loader2 size={12} className="animate-spin" /> : <Pause size={12} />} Pause
            </button>
          ) : (
            <button onClick={() => handleCampaignAction("resume")} disabled={!!acting}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50"
              style={{ backgroundColor: C.greenLight, color: C.green }}>
              {acting === "resume" ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Resume
            </button>
          )}
          <button onClick={() => { if (confirm("Cancel this campaign?")) handleCampaignAction("cancel"); }}
            disabled={!!acting}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50"
            style={{ backgroundColor: C.redLight, color: C.red }}>
            {acting === "cancel" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Cancel
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b" style={{ borderColor: C.border }}>
        {tabs.map((t, i) => {
          const active = tab === i;
          const Icon = t.icon;
          return (
            <button key={t.label} onClick={() => setTab(i)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all relative"
              style={{ color: active ? gold : C.textMuted }}>
              <Icon size={15} />
              {t.label}
              {t.count > 0 && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: active ? `${gold}15` : "#F3F4F6", color: active ? gold : C.textDim }}>
                  {t.count}
                </span>
              )}
              {active && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: gold }} />}
            </button>
          );
        })}
      </div>

      {/* ═══ TAB 0: SENT MESSAGES ═══ */}
      {tab === 0 && (
        <div>
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
            <div className="px-6 py-4 border-b" style={{ borderColor: C.border }}>
              <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Outreach Messages</h2>
              <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>Messages sent to {leadName}</p>
            </div>
            <div className="relative">
              <div className="absolute left-9 top-0 bottom-0 w-0.5" style={{ backgroundColor: C.border }} />
              {sequence.map((step, i) => {
                const meta = channelMeta[step.channel] ?? channelMeta.linkedin;
                const Icon = meta.icon;
                const msg = messages.find(m => m.step_number === i);
                const isSent = msg?.status === "sent";
                const isSkipped = msg?.status === "skipped";
                const isCurrent = i === currentStep;
                const isPast = i < currentStep;
                const isEditing = editingIdx === i;

                return (
                  <div key={i} className="relative px-6 py-5" style={{ borderBottom: i < sequence.length - 1 ? `1px solid ${C.border}` : "none" }}>
                    <div className="flex items-start gap-4">
                      <div className="relative z-10 shrink-0">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center"
                          style={{
                            backgroundColor: isSkipped ? C.bg : isPast ? meta.color : isCurrent ? gold : C.bg,
                            border: isPast || isCurrent ? "none" : `2px solid ${C.border}`,
                          }}>
                          {isSkipped ? <X size={13} style={{ color: C.textDim }} /> :
                           isPast ? <Check size={13} color="#fff" /> :
                           isCurrent ? <PlayCircle size={13} color="#fff" /> :
                           <span className="text-xs font-bold" style={{ color: C.textDim }}>{i}</span>}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-md"
                            style={{ backgroundColor: `${meta.color}12`, color: meta.color }}>
                            <Icon size={11} /> {meta.label}
                          </span>
                          <span className="text-xs tabular-nums" style={{ color: C.textDim }}>Day {dayPerStep[i] ?? 0}</span>
                          {isSkipped && <span className="text-xs" style={{ color: C.textDim }}>Skipped</span>}
                          {isSent && msg?.sent_at && (
                            <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md"
                              style={{ backgroundColor: C.greenLight, color: C.green }}>
                              <Send size={10} /> Sent {new Date(msg.sent_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          )}
                          <div className="flex-1" />
                          {msg && !isSkipped && !isEditing && isEditable && msg.status !== "sent" && (
                            <button onClick={() => startEdit(msg)}
                              className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md"
                              style={{ backgroundColor: `${gold}15`, color: gold }}>
                              <Pencil size={11} /> Edit
                            </button>
                          )}
                        </div>
                        {msg && !isEditing && !isSkipped && (
                          <div className="rounded-lg border p-4" style={{
                            borderColor: isSent ? `${C.green}30` : isCurrent ? `${gold}30` : C.border,
                            backgroundColor: isSent ? `${C.green}04` : isCurrent ? `${gold}04` : C.bg,
                          }}>
                            <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{msg.content}</p>
                          </div>
                        )}
                        {isEditing && msg && (
                          <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: gold, backgroundColor: `${gold}04` }}>
                            <textarea rows={5} className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
                              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.card }}
                              value={editContent} onChange={e => setEditContent(e.target.value)} />
                            <div className="flex items-center gap-2">
                              <button onClick={() => saveEdit(msg)} disabled={saving}
                                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50"
                                style={{ backgroundColor: C.green, color: "#fff" }}>
                                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save
                              </button>
                              <button onClick={() => setEditingIdx(null)}
                                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium"
                                style={{ backgroundColor: "#F3F4F6", color: C.textBody }}>
                                <X size={12} /> Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Auto-replies */}
          {(autoReplies?.positive || autoReplies?.negative) && (
            <div className="rounded-xl border overflow-hidden mt-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <div className="px-6 py-4 border-b" style={{ borderColor: C.border }}>
                <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Auto-Replies</h2>
                <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>Automatic responses when lead replies</p>
              </div>
              <div className="p-5 space-y-3">
                {autoReplies.positive && (
                  <div className="rounded-lg border p-4" style={{ borderColor: C.border, backgroundColor: `${C.green}04` }}>
                    <div className="flex items-center gap-2 mb-2">
                      <ThumbsUp size={13} style={{ color: C.green }} />
                      <span className="text-xs font-semibold" style={{ color: C.green }}>Positive Response</span>
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{autoReplies.positive}</p>
                  </div>
                )}
                {autoReplies.negative && (
                  <div className="rounded-lg border p-4" style={{ borderColor: C.border, backgroundColor: `${C.red}04` }}>
                    <div className="flex items-center gap-2 mb-2">
                      <ThumbsDown size={13} style={{ color: C.red }} />
                      <span className="text-xs font-semibold" style={{ color: C.red }}>Negative Response</span>
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{autoReplies.negative}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB 1: RECEIVED ═══ */}
      {tab === 1 && (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.blue}` }}>
          <div className="px-6 py-4 border-b" style={{ borderColor: C.border }}>
            <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Received Messages</h2>
            <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>Replies from {leadName}</p>
          </div>
          {replies.length === 0 ? (
            <div className="py-12 text-center">
              <Inbox size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
              <p className="text-sm" style={{ color: C.textDim }}>No replies received yet</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: C.border }}>
              {replies.map((r) => {
                const cls = classificationMeta[r.classification] ?? { label: r.classification, color: C.textMuted, icon: MessageCircle };
                const ClsIcon = cls.icon;
                return (
                  <div key={r.id} className="px-6 py-4">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xs tabular-nums" style={{ color: C.textMuted }}>
                        {new Date(r.received_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md"
                        style={{ backgroundColor: `${cls.color}15`, color: cls.color }}>
                        <ClsIcon size={11} /> {cls.label}
                      </span>
                      {r.channel && (
                        <span className="text-xs" style={{ color: C.textMuted }}>via {r.channel}</span>
                      )}
                      {r.ai_confidence && (
                        <span className="text-xs" style={{ color: C.textDim }}>{Math.round(r.ai_confidence * 100)}% confidence</span>
                      )}
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{r.reply_text}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB 2: FUNNEL ═══ */}
      {tab === 2 && (() => {
        // Build funnel: merge sent messages + replies in chronological order
        const events: { type: "sent" | "reply"; timestamp: string; step?: number; channel: string; content: string; classification?: string }[] = [];

        messages.filter(m => m.status === "sent" && m.sent_at).forEach(m => {
          events.push({ type: "sent", timestamp: m.sent_at!, step: m.step_number, channel: m.channel, content: m.content });
        });
        replies.forEach(r => {
          events.push({ type: "reply", timestamp: r.received_at, channel: r.channel, content: r.reply_text, classification: r.classification });
        });
        events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

        const totalSteps = sequence.length;
        const replyStep = replies.length > 0 ? messages.filter(m => m.status === "sent" && m.sent_at && new Date(m.sent_at) < new Date(replies[0].received_at)).length : null;

        return (
          <div className="space-y-6">
            {/* Visual Funnel */}
            <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <h2 className="text-sm font-bold mb-6" style={{ color: C.textPrimary }}>Campaign Funnel</h2>

              <div className="flex flex-col items-center gap-1">
                {/* Connection Request (step 0) */}
                {(() => {
                  const crMsg = messages.find(m => m.step_number === 0);
                  const crSent = crMsg?.status === "sent";
                  const crSkipped = crMsg?.status === "skipped";
                  const responded = replyStep !== null && replyStep === 0;
                  return (
                    <div className="relative w-full flex flex-col items-center">
                      <div className="relative flex items-center justify-center py-3"
                        style={{
                          width: "100%",
                          background: crSkipped ? `${C.textDim}15` : crSent || crSkipped ? `${C.linkedin}20` : `${C.border}`,
                          clipPath: "polygon(5% 0%, 95% 0%, 90% 100%, 10% 100%)",
                          borderRadius: 8,
                        }}>
                        <div className="flex items-center gap-2">
                          <Share2 size={14} style={{ color: crSkipped ? C.textDim : C.linkedin }} />
                          <span className="text-xs font-bold" style={{ color: crSkipped ? C.textDim : C.linkedin }}>
                            Connection Request {crSkipped ? "(Skipped)" : crSent ? "✓" : ""}
                          </span>
                        </div>
                      </div>
                      {responded && (
                        <div className="absolute -right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 rounded-full px-2 py-1"
                          style={{ backgroundColor: C.blue, color: "#fff" }}>
                          <Inbox size={10} /> <span className="text-xs font-bold">Reply!</span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Sequence steps */}
                {sequence.map((step, i) => {
                  const msg = messages.find(m => m.step_number === i + 1);
                  const wasSent = msg?.status === "sent";
                  const meta = channelMeta[step.channel] ?? channelMeta.linkedin;
                  const Icon = meta.icon;
                  const widthPct = 100 - ((i + 1) * (60 / sequence.length));
                  const responded = replyStep !== null && replyStep === i + 1;
                  const notReached = !wasSent && (replyStep !== null && i + 1 > replyStep);

                  // Step labels
                  const stepLabels: Record<number, string> = {};
                  let liCount = 0;
                  sequence.forEach((s, idx) => {
                    if (s.channel === "linkedin") {
                      liCount++;
                      if (liCount === 1) stepLabels[idx] = "First DM";
                      else stepLabels[idx] = `Follow-up ${liCount - 1}`;
                    } else if (s.channel === "email") {
                      stepLabels[idx] = "Email";
                    } else if (s.channel === "call") {
                      stepLabels[idx] = "Call";
                    }
                  });

                  return (
                    <div key={i} className="relative flex flex-col items-center" style={{ width: "100%" }}>
                      <div className="relative flex items-center justify-center py-3"
                        style={{
                          width: `${widthPct}%`,
                          background: notReached ? `${C.border}` : wasSent ? `${meta.color}25` : `${meta.color}10`,
                          clipPath: "polygon(5% 0%, 95% 0%, 90% 100%, 10% 100%)",
                          borderRadius: 6,
                          opacity: notReached ? 0.4 : 1,
                        }}>
                        <div className="flex items-center gap-2">
                          <Icon size={13} style={{ color: notReached ? C.textDim : meta.color }} />
                          <span className="text-xs font-bold" style={{ color: notReached ? C.textDim : meta.color }}>
                            {stepLabels[i] ?? `Step ${i + 1}`} {wasSent ? "✓" : notReached ? "✗" : ""}
                          </span>
                          <span className="text-xs" style={{ color: C.textDim }}>Day {dayPerStep[i]}</span>
                        </div>
                      </div>
                      {responded && (
                        <div className="absolute -right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 rounded-full px-2.5 py-1 z-10"
                          style={{ backgroundColor: C.blue, color: "#fff" }}>
                          <Inbox size={10} /> <span className="text-xs font-bold">Reply!</span>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Result */}
                <div className="mt-2 flex items-center justify-center py-3 rounded-lg"
                  style={{
                    width: `${Math.max(20, 100 - ((sequence.length + 1) * (60 / sequence.length)))}%`,
                    background: replies.some(r => ["positive", "meeting_intent"].includes(r.classification))
                      ? `${C.green}25`
                      : replies.some(r => ["negative", "unsubscribe"].includes(r.classification))
                      ? `${C.red}25`
                      : replies.length > 0
                      ? `${C.blue}25`
                      : `${C.textDim}10`,
                  }}>
                  <span className="text-xs font-bold" style={{
                    color: replies.some(r => ["positive", "meeting_intent"].includes(r.classification))
                      ? C.green
                      : replies.some(r => ["negative", "unsubscribe"].includes(r.classification))
                      ? C.red
                      : replies.length > 0
                      ? C.blue
                      : C.textDim,
                  }}>
                    {replies.some(r => ["positive", "meeting_intent"].includes(r.classification))
                      ? "→ Odoo Lead Created"
                      : replies.some(r => ["negative", "unsubscribe"].includes(r.classification))
                      ? "→ Closed Lost"
                      : replies.length > 0
                      ? "→ Conversation Active"
                      : "→ No Response Yet"}
                  </span>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-4 gap-4 mt-6 pt-4 border-t" style={{ borderColor: C.border }}>
                <div className="text-center">
                  <p className="text-xl font-bold" style={{ color: C.textPrimary }}>{totalSteps}</p>
                  <p className="text-xs" style={{ color: C.textMuted }}>Total Steps</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold" style={{ color: C.green }}>{messages.filter(m => m.status === "sent").length}</p>
                  <p className="text-xs" style={{ color: C.textMuted }}>Sent</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold" style={{ color: C.blue }}>{replies.length}</p>
                  <p className="text-xs" style={{ color: C.textMuted }}>Replies</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold" style={{ color: gold }}>{replyStep !== null ? `Step ${replyStep}` : "—"}</p>
                  <p className="text-xs" style={{ color: C.textMuted }}>Replied After</p>
                </div>
              </div>
            </div>

            {/* Timeline */}
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <div className="px-6 py-4 border-b" style={{ borderColor: C.border }}>
                <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Conversation Timeline</h2>
              </div>
              <div className="relative">
                <div className="absolute left-9 top-0 bottom-0 w-0.5" style={{ backgroundColor: C.border }} />
                {events.map((ev, i) => {
                  const isSent = ev.type === "sent";
                  const cls = ev.classification ? classificationMeta[ev.classification] : null;
                  return (
                    <div key={i} className="relative px-6 py-4" style={{ borderBottom: i < events.length - 1 ? `1px solid ${C.border}` : "none" }}>
                      <div className="flex items-start gap-4">
                        <div className="relative z-10 shrink-0">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center"
                            style={{ backgroundColor: isSent ? gold : C.blue }}>
                            {isSent ? <Send size={12} color="#fff" /> : <Inbox size={12} color="#fff" />}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-semibold" style={{ color: isSent ? gold : C.blue }}>
                              {isSent ? "Sent" : "Reply from " + leadName}
                            </span>
                            {ev.step !== undefined && <span className="text-xs" style={{ color: C.textDim }}>Step {ev.step}</span>}
                            {cls && (
                              <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md"
                                style={{ backgroundColor: `${cls.color}15`, color: cls.color }}>
                                {cls.label}
                              </span>
                            )}
                            <span className="text-xs tabular-nums ml-auto" style={{ color: C.textDim }}>
                              {new Date(ev.timestamp).toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>
                            {ev.content.length > 200 ? `${ev.content.slice(0, 200)}...` : ev.content}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {events.length === 0 && (
                  <div className="py-12 text-center">
                    <p className="text-sm" style={{ color: C.textDim }}>No activity yet</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
