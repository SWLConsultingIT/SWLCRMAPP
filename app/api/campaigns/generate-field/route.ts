import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseService } from "@/lib/supabase-service";
import { resolveTenantKey, decryptWithResolvedKey, bufferFromSupabaseBytea } from "@/lib/leads-crypto";

// Proxies to the n8n workflow "SWL - CRM - Message Generator V7 Pro".
// Computes step_type_override per idx (the wizard knows which UI step the user clicked
// — we map that to the planner's internal step type so prompts are honored).
//
// EXCEPTION — Call steps: the V7 Pro generator returns empty for call (it only
// drafts LinkedIn/Email), so the wizard's "AI Draft" did nothing on a Call step
// (boss 2026-06-08). Call scripts are drafted here with Claude from the lead +
// ICP context instead.

const N8N_WEBHOOK_URL = "https://n8n.srv949269.hstgr.cloud/webhook/generate-campaign-messages-v3";

type SequenceEntry = { channel: string; daysAfter: number; user_prompt?: string; body?: string; step_type_override?: string };

type LegacyBody = {
  channel?: string;
  fieldType?: string;
  idx?: number;
  leadId?: string;
  icpProfileId?: string;
  language?: string;
  signals?: string[];
  sequence_id?: string | null;
  user_prompt?: string;
  /** Optional: the wizard's full sequence (channel + daysAfter per step). When present, used to
   * compute the correct step_type_override based on idx + position among same-channel steps. */
  sequence_meta?: { channel: string; daysAfter: number }[];
  // New shape pieces (preferred when caller already speaks the n8n contract):
  sequence?: SequenceEntry[];
  target_step?: number;
};

const AUTO_REPLY_MAP: Record<string, "positive" | "negative"> = {
  replyPositive: "positive",
  replyNegative: "negative",
};

// Map (fieldType, idx, sequence_meta) → explicit planner step type.
// This kills the "every LINKEDIN_FOLLOWUP becomes BREAKUP because target_step is last" bug:
// the wizard tells us which followup position the user clicked, and we name the type explicitly.
function computeStepTypeOverride(body: LegacyBody): string | null {
  const ft = body.fieldType;
  if (!ft) return null;

  if (ft === "connectionNote" || ft === "LINKEDIN_CONNECTION_REQUEST") return "LINKEDIN_CONNECTION_REQUEST";
  if (ft === "LINKEDIN_INTRO_DM") return "LINKEDIN_INTRO_DM";
  if (ft === "EMAIL_INTRO") return "EMAIL_INTRO";
  if (ft === "EMAIL_FOLLOWUP_CROSS") return "EMAIL_FOLLOWUP_CROSS";
  if (ft === "EMAIL_FOLLOWUP") return "EMAIL_FOLLOWUP";
  if (ft === "CALL_FIRST") return "CALL_FIRST";
  if (ft === "CALL_FOLLOWUP") return "CALL_FOLLOWUP";

  if (ft === "LINKEDIN_FOLLOWUP") {
    const seqMeta = Array.isArray(body.sequence_meta) ? body.sequence_meta : [];
    const idx = typeof body.idx === "number" ? body.idx : 0;
    // Filter to LinkedIn step indexes (in the wizard's UI sequence — connection request is NOT in this array).
    const linkedinIdxs = seqMeta
      .map((s, i) => (s.channel === "linkedin" ? i : -1))
      .filter(i => i >= 0);
    const myPosition = linkedinIdxs.indexOf(idx); // 0-based among LinkedIn steps
    const totalLinkedin = linkedinIdxs.length;
    const isLast = myPosition === totalLinkedin - 1;
    // Position 0 is the post-connection First DM = INTRO_DM.
    if (myPosition <= 0) return "LINKEDIN_INTRO_DM";
    // Position 1 (first followup): always BUMP (yes/no question).
    if (myPosition === 1) {
      if (isLast && totalLinkedin >= 4) return "LINKEDIN_FOLLOWUP_BREAKUP";
      return "LINKEDIN_FOLLOWUP_BUMP";
    }
    // Position 2 (second followup): PROOF (tangible offer) unless it's the last in a long sequence.
    if (myPosition === 2) {
      if (isLast && totalLinkedin >= 4) return "LINKEDIN_FOLLOWUP_BREAKUP";
      return "LINKEDIN_FOLLOWUP_PROOF";
    }
    // Position 3+: INTERRUPT (curiosity-open) or BREAKUP if last.
    if (isLast && totalLinkedin >= 4) return "LINKEDIN_FOLLOWUP_BREAKUP";
    return "LINKEDIN_FOLLOWUP_INTERRUPT";
  }
  return null;
}

