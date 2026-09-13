"use client";

// Lead hero — SELLER COMMAND CARD (Fran 2026-09-11: "muy horizontal, estático,
// parecido a una tabla"). Composition, not three equal bars:
//   TOP     identity (left)  ·  primary actions + separated nav (right)
//   BODY    NEXT ACTION module (differentiated surface, the heart) beside a
//           compact commercial context (plain text, no cards)
//   FOOTER  one-line metric strip (secondary context, not a dashboard)
// Hierarchy: Identity › Action › Next Action › Context › Performance.
// Colour: Call = GOLD primary; Next Action surface = urgency colour; the rest
// neutral. No rainbow. Same props / same data — zero new queries.
//
// The three lead signals stay DISTINCT: lifecycle badge (leads.status) · score
// tier (lead_score band) · recency ("Added <date>", the standalone NEW pill was
// a duplicate of the date, so it's gone).

import Link from "next/link";
import { C } from "@/shared/design/tokens";
import { useLocale } from "@/shared/i18n/i18n";
import { LinkedInIcon } from "@/shared/ui/SocialIcons";
import { Mail, Building2, ExternalLink, ChevronLeft, ChevronRight, Phone, CalendarPlus, Clock } from "lucide-react";
import CallButton from "@/components/CallButton";
import WrongNumberPill from "@/components/WrongNumberPill";
import LeadMoreMenu from "@/components/LeadMoreMenu";
import LeadSellerTags from "@/components/LeadSellerTags";
import ProspectClock from "@/components/ProspectClock";
import SetResultButton from "@/components/lead/SetResultButton";
import HeroNextAction, { type HeroNext } from "@/features/activities/components/HeroNextAction";

const gold = "var(--brand, #c9a83a)";

