"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, ClipboardList, Loader2, RefreshCw, CheckCircle2, Clock, CircleDot, Ban, User, X, Search } from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

type Status = "open" | "in_progress" | "resolved" | "rejected";

type HelpRequest = {
  id: string;
  company_name: string | null;
  author_name: string | null;
  author_email: string | null;
  author_tier: string | null;
  category: string;
  subject: string;
  body: string;
  status: Status;
  admin_notes: string | null;
  created_at: string;
  resolved_at: string | null;
};

// Pipeline columns (the kanban). Rejected is a terminal side-bucket kept last.
const COLUMNS: { key: Status; label: string; accent: string; Icon: typeof CircleDot }[] = [
  { key: "open",        label: "Open",        accent: "#D97706", Icon: CircleDot },
  { key: "in_progress", label: "In progress", accent: "#2563EB", Icon: Clock },
  { key: "resolved",    label: "Resolved",    accent: "#16A34A", Icon: CheckCircle2 },
  { key: "rejected",    label: "Rejected",    accent: "#DC2626", Icon: Ban },
];

// The move a card can make FROM its current column → verbs the admin clicks.
const ACTIONS: { value: Status; label: string }[] = [
  { value: "in_progress", label: "Mark in progress" },
  { value: "resolved", label: "Mark resolved" },
  { value: "rejected", label: "Reject" },
  { value: "open", label: "Reopen" },
];

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string; Icon: typeof CircleDot }> = {
  open: { bg: "color-mix(in srgb, #D97706 16%, transparent)", fg: "#B45309", label: "Open", Icon: CircleDot },
  in_progress: { bg: "color-mix(in srgb, #2563EB 16%, transparent)", fg: "#1D4ED8", label: "In progress", Icon: Clock },
  resolved: { bg: "color-mix(in srgb, #16A34A 16%, transparent)", fg: "#047857", label: "Resolved", Icon: CheckCircle2 },
  rejected: { bg: "color-mix(in srgb, #DC2626 14%, transparent)", fg: "#B91C1C", label: "Rejected", Icon: Ban },
};

const CAT_LABEL: Record<string, string> = {
  general: "General", bug: "Bug", feature: "Feature", question: "Question", billing: "Billing",
};
const CAT_STYLE: Record<string, { bg: string; fg: string }> = {
  general:  { bg: "color-mix(in srgb, #64748B 15%, transparent)", fg: "#475569" },
  bug:      { bg: "color-mix(in srgb, #DC2626 14%, transparent)", fg: "#B91C1C" },
  feature:  { bg: "color-mix(in srgb, var(--brand, #c9a83a) 16%, transparent)", fg: "var(--fg1)" },
  question: { bg: "color-mix(in srgb, #0EA5E9 15%, transparent)", fg: "#0369A1" },
  billing:  { bg: "color-mix(in srgb, #7C3AED 15%, transparent)", fg: "#6D28D9" },
};

function fmt(ts: string) {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}
function fmtShort(ts: string) {
  try { return new Date(ts).toLocaleDateString(undefined, { day: "2-digit", month: "short" }); } catch { return ts; }
}

