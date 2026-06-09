// Lead-level notes — read/write/delete. Surfaced as "Team Notes" in the
// lead detail right column (ActivityTimeline.tsx). One row per note,
// authored by a real user (tracked via created_by + author_name), shown in
// reverse-chronological order with relative timestamps.
//
// Tenant isolation: tenants can only read/write notes for leads in their
// own bio. Super_admins can write across tenants for support reasons.
//
// Auth on DELETE: a note can be deleted by its author OR by a user with
// canViewAllTenantData (super_admin/owner/manager). Sellers can't nuke
// each other's notes.

import { getSupabaseServer } from "@/lib/supabase-server";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope, canViewAllTenantData } from "@/lib/scope";
import { createNotifications } from "@/lib/notify";
import { ensureDm, postDmFromActor } from "@/lib/chat-dm";
import { NextRequest, NextResponse } from "next/server";

async function authorDisplayName(scope: { userId: string | null }): Promise<string> {
  if (!scope.userId) return "Team";
  const sb = await getSupabaseServer();
  try {
    const { data: { user } } = await sb.auth.getUser();
    const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
    return (
      (meta.display_name as string | undefined)
      ?? (meta.name as string | undefined)
      ?? (meta.full_name as string | undefined)
      ?? (user?.email as string | undefined)?.split("@")[0]
      ?? "Team"
    );
  } catch {
    return "Team";
  }
}

async function assertLeadInScope(svc: ReturnType<typeof getSupabaseService>, leadId: string, scope: Awaited<ReturnType<typeof getUserScope>>) {
  if (!scope.isScoped) return true;
  const { data } = await svc.from("leads").select("company_bio_id").eq("id", leadId).maybeSingle();
  const bio = (data as { company_bio_id?: string | null } | null)?.company_bio_id ?? null;
  return !!bio && bio === scope.companyBioId;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { content, mentioned_user_ids, note_type } = await req.json().catch(() => ({}));
  if (!content?.trim()) return NextResponse.json({ error: "Content required" }, { status: 400 });
  if (content.length > 4000) return NextResponse.json({ error: "Note too long (max 4000)" }, { status: 400 });
  const noteType = note_type === "call" ? "call" : "general";

  const svc = getSupabaseService();
  // Fetch the lead once: scope check + tenant id + label for the @mention ping.
  const { data: lead } = await svc.from("leads").select("company_bio_id, primary_first_name, primary_last_name, company_name").eq("id", id).maybeSingle();
  const leadBio = (lead as { company_bio_id?: string | null } | null)?.company_bio_id ?? null;
  if (scope.isScoped && leadBio !== scope.companyBioId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const mentions = Array.isArray(mentioned_user_ids)
    ? mentioned_user_ids.filter((x: unknown): x is string => typeof x === "string")
    : [];

  const author_name = await authorDisplayName(scope);
  const { data, error } = await svc
    .from("lead_notes")
    .insert({
      lead_id: id,
      content: content.trim(),
      created_by: scope.userId,
      author_name,
      mentioned_user_ids: mentions.length ? mentions : null,
      note_type: noteType,
    })
    .select("id, content, created_at, created_by, author_name, mentioned_user_ids, note_type, pinned")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Notify mentioned teammates (excluding the author).
  if (mentions.length && leadBio) {
    const l = lead as { primary_first_name?: string | null; primary_last_name?: string | null; company_name?: string | null };
    const label = [l.primary_first_name, l.primary_last_name].filter(Boolean).join(" ") || l.company_name || "a lead";
    await createNotifications({
      companyBioId: leadBio,
      recipientUserIds: mentions,
      actorUserId: scope.userId,
      actorName: author_name,
      type: "mention",
      leadId: id,
      body: `mentioned you on ${label}`,
      // Deep-link straight to the Notes tab so the recipient lands ON the
      // @mention, not the Profile tab (boss 2026-06-09: "no me muestra el tag").
      link: `/leads/${id}?tab=notes`,
    });

    // Also drop the @mention into the Team Chat DM with each mentioned
    // teammate (boss 2026-06-09: mentions should reach the team chat too, like
    // tags do). One DM thread per pair; excludes the author (no self-DM).
    const excerpt = content.trim().replace(/\s+/g, " ").slice(0, 140);
    for (const uid of mentions) {
      if (uid === scope.userId) continue;
      const threadId = await ensureDm(svc, leadBio, scope.userId, uid);
      if (threadId) {
        await postDmFromActor(svc, threadId, scope.userId, author_name, `💬 Mentioned you on ${label}: "${excerpt}"\n→ /leads/${id}?tab=notes`);
      }
    }
  }
  return NextResponse.json({ note: data });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ notes: [] });

  const { id } = await params;
  const svc = getSupabaseService();
  if (!(await assertLeadInScope(svc, id, scope))) {
    return NextResponse.json({ notes: [] });
  }

  const { data, error } = await svc
    .from("lead_notes")
    .select("id, content, created_at, created_by, author_name, mentioned_user_ids, note_type, pinned")
    .eq("lead_id", id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ notes: [] });
  return NextResponse.json({ notes: data ?? [] });
}

// Toggle a note's `pinned` flag (surfaces it in the lead's Profile Overview).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { noteId, pinned } = await req.json().catch(() => ({}));
  if (!noteId || typeof pinned !== "boolean") return NextResponse.json({ error: "noteId + pinned required" }, { status: 400 });

  const svc = getSupabaseService();
  if (!(await assertLeadInScope(svc, id, scope))) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { error } = await svc.from("lead_notes").update({ pinned }).eq("id", noteId).eq("lead_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scope = await getUserScope();
  if (!scope.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const noteId = new URL(req.url).searchParams.get("noteId");
  if (!noteId) return NextResponse.json({ error: "noteId required" }, { status: 400 });

  const svc = getSupabaseService();
  if (!(await assertLeadInScope(svc, id, scope))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Authors can always delete their own; managers/owners/super_admin can
  // delete any. Sellers without create_by ownership get 403.
  const { data: note } = await svc
    .from("lead_notes")
    .select("created_by, lead_id")
    .eq("id", noteId)
    .maybeSingle();
  if (!note) return NextResponse.json({ error: "not found" }, { status: 404 });
  if ((note as { lead_id?: string }).lead_id !== id) {
    return NextResponse.json({ error: "mismatch" }, { status: 400 });
  }
  const isOwn = (note as { created_by?: string | null }).created_by === scope.userId;
  if (!isOwn && !canViewAllTenantData(scope.tier)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { error } = await svc.from("lead_notes").delete().eq("id", noteId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
