// Screenshots attached to a Team Chat message.
//
// Everything that decides whether a file gets in lives here and is PURE: the
// upload route and the message POST both call it, and
// scripts/test-chat-attachments.mts pins it with no DB and no network. The
// rest of the module is path + signing helpers.
//
// Deliberately narrow: images ONLY. This is not a document manager —
// campaign-attachments already covers PDFs and Office files for that use case.

export const CHAT_BUCKET = "chat-attachments";

/** 10 MB. A PNG screenshot of a 5K display lands around 3-5 MB. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Per message. Nobody sends 20 screenshots at once; the cap is there so a
 *  patched client can't inflate the message jsonb. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;

export const ALLOWED_IMAGE_MIME = ["image/png", "image/jpeg", "image/webp"] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number];

/** Extensions the file picker accepts. The MIME is checked as well — an
 *  extension on its own is trivial to fake. */
export const ALLOWED_IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp"] as const;

export type ChatAttachment = {
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
};

/** What the client sees: the attachment plus a short-lived signed URL. */
export type SignedChatAttachment = ChatAttachment & { url: string | null };

export type Rejection = { ok: false; code: RejectionCode; message: string };
export type RejectionCode =
  | "empty"
  | "too_large"
  | "unsupported_type"
  | "too_many"
  | "bad_path"
  | "cross_tenant";

export type Validation = { ok: true } | Rejection;

function reject(code: RejectionCode, message: string): Rejection {
  return { ok: false, code, message };
}

/**
 * Can this file be uploaded?
 *
 * The MIME checked here is the one Supabase Storage will record, but it is not
 * the only line of defence: the bucket declares `allowed_mime_types`, so the
 * provider rejects again server-side even if a client lies at this point.
 *
 * `message` is for logs and for the generic fallback — the UI renders its own
 * localized copy off `code`, so this text never has to be translated.
 */
export function validateUpload(input: { size: number; type: string; name: string }): Validation {
  if (!input.size) return reject("empty", "The file is empty.");
  if (input.size > MAX_ATTACHMENT_BYTES) {
    return reject("too_large", `Image is over ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB.`);
  }
  const mime = (input.type || "").toLowerCase();
  if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(mime)) {
    return reject("unsupported_type", `Unsupported type: ${input.type || "unknown"}. PNG, JPG or WebP only.`);
  }
  const lower = (input.name || "").toLowerCase();
  const extOk = ALLOWED_IMAGE_EXT.some(e => lower.endsWith(e));
  // A clipboard paste may carry no filename at all; there the MIME decides.
  if (input.name && !extOk) {
    return reject("unsupported_type", `Unsupported extension: ${input.name}.`);
  }
  return { ok: true };
}

/**
 * Sanitizes the name and builds the object key. The tenant prefix is what
 * makes the isolation guard trivial; the uuid avoids collisions.
 *
 * Runs of dots collapse to one. Slashes are already gone by then, so ".." can
 * no longer traverse anywhere — but pathBelongsToTenant refuses any path
 * *containing* "..", so leaving it in would produce a file that uploads fine
 * and is then rejected as cross-tenant when the message tries to reference it.
 */
export function buildAttachmentPath(companyBioId: string, uuid: string, originalName: string): string {
  const safe = (originalName || "screenshot.png")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .slice(0, 120);
  return `${companyBioId}/${uuid}-${safe}`;
}

/**
 * Does this path belong to the caller's tenant?
 *
 * This is the guard that stops somebody from posting a message carrying
 * another tenant's screenshot path and then reading it back through the signed
 * URL. It runs on the message POST, not only on upload: the path travels in
 * the request body, so the client controls it.
 */
export function pathBelongsToTenant(path: string, companyBioId: string | null): boolean {
  if (!path || !companyBioId) return false;
  if (path.includes("..") || path.startsWith("/")) return false;
  return path.startsWith(`${companyBioId}/`);
}

/**
 * Validates the attachment array carried by a message POST.
 * Returns normalized attachments — any extra field the client sends is
 * dropped, so the jsonb only ever stores the known shape.
 */
export function validateMessageAttachments(
  raw: unknown,
  companyBioId: string | null,
): { ok: true; attachments: ChatAttachment[] } | Rejection {
  if (raw == null) return { ok: true, attachments: [] };
  if (!Array.isArray(raw)) return reject("bad_path", "Invalid attachments payload.");
  if (raw.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    return reject("too_many", `At most ${MAX_ATTACHMENTS_PER_MESSAGE} images per message.`);
  }

  const out: ChatAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return reject("bad_path", "Invalid attachment.");
    const a = item as Record<string, unknown>;
    const path = typeof a.path === "string" ? a.path : "";
    const name = typeof a.name === "string" ? a.name : "screenshot";
    const mimeType = typeof a.mimeType === "string" ? a.mimeType.toLowerCase() : "";
    const sizeBytes = typeof a.sizeBytes === "number" ? a.sizeBytes : 0;

    if (!path) return reject("bad_path", "Attachment without a path.");
    if (!pathBelongsToTenant(path, companyBioId)) {
      return reject("cross_tenant", "That attachment does not belong to your workspace.");
    }
    if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(mimeType)) {
      return reject("unsupported_type", `Unsupported type: ${mimeType || "unknown"}.`);
    }
    if (sizeBytes > MAX_ATTACHMENT_BYTES) {
      return reject("too_large", "Image is over the size limit.");
    }

    const att: ChatAttachment = { path, name, mimeType, sizeBytes };
    if (typeof a.width === "number" && a.width > 0) att.width = a.width;
    if (typeof a.height === "number" && a.height > 0) att.height = a.height;
    out.push(att);
  }
  return { ok: true, attachments: out };
}

/** A message needs text OR at least one attachment. A lone screenshot is a
 *  valid message; completely empty is not. */
export function messageHasContent(body: string | null | undefined, attachments: ChatAttachment[]): boolean {
  return Boolean(body?.trim()) || attachments.length > 0;
}

/** Reads the row's jsonb and keeps only what actually looks like an
 *  attachment. An old row (NULL) yields []. */
export function parseStoredAttachments(raw: unknown): ChatAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (a): a is ChatAttachment =>
      !!a && typeof a === "object" &&
      typeof (a as ChatAttachment).path === "string" &&
      typeof (a as ChatAttachment).mimeType === "string",
  );
}

/** Signed-URL TTL: long enough for an open chat to render and for the reader
 *  to open the image full size, short enough that the link is useless if it is
 *  pasted somewhere else hours later. */
export const SIGN_TTL_SECONDS = 60 * 30;
