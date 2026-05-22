// Recently viewed leads — localStorage-backed list (5 entries) scoped per
// user so the sidebar's "Recent" list never leaks between accounts that
// share a laptop. Without the user-id namespace, an SWL admin and an Arqy
// client signing into the same browser would see each other's recent leads
// — a privacy + multi-tenant smell.

const KEY_PREFIX = "growth.recent-leads"; // per-user: `${KEY_PREFIX}.${userId}`
const LEGACY_KEY = "growth.recent-leads"; // pre-scoping value — we wipe it on
                                          // first scoped write so the old
                                          // unscoped list doesn't leak.
const MAX = 5;

export type RecentLead = {
  id: string;
  name: string;
  company: string | null;
  visitedAt: number;
};

function storageKey(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return `${KEY_PREFIX}.${userId}`;
}

export function loadRecentLeads(userId: string | null | undefined): RecentLead[] {
  if (typeof window === "undefined") return [];
  const key = storageKey(userId);
  if (!key) return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX);
  } catch {
    return [];
  }
}

export function pushRecentLead(
  userId: string | null | undefined,
  entry: Omit<RecentLead, "visitedAt">,
) {
  if (typeof window === "undefined") return;
  const key = storageKey(userId);
  if (!key) return;
  try {
    // Drop the legacy unscoped list the first time we write a scoped one.
    // Older sessions had a shared `growth.recent-leads` key with no userId —
    // wipe it so it can't leak into the next account.
    if (window.localStorage.getItem(LEGACY_KEY)) {
      try { window.localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
    }
    const current = loadRecentLeads(userId).filter(r => r.id !== entry.id);
    const next: RecentLead[] = [{ ...entry, visitedAt: Date.now() }, ...current].slice(0, MAX);
    window.localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("growth:recent-leads-changed"));
  } catch { /* quota / private mode */ }
}

export function clearRecentLeads(userId: string | null | undefined) {
  if (typeof window === "undefined") return;
  const key = storageKey(userId);
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
    window.dispatchEvent(new CustomEvent("growth:recent-leads-changed"));
  } catch { /* ignore */ }
}
