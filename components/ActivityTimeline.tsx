"use client";

import { useState } from "react";
import { C } from "@/lib/design";
import { Mail, Phone, AlertTriangle, MessageSquare, Send, UserPlus, Zap, PlusCircle } from "lucide-react";
import { LinkedInIcon } from "@/components/SocialIcons";

type ActivityItem = {
  id: string;
  type: "message_sent" | "reply" | "campaign_start" | "lead_created";
  contactName: string;
  channel: string;
  content: string | null;
  timestamp: string;
  stepNumber?: number;
  classification?: string;
  aiConfidence?: number;
  requiresReview?: boolean;
  sellerName?: string;
};

type Note = {
  author: string;
  text: string;
  time: string;
};

function ChannelIcon({ channel, size = 14 }: { channel: string; size?: number }) {
  const s = size > 14 ? "text-base" : "text-sm";
  if (channel === "linkedin") return <LinkedInIcon size={size} />;
  if (channel === "email") return <span className={s}>✉️</span>;
  if (channel === "call") return <span className={s}>📱</span>;
  return <span className={s}>💬</span>;
}

const channelIcons: Record<string, { color: string; bg: string; label: string }> = {
  linkedin: { color: C.linkedin, bg: "#EFF6FF", label: "LinkedIn" },
  email:    { icon: Mail, color: C.email, bg: "#ECFDF5", label: "Email" },
  call:     { icon: Phone, color: C.phone, bg: "#FFF7ED", label: "Phone" },
};

