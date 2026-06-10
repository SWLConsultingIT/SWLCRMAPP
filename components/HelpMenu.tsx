"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  HelpCircle, X, LayoutDashboard, Building2, Bell, LifeBuoy, Loader2, CheckCircle2,
  Sparkles, Send, Users, BarChart3, Plug, Shield, Inbox, Settings,
} from "lucide-react";
import { C } from "@/lib/design";

// Global "?" help menu in the TopHeader. Opens a centered modal that (1) lets
// the user send a support request to the SWL team (lands in /admin/support) and
// (2) explains every view of the app, with a click-through link to each. Copy
// is English to match the rest of the (largely hardcoded-English) deeper UI.

const REQUEST_CATEGORIES: { value: string; label: string }[] = [
  { value: "general", label: "General" },
  { value: "bug", label: "Something's broken" },
  { value: "feature", label: "Feature request" },
  { value: "question", label: "Question" },
  { value: "billing", label: "Billing" },
];

type MyRequest = {
  id: string;
  category: string;
  subject: string;
  status: "open" | "in_progress" | "resolved" | "rejected";
  admin_notes: string | null;
  created_at: string;
};

// Status pill colors for the requester's "Your requests" list.
const STATUS_PILL: Record<string, { bg: string; fg: string; label: string }> = {
  open: { bg: "#FEF3C7", fg: "#B45309", label: "Open" },
  in_progress: { bg: "#DBEAFE", fg: "#1D4ED8", label: "In progress" },
  resolved: { bg: "#D1FAE5", fg: "#047857", label: "Resolved" },
  rejected: { bg: "#FEE2E2", fg: "#B91C1C", label: "Rejected" },
};

type ViewItem = {
  href: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;
  color: string;
};

type ViewGroup = { title: string; items: ViewItem[] };

const GROUPS: ViewGroup[] = [
  {
    title: "Main",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, color: C.gold,
        desc: "Your home base — KPIs, today's activity, and a 30-day performance overview at a glance." },
      { href: "/company-bios", label: "Company Bio", icon: Building2, color: C.blue,
        desc: "Your company profile and positioning. This is the context the AI uses to write every message." },
      { href: "/queue", label: "Inbox", icon: Bell, color: "#F97316",
        desc: "Your daily action list: replies to triage, calls to make, and campaign steps awaiting your approval." },
    ],
  },
  {
    title: "Growth Engine",
    items: [
      { href: "/icp", label: "Lead Miner™", icon: Sparkles, color: C.aiAccent,
        desc: "Define your ideal customer profiles (ICPs) and mine matching leads to feed into campaigns." },
      { href: "/campaigns", label: "Outreach Flow™", icon: Send, color: C.aiAccent,
        desc: "Build and run multi-step LinkedIn + email sequences. The AI personalizes each message per lead." },
      { href: "/leads", label: "Leads", icon: Users, color: C.green,
        desc: "Every lead with status, score, and a full activity timeline. Filter, search, and drill into any contact." },
      { href: "/results", label: "Results", icon: BarChart3, color: C.blue,
        desc: "Campaign performance and conversion metrics — what's working, who replied, and where to double down." },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/queue?tab=inbox", label: "Inbox", icon: Inbox, color: C.linkedin,
        desc: "Every conversation across LinkedIn and email in one place. Reply or hand off to a seller." },
      { href: "/accounts", label: "Accounts", icon: Plug, color: C.textMuted,
        desc: "Connected channels and sending accounts (LinkedIn, email, phone) and their health." },
      { href: "/admin", label: "Admin", icon: Shield, color: C.aiAccent,
        desc: "Manage clients, team members, and approvals. Visible to admins and owners only." },
      { href: "/settings", label: "Settings", icon: Settings, color: C.textMuted,
        desc: "Your preferences: theme, language, password, and account details." },
    ],
  },
];

