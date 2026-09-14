// Team Chat screenshot attachments — validation + tenant-isolation tests.
// Part of `npm test`.
//
// The rules that decide whether a file gets in, and whose screenshot a message
// is allowed to reference, live in lib/chat-attachments.ts precisely so they
// can be pinned here with no DB, no Storage and no network. The bug this
// guards against is the expensive one: a client that posts a message carrying
// a path under ANOTHER tenant's prefix, and then reads that screenshot back
// through the signed URL the server mints on its behalf.

import {
  ALLOWED_IMAGE_EXT,
  ALLOWED_IMAGE_MIME,
  CHAT_BUCKET,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
  SIGN_TTL_SECONDS,
  buildAttachmentPath,
  messageHasContent,
  parseStoredAttachments,
  pathBelongsToTenant,
  validateMessageAttachments,
  validateUpload,
  type ChatAttachment,
} from "@/lib/chat-attachments";

let failed = 0;
let checks = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) { failed++; console.error("  ✗ " + msg); }
}

const BIO_A = "ce3dff61-1111-2222-3333-444455556666";
const BIO_B = "aef0e3b3-9999-8888-7777-666655554444";
const PNG = "image/png";

// ── 1. Upload gate ─────────────────────────────────────────────────────────
console.log("chat attachments · upload validation");

ok(validateUpload({ size: 1024, type: PNG, name: "shot.png" }).ok, "a normal PNG is accepted");
ok(validateUpload({ size: 1024, type: "image/jpeg", name: "shot.JPG" }).ok, "extension check is case-insensitive");
ok(validateUpload({ size: 1024, type: "image/webp", name: "a.webp" }).ok, "webp is accepted");

// A clipboard paste arrives as a File with no name at all — the MIME decides.
ok(validateUpload({ size: 2048, type: PNG, name: "" }).ok, "a nameless clipboard image is accepted on its MIME");

{
  const r = validateUpload({ size: 0, type: PNG, name: "shot.png" });
  ok(!r.ok && r.code === "empty", "a 0-byte file is rejected as empty");
}
{
  const r = validateUpload({ size: MAX_ATTACHMENT_BYTES + 1, type: PNG, name: "shot.png" });
  ok(!r.ok && r.code === "too_large", "over the size cap is rejected");
}
ok(validateUpload({ size: MAX_ATTACHMENT_BYTES, type: PNG, name: "shot.png" }).ok, "exactly at the size cap is accepted");

// The reason this is not "images only" by extension: the point of the product
// is screenshots, and anything else is somebody trying to use the chat as a
// file share (or worse, as a way to park an executable in the bucket).
for (const bad of ["application/pdf", "image/svg+xml", "text/html", "application/octet-stream", ""]) {
  const r = validateUpload({ size: 1024, type: bad, name: "x.png" });
  ok(!r.ok && r.code === "unsupported_type", `MIME "${bad || "(empty)"}" is rejected even with a .png name`);
}
{
  // SVG is the one that matters: it is an image to a human and a script host to
  // a browser. It must not survive either check.
  const r = validateUpload({ size: 1024, type: "image/svg+xml", name: "x.svg" });
  ok(!r.ok, "SVG is rejected (it is a scriptable document, not a screenshot)");
}
{
  const r = validateUpload({ size: 1024, type: PNG, name: "payload.exe" });
  ok(!r.ok && r.code === "unsupported_type", "a good MIME with a bad extension is still rejected");
}
ok(!ALLOWED_IMAGE_MIME.some(m => m.includes("svg")), "the allow-list itself contains no SVG");
ok(ALLOWED_IMAGE_EXT.every(e => e.startsWith(".")), "every allowed extension is written with its dot");

// ── 2. Path construction ───────────────────────────────────────────────────
console.log("chat attachments · path construction");

{
  const p = buildAttachmentPath(BIO_A, "uuid-1", "Screen Shot 2026-09-14.png");
  ok(p.startsWith(`${BIO_A}/`), "the path is prefixed with the tenant id");
  ok(p.includes("uuid-1"), "the uuid is in the path (no collisions between two shot.png)");
  ok(pathBelongsToTenant(p, BIO_A), "a freshly built path passes its own tenant guard");
}
{
  // A crafted filename must not be able to climb out of the tenant prefix.
  const p = buildAttachmentPath(BIO_A, "uuid-2", "../../../../etc/passwd");
  ok(!p.includes(".."), "traversal segments are stripped out of the filename");
  ok(pathBelongsToTenant(p, BIO_A), "the sanitized path still lives under the tenant prefix");
}
{
  const p = buildAttachmentPath(BIO_A, "uuid-3", "reporte año — ñandú.png");
  ok(pathBelongsToTenant(p, BIO_A), "a non-ASCII filename still yields a tenant-scoped path");
  ok(!/[^\w./\- ]/.test(p.slice(BIO_A.length + 1)), "the filename is reduced to a safe character set");
}
{
  const p = buildAttachmentPath(BIO_A, "uuid-4", "x".repeat(400) + ".png");
  ok(p.length < 300, "an absurdly long filename is truncated");
}

// ── 3. Tenant guard ────────────────────────────────────────────────────────
console.log("chat attachments · tenant isolation");

