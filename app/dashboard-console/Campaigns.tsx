"use client";

// ─────────────────────────────────────────────────────────────────────────
// CAMPAIGNS — "which sequence works, and where does it stall?"
//
// GROUPED BY ICP, which is the thing the previous draft got wrong. A flat
// list ranked nine flows against each other across seven different markets:
// Odoo Argentina at 9.3% and PE & VC USA at 0.4% are not a league table,
// they are two different audiences. Inside a group the comparison is real.
//
// Each group carries its own header line — contacted, replies, rate, calls,
// channel mix — so the ICP is readable without opening a flow, and each
// flow row now carries the metrics the draft dropped: enrolled, followed
// up, calls made and connected, positive.
//
// The <details> accordion is still gone: rows are always visible. Only the
// step spine collapses, because that is detail rather than comparison.
// ─────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { C } from "@/lib/design";
import {
  gold, n, S, Band, Opening, Drill, Note, Eyebrow,
  ChannelBar, CH_COLOR, CH_LABEL, ChannelMark, OutcomeBar, TONE,
} from "./ui";
import { CH_KEYS, RATE_FLOOR } from "@/lib/console-data";
import type * as CT from "@/lib/console-data";
import { useT } from "./ctx";
import { useLocale } from "@/lib/i18n";

const K = CH_KEYS;
const sum = (t: CT.Touch) => K.reduce((a, k) => a + t[k], 0);

/* ── the step spine ─────────────────────────────────────────────────────
   One column per step, height to scale against the biggest step in THAT
   flow. The gold cap is the leads that replied, on the same scale. */

