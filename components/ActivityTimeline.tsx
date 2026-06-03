"use client";

import { useState, useEffect } from "react";
import { C } from "@/lib/design";
import { Mail, PlusCircle, ChevronDown, ChevronUp, MessageSquare, StickyNote, Trash2, Loader2, Paperclip } from "lucide-react";
import { LinkedInIcon } from "@/components/SocialIcons";
import LeadChatThread from "@/components/LeadChatThread";

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
  /** Attachments fetched from the campaign's sequence_steps[stepNumber-1].attachments
   *  so the timeline can render a paperclip chip alongside the message body. */
  attachments?: Array<{ name: string; mimeType?: string; sizeBytes?: number }>;
};

type Note = {
  // Legacy fields kept so existing callers compile; new fields come from
  // /api/leads/[id]/notes after the post-2026-05-15 refactor.
  id?: string;
  author: string;
  text: string;
  time: string;
  // New: real fields hydrated from the API.
  created_at?: string;
  created_by?: string | null;
  author_name?: string | null;
};

function ChannelIcon({ channel, size = 14 }: { channel: string; size?: number }) {
  const s = size > 14 ? "text-base" : "text-sm";
  if (channel === "linkedin") return <LinkedInIcon size={size} />;
  if (channel === "email") return <span className={s}>✉️</span>;
  if (channel === "call") return <span className={s}>📱</span>;
  if (channel === "whatsapp") return <span className={s}>💬</span>;
  return <span className={s}>💬</span>;
}

const channelIcons: Record<string, { icon?: typeof Mail; color: string; bg: string; label: string }> = {
  linkedin: { color: C.linkedin, bg: "#EFF6FF",   label: "LinkedIn" },
  email:    { color: C.email,    bg: "#ECFDF5",   label: "Email" },
  call:     { color: C.phone,    bg: "#FFF7ED",   label: "Phone" },
  whatsapp: { color: "#25D366",  bg: "#F0FDF4",   label: "WhatsApp" },
};

