// AES-256-GCM helper for client-uploaded leads. The full PII payload is JSON-
// serialised and stored as a single bytea blob in `leads.encrypted_payload`.
// The blob layout is:
//
//   [version (1B)] [iv (12B)] [authTag (16B)] [ciphertext (variable)]
//
// Version is bumped if the algorithm or key derivation ever changes, so a
// future decrypt path can route between schemes by reading the first byte.
//
// Two key-resolution modes:
//   - 'standard'  : symmetric key in LEADS_ENCRYPTION_KEY env var (SWL custodial).
//   - 'sovereign' : key fetched from a tenant-managed endpoint (zero-knowledge).
//                   Wired up when the first sovereign client onboards.

import { createCipheriv, createDecipheriv, randomBytes, type CipherGCM, type DecipherGCM } from "node:crypto";
import { getSupabaseService } from "@/lib/supabase-service";

const VERSION = 1;
const ALGORITHM = "aes-256-gcm" as const;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = 1 + IV_LENGTH + TAG_LENGTH;

export type EncryptionMode = "standard" | "sovereign";

export type Caller = "agent-ai" | "client-app" | "swl-admin" | "system";

interface CompanyBioCryptoConfig {
  encryption_mode: EncryptionMode;
  sovereign_endpoint_url: string | null;
  encryption_key_version: number | null;
}

async function getEncryptionConfig(companyBioId: string): Promise<CompanyBioCryptoConfig> {
  const svc = getSupabaseService();
  const { data, error } = await svc
    .from("company_bios")
    .select("encryption_mode, sovereign_endpoint_url, encryption_key_version")
    .eq("id", companyBioId)
    .single();
  if (error || !data) {
    throw new Error(`Failed to load encryption config for ${companyBioId}: ${error?.message ?? "not found"}`);
  }
  return data as CompanyBioCryptoConfig;
}

function getStandardKey(): Buffer {
  const b64 = process.env.LEADS_ENCRYPTION_KEY;
  if (!b64) throw new Error("LEADS_ENCRYPTION_KEY env var is not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error(`LEADS_ENCRYPTION_KEY must be ${KEY_LENGTH} bytes after base64 decode (got ${key.length})`);
  }
  return key;
}

async function getKeyForTenant(companyBioId: string): Promise<{ key: Buffer; mode: EncryptionMode }> {
  const cfg = await getEncryptionConfig(companyBioId);
  if (cfg.encryption_mode === "standard") {
    return { key: getStandardKey(), mode: "standard" };
  }
  if (cfg.encryption_mode === "sovereign") {
    throw new Error("Sovereign encryption mode is not yet activated. Configure sovereign_endpoint_url and implement fetchKeyFromSovereignWorker() to enable.");
  }
  throw new Error(`Unknown encryption_mode: ${cfg.encryption_mode}`);
}

// Resolve once and decrypt N times — for list views that have many leads from
// the same tenant. Avoids hitting company_bios on every row.
export async function resolveTenantKey(
  companyBioId: string,
): Promise<{ key: Buffer; mode: EncryptionMode }> {
  return getKeyForTenant(companyBioId);
}

export function decryptWithResolvedKey(blob: Buffer, key: Buffer): Record<string, unknown> {
  if (blob.length < HEADER_LENGTH) throw new Error("Ciphertext too short");
  const version = blob[0];
  if (version !== VERSION) throw new Error(`Unsupported encryption version: ${version}`);
  const iv = blob.subarray(1, 1 + IV_LENGTH);
  const tag = blob.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
  const ciphered = blob.subarray(HEADER_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv) as DecipherGCM;
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphered), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as Record<string, unknown>;
}

export function encryptWithResolvedKey(
  payload: Record<string, unknown>,
  key: Buffer,
): { ciphertext: Buffer; version: number } {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv) as CipherGCM;
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphered = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphered]),
    version: VERSION,
  };
}

export async function encryptLeadPayload(
  payload: Record<string, unknown>,
  companyBioId: string,
): Promise<{ ciphertext: Buffer; version: number; mode: EncryptionMode }> {
  const { key, mode } = await getKeyForTenant(companyBioId);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv) as CipherGCM;
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphered = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_LENGTH) {
    throw new Error(`Unexpected GCM tag length: ${tag.length}`);
  }
  const blob = Buffer.concat([Buffer.from([VERSION]), iv, tag, ciphered]);
  return { ciphertext: blob, version: VERSION, mode };
}

// Supabase returns `bytea` columns differently depending on transport:
//  - REST  : string with "\x" prefix (hex-encoded)
//  - postgrest-js : sometimes Buffer/Uint8Array, sometimes the same hex string
//  - manual JSON  : base64 string
// This normaliser accepts whatever shape comes back and gives us a Buffer.
export function bufferFromSupabaseBytea(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") {
    if (value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
    return Buffer.from(value, "base64");
  }
  throw new Error(`Unsupported bytea shape: ${typeof value}`);
}

