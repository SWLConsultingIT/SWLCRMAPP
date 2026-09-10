// One-shot: build a realistic-looking campaigns + messages + replies dataset
// for the Gruppo Everest demo tenant. Creates 2 sellers (Juan, Luciano), then
// distributes the 15 imported leads across 3 named "campaign groups":
//
//   A. "Q2 2026 — Industrial Solar Audit" (active, 8 leads)
//      Mix of CR-sent / mid-sequence / completed-won / completed-lost.
//   B. "Q1 2026 — Storage Retrofit Outreach" (completed, 4 leads, all w/ solar)
//      All sequence finished; 1 won, 1 lost, 2 no-reply.
//   C. "Renurture — Q3 Re-engagement" (paused, 3 leads)
//      Paused mid-sequence (draft + partial sends).
//
// Side effects:
//   - upserts 2 sellers under the Everest bio (linked to juan@ + luciano@ user_ids)
//   - inserts 15 campaigns rows (one per (campaign_group, lead))
//   - inserts ~40-50 campaign_messages rows with realistic timestamps
//   - inserts 5 lead_replies (3 positive, 2 negative)
//   - flips lead.status / opportunity_stage / transferred_to_odoo_at for
//     won/lost/qualified leads
//   - flips lead.current_channel + linkedin_connected for contacted leads
//
// Re-running will duplicate. Run once.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(__dirname);

