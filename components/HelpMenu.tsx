"use client";

import { useCallback, useEffect, useState, Fragment } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  HelpCircle, X, LayoutDashboard, Building2, Bell, LifeBuoy, Loader2, CheckCircle2,
  Sparkles, Send, Users, BarChart3, Plug, Shield, Inbox, Settings,
  MessageSquare, AlertTriangle, CreditCard, Clock, Lightbulb, ChevronDown, ArrowLeft,
} from "lucide-react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";

const gold = "var(--brand, #c9a83a)";

// Global "?" help menu in the TopHeader. Opens a centered modal that (1) lets
// the user send a support request to the SWL team (lands in /admin/support) and
// (2) explains every view of the app, with a click-through link to each.

// Category values are stable; labels are resolved with t() inside the component.
// Each carries an icon (scan-fast picker) + a tailored description placeholder.
const REQUEST_CATEGORIES: { value: string; labelKey: string; phKey: string; icon: React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>; wide?: boolean }[] = [
  { value: "general",  labelKey: "help.cat.general",  phKey: "help.ph.general",  icon: MessageSquare },
  { value: "bug",      labelKey: "help.cat.bug",      phKey: "help.ph.bug",      icon: AlertTriangle },
  { value: "feature",  labelKey: "help.cat.feature",  phKey: "help.ph.feature",  icon: Sparkles },
  { value: "question", labelKey: "help.cat.question", phKey: "help.ph.question", icon: HelpCircle },
  { value: "billing",  labelKey: "help.cat.billing",  phKey: "help.ph.billing",  icon: CreditCard, wide: true },
];

type MyRequest = {
  id: string;
  category: string;
  subject: string;
  status: "open" | "in_progress" | "resolved" | "rejected";
  admin_notes: string | null;
  created_at: string;
  resolved_at: string | null;
};

// Client-side archive: which resolved requests this user dismissed from their
// "?" list. Kept in localStorage (per-browser) so it never needs a DB column.
const DISMISS_KEY = "swl.help.dismissed";
function loadDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]")); } catch { return new Set(); }
}

// Resolved requests older than this auto-drop from the client list (they live on
// forever in the admin registry). Keeps "Your requests" from piling up.
const ARCHIVE_DAYS = 7;

// The three-stage pipeline a request moves through, for the mini stepper.
const STATUS_STEPS = ["open", "in_progress", "resolved"] as const;
function statusRank(s: string): number {
  return s === "resolved" ? 2 : s === "in_progress" ? 1 : 0;
}

// Status pill colors for the requester's "Your requests" list. Labels resolved
// with t() inside the component via help.status.* keyed on status.
const STATUS_PILL: Record<string, { bg: string; fg: string }> = {
  open: { bg: "color-mix(in srgb, #D97706 16%, transparent)", fg: "#B45309" },
  in_progress: { bg: "color-mix(in srgb, #2563EB 16%, transparent)", fg: "#1D4ED8" },
  resolved: { bg: "color-mix(in srgb, #16A34A 16%, transparent)", fg: "#047857" },
  rejected: { bg: "color-mix(in srgb, #DC2626 14%, transparent)", fg: "#B91C1C" },
};

type ViewItem = {
  href: string;
  labelKey: string;
  descKey: string;
  icon: React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;
  color: string;
};

type ViewGroup = { titleKey: string; items: ViewItem[] };

