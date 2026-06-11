"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { C } from "@/lib/design";
import {
  Phone, Share2, Mail, Megaphone, Target,
  ChevronRight, CheckCircle, Search, X,
  PhoneCall, User, PhoneOff, Bell, AlertTriangle, XCircle, Sparkles,
  ThumbsUp, ThumbsDown, Clock, Loader2, Trash2, Voicemail, Calendar,
} from "lucide-react";
import PageHero from "@/components/PageHero";
import CallButton from "@/components/CallButton";
import InboxView, { type InboxReply } from "@/components/InboxView";
import ChatPanel from "@/components/ChatPanel";
import PreCallBrief from "@/components/PreCallBrief";
import { classifyUrgency } from "@/lib/overdue";

const gold = "var(--brand, #c9a83a)";

type PendingCall = {
  id: string;
  campaignId: string;
  campaignName: string;
  currentStep: number;
  totalSteps: number;
  leadId: string | null;
  leadName: string;
  company: string | null;
  role: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  // Surfaced from leads.allow_call so the Notifications card can flash a
  // "Wrong number" badge next to the phone. false = the post-call popup
  // flagged the number; the badge clicks through to the lead detail
  // where the WrongNumberPill opens its inline replace flow.
  allowCall?: boolean | null;
  phoneMarkedWrong?: boolean | null;
  email: string | null;
  sellerName: string | null;
  talkingPoints: Array<string | { type: "pain" | "fit" | "opener"; text: string }> | null;
  callAdvanceMode: "auto" | "manual";
  lastStepAt: string | null;
  isOverdue?: boolean;
  overdueDays?: number;
  aircallNumberId?: number | null;
  latestCall: {
    id: string;
    startedAt: string | null;
    classification: "positive" | "negative" | "follow_up" | "voicemail" | "wrong_number" | null;
  } | null;
};

type NewReply = {
  id: string;
  leadId: string;
  leadName: string;
  company: string | null;
  channel: string;
  classification: string | null;
  replyText: string | null;
  receivedAt: string;
  campaignName: string | null;
  icpProfileName?: string | null;
  requiresHumanReview?: boolean;
  // Persisted review state on the lead_replies row. The Inbox view reads
  // this to disable "Mark reviewed" when the reply is already approved
  // (and "Reject" when already rejected). Without it the buttons render
  // active even on rows that have nothing left to do — the API call
  // succeeds idempotently but the seller sees no visible change.
  reviewStatus?: "pending" | "approved" | "rejected" | null;
};

type CallHistoryEntry = {
  id: string;
  leadId: string | null;
  leadName: string;
  company: string | null;
  classification: "positive" | "negative" | "follow_up" | "voicemail" | "wrong_number" | null;
  status: string | null;
  durationSec: number | null;
  startedAt: string | null;
  sellerName: string | null;
  dialedByName: string | null;
  hasRecording: boolean;
  transcript: string | null;
  notes: string | null;
  aircallCallId: number | string | null;
  phoneNumber: string | null;
  primaryPhone: string | null;
  secondaryPhone: string | null;
};

// Which of the lead's two numbers was dialed (boss 2026-06-09). Compares by
// trailing digits so spacing/format differences don't break the match.
function dialedNumberLabel(e: CallHistoryEntry): { number: string; which: string | null } | null {
  if (!e.phoneNumber) return null;
  const digits = (s: string | null) => (s ?? "").replace(/\D/g, "").slice(-9);
  const dialed = digits(e.phoneNumber);
  const hasTwo = !!e.primaryPhone && !!e.secondaryPhone;
  let which: string | null = null;
  if (hasTwo && dialed) {
    if (digits(e.primaryPhone) === dialed) which = "Personal";
    else if (digits(e.secondaryPhone) === dialed) which = "Company";
  }
  return { number: e.phoneNumber, which };
}

type Props = {
  pendingCalls: PendingCall[];
  newReplies: NewReply[];
  callHistory: CallHistoryEntry[];
};

const channelMeta: Record<string, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,   color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,  color: "#F97316", label: "Call" },
};

// Tinted backgrounds derived from the accent color (not hardcoded light
// hexes) so the reply / classification chips read correctly in BOTH light
// and dark mode. color-mix(... transparent) yields a translucent wash that
// sits on top of whatever the underlying card surface is.
const tint = (color: string, pct = 12) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;
const classificationMeta: Record<string, { color: string; bg: string; label: string }> = {
  // Labels mirror the post-call outcome popup so the History entry the
  // seller sees in Notifications matches the button they tapped.
  positive:            { color: C.green,    bg: tint(C.green, 12),   label: "Interested" },
  meeting_intent:      { color: C.green,    bg: tint(C.green, 12),   label: "Meeting Intent" },
  negative:            { color: C.red,      bg: tint(C.red, 12),     label: "Not interested" },
  needs_info:          { color: "#D97706",  bg: tint("#D97706", 12), label: "Needs Info" },
  not_now:             { color: C.textMuted, bg: tint(C.textMuted, 10), label: "Not Now" },
  follow_up:           { color: "#D97706",  bg: tint("#D97706", 12), label: "Bad timing" },
  voicemail:           { color: "#0EA5E9",  bg: tint("#0EA5E9", 12), label: "Voicemail" },
  wrong_number:        { color: C.textMuted, bg: tint(C.textMuted, 10), label: "Wrong number" },
  connection_accepted: { color: "#0A66C2",  bg: tint("#0A66C2", 12), label: "Accepted Connection" },
};

function timeAgo(iso: string | null) {
  if (!iso) return "";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1)  return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Inline classifier for /queue Pending Calls. Reuses /api/calls/[id]/classify
