# Diagnostic Console — all six tabs

Built 2026-09-07. Awaiting approval; **the production dashboard is untouched.**

## Where it runs

- **`/dashboard-console`** — the real route, behind the normal auth middleware
- **`/login/console`** — temporary unauthenticated copy for review
  (local: `http://localhost:3002/login/console`)

Static data only, in `app/dashboard-console/data.ts` (Overview) and
`tabs-data.ts` (the other five). No query, no write, nothing imported from
`lib/dashboard-data.ts` or `components/dashboard/*`. The only shared code is
`lib/design.ts`.

## Files

| File | What |
|---|---|
| `Shell.tsx` | Page chrome: title, tab bar, period, filters |
| `ui.tsx` | The shared vocabulary — one ladder, one band, one delta, one ranked list |
| `Console.tsx` | Overview body (the approved direction) |
| `Icps.tsx` `Campaigns.tsx` `Channels.tsx` `Sellers.tsx` `Portfolio.tsx` | One per tab |
| `data.ts` `tabs-data.ts` | Every figure, with its source and window in comments |

## The finding that shaped all five new tabs

`lib/dashboard-data.ts:378` applies the period filter to **`leads.created_at`**,
then counts **lifetime** activity for whatever survives. The comment at `:503`
says the per-ICP / per-campaign / per-seller blocks key off lifetime membership
on purpose. So a "last 30 days" view is *leads loaded in the last 30 days, with
all of their history* — not activity in the last 30 days.

Measured against SWL on 2026-09-07:

| ICP | live tab shows | actually contacted in the window |
|---|---:|---:|
| PE & VC — USA | 944 | 1,073 |
| UK Growth AI Sales | 100 | 309 |
| PE & VC — Spain | 225 | 225 |
| Spanish Growth AI | 196 | 204 |
| **Natural Ingredients USA** | **0** | **242** |
| **Solar & Renewable — USA** | **0** | **105** |
| **Odoo — Argentina** | **0** | **95** (9.5%, the best) |
| **Italy Growth AI Sales** | **0** | **42** |

Four of the eight ICPs vanish from the screen at 30 days, including the
best-performing one. These mocks use *activity in the period* throughout, so
they show numbers the app cannot currently produce. Phase A closes the gap.

## Per-tab decisions

**ICPs** — one cohort, eight rows, all shown. **Contact points are back as
four columns** — connection request / LinkedIn DM / email / call — each showing
how many went out over how many distinct leads received them, which is the
follow-up depth (1,570 emails to 1,064 leads is a different campaign from 89 to
89). A totals strip sums the four across the workspace, and the ICP × Channel
grid is the body rather than an appendix. Removed: Total touches *as a single
figure*, Conv%, the 14-day sparkline, rate bars rescaled to the table leader.

**Campaigns** — **grouped by ICP again**, because ranking nine flows across
seven markets is not a league table; inside a group the comparison is real.
Each group carries its own summary line (flows, contacted, contact points,
calls, replies, rate) and each flow row now carries the metrics the first draft
dropped: enrolled, contacted, followed up, calls made and connected, positive,
channel mix. The collapsed accordion is gone — groups are open — but the
grouping is not. Removed: the `Won` tile (never set) and `Lost` (mixes a
negative reply with a manual close).

**Channels** — **back to cards with the channel marks**: four of them, each
with its own volume (sent / reached / result), its own headline rate and its
own outcome mix, side by side. The rule survives but moves — the cards do not
rank each other; ranking happens once underneath in a **head-to-head** that
contains only LinkedIn DM and Email, the pair that is the same measurement.
Invitation acceptance and call connect rate keep their cards and their numbers
and stay out of the ranking, with the reason written where the ranking is.
Volume to one scale sits below. Removed: the duplicate LinkedIn Connections
card, calls inside the ranking, and the gap sentence that subtracted an
acceptance rate from a reply rate.

