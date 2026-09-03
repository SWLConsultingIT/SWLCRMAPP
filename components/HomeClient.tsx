"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import CopilotChat from "@/components/CopilotChat";
import type { HomeData } from "@/lib/home-data";

const LOGO_URL = "https://framerusercontent.com/images/xDo4WIo9yWn44s4NzORGGAUNxrI.png";

type Card = {
  key: keyof HomeData["counts"];
  label: string; note: (d: HomeData) => string; cta: string; href: string;
  accent: string; accentBg: string; icon: JSX.Element;
};

const ICONS = {
  reply: <path d="M4 5h16v11H7l-3 3V5z" />,
  call: <path d="M4 4h4l2 5-3 2a11 11 0 006 6l2-3 5 2v4a2 2 0 01-2 2A16 16 0 014 6a2 2 0 012-2z" />,
  followup: <><path d="M4 4v6h6M20 20v-6h-6M20 9a8 8 0 00-14-3M4 15a8 8 0 0014 3" /></>,
  assign: <><circle cx="12" cy="8" r="3.4" /><path d="M5 20c0-3.3 3-5.5 7-5.5M17 14v6M14 17h6" /></>,
};

const CARDS: Card[] = [
  { key: "replies", label: "Responder replies", note: d => d.counts.positives > 0 ? `${d.counts.positives} positivas esperando` : "Pendientes de revisar", cta: "Responder", href: "/queue", accent: "var(--c-reply)", accentBg: "var(--c-reply-bg)", icon: ICONS.reply },
  { key: "calls", label: "Hacer llamadas", note: () => "De tu cola de hoy", cta: "Ver cola", href: "/queue", accent: "var(--c-call)", accentBg: "var(--c-call-bg)", icon: ICONS.call },
  { key: "unassigned", label: "Sin asignar", note: () => "Esperando dueño", cta: "Asignar", href: "/leads", accent: "var(--c-assign)", accentBg: "var(--c-assign-bg)", icon: ICONS.assign },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
}

function today(): string {
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
}

const PRIO_META: Record<string, { verb: string; cta: string; href: (id: string) => string; accent: string; accentBg: string; icon: JSX.Element }> = {
  reply: { verb: "Responder a", cta: "Responder", href: () => "/queue", accent: "var(--c-reply)", accentBg: "var(--c-reply-bg)", icon: ICONS.reply },
  call: { verb: "Llamar a", cta: "Abrir", href: id => `/leads/${id}`, accent: "var(--c-call)", accentBg: "var(--c-call-bg)", icon: ICONS.call },
  followup: { verb: "Retomar a", cta: "Abrir", href: id => `/leads/${id}`, accent: "var(--c-stale)", accentBg: "var(--c-stale-bg)", icon: ICONS.followup },
};

