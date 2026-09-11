"use client";

// Lead hero — THREE clear levels with real breathing room (Fran 2026-09-11:
// "quedó demasiado bajo y comprimido"):
//   LEVEL 1  identity (name-first, stacked) · primary actions + separated nav
//   LEVEL 2  commercial context — grouped: status · owner · time · created ·
//            team · channels (badges only where semantic, icon+text elsewhere)
//   LEVEL 3  full-width 4-column metric strip
// Colour: Call = brand GOLD (primary); Email/LinkedIn/Set result = neutral;
// More = tertiary. Nav is its own group. No rainbow.
//
// The three lead states are DISTINCT concepts, shown so a seller never guesses:
//   • Lifecycle badge  = leads.status pipeline stage (e.g. "New")
//   • Score tier       = lead_score band (HOT / WARM / NURTURE + number)
//   • Recency          = "Added <date>" (the old standalone "NEW" pill was just
//                        a duplicate of the date, so it's folded into it)

import Link from "next/link";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { LinkedInIcon } from "@/components/SocialIcons";
import { Mail, Building2, ExternalLink, ChevronLeft, ChevronRight, Phone, CalendarPlus } from "lucide-react";
import CallButton from "@/components/CallButton";
import WrongNumberPill from "@/components/WrongNumberPill";
import LeadMoreMenu from "@/components/LeadMoreMenu";
import LeadSellerTags from "@/components/LeadSellerTags";
import ProspectClock from "@/components/ProspectClock";
import SetResultButton from "@/components/lead/SetResultButton";
import HeroNextAction, { type HeroNext } from "@/components/lead/HeroNextAction";

const gold = "var(--brand, #c9a83a)";