export default function SupportInbox() {
  const [items, setItems] = useState<HelpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/help-requests?status=all`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setItems(Array.isArray(j?.requests) ? j.requests : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Sends the status change together with whatever note the admin typed, so the
  // reason/reply is saved in the same action (the requester sees admin_notes).
  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id);
    try {
      await fetch("/api/help-requests", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => !q ? items : items.filter(it =>
    `${it.subject} ${it.company_name ?? ""} ${it.author_name ?? ""} ${it.author_email ?? ""}`.toLowerCase().includes(q)
  ), [items, q]);
  const byStatus = useMemo(() => {
    const m: Record<string, HelpRequest[]> = { open: [], in_progress: [], resolved: [], rejected: [] };
    for (const it of filtered) (m[it.status] ?? (m[it.status] = [])).push(it);
    return m;
  }, [filtered]);
  const selected = selectedId ? items.find(it => it.id === selectedId) ?? null : null;

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8">
      <Link href="/admin" className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4" style={{ color: C.textMuted }}>
        <ArrowLeft size={14} /> Back to Admin
      </Link>

      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `color-mix(in srgb, ${gold} 14%, transparent)`, color: "var(--fg1)" }}>
            <ClipboardList size={18} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
              Requests
            </h1>
            <p className="text-[11px]" style={{ color: C.textMuted }}>Every change / bug / question sent from the Help menu — move it across the pipeline.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5" style={{ borderColor: C.border, backgroundColor: C.card }}>
            <Search size={13} style={{ color: C.textDim }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search request / client…"
              className="bg-transparent text-sm outline-none w-44" style={{ color: C.textPrimary }} />
            {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
          </div>
          <button onClick={load} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg border px-3 py-2"
            style={{ borderColor: C.border, color: C.textMuted }}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16" style={{ color: C.textDim }}>
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-3" style={{ minWidth: "max-content" }}>
            {COLUMNS.map(col => {
              const list = byStatus[col.key] ?? [];
              return (
                <div key={col.key} className="rounded-xl border overflow-hidden shrink-0 flex flex-col"
                  style={{ width: 288, backgroundColor: C.bg, borderColor: C.border, maxHeight: "72vh" }}>
                  <div className="px-3 py-2.5 border-b flex items-center gap-2 sticky top-0"
                    style={{ borderColor: C.border, backgroundColor: C.card }}>
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col.accent }} />
                    <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: C.textBody }}>{col.label}</span>
                    <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: C.surface, color: C.textMuted }}>
                      {list.length}
                    </span>
                  </div>
                  <div className="p-2 space-y-2 overflow-y-auto">
                    {list.map(it => {
                      const cat = CAT_STYLE[it.category] ?? CAT_STYLE.general;
                      return (
                        <button key={it.id} onClick={() => { setSelectedId(it.id); setNotesDraft(d => ({ ...d, [it.id]: it.admin_notes ?? "" })); }}
                          className="w-full text-left rounded-lg border p-3 transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:shadow-sm"
                          style={{ borderColor: C.border, backgroundColor: C.card }}>
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span className="text-[9px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5"
                              style={{ backgroundColor: cat.bg, color: cat.fg }}>{CAT_LABEL[it.category] ?? it.category}</span>
                            <span className="ml-auto text-[10px]" style={{ color: C.textDim }}>{fmtShort(it.created_at)}</span>
                          </div>
                          <p className="text-[13px] font-semibold leading-snug" style={{ color: C.textPrimary }}>{it.subject}</p>
                          <p className="text-[11px] mt-1.5 flex items-center gap-1 truncate" style={{ color: C.textMuted }}>
                            <User size={10} className="shrink-0" />
                            <span className="font-semibold truncate" style={{ color: C.textBody }}>{it.company_name ?? it.author_name ?? it.author_email ?? "Unknown"}</span>
                          </p>
                        </button>
                      );
                    })}
                    {list.length === 0 && (
                      <p className="text-[11px] italic text-center py-8" style={{ color: C.textDim }}>Nothing here</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Detail / manage modal ── */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.5)" }} onClick={() => setSelectedId(null)}>
          <div className="rounded-2xl border w-full max-w-lg max-h-[88vh] overflow-y-auto"
            style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 24px 70px -20px rgba(0,0,0,0.5)" }}
            onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b flex items-start justify-between gap-3 sticky top-0" style={{ borderColor: C.border, backgroundColor: C.card }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="text-[9px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5"
                    style={{ backgroundColor: (CAT_STYLE[selected.category] ?? CAT_STYLE.general).bg, color: (CAT_STYLE[selected.category] ?? CAT_STYLE.general).fg }}>
                    {CAT_LABEL[selected.category] ?? selected.category}
                  </span>
                  {(() => { const st = STATUS_STYLE[selected.status] ?? STATUS_STYLE.open; return (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5" style={{ backgroundColor: st.bg, color: st.fg }}>
                      <st.Icon size={11} /> {st.label}
                    </span>
                  ); })()}
                </div>
                <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>{selected.subject}</h2>
                <p className="text-[11px] mt-1 flex items-center gap-1.5 flex-wrap" style={{ color: C.textMuted }}>
                  <User size={11} />
                  <span className="font-semibold" style={{ color: C.textBody }}>{selected.author_name ?? selected.author_email ?? "Unknown"}</span>
                  {selected.author_tier ? `· ${selected.author_tier}` : ""}
                  {selected.company_name ? `· ${selected.company_name}` : ""}
                  <span style={{ color: C.textDim }}>· {fmt(selected.created_at)}</span>
                </p>
              </div>
              <button onClick={() => setSelectedId(null)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/[0.04] shrink-0">
                <X size={16} style={{ color: C.textMuted }} />
              </button>
            </div>

            <div className="px-5 py-4">
              <p className="text-xs whitespace-pre-wrap" style={{ color: C.textPrimary }}>{selected.body}</p>
              {selected.author_email && (
                <p className="text-[11px] mt-3" style={{ color: C.textMuted }}>
                  Reply to: <a href={`mailto:${selected.author_email}`} className="font-semibold" style={{ color: "var(--fg1)" }}>{selected.author_email}</a>
                </p>
              )}

              <div className="mt-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-1.5" style={{ color: C.textDim }}>
                  Note to requester <span style={{ fontWeight: 400 }}>(optional — shown to them; use it for a rejection reason)</span>
                </p>
                <textarea
                  value={notesDraft[selected.id] ?? ""}
                  onChange={e => setNotesDraft(d => ({ ...d, [selected.id]: e.target.value }))}
                  rows={2}
                  maxLength={4000}
                  placeholder="e.g. Why you're rejecting, or how it was resolved…"
                  className="w-full text-xs rounded-lg border px-3 py-2 outline-none resize-none"
                  style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
                />
                <div className="flex justify-end mt-1.5">
                  <button
                    onClick={() => patch(selected.id, { admin_notes: notesDraft[selected.id] ?? "" })}
                    disabled={busyId === selected.id || (notesDraft[selected.id] ?? "") === (selected.admin_notes ?? "")}
                    className="text-[11px] font-semibold px-2.5 py-1 disabled:opacity-40"
                    style={{ color: "var(--fg1)" }}
                  >
                    Save note
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {ACTIONS.map(a => {
                  const isCurrent = selected.status === a.value;
                  const reject = a.value === "rejected";
                  return (
                    <button
                      key={a.value}
                      onClick={() => patch(selected.id, { status: a.value, admin_notes: notesDraft[selected.id] ?? selected.admin_notes ?? "" })}
                      disabled={busyId === selected.id || isCurrent}
                      className="text-[11px] font-semibold rounded-lg px-2.5 py-1.5 border disabled:opacity-40"
                      style={isCurrent
                        ? { borderColor: gold, color: "var(--fg1)" }
                        : reject
                          ? { borderColor: "color-mix(in srgb, #DC2626 34%, transparent)", color: "#B91C1C" }
                          : { borderColor: C.border, color: C.textMuted }}
                    >
                      {busyId === selected.id ? "…" : a.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
