// TS port of the V8 generator's `validator-v8` jsCode (n8n workflow
// Y3gQXLpaWjpP37XP). Same constants and logic so client (wizard Step 3
// review) and server (wizard-batch-preview endpoint) flag identical
// violation codes as the n8n pipeline.

export type ViolationCode =
  | "empty_body"
  | "length_exceeded"
  | "heavy_fluff"
  | "missing_question"
  | "missing_signature"
  | "seller_reintroduction"
  | "unfilled_placeholder"
  | "json_leak";

export type Violation = { code: ViolationCode; detail: string };
export type ValidationResult = { violations: Violation[]; passed: boolean; skipped?: string };

export type MessageType =
  | "LINKEDIN_CONNECTION_REQUEST"
  | "LINKEDIN_INTRO_DM"
  | "LINKEDIN_FOLLOWUP_BUMP"
  | "LINKEDIN_FOLLOWUP_PROOF"
  | "LINKEDIN_FOLLOWUP_INTERRUPT"
  | "LINKEDIN_FOLLOWUP_BREAKUP"
  | "EMAIL_INTRO"
  | "EMAIL_FOLLOWUP"
  | "EMAIL_FOLLOWUP_CROSS"
  | "CALL_FIRST"
  | "CALL_FOLLOWUP"
  | "AUTO_REPLY_POSITIVE"
  | "AUTO_REPLY_NEGATIVE"
  | "GENERIC";

const SIGNATURE_REQUIRED_TYPES = new Set<MessageType>([
  "LINKEDIN_INTRO_DM", "LINKEDIN_FOLLOWUP_BUMP", "LINKEDIN_FOLLOWUP_PROOF",
  "LINKEDIN_FOLLOWUP_INTERRUPT", "LINKEDIN_FOLLOWUP_BREAKUP",
  "EMAIL_INTRO", "EMAIL_FOLLOWUP_CROSS", "EMAIL_FOLLOWUP",
  "AUTO_REPLY_POSITIVE", "AUTO_REPLY_NEGATIVE",
]);

const QUESTION_REQUIRED_TYPES = new Set<MessageType>([
  "LINKEDIN_INTRO_DM", "EMAIL_INTRO",
  "LINKEDIN_FOLLOWUP_BUMP", "LINKEDIN_FOLLOWUP_PROOF", "LINKEDIN_FOLLOWUP_INTERRUPT",
  "EMAIL_FOLLOWUP_CROSS", "EMAIL_FOLLOWUP",
]);

const NO_REINTRO_TYPES = new Set<MessageType>([
  "LINKEDIN_INTRO_DM", "LINKEDIN_FOLLOWUP_BUMP", "LINKEDIN_FOLLOWUP_PROOF",
  "LINKEDIN_FOLLOWUP_INTERRUPT", "LINKEDIN_FOLLOWUP_BREAKUP",
  "EMAIL_FOLLOWUP", "EMAIL_FOLLOWUP_CROSS",
  "AUTO_REPLY_POSITIVE", "AUTO_REPLY_NEGATIVE",
]);

const LENGTH_CAP: Record<MessageType, number> = {
  LINKEDIN_CONNECTION_REQUEST: 195,
  LINKEDIN_INTRO_DM: 400,
  LINKEDIN_FOLLOWUP_BUMP: 320,
  LINKEDIN_FOLLOWUP_PROOF: 400,
  LINKEDIN_FOLLOWUP_INTERRUPT: 300,
  LINKEDIN_FOLLOWUP_BREAKUP: 240,
  EMAIL_INTRO: 700,
  EMAIL_FOLLOWUP_CROSS: 500,
  EMAIL_FOLLOWUP: 400,
  CALL_FIRST: 1500,
  CALL_FOLLOWUP: 800,
  AUTO_REPLY_POSITIVE: 350,
  AUTO_REPLY_NEGATIVE: 280,
  GENERIC: 600,
};

const HEAVY_FLUFF: RegExp[] = [
  /we believe in partnerships/i,
  /we pride ourselves/i,
  /we specialize in/i,
  /thank you for reaching out to/i,
  /i'd be happy to/i,
  /happy to assist you/i,
  /explore how we can (help|assist)/i,
  /tailored solutions/i,
  /best-in-class/i,
  /world-class/i,
  /cutting-edge/i,
  /state-of-the-art/i,
  /circle back/i,
  /touch base/i,
  /looking forward to/i,
  /hope this finds you well/i,
  /just wanted to reach out/i,
  /best regards/i,
  /kind regards/i,
];

