"use client";

// Calls sub-view for the Engagement tab. Was a bare "N calls recorded" line + a
// stack of always-expanded CallCards (a wall). Now: a stats band (connect rate,
// avg duration, avg coach) computed from the real rows, and each call as a
// scannable collapsible row — direction + outcome + coach at a glance, the full
// detail (transcript / recording / AI summary / classifier / coach) on expand
// via <CallCard hideHeader/>. No invented data: a stat is omitted when its
// source rows are absent.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { intlTag } from "@/lib/i18n-locale";
import {
  Phone, PhoneOutgoing, PhoneIncoming, PhoneMissed, ChevronDown, Trash2, Loader2,
} from "lucide-react";
import CallCard, { type CallRecord } from "@/components/CallCard";
import CallButton from "@/components/CallButton";
import SyncAircallButton from "@/components/SyncAircallButton";
import { EmptyLine } from "@/components/lead/ui";

const gold = "var(--brand, #c9a83a)";

// Outcome badge — mirrors CallClassifier's wire values + palette + label keys.
const clfMeta: Record<string, { labelKey: string; color: string }> = {
  positive:     { labelKey: "clf.interested",    color: "#16A34A" },
  negative:     { labelKey: "clf.notInterested", color: C.red },
  follow_up:    { labelKey: "clf.badTiming",     color: "#D97706" },
  voicemail:    { labelKey: "clf.voicemail",     color: "#0EA5E9" },
  wrong_number: { labelKey: "clf.wrongNumber",   color: C.textMuted },
};

const statusColor: Record<string, string> = {
  answered: C.green, initiated: C.orange, missed: C.red, voicemail: C.textMuted,
};

function fmtDur(sec: number | null | undefined): string | null {
  if (!sec && sec !== 0) return null;
  if (sec <= 0) return null;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function coachColor(score: number): string {
  if (score >= 70) return C.green;
  if (score >= 40) return C.orange;
  return C.red;
}

export default function CallsPanel({
  calls, leadId, phone, phones, defaultNumberId, isCallStep, nextStepName,
  personalPhone, companyPhone,
}: {
  calls: CallRecord[];
  leadId: string;
  phone: string | null;
  phones: { label: string; value: string }[];
  defaultNumberId: number | null;
  isCallStep: boolean;
  nextStepName?: string;
  personalPhone: string | null;
  companyPhone: string | null;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const tag = intlTag(locale);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<string | null>(null);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  async function del(id: string) {
    if (deleting) return;
    if (!confirm(t("callCard.deleteConfirm"))) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/calls/${id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setDeleting(null);
    }
  }

  // ── Stats (real data only) ──
  const total = calls.length;
  const answered = calls.filter((c) => c.status === "answered").length;
  const durations = calls.filter((c) => c.status === "answered" && c.duration && c.duration > 0).map((c) => c.duration as number);
  const avgDur = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
  const coaches = calls.filter((c) => typeof c.coach_score === "number").map((c) => c.coach_score as number);
  const avgCoach = coaches.length ? Math.round(coaches.reduce((a, b) => a + b, 0) / coaches.length) : null;

  const stats: { label: string; value: string; tone?: string }[] = [
    { label: t("ld2.calls.total"), value: String(total) },
    ...(total > 0 ? [{ label: t("ld2.calls.connected"), value: `${Math.round((answered / total) * 100)}%`, tone: C.green }] : []),
    ...(avgDur != null ? [{ label: t("ld2.calls.avgDuration"), value: fmtDur(avgDur) as string }] : []),
    ...(avgCoach != null ? [{ label: t("ld2.calls.avgCoach"), value: String(avgCoach), tone: coachColor(avgCoach) }] : []),
  ];

  return (
    <div className="space-y-3">
      {/* Stats band + actions */}
      <div className="rounded-xl border flex flex-wrap items-stretch overflow-hidden" style={{ borderColor: C.border, backgroundColor: C.surface }}>
        {stats.map((s, i) => (
          <div key={s.label} className="px-4 py-2.5 flex-1 min-w-[92px]"
            style={{ borderLeft: i === 0 ? undefined : `1px solid ${C.border}` }}>
            <p className="text-[19px] font-bold leading-none tabular-nums" style={{ color: s.tone ?? C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{s.value}</p>
            <p className="text-[10px] uppercase tracking-wide mt-1.5" style={{ color: C.textMuted }}>{s.label}</p>
          </div>
        ))}
        <div className="flex items-center gap-2 px-3 ml-auto">
          {phone && <CallButton phone={phone} leadId={leadId} size="sm" defaultNumberId={defaultNumberId} phones={phones} isCallStep={isCallStep} nextStepName={nextStepName} />}
          <SyncAircallButton />
        </div>
      </div>

      {/* Collapsible call rows */}
      {calls.length === 0 ? (
        <EmptyLine><Phone size={14} /> {t("ld.noCalls")}</EmptyLine>
      ) : (
        <div className="space-y-2">
          {calls.map((call) => {
            const isOpen = open.has(call.id);
            const st = call.status ?? "initiated";
            const missed = st === "missed" || st === "voicemail";
            const Icon = missed ? PhoneMissed : call.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
            const iconColor = statusColor[st] ?? C.textMuted;
            const dur = fmtDur(call.duration);
            const clf = call.classification ? clfMeta[call.classification] : null;
            const dateLabel = call.started_at
              ? new Date(call.started_at).toLocaleString(tag, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
              : null;

            return (
              <div key={call.id} className="rounded-xl border overflow-hidden" style={{ borderColor: C.border, backgroundColor: C.card }}>
                <button type="button" onClick={() => toggle(call.id)}
                  className="w-full flex items-center gap-3 px-3.5 py-3 text-left transition-colors hover:opacity-90">
                  <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0"
                    style={{ backgroundColor: `color-mix(in srgb, ${iconColor} 14%, transparent)`, color: iconColor }}>
                    <Icon size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold" style={{ color: C.textPrimary }}>
                        {t(call.direction === "inbound" ? "callCard.inboundCall" : "callCard.outboundCall")}
                      </span>
                      {clf ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: `color-mix(in srgb, ${clf.color} 15%, transparent)`, color: clf.color }}>
                          {t(clf.labelKey)}
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse"
                          style={{ backgroundColor: C.redLight, color: C.red }}>
                          {t("callCard.needsReview")}
                        </span>
                      )}
                    </div>
                    <p className="text-[11.5px] mt-0.5 truncate" style={{ color: C.textMuted }}>
                      {[dateLabel, dur].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {typeof call.coach_score === "number" && (
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-md shrink-0"
                      style={{ backgroundColor: `color-mix(in srgb, ${coachColor(call.coach_score)} 14%, transparent)`, color: coachColor(call.coach_score) }}>
                      {t("coach.score")} {call.coach_score}
                    </span>
                  )}
                  <button type="button" onClick={(e) => { e.stopPropagation(); del(call.id); }}
                    disabled={deleting === call.id} aria-label={t("callCard.deleteCall")} title={t("callCard.deleteCall")}
                    className="p-1.5 rounded transition-colors disabled:opacity-50 shrink-0"
                    style={{ color: C.textDim }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = C.red; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = C.textDim; }}>
                    {deleting === call.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                  <ChevronDown size={16} className="shrink-0 transition-transform" style={{ color: C.textMuted, transform: isOpen ? "rotate(180deg)" : "none" }} />
                </button>
                {isOpen && (
                  <div className="px-3.5 pb-3.5 pt-0 border-t" style={{ borderColor: C.border }}>
                    <CallCard call={call} hideHeader personalPhone={personalPhone} companyPhone={companyPhone} />
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
