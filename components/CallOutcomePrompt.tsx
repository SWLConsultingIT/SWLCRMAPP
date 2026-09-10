"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ThumbsUp, ThumbsDown, Calendar, PhoneOff, Check, Voicemail, FileText, RotateCcw, UserPlus, ArrowRight, PhoneMissed, Inbox as InboxIcon, Plus } from "lucide-react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import WhenScheduler, { type WhenValue } from "@/components/WhenScheduler";
import ActivityComposer from "@/components/ActivityComposer";
import { browserTimeZone, wallTimeToUtcIso } from "@/lib/activities";

// Post-call outcome prompt. Lifted OUT of CallButton and driven by
// AircallPhoneProvider so it ALWAYS appears when a call ends — regardless of
// which page the seller is on or whether the originating CallButton is still
// mounted.
//
// L-8 (2026-08-15): one screen, 7 outcomes, a free observation available on
// ANY of them (not just pos/neg), and — for "Call back" — an inline recall
// date/time (L-9). Each outcome → /api/leads/[id]/call-outcome maps to a
// concrete CRM action; see that route for the side effects.
type Outcome = "interested" | "meeting" | "info" | "callback" | "voicemail" | "not_interested" | "other_person" | "wrong_number" | "no_contact_established" | "mailbox_full";

