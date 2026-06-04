import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserScope, canApproveCampaigns } from "@/lib/scope";
import { autoNormalizePlaceholders } from "@/lib/placeholders";

// Use service key to bypass RLS for admin operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function POST(req: NextRequest) {
  // Approving a campaign request kicks off real outbound sends (LinkedIn /
  // email / call). Restrict to SWL admins. Without this gate, any logged-in
  // user could POST a known requestId and trigger sends on a tenant they
  // don't own. Middleware already enforces authentication on this path.
  const scope = await getUserScope();
  if (!canApproveCampaigns(scope.tier)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { requestId } = await req.json();

  if (!requestId) {
    return NextResponse.json({ error: "requestId is required" }, { status: 400 });
  }

  // 1. Fetch the campaign request
  const { data: request, error: fetchErr } = await supabase
    .from("campaign_requests")
    .select("*")
    .eq("id", requestId)
    .single();

  if (fetchErr || !request) {
    return NextResponse.json({ error: "Campaign request not found" }, { status: 404 });
  }

  if (request.status !== "pending_review") {
    return NextResponse.json({ error: `Request is already ${request.status}` }, { status: 400 });
  }

  const prompts = request.message_prompts ?? {};
  const sequence: { channel: string; daysAfter: number }[] = prompts.sequence ?? [];
  const channels: string[] = request.channels ?? [...new Set(sequence.map((s: any) => s.channel))];

  // call_advance_mode: 'auto' (default, pre-2026-05-21 behavior) lets the
  // dispatch-call cron auto-dial + advance past the call step regardless of
  // outcome. 'manual' freezes the sequence at the call step until the seller
  // dials via /api/aircall/dial. The wizard surfaces this as a radio button
  // and ships it inside message_prompts.callAdvanceMode.
  const rawMode = (prompts as any).callAdvanceMode;
  const callAdvanceMode: "auto" | "manual" = rawMode === "manual" ? "manual" : "auto";

  // Campaign OWNER — the team member who follows the whole campaign + owns the
  // calls (a head-of-sales assigning an internal rep). Label-only for now: we
  // stamp leads.assigned_seller with the owner's name so it shows in the lead
  // detail + flow card. The LinkedIn SENDING identity is the per-lead seller
  // (stamped into leads.linkedin_assigned_account below). Wizard ships
  // ownerName/ownerUserId inside message_prompts.
  const ownerName: string | null = (prompts as any).ownerName ?? null;

  // When sequence[0] is the LinkedIn day-0 invite, that entry IS the
  // Connection Request — its body lives in channelMessages.connectionRequest
  // (added below as step_number=0). The wizard reserves channelMessages.steps[0]
  // as the matching CR slot (empty body). We must drop both from the followup
  // arrays before writing campaign_messages so we don't end up with a phantom
  // step_number=1 with an empty LinkedIn body that would try to send right
  // after the CR is accepted. (Fran caught this on 2026-05-26 — 151 PE Spain
  // campaigns had to be migrated in place.)
  const hasCR = sequence[0]?.channel === "linkedin" && sequence[0]?.daysAfter === 0;
  const followupSequence = hasCR ? sequence.slice(1) : sequence;

  // Support both old format (messages[]) and new format (channelMessages.steps[])
  let messages: { step: number; channel: string; subject?: string | null; body: string }[] = [];
  let autoReplies: { positive?: string; negative?: string } = {};

  if (prompts.channelMessages?.steps?.length > 0) {
    // New structured format. Strip the CR slot in lockstep with the sequence
    // so steps[i] aligns positionally with followupSequence[i].
    const rawSteps = prompts.channelMessages.steps;
    const followupSteps = hasCR ? rawSteps.slice(1) : rawSteps;
    messages = followupSteps.map((s: any, i: number) => ({
      step: i + 1,
      channel: s.channel ?? followupSequence[i]?.channel ?? "linkedin",
      subject: s.subject ?? null,
      body: s.body ?? "",
    }));
    autoReplies = {
      positive: prompts.channelMessages.autoReplies?.positive ?? "",
      negative: prompts.channelMessages.autoReplies?.negative ?? "",
    };
  } else if (prompts.messages?.length > 0) {
    // Old flat format
    messages = prompts.messages;
  }

  // Selected lead IDs from partial selection
  const selectedLeadIds: string[] = prompts.selectedLeadIds ?? [];

  // 2. Get the leads to create campaigns for
  let leadIds: string[] = [];

  // Reused for both selection paths: drop any lead that already has an
  // active/paused campaign OR received a sent message in the last 90 days.
  // Returns the surviving IDs (preserving caller order) + the rejected set.
  // De Vera Grill 2026-05-26 incident: 6 of 22 leads got two intros from
  // April + May campaigns because the path that honored selectedLeadIds
  // skipped this guard. Bulk-ICP already did it; this generalises it.
  async function dropRecentlyTouched(ids: string[]): Promise<{ keep: string[]; rejected: string[] }> {
    if (ids.length === 0) return { keep: [], rejected: [] };
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const [activeRes, recentTouchRes] = await Promise.all([
      supabase.from("campaigns").select("lead_id").in("lead_id", ids).in("status", ["active", "paused"]),
      supabase.from("campaign_messages").select("lead_id").in("lead_id", ids).eq("status", "sent").gte("sent_at", ninetyDaysAgo),
    ]);
    const excluded = new Set<string>();
    for (const c of activeRes.data ?? []) excluded.add((c as any).lead_id);
    for (const m of recentTouchRes.data ?? []) excluded.add((m as any).lead_id);
    return {
      keep: ids.filter(id => !excluded.has(id)),
      rejected: [...excluded],
    };
  }

  let rejectedRecentlyTouched: string[] = [];

  if (request.lead_id) {
    // Individual lead campaign — explicit single-lead approval, skip the
    // 90d guard. Seller asked for THIS specific lead by name; treat as
    // intent override.
    leadIds = [request.lead_id];
  } else if (selectedLeadIds.length > 0) {
    // Partial selection from profile. Apply the same 90d touch guard the
    // bulk-ICP path uses so manually-selected leads can't re-engage someone
    // who got an intro from a sibling campaign in the last quarter.
    const { keep, rejected } = await dropRecentlyTouched(selectedLeadIds);
    leadIds = keep;
    rejectedRecentlyTouched = rejected;
  } else if (request.icp_profile_id) {
    // Bulk campaign for all uncampaigned leads in this ICP profile.
    const { data: profileLeads } = await supabase
      .from("leads")
      .select("id")
      .eq("icp_profile_id", request.icp_profile_id);

    const allIds = (profileLeads ?? []).map(l => l.id);
    const { keep, rejected } = await dropRecentlyTouched(allIds);
    leadIds = keep;
    rejectedRecentlyTouched = rejected;
  }

  if (leadIds.length === 0) {
    // Still approve the request but no campaigns to create. Surface the
    // rejection reason so the admin can see whether the result was "no
    // matching leads" or "every selected lead was recently touched".
    await supabase.from("campaign_requests").update({ status: "approved" }).eq("id", requestId);
    return NextResponse.json({
      approved: true,
      campaignsCreated: 0,
      message: rejectedRecentlyTouched.length > 0
        ? `All ${rejectedRecentlyTouched.length} leads were excluded — each has an active campaign or was contacted in the last 90 days.`
        : "No eligible leads found",
      rejectedRecentlyTouched,
    });
  }

  // 3. Resolve seller assignment per lead.
  //    Multi-seller: prompts.sellerQuotas = [{ sellerId, quota }] distributes leads
  //    in order (first quota[0].quota leads → seller 0, next quota[1].quota → seller 1…).
  //    Single-seller: falls back to prompts.sellerId, then to the first active tenant seller.
  const sellerQuotas: { sellerId: string; quota: number }[] | null =
    Array.isArray(prompts.sellerQuotas) && prompts.sellerQuotas.length > 1
      ? prompts.sellerQuotas
      : null;

  // Build per-lead seller map when multiple quotas are set.
  const leadSellerMap = new Map<string, string>();
  if (sellerQuotas) {
    let offset = 0;
    for (const q of sellerQuotas) {
      const slice = leadIds.slice(offset, offset + q.quota);
      for (const lid of slice) leadSellerMap.set(lid, q.sellerId);
      offset += q.quota;
    }
    // Any overflow leads (if quotas don't sum to total) → last seller in list.
    for (let i = offset; i < leadIds.length; i++) {
      leadSellerMap.set(leadIds[i], sellerQuotas[sellerQuotas.length - 1].sellerId);
    }
  }

  // Fallback single-seller (used when no multi-quota or for overflow).
  const chosenSellerId: string | null = prompts.sellerId ?? null;
  let fallbackSellerId: string | null = chosenSellerId;
  if (!fallbackSellerId && leadIds.length > 0) {
    const { data: leadForBio } = await supabase
      .from("leads")
      .select("company_bio_id")
      .eq("id", leadIds[0])
      .maybeSingle();
    const tenantBioId = (leadForBio as any)?.company_bio_id ?? null;
    if (tenantBioId) {
      // Honor shared sellers (admin assigns via "Sellers shared with this
      // client" toggle). Without the OR clause this fallback would skip
      // shared sellers and silently leave campaigns sellerless.
      const { data: firstSeller } = await supabase
        .from("sellers")
        .select("id")
        .eq("active", true)
        .or(`company_bio_id.eq.${tenantBioId},shared_with_company_bio_ids.cs.{${tenantBioId}}`)
        .order("name", { ascending: true })
        .limit(1)
        .maybeSingle();
      fallbackSellerId = firstSeller?.id ?? null;
    }
  }

  // Resolve seller (LinkedIn account) names for the leads.linkedin_assigned_account
  // stamp. Covers every seller referenced by the quota map + the fallback.
  const sellerNameById = new Map<string, string>();
  {
    const ids = [...new Set([...leadSellerMap.values(), fallbackSellerId].filter(Boolean) as string[])];
    if (ids.length > 0) {
      const { data: sRows } = await supabase.from("sellers").select("id, name").in("id", ids);
      for (const s of sRows ?? []) sellerNameById.set((s as any).id, (s as any).name);
    }
  }

  // 4. Create campaigns and messages for each lead
  let campaignsCreated = 0;
  // Track every campaign id we create in this approve so we can run the
  // tailor pass at the end (feature 2026-06-02: AI fills {{tailored:hook}}
  // and {{tailored:fit}} per lead). The tailor endpoint is a no-op for
  // campaigns whose templates have no slots, so this list is safe to
  // pass through regardless.
  const createdCampaignIds: string[] = [];
  const errors: string[] = [];

  for (const leadId of leadIds) {
    // Per-lead seller: quota map takes precedence, then fallback single-seller.
    const sellerId = leadSellerMap.get(leadId) ?? fallbackSellerId;

    // Primary channel = the lead's first contact. When there's a CR, the
    // invite itself is the first touch (LinkedIn). Otherwise it's whatever
    // the seller picked first.
    const primaryChannel = sequence[0]?.channel ?? channels[0] ?? "linkedin";

    // Create campaign
    const { data: campaign, error: campErr } = await supabase
      .from("campaigns")
      .insert({
        lead_id: leadId,
        seller_id: sellerId,
        name: request.name,
        channel: primaryChannel,
        status: "active",
        current_step: 0,
        // sequence_steps stores ONLY the numbered followups (no CR slot).
        // The dispatcher looks up step config via sequence_steps[step_number - 1],
        // so step 1 → followupSequence[0], step 2 → followupSequence[1], etc.
        // step_number=0 (the CR) is handled specially in the dispatcher.
        sequence_steps: followupSequence,
        call_advance_mode: callAdvanceMode,
        started_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (campErr || !campaign) {
      errors.push(`Lead ${leadId}: ${campErr?.message ?? "failed to create campaign"}`);
      continue;
    }

    // Create campaign_messages: connection request (if LinkedIn) + all steps
    const messageInserts: any[] = [];

    // Compute when the first LinkedIn step actually fires (cumulative days
    // from campaign start). The connection request is scheduled to fire one
    // day before that, giving the lead ~24h to accept before we try to DM.
    // If LinkedIn is the first step (Day 0), invite fires Day 0 too.
    let firstLinkedinCumDay: number | null = null;
    let cumDays = 0;
    for (let i = 0; i < sequence.length; i++) {
      cumDays += i === 0 ? 0 : (sequence[i].daysAfter ?? 0);
      if (sequence[i].channel === "linkedin" && firstLinkedinCumDay === null) {
        firstLinkedinCumDay = cumDays;
        break;
      }
    }

    // Add connection request as step 0 if LinkedIn is anywhere in the sequence.
    // We seed it as `queued` so /api/cron/dispatch-queue picks it up on the next
    // eligible tick, calls Unipile, and only flips it to 'sent' when LinkedIn
    // confirms. Steps 1+ stay as 'draft' until the connection is accepted (the
    // BESFOHaqTt2Ki0Vw "Registro de Nueva Conexion" workflow then queues them).
    //
    // eligible_at scheduling: when LinkedIn isn't the first step, we hold the
    // invite until ~24h before the first LinkedIn DM. Sending it earlier than
    // the email would surface in the timeline before the email and feel out
    // of order; sending it AT the LinkedIn DM day is too late (lead needs time
    // to accept). One day's lead time is the right tradeoff.
    // autoNormalizePlaceholders rewrites foreign-syntax placeholders
    // (`[First Name]`, `<<First Name>>`, `%FIRST_NAME%`, `__first_name__`)
    // to their canonical `{{first_name}}` form. Operators paste copy in
    // from Mailchimp / Apollo / Outreach all the time; without this the
    // dispatcher would refuse the row (and rightly so — 2026-05-31
    // Craig Wilson incident shipped raw `[First Name]`). Doing it on
    // save means the row that ends up in campaign_messages.content is
    // always canonical, so the dispatcher never has to fix it.
    const connectionRequestRaw = prompts.channelMessages?.connectionRequest ?? "";
    const connectionRequest = autoNormalizePlaceholders(connectionRequestRaw).normalized;
    if (connectionRequest && channels.includes("linkedin")) {
      const inviteOffsetDays = Math.max(0, (firstLinkedinCumDay ?? 0) - 1);
      const eligibleAt = inviteOffsetDays > 0
        ? new Date(Date.now() + inviteOffsetDays * 86400000).toISOString()
        : null;
      messageInserts.push({
        campaign_id: campaign.id,
        lead_id: leadId,
        step_number: 0,
        channel: "linkedin",
        content: connectionRequest,
        status: "queued",
        created_at: new Date().toISOString(),
        metadata: eligibleAt ? { eligible_at: eligibleAt } : null,
      });
    }

    // Add regular step messages (step 1, 2, 3...).
    // Step 1 email/call fires immediately (independent of LinkedIn connection).
    // Step 1 LinkedIn DM and all steps 2+ stay draft: they are queued by the
    // dispatch cron after the previous step completes, or by the acceptance
    // webhook (BESFOHaqTt2Ki0Vw) for LinkedIn DMs that need connection first.
    messages.forEach((msg, i) => {
      const stepNum = msg.step ?? i + 1;
      const ch = msg.channel ?? sequence[i]?.channel ?? primaryChannel;
      const isFirstNonLinkedin = stepNum === 1 && ch !== "linkedin";
      const bodyNormalized = autoNormalizePlaceholders(msg.body ?? "").normalized;
      const subjectNormalized = msg.subject
        ? autoNormalizePlaceholders(msg.subject).normalized
        : null;
      messageInserts.push({
        campaign_id: campaign.id,
        lead_id: leadId,
        step_number: stepNum,
        channel: ch,
        content: bodyNormalized,
        status: isFirstNonLinkedin ? "queued" : "draft",
        created_at: new Date().toISOString(),
        // Email subjects live in metadata.subject — normalize there too so
        // the dispatcher reads a canonical subject at send time.
        ...(subjectNormalized ? { metadata: { subject: subjectNormalized } } : {}),
      });
    });

    if (messageInserts.length > 0) {
      const { error: msgErr } = await supabase
        .from("campaign_messages")
        .insert(messageInserts);

      if (msgErr) {
        errors.push(`Lead ${leadId} messages: ${msgErr.message}`);
      }
    }

    // Update lead's channel only — DO NOT mark as contacted yet. The cron
    // dispatcher will flip the lead to 'contacted' once Unipile confirms the
    // invite was actually sent. (Pre-fix bug: lead was marked contacted before
    // any LinkedIn call, producing 8 ghost-contacted leads on Pathway.)
    // Stamp the owner (assigned_seller = who follows the campaign) and the
    // LinkedIn sending account (linkedin_assigned_account = the seller). Both
    // are display labels for now — they drive the lead detail + flow-card
    // attribution without changing queue/Aircall routing.
    const linkedinAccountName = sellerId ? (sellerNameById.get(sellerId) ?? null) : null;
    await supabase
      .from("leads")
      .update({
        current_channel: primaryChannel,
        ...(ownerName ? { assigned_seller: ownerName } : {}),
        ...(linkedinAccountName ? { linkedin_assigned_account: linkedinAccountName } : {}),
      })
      .eq("id", leadId);

    campaignsCreated++;
    createdCampaignIds.push(campaign.id);
  }

  // 4b. Tailor pass — for each newly created campaign, fill the AI slots
  //     (`{{tailored:hook}}`, `{{tailored:fit}}`) on its first-touch
  //     messages. Per Fran's spec (2026-06-02): synchronous — block until
  //     done so the seller sees fully-rendered messages on approve.
  //     Concurrency-5 here keeps the rate under Anthropic's tier limit
  //     while still finishing a 100-lead campaign in ~30-60s. The tailor
  //     route itself is idempotent + no-ops for templates without slots,
  //     so this is safe to call unconditionally.
  if (createdCampaignIds.length > 0) {
    const origin = req.nextUrl.origin;
    const cookieHeader = req.headers.get("cookie") ?? "";
    const TAILOR_CONCURRENCY = 5;
    let cursor = 0;
    let tailoredCount = 0;
    async function tailorWorker() {
      while (true) {
        const idx = cursor++;
        if (idx >= createdCampaignIds.length) return;
        const cid = createdCampaignIds[idx];
        try {
          const r = await fetch(`${origin}/api/campaigns/tailor`, {
            method: "POST",
            headers: { "Content-Type": "application/json", cookie: cookieHeader },
            body: JSON.stringify({ campaignId: cid }),
          });
          if (r.ok) {
            const body = await r.json().catch(() => ({})) as { tailored?: number };
            tailoredCount += body.tailored ?? 0;
          }
        } catch { /* swallow — campaign is still usable without tailoring */ }
      }
    }
    await Promise.all(Array.from({ length: Math.min(TAILOR_CONCURRENCY, createdCampaignIds.length) }, () => tailorWorker()));
    void tailoredCount; // reserved — could surface in the response if the UI wants to show "AI-tailored X messages"
  }

  // 5. Mark the request as approved
  await supabase
    .from("campaign_requests")
    .update({ status: "approved" })
    .eq("id", requestId);

  return NextResponse.json({
    approved: true,
    campaignsCreated,
    totalLeads: leadIds.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
