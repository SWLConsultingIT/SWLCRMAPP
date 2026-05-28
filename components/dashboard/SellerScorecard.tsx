"use client";

// Per-seller scorecard card with expand-on-click detail.
//
// Boss feedback 2026-05-28: "esas cards que sean desplegable y te tiren
// la info ahí mismo, no quiero que te lleven a otra parte. Y después
// tiene tablas repetitivas abajo." Replaces the navigation-link card +
// leaderboard table combo with a single self-contained card that holds
// its own open/closed state and reveals the deep detail inline.

import { useState } from "react";
import Link from "next/link";
import {
  ChevronDown, ChevronRight, Megaphone, Target, Share2, Mail, Phone,
  Sparkles, ArrowRight,
} from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

export type SellerCardData = {
  id: string;
  name: string;
  active: number;
  contacted: number;
  replied: number;
  positive: number;
  responseRate: number;
  conversionRate: number;
  sentLinkedinConn: number;
  sentLinkedinMsg: number;
  sentEmail: number;
  sentCall: number;
  contactedLinkedin: number; repliedLinkedin: number; replyRateLinkedin: number;
  contactedEmail: number;    repliedEmail: number;    replyRateEmail: number;
  contactedCall: number;     repliedCall: number;     replyRateCall: number;
  connectionsSent: number; connectionsAccepted: number; acceptanceRate: number;
  pendingCalls: number;
  topCampaigns: { name: string; sent: number; replied: number; positive: number }[];
  topIcps: { id: string; name: string; sent: number; replied: number; positive: number }[];
};