export default function HelpMenu({ variant = "header" }: { variant?: "header" | "sidebar" }) {
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState("general");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [myRequests, setMyRequests] = useState<MyRequest[]>([]);

  const loadMine = useCallback(async () => {
    try {
      const r = await fetch("/api/help-requests?mine=1", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setMyRequests(Array.isArray(j?.requests) ? j.requests : []);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    if (!open) return;
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open]);

  // Reset the form whenever the modal closes.
  useEffect(() => {
    if (open) return;
    setShowForm(false); setSent(false); setErr(null);
    setCategory("general"); setSubject(""); setMessage("");
  }, [open]);

  // Load the caller's own requests when the menu opens.
  useEffect(() => { if (open) loadMine(); }, [open, loadMine]);

  async function submitRequest() {
    if (!subject.trim() || !message.trim() || sending) return;
    setSending(true); setErr(null);
    try {
      const r = await fetch("/api/help-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category, subject: subject.trim(), body: message.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j?.error ?? "Something went wrong"); return; }
      setSent(true); setSubject(""); setMessage(""); setCategory("general");
      loadMine();
    } catch {
      setErr("Network error — please try again");
    } finally {
      setSending(false);
    }
  }

  const modal = (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-6"
      style={{ backgroundColor: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border max-h-[88vh] flex flex-col overflow-hidden"
        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 24px 70px -20px rgba(0,0,0,0.45)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: `color-mix(in srgb, ${C.gold} 14%, transparent)`, color: C.gold }}>
              <HelpCircle size={16} />
            </div>
            <div>
              <h2 className="text-sm font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                Help &amp; Guide
              </h2>
              <p className="text-[11px]" style={{ color: C.textMuted }}>Send a request or learn what each view does</p>
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/[0.04]">
            <X size={16} style={{ color: C.textMuted }} />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-5">
          {/* Send a request to the SWL team */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2" style={{ color: C.textDim }}>Need help?</p>
            <div className="rounded-xl border p-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
              {sent ? (
                <div className="flex flex-col items-center text-center py-3">
                  <CheckCircle2 size={28} style={{ color: C.green }} className="mb-2" />
                  <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>Request sent</p>
                  <p className="text-[11px] mt-1 max-w-sm" style={{ color: C.textMuted }}>
                    The SWL team has been notified and will get back to you.
                  </p>
                  <button
                    onClick={() => { setSent(false); setShowForm(false); }}
                    className="mt-3 text-[11px] font-semibold" style={{ color: C.aiAccent }}
                  >
                    Send another
                  </button>
                </div>
              ) : !showForm ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `color-mix(in srgb, ${C.aiAccent} 14%, transparent)`, color: C.aiAccent }}>
                      <LifeBuoy size={16} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold" style={{ color: C.textPrimary }}>Send a request to the SWL team</p>
                      <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
                        Report a bug, ask a question, or request a feature — we&apos;ll get back to you.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowForm(true)}
                    className="shrink-0 text-xs font-semibold rounded-lg px-3 py-2 text-white"
                    style={{ backgroundColor: C.aiAccent }}
                  >
                    New request
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    {REQUEST_CATEGORIES.map(c => (
                      <button
                        key={c.value}
                        onClick={() => setCategory(c.value)}
                        className="text-[11px] font-semibold rounded-lg px-2.5 py-1.5 border transition-colors"
                        style={category === c.value
                          ? { backgroundColor: `color-mix(in srgb, ${C.aiAccent} 12%, transparent)`, borderColor: C.aiAccent, color: C.aiAccent }
                          : { borderColor: C.border, color: C.textMuted }}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                  <input
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    placeholder="Subject"
                    maxLength={200}
                    className="w-full text-xs rounded-lg border px-3 py-2 outline-none"
                    style={{ borderColor: C.border, backgroundColor: C.card, color: C.textPrimary }}
                  />
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="Describe what you need…"
                    rows={4}
                    maxLength={4000}
                    className="w-full text-xs rounded-lg border px-3 py-2 outline-none resize-none"
                    style={{ borderColor: C.border, backgroundColor: C.card, color: C.textPrimary }}
                  />
                  {err && <p className="text-[11px]" style={{ color: C.red }}>{err}</p>}
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => setShowForm(false)} className="text-[11px] font-semibold px-2.5 py-1.5" style={{ color: C.textMuted }}>
                      Cancel
                    </button>
                    <button
                      onClick={submitRequest}
                      disabled={!subject.trim() || !message.trim() || sending}
                      className="text-xs font-semibold rounded-lg px-3 py-2 text-white inline-flex items-center gap-1.5 disabled:opacity-50"
                      style={{ backgroundColor: C.aiAccent }}
                    >
                      {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      {sending ? "Sending…" : "Send request"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Your requests — status of what this user has submitted */}
          {myRequests.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2" style={{ color: C.textDim }}>Your requests</p>
              <div className="space-y-1.5">
                {myRequests.map(rq => {
                  const pill = STATUS_PILL[rq.status] ?? STATUS_PILL.open;
                  return (
                    <div key={rq.id} className="rounded-xl border px-3 py-2.5" style={{ borderColor: C.border }}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold truncate" style={{ color: C.textPrimary }}>{rq.subject}</p>
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5"
                          style={{ backgroundColor: pill.bg, color: pill.fg }}>{pill.label}</span>
                      </div>
                      {rq.admin_notes && (
                        <p className="text-[11px] mt-1.5 rounded-lg px-2 py-1.5" style={{ backgroundColor: C.bg, color: C.textMuted }}>
                          <span className="font-semibold" style={{ color: C.textBody }}>SWL team:</span> {rq.admin_notes}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Views */}
          {GROUPS.map(group => (
            <div key={group.title}>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2" style={{ color: C.textDim }}>{group.title}</p>
              <div className="grid sm:grid-cols-2 gap-2">
                {group.items.map(item => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="flex items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors hover:bg-black/[0.03]"
                      style={{ borderColor: C.border }}
                    >
                      <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                        style={{ backgroundColor: `color-mix(in srgb, ${item.color} 14%, transparent)`, color: item.color }}>
                        <Icon size={14} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold leading-tight" style={{ color: C.textPrimary }}>{item.label}</p>
                        <p className="text-[11px] leading-snug mt-0.5" style={{ color: C.textMuted }}>{item.desc}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-3 text-[11px] shrink-0" style={{ borderColor: C.border, color: C.textDim }}>
          Requests reach the SWL team directly — we&apos;ll get back to you as soon as we can.
        </div>
      </div>
    </div>
  );

  // Sidebar lives on a dark surface, so the trigger needs white-ish theming
  // that matches the settings gear there; the header trigger stays light.
  const sidebarMuted = "rgba(255,255,255,0.55)";

  return (
    <>
      {variant === "sidebar" ? (
        <button
          onClick={() => setOpen(true)}
          title="Help & guide"
          aria-label="Help & guide"
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-[background-color,color] shrink-0"
          style={{ color: sidebarMuted }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.05)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = sidebarMuted; e.currentTarget.style.backgroundColor = "transparent"; }}
        >
          <HelpCircle size={15} />
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          title="Help & guide"
          aria-label="Help & guide"
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-gray-100"
          style={{ color: C.textMuted }}
        >
          <HelpCircle size={16} />
        </button>
      )}
      {open && typeof document !== "undefined" && createPortal(modal, document.body)}
    </>
  );
}