const PLACEHOLDER_SHAPES: RegExp[] = [
  /\[your company name\]/i,
  /\[service name\]/i,
  /\[seller\]/i,
  /\[name\]/i,
  /\[empresa\]/i,
  /\[nombre\]/i,
  /\{\{\s*\}\}/,
];

// Approximate the rendered length post-substitution. Mirrors the V8 estLen.
export function estLen(body: string | null | undefined): number {
  if (!body) return 0;
  return body
    .replace(/\{\{\s*first_name\s*\}\}/g, "__________")
    .replace(/\{\{\s*company_name\s*\}\}/g, "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO")
    .replace(/\{\{\s*seller_name\s*\}\}/g, "__________")
    .replace(/\{\{\s*seller_company\s*\}\}/g, "OOOOOOOOOOOOOOOOOOOOOOO")
    .replace(/\{\{[^}]+\}\}/g, "__________")
    .length;
}

export type ValidateMessageInput = {
  type?: string | null;
  body?: string | null;
  _manual_override?: boolean;
};

export function validateMessage(msg: ValidateMessageInput | null | undefined, sellerCompany?: string | null): ValidationResult {
  const v: Violation[] = [];
  if (!msg || typeof msg !== "object") return { violations: v, passed: true };
  if (msg._manual_override) return { violations: [], passed: true, skipped: "manual_override" };

  const type = (msg.type || "GENERIC") as MessageType;
  const body = typeof msg.body === "string" ? msg.body : "";

  if (!body.trim()) {
    v.push({ code: "empty_body", detail: "body is empty" });
    return { violations: v, passed: false };
  }

  const cap = LENGTH_CAP[type] ?? LENGTH_CAP.GENERIC;
  const pl = estLen(body);
  if (pl > cap) v.push({ code: "length_exceeded", detail: `projected ${pl} > cap ${cap}` });

  for (const p of HEAVY_FLUFF) {
    const m = body.match(p);
    if (m) { v.push({ code: "heavy_fluff", detail: `"${m[0]}"` }); break; }
  }

  if (QUESTION_REQUIRED_TYPES.has(type) && !/[?¿]/.test(body)) {
    v.push({ code: "missing_question", detail: `${type} needs a question` });
  }

  if (SIGNATURE_REQUIRED_TYPES.has(type) && !/\{\{\s*seller_name\s*\}\}/.test(body)) {
    v.push({ code: "missing_signature", detail: "needs {{seller_name}}" });
  }

  if (NO_REINTRO_TYPES.has(type)) {
    const pats: RegExp[] = [/\b(at|from)\s+\{\{\s*seller_company\s*\}\}/i];
    if (sellerCompany && sellerCompany.length > 2) {
      const esc = sellerCompany.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      pats.push(new RegExp(`\\b(at|from)\\s+${esc}`, "i"));
    }
    for (const p of pats) {
      const m = body.match(p);
      if (m) { v.push({ code: "seller_reintroduction", detail: `"${m[0]}"` }); break; }
    }
  }

  for (const p of PLACEHOLDER_SHAPES) {
    const m = body.match(p);
    if (m) { v.push({ code: "unfilled_placeholder", detail: `"${m[0]}"` }); break; }
  }

  if (/^\s*\{[\s\S]*"body"\s*:/i.test(body)) {
    v.push({ code: "json_leak", detail: "body looks like JSON" });
  }

  return { violations: v, passed: v.length === 0 };
}

export function validateConnectionRequest(cr: string | null | undefined): ValidationResult {
  const v: Violation[] = [];
  if (!cr || !cr.trim()) {
    return { violations: [{ code: "empty_body", detail: "connection request is empty" }], passed: false };
  }

  const pl = estLen(cr);
  if (pl > 195) v.push({ code: "length_exceeded", detail: `projected ${pl} > cap 195` });

  for (const p of HEAVY_FLUFF) {
    const m = cr.match(p);
    if (m) { v.push({ code: "heavy_fluff", detail: `"${m[0]}"` }); break; }
  }

  for (const p of PLACEHOLDER_SHAPES) {
    const m = cr.match(p);
    if (m) { v.push({ code: "unfilled_placeholder", detail: `"${m[0]}"` }); break; }
  }

  return { violations: v, passed: v.length === 0 };
}

export const VIOLATION_LABELS: Record<ViolationCode, string> = {
  empty_body: "Empty",
  length_exceeded: "Too long",
  heavy_fluff: "Fluff phrase",
  missing_question: "Missing question",
  missing_signature: "Missing signature",
  seller_reintroduction: "Re-introduces sender",
  unfilled_placeholder: "Unfilled placeholder",
  json_leak: "JSON leak",
};
