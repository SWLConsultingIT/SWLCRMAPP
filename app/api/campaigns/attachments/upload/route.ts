import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import { randomUUID } from "node:crypto";

// POST /api/campaigns/attachments/upload
//
// Receives a multipart file from the campaign wizard, lands it in the
// private `campaign-attachments` bucket under {company_bio_id}/{uuid}-name,
// and returns the storage path so the wizard can persist it inside the
// sequence step's `attachments` array. The path (not a URL) is what we
// keep — signed URLs are minted at dispatch time and expire quickly.

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — matches bucket file_size_limit
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
]);

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!scope.companyBioId) {
    return NextResponse.json({ error: "No tenant" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File exceeds 50MB limit (${file.size} bytes)` }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type || "unknown"}` }, { status: 400 });
  }

  // Sanitize the filename portion only — the leading UUID guarantees uniqueness,
  // so we just strip path separators and control characters from the original
  // name to keep the URL readable for the recipient.
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
  const path = `${scope.companyBioId}/${randomUUID()}-${safeName}`;

  const svc = getSupabaseService();
  const arrayBuffer = await file.arrayBuffer();
  const { error: upErr } = await svc.storage
    .from("campaign-attachments")
    .upload(path, Buffer.from(arrayBuffer), {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });

  if (upErr) {
    return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    path,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
}

// DELETE /api/campaigns/attachments/upload?path=...
//
// Lets the wizard remove a file the user just uploaded but then changed their
// mind about. Hard-deletes the storage object — there's no soft-delete here
// because the file isn't referenced by any campaign yet (still in wizard
// state). Once a campaign is approved and dispatching, deletes should go
// through a campaign-scoped route instead.
export async function DELETE(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId || !scope.companyBioId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 });

  // Tenant-scope guard: the path must start with the caller's company_bio_id
  // so a member of tenant A can't delete tenant B's attachment by guessing
  // its path. Super_admin can delete cross-tenant for support reasons.
  if (scope.tier !== "super_admin" && !path.startsWith(`${scope.companyBioId}/`)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const svc = getSupabaseService();
  const { error } = await svc.storage.from("campaign-attachments").remove([path]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
