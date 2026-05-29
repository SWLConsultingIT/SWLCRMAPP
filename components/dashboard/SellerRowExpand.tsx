"use client";

// Whole-seller-row client component. Renders the seller's main <tr> +
// an optional expanded <tr> with top-3 campaigns and top-3 ICPs that
// drove their numbers. Boss feedback 2026-05-28: "no sé de qué campaña
// o ticket vienen esas métricas".
//
// Lives as a client component because it owns the open/close state. The
// page passes only serializable data — no inline render slots.

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Megaphone, Target, ArrowRight } from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

export type SellerRowData = {
  id: string;
  name: string;
  active: number;
  contacted: number;
  replied: number;
  positive: number;
  conversionRate: number;
  sentLinkedinConn: number;
  sentLinkedinMsg: number;
  sentEmail: number;
  sentCall: number;
  // Per-channel reply tracking (boss 2026-05-28)
  contactedLinkedin: number; repliedLinkedin: number; replyRateLinkedin: number;
  contactedEmail: number;    repliedEmail: number;    replyRateEmail: number;
  contactedCall: number;     repliedCall: number;     replyRateCall: number;
  connectionsSent: number; connectionsAccepted: number; acceptanceRate: number;
  pendingCalls: number;
  spark: number[];
  topCampaigns: { name: string; sent: number; replied: number; positive: number }[];
  topIcps: { id: string; name: string; sent: number; replied: number; positive: number }[];
};

