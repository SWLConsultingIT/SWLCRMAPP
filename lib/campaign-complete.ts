// Single source of truth for the "a dispatcher just finished the last step"
// patch. Historically the dispatchers set `status:'completed'` but NOT
// `completed_at`, so ~75% of completed campaigns had a NULL completion date
// (LinkedIn Recovery needs it to time the 5-day pre-withdraw wait). This helper
// stamps both together at the moment of completion. Pure + tested.
//
// It returns {} when the flow is NOT finishing (there's a next step), so callers
// can spread it into an existing campaigns update object unchanged.
export function completionFields(
  nextEligibleAt: string | null,
  nowISO: string,
): { status: "completed"; completed_at: string } | Record<string, never> {
  return nextEligibleAt === null ? { status: "completed", completed_at: nowISO } : {};
}
