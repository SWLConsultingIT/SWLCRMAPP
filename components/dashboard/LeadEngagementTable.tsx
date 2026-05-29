"use client";

// Lead-level engagement table for the campaign detail page.
// Boss feedback 2026-05-29: the previous table truncated to 18 rows and
// only showed the engagement pill. Now: full list, expandable rows that
// reveal the per-lead timeline (every sent message + reply received), plus
// extra columns for status / steps received / last channel / last activity
// / reply classification / result.

import Link from "next/link";
import { Fragment, useState, useMemo } from "react";
import { ChevronRight, Search, Mail, Share2, Phone, Smartphone, Send, MessageSquare } from "lucide-react";
import { C } from "@/lib/design";
import { dicts, type Locale } from "@/lib/i18n-dicts";

// Pure client-safe translator (mirrors lib/i18n-server.t signature) — only
// imports the dict bundle, not the server-only locale resolver.
function tx(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  let s = dicts[locale][key] ?? dicts.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return s;
}

export type LeadEngagementRow = {
  campaignId: string;
  leadId: string | null;
  name: string;
  title: string | null;
  company: string | null;
  step: number;
  stepsReceived: number;
  campaignStatus: string;
  leadStatus: string | null;
  lastChannel: string | null;
  lastActivity: string | null;
  classification: string | null;
  replyText: string | null;
  replyChannel: string | null;
  seller: string | null;
  result: "won" | "lost" | "replied" | "open";
  timeline: Array<
    | { kind: "sent"; channel: string; step: number; at: string | null; body: string }
    | { kind: "reply"; channel: string; classification: string; at: string | null; body: string }
  >;
};

const channelMeta: Record<string, { Icon: React.ElementType; color: string; label: string }> = {
  linkedin: { Icon: Share2,     color: "#0A66C2", label: "LinkedIn" },
  email:    { Icon: Mail,       color: "#059669", label: "Email" },
  call:     { Icon: Phone,      color: "#EA580C", label: "Call" },
  whatsapp: { Icon: Smartphone, color: "#25D366", label: "WhatsApp" },
};

const resultMeta: Record<LeadEngagementRow["result"], { color: string; key: string }> = {
  won:     { color: "#16A34A", key: "won" },
  lost:    { color: "#DC2626", key: "lost" },
  replied: { color: "#7C3AED", key: "replied" },
  open:    { color: "#6B7280", key: "open" },
};

const classColor: Record<string, string> = {
  positive: "#16A34A", meeting_intent: "#059669", negative: "#DC2626", not_now: "#F59E0B",
  unsubscribe: "#9CA3AF", needs_info: "#7C3AED", question: "#0A66C2", nurturing: "#6B7280",
  spam: "#374151", auto_reply: "#94A3B8", unclassified: "#9CA3AF",
};

