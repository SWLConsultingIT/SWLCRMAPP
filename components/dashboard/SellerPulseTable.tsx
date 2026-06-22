"use client";

// Per-seller activity monitor: last login + calls today + pending in queue.
// Server passes the seller list (already scoped to the current company).
// Client fetches /api/admin/active-users and matches by name to get last_seen_at.
// Realtime Presence shows who is in the app right now (same channel as ActivityWidget).

import { useEffect, useState, useMemo } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { C } from "@/lib/design";
import { Phone, Clock, Users } from "lucide-react";

const gold = "var(--brand, #c9a83a)";

type SellerInput = {
  id: string;
  name: string;
  callsToday: number;
  pendingCalls: number;
};

type ApiUser = {
  id: string;
  name: string;
  email: string;
  last_seen_at: string | null;
};

type PresenceMeta = { user_id: string; name: string };

const PRESENCE_CHANNEL = "swl-activity-room";

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type StatusKind = "live" | "recent" | "idle" | "offline";

function getStatus(lastSeenAt: string | null, isLive: boolean): StatusKind {
  if (isLive) return "live";
  if (!lastSeenAt) return "offline";
  const minsAgo = (Date.now() - new Date(lastSeenAt).getTime()) / 60000;
  if (minsAgo < 60) return "recent";
  if (minsAgo < 24 * 60) return "idle";
  return "offline";
}

const STATUS_CONFIG: Record<StatusKind, { label: string; dotColor: string; textColor: string }> = {
  live:    { label: "In app now", dotColor: "#22C55E", textColor: "#22C55E" },
  recent:  { label: "Active",     dotColor: "#C9A83A", textColor: "#C9A83A" },
  idle:    { label: "Idle",       dotColor: "#6B7280", textColor: "#9CA3AF" },
  offline: { label: "Offline",    dotColor: "#EF4444", textColor: "#EF4444" },
};