const envText = readFileSync(join(ROOT, ".env.local"), "utf8");
const env = Object.fromEntries(
  envText.split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Missing Supabase env"); process.exit(1); }

const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const TENANT_NAME = "Gruppo Everest";
const NOW = Date.now();
const DAY = 86400_000;
const isoDaysAgo = (d) => new Date(NOW - d * DAY).toISOString();

// ── Seller config ─────────────────────────────────────────────────────────
const SELLERS = [
  { name: "Juan Fontana",    email: "juan@swlconsulting.com",    linkedin_daily_limit: 20, email_daily_limit: 60, call_daily_limit: 25 },
  { name: "Luciano Sosa",    email: "luciano@swlconsulting.com", linkedin_daily_limit: 20, email_daily_limit: 60, call_daily_limit: 25 },
];

// ── Campaign sequence templates ──────────────────────────────────────────
const SEQ_AUDIT = [
  { channel: "linkedin", daysAfter: 0 },  // step 0: connection request
  { channel: "linkedin", daysAfter: 3 },  // step 1: DM after accept
  { channel: "email",    daysAfter: 5 },  // step 2
  { channel: "linkedin", daysAfter: 4 },  // step 3
  { channel: "email",    daysAfter: 5 },  // step 4
];

const SEQ_STORAGE = [
  { channel: "linkedin", daysAfter: 0 },  // step 0: CR
  { channel: "email",    daysAfter: 5 },  // step 1
  { channel: "linkedin", daysAfter: 5 },  // step 2
  { channel: "email",    daysAfter: 5 },  // step 3
];

const SEQ_RENURTURE = [
  { channel: "email",    daysAfter: 0 },  // step 0
  { channel: "linkedin", daysAfter: 7 },  // step 1
];

// ── Message bodies (kept short — realistic demo copy) ───────────────────
const M_AUDIT = {
  cr:       (n, c) => `Hi ${n}, leading Gruppo Everest's industrial energy team. We help Italian food plants like ${c} cut electricity bills 25–35% with turnkey rooftop solar — would value a quick chat.`,
  step1:    (n, c) => `Thanks for connecting, ${n}! Quick context: we just delivered a 480 kWp install at a Veneto food plant similar to ${c}'s footprint — payback hit 4.2 yrs post-CER credit. Have you looked at rooftop PV for your facility?`,
  step2sub: (c)    => `Rooftop PV feasibility for ${c}`,
  step2:    (n, c) => `Hi ${n},\n\nFollowing up on LinkedIn. I put together a 1-page sizing study for ${c} — projected kWp, CAPEX, payback months after Transizione 5.0 tax credit, and Year-1 savings range.\n\nWorth a 20-min look? Happy to walk through it on a call.\n\nBest,\nJuan\nGruppo Everest`,
  step3:    (n)    => `${n}, last LinkedIn touch on this — Italy's Transizione 5.0 cap closes in Nov '26 and the larger installs are booking through Q3 already. Happy to share what we delivered at a reference site near you if it helps.`,
  step4sub: ()     => `Closing the loop — Gruppo Everest`,
  step4:    (n, c) => `Hi ${n} — wrapping up my outreach on this thread.\n\nIf rooftop PV ever moves up ${c}'s priority list, just hit reply. We've worked with cameo, Margherita and several other food producers in your region. The 1-pager I sent earlier stays valid for ~60 days.\n\n— Juan`,
};

const M_STORAGE = {
  cr:       (n, c) => `Hi ${n}, Luciano from Gruppo Everest. Noticed ${c}'s rooftop array — we specialize in storage retrofit + repowering for early-2020s installs that are aging out. Worth a quick chat?`,
  step1sub: (c)    => `Storage retrofit for ${c}'s rooftop array`,
  step1:    (n, c) => `Hi ${n},\n\nLuciano here from Gruppo Everest. Most 2018–2021 industrial PV installs are now 15–20% below original yield — and adding a 200–500 kWh battery typically recovers half of that loss plus monetizes the evening peak.\n\nWould a quick efficiency audit of ${c}'s existing array be useful?\n\n— Luciano`,
  step2:    (n)    => `${n}, did the audit idea make sense? Even a 1-page report would tell you whether storage retrofit + repowering pays back inside 36 months for your array.`,
  step3sub: ()     => `Closing the loop on the storage audit`,
  step3:    (n)    => `Hi ${n}, last touch on this. The free audit offer stays open if interesting later — just reply.\n\n— Luciano`,
};

const M_RENURTURE = {
  step0sub: ()     => `Re-engaging — Italy CER credit window`,
  step0:    (n, c) => `Hi ${n},\n\nRevisiting an earlier thread. With the CER credit window extended through 2027, the rooftop-PV economics for ${c} now look better than when we last spoke.\n\nWorth a fresh 15-min update?\n\n— Juan / Gruppo Everest`,
  step1:    (n)    => `Hi ${n} — sent you a note last week on the updated CER credit picture. Happy to share the updated 1-pager sizing for your facility whenever it makes sense.`,
};

// ── Reply samples ────────────────────────────────────────────────────────
const REPLY_POSITIVE = [
  "Hi Juan, this is very timely — we're actually in the middle of reviewing our energy strategy for 2026/27. Can you send the 1-pager? Happy to set up a call next week.",
  "Ciao Luciano, ottima tempistica. Possiamo organizzare una call la prossima settimana? Sono interessato a capire i numeri.",
  "Interesting, let's set up a call. Mid-week works best for me.",
];
const REPLY_NEGATIVE = [
  "Hi, thanks for reaching out but solar is not on the roadmap this year. Please remove me from the list.",
  "Non siamo interessati al momento, grazie.",
];

async function findUserIdByEmail(email) {
  let page = 1; const perPage = 200;
  while (true) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = (data?.users ?? []).find(u => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if ((data?.users ?? []).length < perPage) return null;
    page += 1; if (page > 50) return null;
  }
}

async function upsertSeller(bioId, seller) {
  const userId = await findUserIdByEmail(seller.email);
  // Check existing by (company_bio_id, name)
  const { data: existing } = await svc
    .from("sellers")
    .select("id, name, user_id")
    .eq("company_bio_id", bioId)
    .eq("name", seller.name)
    .maybeSingle();
  if (existing) {
    if (userId && existing.user_id !== userId) {
      await svc.from("sellers").update({ user_id: userId, active: true }).eq("id", existing.id);
    }
    console.log(`  Reusing seller ${seller.name} id=${existing.id}`);
    return existing.id;
  }
  const { data, error } = await svc
    .from("sellers")
    .insert({
      name: seller.name,
      company_bio_id: bioId,
      user_id: userId,
      active: true,
      linkedin_daily_limit: seller.linkedin_daily_limit,
      email_daily_limit: seller.email_daily_limit,
      call_daily_limit: seller.call_daily_limit,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seller insert failed: ${error?.message}`);
  console.log(`  Created seller ${seller.name} id=${data.id}`);
  return data.id;
}

async function main() {
  // 1) Resolve tenant
  console.log(`→ Resolving tenant "${TENANT_NAME}" ...`);
  const { data: bio, error: bioErr } = await svc
    .from("company_bios").select("id").eq("company_name", TENANT_NAME).is("archived_at", null).single();
  if (bioErr || !bio) { console.error(`Bio not found: ${bioErr?.message}`); process.exit(1); }
  const BIO = bio.id;
  console.log(`  bio_id = ${BIO}`);

  // 2) Sellers
  console.log(`→ Upserting sellers ...`);
  const sellerIds = {};
  for (const s of SELLERS) sellerIds[s.name] = await upsertSeller(BIO, s);
  const JUAN = sellerIds["Juan Fontana"];
  const LUCHO = sellerIds["Luciano Sosa"];

  // 3) Pull all 15 leads in the tenant. Order by enrichment.import_seq (set in
  //    import-everest-leads.mjs) so the rooftop alternation maps 1:1 to the
  //    distribution below. created_at can't disambiguate within a single batch
  //    insert (Postgres evaluates now() once per statement).
  console.log(`→ Fetching 15 leads ...`);
  const { data: leads, error: leadsErr } = await svc
    .from("leads")
    .select("id, enrichment")
    .eq("company_bio_id", BIO)
    .order("enrichment->import_seq", { ascending: true });
  if (leadsErr) throw new Error(`leads fetch: ${leadsErr.message}`);
  if (!leads || leads.length !== 15) {
    console.error(`Expected 15 leads, got ${leads?.length ?? 0}. Run import-everest-leads.mjs first.`);
    process.exit(1);
  }
  const L = leads.map(l => l.id);

  // 4) Distribution plan. Index → (campaign group, role, sellerId)
  //
  //    Audit (A) — 8 leads (indices 0..7), seller Juan
  //    Storage (B) — 4 leads (8, 10, 12, 14), seller Luciano
  //    Renurture (C) — 3 leads (9, 11, 13), seller Juan
  //
  //    Role per lead drives status / which steps are 'sent' vs 'draft' /
  //    whether a reply lands.
  const plan = [
    // index, group, role, seller, lead status, opportunity_stage
    { i: 0,  g: "A", role: "won",          sellerId: JUAN,  leadStatus: "closed_won",  oppStage: "won",          startedDaysAgo: 32, repliedAtStep: 1, reply: "positive" },
    { i: 1,  g: "A", role: "cr_sent",      sellerId: JUAN,  leadStatus: "contacted",   oppStage: null,           startedDaysAgo:  3 },
    { i: 2,  g: "A", role: "mid_seq",      sellerId: JUAN,  leadStatus: "contacted",   oppStage: null,           startedDaysAgo:  9 },
    { i: 3,  g: "A", role: "mid_seq",      sellerId: JUAN,  leadStatus: "contacted",   oppStage: null,           startedDaysAgo: 12 },
    { i: 4,  g: "A", role: "lost",         sellerId: JUAN,  leadStatus: "closed_lost", oppStage: null,           startedDaysAgo: 28, repliedAtStep: 2, reply: "negative" },
    { i: 5,  g: "A", role: "late_seq",     sellerId: JUAN,  leadStatus: "contacted",   oppStage: null,           startedDaysAgo: 18 },
    { i: 6,  g: "A", role: "qualified",    sellerId: JUAN,  leadStatus: "qualified",   oppStage: "negotiation",  startedDaysAgo: 22, repliedAtStep: 1, reply: "positive" },
    { i: 7,  g: "A", role: "mid_seq",      sellerId: JUAN,  leadStatus: "contacted",   oppStage: null,           startedDaysAgo:  7 },
    // Campaign B — only solar-having leads (indices 8, 10, 12, 14)
    { i: 8,  g: "B", role: "completed",    sellerId: LUCHO, leadStatus: "contacted",   oppStage: null,           startedDaysAgo: 45 },
    { i: 10, g: "B", role: "won",          sellerId: LUCHO, leadStatus: "closed_won",  oppStage: "won",          startedDaysAgo: 50, repliedAtStep: 1, reply: "positive" },
    { i: 12, g: "B", role: "lost",         sellerId: LUCHO, leadStatus: "closed_lost", oppStage: null,           startedDaysAgo: 42, repliedAtStep: 2, reply: "negative" },
    { i: 14, g: "B", role: "completed",    sellerId: LUCHO, leadStatus: "contacted",   oppStage: null,           startedDaysAgo: 48 },
    // Campaign C — paused renurture (indices 9, 11, 13)
    { i: 9,  g: "C", role: "paused_draft", sellerId: JUAN,  leadStatus: "new",         oppStage: null,           startedDaysAgo:  4 },
    { i: 11, g: "C", role: "paused_partial", sellerId: JUAN, leadStatus: "contacted",  oppStage: null,           startedDaysAgo:  8 },
    { i: 13, g: "C", role: "paused_draft", sellerId: JUAN,  leadStatus: "new",         oppStage: null,           startedDaysAgo:  4 },
  ];

  // 5) Hydrate per-lead first_name + company from the CSV (the encrypted
  //    columns can't be filtered/read directly without the tenant key, and the
  //    leads were imported in CSV order via enrichment.import_seq above).
  console.log(`→ Hydrating lead context ...`);
  const csvText = readFileSync(join(dirname(dirname(ROOT)), "business-context", "everest", "leads-source.csv"), "utf8");
  const csvLines = csvText.split("\n").filter(l => l.trim()).slice(1); // drop header
  const csvRows = csvLines.map(l => l.split(";"));
  if (csvRows.length !== 15) {
    console.error(`CSV row count mismatch — expected 15, got ${csvRows.length}`);
    process.exit(1);
  }
  const leadCtx = L.map((id, i) => ({
    id,
    first_name: csvRows[i][0],
    last_name:  csvRows[i][1],
    company:    csvRows[i][3],
  }));

  const CAMPAIGN_GROUPS = {
    A: { name: "Q2 2026 — Industrial Solar Audit",       channel: "linkedin", sequence: SEQ_AUDIT,   messages: M_AUDIT },
    B: { name: "Q1 2026 — Storage Retrofit Outreach",    channel: "linkedin", sequence: SEQ_STORAGE, messages: M_STORAGE },
    C: { name: "Renurture — Q3 Re-engagement",           channel: "email",    sequence: SEQ_RENURTURE, messages: M_RENURTURE },
  };

  // Build campaign + message rows
  const campaignInserts = [];
  const messagePlans = []; // { leadIdx, campaignTempKey, rows[] }
  const replyPlans   = []; // { leadIdx, classification, text, repliedAtStep, channel }
  const leadUpdates  = []; // { id, patch }

  for (const p of plan) {
    const ctx = leadCtx[p.i];
    const group = CAMPAIGN_GROUPS[p.g];
    const seq = group.sequence;
    const sellerId = p.sellerId;

    // Pick role-driven completion shape
    let campaignStatus, currentStep, stopReason, sentStepCount, lastStepDaysAgo;
    if (p.role === "won" || p.role === "qualified") {
      campaignStatus = "completed";
      stopReason = "positive_response";
      sentStepCount = (p.repliedAtStep ?? 1) + 1; // CR + steps up to and including reply
      currentStep = sentStepCount - 1;
      lastStepDaysAgo = Math.max(1, p.startedDaysAgo - 10);
    } else if (p.role === "lost") {
      campaignStatus = "completed";
      stopReason = "negative_response";
      sentStepCount = (p.repliedAtStep ?? 1) + 1;
      currentStep = sentStepCount - 1;
      lastStepDaysAgo = Math.max(1, p.startedDaysAgo - 8);
    } else if (p.role === "completed") {
      campaignStatus = "completed";
      stopReason = "sequence_complete";
      sentStepCount = seq.length;
      currentStep = sentStepCount - 1;
      lastStepDaysAgo = Math.max(1, p.startedDaysAgo - 20);
    } else if (p.role === "cr_sent") {
      campaignStatus = "active";
      sentStepCount = 1; // just the CR
      currentStep = 0;
      lastStepDaysAgo = p.startedDaysAgo;
    } else if (p.role === "mid_seq") {
      campaignStatus = "active";
      sentStepCount = 2; // CR + step 1
      currentStep = 1;
      lastStepDaysAgo = Math.max(1, p.startedDaysAgo - 3);
    } else if (p.role === "late_seq") {
      campaignStatus = "active";
      sentStepCount = 3; // CR + step 1 + step 2
      currentStep = 2;
      lastStepDaysAgo = Math.max(1, p.startedDaysAgo - 8);
    } else if (p.role === "paused_partial") {
      campaignStatus = "paused";
      sentStepCount = 1;
      currentStep = 0;
      lastStepDaysAgo = p.startedDaysAgo;
    } else if (p.role === "paused_draft") {
      campaignStatus = "paused";
      sentStepCount = 0;
      currentStep = 0;
      lastStepDaysAgo = p.startedDaysAgo;
    } else {
      throw new Error(`Unknown role ${p.role}`);
    }

    const startedAt = isoDaysAgo(p.startedDaysAgo);
    const lastStepAt = isoDaysAgo(lastStepDaysAgo);
    const tempKey = `${p.g}:${p.i}`;

    campaignInserts.push({
      tempKey,
      row: {
        lead_id: ctx.id,
        seller_id: sellerId,
        name: group.name,
        channel: group.channel,
        status: campaignStatus,
        current_step: currentStep,
        sequence_steps: seq.slice(1), // followups only (matches /campaigns/approve convention)
        stop_reason: stopReason ?? null,
        started_at: startedAt,
        last_step_at: lastStepAt,
        created_at: startedAt,
      },
    });

    // Build message rows for this lead.
    const isCrGroup = p.g === "A" || p.g === "B";
    const msgRows = [];
    let cumDays = 0;
    if (isCrGroup) {
      // step 0 CR
      const crBody = group.messages.cr(ctx.first_name, ctx.company);
      const crSent = sentStepCount > 0;
      msgRows.push({
        step_number: 0, channel: "linkedin", content: crBody,
        status: crSent ? "sent" : "draft",
        sent_at: crSent ? isoDaysAgo(p.startedDaysAgo) : null,
        created_at: startedAt,
      });
      cumDays = 0;
      for (let step = 1; step < seq.length; step++) {
        cumDays += seq[step].daysAfter ?? 0;
        const stepCh = seq[step].channel;
        const stepSent = step < sentStepCount;
        const sentDaysAgo = Math.max(0, p.startedDaysAgo - cumDays);
        let body, subject = null;
        if (p.g === "A") {
          if (step === 1)      body = M_AUDIT.step1(ctx.first_name, ctx.company);
          else if (step === 2) { body = M_AUDIT.step2(ctx.first_name, ctx.company); subject = M_AUDIT.step2sub(ctx.company); }
          else if (step === 3) body = M_AUDIT.step3(ctx.first_name);
          else                 { body = M_AUDIT.step4(ctx.first_name, ctx.company); subject = M_AUDIT.step4sub(); }
        } else {
          // B — storage
          if (step === 1)      { body = M_STORAGE.step1(ctx.first_name, ctx.company); subject = M_STORAGE.step1sub(ctx.company); }
          else if (step === 2) body = M_STORAGE.step2(ctx.first_name);
          else                 { body = M_STORAGE.step3(ctx.first_name); subject = M_STORAGE.step3sub(); }
        }
        msgRows.push({
          step_number: step, channel: stepCh, content: body, subject,
          status: stepSent ? "sent" : (campaignStatus === "active" ? "draft" : "draft"),
          sent_at: stepSent ? isoDaysAgo(sentDaysAgo) : null,
          created_at: startedAt,
        });
      }
    } else {
      // C — renurture, 2 steps, no CR. step 0 = email, step 1 = LinkedIn DM.
      cumDays = 0;
      for (let step = 0; step < seq.length; step++) {
        cumDays += seq[step].daysAfter ?? 0;
        const stepCh = seq[step].channel;
        const stepSent = step < sentStepCount;
        const sentDaysAgo = Math.max(0, p.startedDaysAgo - cumDays);
        let body, subject = null;
        if (step === 0) { body = M_RENURTURE.step0(ctx.first_name, ctx.company); subject = M_RENURTURE.step0sub(); }
        else            { body = M_RENURTURE.step1(ctx.first_name); }
        msgRows.push({
          step_number: step, channel: stepCh, content: body, subject,
          status: stepSent ? "sent" : "draft",
          sent_at: stepSent ? isoDaysAgo(sentDaysAgo) : null,
          created_at: startedAt,
        });
      }
    }

    messagePlans.push({ tempKey, leadIdx: p.i, leadId: ctx.id, rows: msgRows });

    // Lead patch
    const patch = {};
    if (p.leadStatus && p.leadStatus !== "new") patch.status = p.leadStatus;
    if (p.oppStage) patch.opportunity_stage = p.oppStage;
    if (sentStepCount > 0) patch.current_channel = group.channel;
    if (p.role === "won" || p.role === "qualified") {
      patch.transferred_to_odoo_at = isoDaysAgo(Math.max(0, p.startedDaysAgo - 12));
    }
    if (Object.keys(patch).length > 0) leadUpdates.push({ id: ctx.id, patch });

    // Reply plan
    if (p.reply) {
      const isPositive = p.reply === "positive";
      const channel = seq[p.repliedAtStep]?.channel ?? "linkedin";
      const text = isPositive
        ? REPLY_POSITIVE[p.i % REPLY_POSITIVE.length]
        : REPLY_NEGATIVE[p.i % REPLY_NEGATIVE.length];
      replyPlans.push({
        tempKey,
        leadId: ctx.id,
        channel,
        text,
        classification: isPositive ? "positive" : "negative",
        repliedDaysAgo: Math.max(1, p.startedDaysAgo - 11),
      });
    }
  }

  // 6) Insert campaigns
  console.log(`→ Inserting ${campaignInserts.length} campaigns ...`);
  const { data: campRes, error: campErr } = await svc
    .from("campaigns")
    .insert(campaignInserts.map(c => c.row))
    .select("id, lead_id, name");
  if (campErr) { console.error(`campaigns insert: ${campErr.message}`); process.exit(1); }
  // Build map: leadId+name → campaignId (a lead is unique within one campaign-name group here)
  const campIdByLeadName = new Map();
  for (const c of campRes ?? []) campIdByLeadName.set(`${c.lead_id}|${c.name}`, c.id);

  // 7) Insert campaign_messages
  console.log(`→ Inserting campaign_messages ...`);
  const groupNameByKey = new Map();
  for (const c of campaignInserts) groupNameByKey.set(c.tempKey, c.row.name);

  const msgRowsAll = [];
  for (const mp of messagePlans) {
    const cname = groupNameByKey.get(mp.tempKey);
    const campaignId = campIdByLeadName.get(`${mp.leadId}|${cname}`);
    if (!campaignId) throw new Error(`No campaign id for ${mp.tempKey}`);
    for (const r of mp.rows) {
      msgRowsAll.push({
        campaign_id: campaignId,
        lead_id: mp.leadId,
        step_number: r.step_number,
        channel: r.channel,
        content: r.content,
        status: r.status,
        sent_at: r.sent_at,
        created_at: r.created_at,
        metadata: r.subject ? { subject: r.subject } : null,
      });
    }
  }
  const { error: msgErr } = await svc.from("campaign_messages").insert(msgRowsAll);
  if (msgErr) { console.error(`campaign_messages insert: ${msgErr.message}`); process.exit(1); }
  console.log(`  ${msgRowsAll.length} messages inserted`);

  // 8) Insert lead_replies
  if (replyPlans.length > 0) {
    console.log(`→ Inserting ${replyPlans.length} lead_replies ...`);
    const replyRows = replyPlans.map(r => {
      const cname = groupNameByKey.get(r.tempKey);
      const campaignId = campIdByLeadName.get(`${r.leadId}|${cname}`);
      return {
        lead_id: r.leadId,
        campaign_id: campaignId,
        channel: r.channel,
        reply_text: r.text,
        classification: r.classification,
        ai_confidence: 0.92,
        requires_human_review: false,
        received_at: isoDaysAgo(r.repliedDaysAgo),
      };
    });
    const { error: replyErr } = await svc.from("lead_replies").insert(replyRows);
    if (replyErr) { console.error(`lead_replies insert: ${replyErr.message}`); process.exit(1); }
  }

  // 9) Update leads (status / opportunity_stage / current_channel / transferred_to_odoo_at)
  if (leadUpdates.length > 0) {
    console.log(`→ Updating ${leadUpdates.length} leads ...`);
    for (const u of leadUpdates) {
      const { error } = await svc.from("leads").update(u.patch).eq("id", u.id);
      if (error) { console.error(`lead update ${u.id}: ${error.message}`); process.exit(1); }
    }
  }

  console.log(`\n✓ Done.`);
  console.log(`  bio_id            = ${BIO}`);
  console.log(`  Sellers           = Juan (${JUAN}), Luciano (${LUCHO})`);
  console.log(`  Campaigns inserted = ${campaignInserts.length}`);
  console.log(`  Messages inserted = ${msgRowsAll.length}`);
  console.log(`  Replies inserted  = ${replyPlans.length}`);
}

main().catch(e => { console.error("✘", e.message); process.exit(1); });
