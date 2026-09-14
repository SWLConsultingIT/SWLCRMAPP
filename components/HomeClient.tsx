"use client";

import { useEffect, useState, type CSSProperties, type ReactElement } from "react";
import Link from "next/link";
import CopilotChat from "@/components/CopilotChat";
import { useLocale } from "@/shared/i18n/i18n";
import type { HomeData } from "@/lib/home-data";
import type { PriorityAction, PriorityReason } from "@/lib/home-priorities";
import { intlTag, type Locale } from "@/shared/i18n/dicts";

const LOGO_URL = "https://framerusercontent.com/images/xDo4WIo9yWn44s4NzORGGAUNxrI.png";

const ICONS: Record<string, ReactElement> = {
  reply: <path d="M4 5h16v11H7l-3 3V5z" />,
  call: <path d="M4 4h4l2 5-3 2a11 11 0 006 6l2-3 5 2v4a2 2 0 01-2 2A16 16 0 014 6a2 2 0 012-2z" />,
  assign: <><circle cx="12" cy="8" r="3.4" /><path d="M5 20c0-3.3 3-5.5 7-5.5M17 14v6M14 17h6" /></>,
  followUp: <path d="M4 12h10M4 6h16M4 18h7M17 14l4 4-4 4" />,
  linkedin: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M7 10v7M7 7v.01M11 17v-4a2 2 0 014 0v4" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
};

/** Icon + colour per reason. The COPY comes from i18n, keyed by the same
 *  reason — the score never reaches the screen. */
const REASON_STYLE: Record<PriorityReason, { icon: ReactElement; a: string; ab: string }> = {
  meeting_intent:                  { icon: ICONS.reply,    a: "var(--c-pos)",    ab: "var(--c-call-bg)" },
  positive_reply:                  { icon: ICONS.reply,    a: "var(--c-pos)",    ab: "var(--c-call-bg)" },
  needs_info:                      { icon: ICONS.reply,    a: "var(--c-reply)",  ab: "var(--c-reply-bg)" },
  callback_overdue:                { icon: ICONS.call,     a: "var(--c-stale)",  ab: "var(--c-stale-bg)" },
  follow_up_reply:                 { icon: ICONS.reply,    a: "var(--c-reply)",  ab: "var(--c-reply-bg)" },
  callback_today:                  { icon: ICONS.call,     a: "var(--c-call)",   ab: "var(--c-call-bg)" },
  call_overdue:                    { icon: ICONS.call,     a: "var(--c-stale)",  ab: "var(--c-stale-bg)" },
  connection_accepted_no_followup: { icon: ICONS.linkedin, a: "var(--c-assign)", ab: "var(--c-assign-bg)" },
  not_now_matured:                 { icon: ICONS.followUp, a: "var(--c-assign)", ab: "var(--c-assign-bg)" },
};

const ARROW = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;

/** "18 min ago" in the reader's locale. Coarse on purpose — the seller needs
 *  "is this hot or cold", not a stopwatch. */
function relAge(ms: number, locale: Locale): string {
  const rtf = new Intl.RelativeTimeFormat(intlTag(locale), { numeric: "auto" });
  const min = Math.round(ms / 60000);
  if (min < 60) return rtf.format(-Math.max(1, min), "minute");
  const hr = Math.round(min / 60);
  if (hr < 24) return rtf.format(-hr, "hour");
  return rtf.format(-Math.round(hr / 24), "day");
}