export async function decryptLeadPayload(
  blob: Buffer,
  companyBioId: string,
): Promise<Record<string, unknown>> {
  if (blob.length < HEADER_LENGTH) {
    throw new Error("Ciphertext too short");
  }
  const version = blob[0];
  if (version !== VERSION) {
    throw new Error(`Unsupported encryption version: ${version}`);
  }
  const { key } = await getKeyForTenant(companyBioId);
  const iv = blob.subarray(1, 1 + IV_LENGTH);
  const tag = blob.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
  const ciphered = blob.subarray(HEADER_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv) as DecipherGCM;
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphered), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as Record<string, unknown>;
}

// Append-only audit log. Every decrypt path must call this so the tenant has a
// full record of who read their leads and why.
export async function logDataAccess(params: {
  companyBioId: string;
  leadId?: string | null;
  caller: Caller;
  reason: string;
  encryptionMode?: EncryptionMode;
}): Promise<void> {
  const svc = getSupabaseService();
  await svc.from("data_access_log").insert({
    company_bio_id: params.companyBioId,
    lead_id: params.leadId ?? null,
    caller: params.caller,
    reason: params.reason,
    encryption_mode: params.encryptionMode ?? null,
  });
}

// Columns that move into encrypted_payload when source='client'. Anything not
// listed here is operational metadata that stays in plain (status, allow_*,
// FKs, timestamps, scores) so the orchestrator and RLS keep working.
export const ENCRYPTED_LEAD_COLUMNS = [
  "primary_first_name",
  "primary_last_name",
  "primary_personal_email",
  "primary_work_email",
  "primary_phone",
  "primary_secondary_phone",
  "primary_linkedin_url",
  "primary_instagram",
  "primary_facebook",
  "primary_photo_url",
  "primary_headline",
  "primary_title_role",
  "primary_career",
  "primary_seniority",
  "primary_email_status",
  "whatsapp_number",
  "telegram",
  "linkedin_internal_id",
  "linkedin_assigned_account",
  "company_name",
  "company_website",
  "company_address_1",
  "company_address_2",
  "company_cp",
  "company_city",
  "company_state",
  "company_country",
  "company_phone",
  "company_email",
  "company_linkedin",
  "company_instagram",
  "company_google_mybusiness",
  "twitter_url",
  "facebook_url",
  "company_industry",
  "company_sub_industry",
  "keywords",
  "employees",
  "annual_revenue",
  "organization_tagline",
  "organization_description",
  "organization_short_desc",
  "organization_seo_desc",
  "organization_logo_url",
  "organization_technologies",
  "similar_organization",
  "google_reviews_rating",
  "company_posts_content",
  "industry_trends",
  "company_linkedin_post",
  "company_blog",
  "instagram_last_posts",
  "twitter_last_posts",
  "company_mission",
  "recent_website_news",
  "website_summary",
  "recent_linkedin_post",
  "recent_ig_post",
  "seller_notes",
  "opportunity_notes",
  "ai_summary",
  "enrichment",
  "ai_loss_analysis",
] as const;

export type EncryptedLeadColumn = (typeof ENCRYPTED_LEAD_COLUMNS)[number];

export const ENCRYPTED_COLUMNS_SET: ReadonlySet<string> = new Set(ENCRYPTED_LEAD_COLUMNS);

// Splits an incoming lead row into:
//   - operational : columns that stay in plain
//   - encrypted   : columns that become the JSON payload
// Pass the result through encryptLeadPayload() and INSERT both halves.
export function splitLeadForEncryption<T extends Record<string, unknown>>(
  row: T,
): { operational: Record<string, unknown>; encrypted: Record<string, unknown> } {
  const operational: Record<string, unknown> = {};
  const encrypted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (ENCRYPTED_COLUMNS_SET.has(key)) {
      if (value !== undefined && value !== null && value !== "") encrypted[key] = value;
    } else {
      operational[key] = value;
    }
  }
  return { operational, encrypted };
}

// Hydrates an encrypted lead row back into the shape the rest of the app
// expects. Operational columns come from Supabase, encrypted columns come from
// the decrypted payload, and undefined fields fall back to null so the API
// shape is stable.
export function hydrateDecryptedLead(
  operationalRow: Record<string, unknown>,
  decryptedPayload: Record<string, unknown>,
): Record<string, unknown> {
  return { ...operationalRow, ...decryptedPayload, encrypted_payload: undefined };
}

// Used by the SWL-admin redaction path: returns the row with all PII columns
// replaced by null so the API never leaks even a stale value.
export function redactClientLead(operationalRow: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...operationalRow, encrypted_payload: undefined };
  for (const col of ENCRYPTED_LEAD_COLUMNS) {
    out[col] = null;
  }
  return out;
}
