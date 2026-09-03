"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import CopilotChat from "@/components/CopilotChat";
import { useLocale } from "@/lib/i18n";
import type { HomeData } from "@/lib/home-data";

const LOGO_URL = "https://framerusercontent.com/images/xDo4WIo9yWn44s4NzORGGAUNxrI.png";

const ICONS = {
  reply: <path d="M4 5h16v11H7l-3 3V5z" />,
  call: <path d="M4 4h4l2 5-3 2a11 11 0 006 6l2-3 5 2v4a2 2 0 01-2 2A16 16 0 014 6a2 2 0 012-2z" />,
  assign: <><circle cx="12" cy="8" r="3.4" /><path d="M5 20c0-3.3 3-5.5 7-5.5M17 14v6M14 17h6" /></>,
};

type Card = {
  key: "replies" | "calls" | "unassigned";
  labelK: string; noteK: string; ctaK: string; href: string;
  accent: string; accentBg: string; icon: JSX.Element;
};

const CARDS: Card[] = [
  { key: "replies", labelK: "home.card.replies.label", noteK: "home.card.replies.pending", ctaK: "home.card.replies.cta", href: "/queue", accent: "var(--c-reply)", accentBg: "var(--c-reply-bg)", icon: ICONS.reply },
  { key: "calls", labelK: "home.card.calls.label", noteK: "home.card.calls.note", ctaK: "home.card.calls.cta", href: "/queue", accent: "var(--c-call)", accentBg: "var(--c-call-bg)", icon: ICONS.call },
  { key: "unassigned", labelK: "home.card.unassigned.label", noteK: "home.card.unassigned.note", ctaK: "home.card.unassigned.cta", href: "/leads", accent: "var(--c-assign)", accentBg: "var(--c-assign-bg)", icon: ICONS.assign },
];

