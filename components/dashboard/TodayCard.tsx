"use client";

// "What to do today" — premium expandable action hub.
//
// Boss feedback 2026-05-27: needs to look pro AND show the actual leads
// to interact with (called / replied) inline, not just a count. Each
// section expands inline to reveal the top 8 leads, every row deep-
// linking into /leads/[id].
//
// IMPORTANT (RSC boundary): this is a "use client" component, so every
// prop must be serializable. Past bug: a fmtRelative function prop was
// passed from the server and crashed render with digest 1285441784.
// Locale is now a plain string ("en"|"es"); relative-time formatting
// happens inside this component.

import { useState } from "react";
import Link from "next/link";
import {
  ChevronDown, ChevronRight, ArrowUpRight, Sparkles,
  MessageSquare, Phone, ThumbsUp, UserPlus, AlertCircle,
} from "lucide-react";
import { C, N, T } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

export type TodayLead = {
  id: string;
  company: string;
  icp?: string | null;
  when?: string | null;
  tag?: string | null;
};

export type TodaySectionKey = "replies" | "positives" | "calls" | "unassigned" | "stale";

export type TodayLabels = {
  title: string;
  subtitle: string;
  empty: string;
  noIcp: string;
  sections: Record<TodaySectionKey, { label: string; hint: string; cta: string }>;
};

function fmtRelative(iso: string | null | undefined, locale: "en" | "es"): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const diff = Date.now() - t;
  if (diff < 0) return null;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return locale === "es" ? "ahora" : "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

