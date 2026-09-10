"use client";

// ─────────────────────────────────────────────────────────────────────────
// CHANNELS — "which channel earns a reply?"
//
// Back to CARDS, because a channel is an object and a card is how you show
// an object: its own mark, its own volume, its own result, its own outcome
// mix. Four of them, side by side, nothing forced onto a shared axis.
//
// The rule survives the redesign, it just moves: the cards do not rank each
// other. Ranking happens once, underneath, in a head-to-head that contains
// ONLY the two channels that are the same measurement — LinkedIn DM and
// Email. Invitation acceptance and call connect rate keep their cards, keep
// their numbers, and stay out of the ranking, with the reason written where
// the ranking is.
//
// Every card answers the same three questions in the same three places:
// how many went out · how many people that reached · what came back.
// ─────────────────────────────────────────────────────────────────────────

import { C } from "@/lib/design";
import {
  gold, n, Band, Opening, Drill, Note, Eyebrow, WorthALook, DeltaTag,
  ChannelMark, CH_COLOR, OutcomeBar, TONE,
} from "./ui";
import type * as CT from "@/lib/console-data";
import { useT } from "./ctx";
import { useLocale } from "@/lib/i18n";

/* ── the card ───────────────────────────────────────────────────────────── */

function Card({ c }: { c: CT.ChannelCard }) {
  const color = CH_COLOR[c.key];
  return (
    <div className="rounded-2xl p-5 flex flex-col"
      style={{ backgroundColor: C.card, border: `1px solid ${c.comparable ? `color-mix(in srgb, ${color} 30%, ${C.border})` : C.border}` }}>

      {/* mark + name + the headline rate */}
      <div className="flex items-start gap-3 mb-4">
        <ChannelMark ch={c.key} size={36} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate" style={{ fontSize: 13.5, color: C.textPrimary }}>{c.label}</div>
          <div style={{ fontSize: 10.5, color: C.textDim }}>{c.rateLabel}</div>
        </div>
      </div>

      <div className="flex items-baseline gap-2 mb-4">
        <span className="font-semibold tabular-nums" style={{ fontSize: 34, letterSpacing: "-0.03em", color: C.textPrimary }}>{c.rate == null ? "—" : `${c.rate}%`}</span>
        <DeltaTag d={c.delta} size={11} />
      </div>

      {/* the three counts, always in this order */}
      <div className="grid grid-cols-3 mb-4" style={{ gap: 8 }}>
        {[
          { v: c.sent, l: c.sentLabel },
          { v: c.reach, l: c.reachLabel },
          { v: c.result, l: c.resultLabel, hot: true },
        ].map(x => (
          <div key={x.l} className="min-w-0">
            <div className="tabular-nums truncate" style={{ fontSize: 15, fontWeight: 600, color: x.hot ? gold : C.textBody }}>{n(x.v)}</div>
            <div className="truncate" style={{ fontSize: 9.5, color: C.textDim, lineHeight: 1.3 }}>{x.l}</div>
          </div>
        ))}
      </div>

      {/* outcome mix */}
      <OutcomeBar rows={c.outcomes} />
      <div className="flex flex-wrap mt-2.5" style={{ gap: "5px 12px" }}>
        {c.outcomes.filter(o => o.n > 0).map(o => (
          <span key={o.label} className="inline-flex items-baseline gap-1.5">
            <span className="rounded-sm shrink-0 self-center" style={{ width: 7, height: 7, backgroundColor: TONE[o.tone] }} />
            <span className="tabular-nums font-semibold" style={{ fontSize: 11, color: C.textBody }}>{o.n}</span>
            <span style={{ fontSize: 10.5, color: C.textMuted }}>{o.label.toLowerCase()}</span>
          </span>
        ))}
        {c.outcomes.filter(o => o.n === 0).map(o => (
          <span key={o.label} style={{ fontSize: 10.5, color: C.textDim }}>0 {o.label.toLowerCase()}</span>
        ))}
      </div>

      <div className="flex-1" />
      <p className="mt-4 pt-3" style={{ fontSize: 10.5, color: C.textDim, lineHeight: 1.5, borderTop: `1px solid ${C.border}` }}>
        {c.caveat}
      </p>
    </div>
  );
}

/* ── head to head ───────────────────────────────────────────────────────
   Two channels, mirrored across a shared centre line, so the comparison is
   the geometry rather than two numbers you have to subtract. Only the pair
   that is genuinely comparable appears here. */