// Default recall = tomorrow 10:00, local.
function defaultCallbackDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CallOutcomePrompt({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const router = useRouter();
  const { t } = useLocale();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [note, setNote] = useState("");
  // Callback scheduling — one shared value driven by <WhenScheduler>. Default:
  // tomorrow 10:00 in the seller's tz, reminder 10 min before.
  const [when, setWhen] = useState<WhenValue>(() => {
    const tz = browserTimeZone();
    return { date: defaultCallbackDate(), time: "10:00", tz, reminderOffset: "10" };
  });
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // L-10 — prefetch the next lead to work in this flow so "Save & next" can
  // jump straight there without a round-trip through the list.
  const [nextLeadId, setNextLeadId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/leads/${leadId}/next-in-campaign`, { cache: "no-store" })
      .then(r => r.json())
      .then((d: { next?: { leadId?: string } | null }) => { if (alive) setNextLeadId(d?.next?.leadId ?? null); })
      .catch(() => {});
    return () => { alive = false; };
  }, [leadId]);

  const OPTS: { v: Outcome; label: string; desc: string; icon: typeof ThumbsUp; color: string }[] = [
    { v: "interested",     label: t("callOutcome.interested"),    desc: t("callOutcome.book"),            icon: ThumbsUp,   color: C.green },
    { v: "meeting",        label: t("callOutcome.meeting"),       desc: t("callOutcome.meetingDesc"),     icon: Calendar,   color: C.green },
    { v: "info",           label: t("callOutcome.info"),          desc: t("callOutcome.infoDesc"),        icon: FileText,   color: "#0EA5E9" },
    { v: "callback",       label: t("callOutcome.callback"),      desc: t("callOutcome.callbackDesc"),    icon: RotateCcw,  color: "#D97706" },
    { v: "voicemail",      label: t("callOutcome.voicemail"),     desc: t("callOutcome.voicemailDesc"),   icon: Voicemail,  color: "#7A8199" },
    { v: "not_interested", label: t("callOutcome.notInterested"), desc: t("callOutcome.close"),           icon: ThumbsDown, color: C.red },
    { v: "other_person",   label: t("callOutcome.otherPerson"),   desc: t("callOutcome.otherPersonDesc"), icon: UserPlus,   color: "#8B5CF6" },
    { v: "wrong_number",   label: t("callOutcome.wrongNumber"),   desc: t("callOutcome.wrongNumberDesc"), icon: PhoneOff,   color: C.textMuted },
    { v: "no_contact_established", label: t("callOutcome.noContact"),   desc: t("callOutcome.noContactDesc"),   icon: PhoneMissed, color: "#7A8199" },
    { v: "mailbox_full",   label: t("callOutcome.mailboxFull"),   desc: t("callOutcome.mailboxFullDesc"), icon: InboxIcon,  color: "#7A8199" },
  ];

  // Outcomes that SUGGEST (never auto-create) a next step after saving.
  const SUGGESTS: ReadonlySet<Outcome> = new Set(["interested", "info", "voicemail", "other_person", "no_contact_established", "mailbox_full"]);

  async function submit() {
    if (!outcome || classifying) return;
    setClassifying(true);
    setErr(null);
    try {
      const isCallback = outcome === "callback";
      const callbackAt = isCallback ? (wallTimeToUtcIso(when.date, when.time || "10:00", when.tz) ?? undefined) : undefined;
      const r = await fetch(`/api/leads/${leadId}/call-outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome,
          note: note.trim() || undefined,
          callbackAt,
          callbackTz: isCallback ? when.tz : undefined,
          reminderOffset: isCallback ? (when.reminderOffset === "" ? null : Number(when.reminderOffset)) : undefined,
        }),
      });
      if (!r.ok) {
        const { error } = await r.json().catch(() => ({ error: null }));
        setErr(error || t("callOutcome.errLog"));
        return;
      }
      router.refresh();
      // Suggested next step (only when we're NOT auto-jumping a call list) →
      // keep the modal open on a light "what's next?" screen. Otherwise keep the
      // existing fast flow: jump to the next lead, or confirm-and-close.
      if (SUGGESTS.has(outcome) && !nextLeadId) {
        setSaved(true);
      } else if (nextLeadId) {
        router.push(`/leads/${nextLeadId}`);
        onClose();
      } else {
        setSaved(true);
        window.setTimeout(onClose, 900);
      }
    } catch {
      setErr(t("callOutcome.errNetwork"));
    } finally {
      setClassifying(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out]"
      style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
    >
      {/* Mandatory (boss 2026-08-27): no backdrop-close, no X, no Skip — the
          seller must register a call outcome before moving on. The
          voicemail / wrong-number / other-person options are the valid
          escape hatches when the call didn't really connect. */}
      <div
        className="rounded-2xl border shadow-2xl p-5 relative"
        style={{
          backgroundColor: C.card,
          borderColor: `color-mix(in srgb, ${C.gold} 35%, ${C.border})`,
          boxShadow: "0 24px 60px -16px rgba(0,0,0,0.4)",
          width: 460,
          maxWidth: "calc(100vw - 3rem)",
        }}
      >
        {saved ? (
          <div className="flex flex-col items-center justify-center py-6 gap-3">
            <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, ${C.green} 14%, transparent)` }}>
              <Check size={22} style={{ color: C.green }} />
            </div>
            <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{t("callOutcome.logged")}</p>
            {outcome && SUGGESTS.has(outcome) && (
              <div className="w-full flex flex-col items-center gap-2 mt-1">
                <p className="text-[11px]" style={{ color: C.textMuted }}>{t("callOutcome.whatsNext")}</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setSuggestOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-bold" style={{ background: `linear-gradient(135deg, ${C.gold}, color-mix(in srgb, ${C.gold} 70%, white))`, color: "#1A1505" }}>
                    <Plus size={13} /> {t("callOutcome.scheduleFollowup")}
                  </button>
                  <button onClick={onClose} className="rounded-lg px-3 py-2 text-[12px] font-semibold" style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.textMuted }}>{t("callOutcome.done")}</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.gold, letterSpacing: "0.18em" }}>
              {t("callOutcome.howEyebrow")}
            </p>
            <p className="text-sm font-semibold mb-3 pr-6" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>
              {t("callOutcome.title")}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {OPTS.map(opt => {
                const OptIcon = opt.icon;
                const sel = outcome === opt.v;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    disabled={classifying}
                    onClick={() => setOutcome(opt.v)}
                    aria-pressed={sel}
                    className="flex flex-col items-start gap-0.5 px-2.5 py-2 rounded-lg border text-left transition-all hover:opacity-90 disabled:opacity-50"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${opt.color} ${sel ? 18 : 9}%, transparent)`,
                      color: opt.color,
                      borderColor: sel ? opt.color : `color-mix(in srgb, ${opt.color} 30%, transparent)`,
                      boxShadow: sel ? `0 0 0 2px ${C.gold}` : "none",
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <OptIcon size={13} />
                      <span className="text-[12px] font-semibold">{opt.label}</span>
                    </div>
                    <span className="text-[10px] opacity-80">{opt.desc}</span>
                  </button>
                );
              })}
            </div>

            {outcome === "callback" && (
              <div className="mt-3 rounded-lg border p-3" style={{ borderColor: "color-mix(in srgb, #D97706 45%, transparent)", backgroundColor: "color-mix(in srgb, #D97706 8%, transparent)" }}>
                <p className="text-[11px] font-semibold mb-2 flex items-center gap-1.5" style={{ color: "#D97706" }}>
                  <Calendar size={12} /> {t("callOutcome.callbackWhen")}
                </p>
                <WhenScheduler value={when} onChange={setWhen} />
              </div>
            )}

            <div className="mt-3">
              <label className="text-[9px] uppercase tracking-wider block mb-1.5" style={{ color: C.textDim }}>{t("callOutcome.note")}</label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={t("callOutcome.notePlaceholder")}
                rows={2}
                className="w-full rounded-lg border px-3 py-2 text-[12px] resize-y outline-none focus:ring-2"
                style={{ backgroundColor: C.surface, borderColor: C.border, color: C.textPrimary }}
              />
            </div>

            {err && <p className="text-[11px] mt-2" style={{ color: C.red }}>{err}</p>}

            <div className="mt-4">
              <button
                type="button"
                disabled={!outcome || classifying}
                onClick={submit}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-[12px] font-bold transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: `linear-gradient(135deg, ${C.gold}, color-mix(in srgb, ${C.gold} 70%, white))`, color: "#1A1505" }}
              >
                {classifying ? <Loader2 size={13} className="animate-spin" /> : null}
                {nextLeadId ? t("callOutcome.saveNext") : t("callOutcome.saveResult")}
                {nextLeadId && !classifying ? <ArrowRight size={13} /> : null}
              </button>
              {!outcome && (
                <p className="text-[10.5px] text-center mt-2" style={{ color: C.textDim }}>
                  {t("callOutcome.required")}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Suggested follow-up — opens the universal composer (createActivity),
          lead + source known, so the seller only picks When/Note. Optional. */}
      {suggestOpen && (
        <ActivityComposer
          mode="modal"
          open
          context={{ leadId, type: "follow_up", source: "call_outcome" }}
          onClose={() => { setSuggestOpen(false); onClose(); }}
          onCreated={() => { setSuggestOpen(false); onClose(); }}
        />
      )}
    </div>
  );
}