// (same endpoint used in the lead detail CallCard) so the cascade is shared:
// Positive → campaign paused + lead qualified → entry drops out of /queue.
// Negative → campaign failed + lead closed_lost → entry drops out of /queue.
// Follow-up → just labels the call; campaign stays active so the entry
// stays in /queue with a "Follow-up logged" badge until the seller calls
// again and classifies it definitively.
function InlineClassifier({ call }: { call: PendingCall }) {
  const router = useRouter();
  // 2026-06-01: aligned with the 4 outcomes the post-call popup uses.
  // Wire values stay legacy-compatible (interested → positive, etc.) so
  // the existing classify endpoint + downstream cascades don't need to
  // change. `wrong_number` is the new fourth value — it disables the
  // call channel on the lead and skips queued call steps.
  const [busy, setBusy] = useState<"positive" | "negative" | "follow_up" | "voicemail" | "wrong_number" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // Secondary outcomes (voicemail / wrong number) tuck behind a "···" toggle —
  // sellers reach for Interested / Not interested / Bad timing 90% of the time.
  const [showMore, setShowMore] = useState(false);

  async function classify(c: "positive" | "negative" | "follow_up" | "voicemail" | "wrong_number") {
    if (!call.latestCall) return;
    setBusy(c);
    setErr(null);
    try {
      const res = await fetch(`/api/calls/${call.latestCall.id}/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classification: c, note: note.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(body.error ?? `Failed (${res.status})`);
        setBusy(null);
        return;
      }
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
      setBusy(null);
    }
  }

  if (!call.latestCall) return null;

  // Already classified: show the matching badge + a re-classify hint.
  // follow_up renders "Bad timing logged", wrong_number renders "Wrong
  // number logged". Positive/negative don't reach this branch — those
  // collapse the campaign and remove the entry from /queue entirely.
  if (call.latestCall.classification === "follow_up" || call.latestCall.classification === "voicemail" || call.latestCall.classification === "wrong_number") {
    const cls = call.latestCall.classification;
    const isFollow = cls === "follow_up";
    const isVoicemail = cls === "voicemail";
    const color = isFollow ? "#D97706" : isVoicemail ? "#0EA5E9" : C.textMuted;
    const Icon = isFollow ? Clock : isVoicemail ? Voicemail : PhoneOff;
    const label = isFollow ? "Bad timing logged" : isVoicemail ? "Voicemail logged" : "Wrong number logged";
    const hint = cls === "wrong_number" ? "Call channel disabled — update the phone to re-enable" : "Call again to update outcome";
    return (
      <div className="border-t px-5 py-2.5 flex items-center gap-2 text-[11px] flex-wrap"
        style={{ borderColor: C.border, backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)` }}>
        <Icon size={11} style={{ color }} />
        <span style={{ color, fontWeight: 600 }}>
          {label} {timeAgo(call.latestCall.startedAt)}
        </span>
        <span style={{ color: C.textMuted }}>· {hint}</span>
        {err && <span className="ml-auto" style={{ color: C.red }}>{err}</span>}
      </div>
    );
  }

  // Call exists, no classification yet → render the 3 buttons.
  // The 'positive'/'negative' actions close the campaign (entry will then
  // disappear from /queue on the next router.refresh()).
  return (
    <div className="border-t" style={{ borderColor: C.border, backgroundColor: C.bg }}>
    <div className="px-5 py-2.5 flex items-center gap-2 flex-wrap">
      <span className="text-[11px] font-semibold mr-1" style={{ color: C.textBody }}>
        Called {timeAgo(call.latestCall.startedAt)} — outcome?
      </span>
      <button
        onClick={() => classify("positive")}
        disabled={busy !== null}
        className="text-[11px] font-medium px-2.5 py-1 rounded-md border inline-flex items-center gap-1 disabled:opacity-50"
        style={{ backgroundColor: `color-mix(in srgb, ${C.green} 12%, transparent)`, borderColor: `color-mix(in srgb, ${C.green} 35%, transparent)`, color: C.green }}>
        {busy === "positive" ? <Loader2 size={10} className="animate-spin" /> : <ThumbsUp size={10} />}
        Interested
      </button>
      <button
        onClick={() => classify("negative")}
        disabled={busy !== null}
        className="text-[11px] font-medium px-2.5 py-1 rounded-md border inline-flex items-center gap-1 disabled:opacity-50"
        style={{ backgroundColor: `color-mix(in srgb, ${C.red} 12%, transparent)`, borderColor: `color-mix(in srgb, ${C.red} 35%, transparent)`, color: C.red }}>
        {busy === "negative" ? <Loader2 size={10} className="animate-spin" /> : <ThumbsDown size={10} />}
        Not interested
      </button>
      <button
        onClick={() => classify("follow_up")}
        disabled={busy !== null}
        className="text-[11px] font-medium px-2.5 py-1 rounded-md border inline-flex items-center gap-1 disabled:opacity-50"
        style={{ backgroundColor: "color-mix(in srgb, #D97706 12%, transparent)", borderColor: "color-mix(in srgb, #D97706 35%, transparent)", color: "#D97706" }}>
        {busy === "follow_up" ? <Loader2 size={10} className="animate-spin" /> : <Clock size={10} />}
        Bad timing
      </button>
      {showMore ? (
        <>
          <button
            onClick={() => classify("voicemail")}
            disabled={busy !== null}
            className="text-[11px] font-medium px-2.5 py-1 rounded-md border inline-flex items-center gap-1 disabled:opacity-50"
            style={{ backgroundColor: "color-mix(in srgb, #0EA5E9 12%, transparent)", borderColor: "color-mix(in srgb, #0EA5E9 35%, transparent)", color: "#0EA5E9" }}>
            {busy === "voicemail" ? <Loader2 size={10} className="animate-spin" /> : <Voicemail size={10} />}
            Voicemail
          </button>
          <button
            onClick={() => classify("wrong_number")}
            disabled={busy !== null}
            className="text-[11px] font-medium px-2.5 py-1 rounded-md border inline-flex items-center gap-1 disabled:opacity-50"
            style={{ backgroundColor: C.surface, borderColor: C.border, color: C.textMuted }}>
            {busy === "wrong_number" ? <Loader2 size={10} className="animate-spin" /> : <PhoneOff size={10} />}
            Wrong number
          </button>
        </>
      ) : (
        <button
          onClick={() => setShowMore(true)}
          disabled={busy !== null}
          title="More outcomes (voicemail / wrong number)"
          className="text-[11px] font-medium px-2 py-1 rounded-md border inline-flex items-center gap-1 disabled:opacity-50"
          style={{ backgroundColor: C.surface, borderColor: C.border, color: C.textMuted }}>
          ···
        </button>
      )}
      {err && <span className="text-[11px]" style={{ color: C.red }}>{err}</span>}
    </div>
    {/* Optional after-call note — saved to the lead's Notes (as a Call note)
        with whichever outcome the seller picks. */}
    <div className="px-5 pb-2.5">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Add a note about the call (optional) — saved to the lead's Notes"
        className="w-full text-[11px] px-2.5 py-1.5 rounded-md border outline-none"
        style={{ borderColor: C.border, backgroundColor: C.card, color: C.textBody }}
      />
    </div>
    </div>
  );
}

