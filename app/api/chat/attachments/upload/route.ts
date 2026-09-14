// POST /api/chat/attachments/upload
//
// Takes a screenshot from the Team Chat composer, drops it in the private
// `chat-attachments` bucket under {company_bio_id}/{uuid}-name and returns the
// path. Same shape as the campaigns uploader: the PATH is what gets stored,
// never a URL — signed URLs are minted when the message is read, and expire.
//
// Images only, 10 MB: this is for screenshots, not a document manager. The
// rules live in lib/chat-attachments.ts and are tested there.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSupabaseService } from "@/integrations/supabase/service";
import { getUserScope } from "@/shared/auth/scope";
import {
  CHAT_BUCKET,
  buildAttachmentPath,
  pathBelongsToTenant,
  validateUpload,
} from "@/lib/chat-attachments";

export async function POST(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!scope.companyBioId) return NextResponse.json({ error: "No tenant" }, { status: 403 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });

  const check = validateUpload({ size: file.size, type: file.type, name: file.name });
  if (!check.ok) return NextResponse.json({ error: check.message, code: check.code }, { status: 400 });

  const path = buildAttachmentPath(scope.companyBioId, randomUUID(), file.name);

  const svc = getSupabaseService();
  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await svc.storage.from(CHAT_BUCKET).upload(path, buf, {
    contentType: file.type,
    cacheControl: "3600",
    upsert: false,
  });
  if (error) return NextResponse.json({ error: `Upload failed: ${error.message}` }, { status: 500 });

  return NextResponse.json({
    path,
    name: file.name || "screenshot.png",
    mimeType: file.type,
    sizeBytes: file.size,
  });
}

// DELETE /api/chat/attachments/upload?path=...
//
// The user uploaded a screenshot then removed it from the composer before
// sending. Drop the object: no message references it yet.
export async function DELETE(req: NextRequest) {
  const scope = await getUserScope();
  if (!scope.userId || !scope.companyBioId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const path = new URL(req.url).searchParams.get("path");
  if (!path) return NextResponse.json({ error: "Missing path" }, { status: 400 });

  // The tenant prefix is the guard: without it somebody could delete another
  // workspace's screenshot by guessing the path.
  if (!pathBelongsToTenant(path, scope.companyBioId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const svc = getSupabaseService();
  const { error } = await svc.storage.from(CHAT_BUCKET).remove([path]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