function inferSequence(body: LegacyBody): SequenceEntry[] {
  if (Array.isArray(body.sequence) && body.sequence.length > 0) return body.sequence;
  // Single-target field: build a 1-step sequence and let step_type_override drive the type.
  const channel = body.channel ?? "linkedin";
  return [{ channel, daysAfter: 0 }];
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as LegacyBody;
  const autoReplyType = body.fieldType ? AUTO_REPLY_MAP[body.fieldType] : undefined;

  // Call steps are drafted with Claude (n8n's generator returns empty for call).
  const isCallStep = !autoReplyType && (body.channel === "call" || body.fieldType === "CALL_FIRST" || body.fieldType === "CALL_FOLLOWUP");
  if (isCallStep) {
    return await generateCallScript(body);
  }

  const n8nPayload = autoReplyType
    ? {
        auto_reply_type: autoReplyType,
        lead_id: body.leadId ?? null,
        icp_profile_id: body.icpProfileId ?? null,
        language: body.language ?? "en",
        signals: [],
        sequence_id: body.sequence_id ?? null,
        user_prompt: body.user_prompt ?? null,
      }
    : (() => {
        const sequence = inferSequence(body);
        const stepTypeOverride = computeStepTypeOverride(body);
        const targetStep = body.target_step ?? (body.sequence ? undefined : 1);
        const sequenceWithPrompt = sequence.map((s, i) => {
          const out: SequenceEntry = { ...s };
          if (s.user_prompt || s.body) {
            // batch mode keeps per-step prompts; nothing to inject here.
          } else if (typeof targetStep === "number" && i === targetStep - 1 && body.user_prompt) {
            out.user_prompt = body.user_prompt;
          }
          if (i === (targetStep ? targetStep - 1 : 0) && stepTypeOverride && !s.step_type_override) {
            out.step_type_override = stepTypeOverride;
          }
          return out;
        });
        return {
          sequence: sequenceWithPrompt,
          lead_id: body.leadId ?? null,
          icp_profile_id: body.icpProfileId ?? null,
          language: body.language ?? "en",
          signals: Array.isArray(body.signals) ? body.signals : [],
          target_step: targetStep,
          sequence_id: body.sequence_id ?? null,
        };
      })();

  try {
    const res = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(n8nPayload),
    });
    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `n8n error: ${err}` }, { status: 502 });
    }
    const data = await res.json() as { messages?: { step: number; channel: string; type: string; subject: string | null; body: string }[]; connectionRequest?: string | null };

    // Workflow Y3gQXLpaWjpP37XP's `fixHallucinatedSignature()` doesn't catch
    // every case — short signatures (just "Fran" / "Juan") on the last line
    // slip through. Rather than baking the seller's literal name into the
    // saved template (where it'd survive across reassignments), we replace
    // any 1-3 word last line with the {{seller_name}} placeholder so the
    // dispatcher can substitute the real name at send time.
    const replaceTrailingSignature = (rawBody: string): string => {
      if (!rawBody) return rawBody;
      const lines = rawBody.replace(/\r\n/g, "\n").split("\n");
      // Find last non-empty line
      let lastIdx = lines.length - 1;
      while (lastIdx >= 0 && !lines[lastIdx].trim()) lastIdx -= 1;
      if (lastIdx < 0) return rawBody;
      const last = lines[lastIdx].trim();
      // Accept signature if:
      //   - 1 to 3 whitespace-separated tokens
      //   - Doesn't end in sentence punctuation (. ? !)
      //   - Total length < 40 chars (avoids killing real sentences)
      //   - Already contains {{seller_name}} → leave alone
      if (last.includes("{{seller_name}}")) return rawBody;
      const tokens = last.split(/\s+/).filter(Boolean);
      if (tokens.length === 0 || tokens.length > 3) return rawBody;
      if (/[.?!]$/.test(last)) return rawBody;
      if (last.length > 40) return rawBody;
      // Drop common dash prefix used in email signatures ("— Juan")
      lines[lastIdx] = "{{seller_name}}";
      // V7 Pro sometimes emits two identical name lines as the signature
      // ("Fran\nFran"). Once we replace the last one with {{seller_name}},
      // we end up with "Fran\n{{seller_name}}" — dedupe by also collapsing
      // a preceding 1-3 token line (with the same shape rules) into nothing.
      if (lastIdx - 1 >= 0) {
        const prev = lines[lastIdx - 1].trim();
        if (prev && prev.length <= 40 && !/[.?!]$/.test(prev)) {
          const prevTokens = prev.split(/\s+/).filter(Boolean);
          if (prevTokens.length >= 1 && prevTokens.length <= 3) {
            lines.splice(lastIdx - 1, 1);
          }
        }
      }
      return lines.join("\n");
    };

    // Workflow Y3gQXLpaWjpP37XP currently emits `subject: null` for every email
    // step (the LLM call only produces body text, no subject generation logic).
    // Derive a usable subject from the first sentence of the body (≤55 chars,
    // strip greeting, drop trailing punctuation). Real fix is to make the
    // workflow emit a subject; this is the safety net so emails are sendable
    // until that's done.
    const deriveSubject = (rawBody: string): string => {
      if (!rawBody) return "";
      let text = rawBody.replace(/\r\n/g, "\n").trim();
      // Strip salutation if present
      text = text.replace(/^(hola|hi|hello|hey|buenas)\s+[^,.\n]+[,.\n]\s*/i, "");
      // First sentence — period, newline or question mark
      const firstSentence = text.split(/[\.\?\n]/)[0]?.trim() ?? "";
      let subject = firstSentence.length > 0 ? firstSentence : text.slice(0, 80);
      // Cap to 55 chars (Instantly subjects have a 60-char soft limit)
      if (subject.length > 55) subject = subject.slice(0, 52).trimEnd() + "…";
      return subject;
    };

    // LinkedIn connection notes are 200-char capped by the dispatcher. The
    // V7 Pro Sanitize Output v2 enforces 195 chars projected, but if anything
    // upstream drifts (manual_override bypass, regression in the workflow,
    // etc.) we still want this endpoint to never hand the wizard a value
    // that would later fail the dispatcher. Clamp at last sentence boundary.
    const clampConnectionRequest = (raw: string | null | undefined): string => {
      if (!raw) return raw ?? "";
      if (raw.length <= 200) return raw;
      const trimmed = raw.slice(0, 200);
      const lastPunct = Math.max(trimmed.lastIndexOf("."), trimmed.lastIndexOf("?"), trimmed.lastIndexOf("!"));
      if (lastPunct > 120) return trimmed.slice(0, lastPunct + 1).trimEnd();
      const lastSpace = trimmed.lastIndexOf(" ");
      return (lastSpace > 30 ? trimmed.slice(0, lastSpace) : trimmed).trimEnd() + "…";
    };

    const fixOne = (m: { channel: string; subject: string | null; body: string; type?: string }) => {
      const fixedBody = m.type === "LINKEDIN_CONNECTION_REQUEST"
        ? clampConnectionRequest(replaceTrailingSignature(m.body || ""))
        : replaceTrailingSignature(m.body || "");
      const subject = m.subject && m.subject.trim().length > 0
        ? m.subject
        : (m.channel === "email" ? deriveSubject(fixedBody) : null);
      return { ...m, body: fixedBody, subject };
    };

    if (body.sequence && !body.target_step) {
      return NextResponse.json({
        ...data,
        messages: Array.isArray(data.messages) ? data.messages.map(fixOne) : data.messages,
        connectionRequest: data.connectionRequest ? clampConnectionRequest(replaceTrailingSignature(data.connectionRequest)) : data.connectionRequest,
      });
    }

    const msg = Array.isArray(data.messages) && data.messages.length > 0
      ? data.messages[data.messages.length - 1]
      : null;
    if (!msg) return NextResponse.json({ content: "", subject: "" });
    if (body.fieldType === "connectionNote") {
      const conn = data.connectionRequest ?? msg.body ?? "";
      return NextResponse.json({ content: clampConnectionRequest(replaceTrailingSignature(conn)) });
    }
    const fixedBody = replaceTrailingSignature(msg.body || "");
    const subject = msg.subject && msg.subject.trim().length > 0
      ? msg.subject
      : (msg.channel === "email" ? deriveSubject(fixedBody) : "");
    return NextResponse.json({ content: fixedBody, subject });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── Call script generation (Claude) ──────────────────────────────────────────
