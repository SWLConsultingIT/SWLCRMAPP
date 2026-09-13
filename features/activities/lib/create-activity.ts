// Single reusable client action to create an Activity. Every surface (global
// modal, call outcome, inbox, lead detail, results) funnels through here → the
// canonical POST /api/activities. This is a thin transport wrapper ONLY: all
// validation, tenant/ownership and side effects stay server-side. No local
// store, no business rules here.

export type CreateActivityInput = {
  type: string;
  title: string;
  leadId?: string | null;
  assignedTo?: string | null;
  dueAt?: string | null;          // absolute ISO instant
  dueTz?: string | null;          // IANA zone the time was picked in
  reminderOffsetMinutes?: number | null;
  description?: string | null;
  source?: string;               // manual | lead_detail | call_callback | inbox | result | ...
  sourceReferenceId?: string | null;
};

export type CreateActivityResult =
  | { ok: true; activity: Record<string, unknown> }
  | { ok: false; error: string };

export async function createActivity(input: CreateActivityInput): Promise<CreateActivityResult> {
  try {
    const r = await fetch("/api/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: input.type,
        title: input.title,
        lead_id: input.leadId ?? null,
        assigned_to: input.assignedTo ?? undefined,
        due_at: input.dueAt ?? null,
        due_tz: input.dueTz ?? null,
        reminder_offset_minutes: input.reminderOffsetMinutes ?? null,
        description: input.description ?? null,
        source: input.source ?? "manual",
        source_reference_id: input.sourceReferenceId ?? null,
      }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      return { ok: false, error: (body as { error?: string })?.error || `HTTP ${r.status}` };
    }
    const body = await r.json();
    return { ok: true, activity: body.activity };
  } catch {
    return { ok: false, error: "network" };
  }
}
