"use client";

import { useEffect, useRef, useState, useCallback, type ReactNode, type ClipboardEvent } from "react";
import Link from "next/link";
import { C } from "@/shared/design/tokens";
import { Send, Plus, Hash, User, X, Loader2, MessageSquare, Smile, Trash2, Paperclip, AlertCircle } from "lucide-react";
import { getSupabaseBrowser } from "@/integrations/supabase/browser";
import { useLocale } from "@/shared/i18n/i18n";
import {
  ALLOWED_IMAGE_EXT, ALLOWED_IMAGE_MIME, MAX_ATTACHMENTS_PER_MESSAGE,
  validateUpload, type ChatAttachment, type SignedChatAttachment, type RejectionCode,
} from "@/lib/chat-attachments";

type T = (key: string, vars?: Record<string, string | number>) => string;

// System @mention pings embed a "→ /leads/<uuid>?tab=notes" deep link as plain
// text. Render those (and any /leads/<id> path) as a clickable link so the
// reader can jump to the lead — works for old messages too, no DB backfill
// needed. The optional leading "→ " + spaces are folded into the link so we
// don't end up with a doubled arrow.
const LEAD_LINK_RE = /(?:→\s*)?\/leads\/[0-9a-fA-F-]{36}(?:\?[^\s]*)?/g;
// `t` is passed in, not pulled from useLocale() here: this runs inside a loop
// and a hook called conditionally corrupts React's hook order.
function renderBody(body: string, mine: boolean, t: T): ReactNode {
  LEAD_LINK_RE.lastIndex = 0;
  const out: ReactNode[] = [];
  let last = 0, key = 0, m: RegExpExecArray | null;
  while ((m = LEAD_LINK_RE.exec(body)) !== null) {
    if (m.index > last) out.push(body.slice(last, m.index));
    const href = m[0].replace(/^→\s*/, "");
    out.push(
      <Link key={key++} href={href} className="underline font-semibold whitespace-nowrap"
        style={{ color: mine ? "#04070d" : "var(--brand, #c9a83a)" }}>
        {t("chat.openLead")}
      </Link>,
    );
    last = m.index + m[0].length;
  }
  if (out.length === 0) return body;
  if (last < body.length) out.push(body.slice(last));
  return out;
}

// Lightweight emoji palette for the composer (no external dep).
const EMOJIS = ["😀","😅","😂","🤣","😊","😍","😘","😎","🤔","😉","🙌","👍","👎","👏","🙏","💪","🔥","✨","🎉","✅","❌","⚠️","💯","👀","🚀","💼","📈","📞","📧","💰","🤝","👋","😇","😮","😢","😡","❤️","💛","💚","💙","⭐","💡","⏰","📌","🎯","🥳"];

// Internal team chat: DMs + named channels. Thread list (left) + message pane
// (right). New messages arrive live via Supabase Realtime on chat_messages
// (RLS scopes delivery to the participant). All reads/writes go through the
// service-role /api/chat routes.

type Member = { userId: string; name: string; company?: string | null };
type Thread = { id: string; kind: "dm" | "channel"; title: string; members: Member[]; otherCompany?: string | null; lastMessage: { body: string; created_at: string } | null; unread: number };

// Small "· Company" tag shown next to a DM partner's name so cross-tenant
// conversations are obvious (boss 2026-06-11). Rendered in teal to read as
// metadata, not a person.
function CompanyTag({ company }: { company?: string | null }) {
  if (!company) return null;
  return (
    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap"
      style={{ backgroundColor: "color-mix(in srgb, #1A7F74 14%, transparent)", color: "#1A7F74" }}>
      {company}
    </span>
  );
}
type Msg = {
  id: string; sender_id: string; sender_name: string | null; body: string; created_at: string;
  // Signed by the server on read — the bucket is private and no URL is stored.
  // Absent on a message that arrives over Realtime (see the subscription).
  attachments?: SignedChatAttachment[];
};

