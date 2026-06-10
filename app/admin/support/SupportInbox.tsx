"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, LifeBuoy, Loader2, RefreshCw, CheckCircle2, Clock, CircleDot, Ban, User } from "lucide-react";
import { C } from "@/lib/design";

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

const STATUS_TABS = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

// Action buttons shown on a card (verb the admin clicks).
const ACTIONS: { value: Status; label: string }[] = [
  { value: "in_progress", label: "Mark in progress" },
  { value: "resolved", label: "Mark resolved" },
  { value: "rejected", label: "Reject" },
  { value: "open", label: "Reopen" },
];

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string; Icon: typeof CircleDot }> = {
  open: { bg: "#FEF3C7", fg: "#B45309", label: "Open", Icon: CircleDot },
  in_progress: { bg: "#DBEAFE", fg: "#1D4ED8", label: "In progress", Icon: Clock },
  resolved: { bg: "#D1FAE5", fg: "#047857", label: "Resolved", Icon: CheckCircle2 },
  rejected: { bg: "#FEE2E2", fg: "#B91C1C", label: "Rejected", Icon: Ban },
};

const CAT_LABEL: Record<string, string> = {
  general: "General", bug: "Bug", feature: "Feature", question: "Question", billing: "Billing",
};

function fmt(ts: string) {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

export default function SupportInbox() {
  const [tab, setTab] = useState("open");
  const [items, setItems] = useState<HelpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/help-requests?status=${tab}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setItems(Array.isArray(j?.requests) ? j.requests : []);
    } finally {
      setLoading(false);
    }
  }, [tab]);

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

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <Link href="/admin" className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4" style={{ color: C.textMuted }}>
        <ArrowLeft size={14} /> Back to Admin
      </Link>

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `color-mix(in srgb, ${C.aiAccent} 14%, transparent)`, color: C.aiAccent }}>
            <LifeBuoy size={18} />
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
              Support requests
            </h1>
            <p className="text-[11px]" style={{ color: C.textMuted }}>Requests sellers and companies sent from the Help menu.</p>
          </div>
        </div>
        <button onClick={load} className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg border px-3 py-2"
          style={{ borderColor: C.border, color: C.textMuted }}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1.5 mb-4">
        {STATUS_TABS.map(t => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className="text-xs font-semibold rounded-lg px-3 py-1.5 border transition-colors"
            style={tab === t.value
              ? { backgroundColor: `color-mix(in srgb, ${C.aiAccent} 12%, transparent)`, borderColor: C.aiAccent, color: C.aiAccent }
              : { borderColor: C.border, color: C.textMuted }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16" style={{ color: C.textDim }}>
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border text-center py-16" style={{ borderColor: C.border }}>
          <LifeBuoy size={28} style={{ color: C.textDim }} className="mx-auto mb-2" />
          <p className="text-sm font-semibold" style={{ color: C.textMuted }}>No requests here</p>
          <p className="text-[11px] mt-1" style={{ color: C.textDim }}>Nothing in this bucket yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(it => {
            const st = STATUS_STYLE[it.status] ?? STATUS_STYLE.open;
            const expanded = openId === it.id;
            return (
              <div key={it.id} className="rounded-xl border overflow-hidden" style={{ borderColor: C.border, backgroundColor: C.card }}>
                <button
                  onClick={() => {
                    setOpenId(expanded ? null : it.id);
                    if (!expanded) setNotesDraft(d => ({ ...d, [it.id]: it.admin_notes ?? "" }));
                  }}
                  className="w-full text-left px-4 py-3 flex items-start justify-between gap-3 hover:bg-black/[0.02]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5"
                        style={{ backgroundColor: C.bg, color: C.textMuted }}>{CAT_LABEL[it.category] ?? it.category}</span>
                      <span className="text-sm font-semibold" style={{ color: C.textPrimary }}>{it.subject}</span>
                    </div>
                    <p className="text-[11px] mt-1 flex items-center gap-1.5 flex-wrap" style={{ color: C.textMuted }}>
                      <User size={11} />
                      <span className="font-semibold" style={{ color: C.textBody }}>
                        {it.author_name ?? it.author_email ?? "Unknown"}
                      </span>
                      {it.author_tier ? `· ${it.author_tier}` : ""}
                      {it.company_name ? `· ${it.company_name}` : ""}
                      <span style={{ color: C.textDim }}>· {fmt(it.created_at)}</span>
                    </p>
                  </div>
                  <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-1"
                    style={{ backgroundColor: st.bg, color: st.fg }}>
                    <st.Icon size={11} /> {st.label}
                  </span>
                </button>

                {expanded && (
                  <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: C.border }}>
                    <p className="text-xs whitespace-pre-wrap mt-3" style={{ color: C.textPrimary }}>{it.body}</p>
                    {it.author_email && (
                      <p className="text-[11px] mt-3" style={{ color: C.textMuted }}>
                        Reply to: <a href={`mailto:${it.author_email}`} className="font-semibold" style={{ color: C.aiAccent }}>{it.author_email}</a>
                      </p>
                    )}

                    {/* Reason / reply the requester will see in "Your requests" */}
                    <div className="mt-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-1.5" style={{ color: C.textDim }}>
                        Note to requester <span style={{ fontWeight: 400 }}>(optional — shown to them; use it for a rejection reason)</span>
                      </p>
                      <textarea
                        value={notesDraft[it.id] ?? ""}
                        onChange={e => setNotesDraft(d => ({ ...d, [it.id]: e.target.value }))}
                        rows={2}
                        maxLength={4000}
                        placeholder="e.g. Why you're rejecting, or how it was resolved…"
                        className="w-full text-xs rounded-lg border px-3 py-2 outline-none resize-none"
                        style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
                      />
                      <div className="flex justify-end mt-1.5">
                        <button
                          onClick={() => patch(it.id, { admin_notes: notesDraft[it.id] ?? "" })}
                          disabled={busyId === it.id || (notesDraft[it.id] ?? "") === (it.admin_notes ?? "")}
                          className="text-[11px] font-semibold px-2.5 py-1 disabled:opacity-40"
                          style={{ color: C.aiAccent }}
                        >
                          Save note
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {ACTIONS.map(a => {
                        const isCurrent = it.status === a.value;
                        const reject = a.value === "rejected";
                        return (
                          <button
                            key={a.value}
                            onClick={() => patch(it.id, { status: a.value, admin_notes: notesDraft[it.id] ?? it.admin_notes ?? "" })}
                            disabled={busyId === it.id || isCurrent}
                            className="text-[11px] font-semibold rounded-lg px-2.5 py-1.5 border disabled:opacity-40"
                            style={isCurrent
                              ? { borderColor: C.aiAccent, color: C.aiAccent }
                              : reject
                                ? { borderColor: "#FCA5A5", color: "#B91C1C" }
                                : { borderColor: C.border, color: C.textMuted }}
                          >
                            {busyId === it.id ? "…" : a.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
