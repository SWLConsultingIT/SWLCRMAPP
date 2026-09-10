// Creates 3 campaign_templates for Arqy — one per ICP (UK Contractors,
// UK Developers, UK Architects). Each template uses only canonical
// placeholders ({{first_name}}, {{company_name}}, {{seller_name}}) so
// they pass the dispatcher's foreign-syntax guard, and every body is
// pushed through autoNormalizePlaceholders defensively before insert.
//
// Sequence is 5 steps + connection request, ~12 days:
//   CR (LinkedIn, day 0)
//   Step 1: LinkedIn DM (day 1) — post-accept hook
//   Step 2: Email      (day 3)
//   Step 3: Call       (day 5) — talking points
//   Step 4: Email      (day 8) — proof point
//   Step 5: LinkedIn   (day 12) — break-up
//
// Re-running this script is safe: it deletes any existing Arqy template
// whose name matches one of the three before inserting fresh rows.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);
const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env.local"), "utf8")
    .split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ARQY = "0902962f-4b15-4810-a5bd-730d4b22a527";

// Same SUSPICIOUS regex set + alias table as lib/placeholders.ts. Inlined
// because this is an .mjs script — can't import the TS module directly.
const ALIASES = [
  { canonical: "{{first_name}}",   from: ["[First Name]", "{First Name}", "{first_name}", "<<First Name>>", "%FIRST_NAME%", "__first_name__", "[firstname]", "%firstname%", "{{firstName}}", "{{name}}"] },
  { canonical: "{{last_name}}",    from: ["[Last Name]", "{Last Name}", "{last_name}", "<<Last Name>>", "%LAST_NAME%", "__last_name__", "{{lastName}}"] },
  { canonical: "{{company_name}}", from: ["[Company]", "[Company Name]", "{Company}", "{company}", "<<Company>>", "%COMPANY%", "%COMPANY_NAME%", "__company__", "{{companyName}}", "{{fund_name}}", "{{firm_name}}", "{{company}}"] },
  { canonical: "{{seller_name}}",  from: ["[Seller]", "[Sender]", "{Seller}", "<<Seller>>", "%SELLER%", "__seller__", "{{sellerName}}", "{{sender_name}}", "{{my_name}}"] },
];
// Copy below uses canonical {{first_name}} / {{company_name}} / {{seller_name}}
// directly, so no rewrite is needed. The naive split/join of the prior version
// converted `{{first_name}}` into `{{{first_name}}}` because `{first_name}`
// (the single-brace alias) was a substring of the canonical form. Belt-and-
// braces normalization happens at /api/campaigns/approve and /api/templates/[id]/launch
// anyway, via lib/placeholders.autoNormalizePlaceholders which uses proper
// look-behind regex — not naive substring replace.
function autoNormalize(text) {
  return text ?? "";
}

const SEQUENCE = [
  { channel: "linkedin", daysAfter: 1 }, // step 1: post-accept DM
  { channel: "email",    daysAfter: 2 }, // step 2: D3
  { channel: "call",     daysAfter: 2 }, // step 3: D5
  { channel: "email",    daysAfter: 3 }, // step 4: D8
  { channel: "linkedin", daysAfter: 4 }, // step 5: D12 break-up
];

// ── ICP 1: UK Contractors ────────────────────────────────────────────
const CONTRACTORS = {
  name: "Contractors UK — Arqy Build",
  icp_name: "UK Contractors",
  connectionRequest: "{{first_name}} — work with UK construction contractors to cut the time spent preparing progress reports for developer clients. Thought worth connecting.",
  steps: [
    {
      step: 1, channel: "linkedin",
      body: "Hi {{first_name}} — thanks for connecting. Most contractors we work with at {{company_name}}-scale spend hours each week assembling progress packs for their developer clients. Arqy Build pushes that same data to the client live, so the reporting layer disappears. Curious if that's a friction worth solving on your side?",
    },
    {
      step: 2, channel: "email",
      subject: "Cutting the weekly progress pack at {{company_name}}",
      body: `Hi {{first_name}},

Your team's progress data and your developer client's financial model usually live in two separate environments. Bridging them means someone on your side spends time formatting reports the client could otherwise see directly.

Arqy Build is the layer that connects them. Milestone completions update the developer's financial record in real time, so the weekly reporting cycle becomes a live feed. Less prep work for your PMs, fewer "where are we?" calls from the client side.

Worth a 15-minute look? Happy to walk through what one of our UK contractor users runs.

{{seller_name}}`,
    },
    {
      step: 3, channel: "call",
      body: `Talking points for {{seller_name}} — not a script to read.

• Open: ask if preparing weekly progress packs for developer clients is taking more of {{first_name}}'s team's time than it should.
• If engaged: Arqy Build is the live layer between site progress and the developer's financial model. Their team updates once, the client sees it directly.
• If cool: offer a 90-second Loom of the contractor view. Don't pitch on the call.
• Close: 15-minute working session next week, their pick of slots.`,
    },
    {
      step: 4, channel: "email",
      subject: "How a UK contractor cut weekly reporting at {{company_name}}-size",
      body: `{{first_name}},

Tried LinkedIn and called — wanted to leave one concrete example.

A UK main contractor we work with cut their weekly client-facing reporting from ~4 hours to under 30 minutes after their developer clients started reading progress directly off Arqy Build. Same data, no formatting layer.

If the timing isn't right that's fine. If it is, I'll send two 15-min slots next week.

{{seller_name}}`,
    },
    {
      step: 5, channel: "linkedin",
      body: `{{first_name}} — last note from me. Either Arqy Build is interesting for {{company_name}} or it isn't, and either is a fine answer. If you want me to circle back next quarter instead, just say. Otherwise I'll leave it here.

— {{seller_name}}`,
    },
  ],
};

