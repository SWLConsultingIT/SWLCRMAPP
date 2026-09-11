"use client";

// Company → Engagement: "what have we done with this account?" A consolidated
// account-level timeline across ALL contacts (each event tagged with its
// contact) with an All-contacts / per-contact filter, plus a Campaigns
// sub-view. Truly account-level — no lead-scoped chat/notes forced in here.

import { useState } from "react";
import Link from "next/link";
import { Card, Badge } from "@/components/ui";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { ExternalLink, Megaphone } from "lucide-react";
import { SubTabs, EmptyLine } from "@/components/lead/ui";
import LeadTimeline, { type TimelineEvent } from "@/components/lead/LeadTimeline";

const gold = "var(--brand, #c9a83a)";

export type CampaignRollup = {
  id: string; name: string; status: string; contacts: number;
  messages: number; replies: number; positive: number; seller: string | null;
};

function statusTone(s: string): "positive" | "negative" | "warning" | "neutral" | "info" {
  if (s === "completed") return "positive";
  if (s === "failed" || s === "cancelled") return "negative";
  if (s === "paused") return "warning";
  if (s === "active") return "info";
  return "neutral";
}

export default function CompanyEngagement({
  events, localeTag, contacts, campaigns,
}: {
  events: TimelineEvent[]; localeTag: string;
  contacts: { id: string; name: string }[];
  campaigns: CampaignRollup[];
}) {
  const { t } = useLocale();
  const [filter, setFilter] = useState<string>("all");
  const filtered = filter === "all" ? events : events.filter(e => e.contactId === filter);

  const timelineView = (
    <div>
      {contacts.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          <button onClick={() => setFilter("all")} className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full border"
            style={filter === "all"
              ? { backgroundColor: `color-mix(in srgb, ${gold} 13%, transparent)`, borderColor: `color-mix(in srgb, ${gold} 40%, ${C.border})`, color: "var(--brand,#c9a83a)" }
              : { backgroundColor: C.surface, borderColor: C.border, color: C.textBody }}>
            {t("co.allContacts")}
          </button>
          {contacts.map(c => (
            <button key={c.id} onClick={() => setFilter(c.id)} className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full border"
              style={filter === c.id
                ? { backgroundColor: `color-mix(in srgb, ${gold} 13%, transparent)`, borderColor: `color-mix(in srgb, ${gold} 40%, ${C.border})`, color: "var(--brand,#c9a83a)" }
                : { backgroundColor: C.surface, borderColor: C.border, color: C.textBody }}>
              {c.name.split(" ")[0]}
            </button>
          ))}
        </div>
      )}
      <LeadTimeline events={filtered} locale={localeTag} emptyLabel={t("ld2.noInteractions")} />
    </div>
  );

  const campaignsView = campaigns.length > 0 ? (
    <div className="space-y-3">
      {campaigns.map(c => (
        <Card key={c.id} padded={16}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <Megaphone size={14} style={{ color: gold }} className="shrink-0" />
              <span className="text-[14px] font-bold truncate" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>{c.name}</span>
              <Badge tone={statusTone(c.status)} dot>{c.status}</Badge>
            </div>
            <Link href={`/campaigns/${c.id}`} className="text-[12px] font-bold inline-flex items-center gap-1 hover:underline shrink-0" style={{ color: C.blue }}>
              {t("co.openCampaign")} <ExternalLink size={12} />
            </Link>
          </div>
          <div className="mt-2.5 flex items-center gap-x-4 gap-y-1 flex-wrap text-[12px]" style={{ color: C.textMuted }}>
            <span><b style={{ color: C.textPrimary }}>{c.contacts}</b> {t("ld2.contacts")}</span>
            <span><b style={{ color: C.textPrimary }}>{c.messages}</b> {t("ld2.metric.messages").toLowerCase()}</span>
            <span><b style={{ color: C.textPrimary }}>{c.replies}</b> {t("ld2.metric.replies").toLowerCase()}</span>
            <span style={{ color: c.positive > 0 ? C.green : C.textMuted, fontWeight: 700 }}>{c.positive} {t("ld2.metric.positive").toLowerCase()}</span>
            {c.seller && <span className="ml-auto">{c.seller}</span>}
          </div>
        </Card>
      ))}
    </div>
  ) : <EmptyLine>{t("co.noCampaigns")}</EmptyLine>;

  return (
    <SubTabs tabs={[{ label: t("ld2.timeline") }, { label: t("co.campaigns"), count: campaigns.length || undefined }]}>
      {timelineView}
      {campaignsView}
    </SubTabs>
  );
}