ok(pathBelongsToTenant(`${BIO_A}/uuid-shot.png`, BIO_A), "own-tenant path passes");
ok(!pathBelongsToTenant(`${BIO_B}/uuid-shot.png`, BIO_A), "another tenant's path is refused");
ok(!pathBelongsToTenant(`${BIO_A}/../${BIO_B}/shot.png`, BIO_A), "traversal out of the prefix is refused");
ok(!pathBelongsToTenant(`/${BIO_A}/shot.png`, BIO_A), "a leading slash is refused (it is not a relative key)");
ok(!pathBelongsToTenant("shot.png", BIO_A), "an unprefixed path is refused");
ok(!pathBelongsToTenant(`${BIO_A}/shot.png`, null), "no tenant on the session means nothing passes");
ok(!pathBelongsToTenant("", BIO_A), "an empty path is refused");
// Prefix matching must be on the full segment: a tenant id that merely starts
// with another one must not inherit its files.
ok(!pathBelongsToTenant(`${BIO_A}extra/shot.png`, BIO_A), "the prefix must end at the slash, not mid-id");

// ── 4. Message payload ─────────────────────────────────────────────────────
console.log("chat attachments · message payload");

const good: ChatAttachment = { path: `${BIO_A}/uuid-shot.png`, name: "shot.png", mimeType: PNG, sizeBytes: 1024 };

{
  const r = validateMessageAttachments([good], BIO_A);
  ok(r.ok && r.attachments.length === 1, "a well-formed attachment is accepted");
}
{
  const r = validateMessageAttachments(null, BIO_A);
  ok(r.ok && r.attachments.length === 0, "no attachments field is an empty list, not an error");
}
{
  const r = validateMessageAttachments([], BIO_A);
  ok(r.ok && r.attachments.length === 0, "an empty array is accepted");
}
{
  // THE test: the path points at another tenant's bucket prefix. Accepting it
  // would have the server sign a URL for a screenshot the caller can't see.
  const stolen = { ...good, path: `${BIO_B}/uuid-shot.png` };
  const r = validateMessageAttachments([stolen], BIO_A);
  ok(!r.ok && r.code === "cross_tenant", "a cross-tenant path is refused on the message POST");
}
{
  const r = validateMessageAttachments([{ ...good, path: `${BIO_A}/../${BIO_B}/x.png` }], BIO_A);
  ok(!r.ok && r.code === "cross_tenant", "a traversal path is refused on the message POST");
}
{
  const r = validateMessageAttachments([good], null);
  ok(!r.ok, "a session with no tenant cannot attach anything");
}
{
  const many = Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 1 }, () => good);
  const r = validateMessageAttachments(many, BIO_A);
  ok(!r.ok && r.code === "too_many", "more than the per-message cap is refused");
}
{
  const r = validateMessageAttachments([{ ...good, mimeType: "text/html" }], BIO_A);
  ok(!r.ok && r.code === "unsupported_type", "a non-image MIME is refused on the message POST too");
}
{
  const r = validateMessageAttachments([{ ...good, sizeBytes: MAX_ATTACHMENT_BYTES + 1 }], BIO_A);
  ok(!r.ok && r.code === "too_large", "an oversized attachment is refused on the message POST too");
}
for (const bad of ["not-an-array", 42, {}, [null], [{}], [{ path: 42 }]]) {
  const r = validateMessageAttachments(bad, BIO_A);
  ok(!r.ok, `a malformed payload (${JSON.stringify(bad)}) is refused`);
}
{
  // Extra fields the client invents are dropped: the jsonb only ever holds the
  // known shape, so nothing unexpected reaches the renderer.
  const r = validateMessageAttachments(
    [{ ...good, url: "https://evil.example/x.png", onerror: "alert(1)", width: 800, height: 600 }],
    BIO_A,
  );
  ok(r.ok, "an attachment with extra fields is accepted");
  if (r.ok) {
    const keys = Object.keys(r.attachments[0]).sort().join(",");
    ok(keys === "height,mimeType,name,path,sizeBytes,width", `only known fields survive (got ${keys})`);
    ok(!("url" in r.attachments[0]), "a client-supplied url is never stored");
  }
}
{
  const r = validateMessageAttachments([{ ...good, mimeType: "IMAGE/PNG" }], BIO_A);
  ok(r.ok, "the MIME check is case-insensitive");
}

// ── 5. Empty-message rule ──────────────────────────────────────────────────
console.log("chat attachments · message content rule");

ok(messageHasContent("hola", []), "text alone is a message");
ok(messageHasContent("", [good]), "a screenshot alone is a message");
ok(messageHasContent(null, [good]), "a screenshot with a null body is a message");
ok(!messageHasContent("", []), "nothing at all is not a message");
ok(!messageHasContent("   \n ", []), "whitespace alone is not a message");

// ── 6. Reading old rows ────────────────────────────────────────────────────
console.log("chat attachments · stored rows");

// Every message written before the migration has attachments = NULL. Those
// rows must keep rendering exactly as they did.
ok(parseStoredAttachments(null).length === 0, "a pre-migration NULL row reads as no attachments");
ok(parseStoredAttachments(undefined).length === 0, "an absent column reads as no attachments");
ok(parseStoredAttachments("[]").length === 0, "a non-array value reads as no attachments");
ok(parseStoredAttachments([good]).length === 1, "a stored attachment round-trips");
ok(parseStoredAttachments([good, null, { name: "x" }]).length === 1, "junk mixed into the array is dropped");

// ── 7. Constants the rest of the system depends on ─────────────────────────
console.log("chat attachments · constants");

ok(CHAT_BUCKET === "chat-attachments", "the bucket name matches the migration");
ok(MAX_ATTACHMENT_BYTES === 10 * 1024 * 1024, "the size cap matches the bucket's file_size_limit");
ok(SIGN_TTL_SECONDS > 0 && SIGN_TTL_SECONDS <= 60 * 60, "signed URLs are short-lived (≤ 1h)");

console.log(`\n${checks - failed}/${checks} chat-attachment assertions passed`);
if (failed) process.exit(1);