export default function SellerRow({
  seller,
  idx,
  maxConv,
  detailHref,
  labels,
  channelLabels,
  formulaHint,
}: {
  seller: SellerRowData;
  idx: number;
  maxConv: number;
  detailHref: string;
  labels: {
    expand: string;
    collapse: string;
    campaignsTitle: string;
    icpsTitle: string;
    empty: string;
    sentShort: string;
    repliedShort: string;
    positiveShort: string;
    contactedShort: string;
    perChannelTitle: string;
    connSent: string;
    connAccepted: string;
    pendingCallsLabel: string;
    totalSentLabel: string;
  };
  channelLabels: {
    linkedinSent: string;
    linkedinMsg: string;
    emailTouch: string;
    callTouch: string;
  };
  formulaHint: string;
}) {
  const [open, setOpen] = useState(false);
  const hasBreakdown = seller.topCampaigns.length > 0 || seller.topIcps.length > 0;
  const convPct = Math.max(6, Math.round((seller.conversionRate / maxConv) * 100));

  return (
    <>
      <tr className="border-t hover:bg-black/[0.02] transition-colors" style={{ borderColor: C.border }}>
        <td className="px-3 py-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-bold"
            style={{
              background: idx === 0
                ? `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 78%, white) 100%)`
                : `color-mix(in srgb, ${C.textMuted} 8%, transparent)`,
              color: idx === 0 ? "#1A1505" : C.textMuted,
              boxShadow: idx === 0 ? `0 2px 8px color-mix(in srgb, ${gold} 32%, transparent)` : "none",
            }}>
            {idx + 1}
          </span>
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            {hasBreakdown && (
              <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-5 h-5 rounded-md flex items-center justify-center transition-colors hover:bg-black/[0.06]"
                style={{ color: open ? gold : C.textMuted, border: `1px solid ${open ? `color-mix(in srgb, ${gold} 40%, transparent)` : C.border}` }}
                aria-expanded={open}
                aria-label={open ? labels.collapse : labels.expand}
              >
                {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </button>
            )}
            <div className="flex flex-col gap-1 min-w-0">
              <Link href={detailHref} className="font-medium hover:underline truncate" style={{ color: C.textPrimary }}>{seller.name}</Link>
              {/* Inline per-channel reply rate chips — visible without
                  needing to expand. Boss 2026-05-28: "sumá más contenido
                  está vacío". Only shows channels with contacted > 0. */}
              <div className="inline-flex items-center gap-1.5 text-[10px] tabular-nums" title={labels.perChannelTitle}>
                <RateChip rate={seller.replyRateLinkedin} contacted={seller.contactedLinkedin} color="#0A66C2" label="LI" />
                <RateChip rate={seller.replyRateEmail} contacted={seller.contactedEmail} color="#059669" label="Email" />
                <RateChip rate={seller.replyRateCall} contacted={seller.contactedCall} color="#EA580C" label="Call" />
                {seller.pendingCalls > 0 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0 rounded text-[9.5px] font-semibold"
                    style={{ background: `color-mix(in srgb, #D97706 14%, transparent)`, color: "#D97706" }}
                    title={labels.pendingCallsLabel}>
                    {seller.pendingCalls} pending
                  </span>
                )}
                {seller.acceptanceRate > 0 && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0 rounded text-[9.5px] font-semibold"
                    style={{ background: `color-mix(in srgb, ${gold} 14%, transparent)`, color: gold }}
                    title={`${seller.connectionsAccepted}/${seller.connectionsSent} accepted`}>
                    {seller.acceptanceRate}% accept
                  </span>
                )}
              </div>
            </div>
          </div>
        </td>
        <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.textBody }}>{seller.active}</td>
        <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.textBody }}>{seller.contacted}</td>
        <td className="px-3 py-2">
          <ChannelTouches
            linkedinSent={seller.sentLinkedinConn}
            linkedinMsg={seller.sentLinkedinMsg}
            emailTouch={seller.sentEmail}
            callTouch={seller.sentCall}
            labels={channelLabels}
          />
        </td>
        <td className="px-3 py-2 text-right tabular-nums" style={{ color: C.textBody }}>{seller.replied}</td>
        <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: seller.positive > 0 ? "#059669" : C.textMuted }}>{seller.positive}</td>
        <td className="px-3 py-2">
          <div className="flex justify-end" title={formulaHint}>
            <span className="inline-flex items-center justify-end gap-1 text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded"
              style={{ backgroundColor: seller.conversionRate > 0 ? `color-mix(in srgb, #059669 12%, transparent)` : "transparent", color: seller.conversionRate > 0 ? "#059669" : C.textMuted, minWidth: 90 }}>
              <span className="inline-block h-1 rounded-full" style={{ width: `${convPct}%`, maxWidth: 60, background: "#059669", opacity: 0.55 }} aria-hidden />
              {seller.conversionRate}%
            </span>
          </div>
        </td>
        <td className="px-3 py-2">
          <InlineSpark data={seller.spark} color={gold} />
        </td>
        <td className="pr-3" style={{ color: C.textDim }}>
          <Link href={detailHref} className="inline-flex"><ArrowRight size={12} /></Link>
        </td>
      </tr>
      {open && hasBreakdown && (
        <tr style={{ background: `color-mix(in srgb, ${gold} 4%, transparent)`, borderColor: C.border }} className="border-t">
          <td colSpan={10} className="px-4 py-3">
            {/* Top row — connection funnel + pending calls strip. Boss
                2026-05-28: needs to see acceptance rate + pending calls
                per seller directly. */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <FunnelStat label={labels.connSent} value={seller.connectionsSent} />
              <FunnelStat label={labels.connAccepted} value={`${seller.connectionsAccepted} (${seller.acceptanceRate}%)`} tone={seller.acceptanceRate >= 30 ? "success" : "neutral"} />
              <FunnelStat label={labels.pendingCallsLabel} value={seller.pendingCalls} tone={seller.pendingCalls > 0 ? "warning" : "neutral"} />
              <FunnelStat label={labels.totalSentLabel} value={seller.sentLinkedinConn + seller.sentLinkedinMsg + seller.sentEmail + seller.sentCall} />
            </div>
            {/* Per-channel reply rates grid */}
            <div className="rounded-lg border p-3 mb-3" style={{ background: C.card, borderColor: C.border }}>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] mb-2" style={{ color: C.textMuted }}>
                {labels.perChannelTitle}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <ChannelRateCell
                  channelLabel="LinkedIn"
                  channelColor="#0A66C2"
                  contacted={seller.contactedLinkedin}
                  replied={seller.repliedLinkedin}
                  rate={seller.replyRateLinkedin}
                  labels={{ contacted: labels.contactedShort, replied: labels.repliedShort }}
                />
                <ChannelRateCell
                  channelLabel="Email"
                  channelColor="#059669"
                  contacted={seller.contactedEmail}
                  replied={seller.repliedEmail}
                  rate={seller.replyRateEmail}
                  labels={{ contacted: labels.contactedShort, replied: labels.repliedShort }}
                />
                <ChannelRateCell
                  channelLabel="Call"
                  channelColor="#EA580C"
                  contacted={seller.contactedCall}
                  replied={seller.repliedCall}
                  rate={seller.replyRateCall}
                  labels={{ contacted: labels.contactedShort, replied: labels.repliedShort }}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Block
                title={labels.campaignsTitle}
                Icon={Megaphone}
                items={seller.topCampaigns.map(c => ({ label: c.name, sent: c.sent, replied: c.replied, positive: c.positive, href: `/dashboard/campaign/${encodeURIComponent(c.name)}` }))}
                emptyLabel={labels.empty}
                labels={{ sentShort: labels.sentShort, repliedShort: labels.repliedShort, positiveShort: labels.positiveShort }}
              />
              <Block
                title={labels.icpsTitle}
                Icon={Target}
                // ?from=/?tab=sellers so the ticket detail breadcrumb sends
                // the user back to the dashboard Sellers tab (where the
                // expand row lives) instead of /leads (boss 2026-05-29).
                items={seller.topIcps.map(i => ({ label: i.name, sent: i.sent, replied: i.replied, positive: i.positive, href: i.id !== "_unknown" ? `/leads/ticket/${i.id}?from=${encodeURIComponent("/?tab=sellers")}` : null }))}
                emptyLabel={labels.empty}
                labels={{ sentShort: labels.sentShort, repliedShort: labels.repliedShort, positiveShort: labels.positiveShort }}
              />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Block({
  title, Icon, items, emptyLabel, labels,
}: {
  title: string;
  Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  items: { label: string; sent: number; replied: number; positive: number; href: string | null }[];
  emptyLabel: string;
  labels: { sentShort: string; repliedShort: string; positiveShort: string };
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
        <ul className="space-y-1.5">
          {items.map((it, i) => {
            const row = (
              <div className="flex items-center gap-3 py-1">
                <span className="flex-1 text-[12px] font-medium truncate" style={{ color: C.textPrimary }} title={it.label}>
                  {it.label}
                </span>
                <span className="text-[10px] tabular-nums" style={{ color: C.textDim }}>
                  {it.sent} {labels.sentShort}
                </span>
                <span className="text-[10px] tabular-nums" style={{ color: C.textBody }}>
                  {it.replied} {labels.repliedShort}
                </span>
                <span className="text-[10px] tabular-nums font-semibold"
                  style={{ color: it.positive > 0 ? "#059669" : C.textMuted }}>
                  {it.positive} {labels.positiveShort}
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

// Inline copies of ChannelTouches + InlineSpark — local to keep this
// component fully self-contained. Same visual as the shared primitives
// used in the server-rendered version.
function ChannelTouches({
  linkedinSent, linkedinMsg, emailTouch, callTouch, labels,
}: {
  linkedinSent: number; linkedinMsg: number; emailTouch: number; callTouch: number;
  labels: { linkedinSent: string; linkedinMsg: string; emailTouch: string; callTouch: string };
}) {
  const items = [
    { value: linkedinSent, color: "#0A66C2", icon: "link", title: labels.linkedinSent },
    { value: linkedinMsg,  color: "#0A66C2", icon: "msg",  title: labels.linkedinMsg },
    { value: emailTouch,   color: "#059669", icon: "mail", title: labels.emailTouch },
    { value: callTouch,    color: "#EA580C", icon: "call", title: labels.callTouch },
  ];
  return (
    <div className="inline-flex items-center gap-1.5">
      {items.map((it, i) => {
        const has = it.value > 0;
        return (
          <span key={i} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] tabular-nums"
            style={{
              backgroundColor: has ? `color-mix(in srgb, ${it.color} 10%, transparent)` : "transparent",
              color: has ? it.color : C.textDim,
              border: has ? "none" : `1px dashed color-mix(in srgb, ${C.border} 65%, transparent)`,
            }}
            title={`${it.title}: ${it.value}`}>
            <ChannelIcon kind={it.icon} />
            <span className="font-semibold">{it.value}</span>
          </span>
        );
      })}
    </div>
  );
}

function ChannelIcon({ kind }: { kind: string }) {
  // Lucide icons render fine in client comps, but the icon imports here
  // would balloon the bundle. Keep simple svg.
  const path = kind === "link" ? "M4 12a4 4 0 0 1 4-4h2v2H8a2 2 0 0 0 0 4h2v2H8a4 4 0 0 1-4-4Zm10-2h2a4 4 0 0 1 0 8h-2v-2h2a2 2 0 0 0 0-4h-2v-2Zm-5 1h6v2H9v-2Z"
    : kind === "msg"  ? "M3 4h14v10H6l-3 3V4Z"
    : kind === "mail" ? "M3 5h14v10H3V5Zm0 0 7 5 7-5"
    : "M5 4l3 3-2 2c.8 1.8 2.2 3.2 4 4l2-2 3 3-1.5 1.5C9.6 14.5 5.5 10.4 3.5 6.5L5 4Z";
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

function RateChip({ rate, contacted, color, label }: { rate: number; contacted: number; color: string; label: string }) {
  // Show "—" when no contacted leads on that channel — avoids fake-0%.
  const hasData = contacted > 0;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0 rounded font-semibold"
      style={{
        background: hasData ? `color-mix(in srgb, ${color} 12%, transparent)` : "transparent",
        color: hasData ? color : C.textDim,
        border: hasData ? "none" : `1px dashed color-mix(in srgb, ${C.border} 65%, transparent)`,
      }}
    >
      <span style={{ color: hasData ? color : C.textDim, fontSize: 9 }}>{label}</span>
      <span style={{ color: hasData ? color : C.textDim }}>{hasData ? `${rate}%` : "—"}</span>
    </span>
  );
}

function FunnelStat({ label, value, tone = "neutral" }: { label: string; value: string | number; tone?: "neutral" | "success" | "warning" }) {
  const color = tone === "success" ? "#059669" : tone === "warning" ? "#D97706" : C.textPrimary;
  return (
    <div className="rounded-md border px-3 py-2" style={{ background: C.card, borderColor: C.border }}>
      <p className="text-[9.5px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>{label}</p>
      <p className="text-[16px] font-bold tabular-nums mt-0.5" style={{ color }}>{value}</p>
    </div>
  );
}

function ChannelRateCell({
  channelLabel, channelColor, contacted, replied, rate, labels,
}: {
  channelLabel: string;
  channelColor: string;
  contacted: number;
  replied: number;
  rate: number;
  labels: { contacted: string; replied: string };
}) {
  const widthPct = Math.max(4, Math.min(100, rate));
  return (
    <div className="rounded-md border p-2.5" style={{ borderColor: C.border, borderLeftWidth: 3, borderLeftColor: channelColor, background: `color-mix(in srgb, ${channelColor} 4%, transparent)` }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold" style={{ color: channelColor }}>{channelLabel}</span>
        <span className="text-[14px] font-bold tabular-nums" style={{ color: channelColor }}>{rate}%</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden mb-1.5" style={{ background: `color-mix(in srgb, ${channelColor} 14%, transparent)` }}>
        <div className="h-full" style={{ width: `${widthPct}%`, background: channelColor }} />
      </div>
      <div className="flex items-center justify-between text-[10px] tabular-nums" style={{ color: C.textDim }}>
        <span>{contacted} {labels.contacted}</span>
        <span>{replied} {labels.replied}</span>
      </div>
    </div>
  );
}

function InlineSpark({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(1, ...data);
  const w = 60, h = 16;
  const stepX = w / (data.length - 1 || 1);
  const points = data.map((v, i) => `${(i * stepX).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
}
