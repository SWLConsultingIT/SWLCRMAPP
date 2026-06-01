# Pending tasks (parked) — 2026-06-01

Items Fran flagged for later; none block the current call/outcome polish.

## 1) Message Generator: migrate OpenAI → Claude Haiku

- Today the wizard's per-step generator calls OpenAI on every approve.
- Fran's note in memory (`project_message_dispatch_flow.md`): the generator
  runs ONCE at campaign creation, not per-send. So token spend is bounded.
- Migrating to Claude Haiku reduces $$ and lines up with the rest of the
  CRM's AI usage (placeholder hygiene, talking points, summary).
- Touch points: `app/api/campaigns/generate-messages/route.ts` (and the
  wizard's `ChannelMessageConfig.tsx` that triggers it).

## 2) "Mark as Lost — with reason" from /queue History

- Today History rows can be marked positive / negative but the reason
  text isn't captured anywhere.
- Need a `lead_lost_reasons` (or similar) table or a `lost_reason` text
  column on `leads` so sellers can type a free-form reason at close time.
- Surface the reason in /leads/lost/[id] + on the Lost bucket in /leads
  so future research can categorize patterns.

## 3) Company-detail page is too thin → add "what the company does" hooks

- Fran spent 20–30 min reading a portfolio site looking for a hook
  before a call. The company-detail page only has the basic enrichment
  fields — none of the "what does this company actually do, who do they
  serve, what's their angle" detail you'd write into an opener.
- Plan: a "Hooks" or "Research summary" panel on the company page,
  generated from `organization_description` + `organization_technologies`
  + `recent_website_news` + Tavily/web scrape of the homepage's
  About/Services page, distilled into 3–5 bullet hooks ready to read
  in a pre-call moment.
- The Pre-Call Brief on the lead detail already does the per-lead
  version of this. The company-detail equivalent would aggregate across
  the lead pool plus the public site.

## 4) [DONE 2026-06-01] Phone picker (secondary number)

- Reported as "no me deja seleccionar el otro número".
- Root cause: the test lead (Francisco Test) only has `primary_phone`
  populated; `primary_secondary_phone` is null in DB, so the picker
  collapses to a single value and the chip stays hidden. The code path
  IS correct (`components/CallButton.tsx` line 245 onward) — verified
  with 5 leads in DB that have both phones; the picker renders for
  those.
- Action: not a code bug. Either populate `primary_secondary_phone`
  on the test lead, or test with one of the 5 dual-phone leads
  (Alicia @ COFIDES, Rafael @ Buenavista, Gary @ Rhodes, Stephen @
  LJ Property, Mateo @ PAI).
