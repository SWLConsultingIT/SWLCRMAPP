import { NextRequest, NextResponse } from "next/server";

// Proxies to the n8n workflow "SWL - CRM - Message Generator V7 Pro".
// Computes step_type_override per idx (the wizard knows which UI step the user clicked
// — we map that to the planner's internal step type so prompts are honored).

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

    if (body.sequence && !body.target_step) {
      return NextResponse.json(data);
    }

    const msg = Array.isArray(data.messages) && data.messages.length > 0
      ? data.messages[data.messages.length - 1]
      : null;
    if (!msg) return NextResponse.json({ content: "", subject: "" });
    if (body.fieldType === "connectionNote") {
      return NextResponse.json({ content: data.connectionRequest ?? msg.body ?? "" });
    }
    return NextResponse.json({ content: msg.body ?? "", subject: msg.subject ?? "" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
