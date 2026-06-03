"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { C } from "@/lib/design";
import { StickyNote, Phone, Trash2, Loader2, Star, AtSign, Send } from "lucide-react";

// The lead's collaboration hub — a proper notes log (replaces the weak
// "Team Notes" textarea). Notes read top-to-bottom (oldest → newest), composer
// fixed at the bottom like a chat. Notes can be General or Call notes, @mention
// teammates (who get notified), and be added to the Profile Overview (pin).

type Note = {
  id: string;
  content: string;
  author_name: string | null;
  created_at: string;
  created_by: string | null;
  mentioned_user_ids: string[] | null;
  note_type: "general" | "call";
  pinned: boolean;
};
type Member = { userId: string; name: string };

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "now"; if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function highlight(text: string, names: string[]): (string | ReactElement)[] | string {
  if (!names.length) return text;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`@(?:${names.map(esc).join("|")})`, "g");
  const out: (string | ReactElement)[] = [];
  let last = 0, i = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<span key={i++} style={{ color: "var(--brand, #c9a83a)", fontWeight: 600 }}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function LeadNotes({ leadId }: { leadId: string }) {
  // notes kept oldest → newest for top-to-bottom reading.
  const [notes, setNotes] = useState<Note[]>([]);
  const [roster, setRoster] = useState<Member[]>([]);
  const [text, setText] = useState("");
  const [type, setType] = useState<"general" | "call">("general");
  const [mentioned, setMentioned] = useState<Member[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch(`/api/leads/${leadId}/notes`).then(r => r.json()).then(d => setNotes([...(d.notes ?? [])].reverse())).catch(() => {});
    fetch(`/api/team/roster`).then(r => r.ok ? r.json() : { roster: [] }).then(d => setRoster(d.roster ?? [])).catch(() => {});
  }, [leadId]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [notes]);

  const rosterMap = new Map(roster.map(m => [m.userId, m.name]));
  const matches = mentionQuery !== null ? roster.filter(m => m.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6) : [];

  function onChange(v: string) {
    setText(v);
    const caret = ref.current?.selectionStart ?? v.length;
    const m = v.slice(0, caret).match(/(?:^|\s)@(\w*)$/);
    setMentionQuery(m ? m[1] : null);
  }
  function pick(member: Member) {
    const el = ref.current, caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@(\w*)$/, `@${member.name} `);
    setText(before + text.slice(caret));
    setMentionQuery(null);
    setMentioned(prev => prev.some(p => p.userId === member.userId) ? prev : [...prev, member]);
    setTimeout(() => el?.focus(), 0);
  }

  async function post() {
    if (!text.trim()) return;
    setSaving(true); setErr(null);
    const ids = mentioned.filter(m => text.includes(`@${m.name}`)).map(m => m.userId);
    try {
      const res = await fetch(`/api/leads/${leadId}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: text.trim(), mentioned_user_ids: ids, note_type: type }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error ?? "Couldn't save the note"); return; }
      setNotes(prev => [...prev, d.note]); setText(""); setMentioned([]); setMentionQuery(null); setType("general");
    } catch { setErr("Network error"); }
    finally { setSaving(false); }
  }

  async function togglePin(n: Note) {
    setBusyId(n.id);
    setNotes(prev => prev.map(x => x.id === n.id ? { ...x, pinned: !x.pinned } : x));
    try { await fetch(`/api/leads/${leadId}/notes`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ noteId: n.id, pinned: !n.pinned }) }); }
    finally { setBusyId(null); }
  }
  async function del(n: Note) {
    if (!confirm("Delete this note?")) return;
    setBusyId(n.id);
    try { const r = await fetch(`/api/leads/${leadId}/notes?noteId=${n.id}`, { method: "DELETE" }); if (r.ok) setNotes(prev => prev.filter(x => x.id !== n.id)); }
    finally { setBusyId(null); }
  }

  return (
    <div className="rounded-2xl border flex flex-col" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)", maxHeight: "70vh" }}>
      <div className="flex items-center gap-2 px-5 py-4 border-b shrink-0" style={{ borderColor: C.border }}>
        <StickyNote size={16} style={{ color: "var(--brand, #c9a83a)" }} />
        <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>Notes</h3>
        <span className="text-xs" style={{ color: C.textDim }}>· {notes.length}</span>
      </div>

      {/* List (top, scrolls) */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4" style={{ minHeight: 160 }}>
        {notes.length === 0 ? (
          <p className="text-xs text-center py-8" style={{ color: C.textDim }}>No notes yet — write the first one below.</p>
        ) : notes.map(n => {
          const names = (n.mentioned_user_ids ?? []).map(uid => rosterMap.get(uid)).filter((x): x is string => !!x);
          return (
            <div key={n.id} className="group">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ backgroundColor: n.note_type === "call" ? C.phone : "var(--brand, #c9a83a)" }}>
                    {n.note_type === "call" ? <Phone size={12} /> : (n.author_name ?? "?")[0]?.toUpperCase()}
                  </div>
                  <span className="text-sm font-semibold truncate" style={{ color: C.textPrimary }}>{n.author_name ?? "Team"}</span>
                  {n.note_type === "call" && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ backgroundColor: `color-mix(in srgb, ${C.phone} 14%, transparent)`, color: C.phone }}>Call</span>}
                  <span className="text-xs tabular-nums" style={{ color: C.textDim }}>{timeAgo(n.created_at)}</span>
                </div>
                <button onClick={() => del(n)} disabled={busyId === n.id} title="Delete note" className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-black/[0.04] shrink-0">
                  {busyId === n.id ? <Loader2 size={11} className="animate-spin" style={{ color: C.textDim }} /> : <Trash2 size={11} style={{ color: C.textDim }} />}
                </button>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap ml-9" style={{ color: C.textBody }}>{highlight(n.content, names)}</p>
              <div className="ml-9 mt-1.5">
                <button onClick={() => togglePin(n)} disabled={busyId === n.id}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors"
                  style={{ borderColor: n.pinned ? C.gold : C.border, backgroundColor: n.pinned ? `color-mix(in srgb, ${C.gold} 12%, transparent)` : "transparent", color: n.pinned ? C.gold : C.textDim }}>
                  <Star size={10} style={{ fill: n.pinned ? C.gold : "none" }} /> {n.pinned ? "In Profile Overview" : "Add to Profile Overview"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer (bottom) */}
      <div className="border-t px-5 py-3 shrink-0" style={{ borderColor: C.border }}>
        <div className="flex items-center gap-1.5 mb-2">
          {(["general", "call"] as const).map(t => (
            <button key={t} onClick={() => setType(t)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg border"
              style={{ borderColor: type === t ? C.gold : C.border, backgroundColor: type === t ? `color-mix(in srgb, ${C.gold} 10%, transparent)` : C.bg, color: type === t ? C.gold : C.textBody }}>
              {t === "call" ? <Phone size={11} /> : <StickyNote size={11} />} {t === "call" ? "Call note" : "Note"}
            </button>
          ))}
        </div>
        <div className="relative">
          <textarea ref={ref} value={text} onChange={e => onChange(e.target.value)} rows={2}
            placeholder="Write a note… type @ to mention a teammate"
            className="w-full text-sm px-3 py-2 rounded-lg border resize-none outline-none" style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textBody }} />
          {mentionQuery !== null && matches.length > 0 && (
            <div className="absolute z-30 left-2 right-2 bottom-full mb-1 rounded-lg border shadow-lg max-h-48 overflow-y-auto" style={{ backgroundColor: C.card, borderColor: C.border }}>
              {matches.map(m => (
                <button key={m.userId} onMouseDown={e => { e.preventDefault(); pick(m); }} className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-black/[0.04]" style={{ color: C.textBody }}>
                  <AtSign size={12} style={{ color: "var(--brand, #c9a83a)" }} /> {m.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 mt-2">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {mentioned.filter(m => text.includes(`@${m.name}`)).map(m => (
              <span key={m.userId} className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${C.gold} 14%, transparent)`, color: C.gold }}>@{m.name}</span>
            ))}
            {err && <span className="text-[11px]" style={{ color: C.red }}>{err}</span>}
          </div>
          <button onClick={post} disabled={saving || !text.trim()} className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-40 shrink-0" style={{ backgroundColor: "var(--brand, #c9a83a)" }}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Add note
          </button>
        </div>
      </div>
    </div>
  );
}