const GROUPS: ViewGroup[] = [
  {
    titleKey: "help.group.main",
    items: [
      { href: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, color: C.gold,
        descKey: "help.item.dashboard.desc" },
      { href: "/company-bios", labelKey: "nav.companyBio", icon: Building2, color: C.blue,
        descKey: "help.item.companyBio.desc" },
      { href: "/queue", labelKey: "nav.queue", icon: Bell, color: "#F97316",
        descKey: "help.item.inbox.desc" },
    ],
  },
  {
    titleKey: "help.group.growth",
    items: [
      { href: "/icp", labelKey: "help.item.leadMiner.label", icon: Sparkles, color: C.aiAccent,
        descKey: "help.item.leadMiner.desc" },
      { href: "/campaigns", labelKey: "help.item.outreach.label", icon: Send, color: C.aiAccent,
        descKey: "help.item.outreach.desc" },
      { href: "/leads", labelKey: "nav.leads", icon: Users, color: C.green,
        descKey: "help.item.leads.desc" },
      { href: "/results", labelKey: "nav.results", icon: BarChart3, color: C.blue,
        descKey: "help.item.results.desc" },
    ],
  },
  {
    titleKey: "help.group.operations",
    items: [
      { href: "/queue?tab=inbox", labelKey: "nav.queue", icon: Inbox, color: C.linkedin,
        descKey: "help.item.opsInbox.desc" },
      { href: "/accounts", labelKey: "nav.accounts", icon: Plug, color: C.textMuted,
        descKey: "help.item.accounts.desc" },
      { href: "/admin", labelKey: "nav.admin", icon: Shield, color: C.aiAccent,
        descKey: "help.item.admin.desc" },
      { href: "/settings", labelKey: "nav.settings", icon: Settings, color: C.textMuted,
        descKey: "help.item.settings.desc" },
    ],
  },
];