export default function HomeClient() {
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

  const total = data ? data.counts.replies + data.counts.calls + data.counts.followup + data.counts.unassigned : 0;
  const arrow = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;

  return (
    <div className="hm-wrap">
      {/* HERO — same AuroraHero look as the rest of the app */}
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
              <h1 className="aurora-title">{greeting()}{data?.firstName ? <>, <span className="hm-g">{data.firstName}</span></> : ""}</h1>
              <p className="aurora-sub">
                <span className="hm-date">{today()}</span>
                {data
                  ? total > 0
                    ? <> · Tenés <b>{total} {total === 1 ? "acción" : "acciones"}</b> para hoy — arrancá por lo que más mueve la aguja.</>
                    : <> · Estás al día. No hay nada urgente ahora mismo. 🎉</>
                  : <> · Cargando tu día…</>}
              </p>
            </div>
            <div className="aurora-acts">
              <div className="hm-ring">
                <svg width="130" height="130" viewBox="0 0 150 150">
                  <defs><linearGradient id="hmgg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F0D889" /><stop offset="1" stopColor="#C99B2E" /></linearGradient></defs>
                  <circle className="hm-rc" cx="75" cy="75" r="64" />
                  <circle className="hm-rp" cx="75" cy="75" r="64" style={{ strokeDashoffset: data ? 0 : 402 }} />
                </svg>
                <div className="hm-rt"><b className="tnum">{data ? total : "—"}</b><span>para hoy</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TU DÍA */}
      <div className="hm-sec"><h2>Tu día</h2><span className="hm-hint">lo que necesita tu atención, ahora</span></div>
      <div className="hm-day">
        {CARDS.map(c => {
          const n = data ? data.counts[c.key] : null;
          return (
            <Link key={c.key} href={c.href} className="hm-card" style={{ "--accent": c.accent, "--accent-bg": c.accentBg } as CSSProperties}>
              <div className="hm-ctop">
                <span className="hm-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{c.icon}</svg></span>
                <span className="hm-n tnum">{n === null ? "—" : n}</span>
              </div>
              <div className="hm-lb">{c.label}</div>
              <div className="hm-note">{data ? c.note(data) : " "}</div>
              <span className="hm-cta">{c.cta} {arrow}</span>
            </Link>
          );
        })}
      </div>

      {/* EMPEZÁ POR ACÁ */}
      <div className="hm-sec"><h2>Empezá por acá</h2><span className="hm-hint">tus prioridades de hoy</span><Link className="hm-see" href="/queue">Ver Inbox <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="M5 12h14M13 6l6 6-6 6" /></svg></Link></div>
      <div className="hm-prio">
        {!data && <div className="hm-prow hm-empty">Cargando prioridades…</div>}
        {data && data.priorities.length === 0 && <div className="hm-prow hm-empty">Nada urgente por ahora. Buen momento para sumar leads o crear un flow. 🚀</div>}
        {data && data.priorities.map((p, i) => {
          const m = PRIO_META[p.kind];
          return (
            <div className="hm-prow" key={i}>
              <span className="hm-pn">{i + 1}</span>
              <span className="hm-pic" style={{ "--a": m.accent, "--ab": m.accentBg } as CSSProperties}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{m.icon}</svg></span>
              <div className="hm-pt"><b>{m.verb} {p.name ?? p.company}{p.name ? ` — ${p.company}` : ""}</b><p>{p.detail ?? ""}</p></div>
              {p.tag && <span className="hm-ptag">{p.tag}</span>}
              <Link className={`hm-pbtn${p.kind === "followup" ? " ghost" : ""}`} href={m.href(p.leadId)}>{m.cta}</Link>
            </div>
          );
        })}
      </div>

      {/* ACCESOS RÁPIDOS */}
      <div className="hm-sec"><h2>Accesos rápidos</h2></div>
      <div className="hm-qa">
        <Link href="/campaigns" className="hm-qcard"><span className="hm-qi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 11l18-8-8 18-2-8-8-2z" /></svg></span><div>Crear flow<small>Nueva campaña multicanal</small></div></Link>
        <Link href="/leads/import" className="hm-qcard"><span className="hm-qi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 3v12M8 11l4 4 4-4M4 21h16" /></svg></span><div>Importar leads<small>Subí un CSV o pegá una lista</small></div></Link>
        <Link href="/queue" className="hm-qcard"><span className="hm-qi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M4 5h16v11H7l-3 3V5z" /></svg></span><div>Ir al Inbox<small>{data ? `${data.counts.replies} sin responder` : "Ver replies"}</small></div></Link>
      </div>
      {err && <p className="hm-err">No pudimos cargar tu día. Recargá la página.</p>}

      {/* Floating Copilot — real chat (ES/EN/FR), embeds CopilotChat */}
      {botOpen ? (
        <div className="hm-botpanel">
          <div className="hm-both">
            <span className="hm-mark hm-both-mark" style={{ backgroundImage: `url(${LOGO_URL})` }} aria-hidden />
            <div className="hm-bt"><b>Copilot</b><span>Preguntame en español, inglés o francés</span></div>
            <button className="hm-botx" onClick={() => setBotOpen(false)} aria-label="Cerrar Copilot">×</button>
          </div>
          <div className="hm-botbody"><CopilotChat /></div>
        </div>
      ) : (
        <button className="hm-fab" onClick={() => setBotOpen(true)} aria-label="Abrir Copilot">
          <span className="hm-mark hm-fab-mark" style={{ backgroundImage: `url(${LOGO_URL})` }} aria-hidden />
        </button>
      )}
    </div>
  );
}