function isValidLinkedInUrl(url?: string | null): boolean {
  if (!url) return false;
  try { const u = new URL(url); return /(^|\.)linkedin\.com$/i.test(u.hostname) && /\/in\//.test(u.pathname); }
  catch { return false; }
}

type SeqNav = { prevId: string | null; nextId: string | null; index: number; total: number } | null;

// A grouped metadata segment for level 2 — a subtle uppercase label above its
// content, so each concept (owner, time, channels…) reads as its own unit.
function Group({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      {label && <span className="text-[9px] font-bold uppercase tracking-[0.1em]" style={{ color: C.textDim }}>{label}</span>}
      <div className="flex items-center gap-1.5 text-[12.5px]" style={{ color: C.textBody }}>{children}</div>
    </div>
  );
}

export default function LeadHero({
  lead, leadId, contactName, initials, avatarBg,
  statusLabel, statusColor, scoreLabel, scoreColor,
  campaign, seqNav, isCallStep, nextStepName, autoReplies,
  metrics, tz, place, localeTag,
  nextAction, terminalLead, canAssignActivities, leadCountry,
}: {
  lead: any; leadId: string; contactName: string; initials: string; avatarBg: string;
  statusLabel: string; statusColor: string; scoreLabel: string; scoreColor: string;
  campaign: any; seqNav: SeqNav; isCallStep: boolean; nextStepName?: string;
  autoReplies: { positive?: string; negative?: string } | null;
  nextAction: HeroNext; terminalLead: boolean; canAssignActivities: boolean; leadCountry: string | null;
  metrics: { messages: number; replies: number; positive: number; step: string };
  tz: string | null; place: string | null; localeTag: string;
}) {
  const { t } = useLocale();
  const liUrl = lead.primary_linkedin_url as string | null;
  const liOk = isValidLinkedInUrl(liUrl);
  const email = (lead.primary_work_email ?? lead.primary_personal_email) as string | null;
  const phone = (lead.primary_phone ?? lead.primary_secondary_phone) as string | null;
  const phones = [
    ...(lead.primary_phone ? [{ label: t("ld.personal"), value: lead.primary_phone }] : []),
    ...(lead.primary_secondary_phone ? [{ label: t("ld.phoneCompany"), value: lead.primary_secondary_phone }] : []),
  ];
  const isNew = lead.created_at && (Date.now() - new Date(lead.created_at).getTime() < 7 * 86_400_000);
  const secBtn = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold border transition-colors hover:bg-black/[0.03]";

  const channels = [
    { key: "allow_linkedin", label: "LinkedIn", icon: <LinkedInIcon size={13} />, ok: liOk },
    { key: "allow_email", label: t("chan.email"), icon: <Mail size={13} />, ok: !!email },
    { key: "allow_call", label: t("chan.call"), icon: <Phone size={13} />, ok: !!phone },
  ];
  // Only channels that are allowed but have NO underlying data (dispatch would
  // fail) — the healthy ones are already the action buttons above.
  const brokenChannels = channels.filter(ch => lead[ch.key] !== false && !ch.ok);

  const metricCells = [
    { label: t("ld2.metric.messages"), value: metrics.messages },
    { label: t("ld2.metric.replies"), value: metrics.replies },
    { label: t("ld2.metric.positive"), value: metrics.positive, tone: metrics.positive > 0 ? C.green : undefined },
    { label: t("ld2.metric.step"), value: metrics.step },
  ];

  return (
    <div className="rounded-2xl border mb-5 relative overflow-hidden reveal"
      style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: C.shadow }}>
      <div className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: `linear-gradient(90deg, transparent, ${gold} 30%, color-mix(in srgb, ${gold} 72%, white) 50%, ${gold} 70%, transparent)` }} />

      {/* ── LEVEL 1 — identity + primary actions ── */}
      <div className="px-4 sm:px-5 pt-5 pb-4 flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center text-lg sm:text-xl font-bold text-white shrink-0"
            style={{ background: `linear-gradient(135deg, ${avatarBg}, color-mix(in srgb, ${avatarBg} 75%, white))`, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
            {initials}
          </div>
          <div className="min-w-0">
            <h1 className="text-[21px] sm:text-[24px] font-bold leading-tight"
              style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
              {lead.primary_first_name} {lead.primary_last_name}
            </h1>
            <p className="text-[13.5px] mt-0.5" style={{ color: C.textMuted }}>{lead.primary_title_role ?? "—"}</p>
            {lead.company_name && (
              <Link href={`/companies/${encodeURIComponent(lead.company_name)}?fromLead=${leadId}`}
                className="inline-flex items-center gap-1.5 text-[13px] mt-1 hover:underline" style={{ color: C.blue }}>
                <Building2 size={13} className="shrink-0" style={{ color: C.textDim }} />
                <span className="truncate max-w-[280px]">{lead.company_name}</span>
                <ExternalLink size={11} className="shrink-0" style={{ opacity: 0.6 }} />
              </Link>
            )}
          </div>
        </div>

        {/* actions + separated nav */}
        <div className="flex items-center gap-2 flex-wrap xl:justify-end shrink-0">
          {phone && (
            lead.allow_call === false
              ? <WrongNumberPill leadId={leadId} currentPhone={phone} />
              : <CallButton phone={phone} leadId={leadId} size="sm" accent={gold} pulse={false} defaultNumberId={campaign?.aircall_number_id ?? null}
                  phones={phones} isCallStep={isCallStep} nextStepName={nextStepName} />
          )}
          {email && (
            <a href={`mailto:${email}`} className={secBtn} style={{ borderColor: C.border, color: C.textBody }} title={email}>
              <Mail size={14} style={{ color: C.email }} /> {t("chan.email")}
            </a>
          )}
          {liOk && (
            <a href={liUrl!} target="_blank" rel="noreferrer" className={secBtn} style={{ borderColor: C.border, color: C.textBody }} title="LinkedIn">
              <LinkedInIcon size={14} /> LinkedIn
            </a>
          )}
          <SetResultButton leadId={leadId} autoReplies={autoReplies} size="sm" />
          <LeadMoreMenu leadId={leadId} leadName={contactName} campaignId={campaign?.id ?? null} autoReplies={autoReplies} />
          {seqNav && (
            <>
              <span className="hidden xl:inline-block h-6 w-px mx-1" style={{ backgroundColor: C.border }} aria-hidden />
              <div className="inline-flex items-center rounded-lg border overflow-hidden" style={{ borderColor: C.border }}>
                {seqNav.prevId
                  ? <Link href={`/leads/${seqNav.prevId}`} title={t("ld.prevLead")} className="inline-flex items-center px-2 py-2 hover:bg-black/[0.04]" style={{ color: C.textBody }}><ChevronLeft size={15} /></Link>
                  : <span className="inline-flex items-center px-2 py-2" style={{ color: C.textDim, opacity: 0.4 }}><ChevronLeft size={15} /></span>}
                <span className="px-2 text-[11px] font-semibold tabular-nums border-x" style={{ color: C.textMuted, borderColor: C.border }}>{seqNav.index}/{seqNav.total}</span>
                {seqNav.nextId
                  ? <Link href={`/leads/${seqNav.nextId}`} title={t("ld.nextLead")} className="inline-flex items-center px-2 py-2 hover:bg-black/[0.04]" style={{ color: C.textBody }}><ChevronRight size={15} /></Link>
                  : <span className="inline-flex items-center px-2 py-2" style={{ color: C.textDim, opacity: 0.4 }}><ChevronRight size={15} /></span>}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── LEVEL 2 — sales context + NEXT ACTION ── */}
      <div className="px-4 sm:px-5 py-3 border-t flex items-center gap-x-6 gap-y-3 flex-wrap"
        style={{ borderColor: C.border, backgroundColor: C.bg }}>
        {/* Next action — the highest-priority context (reuses server-seeded activities) */}
        <HeroNextAction nextAction={nextAction} leadId={leadId} leadLabel={contactName} company={lead.company_name ?? null}
          leadPhone={phone} leadCountry={leadCountry} terminalLead={terminalLead} canAssignActivities={canAssignActivities} localeTag={localeTag} />

        <span className="hidden sm:inline-block h-8 w-px self-center" style={{ backgroundColor: C.border }} aria-hidden />

        {/* Status — one lifecycle badge + score tier (distinct concepts) */}
        <Group label={t("ld2.stage")}>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold rounded-full px-2.5 py-0.5"
            style={{ color: statusColor, backgroundColor: `color-mix(in srgb, ${statusColor} 14%, transparent)` }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} /> {statusLabel}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold ml-1" style={{ color: C.textMuted }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: scoreColor }} /> {scoreLabel}
          </span>
        </Group>

        {lead.assigned_seller && (
          <Group label={t("pulse.col.seller")}>
            <span className="w-4 h-4 rounded-full flex items-center justify-center text-white font-bold" style={{ backgroundColor: gold, fontSize: 9 }}>{lead.assigned_seller[0]}</span>
            {lead.assigned_seller}
          </Group>
        )}

        {(tz || place) && (
          <Group label={t("ld2.localTime")}>
            {tz ? <ProspectClock tz={tz} place={place} /> : <span style={{ color: C.textMuted }}>{place}</span>}
          </Group>
        )}

        {/* Channel availability — only WARN about allowed-but-missing channels
            (dispatch would fail); the happy path is already the Email/LinkedIn/
            Call buttons above, so we don't duplicate healthy channels. */}
        {brokenChannels.length > 0 && (
          <Group label={t("ld2.channelWarn")}>
            <span className="inline-flex items-center gap-1">
              {brokenChannels.map(ch => (
                <span key={ch.key} title={`${ch.label}: no data — dispatch will fail`}
                  className="w-6 h-6 rounded-full grid place-items-center border"
                  style={{ color: C.orange, borderColor: `color-mix(in srgb, ${C.orange} 32%, transparent)`, backgroundColor: `color-mix(in srgb, ${C.orange} 10%, transparent)` }}>
                  {ch.icon}
                </span>
              ))}
            </span>
          </Group>
        )}

        {/* Tertiary: Added date + teammate tags, right-aligned + low prominence */}
        <div className="lg:ml-auto flex items-center gap-3">
          {lead.created_at && (
            <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: C.textDim }}>
              <CalendarPlus size={11} /> {t("ld2.added").toLowerCase()} {new Date(lead.created_at).toLocaleDateString(localeTag, { day: "numeric", month: "short" })}
              {isNew && <span className="text-[8.5px] font-bold uppercase tracking-wider px-1 py-0.5 rounded" style={{ backgroundColor: `color-mix(in srgb, ${gold} 16%, transparent)`, color: "#8a6b18" }}>{t("ld2.newLead")}</span>}
            </span>
          )}
          <LeadSellerTags leadId={leadId} compact />
        </div>
      </div>

      {/* ── LEVEL 3 — full-width metric strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px border-t" style={{ backgroundColor: C.border, borderColor: C.border }}>
        {metricCells.map((m, i) => (
          <div key={i} className="px-4 py-2.5" style={{ backgroundColor: C.card }}>
            <p className="text-[19px] font-bold tabular-nums leading-none" style={{ color: m.tone ?? C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{m.value}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider mt-1" style={{ color: C.textMuted }}>{m.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