export default function HelpMenu({ variant = "header" }: { variant?: "header" | "sidebar" }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState("general");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [myRequests, setMyRequests] = useState<MyRequest[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  useEffect(() => { setDismissed(loadDismissed()); }, []);
  function dismissReq(id: string) {
    setDismissed(prev => {
      const next = new Set(prev); next.add(id);
      try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...next])); } catch { /* private mode */ }
      return next;
    });
  }

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
      if (!r.ok) { setErr(j?.error ?? t("help.errGeneric")); return; }
      setSent(true); setSubject(""); setMessage(""); setCategory("general");
      loadMine();
    } catch {
      setErr(t("help.errNetwork"));
    } finally {
      setSending(false);
    }
  }

  // Split the caller's requests: active (open / in_progress) stay visible; the
  // resolved/rejected ones collapse and auto-drop after ARCHIVE_DAYS so the list
  // never piles up. `dismissed` lets the user archive one manually right away.
  const now = Date.now();
  const visibleReqs = myRequests.filter(r => !dismissed.has(r.id));
  const activeReqs = visibleReqs.filter(r => r.status === "open" || r.status === "in_progress");
  const resolvedReqs = visibleReqs.filter(r =>
    (r.status === "resolved" || r.status === "rejected") &&
    !(r.resolved_at && now - new Date(r.resolved_at).getTime() > ARCHIVE_DAYS * 86400000));
  const currentPh = t(REQUEST_CATEGORIES.find(c => c.value === category)?.phKey ?? "help.describe");

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
                {t("help.title")}
              </h2>
              <p className="text-[11px]" style={{ color: C.textMuted }}>{t("help.subtitle")}</p>
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/[0.04]">
            <X size={16} style={{ color: C.textMuted }} />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-5">
          {/* Send a request to the SWL team */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2" style={{ color: C.textDim }}>{t("help.needHelp")}</p>
            <div className="rounded-xl border p-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
              {sent ? (
                <div className="flex flex-col items-center text-center py-3">
                  <CheckCircle2 size={28} style={{ color: C.green }} className="mb-2" />
                  <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{t("help.requestSent")}</p>
                  <p className="text-[11px] mt-1 max-w-sm" style={{ color: C.textMuted }}>
                    {t("help.notified")}
                  </p>
                  <button
                    onClick={() => { setSent(false); setShowForm(false); }}
                    className="mt-3 text-[11px] font-semibold" style={{ color: C.aiAccent }}
                  >
                    {t("help.sendAnother")}
                  </button>
                </div>
              ) : !showForm ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `color-mix(in srgb, ${gold} 14%, transparent)`, color: "var(--fg1)" }}>
                      <LifeBuoy size={16} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold" style={{ color: C.textPrimary }}>{t("help.sendRequestTitle")}</p>
                      <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
                        {t("help.sendRequestDesc")}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowForm(true)}
                    className="shrink-0 text-xs font-bold rounded-lg px-3.5 py-2 inline-flex items-center gap-1.5"
                    style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 68%, white))`, color: "#1A1505" }}
                  >
                    <Send size={13} /> {t("help.newRequest")}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <button onClick={() => setShowForm(false)} className="inline-flex items-center gap-1.5 text-[11px] font-bold" style={{ color: C.textMuted }}>
                    <ArrowLeft size={12} /> {t("help.backToRequests")}
                  </button>
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textDim }}>{t("help.newRequestAbout")}</p>
                  {/* Category picker — icon per type; tailored placeholder on pick. */}
                  <div className="grid grid-cols-2 gap-2">
                    {REQUEST_CATEGORIES.map(c => {
                      const on = category === c.value;
                      const Icon = c.icon;
                      return (
                        <button
                          key={c.value}
                          onClick={() => setCategory(c.value)}
                          className={`flex items-center gap-2.5 text-[12px] font-semibold rounded-xl px-3 py-2.5 border transition-colors text-left ${c.wide ? "col-span-2" : ""}`}
                          style={on
                            ? { backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)`, borderColor: gold, color: "var(--fg1)", boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${gold} 45%, transparent)` }
                            : { borderColor: C.border, color: C.textMuted, backgroundColor: C.card }}
                        >
                          <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                            style={on ? { backgroundColor: `color-mix(in srgb, ${gold} 24%, transparent)`, color: "var(--fg1)" } : { backgroundColor: C.surface, color: C.textDim }}>
                            <Icon size={14} />
                          </span>
                          {t(c.labelKey)}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    placeholder={t("help.subjectOneLine")}
                    maxLength={200}
                    className="w-full text-xs rounded-lg border px-3 py-2.5 outline-none"
                    style={{ borderColor: C.border, backgroundColor: C.card, color: C.textPrimary }}
                  />
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder={currentPh}
                    rows={4}
                    maxLength={4000}
                    className="w-full text-xs rounded-lg border px-3 py-2.5 outline-none resize-none"
                    style={{ borderColor: C.border, backgroundColor: C.card, color: C.textPrimary }}
                  />
                  <p className="flex items-start gap-1.5 text-[11px]" style={{ color: C.textDim }}>
                    <Lightbulb size={12} style={{ color: "var(--fg1)", flexShrink: 0, marginTop: 1 }} /> {t("help.contextTip")}
                  </p>
                  {err && <p className="text-[11px]" style={{ color: C.red }}>{err}</p>}
                  <div className="flex items-center gap-2 pt-0.5">
                    <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: C.textDim }}>
                      <Clock size={12} /> {t("help.eta")}
                    </span>
                    <span className="flex-1" />
                    <button onClick={() => setShowForm(false)} className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg" style={{ color: C.textMuted }}>
                      {t("help.cancel")}
                    </button>
                    <button
                      onClick={submitRequest}
                      disabled={!subject.trim() || !message.trim() || sending}
                      className="text-xs font-bold rounded-lg px-3.5 py-2 inline-flex items-center gap-1.5 disabled:opacity-50"
                      style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 68%, white))`, color: "#1A1505" }}
                    >
                      {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      {sending ? t("help.sending") : t("help.sendRequest")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Your requests — active carry a status stepper; resolved collapse
              below and auto-drop after ARCHIVE_DAYS so the list never piles up. */}
          {(activeReqs.length > 0 || resolvedReqs.length > 0) && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2 flex items-center gap-2" style={{ color: C.textDim }}>
                {t("help.yourRequests")}
                {activeReqs.length > 0 && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${gold} 14%, transparent)`, color: "var(--fg1)" }}>
                    {activeReqs.length} {t("help.active").toLowerCase()}
                  </span>
                )}
              </p>

              <div className="space-y-2">
                {activeReqs.map(rq => {
                  const pill = STATUS_PILL[rq.status] ?? STATUS_PILL.open;
                  const rank = statusRank(rq.status);
                  return (
                    <div key={rq.id} className="rounded-xl border px-3 py-2.5" style={{ borderColor: C.border }}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold truncate" style={{ color: C.textPrimary }}>{rq.subject}</p>
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5"
                          style={{ backgroundColor: pill.bg, color: pill.fg }}>{t(`help.status.${rq.status}`)}</span>
                      </div>
                      {/* mini pipeline stepper */}
                      <div className="flex items-center mt-2">
                        {STATUS_STEPS.map((s, i) => {
                          const done = i < rank, cur = i === rank;
                          const col = done ? C.green : cur ? C.aiAccent : C.textDim;
                          return (
                            <Fragment key={s}>
                              {i > 0 && <span className="flex-1 h-[2px] mx-1.5 rounded" style={{ backgroundColor: i <= rank ? C.green : C.border }} />}
                              <span className="inline-flex items-center gap-1">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: done || cur ? col : "transparent", border: `2px solid ${done || cur ? col : C.border}` }} />
                                <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: done || cur ? col : C.textDim }}>{t(`help.status.${s}`)}</span>
                              </span>
                            </Fragment>
                          );
                        })}
                      </div>
                      {rq.admin_notes && (
                        <p className="text-[11px] mt-2 rounded-lg px-2 py-1.5" style={{ backgroundColor: C.bg, color: C.textMuted }}>
                          <span className="font-semibold" style={{ color: C.textBody }}>{t("help.swlTeam")}</span> {rq.admin_notes}
                        </p>
                      )}
                    </div>
                  );
                })}
                {activeReqs.length === 0 && (
                  <p className="text-[11px] italic px-1 py-1" style={{ color: C.textDim }}>{t("help.noneActive")}</p>
                )}
              </div>

              {/* resolved — collapsed + auto-archived */}
              {resolvedReqs.length > 0 && (
                <div className="mt-2.5">
                  <button onClick={() => setShowResolved(v => !v)}
                    className="w-full flex items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-[11px] font-bold"
                    style={{ borderColor: C.border, color: C.textMuted }}>
                    <ChevronDown size={13} style={{ transform: showResolved ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
                    {t("help.resolvedGroup")}
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${C.green} 15%, transparent)`, color: C.green }}>{resolvedReqs.length}</span>
                    <span className="ml-auto text-[10px] font-medium" style={{ color: C.textDim }}>{t("help.autoArchive")}</span>
                  </button>
                  {showResolved && (
                    <div className="space-y-1.5 mt-2">
                      {resolvedReqs.map(rq => {
                        const pill = STATUS_PILL[rq.status] ?? STATUS_PILL.resolved;
                        return (
                          <div key={rq.id} className="rounded-xl border px-3 py-2" style={{ borderColor: C.border, opacity: 0.92 }}>
                            <div className="flex items-center gap-2">
                              <p className="text-xs font-semibold truncate flex-1" style={{ color: C.textPrimary }}>{rq.subject}</p>
                              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5"
                                style={{ backgroundColor: pill.bg, color: pill.fg }}>{t(`help.status.${rq.status}`)}</span>
                              <button onClick={() => dismissReq(rq.id)} title={t("help.archiveNow")}
                                className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md border" style={{ borderColor: C.border, color: C.textDim }}>
                                <X size={12} />
                              </button>
                            </div>
                            {rq.admin_notes && (
                              <p className="text-[11px] mt-1.5 rounded-lg px-2 py-1.5" style={{ backgroundColor: C.bg, color: C.textMuted }}>
                                <span className="font-semibold" style={{ color: C.textBody }}>{t("help.swlTeam")}</span> {rq.admin_notes}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Views */}
          {GROUPS.map(group => (
            <div key={group.titleKey}>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2" style={{ color: C.textDim }}>{t(group.titleKey)}</p>
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
                        <p className="text-xs font-semibold leading-tight" style={{ color: C.textPrimary }}>{t(item.labelKey)}</p>
                        <p className="text-[11px] leading-snug mt-0.5" style={{ color: C.textMuted }}>{t(item.descKey)}</p>
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
          {t("help.footer")}
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
          title={t("help.tooltip")}
          aria-label={t("help.tooltip")}
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
          title={t("help.tooltip")}
          aria-label={t("help.tooltip")}
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
