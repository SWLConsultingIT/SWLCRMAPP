import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canCreateCampaigns } from "@/lib/scope";
import { selectAllPages, selectByIds, chunkIds } from "@/lib/supabase-bulk";
import { autoNormalizePlaceholders } from "@/lib/placeholders";

// Edit a flow that is already running.
//
// A "flow" is every campaign row sharing a name — one row per enrolled lead —
// and each of those has its own campaign_messages rows. Two things about that
// were wrong here until 2026-08-27:
//
//   1. Message edits were applied BY ROW ID. The editor loads the messages of
//      the single campaign in the URL, so the payload carried one row id per
//      step and the save rewrote exactly one lead's copy. On the PE & VC USA
//      flow that is 1 of 1 166 leads: the seller changed the text, saw it
//      saved, and 6 615 queued messages still went out with the old wording.
//      Edits now apply per STEP across the whole flow.
//
//   2. Nothing was paged or chunked. Reading the siblings truncated at 1 000,
//      and then `.in("id", <1 000+ uuids>)` is a ~36 KB query string that
//      Supabase answers 400 to — so on the biggest flows the save didn't half
//      work, it failed outright with a 500.
//
// And one rule that was missing entirely: a SENT message is history. Rewriting
// its content makes the thread show wording that never left the building. Only
// queued/draft rows are updated; sent ones are counted and reported back.

