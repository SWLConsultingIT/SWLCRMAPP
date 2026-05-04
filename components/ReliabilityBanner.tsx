import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { C } from "@/lib/design";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";

// Persistent banner shown at the top of the dashboard whenever the outgoing
// pipeline is unhealthy: failed messages, anything stuck in `dispatching`,
// or a backlog in `queued`. Admins see this regardless of tenant; clients
// never see it (it surfaces our internal infrastructure state).
//
// Why we need it: the Pathway incident sat undetected for ~24h because the
// only signal was "Graeme isn't getting replies" — which has many possible
// causes. A banner with a one-click link to /admin/reliability collapses
// the time-to-detect to seconds.

export default async function ReliabilityBanner() {
  const scope = await getUserScope().catch(() => null);
  if (!scope || scope.role !== "admin") return null;

  const svc = getSupabaseService();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const stuckCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  // Banner fires only on PROBLEM states — failed dispatches or rows stuck
  // mid-dispatch. Plain "queued" is normal pipeline state (LinkedIn rate-
  // limit cooldown, calls awaiting manual click) and used to dominate the
  // banner with low-signal noise that overlapped with the Needs-Attention
  // card below. If something is queued normally, the user already sees it
  // in the dashboard's call/queue widgets — no need for a duplicate alert.
  const [failed, dispatching] = await Promise.all([
    svc.from("campaign_messages").select("id", { count: "exact", head: true })
      .eq("status", "failed").gte("created_at", since24h),
    svc.from("campaign_messages").select("id", { count: "exact", head: true })
      .eq("status", "dispatching").lt("created_at", stuckCutoff),
  ]);

  const failedCount = failed.count ?? 0;
  const stuckCount = dispatching.count ?? 0;

  if (failedCount === 0 && stuckCount === 0) return null;

  const parts: string[] = [];
  if (failedCount > 0) parts.push(`${failedCount} failed`);
  if (stuckCount > 0) parts.push(`${stuckCount} stuck dispatching`);

  // Always alert color now — banner only shows for actual problems.
  const accent = C.red;
  const bg = C.redLight;

  return (
    <Link
      href="/admin/reliability"
      className="flex items-center justify-between rounded-xl border px-4 py-2.5 mb-4 transition-[opacity,transform,box-shadow,background-color,border-color]"
      style={{ backgroundColor: bg, borderColor: accent + "30" }}
    >
      <div className="flex items-center gap-2.5">
        <AlertTriangle size={14} style={{ color: accent }} />
        <span className="text-sm font-medium" style={{ color: accent }}>
          Outgoing pipeline: {parts.join(" · ")}
        </span>
      </div>
      <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: accent }}>
        Open Reliability
        <ArrowRight size={11} />
      </span>
    </Link>
  );
}