export default function TodayCard({
  labels,
  data,
  locale,
}: {
  labels: TodayLabels;
  data: {
    replies: TodayLead[];
    positives: TodayLead[];
    calls: TodayLead[];
    unassigned: TodayLead[];
    stale: TodayLead[];
  };
  locale: "en" | "es";
}) {
  // Boss feedback follow-up 2026-05-27: both buckets land collapsed so
  // the operator sees the count + chooses where to drill. Expanding any
  // section is one click; the default no longer commits to a guess.
  const [open, setOpen] = useState<Record<TodaySectionKey, boolean>>({
    replies: false,
    positives: false,
    calls: false,
    unassigned: false,
    stale: false,
  });

  // Five buckets, ordered by urgency:
  //   1. Replies waiting — inbound, needs human triage now
  //   2. Positives to follow up — convert before they cool
  //   3. Today's calls — outbound queue
  //   4. Stale leads — contacted >7d, no reply, momentum bleeding
  //   5. Leads to assign — pipeline gap, no flow yet
  // (Previous version hid 3/4/5 inside a separate strip; boss feedback
  // 2026-05-28: the Today tab is the dedicated landing surface now, so
  // we have the real estate to surface them all inline.)
  const sections: Array<{
    key: TodaySectionKey;
    icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
    accent: string;
    href: string;
    list: TodayLead[];
  }> = [
    { key: "replies",    icon: MessageSquare, accent: "#7C3AED", href: "/inbox",                 list: data.replies },
    { key: "positives",  icon: ThumbsUp,      accent: "#10B981", href: "/opportunities",         list: data.positives },
    { key: "calls",      icon: Phone,         accent: "#EA580C", href: "/queue",                 list: data.calls },
    { key: "stale",      icon: AlertCircle,   accent: "#D97706", href: "/leads?filter=stale",    list: data.stale },
    { key: "unassigned", icon: UserPlus,      accent: "#0EA5E9", href: "/leads?filter=no-camp",  list: data.unassigned },
  ];

  const totalItems = sections.reduce((acc, s) => acc + s.list.length, 0);

  return (
    <section
      className="rounded-2xl border overflow-hidden"
      style={{
        backgroundColor: C.card,
        borderColor: `color-mix(in srgb, ${gold} 28%, ${C.border})`,
        boxShadow: `0 1px 0 color-mix(in srgb, ${gold} 18%, transparent), 0 8px 24px -12px ${N.ink}`,
      }}
    >
      {/* Header — black surface with gold title (boss feedback 2026-05-27).
          Body below stays light so the lead rows feel tactile. */}
      <div
        className="relative px-5 py-4 flex items-center gap-3 overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${N.ink} 0%, ${N.ink2} 100%)`,
          borderBottom: `1px solid color-mix(in srgb, ${gold} 22%, transparent)`,
        }}
      >
        <span
          aria-hidden
          className="absolute -top-16 -left-12 w-48 h-48 rounded-full pointer-events-none"
          style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 18%, transparent) 0%, transparent 65%)` }}
        />
        <span
          className="relative w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 78%, white) 100%)`,
            color: N.ink,
            boxShadow: `0 4px 14px color-mix(in srgb, ${gold} 38%, transparent), inset 0 0 0 1px color-mix(in srgb, ${gold} 55%, white)`,
          }}
        >
          <Sparkles size={15} />
        </span>
        <div className="relative min-w-0">
          <h3
            className={`${T.cardTitle}`}
            style={{ color: gold, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
          >
            {labels.title}
          </h3>
          <p
            className="text-[11.5px] mt-0.5 truncate"
            style={{ color: "color-mix(in srgb, white 65%, transparent)" }}
          >
            {labels.subtitle.replace("{n}", String(totalItems))}
          </p>
        </div>
      </div>

      {totalItems === 0 ? (
        <p className="px-5 py-6 text-center text-[13px]" style={{ color: C.textMuted }}>
          {labels.empty}
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: C.border }}>
          {sections.map(s => {
            const Icon = s.icon;
            const isOpen = open[s.key];
            const hasItems = s.list.length > 0;
            const sl = labels.sections[s.key];

            return (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => hasItems && setOpen(o => ({ ...o, [s.key]: !o[s.key] }))}
                  disabled={!hasItems}
                  className="w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors group"
                  style={{
                    backgroundColor: isOpen ? `color-mix(in srgb, ${s.accent} 6%, transparent)` : "transparent",
                    cursor: hasItems ? "pointer" : "default",
                  }}
                >
                  <span
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `color-mix(in srgb, ${s.accent} 14%, transparent)`, color: s.accent }}
                  >
                    <Icon size={15} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span
                        className="text-[20px] font-bold tabular-nums leading-none tracking-[-0.02em]"
                        style={{ color: hasItems ? s.accent : C.textDim, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}
                      >
                        {s.list.length}
                      </span>
                      <span className="text-[13px] font-semibold" style={{ color: C.textPrimary }}>
                        {sl.label}
                      </span>
                    </div>
                    <p className="text-[11px] mt-0.5 truncate" style={{ color: C.textDim }}>
                      {sl.hint}
                    </p>
                  </div>
                  <Link
                    href={s.href}
                    onClick={(e) => e.stopPropagation()}
                    className="hidden sm:inline-flex shrink-0 items-center gap-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] px-2.5 py-1 rounded-md transition-colors"
                    style={{
                      color: s.accent,
                      backgroundColor: `color-mix(in srgb, ${s.accent} 10%, transparent)`,
                    }}
                  >
                    {sl.cta} <ArrowUpRight size={11} />
                  </Link>
                  {hasItems && (
                    isOpen
                      ? <ChevronDown size={15} style={{ color: C.textMuted }} className="shrink-0" />
                      : <ChevronRight size={15} style={{ color: C.textMuted }} className="shrink-0" />
                  )}
                </button>
                {isOpen && hasItems && (
                  <ul
                    className="border-t divide-y"
                    style={{
                      borderColor: `color-mix(in srgb, ${s.accent} 22%, transparent)`,
                      backgroundColor: `color-mix(in srgb, ${s.accent} 3%, transparent)`,
                    }}
                  >
                    {s.list.map(lead => {
                      const when = fmtRelative(lead.when, locale);
                      // Company is the preferred primary label; when it
                      // comes back empty ("—"), promote the ICP name so
                      // the row never looks orphaned. The seller can still
                      // click in to /leads/[id] to see the contact details.
                      const hasCompany = lead.company && lead.company !== "—";
                      const primary = hasCompany ? lead.company : (lead.icp ?? labels.noIcp);
                      const secondary = hasCompany
                        ? [lead.icp ?? labels.noIcp, lead.tag].filter(Boolean).join(" · ")
                        : (lead.tag ?? "");
                      const avatarText = primary.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2).toUpperCase() || "··";
                      return (
                        <li key={lead.id}>
                          <Link
                            href={`/leads/${lead.id}`}
                            className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-black/[0.025] group"
                            style={{ borderColor: C.border }}
                          >
                            <span
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold uppercase shrink-0"
                              style={{
                                backgroundColor: `color-mix(in srgb, ${s.accent} 14%, transparent)`,
                                color: s.accent,
                                border: `1px solid color-mix(in srgb, ${s.accent} 22%, transparent)`,
                              }}
                              aria-hidden
                            >
                              {avatarText}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-medium truncate" style={{ color: C.textPrimary }}>
                                {primary}
                              </p>
                              {secondary && (
                                <p className="text-[10.5px] truncate" style={{ color: C.textDim }}>
                                  {secondary}
                                </p>
                              )}
                            </div>
                            {when && (
                              <span className="shrink-0 text-[10.5px] tabular-nums" style={{ color: C.textMuted }}>
                                {when}
                              </span>
                            )}
                            <ArrowUpRight size={12} className="shrink-0 transition-transform group-hover:translate-x-0.5" style={{ color: C.textDim }} />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