const classificationStyles: Record<string, { label: string; color: string; bg: string }> = {
  positive:       { label: "POSITIVE",       color: C.green,  bg: C.greenLight },
  meeting_intent: { label: "MEETING INTENT", color: C.green,  bg: C.greenLight },
  needs_info:     { label: "NEEDS INFO",     color: C.blue,   bg: C.blueLight },
  nurturing:      { label: "NURTURING",      color: C.accent, bg: C.accentLight },
  not_now:        { label: "NOT NOW",        color: C.orange, bg: C.orangeLight },
  negative:       { label: "NEGATIVE",       color: C.red,    bg: C.redLight },
  unsubscribe:    { label: "UNSUBSCRIBE",    color: C.red,    bg: C.redLight },
  spam:           { label: "SPAM",           color: C.textMuted, bg: C.surface },
  auto_reply:     { label: "AUTO-REPLY",     color: C.textMuted, bg: C.surface },
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

export default function ActivityTimeline({ activities, notes: initialNotes, leadId }: { activities: ActivityItem[]; notes: Note[]; leadId?: string }) {
  const [filter, setFilter] = useState<"all" | "messages" | "replies" | "calls">("all");
  // Timeline (event log) vs Chat (read-only conversation thread for this lead).
  const [view, setView] = useState<"timeline" | "chat">("timeline");
  const [contactFilter, setContactFilter] = useState("all");
  const [expandedMsgs, setExpandedMsgs] = useState<Set<string>>(new Set());
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [notes, setNotes] = useState(initialNotes);
  const [noteError, setNoteError] = useState("");
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

  // Hydrate notes from /api/leads/[id]/notes on mount so the SSR-passed
  // `initialNotes` (which is the legacy lead.seller_notes single-string)
  // gets replaced with real per-note rows including author + timestamp.
  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/leads/${leadId}/notes`, { cache: "no-store" });
        if (!res.ok) return;
        const { notes: rows } = await res.json();
        if (cancelled || !Array.isArray(rows)) return;
        setNotes(rows.map((r: { id: string; content: string; created_at: string; created_by: string | null; author_name: string | null }) => ({
          id: r.id,
          author: r.author_name ?? "Team",
          author_name: r.author_name,
          text: r.content,
          time: timeAgo(r.created_at),
          created_at: r.created_at,
          created_by: r.created_by,
        })));
      } catch {
        /* keep initialNotes on network error */
      }
    })();
    return () => { cancelled = true; };
  }, [leadId]);

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
        {/* View toggle — Timeline (event log) vs Chat (read-only conversation
            thread for this lead, reusing the inbox thread API). */}
        <div className="flex items-center gap-1 mb-4 px-2">
          {(["timeline", "chat"] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors"
              style={{
                backgroundColor: view === v ? "color-mix(in srgb, var(--brand, #c9a83a) 12%, transparent)" : "transparent",
                color: view === v ? "var(--brand, #c9a83a)" : C.textMuted,
                borderColor: view === v ? "color-mix(in srgb, var(--brand, #c9a83a) 40%, transparent)" : C.border,
              }}>
              {v === "timeline" ? "Timeline" : "Chat"}
            </button>
          ))}
        </div>
        {view === "chat" ? (
          <LeadChatThread leadId={leadId} leadName={activities.find(a => a.contactName)?.contactName ?? null} />
        ) : (
        <>
        {/* Filter bar */}
        <div className="flex items-center gap-2 mb-5 flex-wrap px-2">
          {(["all", "messages", "replies", "calls"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="text-xs font-medium px-3 py-1.5 rounded-full border transition-[opacity,transform,box-shadow,background-color,border-color]"
              style={{
                backgroundColor: filter === f ? "var(--brand, #c9a83a)" : "transparent",
                color: filter === f ? "white" : C.textMuted,
                borderColor: filter === f ? "var(--brand, #c9a83a)" : C.border,
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
          <div
            className="rounded-2xl border py-14 text-center"
            style={{
              backgroundColor: C.card,
              borderColor: C.border,
              boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
            }}
          >
            <div
              className="w-14 h-14 mx-auto mb-4 rounded-2xl flex items-center justify-center"
              style={{
                backgroundColor: "color-mix(in srgb, var(--brand, #c9a83a) 10%, transparent)",
                border: "1px solid color-mix(in srgb, var(--brand, #c9a83a) 22%, transparent)",
              }}
            >
              <MessageSquare size={22} style={{ color: "var(--brand, #c9a83a)" }} />
            </div>
            <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>No activity yet</p>
            <p className="text-xs mt-1.5" style={{ color: C.textDim }}>Messages, replies and calls will appear here as they happen.</p>
          </div>
        ) : (
          <div className="space-y-6 px-2">
            {groups.map(group => (
              <div key={group.date}>
                {/* Date header */}
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xs font-bold px-2 py-0.5 rounded"
                    style={{ backgroundColor: "var(--brand, #c9a83a)", color: "white" }}>
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
                      const accentColor = item.requiresReview ? "#D97706" : isPositive ? C.green : cls.color;
                      return (
                        <div
                          key={item.id}
                          className="rounded-2xl border p-4 relative overflow-hidden"
                          style={{
                            backgroundColor: item.requiresReview ? "#FFFBEB" : isPositive ? C.greenLight : C.card,
                            borderColor: item.requiresReview ? "#FDE68A" : isPositive ? "#BBF7D0" : C.border,
                            borderTop: `3px solid ${accentColor}`,
                            boxShadow: "0 4px 16px rgba(0,0,0,0.04)",
                          }}
                        >
                          {/* Soft halo per classification */}
                          <div
                            aria-hidden
                            className="absolute -top-10 -right-10 w-28 h-28 rounded-full pointer-events-none opacity-40"
                            style={{ background: `radial-gradient(circle, color-mix(in srgb, ${accentColor} 18%, transparent) 0%, transparent 70%)` }}
                          />
                          <div className="flex items-start justify-between mb-2 relative">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                                style={{
                                  backgroundColor: ch.bg,
                                  border: `1px solid color-mix(in srgb, ${ch.color} 20%, transparent)`,
                                  boxShadow: `0 0 14px color-mix(in srgb, ${ch.color} 16%, transparent)`,
                                }}
                              >
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
                              <span
                                className="text-[10px] font-bold tracking-wider px-2.5 py-0.5 rounded-full"
                                style={{
                                  color: cls.color,
                                  backgroundColor: cls.bg,
                                  border: `1px solid color-mix(in srgb, ${cls.color} 22%, transparent)`,
                                }}
                              >
                                {cls.label}
                              </span>
                              {item.aiConfidence && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: C.surface, color: C.textMuted }}>
                                  {Math.round(item.aiConfidence * 100)}% AI
                                </span>
                              )}
                            </div>
                          </div>

                          {item.content && (
                            <div
                              className="ml-11 mt-2 px-3.5 py-2.5 rounded-xl"
                              style={{
                                backgroundColor: "rgba(255,255,255,0.75)",
                                border: "1px solid rgba(0,0,0,0.04)",
                              }}
                            >
                              <p className="text-sm leading-relaxed italic" style={{ color: C.textBody }}>&ldquo;{item.content}&rdquo;</p>
                            </div>
                          )}

                          {item.requiresReview && (
                            <div className="ml-11 mt-3 flex items-center gap-3 relative">
                              <button
                                className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-90"
                                style={{ backgroundColor: "var(--brand, #c9a83a)", color: "#04070d" }}
                              >
                                Reply Now
                              </button>
                              <button className="text-xs font-medium hover:underline" style={{ color: C.textMuted }}>Dismiss</button>
                            </div>
                          )}
                        </div>
                      );
                    }

                    if (item.type === "campaign_start") {
                      return (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 px-4 py-3 rounded-xl border"
                          style={{
                            backgroundColor: C.card,
                            borderColor: C.border,
                            borderLeft: "3px solid var(--brand, #c9a83a)",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
                          }}
                        >
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-base"
                            style={{
                              backgroundColor: "color-mix(in srgb, var(--brand, #c9a83a) 10%, transparent)",
                              border: "1px solid color-mix(in srgb, var(--brand, #c9a83a) 22%, transparent)",
                            }}
                          >
                            🏁
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>
                              Campaign started — {item.content ?? "Outreach"}
                            </p>
                            {item.sellerName && (
                              <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>Assigned to: <span className="font-semibold" style={{ color: "var(--brand, #c9a83a)" }}>{item.sellerName}</span></p>
                            )}
                          </div>
                        </div>
                      );
                    }

                    if (item.type === "lead_created") {
                      return (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 px-4 py-2.5 rounded-xl border"
                          style={{
                            backgroundColor: C.bg,
                            borderColor: C.border,
                            borderLeft: `3px solid ${C.textMuted}`,
                          }}
                        >
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: C.card }}>
                            <PlusCircle size={14} style={{ color: C.textMuted }} />
                          </div>
                          <p className="text-sm font-medium" style={{ color: C.textBody }}>Lead created</p>
                        </div>
                      );
                    }

                    // message_sent (default)
                    const isExpanded = expandedMsgs.has(item.id);
                    const toggleExpand = () => setExpandedMsgs(prev => {
                      const next = new Set(prev);
                      if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                      return next;
                    });
                    return (
                      <div
                        key={item.id}
                        className="rounded-xl border overflow-hidden transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-md"
                        style={{
                          backgroundColor: C.card,
                          borderColor: C.border,
                          boxShadow: isExpanded ? "0 4px 16px rgba(0,0,0,0.05)" : "0 1px 3px rgba(0,0,0,0.02)",
                        }}
                      >
                        <button
                          onClick={item.content ? toggleExpand : undefined}
                          className={`w-full flex items-center gap-3 px-4 py-3 ${item.content ? "cursor-pointer" : "cursor-default"} text-left`}
                          disabled={!item.content}
                        >
                          <div
                            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                            style={{
                              backgroundColor: ch.bg,
                              border: `1px solid color-mix(in srgb, ${ch.color} 18%, transparent)`,
                            }}
                          >
                            <ChannelIcon channel={item.channel} />
                          </div>
                          <p className="text-sm flex-1" style={{ color: C.textBody }}>
                            {item.channel === "call" ? "Call to" : item.channel === "email" ? "Email sent to" : "DM sent to"}{" "}
                            <span className="font-semibold" style={{ color: C.textPrimary }}>{item.contactName}</span>
                            {item.stepNumber !== undefined ? (
                              <span
                                className="ml-2 text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded"
                                style={{ backgroundColor: "color-mix(in srgb, var(--brand, #c9a83a) 8%, transparent)", color: "var(--brand, #c9a83a)" }}
                              >
                                STEP {item.stepNumber}
                              </span>
                            ) : ""}
                          </p>
                          <span className="text-xs shrink-0 mr-2 tabular-nums" style={{ color: C.textDim }}>{formatTime(item.timestamp)}</span>
                          {item.content && (
                            <span className="shrink-0 p-1 rounded">
                              {isExpanded ? <ChevronUp size={14} style={{ color: C.textDim }} /> : <ChevronDown size={14} style={{ color: C.textDim }} />}
                            </span>
                          )}
                        </button>
                        {isExpanded && item.content && (
                          <div
                            className="px-4 pb-4 pt-3 border-t"
                            style={{
                              borderColor: C.border,
                              background: "linear-gradient(180deg, rgba(0,0,0,0.015) 0%, transparent 60%)",
                            }}
                          >
                            <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{item.content}</p>
                            {/* Paperclip chips for files the dispatcher attached
                                via Unipile multipart. Caller fills attachments
                                from campaigns.sequence_steps[stepNumber-1].attachments. */}
                            {Array.isArray(item.attachments) && item.attachments.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {item.attachments.map((a, idx) => (
                                  <span key={idx}
                                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border"
                                    title={a.mimeType ? `${a.mimeType}${a.sizeBytes ? ` · ${Math.round(a.sizeBytes / 1024)}KB` : ""}` : undefined}
                                    style={{ borderColor: C.border, backgroundColor: C.surface, color: C.textBody }}>
                                    <Paperclip size={10} style={{ color: C.textMuted }} /> {a.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        </>
        )}
      </div>

      {/* ── RIGHT: Notes + Channel Indicators ── */}
      <div className="space-y-5 pr-2">

        {/* Team Notes */}
        <div
          className="rounded-2xl border p-5 relative overflow-hidden"
          style={{
            backgroundColor: C.card,
            borderColor: C.border,
            borderTop: "3px solid var(--brand, #c9a83a)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
          }}
        >
          <div
            aria-hidden
            className="absolute -top-12 -right-12 w-32 h-32 rounded-full pointer-events-none opacity-30"
            style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--brand, #c9a83a) 18%, transparent) 0%, transparent 70%)" }}
          />
          <div className="flex items-center gap-2 mb-4 relative">
            <StickyNote size={14} style={{ color: "var(--brand, #c9a83a)" }} />
            <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: C.textPrimary }}>Team Notes</h3>
            {notes.length > 0 && (
              <span className="text-[10px] font-semibold ml-auto tabular-nums" style={{ color: C.textDim }}>
                {notes.length} {notes.length === 1 ? "note" : "notes"}
              </span>
            )}
          </div>

          <div className="mb-4">
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Add a note about this lead..."
              rows={3}
              className="w-full text-sm px-3 py-2 rounded-lg border resize-none"
              style={{ borderColor: C.border, color: C.textBody }}
            />
            {noteError && <p className="text-xs mt-1" style={{ color: C.red }}>{noteError}</p>}
            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                disabled={savingNote || !noteText.trim() || !leadId}
                onClick={async () => {
                  if (!leadId || !noteText.trim()) return;
                  setSavingNote(true);
                  setNoteError("");
                  try {
                    const res = await fetch(`/api/leads/${leadId}/notes`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ content: noteText.trim() }),
                    });
                    if (res.ok) {
                      const { note } = await res.json();
                      // Prepend so the newest note is on top (matches the
                      // DESC order the GET endpoint returns).
                      setNotes(prev => [
                        {
                          id: note.id,
                          author: note.author_name ?? "Team",
                          author_name: note.author_name,
                          text: note.content,
                          time: timeAgo(note.created_at),
                          created_at: note.created_at,
                          created_by: note.created_by,
                        },
                        ...prev,
                      ]);
                      setNoteText("");
                    } else {
                      const data = await res.json();
                      setNoteError(data.error ?? "Failed to save");
                    }
                  } catch {
                    setNoteError("Network error");
                  } finally {
                    setSavingNote(false);
                  }
                }}
                className="text-xs font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-40"
                style={{ backgroundColor: "var(--brand, #c9a83a)" }}>
                {savingNote ? "Saving…" : "Add Note"}
              </button>
            </div>
          </div>

          {notes.length > 0 ? (
            <div
              className="space-y-4 overflow-y-auto pr-1"
              // Cap the visible notes area so adding many doesn't push the
              // composer + rest of the page down. Scrolls inside the card.
              // Roughly fits ~5 notes before scroll kicks in.
              style={{ maxHeight: 360 }}>
              {notes.map((note, i) => {
                const key = note.id ?? `legacy-${i}`;
                const canDelete = !!note.id && !!leadId;
                const isDeleting = deletingNoteId === note.id;
                return (
                  <div key={key} className="flex items-start gap-3 group">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                      style={{ backgroundColor: "var(--brand, #c9a83a)" }}>
                      {(note.author_name ?? note.author ?? "?")[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <span className="text-sm font-semibold truncate" style={{ color: C.textPrimary }}>
                          {note.author_name ?? note.author}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-xs tabular-nums" style={{ color: C.textDim }}>
                            {note.created_at ? timeAgo(note.created_at) : note.time}
                          </span>
                          {canDelete && (
                            <button
                              onClick={async () => {
                                if (!note.id || !leadId) return;
                                if (!confirm("Delete this note?")) return;
                                setDeletingNoteId(note.id);
                                try {
                                  const res = await fetch(`/api/leads/${leadId}/notes?noteId=${note.id}`, { method: "DELETE" });
                                  if (res.ok) {
                                    setNotes(prev => prev.filter(n => n.id !== note.id));
                                  }
                                } finally {
                                  setDeletingNoteId(null);
                                }
                              }}
                              disabled={isDeleting}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-black/[0.04]"
                              title="Delete note"
                              style={{ color: C.textDim }}>
                              {isDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{note.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-center py-3" style={{ color: C.textDim }}>No notes yet — write the first one above.</p>
          )}
        </div>

        {/* Channel Indicators */}
        <div
          className="rounded-2xl border p-5"
          style={{
            backgroundColor: C.card,
            borderColor: C.border,
            boxShadow: "0 4px 16px rgba(0,0,0,0.04)",
          }}
        >
          <h3 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: C.textMuted }}>Channel Indicators</h3>
          <div className="space-y-2.5">
            {Object.entries(channelIcons).map(([key, { color, bg, label }]) => (
              <div
                key={key}
                className="flex items-center gap-3 px-3 py-2 rounded-lg"
                style={{
                  backgroundColor: bg,
                  border: `1px solid color-mix(in srgb, ${color} 18%, transparent)`,
                }}
              >
                <ChannelIcon channel={key} size={14} />
                <span className="text-sm font-medium" style={{ color: color }}>
                  {label}
                </span>
                <span className="text-xs ml-auto" style={{ color: C.textMuted }}>
                  {key === "linkedin" ? "Integration" : key === "email" ? "Outreach" : "Logs"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
