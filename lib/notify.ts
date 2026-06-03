import { getSupabaseService } from "@/lib/supabase-service";

// Shared helper to fan out in-app notifications. Used by the tag + note-mention
// flows (and later chat). Dedupes recipients and never notifies the actor about
// their own action. All writes are service-role (the table's RLS only grants
// recipients SELECT, for Realtime delivery).
export type NotifyType = "mention" | "tag" | "note" | "message";

export async function createNotifications(input: {
  companyBioId: string;
  recipientUserIds: (string | null | undefined)[];
  actorUserId: string | null;
  actorName: string | null;
  type: NotifyType;
  leadId?: string | null;
  body?: string | null;
  link?: string | null;
}): Promise<void> {
  const recipients = Array.from(new Set(input.recipientUserIds.filter((u): u is string => !!u)))
    .filter(uid => uid !== input.actorUserId);
  if (recipients.length === 0) return;

  const rows = recipients.map(uid => ({
    company_bio_id: input.companyBioId,
    recipient_user_id: uid,
    actor_user_id: input.actorUserId,
    actor_name: input.actorName,
    type: input.type,
    lead_id: input.leadId ?? null,
    body: input.body ?? null,
    link: input.link ?? null,
  }));
  await getSupabaseService().from("notifications").insert(rows);
}