export default function LeadEngagementTable({ rows, locale }: { rows: LeadEngagementRow[]; locale: Locale }) {
  const t = (k: string, vars?: Record<string, string | number>) => tx(locale, k, vars);
  const dateLoc = locale === "es" ? "es-AR" : "en-US";

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "won" | "lost" | "replied" | "open">("all");
  const [openRow, setOpenRow] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      if (filter !== "all" && r.result !== filter) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.company ?? "").toLowerCase().includes(q) ||
        (r.title ?? "").toLowerCase().includes(q) ||
        (r.seller ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, query, filter]);

  const counts = useMemo(() => ({
    all: rows.length,
    won: rows.filter(r => r.result === "won").length,
    lost: rows.filter(r => r.result === "lost").length,
    replied: rows.filter(r => r.result === "replied").length,
    open: rows.filter(r => r.result === "open").length,
  }), [rows]);

  const fmtRelative = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60_000);
    if (mins < 60) return `${mins}m`;
    const h = Math.round(mins / 60);
    if (h < 24) return `${h}h`;
    const days = Math.round(h / 24);
    if (days < 7) return `${days}d`;
    return d.toLocaleDateString(dateLoc, { day: "2-digit", month: "short" });
  };

  const fmtFullDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString(dateLoc, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  const tr = (k: string, fallback: string, vars?: Record<string, string | number>) => {
    const v = t(k, vars);
    return v === k ? fallback : v;
  };

  return (
    <div className="space-y-3">
      {/* Toolbar: search + filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: C.textMuted }} />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={tr("dashx.detail.campaign.leads.search", "Search lead, company, seller…")}
            className="w-full pl-7 pr-3 py-1.5 text-[12px] rounded-lg border outline-none focus:ring-2"
            style={{ borderColor: C.border, backgroundColor: C.surface, color: C.textPrimary }}
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {(["all", "won", "replied", "lost", "open"] as const).map(k => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className="text-[10.5px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md border transition-colors"
              style={{
                borderColor: filter === k ? (k === "all" ? C.textPrimary : resultMeta[k as Exclude<typeof k, "all">].color) : C.border,
                background: filter === k
                  ? (k === "all" ? "color-mix(in srgb, currentColor 8%, transparent)" : `color-mix(in srgb, ${resultMeta[k as Exclude<typeof k, "all">].color} 14%, transparent)`)
                  : "transparent",
                color: filter === k
                  ? (k === "all" ? C.textPrimary : resultMeta[k as Exclude<typeof k, "all">].color)
                  : C.textMuted,
              }}
            >
              {tr(`dashx.detail.campaign.leads.filter.${k}`, k === "all" ? "All" : k.charAt(0).toUpperCase() + k.slice(1))} <span className="tabular-nums opacity-70">{counts[k]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto -mx-3.5">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider" style={{ color: C.textMuted }}>
              <th className="px-3 py-2 text-left w-8" />
              <th className="px-3 py-2 text-left">{tr("dashx.detail.icp.leads.col.lead", "Lead")}</th>
              <th className="px-3 py-2 text-left">{tr("dashx.detail.icp.leads.col.company", "Company")}</th>
              <th className="px-3 py-2 text-left">{tr("dashx.detail.campaign.leads.col.status", "Status")}</th>
              <th className="px-3 py-2 text-right">{tr("dashx.detail.campaign.leads.col.stepsReceived", "Steps")}</th>
              <th className="px-3 py-2 text-left">{tr("dashx.detail.campaign.leads.col.lastChannel", "Last channel")}</th>
              <th className="px-3 py-2 text-left">{tr("dashx.detail.campaign.leads.col.lastActivity", "Last activity")}</th>
              <th className="px-3 py-2 text-left">{tr("dashx.detail.campaign.leads.col.classification", "Reply")}</th>
              <th className="px-3 py-2 text-left">{tr("dashx.detail.campaign.leads.col.result", "Result")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-[12px]" style={{ color: C.textMuted }}>
                {tr("dashx.detail.campaign.leads.empty", "No leads match this filter")}
              </td></tr>
            )}
            {filtered.map(l => {
              const expanded = openRow === l.campaignId;
              const lastCh = l.lastChannel ? (channelMeta[l.lastChannel] ?? null) : null;
              const LastChIcon = lastCh?.Icon;
              const cls = l.classification;
              const resColor = resultMeta[l.result].color;
              return (
                <Fragment key={l.campaignId}>
                  <tr
                    onClick={() => setOpenRow(expanded ? null : l.campaignId)}
                    className="border-t hover:bg-black/[0.02] transition-colors cursor-pointer"
                    style={{ borderColor: C.border }}
                  >
                    <td className="px-3 py-2 align-top">
                      <ChevronRight size={14} style={{ color: C.textMuted, transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .15s ease" }} />
                    </td>
                    <td className="px-3 py-2 align-top">
                      {l.leadId
                        ? <Link href={`/leads/${l.leadId}`} onClick={e => e.stopPropagation()} className="font-medium hover:underline" style={{ color: C.textPrimary }}>{l.name}</Link>
                        : <span style={{ color: C.textMuted }}>{l.name}</span>}
                      {l.title && <p className="text-[10.5px] mt-0.5" style={{ color: C.textDim }}>{l.title}</p>}
                      {l.seller && <p className="text-[10px] mt-0.5" style={{ color: C.textMuted }}>{l.seller}</p>}
                    </td>
                    <td className="px-3 py-2 align-top text-[12px]" style={{ color: C.textBody }}>{l.company ?? "—"}</td>
                    <td className="px-3 py-2 align-top">
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: l.campaignStatus === "active" ? "color-mix(in srgb, #16A34A 14%, transparent)" : l.campaignStatus === "paused" ? "color-mix(in srgb, #F59E0B 14%, transparent)" : "color-mix(in srgb, #6B7280 14%, transparent)",
                          color: l.campaignStatus === "active" ? "#16A34A" : l.campaignStatus === "paused" ? "#F59E0B" : "#6B7280",
                        }}>
                        {tr(`dashx.tbl.status.${l.campaignStatus}`, l.campaignStatus || "—")}
                      </span>
                      {l.leadStatus && l.leadStatus !== "open" && (
                        <p className="text-[9.5px] mt-1 uppercase tracking-wider" style={{ color: C.textDim }}>
                          {tr(`dashx.lead.status.${l.leadStatus}`, l.leadStatus.replace(/_/g, " "))}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-right tabular-nums" style={{ color: C.textBody }}>{l.stepsReceived}</td>
                    <td className="px-3 py-2 align-top">
                      {lastCh && LastChIcon ? (
                        <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: lastCh.color }}>
                          <LastChIcon size={11} /> {lastCh.label}
                        </span>
                      ) : <span style={{ color: C.textMuted }}>—</span>}
                    </td>
                    <td className="px-3 py-2 align-top text-[11px] tabular-nums" style={{ color: C.textBody }} title={l.lastActivity ?? undefined}>
                      {fmtRelative(l.lastActivity)}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {cls ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: `color-mix(in srgb, ${classColor[cls] ?? "#9CA3AF"} 14%, transparent)`, color: classColor[cls] ?? "#9CA3AF" }}>
                          {tr(`dashx.reply.${cls}`, cls.replace(/_/g, " "))}
                        </span>
                      ) : <span style={{ color: C.textMuted }}>—</span>}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: `color-mix(in srgb, ${resColor} 14%, transparent)`, color: resColor }}>
                        {tr(`dashx.detail.campaign.leads.result.${l.result}`, l.result)}
                      </span>
                    </td>
                  </tr>
                  {expanded && (
                    <tr style={{ borderColor: C.border, backgroundColor: C.surface }} className="border-t">
                      <td colSpan={9} className="px-3 py-3">
                        <LeadTimeline timeline={l.timeline} fmtFullDate={fmtFullDate} tr={tr} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeadTimeline({
  timeline,
  fmtFullDate,
  tr,
}: {
  timeline: LeadEngagementRow["timeline"];
  fmtFullDate: (iso: string | null) => string;
  tr: (k: string, fallback: string) => string;
}) {
  if (timeline.length === 0) {
    return <p className="text-[12px] py-2" style={{ color: C.textMuted }}>{tr("dashx.detail.campaign.leads.noTimeline", "No activity recorded for this lead")}</p>;
  }
  return (
    <ol className="space-y-2.5 ml-1">
      {timeline.map((ev, i) => {
        const ch = channelMeta[ev.channel] ?? null;
        const isReply = ev.kind === "reply";
        const accent = isReply ? (classColor[ev.classification] ?? "#7C3AED") : (ch?.color ?? "#6B7280");
        const ChIcon = ch?.Icon ?? Send;
        return (
          <li key={i} className="flex gap-2.5">
            <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5"
              style={{ backgroundColor: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent }}>
              {isReply ? <MessageSquare size={11} /> : <ChIcon size={11} />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: accent }}>
                  {isReply ? tr("dashx.detail.campaign.leads.tl.reply", "Reply") : `${tr("dashx.detail.campaign.leads.tl.sent", "Sent")} · ${tr("dashx.detail.campaign.leads.tl.step", "Step")} ${ev.step + 1}`}
                </span>
                {isReply && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0 rounded"
                    style={{ backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`, color: accent }}>
                    {ev.classification.replace(/_/g, " ")}
                  </span>
                )}
                <span className="text-[10.5px] tabular-nums" style={{ color: C.textDim }}>{fmtFullDate(ev.at)}</span>
              </div>
              {ev.body && (
                <p className="text-[12px] mt-1 whitespace-pre-wrap" style={{ color: C.textBody, lineHeight: 1.4 }}>{ev.body}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
