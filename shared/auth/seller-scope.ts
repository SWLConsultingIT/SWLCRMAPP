// Canonical seller-scope narrowing helpers.
//
// The seller chokepoints in scope.ts (getMyAssignedLeadIds / getMyAssignedUserId
// / getMyAssignedSellerIds) resolve WHAT a seller may see. These two pure
// functions apply that result uniformly across every lead-centric surface
// (lead detail, company detail, opportunity detail, reports) so the narrowing
// is one shared, tested shape rather than an ad-hoc conditional re-written per
// page. The convention throughout: a `null` assigned-set means the caller is
// NOT a seller (owner / manager / super_admin) → no narrowing, tenant-wide as
// before. A non-null set (possibly empty) means narrow to exactly these ids.
//
// Pure + dependency-free so both server pages and the test harness import it.

/**
 * Gate a single lead against a seller's assigned set.
 * - null set (admin) → always in scope (true)
 * - seller → true only if the lead is one of theirs
 * A page whose primary row fails this should `notFound()`, which transitively
 * hides every sub-panel that keys off that row.
 */
export function leadInScope(assignedLeadIds: Set<string> | null, leadId: string): boolean {
  return assignedLeadIds === null || assignedLeadIds.has(leadId);
}

/**
 * Narrow a list of lead-bearing rows to a seller's assigned leads.
 * - null set (admin) → the list is returned unchanged
 * - seller → only rows whose lead id is in the set survive
 */
export function scopeRowsToAssigned<T>(
  assignedLeadIds: Set<string> | null,
  rows: T[],
  leadIdOf: (row: T) => string | null | undefined,
): T[] {
  if (assignedLeadIds === null) return rows;
  return rows.filter(r => {
    const id = leadIdOf(r);
    return !!id && assignedLeadIds.has(id);
  });
}
