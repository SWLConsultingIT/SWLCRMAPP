// Campaign message attachments — the ONE remaining seller-reachable direct
// browser storage write (MessageAttachments in /campaigns/[id]/edit), relocated
// behind /api so the View-As read-only block (proxy.ts) covers it server-side
// instead of only the client guard.
//
// Deliberately minimal + semantics-preserving:
//   · same bucket ("campaign-files"), same path shape, returns the same public
//     URL the component stored before — no storage-architecture change;
//   · RLS server client (the user's own JWT), like the Voice endpoints — no
//     service role, so the same storage RLS applies as the old browser upload;
//   · tenant / campaign authorization is derived SERVER-SIDE: we read the
//     campaign under the caller's RLS session, so a campaign the user can't see
//     (cross-tenant, or none) is rejected before any upload. Nothing about
//     ownership is trusted from the body.

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/integrations/supabase/server";
import { getUserScope, getMyAssignedUserId } from "@/shared/auth/scope";
import { campaignWriteAuthz, getVisibleCampaign } from "@/shared/auth/campaign-access";

const MAX_BYTES = 10 * 1024 * 1024;

function fileType(mime: string): "image" | "pdf" | "file" {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  return "file";
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: campaignId } = await params;
  const scope = await getUserScope();
  const sb = await getSupabaseServer();
  // Only read the campaign once we know there's a user+tenant to read it as.
  const campaign = scope.userId && scope.companyBioId ? await getVisibleCampaign(sb, campaignId) : null;
  // Canonical seller chokepoint: userId for a seller, null for owner/manager/
  // super_admin (tenant-wide). Same key every other seller surface scopes by.
  const sellerUserId = await getMyAssignedUserId();
  const authz = campaignWriteAuthz({
    userId: scope.userId,
    companyBioId: scope.companyBioId,
    campaign,
    sellerUserId,
  });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const stepNumber = String(form?.get("stepNumber") ?? "0");
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
  const mime = file.type || "application/octet-stream";
  if (!mime.startsWith("image/") && mime !== "application/pdf") {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  // Same path shape the component used, so nothing about stored URLs changes.
  const ext = file.name.split(".").pop() ?? "bin";
  const path = `campaign-attachments/${Date.now()}-step${stepNumber}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await sb.storage.from("campaign-files").upload(path, bytes, { upsert: false, contentType: mime });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

  const { data: urlData } = sb.storage.from("campaign-files").getPublicUrl(path);
  return NextResponse.json({
    ok: true,
    attachment: { name: file.name, url: urlData.publicUrl, type: fileType(mime), size: file.size },
  });
}