export default function SellerPulseTable({ sellers }: { sellers: SellerInput[] }) {
  const [users, setUsers]         = useState<ApiUser[]>([]);
  const [presenceIds, setPresenceIds] = useState<Set<string>>(new Set());
  const [meId, setMeId]           = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);

  // Poll last_seen_at every 2 min (same cadence as ActivityWidget)
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/admin/active-users", { cache: "no-store" });
        if (!res.ok) return;
        const { users: u } = await res.json();
        if (alive) setUsers(u);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 2 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Realtime Presence — join the same channel as ActivityWidget
  useEffect(() => {
    const sb = getSupabaseBrowser();
    let channel: ReturnType<typeof sb.channel> | null = null;

    sb.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setMeId(user.id);
      channel = sb.channel(PRESENCE_CHANNEL, { config: { presence: { key: user.id } } });
      channel.on("presence", { event: "sync" }, () => {
        const state = channel!.presenceState() as Record<string, PresenceMeta[]>;
        const ids = new Set(Object.keys(state));
        setPresenceIds(ids);
      });
      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel!.track({
            user_id: user.id,
            name: user.user_metadata?.name || user.email?.split("@")[0] || "user",
            online_at: new Date().toISOString(),
          });
        }
      });
    });

    return () => { if (channel) getSupabaseBrowser().removeChannel(channel); };
  }, []);

  // Build a name→ApiUser lookup (case-insensitive) for matching sellers to users
  const userByName = useMemo(() => {
    const map = new Map<string, ApiUser>();
    for (const u of users) map.set(u.name.trim().toLowerCase(), u);
    return map;
  }, [users]);

  // Merge server sellers with client activity data, sorted: live → recent → idle → offline, then by calls desc
  const rows = useMemo(() => {
    const statusOrder: StatusKind[] = ["live", "recent", "idle", "offline"];
    return sellers
      .map(s => {
        const user = userByName.get(s.name.trim().toLowerCase()) ?? null;
        const isLive = user ? presenceIds.has(user.id) : false;
        const status = getStatus(user?.last_seen_at ?? null, isLive);
        return { ...s, user, status, isMe: user?.id === meId };
      })
      .sort((a, b) => {
        const so = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
        if (so !== 0) return so;
        return b.callsToday - a.callsToday;
      });
  }, [sellers, userByName, presenceIds, meId]);

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{
        backgroundColor: C.card,
        borderColor: `color-mix(in srgb, ${gold} 22%, ${C.border})`,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px color-mix(in srgb, var(--brand,#c9a83a) 7%, transparent), 0 16px 34px -20px color-mix(in srgb, var(--brand,#c9a83a) 38%, transparent)",
      }}
    >
      {/* Header — matches Panel gradient */}
      <div
        className="px-4 py-3 flex items-center justify-between gap-3"
        style={{ background: "linear-gradient(135deg, #0B0F1A 0%, #111827 100%)" }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Users size={13} style={{ color: gold }} />
            <p className="text-[13.5px] font-bold tracking-[-0.005em]" style={{ color: gold, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
              Seller activity
            </p>
            {/* Live pulse dot */}
            <span className="flex items-center gap-1 ml-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#22C55E", boxShadow: "0 0 0 2px rgba(34,197,94,0.3)", animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" }} />
              <span className="text-[9.5px] font-bold uppercase tracking-[0.14em]" style={{ color: "#22C55E" }}>Live</span>
            </span>
          </div>
          <p className="text-[11px] mt-0.5" style={{ color: "#8B9EB7" }}>
            Last login · calls today · queue
          </p>
        </div>
        <a href="/admin"
          className="text-[10px] font-semibold uppercase tracking-widest shrink-0 transition-opacity hover:opacity-70"
          style={{ color: gold }}>
          Team →
        </a>
      </div>

      {/* Table */}
      <table className="w-full text-sm">
        <thead>
          <tr
            className="text-[10px] uppercase tracking-wider border-b"
            style={{ color: C.textMuted, borderColor: C.border, background: "rgba(0,0,0,0.15)" }}
          >
            <th className="px-4 py-2 text-left font-semibold">Seller</th>
            <th className="px-3 py-2 text-left font-semibold">Status</th>
            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Last seen</th>
            <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Calls today</th>
            <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">In queue</th>
          </tr>
        </thead>
        <tbody>
          {sellers.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-xs" style={{ color: C.textMuted }}>
                No sellers found.
              </td>
            </tr>
          ) : loading ? (
            [...Array(sellers.length)].map((_, i) => (
              <tr key={i} className="border-t" style={{ borderColor: C.border }}>
                <td colSpan={5} className="px-4 py-3">
                  <div className="h-3 rounded animate-pulse" style={{ backgroundColor: C.border, width: "60%" }} />
                </td>
              </tr>
            ))
          ) : rows.map(row => {
            const cfg = STATUS_CONFIG[row.status];
            const noCallsAlert = row.callsToday === 0;
            return (
              <tr
                key={row.id}
                className="border-t transition-colors hover:bg-white/[0.02]"
                style={{ borderColor: C.border }}
              >
                {/* Seller */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${cfg.dotColor} 14%, transparent)`,
                        color: cfg.dotColor,
                        border: `1px solid color-mix(in srgb, ${cfg.dotColor} 28%, transparent)`,
                      }}>
                      {initials(row.name)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-semibold truncate leading-tight" style={{ color: C.textPrimary }}>
                        {row.name}
                        {row.isMe && <span className="ml-1.5 text-[9.5px] font-normal" style={{ color: C.textDim }}>(you)</span>}
                      </p>
                    </div>
                  </div>
                </td>

                {/* Status */}
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        backgroundColor: cfg.dotColor,
                        boxShadow: row.status === "live" ? `0 0 0 3px color-mix(in srgb, ${cfg.dotColor} 25%, transparent)` : undefined,
                      }}
                    />
                    <span className="text-[11px] font-medium" style={{ color: cfg.textColor }}>
                      {cfg.label}
                    </span>
                  </div>
                </td>

                {/* Last seen */}
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5" style={{ color: C.textMuted }}>
                    <Clock size={10} />
                    <span className="text-[11px]">
                      {row.status === "live" ? "now" : timeAgo(row.user?.last_seen_at ?? null)}
                    </span>
                  </div>
                </td>

                {/* Calls today */}
                <td className="px-3 py-3 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {noCallsAlert && (
                      <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(239,68,68,0.12)", color: "#EF4444" }}>
                        ⚠
                      </span>
                    )}
                    <span
                      className="text-[13px] font-bold tabular-nums"
                      style={{ color: noCallsAlert ? "#EF4444" : C.textPrimary }}>
                      {row.callsToday}
                    </span>
                    <Phone size={10} style={{ color: noCallsAlert ? "#EF4444" : C.textMuted }} />
                  </div>
                </td>

                {/* In queue */}
                <td className="px-3 py-3 text-right">
                  <span className="text-[12px] tabular-nums" style={{ color: row.pendingCalls > 0 ? C.textBody : C.textDim }}>
                    {row.pendingCalls > 0 ? row.pendingCalls : "—"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