// ── ICP 2: UK Developers ─────────────────────────────────────────────
const DEVELOPERS = {
  name: "Developers UK — Arqy Build",
  icp_name: "UK Developers",
  connectionRequest: "{{first_name}} — work with UK developers on the gap between live site progress and the financial model. Worth connecting given what you're running at {{company_name}}.",
  steps: [
    {
      step: 1, channel: "linkedin",
      body: "Hi {{first_name}} — thanks for connecting. Most developers we talk to find variance at milestone, once costs are already baked in. Arqy Build sits between physical progress and the financial record so you see variance in days, not at the next review. Worth 15 minutes to see how this looks for {{company_name}}?",
    },
    {
      step: 2, channel: "email",
      subject: "Catching variance earlier at {{company_name}}",
      body: `Hi {{first_name}},

Most developers we work with describe the same pattern: financial outcomes get discovered at reporting milestones rather than managed continuously. By then, the intervention window has closed.

Arqy Build is the live layer between contractor progress on site and your financial model. Milestone shifts surface in days, not weeks. Decisions you can still act on, instead of reports about decisions you've already missed.

Open to 15 minutes next week to walk through how this looks for a developer running a similar pipeline to {{company_name}}?

{{seller_name}}`,
    },
    {
      step: 3, channel: "call",
      body: `Talking points for {{seller_name}} — not a script.

• Reference the email sent earlier this week about catching variance earlier in the build phase.
• Open with their pain: how does {{first_name}}'s team find out today when a project is going off-plan financially? Listen.
• If engaged: Arqy Build pushes contractor progress data straight into the financial record. They see the trend before the report, not after.
• If cool: offer to send a UK developer reference case.
• Close: 20-minute working session, their slot.`,
    },
    {
      step: 4, channel: "email",
      subject: "UK developer reference — variance window cut from weeks to days",
      body: `{{first_name}},

Tried by phone and LinkedIn — leaving you one concrete reference.

A UK developer running 6 concurrent schemes cut their variance detection from ~3 weeks (next reporting cycle) to under 5 days after deploying Arqy Build between their contractors and their financial model. Same input data, just pushed live.

If 15 minutes is worth it, I'll send two slots next week.

{{seller_name}}`,
    },
    {
      step: 5, channel: "linkedin",
      body: `{{first_name}} — final note from my side. If Arqy Build isn't the right fit for {{company_name}} right now, no issue. If timing is off and Q3/Q4 is better, happy to circle back then. Otherwise I'll wrap it here.

— {{seller_name}}`,
    },
  ],
};

