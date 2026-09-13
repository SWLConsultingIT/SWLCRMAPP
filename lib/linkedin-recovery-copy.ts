// Second-attempt copy for LinkedIn Recovery.
//
// LAW: AI generation goes through n8n, never a direct Next→LLM call. This calls
// an n8n webhook (unauthenticated trigger, so it does NOT depend on the rotated
// N8N_API_KEY — that key is only for the n8n management API). If the webhook is
// unset or fails, or the returned copy is empty / not distinct from attempt #1,
// we FAIL CLOSED: the caller moves the row to MANUAL_REVIEW and sends nothing.
// We NEVER fall back to re-sending the original copy.

// Reuse the same n8n host as the existing campaign copy generator; a dedicated
// path keeps the "second attempt" prompt/flow separate. Overridable by env.
import { n8nWebhookUrl } from "@/integrations/n8n/call-webhook";

const N8N_RECOVERY_COPY_URL =
  process.env.N8N_LINKEDIN_RECOVERY_COPY_URL ??
  n8nWebhookUrl("linkedin-recovery-copy");

export function normalizeForCompare(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\{\{[^}]*\}\}/g, " ")     // ignore placeholder tokens
    .replace(/[^\p{L}\p{N}\s]/gu, " ")   // drop punctuation/emoji
    .replace(/\s+/g, " ")
    .trim();
}

// Token Jaccard similarity in [0,1]. Pure.
export function copySimilarity(a: string, b: string): number {
  const ta = new Set(normalizeForCompare(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeForCompare(b).split(" ").filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 1 : inter / union;
}

export const DISTINCT_MAX_SIMILARITY = 0.6;

// A candidate is "distinct enough" when it's non-empty, not identical, and not
// too similar (token overlap under the threshold) to the original.
export function isDistinctCopy(original: string | null | undefined, candidate: string | null | undefined): boolean {
  const cand = (candidate ?? "").trim();
  if (!cand) return false;
  const orig = (original ?? "").trim();
  if (!orig) return true; // nothing to differ from
  if (normalizeForCompare(orig) === normalizeForCompare(cand)) return false;
  return copySimilarity(orig, cand) < DISTINCT_MAX_SIMILARITY;
}

export type CopyContext = {
  leadId: string;
  campaignId: string | null;
  companyBioId: string | null;
  icpProfileId?: string | null;
  originalNote: string | null;   // attempt #1 CR note
  originalDm: string | null;     // attempt #1 first post-accept DM (may be null)
  language?: string;
};

export function buildRecoveryCopyPayload(ctx: CopyContext): Record<string, unknown> {
  return {
    mode: "linkedin_recovery_second_attempt",
    lead_id: ctx.leadId,
    campaign_id: ctx.campaignId,
    company_bio_id: ctx.companyBioId,
    icp_profile_id: ctx.icpProfileId ?? null,
    language: ctx.language ?? "en",
    original_connection_note: ctx.originalNote ?? "",
    original_first_dm: ctx.originalDm ?? "",
    // Guidance for the n8n prompt (the actual prompt lives in the workflow):
    instructions:
      "Create a SECOND LinkedIn attempt. The first connection request was not " +
      "accepted. Do not repeat wording or hook. Be shorter and more natural. Do " +
      "not reference that this is an automated retry. Same business objective, " +
      "different angle. Return { connection_note, dm }.",
  };
}

export type CopyResult =
  | { ok: true; note: string; dm: string }
  | { ok: false; error: string };

// Calls the n8n recovery-copy webhook and validates the result. Fail-closed on
// any error, empty output, or copy that isn't distinct from attempt #1.
export async function generateSecondAttemptCopy(ctx: CopyContext): Promise<CopyResult> {
  let data: any;
  try {
    const res = await fetch(N8N_RECOVERY_COPY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRecoveryCopyPayload(ctx)),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `copy_generation_failed: n8n ${res.status} ${body.slice(0, 160)}` };
    }
    data = await res.json();
  } catch (e: any) {
    return { ok: false, error: `copy_generation_failed: ${e?.message ?? String(e)}` };
  }

  const note = String(data?.connection_note ?? data?.note ?? "").trim();
  const dm = String(data?.dm ?? data?.first_dm ?? "").trim();
  if (!note || !dm) return { ok: false, error: "copy_generation_failed: empty note or dm" };
  if (!isDistinctCopy(ctx.originalNote, note)) return { ok: false, error: "copy_not_distinct: connection_note too similar to original" };
  if (ctx.originalDm && !isDistinctCopy(ctx.originalDm, dm)) return { ok: false, error: "copy_not_distinct: dm too similar to original" };
  return { ok: true, note, dm };
}
