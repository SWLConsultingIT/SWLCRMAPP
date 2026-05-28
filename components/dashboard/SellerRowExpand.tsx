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
            <Link href={detailHref} className="font-medium hover:underline" style={{ color: C.textPrimary }}>{seller.name}</Link>
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
                items={seller.topIcps.map(i => ({ label: i.name, sent: i.sent, replied: i.replied, positive: i.positive, href: i.id !== "_unknown" ? `/leads/ticket/${i.id}` : null }))}
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