function HeadToHead() {
  const T = useT();
  const { t } = useLocale();
  const rows = T.channelCards.filter(c => c.comparable);
  const [a, b] = rows;
  const maxRate = Math.max(a.rate ?? 0, b.rate ?? 0);
  const maxVol = Math.max(a.sent, b.sent);

  const LINES: { label: string; get: (c: CT.ChannelCard) => number; fmt: (v: number) => string; scale: number }[] = [
    { label: t("cons.chan.replyRate"), get: c => c.rate ?? 0, fmt: v => `${v}%`, scale: maxRate },
    { label: t("cons.chan.messagesSent"), get: c => c.sent, fmt: v => n(v), scale: maxVol },
    { label: t("cons.chan.leadsReached"), get: c => c.reach, fmt: v => n(v), scale: maxVol },
    { label: t("cons.chan.leadsReplied"), get: c => c.result, fmt: v => n(v), scale: Math.max(a.result, b.result) },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        {[a, b].map((c, i) => (
          <div key={c.key} className={`flex-1 flex items-center gap-2 ${i === 1 ? "justify-end" : ""}`}>
            {i === 0 && <ChannelMark ch={c.key} size={30} />}
            <span className="font-semibold" style={{ fontSize: 13.5, color: C.textPrimary }}>{c.label}</span>
            {i === 1 && <ChannelMark ch={c.key} size={30} />}
          </div>
        ))}
      </div>

      <div className="flex flex-col" style={{ gap: 15 }}>
        {LINES.map(L => {
          const va = L.get(a), vb = L.get(b);
          const wa = (va / L.scale) * 100, wb = (vb / L.scale) * 100;
          return (
            <div key={L.label} className="flex items-center" style={{ gap: 10 }}>
              <span className="w-[54px] shrink-0 text-right tabular-nums font-semibold" style={{ fontSize: 13, color: va >= vb ? C.textPrimary : C.textMuted }}>
                {L.fmt(va)}
              </span>
              <div className="flex-1 flex justify-end">
                <div className="rounded-l-full" style={{ width: `${wa}%`, height: 12, backgroundColor: CH_COLOR[a.key], opacity: va >= vb ? 1 : .45 }} />
              </div>
              <span className="shrink-0 text-center" style={{ width: 106, fontSize: 10.5, color: C.textMuted }}>{L.label}</span>
              <div className="flex-1">
                <div className="rounded-r-full" style={{ width: `${wb}%`, height: 12, backgroundColor: CH_COLOR[b.key], opacity: vb >= va ? 1 : .45 }} />
              </div>
              <span className="w-[54px] shrink-0 tabular-nums font-semibold" style={{ fontSize: 13, color: vb >= va ? C.textPrimary : C.textMuted }}>
                {L.fmt(vb)}
              </span>
            </div>
          );
        })}
      </div>

      <Note>{T.headToHeadNote}</Note>
    </div>
  );
}

/* ── volume, to one scale ───────────────────────────────────────────────── */

function Volume() {
  const T = useT();
  const { t } = useLocale();
  const cards = T.channelCards;
  const max = Math.max(...cards.map(c => c.sent));
  return (
    <div>
      <div className="flex flex-col" style={{ gap: 16 }}>
        {cards.map(c => (
          <div key={c.key}>
            <div className="flex items-baseline gap-3 mb-1.5">
              <span style={{ fontSize: 12.5, color: C.textBody }}>{c.label}</span>
              <div className="flex-1" />
              <span className="tabular-nums font-semibold" style={{ fontSize: 13, color: C.textPrimary }}>{n(c.sent)}</span>
              <span style={{ fontSize: 11, color: C.textDim }}>{c.sentLabel.replace(/^\d+\s*/, "")}</span>
            </div>
            <div className="relative h-3 rounded-full" style={{ backgroundColor: C.surface }}>
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${max > 0 ? (c.sent / max) * 100 : 0}%`, backgroundColor: CH_COLOR[c.key], opacity: .35 }} />
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${max > 0 ? (c.reach / max) * 100 : 0}%`, backgroundColor: CH_COLOR[c.key] }} />
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${max > 0 ? Math.max((c.result / max) * 100, 0.4) : 0}%`, backgroundColor: gold }} />
            </div>
            <div className="mt-1 tabular-nums" style={{ fontSize: 11, color: C.textDim }}>
              {n(c.reach)} {c.reachLabel} · <span style={{ color: gold, fontWeight: 600 }}>{n(c.result)} {c.resultLabel}</span>
            </div>
          </div>
        ))}
      </div>
      <Note>
        One scale across all four: the pale segment is what went out, the solid one the people it reached, the gold tip what came back.
        Email sends 11× what the two LinkedIn legs send together. {T.channelWhatsApp}
      </Note>
    </div>
  );
}

export default function Channels({ label }: { label: string }) {
  const T = useT();
  const { t } = useLocale();
  return (
    <>
      <Opening question={t("cons.ov.q2")} sub={t("cons.ov.in", { label })} aside={<Drill label={t("cons.chan.inbox")} />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4" style={{ gap: 16 }}>
          {T.channelCards.map(c => <Card key={c.key} c={c} />)}
        </div>
        <Note>
          Each card keeps its own numerator and denominator. The two with a tinted border — LinkedIn DM and Email — are the only
          pair measuring the same thing; the other two are real numbers about different events and are not ranked against them.
        </Note>
      </Opening>

      <Band question={t("cons.chan.headToHead")} sub={t("cons.chan.headToHeadSub")}>
        <HeadToHead />
      </Band>

      <section style={{ paddingTop: 44 }}>
        <WorthALook title={T.channelWorthALook.title} facts={T.channelWorthALook.facts} />
      </section>

      <Band question={t("cons.chan.q2")}>
        <Volume />
      </Band>

      <Band question={t("cons.noLongerShows")}>
        <Eyebrow>{t("cons.removed")}</Eyebrow>
        <ul className="flex flex-col" style={{ gap: 9, maxWidth: 800 }}>
          {[
            [t("cons.chan.rm1"), t("cons.chan.rm1d")],
            [t("cons.chan.rm2"), t("cons.chan.rm2d")],
            [t("cons.chan.rm3"), t("cons.chan.rm3d")],
          ].map(([k, v]) => (
            <li key={k} className="flex items-baseline gap-2.5">
              <span className="shrink-0 rounded-full" style={{ width: 4, height: 4, backgroundColor: C.textDim, transform: "translateY(-2px)" }} />
              <span style={{ fontSize: 12.5, color: C.textBody, lineHeight: 1.55 }}>
                <strong style={{ color: C.textPrimary }}>{k}</strong> — {v}
              </span>
            </li>
          ))}
        </ul>
      </Band>
    </>
  );
}
