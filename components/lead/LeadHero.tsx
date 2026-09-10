"use client";

// Redesigned Lead hero — slimmer, one clear action row, all prior capabilities
// preserved (Call w/ number+phone pickers, Email, LinkedIn, Set result, More
// menu = View flow/Export/Delete, prev/next nav, teammate tags, channel state,
// prospect clock, compact metrics). Colour: gold=primary, semantic only for
// channel ready/broken; everything else neutral.

import Link from "next/link";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { LinkedInIcon } from "@/components/SocialIcons";
import { Mail, Phone, Building2, ExternalLink, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
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

  // Channel readiness pills (ready=green ✓ / allowed-but-no-data=orange ⚠ / blocked=neutral).
  const channels = [
    { key: "allow_linkedin", label: "LinkedIn", icon: <LinkedInIcon size={13} />, ok: liOk },
    { key: "allow_email", label: t("chan.email"), icon: <Mail size={13} />, ok: !!email },
    { key: "allow_call", label: t("chan.call"), icon: <Phone size={13} />, ok: !!phone },
  ];

  const secBtn = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold border transition-colors hover:bg-black/[0.03]";

  return (
    <div className="rounded-2xl border mb-5 relative overflow-hidden reveal"
      style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: C.shadow }}>
      <div className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: `linear-gradient(90deg, transparent, ${gold} 30%, color-mix(in srgb, ${gold} 72%, white) 50%, ${gold} 70%, transparent)` }} />

      <div className="p-4 sm:p-5 flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
        {/* Identity */}
        <div className="flex items-start gap-3.5 flex-1 min-w-0">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center text-base sm:text-lg font-bold text-white shrink-0"
            style={{ background: `linear-gradient(135deg, ${avatarBg}, color-mix(in srgb, ${avatarBg} 75%, white))`, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] sm:text-[22px] font-bold leading-tight truncate"
              style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.02em" }}>
              {lead.primary_first_name} {lead.primary_last_name}
            </h1>
            <div className="flex items-center gap-x-2.5 gap-y-0.5 mt-0.5 flex-wrap text-[13px]" style={{ color: C.textMuted }}>
              <span className="truncate">{lead.primary_title_role ?? "—"}</span>
              {lead.company_name && (
                <>
                  <span style={{ color: C.textDim }}>·</span>
                  <Link href={`/companies/${encodeURIComponent(lead.company_name)}`}
                    className="inline-flex items-center gap-1 hover:underline truncate" style={{ color: C.blue }}>
                    <Building2 size={12} className="shrink-0" style={{ color: C.textDim }} />
                    <span className="truncate">{lead.company_name}</span>
                  </Link>
                </>
              )}
            </div>
            <div className="flex items-center gap-3.5 mt-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: C.textBody }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} /> {statusLabel}
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: C.textBody }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: scoreColor }} /> {scoreLabel}
                {lead.lead_score > 0 && <span className="tabular-nums" style={{ color: C.textDim }}>· {lead.lead_score}</span>}
              </span>
              {/* Channel readiness */}
              <span className="inline-flex items-center gap-1.5">
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
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2.5 xl:items-end shrink-0">
          <div className="flex items-center gap-2 flex-wrap xl:justify-end">
            {phone && (
              lead.allow_call === false
                ? <WrongNumberPill leadId={leadId} currentPhone={phone} />
                : <CallButton phone={phone} leadId={leadId} size="sm" defaultNumberId={campaign?.aircall_number_id ?? null}
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
              <div className="inline-flex items-center rounded-lg border overflow-hidden" style={{ borderColor: C.border }}>
                {seqNav.prevId
                  ? <Link href={`/leads/${seqNav.prevId}`} title={t("ld.prevLead")} className="inline-flex items-center px-2 py-2 hover:bg-black/[0.04]" style={{ color: C.textBody }}><ChevronLeft size={15} /></Link>
                  : <span className="inline-flex items-center px-2 py-2" style={{ color: C.textDim, opacity: 0.4 }}><ChevronLeft size={15} /></span>}
                <span className="px-2 text-[11px] font-semibold tabular-nums border-x" style={{ color: C.textMuted, borderColor: C.border }}>{seqNav.index}/{seqNav.total}</span>
                {seqNav.nextId
                  ? <Link href={`/leads/${seqNav.nextId}`} title={t("ld.nextLead")} className="inline-flex items-center px-2 py-2 hover:bg-black/[0.04]" style={{ color: C.textBody }}><ChevronRight size={15} /></Link>
                  : <span className="inline-flex items-center px-2 py-2" style={{ color: C.textDim, opacity: 0.4 }}><ChevronRight size={15} /></span>}
              </div>
            )}
          </div>
          {/* Compact metrics */}
          <MetricStrip items={[
            { label: t("ld2.metric.messages"), value: metrics.messages },
            { label: t("ld2.metric.replies"), value: metrics.replies },
            { label: t("ld2.metric.positive"), value: metrics.positive, tone: metrics.positive > 0 ? C.green : undefined },
            { label: t("ld2.metric.step"), value: metrics.step },
          ]} />
        </div>
      </div>

      {/* Metadata strip */}
      <div className="px-4 sm:px-5 pb-4 flex items-center gap-x-2.5 gap-y-1.5 flex-wrap text-xs" style={{ color: C.textMuted }}>
        {tz && <ProspectClock tz={tz} place={place} />}
        {lead.assigned_seller && (
          <span className="inline-flex items-center gap-1.5">
            <span style={{ color: C.textDim }}>·</span>
            <span className="w-4 h-4 rounded-full flex items-center justify-center text-white font-bold" style={{ backgroundColor: gold, fontSize: 9 }}>{lead.assigned_seller[0]}</span>
            {lead.assigned_seller}
          </span>
        )}
        {lead.created_at && <><span style={{ color: C.textDim }}>·</span><span>{t("ld2.added")} {new Date(lead.created_at).toLocaleDateString(localeTag, { day: "numeric", month: "short", year: "numeric" })}</span></>}
        {lead.source_universe && <><span style={{ color: C.textDim }}>·</span><span>{lead.source_universe}</span></>}
        {lead.created_at && (Date.now() - new Date(lead.created_at).getTime() < 7 * 86_400_000) && (
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `color-mix(in srgb, ${gold} 16%, transparent)`, color: "#8a6b18", border: `1px solid color-mix(in srgb, ${gold} 34%, transparent)` }}>
            {t("icpx.new")}
          </span>
        )}
        <div className="w-full sm:w-auto sm:ml-auto mt-1 sm:mt-0"><LeadSellerTags leadId={leadId} compact /></div>
      </div>
    </div>
  );
}
