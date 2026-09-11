"use client";

// Redesigned Lead hero — two clear levels, all prior capabilities preserved.
//  LEVEL 1  identity (left) · primary actions + lead nav (right)
//  LEVEL 2  commercial context + channels + compact metrics
// Colour: Call = brand GOLD (primary); Email/LinkedIn/Set result = neutral
// secondary; More = tertiary. Lead nav is separated from the action group.

import Link from "next/link";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { LinkedInIcon } from "@/components/SocialIcons";
import { Mail, Building2, ExternalLink, ChevronLeft, ChevronRight, Phone, Clock } from "lucide-react";
import CallButton from "@/components/CallButton";
import WrongNumberPill from "@/components/WrongNumberPill";
import LeadMoreMenu from "@/components/LeadMoreMenu";
import LeadSellerTags from "@/components/LeadSellerTags";
import ProspectClock from "@/components/ProspectClock";
import SetResultButton from "@/components/lead/SetResultButton";
import { MetricStrip } from "@/components/lead/ui";

const gold = "var(--brand, #c9a83a)";

function isValidLinkedInUrl(url?: string | null): boolean {
  if (!url) return false;
  try { const u = new URL(url); return /(^|\.)linkedin\.com$/i.test(u.hostname) && /\/in\//.test(u.pathname); }
  catch { return false; }
}

type SeqNav = { prevId: string | null; nextId: string | null; index: number; total: number } | null;

const Dot = () => <span style={{ color: C.textDim }} aria-hidden>·</span>;

export default function LeadHero({
  lead, leadId, contactName, initials, avatarBg,
  statusLabel, statusColor, scoreLabel, scoreColor,
  campaign, seqNav, isCallStep, nextStepName, autoReplies,
  metrics, tz, place, localeTag,
}: {
  lead: any; leadId: string; contactName: string; initials: string; avatarBg: string;
  statusLabel: string; statusColor: string; scoreLabel: string; scoreColor: string;
  campaign: any; seqNav: SeqNav; isCallStep: boolean; nextStepName?: string;
  autoReplies: { positive?: string; negative?: string } | null;
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

  // Channel availability — kept, but out of the lifecycle group (own cluster).
  const channels = [
    { key: "allow_linkedin", label: "LinkedIn", icon: <LinkedInIcon size={12} />, ok: liOk },
    { key: "allow_email", label: t("chan.email"), icon: <Mail size={12} />, ok: !!email },
    { key: "allow_call", label: t("chan.call"), icon: <Phone size={12} />, ok: !!phone },
  ];

  return (
    <div className="rounded-2xl border mb-5 relative overflow-hidden reveal"
      style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: C.shadow }}>
      <div className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: `linear-gradient(90deg, transparent, ${gold} 30%, color-mix(in srgb, ${gold} 72%, white) 50%, ${gold} 70%, transparent)` }} />

      {/* ── LEVEL 1 — identity + primary actions ── */}
      <div className="p-4 sm:p-5 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div className="flex items-center gap-3.5 flex-1 min-w-0">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center text-base sm:text-lg font-bold text-white shrink-0"
            style={{ background: `linear-gradient(135deg, ${avatarBg}, color-mix(in srgb, ${avatarBg} 75%, white))`, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] sm:text-[22px] font-bold leading-tight truncate"
              style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
              {lead.primary_first_name} {lead.primary_last_name}
            </h1>
            <div className="flex items-center gap-1.5 mt-0.5 text-[13px] flex-wrap" style={{ color: C.textMuted }}>
              <span>{lead.primary_title_role ?? "—"}</span>
              {lead.company_name && (
                <>
                  <Dot />
                  <Link href={`/companies/${encodeURIComponent(lead.company_name)}?fromLead=${leadId}`}
                    className="inline-flex items-center gap-1 hover:underline min-w-0" style={{ color: C.blue }}>
                    <Building2 size={12} className="shrink-0" style={{ color: C.textDim }} />
                    <span className="truncate max-w-[220px]">{lead.company_name}</span>
                    <ExternalLink size={11} className="shrink-0" style={{ opacity: 0.6 }} />
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>

        {/* actions + (separated) nav */}
        <div className="flex items-center gap-2 flex-wrap xl:flex-nowrap xl:justify-end shrink-0">
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

      {/* ── LEVEL 2 — commercial context · channels · metrics ── */}
      <div className="px-4 sm:px-5 py-3 border-t flex items-center gap-x-3 gap-y-2 flex-wrap"
        style={{ borderColor: C.border, backgroundColor: C.bg }}>
        {/* lifecycle (one badge) + score band (muted, distinct) */}
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold rounded-full px-2.5 py-0.5"
          style={{ color: statusColor, backgroundColor: `color-mix(in srgb, ${statusColor} 14%, transparent)` }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} /> {statusLabel}
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: C.textMuted }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: scoreColor }} /> {scoreLabel}
          {lead.lead_score > 0 && <span className="tabular-nums" style={{ color: C.textDim }}>· {lead.lead_score}</span>}
        </span>
        <Dot />
        {lead.assigned_seller && (
          <>
            <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: C.textBody }}>
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-white font-bold" style={{ backgroundColor: gold, fontSize: 9 }}>{lead.assigned_seller[0]}</span>
              {lead.assigned_seller}
            </span>
            <Dot />
          </>
        )}
        {tz ? <ProspectClock tz={tz} place={place} /> : place ? <span className="text-[12px]" style={{ color: C.textMuted }}>{place}</span> : null}
        {lead.created_at && (
          <>
            <Dot />
            <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: C.textMuted }}>
              {t("ld2.added")} {new Date(lead.created_at).toLocaleDateString(localeTag, { day: "numeric", month: "short" })}
              {isNew && <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${gold} 16%, transparent)`, color: "#8a6b18", border: `1px solid color-mix(in srgb, ${gold} 34%, transparent)` }}>{t("icpx.new")}</span>}
            </span>
          </>
        )}
        <div className="hidden sm:block"><LeadSellerTags leadId={leadId} compact /></div>

        {/* right cluster: channels + metrics */}
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1" title={t("lost.channels")}>
            {channels.map(ch => {
              const blocked = lead[ch.key] === false;
              const col = blocked ? C.textDim : ch.ok ? C.green : C.orange;
              return (
                <span key={ch.key} title={`${ch.label}: ${blocked ? t("ld.chanBlocked") : ch.ok ? t("ld.chanAllowed") : "no data"}`}
                  className="w-6 h-6 rounded-full grid place-items-center border"
                  style={{ color: col, borderColor: `color-mix(in srgb, ${col} 32%, transparent)`, backgroundColor: `color-mix(in srgb, ${col} 10%, transparent)`, opacity: blocked ? 0.5 : 1 }}>
                  {ch.icon}
                </span>
              );
            })}
          </span>
          <span className="hidden sm:inline-block h-5 w-px" style={{ backgroundColor: C.border }} aria-hidden />
          <MetricStrip items={[
            { label: t("ld2.metric.messages"), value: metrics.messages },
            { label: t("ld2.metric.replies"), value: metrics.replies },
            { label: t("ld2.metric.positive"), value: metrics.positive, tone: metrics.positive > 0 ? C.green : undefined },
            { label: t("ld2.metric.step"), value: metrics.step },
          ]} />
        </div>
      </div>
    </div>
  );
}
