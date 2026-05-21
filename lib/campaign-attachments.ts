import { getSupabaseService } from "@/lib/supabase-service";

// Shape of an attachment stored inside campaigns.sequence_steps[i].attachments.
// `path` is the canonical key (bucket-relative); we generate signed URLs from
// it at dispatch time so the link to the provider can't be replayed once the
// message has been sent.
export type StepAttachment = {
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
};

// 5 minute signed URL — long enough for any reasonable upstream (Instantly's
// fetch happens within seconds of POST; Unipile streams the file during the
// chat-message POST itself) without leaving a publicly readable handle on a
// PDF for hours after a campaign run.
const SIGN_TTL_SECONDS = 60 * 5;

/**
 * Read attachments off a step config and sign each one for dispatch.
 * Returns `[]` if the step has no attachments. Throws on signing failure so
 * the dispatcher can mark the message as failed rather than send a broken
 * message with no file attached.
 */
export async function signStepAttachments(stepAttachments: unknown): Promise<Array<StepAttachment & { signedUrl: string }>> {
  if (!Array.isArray(stepAttachments) || stepAttachments.length === 0) return [];
  const svc = getSupabaseService();
  const out: Array<StepAttachment & { signedUrl: string }> = [];
  for (const raw of stepAttachments) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Partial<StepAttachment>;
    if (!a.path || !a.name) continue;
    const { data, error } = await svc.storage
      .from("campaign-attachments")
      .createSignedUrl(a.path, SIGN_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      throw new Error(`failed to sign attachment ${a.name}: ${error?.message ?? "unknown"}`);
    }
    out.push({
      path: a.path,
      name: a.name,
      mimeType: a.mimeType ?? "application/octet-stream",
      sizeBytes: typeof a.sizeBytes === "number" ? a.sizeBytes : 0,
      signedUrl: data.signedUrl,
    });
  }
  return out;
}

/**
 * Download the raw bytes for each step attachment so a dispatcher can re-upload
 * them as proper multipart files to the upstream provider (Unipile for LinkedIn
 * DMs, Meta for WhatsApp). Different from signStepAttachments(): we hand back
 * actual file blobs the caller can attach as native files in the recipient's
 * inbox, instead of URLs the recipient has to click.
 */
export async function fetchStepAttachments(stepAttachments: unknown): Promise<Array<StepAttachment & { data: Buffer }>> {
  if (!Array.isArray(stepAttachments) || stepAttachments.length === 0) return [];
  const svc = getSupabaseService();
  const out: Array<StepAttachment & { data: Buffer }> = [];
  for (const raw of stepAttachments) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Partial<StepAttachment>;
    if (!a.path || !a.name) continue;
    const { data, error } = await svc.storage.from("campaign-attachments").download(a.path);
    if (error || !data) {
      throw new Error(`failed to download attachment ${a.name}: ${error?.message ?? "unknown"}`);
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    out.push({
      path: a.path,
      name: a.name,
      mimeType: a.mimeType ?? "application/octet-stream",
      sizeBytes: typeof a.sizeBytes === "number" ? a.sizeBytes : buffer.byteLength,
      data: buffer,
    });
  }
  return out;
}