export default function SellerScorecard({
  seller,
  idx,
  detailHref,
  labels,
}: {
  seller: SellerCardData;
  idx: number;
  detailHref: string;
  labels: {
    eyebrow: string;
    eyebrowLead: string;
    active: string;
    contacted: string;
    sent: string;
    replies: string;
    won: string;
    pending: string;
    expand: string;
    collapse: string;
    perChannelTitle: string;
    connSent: string;
    connAccepted: string;
    campaignsTitle: string;
    icpsTitle: string;
    empty: string;
    sentShort: string;
    repliedShort: string;
    positiveShort: string;
    contactedShort: string;
    openDetail: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const totalSent = seller.sentLinkedinConn + seller.sentLinkedinMsg + seller.sentEmail + seller.sentCall;
  const isLead = idx === 0;

  return (
    <div
      className="group rounded-2xl border overflow-hidden relative transition-[transform,box-shadow]"
      style={{
        backgroundColor: C.card,
        borderColor: isLead ? `color-mix(in srgb, ${gold} 38%, ${C.border})` : C.border,
        borderTop: `3px solid ${isLead ? gold : "#7C3AED"}`,
        boxShadow: isLead ? `0 6px 20px color-mix(in srgb, ${gold} 14%, transparent)` : "0 1px 2px rgba(0,0,0,0.03)",
      }}
    >
      {isLead && (
        <span aria-hidden className="absolute -top-12 -right-12 w-32 h-32 rounded-full pointer-events-none"
          style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 14%, transparent) 0%, transparent 70%)` }} />
      )}

      {/* Clickable header that toggles expansion */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="relative w-full p-4 text-left transition-colors hover:bg-black/[0.02]"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5 mb-3">
          <span
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-[13px] font-bold tabular-nums"
            style={{
              background: isLead
                ? `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 78%, white) 100%)`
                : `color-mix(in srgb, #7C3AED 14%, transparent)`,
              color: isLead ? "#1A1505" : "#7C3AED",
              border: isLead ? "none" : `1px solid color-mix(in srgb, #7C3AED 22%, transparent)`,
              boxShadow: isLead ? `0 2px 8px color-mix(in srgb, ${gold} 32%, transparent)` : "none",
            }}>
            {idx + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>
              {isLead ? labels.eyebrowLead : labels.eyebrow}
            </p>
            <p className="text-[15px] font-bold leading-tight truncate" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
              {seller.name}
            </p>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded shrink-0"
            style={{ background: `color-mix(in srgb, ${gold} 14%, transparent)`, color: gold }}>
            {seller.active} {labels.active}
          </span>
          {open
            ? <ChevronDown size={16} style={{ color: C.textMuted }} />
            : <ChevronRight size={16} style={{ color: C.textMuted }} />}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <KpiTile label={labels.contacted} value={seller.contacted} color={C.textBody} />
          <KpiTile label={labels.sent} value={totalSent} color="#0284C7" />
          <KpiTile label={labels.replies} value={seller.replied} sub={`${seller.responseRate}% reply rate`} color="#7C3AED" />
          <KpiTile label={labels.won} value={seller.positive} sub={`${seller.conversionRate}% conv`} color={C.green} accent={seller.positive > 0} />
        </div>
        {seller.pendingCalls > 0 && (
          <p className="mt-3 text-[11px] inline-flex items-center gap-1.5"
            style={{ color: "#D97706" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#D97706" }} />
            {seller.pendingCalls} {labels.pending}
          </p>
        )}
      </button>

      {/* Expanded body — per-channel reply rates + connection funnel +
          top campaigns/ICPs. Renders inline so the user never leaves
          the dashboard. */}
      {open && (
        <div className="relative px-4 pb-4 pt-1 space-y-3 border-t" style={{ borderColor: `color-mix(in srgb, ${gold} 22%, ${C.border})`, background: `color-mix(in srgb, ${gold} 3%, transparent)` }}>
          {/* Connection funnel mini-strip */}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <MiniStat label={labels.connSent} value={seller.connectionsSent} />
            <MiniStat
              label={labels.connAccepted}
              value={`${seller.connectionsAccepted} (${seller.acceptanceRate}%)`}
              tone={seller.acceptanceRate >= 30 ? "success" : "neutral"}
            />
          </div>

          {/* Per-channel reply rate */}
          <div className="rounded-lg border p-3" style={{ background: C.card, borderColor: C.border }}>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2" style={{ color: C.textMuted }}>
              {labels.perChannelTitle}
            </p>
            <div className="grid grid-cols-3 gap-2">
              <ChannelRate channelLabel="LinkedIn" channelColor="#0A66C2"
                contacted={seller.contactedLinkedin} replied={seller.repliedLinkedin} rate={seller.replyRateLinkedin}
                contactedLabel={labels.contactedShort} repliedLabel={labels.repliedShort} />
              <ChannelRate channelLabel="Email" channelColor="#059669"
                contacted={seller.contactedEmail} replied={seller.repliedEmail} rate={seller.replyRateEmail}
                contactedLabel={labels.contactedShort} repliedLabel={labels.repliedShort} />
              <ChannelRate channelLabel="Call" channelColor="#EA580C"
                contacted={seller.contactedCall} replied={seller.repliedCall} rate={seller.replyRateCall}
                contactedLabel={labels.contactedShort} repliedLabel={labels.repliedShort} />
            </div>
          </div>

          {/* Top campaigns + Top ICPs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <AttrBlock title={labels.campaignsTitle} Icon={Megaphone}
              items={seller.topCampaigns.map(c => ({ label: c.name, sent: c.sent, replied: c.replied, positive: c.positive, href: `/dashboard/campaign/${encodeURIComponent(c.name)}` }))}
              emptyLabel={labels.empty} sentLabel={labels.sentShort} repliedLabel={labels.repliedShort} positiveLabel={labels.positiveShort} />
            <AttrBlock title={labels.icpsTitle} Icon={Target}
              items={seller.topIcps.map(i => ({ label: i.name, sent: i.sent, replied: i.replied, positive: i.positive, href: i.id !== "_unknown" ? `/leads/ticket/${i.id}` : null }))}
              emptyLabel={labels.empty} sentLabel={labels.sentShort} repliedLabel={labels.repliedShort} positiveLabel={labels.positiveShort} />
          </div>

          {/* Drill-down link to the full seller detail page */}
          <Link href={detailHref} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold transition-colors hover:underline"
            style={{ color: gold }}>
            {labels.openDetail} <ArrowRight size={12} />
          </Link>
        </div>
      )}
    </div>
  );
}

function KpiTile({ label, value, color, sub, accent }: { label: string; value: number; color: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border px-2.5 py-1.5"
      style={{
        background: accent ? `color-mix(in srgb, ${color} 8%, transparent)` : C.surface,
        borderColor: accent ? `color-mix(in srgb, ${color} 25%, transparent)` : C.border,
      }}>
      <p className="text-[9.5px] font-bold uppercase tracking-wider truncate" style={{ color: C.textDim }}>{label}</p>
      <p className="text-[20px] font-bold tabular-nums leading-tight tracking-[-0.01em]"
        style={{ color, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
        {value.toLocaleString("en-US")}
      </p>
      {sub && <p className="text-[9.5px] mt-0.5 truncate" style={{ color: C.textDim }}>{sub}</p>}
    </div>
  );
}

function MiniStat({ label, value, tone = "neutral" }: { label: string; value: string | number; tone?: "neutral" | "success" }) {
  const color = tone === "success" ? "#059669" : C.textPrimary;
  return (
    <div className="rounded-md border px-3 py-2" style={{ background: C.card, borderColor: C.border }}>
      <p className="text-[9.5px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>{label}</p>
      <p className="text-[14px] font-bold tabular-nums mt-0.5" style={{ color }}>{value}</p>
    </div>
  );
}

function ChannelRate({
  channelLabel, channelColor, contacted, replied, rate, contactedLabel, repliedLabel,
}: {
  channelLabel: string; channelColor: string; contacted: number; replied: number; rate: number;
  contactedLabel: string; repliedLabel: string;
}) {
  const hasData = contacted > 0;
  const widthPct = Math.max(4, Math.min(100, rate));
  return (
    <div className="rounded-md border p-2"
      style={{
        borderColor: C.border,
        borderLeftWidth: 3,
        borderLeftColor: channelColor,
        background: `color-mix(in srgb, ${channelColor} 4%, transparent)`,
      }}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10.5px] font-semibold" style={{ color: channelColor }}>{channelLabel}</span>
        <span className="text-[13px] font-bold tabular-nums" style={{ color: hasData ? channelColor : C.textDim }}>
          {hasData ? `${rate}%` : "—"}
        </span>
      </div>
      <div className="h-1 rounded-full overflow-hidden mb-1" style={{ background: `color-mix(in srgb, ${channelColor} 14%, transparent)` }}>
        <div className="h-full" style={{ width: hasData ? `${widthPct}%` : 0, background: channelColor }} />
      </div>
      <div className="flex items-center justify-between text-[9.5px] tabular-nums" style={{ color: C.textDim }}>
        <span>{contacted} {contactedLabel}</span>
        <span>{replied} {repliedLabel}</span>
      </div>
    </div>
  );
}

function AttrBlock({
  title, Icon, items, emptyLabel, sentLabel, repliedLabel, positiveLabel,
}: {
  title: string;
  Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  items: { label: string; sent: number; replied: number; positive: number; href: string | null }[];
  emptyLabel: string; sentLabel: string; repliedLabel: string; positiveLabel: string;
}) {
  return (
    <div className="rounded-lg border p-3" style={{ background: C.card, borderColor: C.border }}>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2 inline-flex items-center gap-1.5" style={{ color: C.textMuted }}>
        <Icon size={11} style={{ color: gold }} />
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-[11px]" style={{ color: C.textDim }}>{emptyLabel}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((it, i) => {
            const row = (
              <div className="flex items-center gap-2 py-0.5">
                <span className="flex-1 text-[11.5px] font-medium truncate" style={{ color: C.textPrimary }} title={it.label}>
                  {it.label}
                </span>
                <span className="text-[9.5px] tabular-nums" style={{ color: C.textDim }}>{it.sent} {sentLabel}</span>
                <span className="text-[9.5px] tabular-nums" style={{ color: C.textBody }}>{it.replied} {repliedLabel}</span>
                <span className="text-[9.5px] tabular-nums font-semibold" style={{ color: it.positive > 0 ? "#059669" : C.textMuted }}>
                  {it.positive} {positiveLabel}
                </span>
              </div>
            );
            return (
              <li key={i}>
                {it.href ? <Link href={it.href} className="block hover:underline">{row}</Link> : row}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