function Spine({ steps }: { steps: CT.Step[] }) {
  const { t } = useLocale();
  if (steps.length === 0) return null;
  const max = Math.max(...steps.map(s => s.leads), 1);
  const H = 76;
  return (
    <div className="flex items-end" style={{ gap: 10 }}>
      {steps.map((s, i) => {
        const h = Math.max((s.leads / max) * H, 3);
        const rh = s.replied === 0 ? 0 : Math.max((s.replied / max) * H, 2.5);
        const rate = (s.replied / s.leads) * 100;
        return (
          <div key={i} className="flex-1 min-w-0" title={`Step ${s.step} · ${CH_LABEL[s.ch]} · ${n(s.sent)} sent to ${n(s.leads)} leads · ${s.replied} of them replied`}>
            <div className="tabular-nums text-center mb-1" style={{ fontSize: 10.5, color: s.replied === 0 ? C.textDim : gold, fontWeight: 600 }}>
              {s.replied === 0 ? "0" : `${rate.toFixed(1)}%`}
            </div>
            <div className="relative rounded-t-sm mx-auto" style={{ height: h, backgroundColor: CH_COLOR[s.ch], opacity: .55, width: "100%" }}>
              {rh > 0 && <div className="absolute bottom-0 left-0 right-0 rounded-t-sm" style={{ height: rh, backgroundColor: gold }} />}
            </div>
            <div className="text-center mt-1.5 tabular-nums truncate" style={{ fontSize: 11, color: C.textBody }}>{n(s.leads)}</div>
            {/* the channel is named, not only coloured — a swatch you have to
                decode is the thing the legend was invented to fix */}
            <div className="flex items-center justify-center gap-1 mt-0.5 min-w-0">
              <span className="rounded-sm shrink-0" style={{ width: 6, height: 6, backgroundColor: CH_COLOR[s.ch] }} />
              <span className="truncate" style={{ fontSize: 9.5, color: C.textBody }}>
                {s.ch === "li_cr" ? t("cons.camp.stepInvitation") : s.ch === "li_dm" ? t("cons.ch.liDm") : t("cons.ch.email")}
              </span>
            </div>
            <div className="text-center truncate" style={{ fontSize: 9, color: C.textDim }}>
              {s.step === 0 ? t("cons.camp.stepZero") : t("cons.camp.stepN", { n: s.step })} · {n(s.sent)} {t("cons.camp.sentSuffix")}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── one metric cell. Value on top, what it is underneath, always. ─────── */
function Cell({ v, label, accent, dim }: { v: string | number; label: string; accent?: string; dim?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="tabular-nums truncate" style={{ fontSize: 13, fontWeight: 600, color: dim ? C.textDim : accent ?? C.textPrimary }}>
        {typeof v === "number" ? n(v) : v}
      </div>
      <div style={{ fontSize: 9.5, color: C.textDim, lineHeight: 1.25 }}>{label}</div>
    </div>
  );
}


/* ── what opens when you expand a flow ──────────────────────────────────
   Four panels, each answering something the row above cannot:
     · the sequence — which step, on which channel, drawn to volume
     · the replies  — the channel they came back on, and what they said
     · the calls    — the outcome mix for the dials attached to this flow
     · where it stands — the cohort's status now, and how long a reply takes
   All of it measured on this flow's own cohort, so it reconciles with the
   row above rather than being a second, differently scoped query. */

function Mini({ label, rows, total }: {
  label: string; rows: { label: string; n: number; tone: string }[]; total: number;
}) {
  const { t } = useLocale();
  return (
    <div>
      <div className="font-semibold uppercase tracking-wider mb-2" style={{ fontSize: 9.5, color: C.textMuted }}>{label}</div>
      <OutcomeBar rows={rows} height={6} />
      <div className="flex flex-wrap mt-2" style={{ gap: "4px 12px" }}>
        {rows.filter(r => r.n > 0).map(r => (
          <span key={r.label} className="inline-flex items-baseline gap-1.5">
            <span className="rounded-sm shrink-0 self-center" style={{ width: 6, height: 6, backgroundColor: TONE[r.tone] }} />
            <span className="tabular-nums font-semibold" style={{ fontSize: 11, color: C.textBody }}>{r.n}</span>
            <span style={{ fontSize: 10.5, color: C.textMuted }}>{r.label}</span>
          </span>
        ))}
        {total > 0 && rows.every(r => r.n === 0) && <span style={{ fontSize: 10.5, color: C.textDim }}>{t("cons.camp.noneClassified")}</span>}
      </div>
    </div>
  );
}

function Detail({ c }: { c: CT.CampaignRow }) {
  const T = useT();
  const { t } = useLocale();
  const d = T.flowDetail[c.name];
  if (!d) return null;
  const st = d.status;
  const stTotal = Math.max(st.active + st.completed + st.closedLost, 1);

  const replyRows = [
    { label: t("cons.camp.cls.interested"), n: d.replyCls.positive, tone: "good" },
    { label: t("cons.camp.cls.needsInfo"), n: d.replyCls.needsInfo, tone: "info" },
    { label: t("cons.camp.cls.followUp"), n: d.replyCls.followUp, tone: "neutral" },
    { label: t("cons.camp.cls.notInterested"), n: d.replyCls.negative, tone: "bad" },
  ];
  const callRows = [
    { label: t("cons.camp.cls.interested"), n: d.callCls.positive, tone: "good" },
    { label: t("cons.camp.cls.needsInfo"), n: d.callCls.needsInfo, tone: "info" },
    { label: t("cons.camp.cls.followUp"), n: d.callCls.followUp, tone: "neutral" },
    { label: t("cons.camp.cls.notInterested"), n: d.callCls.negative, tone: "bad" },
    { label: t("cons.camp.cls.voicemail"), n: d.callCls.voicemail, tone: "muted" },
    { label: t("cons.camp.cls.wrongNumber"), n: d.callCls.wrongNumber, tone: "muted" },
    { label: t("cons.camp.cls.noOutcome"), n: d.callCls.unclassified, tone: "warn" },
  ];
  const STATUS = [
    { label: t("cons.camp.stillRunning"), n: st.active, color: gold },
    { label: t("cons.camp.sequenceFinished"), n: st.completed, color: C.border2 },
    { label: t("cons.camp.closedLost"), n: st.closedLost, color: "#C0553F" },
  ];

  return (
    <div className="rounded-xl px-5 py-5" style={{ backgroundColor: C.surface }}>
      <div className="flex items-baseline gap-3 mb-3 flex-wrap">
        <span className="font-semibold uppercase tracking-wider" style={{ fontSize: 9.5, color: C.textMuted }}>{t("cons.camp.theSequence")}</span>
        <span style={{ fontSize: 10.5, color: C.textDim }}>
          {c.steps.length} steps · leads reached at each, and how many of them replied at any point
        </span>
      </div>
      <Spine steps={c.steps} />

      <div className="grid grid-cols-1 lg:grid-cols-3 mt-7 pt-5" style={{ gap: 34, borderTop: `1px solid ${C.border}` }}>
        <div>
          <div className="font-semibold uppercase tracking-wider mb-2.5" style={{ fontSize: 9.5, color: C.textMuted }}>
            {t("cons.camp.repliesHead")} <span className="font-normal normal-case tracking-normal" style={{ color: C.textDim }}>
              {t(d.replyLeads === 1 ? "cons.camp.fromLead" : "cons.camp.fromLeads", { events: d.replyEvents, leads: d.replyLeads })}
            </span>
          </div>
          {d.replyEvents === 0 ? (
            <p style={{ fontSize: 11.5, color: C.textDim }}>{t("cons.camp.noReplies")}</p>
          ) : (
            <>
              <div className="flex" style={{ gap: 10 }}>
                {([["li_dm", d.replyCh.linkedin, t("cons.camp.onLinkedIn")], ["email", d.replyCh.email, t("cons.camp.onEmail")]] as const).map(([k, v, lab]) => (
                  <div key={k} className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className="rounded-sm shrink-0 self-center" style={{ width: 7, height: 7, backgroundColor: CH_COLOR[k] }} />
                      <span className="tabular-nums font-semibold" style={{ fontSize: 16, color: v > 0 ? C.textPrimary : C.textDim }}>{v}</span>
                      <span style={{ fontSize: 10.5, color: C.textMuted }}>{lab}</span>
                    </div>
                    <div className="mt-1 rounded-full" style={{ height: 4, backgroundColor: C.card }}>
                      {v > 0 && <div className="h-full rounded-full" style={{ width: `${(v / d.replyEvents) * 100}%`, backgroundColor: CH_COLOR[k] }} />}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <Mini label={t("cons.camp.whatTheySaid")} rows={replyRows} total={d.replyEvents} />
              </div>
            </>
          )}
        </div>

        <div>
          <div className="font-semibold uppercase tracking-wider mb-2.5" style={{ fontSize: 9.5, color: C.textMuted }}>
            {t("cons.camp.callsHead")} <span className="font-normal normal-case tracking-normal" style={{ color: C.textDim }}>
              {d.calls > 0 ? t("cons.camp.connectedOf", { connected: d.connected, calls: d.calls }) : ""}
            </span>
          </div>
          {d.calls === 0 ? (
            <p style={{ fontSize: 11.5, color: C.textDim }}>{t("cons.camp.nobodyDialled")}</p>
          ) : (
            <>
              <div className="flex items-baseline gap-2 mb-3">
                <ChannelMark ch="call" size={26} />
                <span className="tabular-nums font-semibold" style={{ fontSize: 22, letterSpacing: "-0.02em", color: C.textPrimary }}>
                  {Math.round((d.connected / d.calls) * 100)}%
                </span>
                <span style={{ fontSize: 10.5, color: C.textMuted }}>{t("cons.camp.connectRate")}</span>
              </div>
              <Mini label={t("cons.camp.outcome")} rows={callRows} total={d.calls} />
            </>
          )}
        </div>

        <div>
          <div className="font-semibold uppercase tracking-wider mb-2.5" style={{ fontSize: 9.5, color: C.textMuted }}>
            {t("cons.camp.whereTheyStand", { n: n(c.contacted) })}
          </div>
          <div className="flex h-2.5 rounded-full overflow-hidden mb-2.5" style={{ backgroundColor: C.card }}>
            {STATUS.filter(x => x.n > 0).map(x => (
              <div key={x.label} title={`${x.label} · ${x.n}`} style={{ width: `${(x.n / stTotal) * 100}%`, backgroundColor: x.color }} />
            ))}
          </div>
          <div className="flex flex-wrap" style={{ gap: "4px 14px" }}>
            {STATUS.map(x => (
              <span key={x.label} className="inline-flex items-baseline gap-1.5">
                <span className="rounded-sm shrink-0 self-center" style={{ width: 6, height: 6, backgroundColor: x.color }} />
                <span className="tabular-nums font-semibold" style={{ fontSize: 11, color: x.n > 0 ? C.textBody : C.textDim }}>{n(x.n)}</span>
                <span style={{ fontSize: 10.5, color: C.textMuted }}>{x.label}</span>
              </span>
            ))}
          </div>
          <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
            {d.medianDays === null ? (
              <p style={{ fontSize: 11.5, color: C.textDim }}>{t("cons.camp.noReplyTime")}</p>
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="tabular-nums font-semibold shrink-0" style={{ fontSize: 20, letterSpacing: "-0.02em", color: C.textPrimary }}>
                  {d.medianDays === 0 ? t("cons.camp.sameDay") : `${d.medianDays}d`}
                </span>
                <span style={{ fontSize: 10.5, color: C.textMuted, lineHeight: 1.35 }}>
                  median wait from this flow&apos;s first message to that lead&apos;s reply
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Flow({ c, best, open, onToggle }: {
  c: CT.CampaignRow; best: number; open: boolean; onToggle: () => void;
}) {
  const { t } = useLocale();
  const total = sum(c.touch);
  const thin = c.contacted < RATE_FLOOR;
  return (
    <div style={{ borderTop: `1px solid ${C.border}` }}>
      <div className="flex items-center gap-3 py-3">
        <button onClick={onToggle} className="shrink-0 rounded-md p-0.5" aria-label={open ? "Collapse steps" : "Expand steps"}
          style={{ color: C.textMuted }}>
          <ChevronRight size={14} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
        </button>

        <div className="w-[212px] shrink-0 min-w-0">
          <div className="font-medium truncate" style={{ fontSize: 12.5, color: C.textPrimary }} title={c.name}>{c.name}</div>
          <div className="tabular-nums" style={{ fontSize: 10.5, color: C.textDim }}>{c.steps.length} steps · {n(total)} contact points</div>
        </div>

        {/* the metrics that were missing */}
        <div className="w-[326px] shrink-0 grid grid-cols-5" style={{ gap: 8 }}>
          <Cell v={c.enrolled} label={t("cons.camp.enrolled")} dim />
          <Cell v={c.contacted} label={t("cons.camp.contacted")} />
          <Cell v={c.followed} label={t("cons.camp.followedUp")} dim />
          <Cell v={c.calls} label={c.calls ? t("cons.camp.callsWithConn", { n: c.connected }) : t("cons.camp.calls")} dim={c.calls === 0} />
          <Cell v={c.positive} label={t("cons.camp.positive")} accent={c.positive > 0 ? C.green : undefined} dim={c.positive === 0} />
        </div>

        <div className="w-[96px] shrink-0">
          <ChannelBar mix={c.touch as unknown as Record<string, number>} total={total} />
        </div>

        <div className="flex-1 h-2 rounded-full min-w-[36px]" style={{ backgroundColor: C.surface }}>
          {!thin && <div className="h-full rounded-full" style={{ width: `${(c.rate / best) * 100}%`, backgroundColor: gold, opacity: .9 }} />}
        </div>

        <div className="w-[70px] shrink-0 text-right">
          <div className="font-semibold tabular-nums" style={{ fontSize: 15, color: thin ? C.textDim : C.textPrimary }}>
            {thin ? "—" : `${c.rate}%`}
          </div>
          <div className="tabular-nums" style={{ fontSize: 10.5, color: C.textDim }}>{c.replies} replies</div>
        </div>
      </div>

      {open && (
        <div className="pb-5 pl-[26px]">
          <Detail c={c} />
        </div>
      )}
    </div>
  );
}

function Group({ g, best, open, toggle }: {
  g: CT.TabsData["campaignGroups"][number];
  best: number;
  open: Record<string, boolean>;
  toggle: (k: string) => void;
}) {
  const T = useT();
  const { t } = useLocale();
  const total = sum(g.touch);
  const flowBest = Math.max(...g.flows.map(f => (f.contacted >= RATE_FLOOR ? f.rate : 0)), 1);
  return (
    <section className="mb-9">
      {/* the ICP header — its own summary line, so the group reads before
          any of its flows do */}
      <div className="flex items-baseline gap-3 flex-wrap pb-2.5">
        <h3 className="font-semibold tracking-tight" style={{ fontSize: 14, color: C.textPrimary }}>{g.icp}</h3>
        <span className="tabular-nums" style={{ fontSize: 11.5, color: C.textMuted }}>
          {t(g.flows.length === 1 ? "cons.camp.groupLineOne" : "cons.camp.groupLineMany", { n: g.flows.length, contacted: n(g.contacted), touch: n(total) })}
          {g.calls > 0 && ` · ${g.calls} calls`}
        </span>
        <div className="flex-1" />
        <span className="tabular-nums" style={{ fontSize: 11.5, color: C.textMuted }}>{g.replies} replies</span>
        <span className="font-semibold tabular-nums px-2 py-0.5 rounded-full"
          style={{ fontSize: 12.5, color: g.rate >= best * .5 ? "#3A2E08" : C.textPrimary,
                   backgroundColor: `color-mix(in srgb, ${gold} ${Math.round((g.rate / best) * 70) + 8}%, transparent)` }}>
          {g.rate}%
        </span>
      </div>
      {g.flows.map(f => (
        <Flow key={f.name} c={f} best={flowBest} open={!!open[f.name]} onToggle={() => toggle(f.name)} />
      ))}
      <div style={{ borderTop: `1px solid ${C.border}` }} />
    </section>
  );
}

export default function Campaigns({ label }: { label: string }) {
  const T = useT();
  const { t } = useLocale();
  // The three widest sequences of the period, described from their own
  // numbers. Ordered by contact points, because "where does it stall" is a
  // question about the flows that consumed the most.
  const shapeLines = [...T.campaigns]
    .map(c => ({ c, touch: c.touch.li_cr + c.touch.li_dm + c.touch.email + c.touch.call }))
    .sort((a, b) => b.touch - a.touch)
    .slice(0, 3)
    .map(({ c, touch }) => t("cons.camp.shapeLine", {
      name: c.name, replies: c.replies, contacted: c.contacted,
      steps: c.steps.length, touch: touch.toLocaleString(),
    }));

  // Best group's best flow and the worst flow overall start open.
  const [open, setOpen] = useState<Record<string, boolean>>({
    [T.campaignGroups[0].flows[0].name]: true,
  });
  const toggle = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }));
  const bestGroup = Math.max(...T.campaignGroups.map(g => g.rate));
  const totContacted = T.campaigns.reduce((a, c) => a + c.contacted, 0);
  const totReplies = T.campaigns.reduce((a, c) => a + c.replies, 0);
  const totCalls = T.campaigns.reduce((a, c) => a + c.calls, 0);
  const totTouch = T.campaigns.reduce((a, c) => a + sum(c.touch), 0);

  return (
    <>
      <Opening question={t("cons.camp.q1")} sub={t("cons.camp.q1sub", { label })} aside={<Drill label={t("cons.camp.allFlows")} />}>
        <div className="flex items-baseline gap-2 mb-6 flex-wrap">
          <span className="font-semibold tabular-nums" style={{ fontSize: S.minor, color: C.textPrimary }}>{T.campaigns.length}</span>
          <span style={{ fontSize: 12, color: C.textMuted }}>flows across {T.campaignGroups.length} ICPs</span>
          <span style={{ fontSize: 12, color: C.textDim }}>·</span>
          <span className="font-semibold tabular-nums" style={{ fontSize: S.minor, color: C.textBody }}>{n(totContacted)}</span>
          <span style={{ fontSize: 12, color: C.textMuted }}>{t("cons.camp.contacted")}</span>
          <span style={{ fontSize: 12, color: C.textDim }}>·</span>
          <span className="font-semibold tabular-nums" style={{ fontSize: S.minor, color: C.textBody }}>{totReplies}</span>
          <span style={{ fontSize: 12, color: C.textMuted }}>{t("cons.camp.replied")}</span>
          <div className="flex-1" />
          <span className="inline-flex items-center gap-2">
            {K.map(k => (
              <span key={k} className="inline-flex items-center gap-1">
                <span className="rounded-sm shrink-0" style={{ width: 8, height: 8, backgroundColor: CH_COLOR[k] }} />
                <span style={{ fontSize: 10.5, color: C.textMuted }}>{CH_LABEL[k]}</span>
              </span>
            ))}
          </span>
        </div>

        {T.campaignGroups.map(g => (
          <Group key={g.icp} g={g} best={bestGroup} open={open} toggle={toggle} />
        ))}

        <div className="flex flex-wrap items-center" style={{ gap: 26 }}>
          <div className="flex items-center gap-2.5">
            <ChannelMark ch="call" size={28} />
            <div>
              <div className="font-semibold tabular-nums" style={{ fontSize: 15, color: C.textPrimary }}>{totCalls}</div>
              <div style={{ fontSize: 10.5, color: C.textMuted }}>{t("cons.camp.callsAttached")}</div>
            </div>
          </div>
          <div>
            <div className="font-semibold tabular-nums" style={{ fontSize: 15, color: C.textPrimary }}>{n(totTouch)}</div>
            <div style={{ fontSize: 10.5, color: C.textMuted }}>{t("cons.camp.touchTotal")}</div>
          </div>
        </div>

        <Note>{T.campaignsNote}</Note>
        <Note>{T.flowDetailNote}</Note>
      </Opening>

      <Band question={t("cons.camp.q2")} sub={t("cons.camp.q2sub")}>
        <div className="grid grid-cols-1 lg:grid-cols-12" style={{ gap: 48 }}>
          <div className="lg:col-span-7">
            <Eyebrow note={t("cons.camp.readShapeNote")}>{t("cons.camp.readShape")}</Eyebrow>
            <ul className="flex flex-col" style={{ gap: 10, maxWidth: 620 }}>
              {/* Generated from the period's own flows. These were three fixed
                  sentences carried over from the mock — real numbers once,
                  frozen since, and presented as current analysis. */}
              {(shapeLines.length ? shapeLines : [t("cons.camp.shapeEmpty")]).map((s, i) => (
                <li key={i} className="flex items-baseline gap-2.5">
                  <span className="shrink-0 rounded-full" style={{ width: 4, height: 4, backgroundColor: gold, transform: "translateY(-2px)" }} />
                  <span style={{ fontSize: 12.5, color: C.textBody, lineHeight: 1.55 }}>{s}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:col-span-5 lg:pl-11" style={{ borderLeft: `1px solid ${C.border}` }}>
            <Eyebrow>{t("cons.camp.howToRead")}</Eyebrow>
            <p style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.6 }}>{T.stepsNote}</p>
            <p className="mt-3" style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.6 }}>
              {t("cons.camp.callsNotStep")}
            </p>
          </div>
        </div>
      </Band>

      <Band question={t("cons.noLongerShows")}>
        <Eyebrow>{t("cons.removed")}</Eyebrow>
        <p style={{ fontSize: 12.5, color: C.textBody, lineHeight: 1.6, maxWidth: 800 }}>{T.campaignsRemoved}</p>
        <p className="mt-3" style={{ fontSize: 12.5, color: C.textBody, lineHeight: 1.6, maxWidth: 800 }}>
          The <strong style={{ color: C.textPrimary }}>{t("cons.camp.rmAccordion")}</strong> is gone but the{" "}
          <strong style={{ color: C.textPrimary }}>{t("cons.camp.rmGrouping")}</strong> — the groups are open by default and each carries its own
          summary line, so the comparison happens on the page instead of one click at a time.
        </p>
      </Band>
    </>
  );
}