function isValidLinkedInUrl(url?: string | null): boolean {
  if (!url) return false;
  try { const u = new URL(url); return /(^|\.)linkedin\.com$/i.test(u.hostname) && /\/in\//.test(u.pathname); }
  catch { return false; }
}

type SeqNav = { prevId: string | null; nextId: string | null; index: number; total: number } | null;

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
  const secBtn = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold border transition-colors hover:bg-black/[0.03]";

  const channels = [
    { key: "allow_linkedin", label: "LinkedIn", icon: <LinkedInIcon size={12} />, ok: liOk },
    { key: "allow_email", label: t("chan.email"), icon: <Mail size={12} />, ok: !!email },
    { key: "allow_call", label: t("chan.call"), icon: <Phone size={12} />, ok: !!phone },
  ];
  // Only channels allowed but with NO underlying data (dispatch would fail); the
  // healthy ones are already the action buttons above, so we don't repeat them.
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

      {/* ── TOP — identity + primary actions ── */}
      <div className="px-4 sm:px-5 pt-5 pb-4 flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div className="w-14 h-14 sm:w-[60px] sm:h-[60px] rounded-2xl flex items-center justify-center text-lg sm:text-xl font-bold text-white shrink-0"
            style={{ background: `linear-gradient(135deg, ${avatarBg}, color-mix(in srgb, ${avatarBg} 75%, white))`, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
            {initials}
          </div>
          <div className="min-w-0">
            <h1 className="text-[22px] sm:text-[25px] font-bold leading-tight"
              style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
              {lead.primary_first_name} {lead.primary_last_name}
            </h1>
            <p className="text-[14px] mt-1" style={{ color: C.textMuted }}>{lead.primary_title_role ?? "—"}</p>
            {lead.company_name && (
              <Link href={`/companies/${encodeURIComponent(lead.company_name)}?fromLead=${leadId}`}
                className="inline-flex items-center gap-1.5 text-[13px] mt-1.5 hover:underline" style={{ color: C.blue }}>
                <Building2 size={13} className="shrink-0" style={{ color: C.textDim }} />
                <span className="truncate max-w-[280px]">{lead.company_name}</span>
                <ExternalLink size={11} className="shrink-0" style={{ opacity: 0.6 }} />
              </Link>
            )}
          </div>
        </div>

        {/* actions + separated nav */}
        <div className="flex items-center gap-2 flex-wrap md:justify-end shrink-0">
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
              <span className="hidden md:inline-block h-6 w-px mx-1" style={{ backgroundColor: C.border }} aria-hidden />
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

      {/* ── BODY — NEXT ACTION (heart) + commercial context ── */}
      <div className="px-4 sm:px-5 pt-4 pb-4 border-t grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-4 xl:gap-5"
        style={{ borderColor: C.border }}>
        <HeroNextAction nextAction={nextAction} leadId={leadId} leadLabel={contactName} company={lead.company_name ?? null}
          leadPhone={phone} leadCountry={leadCountry} terminalLead={terminalLead} canAssignActivities={canAssignActivities} localeTag={localeTag} />

        {/* Commercial context — plain text, no cards; row-wrap when stacked, column beside Next Action */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 xl:flex-col xl:items-start xl:justify-center xl:gap-2.5 border-t xl:border-t-0 pt-3 xl:pt-0"
          style={{ borderColor: C.border }}>
          {/* Stage · Tier — distinct concepts, one coherent line */}
          <div className="inline-flex items-center gap-2 text-[13px]">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
            <span className="font-bold" style={{ color: C.textPrimary }}>{statusLabel}</span>
            <span style={{ color: C.textDim }}>·</span>
            <span className="inline-flex items-center gap-1 font-semibold" style={{ color: C.textMuted }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: scoreColor }} /> {scoreLabel}
            </span>
          </div>

          {lead.assigned_seller && (
            <div className="inline-flex items-center gap-2 text-[13px]" style={{ color: C.textBody }}>
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-white font-bold shrink-0" style={{ backgroundColor: gold, fontSize: 10, color: "#231b03" }}>{lead.assigned_seller[0]}</span>
              {lead.assigned_seller}
            </div>
          )}

          {(tz || place) && (
            <div className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: C.textBody }}>
              <Clock size={13} style={{ color: C.textMuted }} />
              {tz ? <ProspectClock tz={tz} place={place} /> : <span>{place}</span>}
            </div>
          )}

          {/* Channel health — only WARN about allowed-but-missing channels (dispatch would fail) */}
          {brokenChannels.length > 0 && (
            <div className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold rounded-lg px-2 py-1"
              style={{ color: C.orange, backgroundColor: `color-mix(in srgb, ${C.orange} 11%, transparent)`, border: `1px solid color-mix(in srgb, ${C.orange} 28%, transparent)` }}>
              {brokenChannels.map(ch => (
                <span key={ch.key} className="inline-flex items-center gap-1" title={`${ch.label}: no data — dispatch will fail`}>{ch.icon}</span>
              ))}
              <span>{t("ld2.channelWarn")}</span>
            </div>
          )}

          {/* Added — micro-metadata (recency NEW pill removed: it duplicated the date) */}
          {lead.created_at && (
            <span className="inline-flex items-center gap-1 text-[11.5px]" style={{ color: C.textDim }}>
              <CalendarPlus size={11} /> {t("ld2.added").toLowerCase()} {new Date(lead.created_at).toLocaleDateString(localeTag, { day: "numeric", month: "short" })}
            </span>
          )}

          <LeadSellerTags leadId={leadId} compact />
        </div>
      </div>

      {/* ── FOOTER — one-line metric strip (secondary) ── */}
      <div className="px-4 sm:px-5 py-2.5 border-t flex items-center gap-x-2 gap-y-1 flex-wrap text-[12.5px]"
        style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textMuted }}>
        {metricCells.map((m, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            {i > 0 && <span className="mr-1" style={{ color: C.textDim, opacity: 0.6 }}>·</span>}
            <span className="font-bold tabular-nums" style={{ color: m.tone ?? C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{m.value}</span>
            <span className="uppercase tracking-wide text-[10.5px] font-semibold">{m.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