function fmtDuration(s: number | null): string {
  if (!s || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// History sub-tab inside Calls — every classified call, split into the same 4
// outcome buckets the post-call popup uses, with a date-range filter and an
// inline recording player. Read-only review surface so the whole team can see
// what was dialed and listen back.
type HistClass = "all" | "positive" | "negative" | "wrong_number" | "follow_up" | "voicemail" | "unclassified";

const HIST_TABS: Array<{ key: HistClass; label: string; color: string }> = [
  { key: "all",          label: "All",            color: "#0A66C2" },
  { key: "positive",     label: "Interested",     color: "#15803D" },
  { key: "negative",     label: "Not interested", color: "#DC2626" },
  { key: "follow_up",    label: "Bad timing",     color: "#D97706" },
  { key: "voicemail",    label: "Voicemail",      color: "#0EA5E9" },
  { key: "wrong_number", label: "Wrong number",   color: C.textMuted },
  { key: "unclassified", label: "Sin clasificar", color: "#DC2626" },
];

// One reviewable call in the History list: recording player, transcript
// (view / generate), and an editable note. Self-contained so each row owns
// its own expand + save state.
function CallHistoryRow({ e }: { e: CallHistoryEntry }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [transcript, setTranscript] = useState(e.transcript);
  const [transcribing, setTranscribing] = useState(false);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [hidden, setHidden] = useState(false);
  // Teammate tagging — a saved note becomes a lead note (note_type 'call')
  // so it shows in the lead detail's Team Notes, and any tagged teammates get
  // an in-app notification via /api/leads/[id]/notes → createNotifications.
  const [roster, setRoster] = useState<Array<{ userId: string; name: string }>>([]);
  const [mentioned, setMentioned] = useState<Set<string>>(new Set());
  // Outcome is settable/changeable on EVERY call in History, not just the
  // pending ones — sellers need to correct a mis-classification or log an
  // outcome on a call that never went through the popup.
  const [cls, setCls] = useState<string | null>(e.classification ?? null);
  const [classifying, setClassifying] = useState<string | null>(null);
  // When a call IS classified we show just the badge; "Cambiar" reveals the
  // full option set so the row stays compact unless you want to correct it.
  const [editOutcome, setEditOutcome] = useState(false);
  const [moreOutcomes, setMoreOutcomes] = useState(false);

  useEffect(() => {
    if (!expanded || roster.length > 0) return;
    fetch("/api/team/roster").then(r => r.ok ? r.json() : { roster: [] }).then(d => setRoster(d.roster ?? [])).catch(() => {});
  }, [expanded, roster.length]);

  async function classifyOutcome(c: string) {
    if (classifying) return;
    setClassifying(c); setErr(null);
    try {
      const r = await fetch(`/api/calls/${e.id}/classify`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classification: c }),
      });
      if (!r.ok) { const b = await r.json().catch(() => ({})); setErr(b.error ?? "Couldn't set outcome"); return; }
      setCls(c);
    } catch { setErr("Network error"); }
    finally { setClassifying(null); }
  }

  const meta = cls ? classificationMeta[cls] : null;
  const accent = meta?.color ?? C.textMuted;
  const canTranscribe = e.hasRecording && !transcript && !!e.aircallCallId;

  async function remove() {
    if (deleting) return;
    if (!confirm("Delete this call from History? This removes the CRM row (a fresh Aircall sync can repull it if it still exists upstream).")) return;
    setDeleting(true); setErr(null);
    try {
      const r = await fetch(`/api/calls/${e.id}`, { method: "DELETE" });
      if (!r.ok) { const b = await r.json().catch(() => ({})); setErr(b.error ?? "Couldn't delete"); setDeleting(false); return; }
      setHidden(true);
    } catch { setErr("Network error"); setDeleting(false); }
  }

  if (hidden) return null;

  async function transcribe() {
    if (transcribing) return;
    setTranscribing(true); setErr(null);
    try {
      const r = await fetch("/api/aircall/transcribe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId: e.id }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(body.error ?? "Couldn't transcribe"); return; }
      if (body.transcript) setTranscript(body.transcript);
      else router.refresh();
    } catch { setErr("Network error"); }
    finally { setTranscribing(false); }
  }

  async function saveNote() {
    if (savingNote || !note.trim()) return;
    if (!e.leadId) { setErr("No lead linked to this call."); return; }
    setSavingNote(true); setErr(null); setNoteSaved(false);
    try {
      // Saved as a LEAD note (type 'call') so it appears in the lead detail's
      // Team Notes; tagged teammates get notified by the endpoint.
      const r = await fetch(`/api/leads/${e.leadId}/notes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: note.trim(), note_type: "call", mentioned_user_ids: [...mentioned] }),
      });
      if (!r.ok) { const b = await r.json().catch(() => ({})); setErr(b.error ?? "Couldn't save note"); return; }
      setNoteSaved(true);
      setNote(""); setMentioned(new Set());
      window.setTimeout(() => setNoteSaved(false), 1800);
    } catch { setErr("Network error"); }
    finally { setSavingNote(false); }
  }

  return (
    <div className="rounded-xl border" style={{ backgroundColor: C.card, borderColor: C.border, borderLeftWidth: 3, borderLeftColor: accent }}>
      <div className="px-4 py-3">
        {/* Row 1 — identity, outcome pills, seller chips */}
        <div className="flex items-start gap-4">
          <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, #F97316, #FB923C)", color: "#fff" }}>
            <Phone size={15} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Link href={e.leadId ? `/leads/${e.leadId}` : "#"} className="text-sm font-bold hover:underline" style={{ color: C.textPrimary }}>
                {e.leadName}
              </Link>
              {e.company && <span className="text-xs" style={{ color: C.textMuted }}>· {e.company}</span>}
              {/* Outcome — compact. Classified → one filled badge + "Cambiar".
                  Unclassified → a red "Sin clasificar" cue + the quick buttons
                  so it's resolved in one tap. Keeps the row clean (no more 5
                  grey pills on every line). */}
              {cls && !editOutcome ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: tint(accent, 14), color: accent, border: `1px solid ${tint(accent, 35)}` }}>
                    {meta?.label ?? cls}
                  </span>
                  <button onClick={() => setEditOutcome(true)}
                    className="text-[10px] font-semibold transition-opacity hover:opacity-70" style={{ color: C.textDim }}>
                    Cambiar
                  </button>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 flex-wrap">
                  {!cls && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: tint(C.red, 12), color: C.red, border: `1px solid ${tint(C.red, 30)}` }}>
                      <AlertTriangle size={9} /> Sin clasificar
                    </span>
                  )}
                  {(() => {
                    const ALL = [
                      { key: "positive", label: "Interested", color: C.green },
                      { key: "negative", label: "Not interested", color: C.red },
                      { key: "follow_up", label: "Bad timing", color: "#D97706" },
                      { key: "voicemail", label: "Voicemail", color: "#0EA5E9" },
                      { key: "wrong_number", label: "Wrong number", color: C.textMuted },
                    ] as const;
                    // 3 primary outcomes always; voicemail/wrong-number tuck
                    // behind "···" (also auto-shown if one of them is active).
                    const secondaryActive = cls === "voicemail" || cls === "wrong_number";
                    const visible = moreOutcomes || secondaryActive ? ALL : ALL.slice(0, 3);
                    return (
                      <>
                        {visible.map(o => {
                          const active = cls === o.key;
                          return (
                            <button key={o.key} onClick={() => { classifyOutcome(o.key); setEditOutcome(false); }} disabled={!!classifying}
                              title={`Mark as ${o.label}`}
                              className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors disabled:opacity-50"
                              style={active
                                ? { backgroundColor: tint(o.color, 14), color: o.color, borderColor: o.color }
                                : { backgroundColor: "transparent", color: C.textBody, borderColor: C.border }}>
                              {classifying === o.key ? "…" : o.label}
                            </button>
                          );
                        })}
                        {!moreOutcomes && !secondaryActive && (
                          <button onClick={() => setMoreOutcomes(true)} disabled={!!classifying}
                            title="More outcomes (voicemail / wrong number)"
                            className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors disabled:opacity-50"
                            style={{ backgroundColor: "transparent", color: C.textDim, borderColor: C.border }}>
                            ···
                          </button>
                        )}
                      </>
                    );
                  })()}
                  {cls && (
                    <button onClick={() => setEditOutcome(false)} className="text-[10px] font-semibold transition-opacity hover:opacity-70" style={{ color: C.textDim }}>
                      Cancelar
                    </button>
                  )}
                </span>
              )}
              {e.dialedByName && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: "#EFF6FF", color: "#1D4ED8", border: "1px solid #BFDBFE" }}
                  title="Team member who placed the call">
                  <PhoneCall size={9} /> {e.dialedByName}
                </span>
              )}
              {e.sellerName && e.sellerName !== e.dialedByName && (
                <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: C.surface, color: C.textMuted, border: `1px solid ${C.border}` }}
                  title="LinkedIn sending account">
                  {e.sellerName}
                </span>
              )}
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: C.textDim }}>
              {fmtDateTime(e.startedAt)} · {fmtDuration(e.durationSec)}
              {e.status && <> · {e.status}</>}
              {transcript && <> · transcript ✓</>}
              {(() => {
                const d = dialedNumberLabel(e);
                if (!d) return null;
                return <> · <span style={{ color: C.textBody, fontWeight: 600 }}>📞 {d.number}</span>{d.which && <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ backgroundColor: C.surface, color: C.textMuted }}>{d.which}</span>}</>;
              })()}
            </p>
          </div>
        </div>

        {/* Row 2 — full-width recording player + actions (boss 2026-06-08:
            move the player under the name and let it span the whole row so the
            scrubber is clickable end-to-end). */}
        <div className="flex items-center gap-2 mt-3">
          {e.hasRecording ? (
            <audio controls preload="none" src={`/api/aircall/calls/${e.id}/play`} className="flex-1 h-9 min-w-0" />
          ) : (
            <span className="flex-1 text-[11px] px-3 py-2 rounded-md text-center" style={{ backgroundColor: C.surface, color: C.textDim }}>
              No recording
            </span>
          )}
          <button onClick={() => setExpanded(v => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors shrink-0"
            style={{ borderColor: C.border, color: C.textMuted, backgroundColor: expanded ? C.surface : "transparent" }}>
            {expanded ? "Hide" : "Transcript & notes"} <ChevronRight size={11} style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 150ms" }} />
          </button>
          <button onClick={remove} disabled={deleting} title="Delete this call from History"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors shrink-0 hover:bg-black/[0.03] disabled:opacity-50"
            style={{ borderColor: C.border, color: C.textMuted }}>
            {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-3" style={{ borderColor: C.border }}>
          {/* Transcript */}
          <div>
            <p className="text-[10px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color: C.textDim }}>Transcript</p>
            {transcript ? (
              <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{transcript}</p>
            ) : canTranscribe ? (
              <button onClick={transcribe} disabled={transcribing}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border transition-opacity hover:opacity-85 disabled:opacity-50"
                style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.surface }}>
                {transcribing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {transcribing ? "Transcribing…" : "Transcribe call"}
              </button>
            ) : (
              <p className="text-[11px]" style={{ color: C.textDim }}>No transcript {e.hasRecording ? "yet" : "(no recording)"}.</p>
            )}
          </div>
          {/* Notes — saved to the lead's Team Notes; tag teammates to notify them */}
          <div>
            <p className="text-[10px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color: C.textDim }}>
              Add note <span style={{ color: C.textDim, fontWeight: 400, textTransform: "none" }}>· saved to the lead's Notes</span>
            </p>
            <textarea value={note} onChange={ev => setNote(ev.target.value)} rows={2}
              placeholder="Add a note about this call…"
              className="w-full rounded-lg border px-3 py-2 text-[12px] resize-none outline-none focus:ring-2"
              style={{ backgroundColor: C.surface, borderColor: C.border, color: C.textPrimary }} />
            {roster.length > 0 && (
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <span className="text-[10px] font-semibold" style={{ color: C.textDim }}>Tag:</span>
                {roster.map(m => {
                  const on = mentioned.has(m.userId);
                  return (
                    <button key={m.userId} type="button"
                      onClick={() => setMentioned(prev => { const n = new Set(prev); n.has(m.userId) ? n.delete(m.userId) : n.add(m.userId); return n; })}
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-colors"
                      style={{
                        backgroundColor: on ? "color-mix(in srgb, #0A66C2 14%, transparent)" : C.surface,
                        color: on ? "#0A66C2" : C.textMuted,
                        borderColor: on ? "color-mix(in srgb, #0A66C2 35%, transparent)" : C.border,
                      }}>
                      @{m.name}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex items-center gap-2 mt-1.5">
              <button onClick={saveNote} disabled={savingNote || !note.trim() || !e.leadId}
                className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ backgroundColor: "#F97316" }}>
                {savingNote ? <Loader2 size={11} className="animate-spin" /> : null}
                Save note{mentioned.size > 0 ? ` & notify ${mentioned.size}` : ""}
              </button>
              {noteSaved && <span className="text-[11px] font-semibold" style={{ color: C.green }}>Saved to lead ✓</span>}
            </div>
          </div>
          {err && <p className="text-[11px]" style={{ color: C.red }}>{err}</p>}
        </div>
      )}
    </div>
  );
}

function CallHistoryPanel({
  entries, search, histClass, setHistClass, histFrom, setHistFrom, histTo, setHistTo, histDialer, setHistDialer,
}: {
  entries: CallHistoryEntry[];
  search: string;
  histClass: HistClass;
  setHistClass: (c: HistClass) => void;
  histFrom: string;
  setHistFrom: (s: string) => void;
  histTo: string;
  setHistTo: (s: string) => void;
  histDialer: string;
  setHistDialer: (s: string) => void;
}) {
  const counts: Record<string, number> = { all: entries.length, positive: 0, negative: 0, follow_up: 0, voicemail: 0, wrong_number: 0, unclassified: 0 };
  for (const e of entries) {
    if (e.classification && counts[e.classification] !== undefined) counts[e.classification]++;
    else if (!e.classification) counts.unclassified++;
  }

  // Distinct people who placed the calls (dialer first, falls back to the
  // flow's seller) — powers the "who called" filter (boss 2026-06-09).
  const dialerNames = Array.from(new Set(entries.map(e => e.dialedByName || e.sellerName).filter(Boolean) as string[])).sort();

  const fromMs = histFrom ? new Date(histFrom + "T00:00:00").getTime() : null;
  const toMs = histTo ? new Date(histTo + "T23:59:59").getTime() : null;
  const q = search.trim().toLowerCase();

  const rows = entries
    .filter(e => histClass === "all" || (histClass === "unclassified" ? !e.classification : e.classification === histClass))
    .filter(e => histDialer === "all" || (e.dialedByName || e.sellerName) === histDialer)
    .filter(e => {
      if (!fromMs && !toMs) return true;
      const t = e.startedAt ? new Date(e.startedAt).getTime() : 0;
      if (fromMs && t < fromMs) return false;
      if (toMs && t > toMs) return false;
      return true;
    })
    .filter(e => !q || `${e.leadName} ${e.company ?? ""} ${e.sellerName ?? ""} ${e.dialedByName ?? ""}`.toLowerCase().includes(q));

  return (
    <>
      {/* ─── Filter toolbar — one unified bar instead of scattered controls.
          Top: outcome buckets (segmented). Bottom: date range · called-by ·
          live count. "Sin clasificar" only appears when there are unclassified
          calls, and reads red so pending work is obvious. */}
      <div className="rounded-xl border mb-4 overflow-hidden" style={{ borderColor: C.border, backgroundColor: C.card }}>
        <div className="flex items-center gap-1.5 px-3 py-2.5 flex-wrap" style={{ borderBottom: `1px solid ${C.border}` }}>
          {HIST_TABS.map(t => {
            const active = histClass === t.key;
            const count = counts[t.key] ?? 0;
            const isUnc = t.key === "unclassified";
            if (isUnc && count === 0) return null; // nothing pending → hide bucket
            const idle = isUnc ? t.color : C.textMuted;
            return (
              <button key={t.key} onClick={() => setHistClass(t.key)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors"
                style={active
                  ? { backgroundColor: tint(t.color, 12), color: t.color, borderColor: tint(t.color, 40) }
                  : { backgroundColor: "transparent", color: idle, borderColor: isUnc ? tint(t.color, 30) : C.border }}>
                {t.label}
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums"
                  style={{ backgroundColor: active ? tint(t.color, 18) : (isUnc ? tint(t.color, 14) : C.surface), color: active || isUnc ? t.color : C.textDim }}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 px-3 py-2 text-xs flex-wrap" style={{ backgroundColor: C.surface }}>
          <div className="inline-flex items-center gap-1.5">
            <Calendar size={13} style={{ color: C.textDim }} />
            <input type="date" value={histFrom} onChange={e => setHistFrom(e.target.value)}
              className="rounded-md border px-2 py-1 outline-none" style={{ borderColor: C.border, backgroundColor: C.card, color: C.textBody }} />
            <span style={{ color: C.textDim }}>→</span>
            <input type="date" value={histTo} onChange={e => setHistTo(e.target.value)}
              className="rounded-md border px-2 py-1 outline-none" style={{ borderColor: C.border, backgroundColor: C.card, color: C.textBody }} />
            {(histFrom || histTo) && (
              <button onClick={() => { setHistFrom(""); setHistTo(""); }}
                className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md font-semibold transition-colors hover:bg-black/[0.04]" style={{ color: C.textDim }}>
                <X size={11} /> Clear
              </button>
            )}
          </div>
          {dialerNames.length > 0 && (
            <div className="inline-flex items-center gap-1.5">
              <span className="w-px h-4" style={{ backgroundColor: C.border }} />
              <PhoneCall size={12} style={{ color: C.textDim }} />
              <select value={histDialer} onChange={e => setHistDialer(e.target.value)}
                className="rounded-md border px-2 py-1 outline-none font-medium" style={{ borderColor: C.border, backgroundColor: C.card, color: C.textBody }}>
                <option value="all">Everyone</option>
                {dialerNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}
          <span className="ml-auto font-bold tabular-nums" style={{ color: C.textBody }}>{rows.length} call{rows.length === 1 ? "" : "s"}</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border py-12 px-6 text-center max-w-xl mx-auto"
          style={{ backgroundColor: C.card, borderColor: C.border }}>
          <div className="w-12 h-12 mx-auto mb-3 rounded-2xl flex items-center justify-center" style={{ backgroundColor: C.surface }}>
            <Phone size={22} style={{ color: C.textDim }} />
          </div>
          <p className="text-sm font-bold mb-1.5" style={{ color: C.textPrimary }}>No calls in this view</p>
          <p className="text-xs leading-relaxed" style={{ color: C.textMuted }}>
            No {HIST_TABS.find(t => t.key === histClass)?.label.toLowerCase()} calls{(histFrom || histTo) ? " in this date range" : ""}.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(e => <CallHistoryRow key={e.id} e={e} />)}
        </div>
      )}
    </>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function QueueClient({ pendingCalls, newReplies, callHistory }: Props) {
  const searchParams = useSearchParams();
  // Deep-linked tab via `?tab=calls` / `?tab=inbox` / `?tab=history`. Per
  // boss feedback 2026-05-27, History is now the first tab — that's the
  // surface sellers want when they open Notifications (positive replies +
  // acceptances). Calls is second. Removed `?tab=reviews` / `?tab=updates`
  // — those tabs were deleted; bookmarks land on History.
  const initialTab = (() => {
    const t = searchParams.get("tab");
    if (t === "calls") return 1;
    if (t === "chat") return 2;
    return 0;
  })();
  const [tab, setTab] = useState(initialTab);
  // Sub-tabs inside "Calls":
  //   0 = To Call (no latestCall — never been dialed for this campaign step)
  //   1 = Awaiting Outcome (latestCall exists, classification null)
  //   2 = History (every classified call — Interested / Not interested / Bad
  //       timing / Wrong number — with date filters + recordings. Renamed from
  //       "Follow-ups" 2026-06-04 per boss: the team wants to review ALL calls
  //       made, not just the bad-timing ones queued for a redial.)
  const [callSubTab, setCallSubTab] = useState<0 | 1 | 2>(0);
  const [search, setSearch] = useState("");
  // History sub-tab: which outcome bucket (or "all") + the date window.
  const [histClass, setHistClass] = useState<HistClass>("all");
  const [histFrom, setHistFrom] = useState("");
  const [histTo, setHistTo] = useState("");
  // Filter History by who placed the call (boss 2026-06-09). "all" = everyone.
  const [histDialer, setHistDialer] = useState("all");

  // History tab manages its own date filter inside InboxView now (used to
  // be a toolbar dropdown here but it felt disconnected from the filter
  // chips in the sidebar). Calls tab ignores date — call work is
  // operational and shouldn't be hidden by an age cutoff.

  // Per-browser dismissal so a seller can clear notifications they've
  // already actioned without affecting other teammates. Stored in
  // localStorage as a set of "queue-dismissed-{id}" entries. Cleared on
  // logout (browser already drops localStorage on incognito close).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("swl-queue-dismissed");
      if (raw) setDismissed(new Set(JSON.parse(raw)));
    } catch { /* ignore */ }
  }, []);

  // Unread team-chat count → drives the "new activity" dot on the Team Chat tab.
  // Refetched on mount, on every tab switch (so it clears after reading), and
  // polled every 25s so a teammate's message lights the dot without a reload.
  const [chatUnread, setChatUnread] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const r = await fetch("/api/chat/threads", { cache: "no-store" });
        const d = await r.json();
        if (!cancelled) setChatUnread((d.threads ?? []).reduce((s: number, t: { unread?: number }) => s + (t.unread ?? 0), 0));
      } catch { /* ignore */ }
    };
    pull();
    const iv = setInterval(pull, 25000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [tab]);
  const dismiss = (id: string) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id);
      try { window.localStorage.setItem("swl-queue-dismissed", JSON.stringify(Array.from(next))); } catch { /* ignore */ }
      return next;
    });
  };
  const clearDismissed = () => {
    setDismissed(new Set());
    try { window.localStorage.removeItem("swl-queue-dismissed"); } catch { /* ignore */ }
  };

  // Split pending calls by classification state. Positive/negative would
  // already have dropped the entry from the queue (campaign ended).
  //
  // Sort logic per bucket:
  //   • To Call: most overdue first (so the call that's been waiting longest
  //     and likely blocking the sequence is at the top). Within ties, those
  //     marked overdue rank above non-overdue.
  //   • Awaiting Outcome: oldest call-attempt first (longest waiting for the
  //     seller to classify so the queue doesn't stack indefinitely).
  //   • Follow-ups: same as Awaiting Outcome (oldest first), so the lead
  //     deferred longest gets prioritized.
  const overduenessRank = (c: PendingCall) =>
    (c.isOverdue ? 1_000_000 : 0) + (c.overdueDays ?? 0);
  const callsToMake = pendingCalls
    .filter(c => !c.latestCall)
    .sort((a, b) => overduenessRank(b) - overduenessRank(a));
  // Awaiting Outcome = every call that was MADE but has no outcome logged yet
  // (Fran 2026-06-11). Sourced from the real call log (callHistory), not from
  // pendingCalls — a call needs classifying whether or not its campaign is still
  // parked at the call step. Same set as the History "Sin clasificar" bucket,
  // so the two always agree. Oldest first (longest waiting).
  const callsAwaitingOutcome = callHistory
    .filter(e => !e.classification)
    .sort((a, b) => {
      const at = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const bt = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return at - bt;
    });
  // Sort replies: positive / meeting_intent first (closing window!), then
  // any human-review-required, then everything else by most recent.
  const replyPriority = (r: NewReply) => {
    if (r.classification === "positive" || r.classification === "meeting_intent") return 0;
    if (r.requiresHumanReview) return 1;
    if (r.classification === "question") return 2;
    return 3;
  };
  const sortedReplies = [...newReplies].sort((a, b) => {
    const pa = replyPriority(a); const pb = replyPriority(b);
    if (pa !== pb) return pa - pb;
    return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
  });

  // Actionable reply count — mirrors InboxView's "Pending review" (isPending):
  // exclude events (accepted-connection / bounces) and already-resolved rows.
  // The tab badge + hero counts use THIS, not newReplies.length, so the number
  // matches what the seller actually has to work (was inflated by the synthetic
  // "Accepted Connection" entries, which live in neither Pending nor History).
  const REPLY_EVENT_CLASS = new Set(["connection_accepted", "email_bounced", "email_invalid"]);
  const isReplyEvent = (r: NewReply) => REPLY_EVENT_CLASS.has(r.classification ?? "");
  const pendingReplyCount = newReplies.filter(
    r => !isReplyEvent(r) && (r.requiresHumanReview || r.reviewStatus === "pending"),
  ).length;

  const totalCount = pendingCalls.length + pendingReplyCount;
  const needsReviewCount = newReplies.filter(r => r.requiresHumanReview).length;

  const applyCallSearch = (list: PendingCall[]) => !search ? list
    : list.filter(c => `${c.leadName} ${c.company} ${c.campaignName}`.toLowerCase().includes(search.toLowerCase()));

  const filteredCallsToMake = applyCallSearch(callsToMake);
  // Awaiting now holds CallHistoryEntry rows → its own search predicate.
  const filteredCallsAwaiting = !search ? callsAwaitingOutcome
    : callsAwaitingOutcome.filter(e => `${e.leadName} ${e.company ?? ""} ${e.sellerName ?? ""} ${e.dialedByName ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  // History tab gets the dismissal filter applied here at the QueueClient
  // level. Date + search + campaign/icp/channel filters live inside
  // InboxView so the seller can change them without round-tripping
  // through page state.
  const filteredReplies = sortedReplies.filter(r => !dismissed.has(r.id));

  // Notifications now only carries History + Calls. Boss feedback 2026-05-27:
  // History is first (sellers open Notifications to triage replies +
  // acceptances, not to start cold calls). Pending Reviews + Updates tabs
  // were deleted entirely. Today's Focus card was removed too.
  // `id` is the stable render index (0=replies, 1=calls, 2=chat) — used by the
  // tab===N render blocks and deep links. The array order is just the visual
  // order: conversations first (Replies, Team Chat), call queue last.
  const tabs = [
    { id: 0, label: "Lead Replies", count: pendingReplyCount,   color: C.blue,    reviewCount: needsReviewCount, dividerBefore: false, dot: false },
    { id: 2, label: "Team Chat",    count: 0,                    color: "#7C3AED", reviewCount: 0,                dividerBefore: false, dot: chatUnread > 0 },
    { id: 1, label: "Calls",        count: pendingCalls.length, color: "#F97316", reviewCount: 0,                dividerBefore: true,  dot: false },
  ];

  return (
    <div className="p-4 sm:p-6 w-full">
      <PageHero
        icon={Bell}
        section="Operations"
        title="Inbox"
        description="Review pending calls, new replies, and campaigns awaiting action."
        accentColor={C.orange}
        status={{ label: totalCount > 0 ? `${totalCount} pending` : "All Clear", active: totalCount > 0 }}
        stats={[
          { label: "Calls to make", value: pendingCalls.length, tone: pendingCalls.length > 0 ? "warning" : "neutral" },
          { label: "New replies", value: pendingReplyCount, tone: pendingReplyCount > 0 ? "positive" : "neutral" },
          { label: "Need review", value: needsReviewCount, tone: needsReviewCount > 0 ? "danger" : "neutral" },
        ]}
      />

      {/* Tabs + search */}
      <div className="flex items-center gap-1 border-b mb-6" style={{ borderColor: C.border }}>
        {tabs.map((t) => {
          const isActive = tab === t.id;
          return (
            <div key={t.label} className="flex items-center">
            {t.dividerBefore && <div className="w-px h-5 mx-1.5" style={{ backgroundColor: C.border }} />}
            <button onClick={() => setTab(t.id)}
              className="flex items-center gap-2 px-5 py-3 text-sm font-medium transition-[opacity,transform,box-shadow,background-color,border-color] relative"
              style={{ color: isActive ? t.color : C.textMuted }}>
              {t.label}
              {t.dot && (
                <span className="w-2 h-2 rounded-full" title="New activity"
                  style={{ backgroundColor: t.color, boxShadow: `0 0 0 3px color-mix(in srgb, ${t.color} 22%, transparent)` }} />
              )}
              {/* One badge: count + (if any) a ⚠N suffix for items needing
                  review — instead of two stacked pills competing per tab. */}
              {(t.count > 0 || t.reviewCount > 0) && (
                <span className="inline-flex items-center gap-1 text-xs font-bold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: isActive ? `${t.color}15` : C.surface, color: isActive ? t.color : C.textDim }}>
                  {t.count}
                  {t.reviewCount > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[10px]" style={{ color: "#D97706" }}>
                      <AlertTriangle size={9} /> {t.reviewCount}
                    </span>
                  )}
                </span>
              )}
              {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ backgroundColor: t.color }} />}
            </button>
            </div>
          );
        })}
        <div className="flex-1" />
        <div className="flex items-center gap-2 mb-1">
          {/* History manages its own filters (date, campaign, ICP, channel,
              search) inside the sidebar. Out here we only keep the
              "Restore dismissed" + the global search input for the Calls
              tab. */}
          {dismissed.size > 0 && tab !== 1 && (
            <button onClick={clearDismissed}
              className="text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors"
              style={{ borderColor: C.border, color: C.textMuted, backgroundColor: C.card }}
              title={`Restore ${dismissed.size} dismissed item${dismissed.size === 1 ? "" : "s"}`}>
              Restore {dismissed.size}
            </button>
          )}
          {tab === 1 && (
            <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5"
              style={{ borderColor: C.border, backgroundColor: C.card }}>
              <Search size={13} style={{ color: C.textDim }} />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search..." className="bg-transparent text-sm outline-none w-36"
                style={{ color: C.textPrimary }} />
              {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
            </div>
          )}
        </div>
      </div>

      {/* ═══ Tab 1: Calls (To Call / Awaiting Outcome / Follow-ups) ═══ */}
      {tab === 1 && (() => {
        // To Call uses the pendingCalls cards; Awaiting Outcome (subtab 1) now
        // renders the unclassified call-log rows in its own branch below.
        const activeList = filteredCallsToMake;
        const emptyCopy = callSubTab === 0
          ? {
              title: search ? "No calls match your search" : "No calls due right now",
              hint: search
                ? "Try clearing the search to see all pending calls."
                : "Calls show up here the moment a sequence reaches a call step. Nothing for you to do right now — good time to triage your inbox or check Flows.",
              ctaLabel: search ? null : "Open Inbox",
              ctaTab: null,
              ctaHref: "/inbox",
            }
          : callSubTab === 1
          ? {
              title: search ? "No calls match your search" : "Nothing to classify",
              hint: "Once you call a lead, it lands here until you log the outcome (Positive / Negative / Follow-up). Classifying calls is what keeps the AI's reply matching accurate.",
              ctaLabel: null,
              ctaTab: null,
              ctaHref: null,
            }
          : {
              title: search ? "No follow-ups match your search" : "No follow-ups waiting",
              hint: "Leads you marked Follow-up live here until you dial them again. Empty means you're caught up — back to To Call.",
              ctaLabel: "Back to To Call",
              ctaTab: 0 as 0,
              ctaHref: null,
            };

        return (
          <>
            {/* Sub-tab nav */}
            <div className="flex items-center gap-1 mb-4 rounded-lg border p-1 w-fit"
              style={{ borderColor: C.border, backgroundColor: C.card }}>
              {([
                { idx: 0 as const, label: "To Call",           count: callsToMake.length,           icon: PhoneCall },
                { idx: 1 as const, label: "Awaiting Outcome",  count: callsAwaitingOutcome.length,  icon: Clock     },
                { idx: 2 as const, label: "History",           count: callHistory.length,           icon: Phone     },
                // Awaiting Outcome count = unclassified calls in the log (same
                // as History's "Sin clasificar" bucket). Boss 2026-06-11.
              ]).map(s => {
                const active = callSubTab === s.idx;
                const Icon = s.icon;
                return (
                  <button key={s.idx} onClick={() => setCallSubTab(s.idx)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors"
                    style={{
                      backgroundColor: active ? "#F9731618" : "transparent",
                      color: active ? "#F97316" : C.textMuted,
                    }}>
                    <Icon size={11} /> {s.label}
                    {s.count > 0 && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-0.5"
                        style={{ backgroundColor: active ? "#F9731628" : C.surface, color: active ? "#F97316" : C.textDim }}>
                        {s.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {callSubTab === 2 ? (
              <CallHistoryPanel
                entries={callHistory}
                search={search}
                histClass={histClass}
                setHistClass={setHistClass}
                histFrom={histFrom}
                setHistFrom={setHistFrom}
                histTo={histTo}
                setHistTo={setHistTo}
                histDialer={histDialer}
                setHistDialer={setHistDialer}
              />
            ) : callSubTab === 1 ? (
              // Awaiting Outcome — every made-but-unclassified call, rich rows
              // (recording + transcript + classify) so the seller clears them
              // from one place. Once classified, the row drops out on next load.
              filteredCallsAwaiting.length === 0 ? (
                <div className="rounded-2xl border py-12 px-6 text-center max-w-xl mx-auto"
                  style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
                  <div className="w-12 h-12 mx-auto mb-3 rounded-2xl flex items-center justify-center"
                    style={{ backgroundColor: `color-mix(in srgb, ${C.green} 12%, transparent)` }}>
                    <CheckCircle size={22} style={{ color: C.green }} />
                  </div>
                  <p className="text-sm font-bold mb-1.5" style={{ color: C.textPrimary }}>{search ? "No calls match your search" : "Todo clasificado"}</p>
                  <p className="text-xs leading-relaxed" style={{ color: C.textMuted }}>
                    {search ? "Probá limpiar la búsqueda." : "Cada llamada que hagas cae acá hasta que registres el outcome (Interested / Bad timing / etc.). Clasificar mantiene los resultados y el matching de la IA correctos."}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredCallsAwaiting.map(e => <CallHistoryRow key={e.id} e={e} />)}
                </div>
              )
            ) : activeList.length === 0 ? (
              <div className="rounded-2xl border py-12 px-6 text-center max-w-xl mx-auto"
                style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
                <div className="w-12 h-12 mx-auto mb-3 rounded-2xl flex items-center justify-center"
                  style={{ backgroundColor: `color-mix(in srgb, ${C.green} 12%, transparent)` }}>
                  <CheckCircle size={22} style={{ color: C.green }} />
                </div>
                <p className="text-sm font-bold mb-1.5" style={{ color: C.textPrimary }}>{emptyCopy.title}</p>
                <p className="text-xs leading-relaxed" style={{ color: C.textMuted }}>{emptyCopy.hint}</p>
                {emptyCopy.ctaLabel && (emptyCopy.ctaTab !== null || emptyCopy.ctaHref) && (
                  <button onClick={() => {
                    if (emptyCopy.ctaHref) { router.push(emptyCopy.ctaHref); return; }
                    if (emptyCopy.ctaTab === 0) setCallSubTab(0);
                    else if (emptyCopy.ctaTab !== null) setTab(emptyCopy.ctaTab as number);
                  }}
                    className="inline-flex items-center gap-1.5 mt-4 text-xs font-semibold px-3.5 py-1.5 rounded-lg transition-opacity hover:opacity-85"
                    style={{ backgroundColor: gold, color: "#04070d" }}>
                    {emptyCopy.ctaLabel} <ChevronRight size={12} />
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {activeList.map(call => {
                  const urgency = classifyUrgency(call.isOverdue ? call.overdueDays ?? 0 : null);
                  const UIcon = urgency.icon;
                  const isEscalated = urgency.level === "critical" || urgency.level === "stuck";
                  // This card list now only renders for To Call (subtab 0);
                  // Awaiting Outcome has its own CallHistoryRow branch above.
                  const awaitingOutcome = false;
                  return (
                    <div key={call.id} className="rounded-2xl border transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-md" style={{ backgroundColor: C.card, borderColor: isEscalated ? urgency.border : C.border, borderLeftWidth: isEscalated ? 3 : 1, borderLeftColor: isEscalated ? urgency.color : undefined, boxShadow: "0 4px 16px rgba(0,0,0,0.04)" }}>
                      <div className="flex items-center gap-4 px-5 py-4">
                        {/* Avatar */}
                        <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
                          style={{ background: "linear-gradient(135deg, #F97316, #FB923C)", color: "#fff" }}>
                          <PhoneCall size={22} />
                        </div>

                        {/* Lead info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                            <Link href={call.leadId ? `/leads/${call.leadId}` : "#"}
                              className="text-sm font-bold hover:underline" style={{ color: C.textPrimary }}>
                              {call.leadName}
                            </Link>
                            {call.company && <span className="text-xs" style={{ color: C.textMuted }}>· {call.company}</span>}
                            {call.isOverdue && !awaitingOutcome && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: urgency.bg, color: urgency.color, border: `1px solid ${urgency.border}` }}>
                                <UIcon size={9} /> {urgency.label}
                              </span>
                            )}
                            {call.sellerName && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: "#EFF6FF", color: "#1D4ED8", border: "1px solid #BFDBFE" }}>
                                {call.sellerName}
                              </span>
                            )}
                            {call.callAdvanceMode === "manual" && (
                              <span title="Sequence frozen until the seller dials. No auto-advance."
                                className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                                style={{ backgroundColor: "color-mix(in srgb, #D97706 14%, transparent)", color: "#D97706", border: "1px solid color-mix(in srgb, #D97706 32%, transparent)" }}>
                                Manual gate
                              </span>
                            )}
                          </div>
                          {call.role && <p className="text-xs" style={{ color: C.textMuted }}>{call.role}</p>}
                          <p className="text-[10px] mt-1" style={{ color: C.textDim }}>
                            {call.campaignName} · Step {call.currentStep + 1}/{call.totalSteps}
                            {call.lastStepAt && <> · Last activity {timeAgo(call.lastStepAt)}</>}
                            {call.isOverdue && !awaitingOutcome && <> · {urgency.hint}</>}
                          </p>
                        </div>

                        {/* Actions — in "awaiting outcome" the Call button is
                            demoted to a small "Call again" link so the inline
                            classify buttons below become the primary action.
                            An "Open lead" button is added next to it (boss
                            feedback 2026-05-27 — sellers wanted an explicit
                            jump per row, not just the name link). */}
                        <div className="flex items-center gap-2 shrink-0 relative group/call">
                          {/* Wrong-number badge — only when the lead's
                              allow_call is false. Click → lead detail
                              (anchored at the top so the WrongNumberPill
                              is the first action the seller sees). */}
                          {call.leadId && call.phoneMarkedWrong === true && (
                            <Link
                              href={`/leads/${call.leadId}`}
                              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-opacity hover:opacity-85"
                              style={{
                                backgroundColor: "color-mix(in srgb, #DC2626 14%, transparent)",
                                color: "#DC2626",
                                border: "1px solid color-mix(in srgb, #DC2626 35%, transparent)",
                              }}
                              title="Phone marked wrong via post-call outcome. Open lead detail to replace."
                            >
                              <AlertTriangle size={11} />
                              Wrong number
                            </Link>
                          )}
                          {call.leadId && (
                            <Link
                              href={`/leads/${call.leadId}`}
                              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-opacity hover:opacity-80"
                              style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textBody }}
                              title="Open lead detail"
                            >
                              <User size={11} /> Open lead
                            </Link>
                          )}
                          {/* Open flow — jump straight to this call's campaign,
                              next to Open lead (boss 2026-06-10). */}
                          {call.campaignId && (
                            <Link
                              href={`/campaigns/${call.campaignId}`}
                              className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-opacity hover:opacity-80"
                              style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textBody }}
                              title="Open the flow this call belongs to"
                            >
                              <Megaphone size={11} /> Open flow
                            </Link>
                          )}
                          {call.leadId ? (() => {
                            // Build phones array so the seller can pick Mobile vs Work
                            // when the lead has both. Single-phone leads fall back to
                            // the `phone` prop and the picker stays hidden inside the
                            // CallButton component.
                            const phonesList = [
                              ...(call.phone ? [{ label: "Personal", value: call.phone }] : []),
                              ...(call.secondaryPhone ? [{ label: "Company", value: call.secondaryPhone }] : []),
                            ];
                            return awaitingOutcome ? (
                              <CallButton phone={call.phone ?? call.secondaryPhone ?? null} leadId={call.leadId} size="sm" variant="ghost" label="Call again" defaultNumberId={call.aircallNumberId ?? null} phones={phonesList} />
                            ) : (
                              <CallButton phone={call.phone ?? call.secondaryPhone ?? null} leadId={call.leadId} size="md" defaultNumberId={call.aircallNumberId ?? null} phones={phonesList} />
                            );
                          })() : (
                            <span className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-xs"
                              style={{ backgroundColor: C.surface, color: C.textDim }}>
                              <PhoneOff size={12} /> No lead linked
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Pre-call brief — inline, toggled (no overlapping popover) */}
                      <PreCallBrief talkingPoints={call.talkingPoints} />

                      {/* Inline classifier — shows in Awaiting Outcome with
                          the 3 outcome buttons. In To Call sub-tab it only
                          appears for entries with a follow-up logged. */}
                      <InlineClassifier call={call} />

                      {/* Footer bar */}
                      <div className="border-t px-5 py-3 flex items-center gap-4 rounded-b-xl"
                        style={{ borderColor: C.border, backgroundColor: C.bg }}>
                        <Link href={call.leadId ? `/leads/${call.leadId}` : "#"}
                          className="text-[10px] font-medium hover:underline flex items-center gap-1" style={{ color: gold }}>
                          <User size={10} /> Lead Profile
                        </Link>
                        <Link href={`/campaigns/${call.campaignId}`}
                          className="text-[10px] font-medium hover:underline flex items-center gap-1" style={{ color: gold }}>
                          <Megaphone size={10} /> Campaign
                        </Link>
                        {call.email && (
                          <span className="text-[10px] ml-auto" style={{ color: C.textDim }}>{call.email}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        );
      })()}

      {/* ═══ Tab 0: History (split-pane reply triage with keyboard shortcuts) ═══ */}
      {tab === 0 && (
        <InboxView
          replies={(sortedReplies as NewReply[]).map((r): InboxReply => ({
            id: r.id,
            leadId: r.leadId ?? "",
            leadName: r.leadName,
            company: r.company,
            campaignName: r.campaignName ?? null,
            icpProfileName: (r as any).icpProfileName ?? null,
            classification: r.classification,
            channel: r.channel,
            replyText: r.replyText,
            receivedAt: r.receivedAt,
            // Pass through the real persisted review_status. Falling back
            // to the derived value (pending / null) made History-tab
            // replies appear "not reviewed yet" even when they were —
            // and made the Mark-reviewed / Reject buttons always look
            // clickable, even on rows that had nothing left to do.
            reviewStatus: r.reviewStatus ?? (r.requiresHumanReview ? "pending" : null),
            requiresHumanReview: !!r.requiresHumanReview,
            positive: r.classification === "positive" || r.classification === "meeting_intent",
          }))}
        />
      )}

      {tab === 2 && <ChatPanel initialThreadId={searchParams.get("thread")} />}
    </div>
  );
}
