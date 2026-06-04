"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { C } from "@/lib/design";
import { Send, Plus, Hash, User, X, Loader2, MessageSquare, Smile, Trash2 } from "lucide-react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

// Lightweight emoji palette for the composer (no external dep).
const EMOJIS = ["😀","😅","😂","🤣","😊","😍","😘","😎","🤔","😉","🙌","👍","👎","👏","🙏","💪","🔥","✨","🎉","✅","❌","⚠️","💯","👀","🚀","💼","📈","📞","📧","💰","🤝","👋","😇","😮","😢","😡","❤️","💛","💚","💙","⭐","💡","⏰","📌","🎯","🥳"];

// Internal team chat: DMs + named channels. Thread list (left) + message pane
// (right). New messages arrive live via Supabase Realtime on chat_messages
// (RLS scopes delivery to the participant). All reads/writes go through the
// service-role /api/chat routes.

type Member = { userId: string; name: string };
type Thread = { id: string; kind: "dm" | "channel"; title: string; members: Member[]; lastMessage: { body: string; created_at: string } | null; unread: number };
type Msg = { id: string; sender_id: string; sender_name: string | null; body: string; created_at: string };

function ago(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now"; if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function ChatPanel({ initialThreadId }: { initialThreadId?: string | null }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialThreadId ?? null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [composing, setComposing] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const loadThreads = useCallback(async () => {
    try { const r = await fetch("/api/chat/threads", { cache: "no-store" }); const d = await r.json(); setThreads(d.threads ?? []); } catch {}
  }, []);

  const loadMessages = useCallback(async (threadId: string) => {
    try {
      const r = await fetch(`/api/chat/threads/${threadId}/messages`, { cache: "no-store" });
      const d = await r.json();
      setMessages(d.messages ?? []);
      setMe(d.me ?? null);
      fetch(`/api/chat/threads/${threadId}/read`, { method: "POST" }).catch(() => {});
      setThreads(prev => prev.map(t => t.id === threadId ? { ...t, unread: 0 } : t));
    } catch {}
  }, []);

  useEffect(() => { loadThreads(); }, [loadThreads]);
  useEffect(() => { if (activeId) loadMessages(activeId); }, [activeId, loadMessages]);

  // Live messages for the open thread.
  useEffect(() => {
    if (!activeId) return;
    const supabase = getSupabaseBrowser();
    const ch = supabase.channel(`chat-${activeId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `thread_id=eq.${activeId}` }, (payload) => {
        const m = payload.new as Msg;
        setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m]);
        fetch(`/api/chat/threads/${activeId}/read`, { method: "POST" }).catch(() => {});
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeId]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages]);

  async function send() {
    if (!input.trim() || !activeId) return;
    const body = input.trim();
    setInput("");
    setSending(true);
    try {
      const r = await fetch(`/api/chat/threads/${activeId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
      if (r.ok) { const d = await r.json(); setMessages(prev => prev.some(x => x.id === d.message.id) ? prev : [...prev, d.message]); loadThreads(); }
    } finally { setSending(false); }
  }

  async function delThread(id: string) {
    if (!confirm("Delete this conversation for everyone? This can't be undone.")) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/chat/threads/${id}`, { method: "DELETE" });
      if (r.ok) {
        setThreads(prev => prev.filter(t => t.id !== id));
        if (activeId === id) { setActiveId(null); setMessages([]); }
      }
    } finally { setDeleting(false); }
  }

  function addEmoji(e: string) {
    setInput(prev => prev + e);
    setShowEmoji(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const active = threads.find(t => t.id === activeId);

  return (
    <div className="rounded-2xl border overflow-hidden flex" style={{ borderColor: C.border, backgroundColor: C.card, height: "70vh" }}>
      {/* Thread list */}
      <div className="w-72 border-r flex flex-col shrink-0" style={{ borderColor: C.border }}>
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
          <p className="text-sm font-bold" style={{ color: C.textPrimary }}>Chat</p>
          <button onClick={() => setComposing(true)} className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg"
            style={{ backgroundColor: `color-mix(in srgb, ${C.gold} 14%, transparent)`, color: C.gold }}>
            <Plus size={12} /> New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {threads.length === 0 ? (
            <p className="text-xs text-center py-8 px-4" style={{ color: C.textDim }}>No conversations yet. Hit “New” to start one.</p>
          ) : threads.map(t => (
            <button key={t.id} onClick={() => setActiveId(t.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b transition-colors hover:bg-black/[0.03]"
              style={{ borderColor: C.border, backgroundColor: activeId === t.id ? "color-mix(in srgb, var(--brand, #c9a83a) 8%, transparent)" : "transparent" }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `color-mix(in srgb, ${t.kind === "channel" ? "#7C3AED" : C.gold} 16%, transparent)`, color: t.kind === "channel" ? "#7C3AED" : C.gold }}>
                {t.kind === "channel" ? <Hash size={14} /> : <User size={14} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold truncate" style={{ color: C.textPrimary }}>{t.title}</p>
                  {t.lastMessage && <span className="text-[10px] shrink-0" style={{ color: C.textDim }}>{ago(t.lastMessage.created_at)}</span>}
                </div>
                <p className="text-[11px] truncate" style={{ color: C.textMuted }}>{t.lastMessage?.body ?? "No messages yet"}</p>
              </div>
              {t.unread > 0 && <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0" style={{ backgroundColor: C.red, color: "#fff" }}>{t.unread}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Message pane */}
      <div className="flex-1 flex flex-col min-w-0">
        {!active ? (
          <div className="flex-1 flex flex-col items-center justify-center" style={{ color: C.textDim }}>
            <MessageSquare size={28} className="mb-2" />
            <p className="text-sm">Pick a conversation</p>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: C.border }}>
              {active.kind === "channel" ? <Hash size={14} style={{ color: "#7C3AED" }} /> : <User size={14} style={{ color: C.gold }} />}
              <p className="text-sm font-bold" style={{ color: C.textPrimary }}>{active.title}</p>
              <span className="text-[11px]" style={{ color: C.textDim }}>· {active.members.length} {active.members.length === 1 ? "member" : "members"}</span>
              <button onClick={() => delThread(active.id)} disabled={deleting} title="Delete conversation"
                className="ml-auto p-1.5 rounded-lg transition-colors hover:bg-black/[0.04] disabled:opacity-50" style={{ color: C.textMuted }}>
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              </button>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.map(m => {
                const mine = m.sender_id === me;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[75%]">
                      {!mine && <p className="text-[10px] mb-0.5 ml-1" style={{ color: C.textDim }}>{m.sender_name}</p>}
                      <div className="px-3 py-2 rounded-2xl text-sm" style={{ backgroundColor: mine ? "var(--brand, #c9a83a)" : C.bg, color: mine ? "#04070d" : C.textBody, borderTopRightRadius: mine ? 4 : undefined, borderTopLeftRadius: mine ? undefined : 4 }}>
                        <span className="whitespace-pre-wrap break-words">{m.body}</span>
                      </div>
                      <p className="text-[9px] mt-0.5" style={{ color: C.textDim, textAlign: mine ? "right" : "left" }}>{ago(m.created_at)} ago</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="px-3 py-3 border-t flex items-center gap-2 relative" style={{ borderColor: C.border }}>
              {showEmoji && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowEmoji(false)} />
                  <div className="absolute bottom-full left-2 mb-2 z-20 w-64 max-h-44 overflow-y-auto rounded-xl border shadow-lg p-2 grid grid-cols-8 gap-0.5"
                    style={{ backgroundColor: C.card, borderColor: C.border }}>
                    {EMOJIS.map(e => (
                      <button key={e} onClick={() => addEmoji(e)} className="text-lg rounded-md hover:bg-black/[0.06] leading-none p-1" title={e}>{e}</button>
                    ))}
                  </div>
                </>
              )}
              <button onClick={() => setShowEmoji(v => !v)} title="Emoji"
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors hover:bg-black/[0.04]"
                style={{ color: showEmoji ? C.gold : C.textMuted }}>
                <Smile size={18} />
              </button>
              <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Write a message…" className="flex-1 text-sm px-3 py-2 rounded-lg border outline-none" style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }} />
              <button onClick={send} disabled={sending || !input.trim()} className="w-9 h-9 rounded-lg flex items-center justify-center disabled:opacity-40 shrink-0" style={{ backgroundColor: "var(--brand, #c9a83a)", color: "#04070d" }}>
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
          </>
        )}
      </div>

      {composing && <NewChatModal onClose={() => setComposing(false)} onCreated={(id) => { setComposing(false); loadThreads(); setActiveId(id); }} />}
    </div>
  );
}

function NewChatModal({ onClose, onCreated }: { onClose: () => void; onCreated: (threadId: string) => void }) {
  const [roster, setRoster] = useState<Member[]>([]);
  const [kind, setKind] = useState<"dm" | "channel">("dm");
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { fetch("/api/team/roster").then(r => r.ok ? r.json() : { roster: [] }).then(d => setRoster(d.roster ?? [])).catch(() => {}); }, []);

  function toggle(uid: string) {
    if (kind === "dm") { setSelected([uid]); return; }
    setSelected(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid]);
  }

  async function create() {
    if (selected.length === 0) { setErr("Pick at least one teammate"); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/chat/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, userIds: selected, title: kind === "channel" ? title : undefined }) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error ?? "Failed"); return; }
      onCreated(d.threadId);
    } catch { setErr("Network error"); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border max-h-[85vh] flex flex-col" style={{ backgroundColor: C.card, borderColor: C.border }} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
          <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>New conversation</h2>
          <button onClick={onClose}><X size={16} style={{ color: C.textMuted }} /></button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            {(["dm", "channel"] as const).map(k => (
              <button key={k} onClick={() => { setKind(k); setSelected([]); }}
                className="text-xs font-semibold px-3 py-2 rounded-lg border flex items-center justify-center gap-1.5"
                style={{ borderColor: kind === k ? C.gold : C.border, backgroundColor: kind === k ? `color-mix(in srgb, ${C.gold} 10%, transparent)` : C.bg, color: kind === k ? C.gold : C.textBody }}>
                {k === "dm" ? <User size={12} /> : <Hash size={12} />} {k === "dm" ? "Direct message" : "Channel"}
              </button>
            ))}
          </div>
          {kind === "channel" && (
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Channel name (e.g. ventas)" className="w-full text-sm px-3 py-2 rounded-lg border outline-none" style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }} />
          )}
          <div className="rounded-lg border max-h-52 overflow-y-auto" style={{ borderColor: C.border }}>
            {roster.map(m => (
              <button key={m.userId} onClick={() => toggle(m.userId)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm border-b last:border-b-0 text-left" style={{ borderColor: C.border, color: C.textBody, backgroundColor: selected.includes(m.userId) ? `color-mix(in srgb, ${C.gold} 10%, transparent)` : "transparent" }}>
                {m.name}{selected.includes(m.userId) && <span style={{ color: C.gold }}>✓</span>}
              </button>
            ))}
          </div>
          {err && <p className="text-xs" style={{ color: C.red }}>{err}</p>}
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2" style={{ borderColor: C.border }}>
          <button onClick={onClose} className="text-xs font-medium px-3 py-2 rounded-lg border" style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.bg }}>Cancel</button>
          <button onClick={create} disabled={busy || selected.length === 0} className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50" style={{ backgroundColor: C.gold, color: "#04070d" }}>
            {busy && <Loader2 size={12} className="animate-spin" />} Start
          </button>
        </div>
      </div>
    </div>
  );
}