type MsgPayload = { id?: string; content?: string; subject?: string; attachments?: unknown[] };

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canCreateCampaigns(scope.tier)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { flowName, flowManagerId, steps, originalName, messages, newMessages, linkedinSellerIds, callSellerIds } = body;

  if (!flowName || !Array.isArray(steps)) {
    return NextResponse.json({ error: "flowName + steps required" }, { status: 400 });
  }

  const svc = getSupabaseService();

  // ── Which campaigns make up this flow ─────────────────────────────────
  type CampRow = { id: string; lead_id: string | null; status: string };
  let allCampaigns: CampRow[];
  try {
    allCampaigns = await selectAllPages<CampRow>("campaigns", () =>
      svc.from("campaigns")
        .select("id, lead_id, status")
        .eq("name", originalName ?? flowName)
        .order("id", { ascending: true }),
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  if (!allCampaigns.some(c => c.id === id)) {
    const { data: self } = await svc.from("campaigns").select("id, lead_id, status").eq("id", id).single();
    if (self) allCampaigns.push(self as CampRow);
  }
  const allCampaignIds = allCampaigns.map(c => c.id);
  // Message edits only make sense for campaigns still running. A completed or
  // closed campaign's leftover rows must not be revived by an edit.
  const liveCampaigns = allCampaigns.filter(c => c.status === "active" || c.status === "paused");
  const liveCampaignIds = liveCampaigns.map(c => c.id);

  // ── Sequence + seller + name, across the whole flow ───────────────────
  // `email_account` is deliberately absent: it is not a column on campaigns
  // (it lives on sellers, auto-assigned at dispatch). Writing it used to throw
  // a schema-cache error and block every save.
  const update: Record<string, unknown> = {
    name: flowName,
    seller_id: flowManagerId ?? null,
    sequence_steps: steps,
    linkedin_seller_ids: Array.isArray(linkedinSellerIds) && linkedinSellerIds.length > 0 ? linkedinSellerIds : null,
    call_seller_ids: Array.isArray(callSellerIds) && callSellerIds.length > 0 ? callSellerIds : null,
  };
  for (const chunk of chunkIds(allCampaignIds)) {
    const { error } = await svc.from("campaigns").update(update).in("id", chunk);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // ── Steps the seller removed ──────────────────────────────────────────
  // Valid step_numbers run 0 (LinkedIn invite) through steps.length. Anything
  // beyond that is a deleted step; cancel its unsent rows so the dispatcher
  // doesn't send a step that no longer exists.
  let cancelled = 0;
  for (const chunk of chunkIds(allCampaignIds)) {
    const { data, error } = await svc.from("campaign_messages")
      .update({ status: "skipped", metadata: { skipped_by: "edit-flow-step-removed", skipped_at: new Date().toISOString() } })
      .in("campaign_id", chunk)
      .gt("step_number", steps.length)
      .in("status", ["queued", "draft"])
      .select("id");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    cancelled += (data ?? []).length;
  }

  // ── Message edits, per step, across every live campaign ───────────────
  // One statement per step, via edit_flow_step_messages(). The obvious
  // implementation — read the rows, update each by id — is one HTTP round
  // trip per row: 6 592 of them on this flow, which is minutes of sequential
  // requests and a timeout halfway through. The function also does the
  // metadata merge in SQL, so eligible_at and the other dispatcher-written
  // fields survive, and returns the counts we report back.
  let updatedMessages = 0;
  let leftSent = 0;
  let variantsCollapsed = 0;
  if (messages && typeof messages === "object" && liveCampaignIds.length > 0) {
    for (const [stepKey, raw] of Object.entries(messages as Record<string, MsgPayload>)) {
      const stepNumber = Number(stepKey);
      if (!Number.isFinite(stepNumber)) continue;
      const m = raw ?? {};
      if (typeof m.content !== "string") continue;

      // Blindar el write path (2026-09-02): a human is typing/pasting flow copy
      // here, so run the same normalizer approve uses — rewrites foreign
      // placeholder syntax and de-bakes a literal greeting name to
      // {{first_name}} before it is stored (and later rendered per lead).
      const content = autoNormalizePlaceholders(m.content).normalized;

      const patch: Record<string, unknown> = {};
      const remove: string[] = [];
      if (m.subject) patch.subject = autoNormalizePlaceholders(m.subject).normalized; else remove.push("subject");
      if (Array.isArray(m.attachments) && m.attachments.length > 0) patch.attachments = m.attachments;
      else remove.push("attachments");

      // Ids travel in the POST body, so the whole flow goes in one call —
      // no `.in()` URL ceiling to chunk around here.
      const { data, error } = await svc.rpc("edit_flow_step_messages", {
        p_campaign_ids: liveCampaignIds,
        p_step_number: stepNumber,
        p_content: content,
        p_meta_patch: patch,
        p_meta_remove: remove,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const r = (data ?? {}) as { updated?: number; sent?: number; variants?: number };
      updatedMessages += r.updated ?? 0;
      leftSent += r.sent ?? 0;
      if ((r.variants ?? 0) > 1) variantsCollapsed++;
    }
  }

  // ── Steps the seller added ────────────────────────────────────────────
  let createdMessages = 0;
  if (newMessages && typeof newMessages === "object" && liveCampaigns.length > 0) {
    const newStepNums = Object.keys(newMessages).map(Number).filter(Number.isFinite);
    if (newStepNums.length > 0) {
      type ExistRow = { campaign_id: string; step_number: number };
      let existing: ExistRow[];
      try {
        existing = await selectByIds<ExistRow>("campaign_messages", liveCampaignIds, chunk =>
          svc.from("campaign_messages")
            .select("campaign_id, step_number")
            .in("campaign_id", chunk)
            .in("step_number", newStepNums)
            .order("campaign_id", { ascending: true }),
        );
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
      }
      const seen = new Set(existing.map(r => `${r.campaign_id}:${r.step_number}`));

      const inserts: Record<string, unknown>[] = [];
      for (const campaign of liveCampaigns) {
        if (!campaign.lead_id) continue;
        for (const [stepKey, nm] of Object.entries(newMessages as Record<string, MsgPayload & { channel?: string; waitDays?: number }>)) {
          const stepNum = Number(stepKey);
          if (!Number.isFinite(stepNum)) continue;
          if (seen.has(`${campaign.id}:${stepNum}`)) continue;
          const meta: Record<string, unknown> = {
            eligible_at: new Date(Date.now() + (nm.waitDays ?? 3) * 86400000).toISOString(),
          };
          if (nm.subject) meta.subject = autoNormalizePlaceholders(nm.subject).normalized;
          inserts.push({
            campaign_id: campaign.id,
            lead_id: campaign.lead_id,
            step_number: stepNum,
            channel: nm.channel ?? "email",
            // Same write-path normalizer as the edit branch above.
            content: autoNormalizePlaceholders(nm.content ?? "").normalized,
            status: "queued",
            metadata: meta,
            created_at: new Date().toISOString(),
          });
        }
      }
      // Insert in batches — one statement per 1 166-lead flow would be a very
      // large body, and a failure mid-way should still report what landed.
      for (let i = 0; i < inserts.length; i += 500) {
        const part = inserts.slice(i, i + 500);
        const { error } = await svc.from("campaign_messages").insert(part);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        createdMessages += part.length;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    updatedCampaigns: allCampaignIds.length,
    liveCampaigns: liveCampaignIds.length,
    updatedMessages,
    createdMessages,
    cancelledMessages: cancelled,
    // Sent rows are never rewritten — reported so the UI can say so.
    leftSent,
    variantsCollapsed,
  });
}
