import { NextRequest, NextResponse } from "next/server";

// Proxies to the n8n workflow "SWL - CRM - Message Generator Universal".
// The workflow handles: multilingual output, {{placeholder}} syntax, ticked signals,
// ICP-template mode when no lead, and orders messages as a coherent sequence.
//
// Frontend contracts supported:
//  - Batch: body omits `target_step` → workflow generates every step in the sequence.
//  - Per-field: body includes `target_step` (1-indexed) → workflow generates only that one.
//
// Legacy shape: the UI used to call with { fieldType, idx, leadId, language, signals, icpProfileId }.
// We translate that into the n8n shape { sequence, lead_id, icp_profile_id, language, signals, target_step }.

const N8N_WEBHOOK_URL = "https://n8n.srv949269.hstgr.cloud/webhook/generate-campaign-messages-v2";

type LegacyBody = {
  channel?: string;
  fieldType?: string;
  idx?: number;
  leadId?: string;
  icpProfileId?: string;
  language?: string;
  signals?: string[];
  // New shape pieces (preferred when caller already speaks the n8n contract):
  sequence?: { channel: string; daysAfter: number }[];
  target_step?: number;
};

// Auto-reply fieldTypes bypass sequence inference — the generator has a dedicated
// branch that emits a reply template instead of outbound copy.
const AUTO_REPLY_MAP: Record<string, "positive" | "negative"> = {
  replyPositive: "positive",
  replyNegative: "negative",
};

function inferSequence(body: LegacyBody): { channel: string; daysAfter: number }[] {
  if (Array.isArray(body.sequence) && body.sequence.length > 0) return body.sequence;
  // Legacy single-field call: build a minimal sequence so the workflow can classify it.
  const channel = body.channel ?? "linkedin";
  // connectionNote / LINKEDIN_INTRO_DM / LINKEDIN_FOLLOWUP / EMAIL_INTRO / etc.
  // For connectionNote we produce a 1-step LinkedIn sequence → n8n types it as CONNECTION_REQUEST.
  // For follow-ups we add prior steps so the classifier hits LINKEDIN_FOLLOWUP / EMAIL_FOLLOWUP.
  const ft = body.fieldType ?? "";
  if (ft === "connectionNote" || ft === "LINKEDIN_CONNECTION_REQUEST") {
    return [{ channel: "linkedin", daysAfter: 0 }];
  }
  if (ft === "LINKEDIN_INTRO_DM") {
    return [
      { channel: "linkedin", daysAfter: 0 },
      { channel: "linkedin", daysAfter: 3 },
    ];
  }
  if (ft === "LINKEDIN_FOLLOWUP") {
    return [
      { channel: "linkedin", daysAfter: 0 },
      { channel: "linkedin", daysAfter: 3 },
      { channel: "linkedin", daysAfter: 7 },
    ];
  }
  if (ft === "EMAIL_INTRO") {
    return [{ channel: "email", daysAfter: 0 }];
  }
  if (ft === "EMAIL_FOLLOWUP_CROSS") {
    return [
      { channel: "linkedin", daysAfter: 0 },
      { channel: "email", daysAfter: 3 },
    ];
  }
  if (ft === "EMAIL_FOLLOWUP") {
    return [
      { channel: "email", daysAfter: 0 },
      { channel: "email", daysAfter: 4 },
    ];
  }
  if (ft === "CALL_FIRST") {
    return [{ channel: "call", daysAfter: 0 }];
  }
  if (ft === "CALL_FOLLOWUP") {
    return [
      { channel: "call", daysAfter: 0 },
      { channel: "call", daysAfter: 5 },
    ];
  }
  return [{ channel, daysAfter: 0 }];
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as LegacyBody;

  const autoReplyType = body.fieldType ? AUTO_REPLY_MAP[body.fieldType] : undefined;

  // Auto-reply path: skip sequence inference, tell the generator to emit a reply template.
  // Signals are intentionally dropped — auto-replies must not reference enrichment placeholders.
  const n8nPayload = autoReplyType
    ? {
        auto_reply_type: autoReplyType,
        lead_id: body.leadId ?? null,
        icp_profile_id: body.icpProfileId ?? null,
        language: body.language ?? "en",
        signals: [],
      }
    : (() => {
        const sequence = inferSequence(body);
        const targetStep = body.target_step ?? (body.sequence ? undefined : sequence.length);
        return {
          sequence,
          lead_id: body.leadId ?? null,
          icp_profile_id: body.icpProfileId ?? null,
          language: body.language ?? "en",
          signals: Array.isArray(body.signals) ? body.signals : [],
          target_step: targetStep,
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

    // Batch mode: caller wants the full array → pass-through.
    if (body.sequence && !body.target_step) {
      return NextResponse.json(data);
    }

    // Legacy single-field mode: extract the one targeted step and return the shape the UI expects.
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