const PRIO_ICON: Record<string, { icon: JSX.Element; accent: string; accentBg: string; href: (id: string) => string }> = {
  reply: { icon: ICONS.reply, accent: "var(--c-reply)", accentBg: "var(--c-reply-bg)", href: () => "/queue" },
  call: { icon: ICONS.call, accent: "var(--c-call)", accentBg: "var(--c-call-bg)", href: (id) => `/leads/${id}` },
};

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

  const total = data ? data.counts.replies + data.counts.calls + data.counts.unassigned : 0;
  const arrow = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;

  const hr = new Date().getHours();
  const greeting = t(`home.greeting.${hr < 12 ? "morning" : hr < 20 ? "afternoon" : "evening"}`);
  const rawDate = new Intl.DateTimeFormat(locale === "es" ? "es-AR" : "en-US", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const dateStr = rawDate.charAt(0).toUpperCase() + rawDate.slice(1);

  const noteFor = (c: Card): string => {
    if (!data) return " ";
    if (c.key === "replies") return data.counts.positives > 0 ? t("home.card.replies.positives", { n: data.counts.positives }) : t("home.card.replies.pending");
    return t(c.noteK);
  };

  return (
    <div className="hm-wrap">
      {/* HERO — shared AuroraHero look */}
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
                {data
                  ? total > 0
                    ? t("home.hero.actions", { n: total })
                    : t("home.hero.allCaught")
                  : t("home.hero.loading")}
              </p>
            </div>
            <div className="aurora-acts">
              <div className="hm-ring">
                <svg width="130" height="130" viewBox="0 0 150 150">
                  <defs><linearGradient id="hmgg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F0D889" /><stop offset="1" stopColor="#C99B2E" /></linearGradient></defs>
                  <circle className="hm-rc" cx="75" cy="75" r="64" />
                  <circle className="hm-rp" cx="75" cy="75" r="64" style={{ strokeDashoffset: data ? 0 : 402 }} />
                </svg>
                <div className="hm-rt"><b className="tnum">{data ? total : "—"}</b><span>{t("home.ring.today")}</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TU DÍA */}
      <div className="hm-sec"><h2>{t("home.day.title")}</h2><span className="hm-hint">{t("home.day.hint")}</span></div>
      <div className="hm-day">
        {CARDS.map(c => {
          const n = data ? data.counts[c.key] : null;
          return (
            <Link key={c.key} href={c.href} className="hm-card" style={{ "--accent": c.accent, "--accent-bg": c.accentBg } as CSSProperties}>
              <div className="hm-ctop">
                <span className="hm-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{c.icon}</svg></span>
                <span className="hm-n tnum">{n === null ? "—" : n}</span>
              </div>
              <div className="hm-lb">{t(c.labelK)}</div>
              <div className="hm-note">{noteFor(c)}</div>
              <span className="hm-cta">{t(c.ctaK)} {arrow}</span>
            </Link>
          );
        })}
      </div>

      {/* EMPEZÁ POR ACÁ */}
      <div className="hm-sec"><h2>{t("home.prio.title")}</h2><span className="hm-hint">{t("home.prio.hint")}</span><Link className="hm-see" href="/queue">{t("home.prio.viewInbox")} <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="M5 12h14M13 6l6 6-6 6" /></svg></Link></div>
      <div className="hm-prio">
        {!data && <div className="hm-prow hm-empty">{t("home.prio.loading")}</div>}
        {data && data.priorities.length === 0 && <div className="hm-prow hm-empty">{t("home.prio.empty")}</div>}
        {data && data.priorities.map((p, i) => {
          const m = PRIO_ICON[p.kind];
          const verb = p.kind === "reply" ? t("home.prio.replyVerb") : t("home.prio.callVerb");
          const cta = p.kind === "reply" ? t("home.prio.replyCta") : t("home.prio.openCta");
          const detail = p.kind === "reply"
            ? (p.detail ?? "")
            : (p.overdueDays != null ? (p.overdueDays > 0 ? t("home.prio.overdue", { n: p.overdueDays }) : t("home.prio.today")) : "");
          return (
            <div className="hm-prow" key={i}>
              <span className="hm-pn">{i + 1}</span>
              <span className="hm-pic" style={{ "--a": m.accent, "--ab": m.accentBg } as CSSProperties}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{m.icon}</svg></span>
              <div className="hm-pt"><b>{verb} {p.name ?? p.company}{p.name ? ` — ${p.company}` : ""}</b><p>{detail}</p></div>
              {p.tag && <span className="hm-ptag">{t("home.prio.tagPositive")}</span>}
              <Link className="hm-pbtn" href={m.href(p.leadId)}>{cta}</Link>
            </div>
          );
        })}
      </div>

      {/* ACCESOS RÁPIDOS */}
      <div className="hm-sec"><h2>{t("home.qa.title")}</h2></div>
      <div className="hm-qa">
        <Link href="/campaigns" className="hm-qcard"><span className="hm-qi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 11l18-8-8 18-2-8-8-2z" /></svg></span><div>{t("home.qa.createFlow")}<small>{t("home.qa.createFlowSub")}</small></div></Link>
        <Link href="/leads/import" className="hm-qcard"><span className="hm-qi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 3v12M8 11l4 4 4-4M4 21h16" /></svg></span><div>{t("home.qa.import")}<small>{t("home.qa.importSub")}</small></div></Link>
        <Link href="/queue" className="hm-qcard"><span className="hm-qi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 5h16v11H7l-3 3V5z" /></svg></span><div>{t("home.qa.inbox")}<small>{data ? t("home.qa.inboxSub", { n: data.counts.replies }) : " "}</small></div></Link>
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
          <div className="hm-botbody"><CopilotChat /></div>
        </div>
      ) : (
        <button className="hm-fab" onClick={() => setBotOpen(true)} aria-label="Copilot">
          <span className="hm-mark hm-fab-mark" style={{ backgroundImage: `url(${LOGO_URL})` }} aria-hidden />
        </button>
      )}
    </div>
  );
}