// ── ICP 3: UK Architects ─────────────────────────────────────────────
const ARCHITECTS = {
  name: "Architects UK — Arqy Build",
  icp_name: "UK Architects",
  connectionRequest: "{{first_name}} — work with UK architecture studios on giving developer clients live project visibility without extra reporting overhead. Thought worth connecting.",
  steps: [
    {
      step: 1, channel: "linkedin",
      body: "Hi {{first_name}} — thanks for connecting. Most studios we work with at {{company_name}}-size are getting the same ask from developer clients: 'can we see this live, not in monthly updates?'. Arqy Build is what we've built for exactly that. Worth 15 minutes to look?",
    },
    {
      step: 2, channel: "email",
      subject: "Live project visibility for {{company_name}}'s developer clients",
      body: `Hi {{first_name}},

Your developer clients increasingly expect the kind of live visibility their other vendors give them — finance, ops, comms. The static monthly update is starting to feel dated, but stitching together a live view from your existing tools isn't realistic.

Arqy Build is the layer that lets your client see design + construction progress as it happens, without you building a custom dashboard. Studios using it stop being the slowest piece of their client's project view.

Worth a 15-minute walk-through? Happy to share what one of our UK studio users runs.

{{seller_name}}`,
    },
    {
      step: 3, channel: "call",
      body: `Talking points for {{seller_name}} — not a script.

• Open: ask whether {{first_name}}'s developer clients have started asking for more live project visibility than the studio currently provides. Listen.
• If engaged: Arqy Build is the live layer between their work and the client's project view. The studio stops being the reporting bottleneck.
• If cool: offer a 90-second Loom of the architect view.
• Close: 20-minute working session, their slot.`,
    },
    {
      step: 4, channel: "email",
      subject: "UK studio reference — Arqy Build for developer clients",
      body: `{{first_name}},

Tried LinkedIn and phone — leaving you one concrete example.

A UK studio running 8 concurrent developments switched from static monthly updates to live Arqy Build visibility for their developer clients. Their feedback: clients stopped asking "where are we?" and started asking "what's next?". The relationship dynamic shifted.

If 15 minutes is useful, I'll send two slots.

{{seller_name}}`,
    },
    {
      step: 5, channel: "linkedin",
      body: `{{first_name}} — last note. If Arqy Build isn't the right thing for {{company_name}} right now, that's a fine answer. If it's a timing issue and Q3 is better, let me know. Otherwise I'll wrap it here.

— {{seller_name}}`,
    },
  ],
};

const TEMPLATES = [CONTRACTORS, DEVELOPERS, ARCHITECTS];

// ── Build step_messages + run autoNormalize defensively ───────────────
function buildPayload(tpl, icpId) {
  const normalizedSteps = tpl.steps.map(s => ({
    step: s.step,
    channel: s.channel,
    subject: s.subject ? autoNormalize(s.subject) : null,
    body: autoNormalize(s.body),
    attachments: [],
  }));
  const stepMessages = {
    connectionRequest: autoNormalize(tpl.connectionRequest),
    steps: normalizedSteps,
  };
  const channels = [...new Set(SEQUENCE.map(s => s.channel))];
  return {
    name: tpl.name,
    sequence_steps: SEQUENCE,
    step_messages: stepMessages,
    channels,
    icp_profile_id: icpId,
    company_bio_id: ARQY,
    tone_preset: "balanced",
    rewrite_mode: "verbatim",
    usage_count: 0,
    tags: ["uk", "arqy-build"],
    description: `Arqy Build outreach for ${tpl.icp_name} — 5 steps over ~12 days (CR → DM → email → call → email → break-up).`,
  };
}

// ── Look up Arqy ICP ids ──────────────────────────────────────────────
const { data: icps, error: icpErr } = await svc
  .from("icp_profiles")
  .select("id, profile_name")
  .eq("company_bio_id", ARQY);
if (icpErr) { console.error(icpErr); process.exit(1); }
const icpByName = new Map(icps.map(i => [i.profile_name, i.id]));
console.log("Arqy ICPs:", [...icpByName.entries()]);

// ── Idempotent: drop any prior template with our 3 names ──────────────
const names = TEMPLATES.map(t => t.name);
const { data: existing } = await svc
  .from("campaign_templates")
  .select("id, name")
  .eq("company_bio_id", ARQY)
  .in("name", names);
if (existing && existing.length > 0) {
  console.log(`Removing ${existing.length} prior templates with matching names…`);
  await svc.from("campaign_templates").delete().in("id", existing.map(e => e.id));
}

// ── Insert the 3 templates ────────────────────────────────────────────
for (const tpl of TEMPLATES) {
  const icpId = icpByName.get(tpl.icp_name);
  if (!icpId) {
    console.error(`SAFETY ABORT — ICP "${tpl.icp_name}" not found for Arqy. Aborting.`);
    process.exit(1);
  }
  const payload = buildPayload(tpl, icpId);
  const { data, error } = await svc.from("campaign_templates").insert(payload).select("id, name").single();
  if (error) {
    console.error(`Insert failed for ${tpl.name}:`, error);
    process.exit(1);
  }
  console.log(`✓ ${data.name} (id ${data.id}) — icp ${tpl.icp_name}`);
}
console.log("\nDone. Templates are now visible at /campaigns → Templates section.");