// A screenshot sitting in the composer. It is uploaded as soon as it is picked
// or pasted, so `send` only ships paths; `preview` is a local object URL so the
// thumbnail shows instantly instead of waiting for the round trip.
type Pending = {
  key: string;
  name: string;
  preview: string;
  status: "uploading" | "ready" | "error";
  error?: string;
  uploaded?: ChatAttachment;
};

const ACCEPT = [...ALLOWED_IMAGE_EXT, ...ALLOWED_IMAGE_MIME].join(",");

function ago(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now"; if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function ChatPanel({ initialThreadId }: { initialThreadId?: string | null }) {
  const { t } = useLocale();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialThreadId ?? null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [composing, setComposing] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Screenshots staged in the composer + the last composer-level error (a
  // rejected file, or a send that failed). Per-file errors live on the item.
  const [pending, setPending] = useState<Pending[]>([]);
  const [composerErr, setComposerErr] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<SignedChatAttachment | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // The server rejects with a stable `code`; the reader gets copy in their own
  // locale rather than the English message the API carries for the logs.
  const errFor = useCallback((code?: RejectionCode | string): string => {
    switch (code) {
      case "too_large": return t("chat.attach.err.tooLarge");
      case "unsupported_type":
      case "empty": return t("chat.attach.err.type");
      case "too_many": return t("chat.attach.err.tooMany", { n: MAX_ATTACHMENTS_PER_MESSAGE });
      case "cross_tenant":
      case "bad_path": return t("chat.attach.err.rejected");
      default: return t("chat.attach.err.upload");
    }
  }, [t]);

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
        // Realtime hands over the raw row, so `attachments` is the stored jsonb
        // — paths, no signed URLs, nothing that renders. Refetch the thread in
        // that case so the images come back signed; a plain text message still
        // appends straight from the payload and stays instant.
        if (Array.isArray((payload.new as { attachments?: unknown }).attachments) &&
            (payload.new as { attachments: unknown[] }).attachments.length > 0) {
          loadMessages(activeId);
          return;
        }
        setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m]);
        fetch(`/api/chat/threads/${activeId}/read`, { method: "POST" }).catch(() => {});
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeId, loadMessages]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // Object URLs are per-file browser handles; without this an unmount with
  // screenshots staged leaks them for the life of the tab. Read through a ref
  // so the cleanup runs on unmount only — keyed on `pending` it would revoke
  // previews that are still on screen every time the list changes.
  const pendingRef = useRef<Pending[]>([]);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => () => { pendingRef.current.forEach(p => URL.revokeObjectURL(p.preview)); }, []);

  // Upload happens when the file is picked/pasted, not on send: the reader
  // sees the thumbnail immediately and a slow upload never blocks typing. If
  // the message is never sent the object is deleted again (see removePending).
  const uploadOne = useCallback(async (file: File) => {
    const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const preview = URL.createObjectURL(file);
    const name = file.name || "screenshot.png";
    setPending(p => [...p, { key, name, preview, status: "uploading" }]);
    const patch = (fields: Partial<Pending>) =>
      setPending(p => p.map(x => (x.key === key ? { ...x, ...fields } : x)));
    try {
      const fd = new FormData();
      fd.append("file", file, name);
      const r = await fetch("/api/chat/attachments/upload", { method: "POST", body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { patch({ status: "error", error: errFor(d.code) }); return; }
      patch({
        status: "ready",
        uploaded: { path: d.path, name: d.name, mimeType: d.mimeType, sizeBytes: d.sizeBytes },
      });
    } catch {
      patch({ status: "error", error: t("chat.attach.err.upload") });
    }
  }, [errFor, t]);

  // Shared by the paperclip and by paste. Size/type are checked here too —
  // same rules as the server, just without the round trip — so a 40 MB PSD
  // fails instantly instead of after the upload.
  const addFiles = useCallback((list: File[]) => {
    setComposerErr(null);
    if (list.length === 0) return;
    const room = MAX_ATTACHMENTS_PER_MESSAGE - pending.length;
    if (room <= 0) { setComposerErr(t("chat.attach.err.tooMany", { n: MAX_ATTACHMENTS_PER_MESSAGE })); return; }
    let rejected: string | null = null;
    const ok: File[] = [];
    for (const f of list) {
      const v = validateUpload({ size: f.size, type: f.type, name: f.name });
      if (!v.ok) { rejected = errFor(v.code); continue; }
      ok.push(f);
    }
    if (ok.length > room) { rejected = t("chat.attach.err.tooMany", { n: MAX_ATTACHMENTS_PER_MESSAGE }); }
    if (rejected) setComposerErr(rejected);
    ok.slice(0, room).forEach(f => { void uploadOne(f); });
  }, [pending.length, errFor, t, uploadOne]);

  // Cmd/Ctrl-V of a screenshot. The clipboard carries the image as a File with
  // no filename, which is why validateUpload falls back to the MIME.
  const onPaste = useCallback((e: ClipboardEvent<HTMLInputElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  }, [addFiles]);

  // Removing before sending deletes the object too — nothing references it yet,
  // so leaving it would just be litter in the bucket.
  const removePending = useCallback((key: string) => {
    setComposerErr(null);
    setPending(prev => {
      const item = prev.find(x => x.key === key);
      if (item) {
        URL.revokeObjectURL(item.preview);
        if (item.uploaded) {
          fetch(`/api/chat/attachments/upload?path=${encodeURIComponent(item.uploaded.path)}`, { method: "DELETE" }).catch(() => {});
        }
      }
      return prev.filter(x => x.key !== key);
    });
  }, []);

  const uploading = pending.some(p => p.status === "uploading");
  const readyAttachments = pending.filter(p => p.status === "ready" && p.uploaded).map(p => p.uploaded!);
  const canSend = Boolean(activeId) && !sending && !uploading && (Boolean(input.trim()) || readyAttachments.length > 0);

  async function send() {
    if (!activeId || !canSend) return;
    const body = input.trim();
    const attachments = readyAttachments;
    setInput("");
    setSending(true);
    setComposerErr(null);
    try {
      const r = await fetch(`/api/chat/threads/${activeId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body, attachments }) });
      if (r.ok) {
        const d = await r.json();
        setMessages(prev => prev.some(x => x.id === d.message.id) ? prev : [...prev, d.message]);
        pending.forEach(p => URL.revokeObjectURL(p.preview));
        setPending([]);
        loadThreads();
      } else {
        // Put the text back and keep the screenshots staged: the send failed,
        // the user should not have to retype or re-attach anything.
        const d = await r.json().catch(() => ({}));
        setInput(body);
        setComposerErr(d.code ? errFor(d.code) : t("chat.attach.err.send"));
      }
    } catch {
      setInput(body);
      setComposerErr(t("chat.attach.err.send"));
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
          <p className="text-sm font-bold" style={{ color: C.textPrimary }}>{t("chat.title")}</p>
          <button onClick={() => setComposing(true)} className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg"
            style={{ backgroundColor: `color-mix(in srgb, ${C.gold} 14%, transparent)`, color: C.gold }}>
            <Plus size={12} /> {t("chat.new")}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {threads.length === 0 ? (
            <p className="text-xs text-center py-8 px-4" style={{ color: C.textDim }}>{t("chat.noConversations")}</p>
          ) : threads.map(th => (
            <button key={th.id} onClick={() => setActiveId(th.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b transition-colors hover:bg-black/[0.03]"
              style={{ borderColor: C.border, backgroundColor: activeId === th.id ? "color-mix(in srgb, var(--brand, #c9a83a) 8%, transparent)" : "transparent" }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `color-mix(in srgb, ${th.kind === "channel" ? "#7C3AED" : C.gold} 16%, transparent)`, color: th.kind === "channel" ? "#7C3AED" : C.gold }}>
                {th.kind === "channel" ? <Hash size={14} /> : <User size={14} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: C.textPrimary }}>{th.title}</p>
                    <CompanyTag company={th.otherCompany} />
                  </div>
                  {th.lastMessage && <span className="text-[10px] shrink-0" style={{ color: C.textDim }}>{ago(th.lastMessage.created_at)}</span>}
                </div>
                <p className="text-[11px] truncate" style={{ color: C.textMuted }}>{th.lastMessage?.body ?? t("chat.noMessages")}</p>
              </div>
              {th.unread > 0 && <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0" style={{ backgroundColor: C.red, color: "#fff" }}>{th.unread}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Message pane */}
      <div className="flex-1 flex flex-col min-w-0">
        {!active ? (
          <div className="flex-1 flex flex-col items-center justify-center" style={{ color: C.textDim }}>
            <MessageSquare size={28} className="mb-2" />
            <p className="text-sm">{t("chat.pickConversation")}</p>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: C.border }}>
              {active.kind === "channel" ? <Hash size={14} style={{ color: "#7C3AED" }} /> : <User size={14} style={{ color: C.gold }} />}
              <p className="text-sm font-bold" style={{ color: C.textPrimary }}>{active.title}</p>
              <CompanyTag company={active.otherCompany} />
              <span className="text-[11px]" style={{ color: C.textDim }}>· {active.members.length} {active.members.length === 1 ? "member" : "members"}</span>
              <button onClick={() => delThread(active.id)} disabled={deleting} title={t("chat.deleteConversation")}
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
                        {/* A screenshot on its own is a valid message, so the
                            text line is dropped rather than rendered empty. */}
                        {m.body.trim() && <span className="whitespace-pre-wrap break-words">{renderBody(m.body, mine, t)}</span>}
                        {(m.attachments ?? []).length > 0 && (
                          <div className={`flex flex-wrap gap-1.5 ${m.body.trim() ? "mt-2" : ""}`}>
                            {(m.attachments ?? []).map(a => (
                              a.url ? (
                                // The URL is signed and short-lived; it is never
                                // stored, only minted for this render.
                                <button key={a.path} type="button" onClick={() => setLightbox(a)} title={t("chat.attach.open")}
                                  className="block rounded-lg overflow-hidden border" style={{ borderColor: "rgba(0,0,0,0.12)" }}>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={a.url} alt={a.name} className="block max-h-44 max-w-[240px] object-cover" />
                                </button>
                              ) : (
                                // Signing failed or the object is gone. Say so
                                // instead of showing a broken image.
                                <span key={a.path} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg"
                                  style={{ backgroundColor: "rgba(0,0,0,0.06)" }}>
                                  <AlertCircle size={11} /> {t("chat.attach.err.unavailable")}
                                </span>
                              )
                            ))}
                          </div>
                        )}
                      </div>
                      <p className="text-[9px] mt-0.5" style={{ color: C.textDim, textAlign: mine ? "right" : "left" }}>{t("chat.ago", { ago: ago(m.created_at) })}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            {(pending.length > 0 || composerErr) && (
              <div className="px-3 pt-3 border-t" style={{ borderColor: C.border }}>
                {pending.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {pending.map(p => (
                      <div key={p.key} className="relative w-16 h-16 rounded-lg overflow-hidden border" style={{ borderColor: p.status === "error" ? C.red : C.border }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.preview} alt={p.name} className="w-full h-full object-cover" style={{ opacity: p.status === "ready" ? 1 : 0.45 }} />
                        {p.status === "uploading" && (
                          <span className="absolute inset-0 flex items-center justify-center" title={t("chat.attach.uploading")}>
                            <Loader2 size={16} className="animate-spin" style={{ color: C.gold }} />
                          </span>
                        )}
                        {p.status === "error" && (
                          <span className="absolute inset-0 flex items-center justify-center" title={p.error}>
                            <AlertCircle size={16} style={{ color: C.red }} />
                          </span>
                        )}
                        <button type="button" onClick={() => removePending(p.key)} aria-label={t("chat.attach.remove")} title={t("chat.attach.remove")}
                          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: "rgba(0,0,0,0.6)", color: "#fff" }}>
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {composerErr && <p className="text-[11px] mt-2" style={{ color: C.red }}>{composerErr}</p>}
              </div>
            )}
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
              <button onClick={() => setShowEmoji(v => !v)} title={t("chat.emoji")}
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors hover:bg-black/[0.04]"
                style={{ color: showEmoji ? C.gold : C.textMuted }}>
                <Smile size={18} />
              </button>
              <input ref={fileRef} type="file" accept={ACCEPT} multiple className="hidden"
                onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
              <button type="button" onClick={() => fileRef.current?.click()} title={t("chat.attach")} aria-label={t("chat.attach")}
                disabled={pending.length >= MAX_ATTACHMENTS_PER_MESSAGE}
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors hover:bg-black/[0.04] disabled:opacity-40"
                style={{ color: C.textMuted }}>
                <Paperclip size={17} />
              </button>
              <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onPaste={onPaste}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={t("chat.writePh")} className="flex-1 text-sm px-3 py-2 rounded-lg border outline-none" style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }} />
              <button onClick={send} disabled={!canSend} className="w-9 h-9 rounded-lg flex items-center justify-center disabled:opacity-40 shrink-0" style={{ backgroundColor: "var(--brand, #c9a83a)", color: "#04070d" }}>
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
          </>
        )}
      </div>

      {composing && <NewChatModal onClose={() => setComposing(false)} onCreated={(id) => { setComposing(false); loadThreads(); setActiveId(id); }} />}

      {/* Full-size view. Not shared/ui/Modal: that is a padded card sized for
          forms, and a screenshot wants the whole viewport. */}
      {lightbox?.url && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6" role="dialog" aria-modal="true"
          style={{ backgroundColor: "rgba(0,0,0,0.85)" }} onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox.url} alt={lightbox.name} className="max-w-full max-h-full object-contain rounded-lg" onClick={e => e.stopPropagation()} />
          <button type="button" onClick={() => setLightbox(null)} aria-label={t("chat.attach.close")} title={t("chat.attach.close")}
            className="absolute top-4 right-4 p-2 rounded-lg" style={{ color: "#fff", backgroundColor: "rgba(255,255,255,0.14)" }}>
            <X size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

function NewChatModal({ onClose, onCreated }: { onClose: () => void; onCreated: (threadId: string) => void }) {
  const { t } = useLocale();
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
    if (selected.length === 0) { setErr(t("chat.pickTeammate")); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/chat/threads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, userIds: selected, title: kind === "channel" ? title : undefined }) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error ?? t("chat.err.failed")); return; }
      onCreated(d.threadId);
    } catch { setErr(t("chat.err.network")); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border max-h-[85vh] flex flex-col" style={{ backgroundColor: C.card, borderColor: C.border }} onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
          <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>{t("chat.newConversation")}</h2>
          <button onClick={onClose}><X size={16} style={{ color: C.textMuted }} /></button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2">
            {(["dm", "channel"] as const).map(k => (
              <button key={k} onClick={() => { setKind(k); setSelected([]); }}
                className="text-xs font-semibold px-3 py-2 rounded-lg border flex items-center justify-center gap-1.5"
                style={{ borderColor: kind === k ? C.gold : C.border, backgroundColor: kind === k ? `color-mix(in srgb, ${C.gold} 10%, transparent)` : C.bg, color: kind === k ? C.gold : C.textBody }}>
                {k === "dm" ? <User size={12} /> : <Hash size={12} />} {k === "dm" ? t("chat.directMessage") : t("opp.col.channel")}
              </button>
            ))}
          </div>
          {kind === "channel" && (
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t("chat.channelPh")} className="w-full text-sm px-3 py-2 rounded-lg border outline-none" style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }} />
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
          <button onClick={onClose} className="text-xs font-medium px-3 py-2 rounded-lg border" style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.bg }}>{t("chat.cancel")}</button>
          <button onClick={create} disabled={busy || selected.length === 0} className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50" style={{ backgroundColor: C.gold, color: "#04070d" }}>
            {busy && <Loader2 size={12} className="animate-spin" />} {t("chat.start")}
          </button>
        </div>
      </div>
    </div>
  );
}
