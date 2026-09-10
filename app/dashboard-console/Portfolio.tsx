"use client";

// ─────────────────────────────────────────────────────────────────────────
// PORTFOLIO — "how is each client doing?" · super-admin only.
//
// THE JUDGEMENT: the tab earns its place. It is the only cross-tenant view
// in the product and it backs the weekly status PDF at
// /reports/portfolio-print. No other screen answers the question.
//
// THE COMPARISON PICKER IS BACK, and it is the point of the tab rather than
// a filter bolted on: tick two or more clients and a head-to-head panel
// appears above the list, putting them on the same axes. That is what
// "compare clients" means; a list you have to read across is not it.
//
// What the tab still does not do: a 12-metric grid over eight companies.
// At 7 days two tenants have activity and SWL is 99.8% of it, so the
// default is 30 days; the four that sent nothing are named with the reason
// instead of drawn as rows of zeros; and meetings/wins are out because both
// are guaranteed zero on every tenant.
// ─────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { Check, X } from "lucide-react";
import { C } from "@/lib/design";
import {
  gold, n, S, Band, Opening, Drill, Note, Eyebrow, WorthALook, DeltaTag, type Delta,
} from "./ui";
import * as T from "./tabs-data";
import { useLocale } from "@/lib/i18n";

function trend(now: number, prev: number): Delta {
  if (prev === 0) return null;
  return { v: Math.round(((now - prev) / prev) * 100), unit: "pct" };
}

const SWATCH = ["#C9A83A", "#5B9BD5", "#5FAF7E", "#C0553F"];

/* ── the picker ─────────────────────────────────────────────────────────
   Chips rather than a dropdown: with four active clients the whole choice
   set fits on one line, and a dropdown would hide it behind a click. */

