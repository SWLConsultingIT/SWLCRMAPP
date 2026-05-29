// HMAC-based authentication for the Unipile hosted-auth callback.
//
// Why: Unipile's `POST /hosted/accounts/link` API doesn't let you specify
// custom headers that Unipile would round-trip to the `notify_url`. The only
// piece of state we control end-to-end is the `name` field — Unipile echoes
// it back verbatim in the webhook body. So we sign `seller.id` with a shared
// secret on send and verify on receive. An attacker who knows a seller UUID
// but not the secret can't produce a matching HMAC.
//
// Format: `<seller_id>:<hmac>` where hmac is SHA-256(seller_id, SECRET)
// truncated to 16 hex chars (8 bytes — sufficient for this attack surface;
// brute-force in the field takes ~2^32 tries against a low-frequency endpoint).
//
// Backwards-compat modes:
//   - `no-secret`  — UNIPILE_WEBHOOK_SECRET unset. Sign is no-op, verify
//                    accepts everything. Same posture as before this fix.
//                    Set the env var to activate enforcement.
//   - `legacy`     — request arrives with a bare seller_id (no `:`). Could
//                    be an in-flight hosted-link session from before the
//                    signing rollout. Accepted with a loud log so the
//                    transition is visible; after 30 min all old sessions
//                    have expired and any 'legacy' should be a misconfig
//                    or a forged request — at that point flip the route to
//                    reject 'legacy'.
//   - `verified`   — full match, trusted.
//   - `invalid`    — secret set + name has `:` but hmac mismatched. Reject.

import { createHmac, timingSafeEqual } from "node:crypto";

const HMAC_HEX_CHARS = 16; // 8 bytes — fine for this surface

function hmacFor(sellerId: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(sellerId)
    .digest("hex")
    .slice(0, HMAC_HEX_CHARS);
}

/**
 * Sign a seller.id for the Unipile `name` field. No-op (returns the raw id)
 * when `UNIPILE_WEBHOOK_SECRET` is unset — caller still works, the verify
 * side will log 'no-secret' mode.
 */
export function signSellerName(sellerId: string): string {
  const secret = process.env.UNIPILE_WEBHOOK_SECRET ?? "";
  if (!secret) return sellerId;
  return `${sellerId}:${hmacFor(sellerId, secret)}`;
}

export type VerifyResult =
  | { valid: true; sellerId: string; mode: "verified" | "legacy" | "no-secret" }
  | { valid: false; mode: "invalid"; reason: string };

/**
 * Verify a `name` value received from Unipile. Always returns the resolved
 * sellerId when valid (so the caller doesn't have to re-parse). Returns
 * `invalid` only when the secret IS set AND the presented hmac doesn't match.
 */
export function verifySellerName(name: string | null | undefined): VerifyResult {
  if (typeof name !== "string" || !name.trim()) {
    return { valid: false, mode: "invalid", reason: "missing name" };
  }
  const trimmed = name.trim();
  const secret = process.env.UNIPILE_WEBHOOK_SECRET ?? "";
  const colonIdx = trimmed.indexOf(":");

  // Legacy / no-secret modes — accept without verification.
  if (!secret) {
    return { valid: true, sellerId: colonIdx >= 0 ? trimmed.slice(0, colonIdx) : trimmed, mode: "no-secret" };
  }
  if (colonIdx < 0) {
    return { valid: true, sellerId: trimmed, mode: "legacy" };
  }

  const sellerId = trimmed.slice(0, colonIdx);
  const presented = trimmed.slice(colonIdx + 1);
  if (!sellerId) {
    return { valid: false, mode: "invalid", reason: "empty seller id" };
  }
  const expected = hmacFor(sellerId, secret);
  if (presented.length !== expected.length) {
    return { valid: false, mode: "invalid", reason: "hmac length mismatch" };
  }
  const a = Buffer.from(presented, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) {
    return { valid: false, mode: "invalid", reason: "hmac hex decode mismatch" };
  }
  if (!timingSafeEqual(a, b)) {
    return { valid: false, mode: "invalid", reason: "hmac mismatch" };
  }
  return { valid: true, sellerId, mode: "verified" };
}