**Sellers** — a team control centre in six levels, tuned for reading speed:
**1 Team Health** — six team figures in one homogeneous row (sellers active,
contacted, sent, calls, reply rate, connect rate), the two results on a line
below, and three alerts ordered by severity with the rest behind *View all* ·
**2 Seller Performance** — the heart: one row per seller banded into three
weights (who and what came back / what went out / operations), separated by a
hairline rather than a second header row. Labels say what is counted —
*LI sent*, not *LinkedIn*. The row opens · **3 Compare Sellers** — one chart,
a metric selector, the team average as a reference line · **4 Call
Performance** — eight columns, unclassified the only coloured one · **5
Consistency** — the question answered in a word (Burst-heavy / Steady /
Sporadic) with the two numbers that produce it · **6 Key insights** — four,
each a label and a value.

**Positive Rate is gone.** One positive in the period makes 0.1% and 0.0%,
which is false precision. The count stays; the rate returns when volume
supports one.

**Queue is redefined.** 9,366 messages are not `sent`, but 5,825 are `draft`
(later steps not yet due) and 1,807 are `queued` inside paused or finished
flows and will never go out. Queue = **queued in an active flow = 1,734**,
labelled as current stock, not period activity.

Moved to the drill-down (three blocks only): channel mix · calls with the full
outcome list, talk time and recordings · active days, days calling, last send
and queue. Removed as sections: `Worth watching`, `What this tab no longer
shows`, the 31-day activity grid, the repeated team average, the long
footnotes, and the eight help icons in the table header — the definitions are
now tooltips on the header cells.

**Portfolio** — **it earns its tab.** It is the only cross-tenant view and it
backs `/reports/portfolio-print`. What it does not earn is a 12-metric grid:
at 7 days two tenants have activity and SWL is 99.8% of it, so the default
moves to 30 days (four active). One row per active client; the four dormant
ones are named with the reason instead of drawn as zeros. **The comparison
picker is back** and it is the point of the tab: tick two or more clients and a
head-to-head panel opens above the list, putting them on seven shared axes.
Removed: `meetings` and `wins`, both guaranteed zero on all eight tenants.

## Four corrections carried into the Overview

Re-measuring for the other tabs turned up three real errors in the approved
Overview and one in this mock's own data. All four are fixed in `data.ts`.

1. **Calls: 282 real / 123 connected (43.6%)**, not 189/75 and not 350/179.
   Dedup by lead+minute must **prefer the real row over the click-to-dial
   marker** written at the same minute; taking whichever came first silently
   discarded real calls. 562 rows → 354 deduped → 282 real, 72 markers.
   139 have a recording, 78 have no outcome logged.

2. **Positive is 1, not 0.** One reply on 6 Sep on LinkedIn is classified
   `positive`, and that lead **is** inside the contacted-in-period cohort.

3. **"Followed up" was never a funnel stage.** A reply stops the flow, so only
   34 of the 65 leads that replied ever received a second message. It is not a
   superset of Replied and cannot sit between it and Contacted. The funnel is
   now Contacted → Replied → Positive, which nests strictly; the follow-up
   depth (993 single-touch, 1,302 with two or more) sits beside it.

4. **Reply mix**: needs info 31 and interested 1, not 32 and 0.

A fifth, in this mock only: rows whose `sent_at` came back with a `-03:00`
offset were shifted twice by the local-day conversion and landed on 7 Aug,
outside the window. Eleven messages (Juan 8, Isaac 3) are restored to 8 Aug so
the daily chart and the outreach totals agree.

## Screenshots

`fold-<tab>.png` — the 1440×900 fold · `t-<tab>-dark.png` / `t-<tab>-light.png`
— full page, both themes.

Sellers: `S-full-dark.png` / `S-full-light.png` (whole tab) · `S-fold.png`
(the 15-second view) · `S-A-health.png` · `S-B-perf.png` · `S-C-compare.png` ·
`S-D-calls.png` · `S-E-insights.png` · `S-F-drill.png` (a row expanded).

## When approved

Delete `app/dashboard-console/`, `app/login/console/` and this folder. The
design lands on `/` in Phase B, after Phase A makes the numbers true.