export default function HomeClient() {
  const { t, locale } = useLocale();
  const [data, setData] = useState<HomeData | null>(null);
  const [err, setErr] = useState(false);
  const [botOpen, setBotOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/home", { cache: "no-store" })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(d => { if (alive) setData(d as HomeData); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, []);

  const hr = new Date().getHours();
  const greeting = t(`home.greeting.${hr < 12 ? "morning" : hr < 20 ? "afternoon" : "evening"}`);
  const rawDate = new Intl.DateTimeFormat(intlTag(locale), { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const dateStr = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);
  const nPrio = data?.priorities.length ?? 0;

  const actionLabel = (a: PriorityAction) => t(`home.action.${a}`);

  /** The explainable "why this lead is here" line. */
  const whyLine = (reason: PriorityReason, ageMs: number | null, overdueDays: number | null): string => {
    const why = t(`home.reason.${reason}`);
    if (overdueDays != null && overdueDays > 0) {
      return `${why} · ${overdueDays === 1 ? t("home.prio.oneDay") : t("home.prio.nDays", { n: overdueDays })}`;
    }
    if (ageMs != null && ageMs >= 0) return `${why} · ${relAge(ageMs, locale)}`;
    return why;
  };

  const num = (n: number | null | undefined) => (n == null ? "—" : String(n));

  return (
    <div className="hm-wrap">
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="aurora-hero">
        <div className="aurora-mesh" aria-hidden /><div className="aurora-mesh2" aria-hidden />
        <div className="aurora-glass">
          <div className="aurora-top">
            <div className="aurora-head">
              <div className="hm-brand">
                <span className="hm-mark" style={{ backgroundImage: `url(${LOGO_URL})` }} aria-hidden />
                <span className="hm-wm">Growth<b>AI</b></span>
                <span className="hm-be">Sales Engine</span>
              </div>
              <h1 className="aurora-title">{greeting}{data?.firstName ? <>, <span className="hm-g">{data.firstName}</span></> : ""}</h1>
              <p className="aurora-sub">
                <span className="hm-date">{dateStr}</span>
                {" · "}
                {data ? (nPrio > 0 ? t("home.hero.actions", { n: nPrio }) : t("home.hero.allCaught")) : t("home.hero.loading")}
              </p>
            </div>
            <div className="aurora-acts">
              <div className="hm-ring">
                <svg width="130" height="130" viewBox="0 0 150 150">
                  <defs><linearGradient id="hmgg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F0D889" /><stop offset="1" stopColor="#C99B2E" /></linearGradient></defs>
                  <circle className="hm-rc" cx="75" cy="75" r="64" />
                  <circle className="hm-rp" cx="75" cy="75" r="64" style={{ strokeDashoffset: data ? 0 : 402 }} />
                </svg>
                <div className="hm-rt"><b className="tnum">{data ? nPrio : "—"}</b><span>{t("home.ring.today")}</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PRIMARY · START HERE ─────────────────────────────────────────── */}
      <div className="hm-sec hm-sec-primary">
        <h2>{t("home.prio.title")}</h2>
        <span className="hm-hint">{t("home.prio.hint")}</span>
        <Link className="hm-see" href="/queue?tab=inbox">{t("home.prio.viewInbox")} {ARROW}</Link>
      </div>
      <div className="hm-prio hm-prio-primary">
        {!data && !err && <div className="hm-prow hm-empty">{t("home.prio.loading")}</div>}
        {data && data.priorities.length === 0 && <div className="hm-prow hm-empty">{t("home.prio.empty")}</div>}
        {data?.priorities.map((p, i) => {
          const s = REASON_STYLE[p.reason];
          return (
            <div className="hm-prow" key={p.leadId}>
              <span className="hm-pn">{i + 1}</span>
              <span className="hm-pic" style={{ "--a": s.a, "--ab": s.ab } as CSSProperties}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{s.icon}</svg>
              </span>
              <div className="hm-pt">
                <b>{actionLabel(p.action)} {p.name ?? p.company ?? t("home.prio.thisLead")}</b>
                {p.company && p.name && <span className="hm-pco">{p.company}</span>}
                <p>{whyLine(p.reason, p.ageMs, p.overdueDays)}</p>
                {p.snippet && <p className="hm-psnip">“{p.snippet}”</p>}
              </div>
              <Link className="hm-pbtn" href={p.href}>{actionLabel(p.action)}</Link>
            </div>
          );
        })}
      </div>

      {/* ── SECONDARY · YOUR DAY + MY QUEUE ──────────────────────────────── */}
      <div className="hm-two">
        <section>
          <div className="hm-sec"><h2>{t("home.day.title")}</h2></div>
          <div className="hm-daylist">
            <Link href="/queue?tab=inbox" className="hm-dayrow">
              <span className="hm-qi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{ICONS.reply}</svg></span>
              <div>{t("home.day.replies")}<small>{t("home.day.repliesSub")}</small></div>
              <span className="hm-daygo">{ARROW}</span>
            </Link>
            {/* Calls live in the Calls tab. Linking to bare /queue landed on
                Replies — the bug Fran hit. */}
            <Link href="/queue?tab=calls" className="hm-dayrow">
              <span className="hm-qi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{ICONS.call}</svg></span>
              <div>{t("home.day.calls")}<small>{t("home.day.callsSub")}</small></div>
              <span className="hm-daygo">{ARROW}</span>
            </Link>
            {/* Assignment belongs to the ICP-ticket flow, never the generic
                lead list. Hidden entirely for sellers: a lead has no owner
                until it is in a flow, so "unassigned" is not their work. */}
            {data?.toAssignHref && (
              <Link href={data.toAssignHref} className="hm-dayrow">
                <span className="hm-qi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{ICONS.assign}</svg></span>
                <div>{t("home.day.unassigned")}<small>{t("home.day.unassignedSub")}</small></div>
                <span className="hm-daygo">{ARROW}</span>
              </Link>
            )}
          </div>
        </section>

        <section>
          <div className="hm-sec"><h2>{t("home.queue.title")}</h2></div>
          <div className="hm-score">
            <div className="hm-scg">
              <h3>{t("home.queue.activity")}</h3>
              <div className="hm-scrow"><span>{t("home.queue.connections")}</span><b className="tnum">{num(data?.activity.connections)}</b></div>
              <div className="hm-scrow"><span>{t("home.queue.messages")}</span><b className="tnum">{num(data?.activity.messages)}</b></div>
              <div className="hm-scrow"><span>{t("home.queue.emails")}</span><b className="tnum">{num(data?.activity.emails)}</b></div>
              <div className="hm-scrow"><span>{t("home.queue.callsMade")}</span><b className="tnum">{num(data?.activity.calls)}</b></div>
            </div>
            <div className="hm-scg">
              <h3>{t("home.queue.tasks")}</h3>
              <Link className="hm-scrow hm-sclink" href="/queue?tab=inbox"><span>{t("home.queue.repliesPending")}</span><b className="tnum">{num(data?.tasks.replies)}</b></Link>
              <Link className="hm-scrow hm-sclink" href="/queue?tab=calls"><span>{t("home.queue.callsPending")}</span><b className="tnum">{num(data?.tasks.calls)}</b></Link>
              <Link className="hm-scrow hm-sclink" href="/activities"><span>{t("home.queue.followUps")}</span><b className="tnum">{num(data?.tasks.followUps)}</b></Link>
              {data?.toAssignHref && (
                <Link className="hm-scrow hm-sclink" href={data.toAssignHref}><span>{t("home.queue.toAssign")}</span><b className="tnum">{num(data.tasks.toAssign)}</b></Link>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* ── TERTIARY · PERFORMANCE ───────────────────────────────────────── */}
      <div className="hm-sec hm-sec-tertiary"><h2>{t("home.perf.title")}</h2></div>
      <div className="hm-perf">
        <div className="hm-pf"><b className="tnum">{num(data?.performance.reached)}</b><span>{t("home.perf.reached")}</span></div>
        <div className="hm-pf"><b className="tnum">{num(data?.performance.replies)}</b><span>{t("home.perf.replies")}</span></div>
        <div className="hm-pf"><b className="tnum">{num(data?.performance.positives)}</b><span>{t("home.perf.positives")}</span></div>
        <div className="hm-pf hm-pf-goal">
          {/* With a target: "6 / 10" + bar. Without one: just the count — no
              invented denominator, no bar that means nothing. */}
          <b className="tnum">
            {num(data?.performance.meetings)}
            {data?.performance.target != null && <span className="hm-of"> / {data.performance.target}</span>}
          </b>
          <span>{t("home.perf.meetings")}</span>
          {data?.performance.target != null && (
            <div className="hm-bar" role="progressbar"
              aria-valuenow={data.performance.meetings} aria-valuemin={0} aria-valuemax={data.performance.target}>
              <i style={{ width: `${Math.min(100, (data.performance.meetings / data.performance.target) * 100)}%` }} />
            </div>
          )}
        </div>
      </div>

      {err && <p className="hm-err">{t("home.err")}</p>}

      {/* Floating Copilot */}
      {botOpen ? (
        <div className="hm-botpanel">
          <div className="hm-both">
            <span className="hm-mark hm-both-mark" style={{ backgroundImage: `url(${LOGO_URL})` }} aria-hidden />
            <div className="hm-bt"><b>Copilot</b><span>{t("home.copilot.subtitle")}</span></div>
            <button className="hm-botx" onClick={() => setBotOpen(false)} aria-label="Copilot">×</button>
          </div>
          <div className="hm-botbody"><CopilotChat embedded /></div>
        </div>
      ) : (
        <button className="hm-fab" onClick={() => setBotOpen(true)} aria-label="Copilot">
          <span className="hm-mark hm-fab-mark" style={{ backgroundImage: `url(${LOGO_URL})` }} aria-hidden />
        </button>
      )}
    </div>
  );
}
