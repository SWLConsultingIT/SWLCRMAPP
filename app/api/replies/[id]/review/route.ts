import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getUserScope } from "@/lib/scope";

const ALLOWED_STATES = new Set(["approved", "rejected", "pending"]);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null) as { status?: string } | null;
  const status = body?.status;
  if (!status || !ALLOWED_STATES.has(status)) {
    return NextResponse.json({ error: "status must be approved|rejected|pending" }, { status: 400 });
  }

  // Tenant guard: scoped users can only mark their own replies. Cross-tenant
  // super_admin can mark anything. The join via leads enforces the tenant
  // because lead_replies has no company_bio_id of its own.
  const scope = await getUserScope();
  if (scope.isScoped && scope.companyBioId) {
    const { data: rep } = await supabase
      .from("lead_replies")
      .select("id, leads!inner(company_bio_id)")
      .eq("id", id)
      .single();
    const replyBioId = (rep as any)?.leads?.company_bio_id;
    if (!rep || replyBioId !== scope.companyBioId) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  }

  // Optional classification override — sent by the inbox quick-classify
  // buttons so a seller can both correct the AI's guess AND mark the row
  // reviewed in a single round trip.
  //
  // "follow_up" is now a real reply_classification enum value (added 2026-06-03),
  // so the seller's reclassification persists and shows consistently everywhere
  // (inbox badge + Metrics funnel/table). It is NON-terminal: unlike
  // positive/negative it does NOT cascade-close the campaign — the flow keeps
  // running and the seller follows up manually. (Pre-2026-06-03 it was UI-only
  // and writing it 500'd because it wasn't in the enum — incident 2026-05-25.)
  const ENUM_CLASS = new Set(["positive", "negative", "question", "follow_up", "meeting_intent", "needs_info", "nurturing", "not_now", "unsubscribe", "spam", "auto_reply"]);
  const classOverride = (body as { classification?: string }).classification;
  // Single-card classify buttons set sendAutoReply=true so the flow's authored
  // auto-reply goes out on the seller's click. Bulk classify omits it → stays
  // cascade-only (no surprise mass-sends).
  const sendAutoReply = (body as { sendAutoReply?: boolean }).sendAutoReply === true;
  const patch: Record<string, unknown> = {
    review_status: status,
    requires_human_review: status === "pending",
  };
  if (classOverride && ENUM_CLASS.has(classOverride)) {
    patch.classification = classOverride;
  }

  const { data: replyRow, error } = await supabase
    .from("lead_replies")
    .update(patch)
    .eq("id", id)
    .select("lead_id, campaign_id, reply_text, channel")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ─── Auto-reply send (button-triggered) ────────────────────────────────────
  // When the seller classifies positive/negative from a single inbox card, fire
  // the flow's authored auto-reply out the lead's channel BEFORE the cascade
  // closes the lead. Template lives on the campaign_request (matched by campaign
  // name, same lookup the n8n handler uses). /api/inbox/reply does the
  // placeholder substitution + send + thread log, so we just hand it the raw
  // template. Best-effort: a send failure never blocks the classification.
  // Dedupe guards against double-sends (sibling replies / double-clicks).
  let autoReplySent = false;
  if (sendAutoReply && replyRow && (classOverride === "positive" || classOverride === "negative")) {
    const leadId = (replyRow as { lead_id?: string }).lead_id ?? null;
    const campaignId = (replyRow as { campaign_id?: string }).campaign_id ?? null;
    const channel = (replyRow as { channel?: string }).channel ?? null;
    if (leadId && campaignId) {
      try {
        const { data: camp } = await supabase
          .from("campaigns").select("name, metadata").eq("id", campaignId).maybeSingle();
        const pick = (ar?: { positive?: string; negative?: string } | null) =>
          ((classOverride === "positive" ? ar?.positive : ar?.negative) ?? "").trim();
        // Preferred: the auto-reply snapshot stored on the campaign at creation
        // (resolved by campaign_id — reliable for every tenant).
        const campMeta = (camp as { metadata?: { autoReplies?: { positive?: string; negative?: string } } } | null)?.metadata;
        let template = pick(campMeta?.autoReplies);
        // Fallback for legacy campaigns created before the snapshot: match the
        // campaign_request by name, bio-agnostic (demo/managed tenants have the
        // request stamped with the SWL bio, not the lead's). First non-empty wins.
        if (!template) {
          const campName = (camp as { name?: string } | null)?.name ?? null;
          if (campName) {
            const { data: reqRows } = await supabase
              .from("campaign_requests").select("message_prompts").eq("name", campName).limit(8);
            for (const rr of (reqRows ?? [])) {
              const ar = (rr as { message_prompts?: { channelMessages?: { autoReplies?: { positive?: string; negative?: string } } } })
                ?.message_prompts?.channelMessages?.autoReplies;
              const t = pick(ar);
              if (t) { template = t; break; }
            }
          }
        }
        if (template.trim()) {
          // Dedupe: skip if any reply (auto or manual) already went out for this
          // lead in the last 3 min (step_number=-1 is the manual/auto reply row).
          const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();
          const { data: recent } = await supabase
            .from("campaign_messages")
            .select("id")
            .eq("lead_id", leadId)
            .eq("step_number", -1)
            .gte("sent_at", since)
            .limit(1);
          if (!recent || recent.length === 0) {
            const r = await fetch(new URL(`/api/inbox/reply/${leadId}`, req.url).toString(), {
              method: "POST",
              headers: { "Content-Type": "application/json", cookie: req.headers.get("cookie") ?? "" },
              body: JSON.stringify({ text: template, channel: channel ?? undefined }),
            });
            autoReplySent = r.ok;
          }
        }
      } catch { /* best-effort — never block the cascade */ }
    }
  }

  // ─── Cascade to campaign + lead state when the seller manually classifies ──
  // When the AI marked a reply ambiguous (or just wrong) and the seller picks
  // positive/negative from the Inbox, mirror the same side-effects the
  // automated handler does so the seller doesn't have to also stop the
  // campaign from another screen.
  //
  // - positive → pause campaign as 'completed' w/ stop_reason='lead_responded_positive',
  //              lead.status='qualified', lead.archived=true.
  // - negative → same, plus a 90-day lead_suppressions row so future
  //              renurture passes ignore this lead.
  // - follow_up / no override → no cascade.
  //
  // Wrapped in try/catch — the lead_replies update already succeeded; the
  // cascade is best-effort so a partial failure (e.g. campaign already
  // closed) doesn't surface as an error to the seller.
  const cascadeOn = classOverride === "positive" || classOverride === "negative";
  if (cascadeOn && replyRow) {
    const leadId = (replyRow as any).lead_id as string | null;
    const campaignId = (replyRow as any).campaign_id as string | null;
    const replyText = ((replyRow as any).reply_text as string | null) ?? "";
    const channel = ((replyRow as any).channel as string | null) ?? "linkedin";
    const stopReason = `lead_responded_${classOverride}`;
    const now = new Date().toISOString();

    const updates: Promise<unknown>[] = [];

    if (campaignId) {
      updates.push(
        supabase
          .from("campaigns")
          .update({
            status: "completed",
            stop_reason: stopReason,
            completed_at: now,
          })
          .eq("id", campaignId)
          // Don't reopen a campaign that's already terminal.
          .in("status", ["active", "paused"]) as unknown as Promise<unknown>,
      );
    }

    if (leadId) {
      const leadPatch: Record<string, unknown> = {
        responded: true,
        linkedin_connected: channel === "linkedin" ? true : undefined,
      };
      if (classOverride === "positive") {
        leadPatch.status = "qualified";
        leadPatch.archived = true;
        leadPatch.response_outcome = "interested";
      } else {
        leadPatch.status = "closed_lost";
        leadPatch.archived = true;
        leadPatch.response_outcome = "not_interested";
      }
      // Strip undefined keys before PATCH
      for (const k of Object.keys(leadPatch)) if (leadPatch[k] === undefined) delete leadPatch[k];
      updates.push(
        supabase.from("leads").update(leadPatch).eq("id", leadId) as unknown as Promise<unknown>,
      );

      if (classOverride === "negative") {
        const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
        updates.push(
          supabase.from("lead_suppressions").insert({
            lead_id: leadId,
            channel,
            reason: "lead_responded_negative",
            negative_reply_text: replyText,
            source: "manual_inbox_classify",
            active: true,
            expires_at: expiresAt,
          }) as unknown as Promise<unknown>,
        );
      }
    }

    await Promise.all(updates).catch(() => { /* best-effort */ });
  }

  // ─── follow_up override (Fran 2026-06-03): KEEP the sequence running ────────
  // The seller deliberately decides this reply should NOT stop the flow. We
  // reuse the dispatcher's `reengaged` bypass: reopen the campaign, re-queue the
  // next pending step, and stamp reengaged_at=now so the OLD reply no longer
  // blocks. A NEW reply received after this moment re-stops the flow via the
  // normal handler. This is the ONLY reply class that resumes a flow, and always
  // by an explicit human choice.
  let followUpApplied = false;
  if (classOverride === "follow_up" && replyRow) {
    const campaignId = (replyRow as any).campaign_id as string | null;
    const now = new Date().toISOString();
    try {
      if (campaignId) {
        const { data: campRow } = await supabase
          .from("campaigns").select("metadata").eq("id", campaignId).maybeSingle();
        const md = ((campRow as any)?.metadata ?? {}) as Record<string, unknown>;
        await supabase.from("campaigns").update({
          status: "active",
          stop_reason: null,
          metadata: { ...md, reengaged: true, reengaged_at: now, follow_up_resumed_at: now },
        }).eq("id", campaignId);
        // Re-queue the next pending step so the dispatcher picks it up.
        const { data: next } = await supabase
          .from("campaign_messages")
          .select("id, metadata")
          .eq("campaign_id", campaignId)
          .in("status", ["draft", "queued", "paused", "cancelled", "skipped"])
          .order("step_number", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (next) {
          const nmd = ((next as any).metadata ?? {}) as Record<string, unknown>;
          await supabase.from("campaign_messages").update({
            status: "queued",
            metadata: { ...nmd, eligible_at: now, reengaged: true, queued_by: "follow_up" },
          }).eq("id", (next as any).id);
        }
        followUpApplied = true;
      }
    } catch { /* best-effort */ }
  }

  return NextResponse.json({ ok: true, cascadeApplied: cascadeOn, followUpApplied, autoReplySent });
}