const classificationStyles: Record<string, { label: string; color: string; bg: string }> = {
  positive:       { label: "POSITIVE",       color: C.green,  bg: C.greenLight },
  meeting_intent: { label: "MEETING INTENT", color: C.green,  bg: C.greenLight },
  needs_info:     { label: "NEEDS INFO",     color: C.blue,   bg: C.blueLight },
  nurturing:      { label: "NURTURING",      color: C.accent, bg: C.accentLight },
  not_now:        { label: "NOT NOW",        color: C.orange, bg: C.orangeLight },
  negative:       { label: "NEGATIVE",       color: C.red,    bg: C.redLight },
  unsubscribe:    { label: "UNSUBSCRIBE",    color: C.red,    bg: C.redLight },
  spam:           { label: "SPAM",           color: C.textMuted, bg: "#F3F4F6" },
  auto_reply:     { label: "AUTO-REPLY",     color: C.textMuted, bg: "#F3F4F6" },
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatDateGroup(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "TODAY";
  if (diff === 1) return "YESTERDAY";
  return d.toLocaleDateString("en-GB", { month: "short", day: "numeric" }).toUpperCase();
}

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ActivityTimeline({ activities, notes }: { activities: ActivityItem[]; notes: Note[] }) {
  const [filter, setFilter] = useState<"all" | "messages" | "replies" | "calls">("all");
  const [contactFilter, setContactFilter] = useState("all");

  const contacts = [...new Set(activities.map(a => a.contactName))];
  const needsReviewCount = activities.filter(a => a.requiresReview).length;

  const filtered = activities.filter(a => {
    if (filter === "messages" && a.type !== "message_sent") return false;
    if (filter === "replies" && a.type !== "reply") return false;
    if (filter === "calls" && a.channel !== "call") return false;
    if (contactFilter !== "all" && a.contactName !== contactFilter) return false;
    return true;
  });

  // Group by date
  const groups: { date: string; items: ActivityItem[] }[] = [];
  filtered.forEach(item => {
    const dateKey = new Date(item.timestamp).toDateString();
    const existing = groups.find(g => g.date === dateKey);
    if (existing) existing.items.push(item);
    else groups.push({ date: dateKey, items: [item] });
  });

  return (
    <div className="grid grid-cols-[1fr_420px] gap-6">

      {/* ── LEFT: Timeline ── */}
      <div>
        {/* Filter bar */}
        <div className="flex items-center gap-2 mb-5 flex-wrap px-2">
          {(["all", "messages", "replies", "calls"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="text-xs font-medium px-3 py-1.5 rounded-full border transition-all"
              style={{
                backgroundColor: filter === f ? "#C9A83A" : "transparent",
                color: filter === f ? "white" : C.textMuted,
                borderColor: filter === f ? "#C9A83A" : C.border,
              }}>
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}

          {needsReviewCount > 0 && (
            <button onClick={() => setFilter("replies")}
              className="text-xs font-bold px-3 py-1.5 rounded-full border-l-4 ml-2"
              style={{ borderLeftColor: C.orange, backgroundColor: C.orangeLight, color: C.orange }}>
              Needs Review ({needsReviewCount})
            </button>
          )}

          <select value={contactFilter} onChange={e => setContactFilter(e.target.value)}
            className="ml-auto text-xs px-3 py-1.5 rounded-lg border"
            style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.card }}>
            <option value="all">All contacts</option>
            {contacts.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Timeline groups */}
        {groups.length === 0 ? (
          <div className="rounded-xl border p-12 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <p className="text-sm" style={{ color: C.textDim }}>No activity yet</p>
          </div>
        ) : (
          <div className="space-y-6 px-2">
            {groups.map(group => (
              <div key={group.date}>
                {/* Date header */}
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xs font-bold px-2 py-0.5 rounded"
                    style={{ backgroundColor: "#C9A83A", color: "white" }}>
                    {formatDateGroup(group.items[0].timestamp)}
                  </span>
                  <div className="flex-1 h-px" style={{ backgroundColor: C.border }} />
                </div>

                {/* Items */}
                <div className="space-y-2.5 pl-4 pr-2">
                  {group.items.map(item => {
                    const ch = channelIcons[item.channel] ?? channelIcons.email;

                    if (item.type === "reply") {
                      const cls = classificationStyles[item.classification ?? ""] ?? classificationStyles.auto_reply;
                      const isPositive = ["positive", "meeting_intent"].includes(item.classification ?? "");
                      return (
                        <div key={item.id}
                          className="rounded-xl border p-4"
                          style={{
                            backgroundColor: item.requiresReview ? "#FFFBEB" : isPositive ? C.greenLight : C.card,
                            borderColor: item.requiresReview ? "#FDE68A" : isPositive ? "#BBF7D0" : C.border,
                          }}>
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: ch.bg }}>
                                <ChannelIcon channel={item.channel} />
                              </div>
                              <div>
                                <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>
                                  {item.contactName} replied via {ch.label}
                                </p>
                                <p className="text-xs" style={{ color: C.textMuted }}>
                                  {ch.label} Message · {timeAgo(item.timestamp)}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs font-bold px-2 py-0.5 rounded border-l-3"
                                style={{ color: cls.color, backgroundColor: cls.bg, borderLeft: `3px solid ${cls.color}` }}>
                                {cls.label}
                              </span>
                              {item.aiConfidence && (
                                <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: "#F3F4F6", color: C.textMuted }}>
                                  {Math.round(item.aiConfidence * 100)}% AI
                                </span>
                              )}
                            </div>
                          </div>

                          {item.content && (
                            <div className="ml-10 mt-2 px-3 py-2 rounded-lg" style={{ backgroundColor: "rgba(255,255,255,0.7)" }}>
                              <p className="text-sm italic" style={{ color: C.textBody }}>"{item.content}"</p>
                            </div>
                          )}

                          {item.requiresReview && (
                            <div className="ml-10 mt-2 flex items-center gap-3">
                              <button className="text-xs font-semibold" style={{ color: "#C9A83A" }}>Reply Now</button>
                              <button className="text-xs font-medium" style={{ color: C.textMuted }}>Dismiss</button>
                            </div>
                          )}
                        </div>
                      );
                    }

                    if (item.type === "campaign_start") {
                      return (
                        <div key={item.id} className="flex items-center gap-3 px-4 py-3 rounded-lg border"
                          style={{ backgroundColor: C.card, borderColor: C.border }}>
                          <span className="text-base">🏁</span>
                          <div className="flex-1">
                            <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>
                              Campaign started — {item.content ?? "Outreach"}
                            </p>
                            {item.sellerName && (
                              <p className="text-xs" style={{ color: C.textMuted }}>Assigned to: {item.sellerName}</p>
                            )}
                          </div>
                        </div>
                      );
                    }

                    if (item.type === "lead_created") {
                      return (
                        <div key={item.id} className="flex items-center gap-3 px-4 py-3 rounded-lg border"
                          style={{ backgroundColor: C.card, borderColor: C.border }}>
                          <PlusCircle size={16} style={{ color: C.textMuted }} />
                          <p className="text-sm font-medium" style={{ color: C.textBody }}>Lead created</p>
                        </div>
                      );
                    }

                    // message_sent (default)
                    return (
                      <div key={item.id} className="flex items-center gap-3 px-4 py-3 rounded-lg border"
                        style={{ backgroundColor: C.card, borderColor: C.border }}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: ch.bg }}>
                          <ChannelIcon channel={item.channel} />
                        </div>
                        <p className="text-sm flex-1" style={{ color: C.textBody }}>
                          {item.channel === "call" ? "Call to" : item.channel === "email" ? "Email sent to" : "DM sent to"}{" "}
                          <span className="font-semibold" style={{ color: C.textPrimary }}>{item.contactName}</span>
                          {item.stepNumber !== undefined ? ` (Step ${item.stepNumber})` : ""}
                        </p>
                        <span className="text-xs shrink-0" style={{ color: C.textDim }}>{formatTime(item.timestamp)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── RIGHT: Notes + Channel Indicators ── */}
      <div className="space-y-5 pr-2">

        {/* Team Notes */}
        <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <h3 className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: C.textPrimary }}>Team Notes</h3>

          <div className="mb-4">
            <textarea
              placeholder="Add a note about this company..."
              rows={3}
              className="w-full text-sm px-3 py-2 rounded-lg border resize-none"
              style={{ borderColor: C.border, color: C.textBody }}
            />
            <div className="flex items-center justify-end gap-2 mt-2">
              <button className="text-xs font-semibold px-4 py-2 rounded-lg text-white"
                style={{ backgroundColor: "#C9A83A" }}>
                Add Note
              </button>
            </div>
          </div>

          {notes.length > 0 ? (
            <div className="space-y-4">
              {notes.map((note, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ backgroundColor: "#C9A83A" }}>
                    {note.author[0]}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold" style={{ color: C.textPrimary }}>{note.author}</span>
                      <span className="text-xs" style={{ color: C.textDim }}>{note.time}</span>
                    </div>
                    <p className="text-sm leading-relaxed" style={{ color: C.textBody }}>{note.text}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-center py-3" style={{ color: C.textDim }}>No notes yet</p>
          )}
        </div>

        {/* Channel Indicators */}
        <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: C.textMuted }}>Channel Indicators</h3>
          <div className="space-y-3">
            {Object.entries(channelIcons).map(([key, { label }]) => (
              <div key={key} className="flex items-center gap-3">
                <ChannelIcon channel={key} size={16} />
                <span className="text-sm" style={{ color: C.textBody }}>
                  {label} {key === "linkedin" ? "Integration" : key === "email" ? "Outreach" : "Logs"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
