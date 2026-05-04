import { getSupabaseService } from "@/lib/supabase-service";
import { C } from "@/lib/design";

// Read-only team view for Phase 1. Lists every user_profile in the tenant
// with name (from auth.users via admin endpoint), email, tier badge, and
// last_seen_at. Invite + role-change actions land in Phase 3 once the
// `/api/team/*` endpoints exist; until then `canManage` is unused on the
// server but kept on the prop signature so the wiring is ready.

type Props = {
  companyBioId: string;
  canManage: boolean;
};

type TeamRow = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  tier: string;
  role: string;
  last_seen_at: string | null;
  created_at: string;
};

async function fetchTeam(companyBioId: string): Promise<TeamRow[]> {
  const svc = getSupabaseService();
  const { data: profiles } = await svc
    .from("user_profiles")
    .select("user_id, role, tier, last_seen_at, created_at")
    .eq("company_bio_id", companyBioId)
    .order("created_at", { ascending: true });

  if (!profiles || profiles.length === 0) return [];

  // Pull auth user records for emails + display names. Done via the admin
  // endpoint so we get email even when the user hasn't set a profile name.
  const rows: TeamRow[] = [];
  for (const p of profiles) {
    let email: string | null = null;
    let displayName: string | null = null;
    try {
      const { data: u } = await svc.auth.admin.getUserById(p.user_id);
      email = u?.user?.email ?? null;
      const meta = u?.user?.user_metadata ?? {};
      displayName = (meta.full_name as string | undefined)
        ?? (meta.display_name as string | undefined)
        ?? (meta.name as string | undefined)
        ?? null;
    } catch {
      // Ignore — orphan profile rows shouldn't crash the whole view.
    }
    rows.push({
      user_id: p.user_id,
      email,
      display_name: displayName,
      tier: p.tier ?? "viewer",
      role: p.role ?? "client",
      last_seen_at: p.last_seen_at,
      created_at: p.created_at,
    });
  }
  return rows;
}

const TIER_LABELS: Record<string, { label: string; color: string }> = {
  super_admin: { label: "Super Admin", color: "#9333EA" },
  owner: { label: "Owner", color: "#C9A83A" },
  manager: { label: "Manager", color: "#3B82F6" },
  seller: { label: "Seller", color: "#10B981" },
  viewer: { label: "Viewer", color: "#6B7280" },
};

function formatLastSeen(iso: string | null): string {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function initials(name: string | null, email: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
  }
  if (email) return email[0]?.toUpperCase() ?? "?";
  return "?";
}

export default async function TenantTeamTab({ companyBioId, canManage }: Props) {
  const team = await fetchTeam(companyBioId);

  return (
    <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Team</p>
          <p className="text-sm" style={{ color: C.textPrimary }}>{team.length} {team.length === 1 ? "member" : "members"}</p>
        </div>
        {canManage && (
          <button
            disabled
            title="Coming in Phase 3"
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.bg }}
          >
            + Invite user (soon)
          </button>
        )}
      </div>

      {team.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm" style={{ color: C.textMuted }}>
          No team members yet.
        </div>
      ) : (
        <ul>
          {team.map(m => {
            const t = TIER_LABELS[m.tier] ?? TIER_LABELS.viewer;
            return (
              <li key={m.user_id} className="px-5 py-3 flex items-center gap-3 border-t" style={{ borderColor: C.border }}>
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ background: `linear-gradient(135deg, ${t.color}, color-mix(in srgb, ${t.color} 65%, white))`, color: "#fff" }}
                >
                  {initials(m.display_name, m.email)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: C.textPrimary }}>
                    {m.display_name ?? m.email ?? "(unknown)"}
                  </p>
                  {m.email && m.display_name && (
                    <p className="text-[11px] truncate" style={{ color: C.textMuted }}>{m.email}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                    style={{ backgroundColor: `${t.color}18`, color: t.color }}
                  >
                    {t.label}
                  </span>
                  <span className="text-[11px] tabular-nums" style={{ color: C.textDim }}>
                    {formatLastSeen(m.last_seen_at)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
