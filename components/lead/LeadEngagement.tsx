"use client";

// Engagement tab — "what happened with this lead". Merges the old Campaign +
// Calls + Conversation tabs into one place. Default sub-view = a real
// chronological Timeline (server-merged events); Campaign and Calls are
// secondary sub-views, not top-level lead tabs.

import { Card, Badge } from "@/components/ui";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { Phone, ExternalLink } from "lucide-react";
import Link from "next/link";
import { SubTabs, EmptyLine } from "@/components/lead/ui";
import LeadTimeline, { type TimelineEvent } from "@/components/lead/LeadTimeline";
import CampaignJourney from "@/components/CampaignJourney";
import CallCard from "@/components/CallCard";
import CallButton from "@/components/CallButton";
import SyncAircallButton from "@/components/SyncAircallButton";

const gold = "var(--brand, #c9a83a)";

function statusTone(s?: string | null): "positive" | "negative" | "warning" | "neutral" | "info" {
  if (s === "completed" || s === "closed_won") return "positive";
  if (s === "closed_lost" || s === "failed") return "negative";
  if (s === "paused") return "warning";
  if (s === "active") return "info";
  return "neutral";
}

export default function LeadEngagement({
  events, localeTag, campaign, messages, replies, calls, lead, leadId,
  step, stepPct, defaultNumberId, isCallStep, nextStepName,
}: {
  events: TimelineEvent[]; localeTag: string; campaign: any;
  messages: any[]; replies: any[]; calls: any[]; lead: any; leadId: string;
  step: string; stepPct: number; defaultNumberId: number | null;
  isCallStep: boolean; nextStepName?: string;
}) {
  const { t } = useLocale();
  const phone = lead.primary_phone ?? lead.primary_secondary_phone ?? null;
  const phones = [
    ...(lead.primary_phone ? [{ label: t("ld.personal"), value: lead.primary_phone }] : []),
    ...(lead.primary_secondary_phone ? [{ label: t("ld.phoneCompany"), value: lead.primary_secondary_phone }] : []),
  ];

  const campaignView = (
    <div className="space-y-4">
      {campaign ? (
        <Card padded={16}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[14px] font-bold truncate" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{campaign.name}</span>
                <Badge tone={statusTone(campaign.status)} dot>{campaign.status}</Badge>
              </div>
              <p className="text-[12px] mt-0.5" style={{ color: C.textMuted }}>
                {campaign.sellers?.name ? `${campaign.sellers.name} · ` : ""}
                {campaign.started_at ? `${t("ld2.started")} ${new Date(campaign.started_at).toLocaleDateString(localeTag, { day: "numeric", month: "short", year: "numeric" })}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-[13px] font-bold tabular-nums" style={{ color: gold }}>{step} · {stepPct}%</span>
              <Link href={`/campaigns/${campaign.id}`} className="text-[12px] font-bold inline-flex items-center gap-1 hover:underline" style={{ color: C.blue }}>
                {t("ld2.viewFlow")} <ExternalLink size={12} />
              </Link>
            </div>
          </div>
          <div className="mt-3 h-1.5 rounded-full" style={{ backgroundColor: C.border }}>
            <div className="h-1.5 rounded-full" style={{ width: `${stepPct}%`, backgroundColor: gold }} />
          </div>
        </Card>
      ) : (
        <EmptyLine>{t("ld.noCampaignYet")}</EmptyLine>
      )}
      <CampaignJourney campaign={campaign} messages={messages} replies={replies} />
    </div>
  );

  const callsView = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px]" style={{ color: C.textMuted }}>
          {calls.length > 0 ? t("ld2.callsRecorded", { n: calls.length }) : t("ld.noCalls")}
        </p>
        <div className="flex items-center gap-2">
          {phone && <CallButton phone={phone} leadId={leadId} size="sm" defaultNumberId={defaultNumberId} phones={phones} isCallStep={isCallStep} nextStepName={nextStepName} />}
          <SyncAircallButton />
        </div>
      </div>
      {calls.length === 0
        ? <EmptyLine><Phone size={14} /> {t("ld.noCalls")}</EmptyLine>
        : calls.map((call: any) => <CallCard key={call.id} call={call} personalPhone={lead.primary_phone ?? null} companyPhone={lead.primary_secondary_phone ?? null} />)}
    </div>
  );

  // Engagement = history/context; replying lives in the Inbox. When there's a
  // conversation to continue, surface a contextual CTA (no composer/send logic
  // duplicated here). There's no safe per-thread deep-link today (the inbox is a
  // pending-triage list keyed by reply id, not URL-addressable), so this opens
  // the Inbox surface — /inbox itself redirects to /queue?tab=inbox.
  const hasConversation = (replies?.length ?? 0) > 0;

  return (
    <div>
      {hasConversation && (
        <div className="flex justify-end mb-2 -mt-1">
          <Link href="/queue?tab=inbox" className="text-[12px] font-bold inline-flex items-center gap-1 hover:underline" style={{ color: C.blue }}>
            {t("ld2.openInbox")} <ExternalLink size={12} />
          </Link>
        </div>
      )}
      <SubTabs tabs={[
        { label: t("ld2.timeline") },
        { label: t("ld.tab.campaign") },
        { label: t("ld.tab.calls"), count: calls.length || undefined },
      ]}>
        <LeadTimeline events={events} locale={localeTag} emptyLabel={t("ld2.noInteractions")} />
        {campaignView}
        {callsView}
      </SubTabs>
    </div>
  );
}