// n8n's V7 Pro generator only drafts LinkedIn/Email, so call steps are handled
// here: pull the lead + ICP context and have Claude write a tight phone script.
async function generateCallScript(body: LegacyBody): Promise<NextResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });
  const svc = getSupabaseService();

  // Lead context (optional — drafts a solid generic script if absent).
  let lead: Record<string, unknown> = {};
  if (body.leadId) {
    const { data: leadRow } = await svc.from("leads").select("*").eq("id", body.leadId).maybeSingle();
    if (leadRow) {
      lead = leadRow;
      if (leadRow.source === "client" && leadRow.encrypted_payload && leadRow.company_bio_id) {
        try {
          const { key } = await resolveTenantKey(leadRow.company_bio_id as string);
          lead = { ...leadRow, ...decryptWithResolvedKey(bufferFromSupabaseBytea(leadRow.encrypted_payload), key) };
        } catch { /* fall back to redacted row */ }
      }
    }
  }

  let icp: { profile_name?: string; solutions_offered?: string; pain_points?: string } | null = null;
  if (body.icpProfileId) {
    const { data } = await svc.from("icp_profiles").select("profile_name, solutions_offered, pain_points").eq("id", body.icpProfileId).maybeSingle();
    icp = data;
  }

  const isFollowup = body.fieldType === "CALL_FOLLOWUP";
  const name = `${(lead.primary_first_name as string) ?? ""} ${(lead.primary_last_name as string) ?? ""}`.trim() || "the lead";
  const lang = body.language === "es" ? "Spanish (rioplatense)" : body.language === "pt" ? "Portuguese" : "English";
  const enrichment = (lead.enrichment as Record<string, unknown> | null) ?? {};
  const enrichmentDump = Object.entries(enrichment)
    .filter(([k, v]) => k !== "source_file" && v != null && v !== "")
    .map(([k, v]) => `${k}: ${v}`).join("\n");

  const prompt = `You are a senior B2B SDR coach. Write a tight, natural phone CALL SCRIPT a seller will read on a ${isFollowup ? "follow-up" : "first"} call. Output in ${lang}. It must sound like a human talking, not a memo.

LEAD
- ${name}${lead.primary_title_role ? `, ${lead.primary_title_role}` : ""}${lead.company_name ? ` at ${lead.company_name}` : ""}
- Industry: ${lead.company_industry ?? "—"}
${lead.primary_headline ? `- LinkedIn headline: ${lead.primary_headline}` : ""}

ENRICHMENT (use specific signals if useful)
${enrichmentDump || "(none)"}

${icp ? `WHAT WE SELL
- Offering: ${icp.solutions_offered ?? ""}
- Pain we solve: ${icp.pain_points ?? ""}` : ""}

${body.user_prompt ? `SELLER'S INTENT (honor this): ${body.user_prompt}` : ""}

Structure: (1) warm opener using their first name + why you're calling, (2) one open question about their situation, (3) a 2-line value pitch tied to their likely pain, (4) a close proposing a 15-minute follow-up. Keep it ~120-160 words. Use {{first_name}}, {{company}}, {{seller_name}} placeholders where natural. Return ONLY the script text — no headings, no quotes, no commentary.`;

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      system: "You output ONLY the call script text — natural spoken language, no headings or meta-commentary. You never refuse.",
      messages: [{ role: "user", content: prompt }],
    });
    const content = res.content[0]?.type === "text" ? res.content[0].text.trim() : "";
    if (!content) return NextResponse.json({ error: "AI returned no script" }, { status: 502 });
    return NextResponse.json({ content });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
