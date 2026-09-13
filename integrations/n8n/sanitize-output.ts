// TypeScript mirror of the n8n "Sanitize Output v3" node so that previews
// generated inside the CRM (template wizard, per-step regeneration) match
// what eventually ships through the n8n pipeline. The four canonical
// passes the n8n node runs:
//
//   1. ANTI-FLUFF      — strips opener tropes ("I hope this finds you well",
//                        "I came across your profile", "Quick question for
//                        you"). These survive AI generation but kill response
//                        rates in B2B outbound.
//   2. ANTI-REINTRO    — for steps after step 1 in the same sequence, strips
//                        re-introductions ("I'm <seller> from <company>" /
//                        "Following up from my last message"). Step N already
//                        has the context from N-1.
//   3. LENGTH CAP      — channel-aware hard cap. LinkedIn invite ≤300,
//                        LinkedIn DM ≤900, Email body ≤1200, WhatsApp ≤500.
//   4. AUTO-SIGNATURE  — strips trailing "— <Seller Name>" / "Best, X" lines
//                        and replaces them with the canonical `{{seller_name}}`
//                        placeholder so the dispatcher can fill the right
//                        seller per send.
//
// Keep this in sync with the n8n node; the contract is "what the wizard
// previews is exactly what the lead receives".

export type SanitizeOptions = {
  channel: "linkedin" | "email" | "call" | "whatsapp";
  /** Step index inside the sequence (0 = first outreach, not connection
   *  request). Used by the anti-reintro pass — step 0 keeps the intro,
   *  later steps drop it. */
  stepIndex: number;
  /** Treat this as a LinkedIn connection request (different length cap
   *  + skips anti-fluff because invites need a personal opener). */
  isConnectionRequest?: boolean;
};

const LENGTH_CAPS: Record<SanitizeOptions["channel"], number> = {
  linkedin: 900,
  email: 1200,
  call: 600,
  whatsapp: 500,
};
const INVITE_CAP = 300;

// Phrases stripped at the very start of step 0 messages. Matching is
// case-insensitive, anchored at the start (allowing punctuation), and only
// matches the FIRST sentence — we don't want to chew into legitimate body
// content.
const FLUFF_OPENERS: RegExp[] = [
  /^\s*i hope (this|you|your) (finds|are|email)[^.!?]*[.!?]\s*/i,
  /^\s*hope (this|you|your)[^.!?]*[.!?]\s*/i,
  /^\s*i came across (your|you)[^.!?]*[.!?]\s*/i,
  /^\s*i was (just )?(browsing|looking|going) (through|over)[^.!?]*[.!?]\s*/i,
  /^\s*quick question[^.!?]*[.!?]\s*/i,
  /^\s*just (a |quick )?(reaching out|wanted to)[^.!?]*[.!?]\s*/i,
  /^\s*sorry (to|for) (bothering|the)[^.!?]*[.!?]\s*/i,
  /^\s*my name is[^.!?]*[.!?]\s*/i, // Anti-reintro overlap — same pattern catches re-intros at step 0 if AI starts with "My name is"
];

// Patterns stripped on steps after step 0 (anti-reintro). Same matching
// rules: anchored at start, first sentence only.
const REINTRO_OPENERS: RegExp[] = [
  /^\s*(hi|hello|hey)[^,]*,?\s*(i'?m|this is|my name is)[^.!?]*[.!?]\s*/i,
  /^\s*(i'?m|this is|my name is) [a-z]+ (from|at|with)[^.!?]*[.!?]\s*/i,
  /^\s*following up (on|from|with) my (last|previous|earlier)[^.!?]*[.!?]\s*/i,
  /^\s*just following up[^.!?]*[.!?]\s*/i,
  /^\s*as i mentioned[^.!?]*[.!?]\s*/i,
  /^\s*to recap[^.!?]*[.!?]\s*/i,
];

// Trailing signatures that look like "<dash> <name>" or "Best, <name>" etc.
// Stripped from the END of the body. The dispatcher will re-attach the
// proper `{{seller_name}}` token at send time.
const SIGNATURE_TRAILERS: RegExp[] = [
  /\n+\s*[—–-]\s*[A-Z][a-zA-Z .]+\s*$/,
  /\n+\s*(best|cheers|thanks|regards|warmly|sincerely)[, ]*\n[A-Z][a-zA-Z .]+\s*$/i,
  /\n+\s*(best|cheers|thanks|regards|warmly|sincerely)[, ]+[A-Z][a-zA-Z .]+\s*$/i,
  /\n+\s*\{\{seller_name\}\}\s*$/,
];

function applyFluff(body: string): string {
  let out = body;
  for (const rx of FLUFF_OPENERS) out = out.replace(rx, "");
  return out;
}

function applyReintro(body: string): string {
  let out = body;
  for (const rx of REINTRO_OPENERS) out = out.replace(rx, "");
  return out;
}

function applySignature(body: string): string {
  let out = body;
  for (const rx of SIGNATURE_TRAILERS) out = out.replace(rx, "");
  // Always append the placeholder so the dispatcher has a canonical anchor.
  // Avoids "the AI signed off as Claude" or generic names slipping through.
  out = out.replace(/\s+$/g, "");
  return out + "\n\n— {{seller_name}}";
}

function applyLengthCap(body: string, cap: number): string {
  if (body.length <= cap) return body;
  // Truncate at the last sentence boundary before the cap so we don't cut
  // mid-word or mid-clause.
  const slice = body.slice(0, cap);
  const lastBoundary = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
    slice.lastIndexOf("\n"),
  );
  return (lastBoundary > cap * 0.7 ? slice.slice(0, lastBoundary + 1) : slice).trimEnd();
}

export function sanitize(body: string, opts: SanitizeOptions): string {
  if (!body || !body.trim()) return body;
  let out = body.replace(/\r\n/g, "\n").trim();

  if (opts.isConnectionRequest) {
    // Invites: only length cap + collapse whitespace. Keep the personal
    // opener; that's the whole point of an invite.
    out = out.replace(/\n{2,}/g, " ").replace(/\s+/g, " ").trim();
    if (out.length > INVITE_CAP) out = out.slice(0, INVITE_CAP).trimEnd();
    return out;
  }

  // Step 0 outreach: anti-fluff only (preserve intro). Step N>0: anti-fluff
  // is mostly redundant but cheap; anti-reintro is the heavy lift.
  out = applyFluff(out);
  if (opts.stepIndex > 0) out = applyReintro(out);

  // Length cap *before* re-adding signature, then re-append.
  out = applyLengthCap(out, LENGTH_CAPS[opts.channel] ?? 1000);
  out = applySignature(out);

  return out;
}
