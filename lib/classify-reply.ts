// LLM-backed reply classifier. Used by the Instantly webhook (and any other
// channel that needs reply triage) to decide whether to:
//   - close the lead as lost (negative / unsubscribe),
//   - promote to opportunity (positive),
//   - or leave alone for the seller to answer (question).
//
// The classification + confidence land in `lead_replies.classification`
// and `lead_replies.ai_confidence`. Callers can flip `requires_human_review`
// when confidence is below a threshold so ambiguous replies don't trigger
// auto-actions silently.

export type ReplyClassification =
  | "positive"        // wants to talk / book a meeting / interested
  | "negative"        // not interested / hard no
  | "unsubscribe"     // explicit ask to be removed (CAN-SPAM / GDPR signal)
  | "question"        // wants more info but not yet committed
  | "out_of_office"   // OOO auto-reply, ignore for sequence purposes
  | "wrong_person"    // referral or "you want my colleague"
  | "unknown";        // model couldn't decide → human review

export type ClassifyOutcome = {
  classification: ReplyClassification;
  confidence: number;        // 0..1
  requiresReview: boolean;   // true when confidence < AUTO_THRESHOLD
  reasoning?: string;        // short explanation from the model (debug)
};

const AUTO_THRESHOLD = 0.85;

const SYSTEM_PROMPT = `You classify B2B sales email/LinkedIn replies. The input is the prospect's response to an outbound sales message. Output strict JSON:
{
  "classification": "positive" | "negative" | "unsubscribe" | "question" | "out_of_office" | "wrong_person" | "unknown",
  "confidence": <0..1 float>,
  "reasoning": "<one short sentence>"
}

Rules:
- "positive": prospect wants to engage — yes / interested / proposes time / asks for the call / asks for pricing in a buying tone.
- "negative": clear no, not interested, "not a fit", "not now", "wrong timing". Default for short curt no's.
- "unsubscribe": explicit removal request ("please remove me", "stop emailing", "delete my email", "unsubscribe").
- "question": engaged but exploratory — wants more info, more context, clarification, samples — not a hard no, not a yes.
- "out_of_office": auto-reply (vacation, on leave, back on X date).
- "wrong_person": "you should talk to <name>" / "I no longer handle this" / "I'm not the right person".
- "unknown": ambiguous; cannot decide.

Be conservative with "positive" — only choose it when the prospect actively signals willingness to move forward. A polite "thanks for the info, will think about it" is negative.`;

export async function classifyReply(replyBody: string): Promise<ClassifyOutcome> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // No key configured — surface as "unknown" + requiresReview so the lead
    // ends up in the manual review queue rather than getting auto-actioned
    // on a guess. Better silent than wrong.
    return { classification: "unknown", confidence: 0, requiresReview: true, reasoning: "no OPENAI_API_KEY configured" };
  }

  const cleaned = replyBody.trim().slice(0, 6000); // hard cap to keep prompt cheap
  if (!cleaned) {
    return { classification: "unknown", confidence: 0, requiresReview: true, reasoning: "empty body" };
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: cleaned },
        ],
      }),
      // Webhook context — Instantly will retry on slow responses, but
      // ten seconds covers the 99th-percentile of a single classification.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { classification: "unknown", confidence: 0, requiresReview: true, reasoning: `openai ${res.status}` };
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) {
      return { classification: "unknown", confidence: 0, requiresReview: true, reasoning: "empty response" };
    }
    const parsed = JSON.parse(raw) as Partial<ClassifyOutcome>;
    const validKinds: ReplyClassification[] = ["positive", "negative", "unsubscribe", "question", "out_of_office", "wrong_person", "unknown"];
    const classification = validKinds.includes(parsed.classification as ReplyClassification)
      ? parsed.classification as ReplyClassification
      : "unknown";
    const confidence = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
    const requiresReview = confidence < AUTO_THRESHOLD || classification === "unknown";
    return { classification, confidence, requiresReview, reasoning: parsed.reasoning };
  } catch (err) {
    return { classification: "unknown", confidence: 0, requiresReview: true, reasoning: err instanceof Error ? err.message : String(err) };
  }
}