function Picker({ sel, toggle, clear, all }: {
  sel: Set<string>; toggle: (n: string) => void; clear: () => void; all: () => void;
}) {
  const { t: tr } = useLocale();
  const maxVol = Math.max(...T.tenants.map(t => t.contacted));
  // The swatch must be assigned in the SAME order the head-to-head uses
  // (list order, not click order), or a client is gold in the picker and
  // blue in the comparison two inches below it.
  const order = T.tenants.filter(x => sel.has(x.name)).map(x => x.name);
  return (
    <div>
      <div className="flex items-baseline gap-3 mb-3 flex-wrap">
        <span className="font-semibold uppercase tracking-wider" style={{ fontSize: 9.5, color: C.textMuted }}>{tr("cons.port.compareClients")}</span>
        <span style={{ fontSize: 11, color: C.textDim }}>
          {sel.size === 0 ? tr("cons.port.pickHint", { n: T.tenants.length })
            : sel.size === 1 ? tr("cons.port.pickOneMore")
            : tr("cons.port.selected", { n: sel.size })}
        </span>
        <div className="flex-1" />
        {sel.size > 0 ? (
          <button onClick={clear} className="inline-flex items-center gap-1 font-medium" style={{ fontSize: 11.5, color: C.textMuted }}>
            <X size={11} /> Clear
          </button>
        ) : (
          <button onClick={all} className="font-medium" style={{ fontSize: 11.5, color: gold }}>{tr("cons.port.compareAllN", { n: T.tenants.length })}</button>
        )}
      </div>

      {/* Each option is a small card rather than a pill: the client's name,
          its reply rate and a bar for its volume, so the choice is made on
          the numbers instead of on the name alone. */}
      <div className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: 10 }}>
        {T.tenants.map(t => {
          const on = sel.has(t.name);
          const swatch = SWATCH[order.indexOf(t.name) % SWATCH.length];
          return (
            <button key={t.name} onClick={() => toggle(t.name)} aria-pressed={on}
              className="text-left rounded-xl px-3.5 py-3 transition-colors"
              style={{
                backgroundColor: on ? `color-mix(in srgb, ${gold} 7%, ${C.card})` : C.card,
                border: `1px solid ${on ? `color-mix(in srgb, ${gold} 45%, transparent)` : C.border}`,
              }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center justify-center rounded-md shrink-0"
                  style={{
                    width: 15, height: 15,
                    border: `1.5px solid ${on ? (swatch ?? gold) : C.border2}`,
                    backgroundColor: on ? (swatch ?? gold) : "transparent",
                  }}>
                  {on && <Check size={10} strokeWidth={3} color="#141414" />}
                </span>
                <span className="font-semibold truncate" style={{ fontSize: 12.5, color: on ? C.textPrimary : C.textBody }}>{t.name}</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="tabular-nums font-semibold" style={{ fontSize: 18, letterSpacing: "-0.02em", color: on ? C.textPrimary : C.textMuted }}>{t.rate}%</span>
                <span style={{ fontSize: 10, color: C.textDim }}>{tr("cons.port.replyRateLow")}</span>
              </div>
              <div className="mt-1.5 h-1 rounded-full" style={{ backgroundColor: C.surface }}>
                <div className="h-full rounded-full"
                  style={{ width: `${Math.max((t.contacted / maxVol) * 100, 2)}%`, backgroundColor: on ? (swatch ?? gold) : C.border2 }} />
              </div>
              <div className="tabular-nums mt-1" style={{ fontSize: 10, color: C.textDim }}>
                {n(t.contacted)} {tr("cons.port.contacted")} · {t.calls === 0 ? tr("cons.port.noCalls") : tr("cons.port.callsN", { n: t.calls })}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── head to head ───────────────────────────────────────────────────────
   Same axes, one row per measure, bars to a shared scale within the row.
   Only appears with two or more picked, because a comparison of one is a
   row you already have below. */

// labelKey, not label: AXES is module scope and has no translator.
const AXES: { labelKey: string; get: (t: T.Tenant) => number; fmt: (v: number) => string }[] = [
  { labelKey: "cons.port.replyRate", get: t => t.rate, fmt: v => `${v}%` },
  { labelKey: "cons.port.leadsContacted", get: t => t.contacted, fmt: n },
  { labelKey: "cons.port.messagesSent", get: t => t.messages, fmt: n },
  { labelKey: "cons.port.calls", get: t => t.calls, fmt: n },
  { labelKey: "cons.port.leadsReplied", get: t => t.replies, fmt: n },
  { labelKey: "cons.port.positiveReplies", get: t => t.positive, fmt: n },
  { labelKey: "cons.port.activeFlows", get: t => t.activeFlows, fmt: n },
];

function Compare({ picked }: { picked: T.Tenant[] }) {
  const { t: tr } = useLocale();
  return (
    <div>
      <div className="flex items-center flex-wrap mb-5" style={{ gap: 18 }}>
        {picked.map((t, i) => (
          <span key={t.name} className="inline-flex items-center gap-2">
            <span className="rounded-sm shrink-0" style={{ width: 10, height: 10, backgroundColor: SWATCH[i % SWATCH.length] }} />
            <span className="font-semibold" style={{ fontSize: 13, color: C.textPrimary }}>{t.name}</span>
            <span className="tabular-nums" style={{ fontSize: 11, color: C.textDim }}>{n(t.leads)} leads</span>
          </span>
        ))}
      </div>

      <div className="flex flex-col" style={{ gap: 16 }}>
        {AXES.map(A => {
          const vals = picked.map(A.get);
          const max = Math.max(...vals, 1);
          const lead = Math.max(...vals);
          return (
            <div key={A.labelKey}>
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="font-semibold uppercase tracking-wider" style={{ fontSize: 9.5, color: C.textMuted }}>{tr(A.labelKey)}</span>
                {lead === 0 && <span style={{ fontSize: 10.5, color: C.textDim }}>{tr("cons.port.noneForThese")}</span>}
              </div>
              <div className="flex flex-col" style={{ gap: 5 }}>
                {picked.map((t, i) => {
                  const v = A.get(t);
                  return (
                    <div key={t.name} className="flex items-center gap-3">
                      <div className="flex-1 h-3 rounded-full min-w-[40px]" style={{ backgroundColor: C.surface }}>
                        {v > 0 && (
                          <div className="h-full rounded-full"
                            style={{ width: `${Math.max((v / max) * 100, 1)}%`, backgroundColor: SWATCH[i % SWATCH.length], opacity: v === lead ? 1 : .55 }} />
                        )}
                      </div>
                      <span className="w-[74px] shrink-0 text-right tabular-nums font-semibold"
                        style={{ fontSize: 12.5, color: v === lead && v > 0 ? C.textPrimary : C.textMuted }}>
                        {v === 0 ? "—" : A.fmt(v)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <Note>
        Bars are scaled within their own row, so a row compares the picked clients with each other and never across measures.
        Reply rate is leads that replied over leads contacted in the period, the same definition used everywhere else in this mock.
      </Note>
    </div>
  );
}

/* ── the list ───────────────────────────────────────────────────────────── */

function Row({ t, best, maxVol, dim }: { t: T.Tenant; best: number; maxVol: number; dim: boolean }) {
  const { t: tr } = useLocale();
  return (
    <div className="flex items-center gap-4 py-4" style={{ borderTop: `1px solid ${C.border}`, opacity: dim ? .4 : 1 }}>
      <div className="w-[176px] shrink-0 min-w-0">
        <div className="font-medium truncate" style={{ fontSize: 13.5, color: C.textPrimary }}>{t.name}</div>
        <div className="tabular-nums" style={{ fontSize: 11, color: C.textDim }}>
          {n(t.leads)} leads · {n(t.activeFlows)} active flows
        </div>
      </div>

      <div className="w-[150px] shrink-0">
        <div className="flex items-baseline gap-1.5">
          <span className="tabular-nums font-semibold" style={{ fontSize: 13, color: C.textBody }}>{n(t.contacted)}</span>
          <span style={{ fontSize: 10.5, color: C.textDim }}>{tr("cons.port.contacted")}</span>
          <DeltaTag d={trend(t.contacted, t.contactedPrev)} size={10} />
        </div>
        <div className="mt-1 h-1.5 rounded-full" style={{ backgroundColor: C.surface }}>
          <div className="h-full rounded-full" style={{ width: `${Math.max((t.contacted / maxVol) * 100, 1.5)}%`, backgroundColor: `color-mix(in srgb, ${gold} 42%, transparent)` }} />
        </div>
        <div className="tabular-nums mt-1" style={{ fontSize: 10, color: C.textDim }}>
          {n(t.messages)} {tr("cons.port.messages")} · {t.calls === 0 ? tr("cons.port.noCalls") : tr("cons.port.callsN", { n: t.calls })}
        </div>
      </div>

      <div className="flex-1 h-2 rounded-full min-w-[50px]" style={{ backgroundColor: C.surface }}>
        <div className="h-full rounded-full" style={{ width: `${best > 0 ? (t.rate / best) * 100 : 0}%`, backgroundColor: gold, opacity: .9 }} />
      </div>

      <div className="w-[92px] shrink-0 text-right">
        <div className="font-semibold tabular-nums" style={{ fontSize: 16, color: C.textPrimary }}>{t.rate}%</div>
        <div className="tabular-nums" style={{ fontSize: 10.5, color: C.textDim }}>
          {t.replies} replied <DeltaTag d={trend(t.replies, t.repliesPrev)} size={10} />
        </div>
      </div>

      <div className="w-[62px] shrink-0 text-right">
        <div className="font-semibold tabular-nums" style={{ fontSize: 14, color: t.positive > 0 ? C.green : C.textDim }}>{t.positive}</div>
        <div style={{ fontSize: 10, color: C.textDim }}>{tr("cons.port.positive")}</div>
      </div>
    </div>
  );
}

export default function Portfolio({ label }: { label: string }) {
  const { t } = useLocale();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (nm: string) => setSel(s => {
    const next = new Set(s);
    if (next.has(nm)) next.delete(nm); else next.add(nm);
    return next;
  });
  const picked = T.tenants.filter(t => sel.has(t.name));
  const best = Math.max(...T.tenants.map(t => t.rate));
  const maxVol = Math.max(...T.tenants.map(t => t.contacted));
  const p = T.portfolioTotals;

  return (
    <>
      <Opening question={t("cons.port.q1")} sub={t("cons.ov.in", { label })} aside={<Drill label={t("cons.port.weeklyPdf")} />}>
        <div className="flex items-baseline gap-2 mb-4 flex-wrap">
          <span className="font-semibold tabular-nums" style={{ fontSize: S.minor, color: C.textPrimary }}>{p.tenants}</span>
          <span style={{ fontSize: 12, color: C.textMuted }}>{t("cons.port.clientsSent")}</span>
          <span style={{ fontSize: 12, color: C.textDim }}>·</span>
          <span className="font-semibold tabular-nums" style={{ fontSize: S.minor, color: C.textBody }}>{n(p.contacted)}</span>
          <span style={{ fontSize: 12, color: C.textMuted }}>{t("cons.port.contacted")}</span>
          <span style={{ fontSize: 12, color: C.textDim }}>·</span>
          <span className="font-semibold tabular-nums" style={{ fontSize: S.minor, color: C.textBody }}>{p.replies}</span>
          <span style={{ fontSize: 12, color: C.textMuted }}>{t("cons.port.replied")}</span>
          <div className="flex-1" />
          <span className="inline-flex items-center gap-1.5 font-bold px-2.5 py-0.5 rounded-full border"
            style={{ fontSize: 9.5, borderColor: C.border, color: C.textMuted }}>{t("cons.port.superAdmin")}</span>
        </div>

        <div className="mb-7">
          <Picker sel={sel} toggle={toggle} clear={() => setSel(new Set())} all={() => setSel(new Set(T.tenants.map(t => t.name)))} />
        </div>

        {picked.length >= 2 && (
          <div className="rounded-2xl px-6 py-6 mb-8"
            style={{ backgroundColor: C.card, border: `1px solid color-mix(in srgb, ${gold} 26%, transparent)` }}>
            <Eyebrow note={t("cons.port.sameAxes", { n: picked.length })}>{t("cons.port.headToHead")}</Eyebrow>
            <Compare picked={picked} />
          </div>
        )}

        <div>
          {T.tenants.map(t => (
            <Row key={t.name} t={t} best={best} maxVol={maxVol} dim={sel.size > 0 && !sel.has(t.name)} />
          ))}
          <div style={{ borderTop: `1px solid ${C.border}` }} />
        </div>

        <div className="mt-6 pt-4" style={{ borderTop: `1px dashed ${C.border}` }}>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="font-semibold uppercase tracking-wider" style={{ fontSize: 9.5, color: C.textDim }}>{t("cons.port.sentNothing")}</span>
            <span className="tabular-nums" style={{ fontSize: 11, color: C.textMuted }}>{p.dormant} clients</span>
          </div>
          <div className="flex flex-wrap" style={{ gap: "8px 32px" }}>
            {T.tenantsDormant.map(d => (
              <span key={d.name} style={{ fontSize: 11.5, color: C.textMuted }}>
                <strong style={{ color: C.textBody, fontWeight: 500 }}>{d.name}</strong>
                <span style={{ color: C.textDim }}> · {n(d.leads)} leads · {d.why}</span>
              </span>
            ))}
          </div>
        </div>

        <Note>{T.portfolioCompareNote}</Note>
        <Note>{T.portfolioNote}</Note>
      </Opening>

      <section style={{ paddingTop: 44 }}>
        <WorthALook title={T.portfolioWorthALook.title} facts={T.portfolioWorthALook.facts} />
      </section>

      <Band question={t("cons.port.q2")}>
        <div className="grid grid-cols-1 lg:grid-cols-12" style={{ gap: 48 }}>
          <div className="lg:col-span-7">
            <Eyebrow>{t("cons.port.judgement")}</Eyebrow>
            <p style={{ fontSize: 13, color: C.textBody, lineHeight: 1.65, maxWidth: 620 }}>{T.portfolioVerdict}</p>
            <p className="mt-3" style={{ fontSize: 13, color: C.textBody, lineHeight: 1.65, maxWidth: 620 }}>
              The change that matters most is the default window. At 7 days two clients have activity and SWL is 99.8% of it,
              so the comparison the tab exists for has nothing to compare. At 30 days there are four, and one of them —
              De Vera Grill at 25.8% — is the most interesting number in the whole product this month.
            </p>
          </div>
          <div className="lg:col-span-5 lg:pl-11" style={{ borderLeft: `1px solid ${C.border}` }}>
            <Eyebrow>{t("cons.removed")}</Eyebrow>
            <p style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.6 }}>{T.portfolioRemoved}</p>
            <p className="mt-3" style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.6 }}>
              Per-seller rows are gone too. A cross-client screen compares clients; who inside a client made the calls is
              the Sellers tab with that client selected.
            </p>
          </div>
        </div>
      </Band>
    </>
  );
}
