"use client";

import { useEffect, useState, useMemo } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { C } from "@/lib/design";
import { Phone, Clock, Users, PhoneCall } from "lucide-react";

const gold = "var(--brand, #c9a83a)";

type SellerInput = {
  id: string;
  name: string;
  userId: string | null;
  lastSeenAt: string | null;
  lastCallAt: string | null;
  callsToday: number;
  callsPeriod: number;
  pendingCalls: number;
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

export default function SellerPulseTable({ sellers, periodLabel, dailyTarget = 5 }: { sellers: SellerInput[]; periodLabel?: string; dailyTarget?: number }) {
  const [presenceIds, setPresenceIds] = useState<Set<string>>(new Set());
  const [meId, setMeId]              = useState<string | null>(null);

  // Join the Realtime Presence channel (same as ActivityWidget)
  useEffect(() => {
    const sb = getSupabaseBrowser();
    let channel: ReturnType<typeof sb.channel> | null = null;

    sb.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setMeId(user.id);
      channel = sb.channel(PRESENCE_CHANNEL, { config: { presence: { key: user.id } } });
      channel.on("presence", { event: "sync" }, () => {
        const state = channel!.presenceState() as Record<string, PresenceMeta[]>;
        setPresenceIds(new Set(Object.keys(state)));
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

  const rows = useMemo(() => {
    const statusOrder: StatusKind[] = ["live", "recent", "idle", "offline"];
    return sellers
      .map(s => {
        const isLive = !!s.userId && presenceIds.has(s.userId);
        const status = getStatus(s.lastSeenAt, isLive);
        return { ...s, status, isMe: s.userId === meId };
      })
      .sort((a, b) => {
        const so = statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
        if (so !== 0) return so;
        return b.callsToday - a.callsToday;
      });
  }, [sellers, presenceIds, meId]);

  const { activeSellers, onTrack } = useMemo(() => {
    const active = rows.filter(r => r.status === "live" || r.status === "recent");
    const on = active.filter(r => r.callsToday >= dailyTarget).length;
    return { activeSellers: active.length, onTrack: on };
  }, [rows, dailyTarget]);

  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{
        backgroundColor: C.card,
        borderColor: `color-mix(in srgb, ${gold} 22%, ${C.border})`,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px color-mix(in srgb, var(--brand,#c9a83a) 7%, transparent), 0 16px 34px -20px color-mix(in srgb, var(--brand,#c9a83a) 38%, transparent)",
      }}
    >
      {/* Header */}
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
            <span className="flex items-center gap-1 ml-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#22C55E", boxShadow: "0 0 0 2px rgba(34,197,94,0.3)", animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite" }} />
              <span className="text-[9.5px] font-bold uppercase tracking-[0.14em]" style={{ color: "#22C55E" }}>Live</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {activeSellers > 0 ? (
              <>
                <span className="text-[11px] font-semibold" style={{ color: onTrack === activeSellers ? "#22C55E" : onTrack > 0 ? "#C9A83A" : "#EF4444" }}>
                  {onTrack}/{activeSellers} active sellers on track
                </span>
                <span className="text-[11px]" style={{ color: "#8B9EB7" }}>· goal: {dailyTarget}+ calls/day</span>
              </>
            ) : (
              <span className="text-[11px]" style={{ color: "#8B9EB7" }}>Last login · last call · calls today · calls this period · queue</span>
            )}
          </div>
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
            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Last call</th>
            <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Today</th>
            <th className="px-3 py-2 text-right font-semibold whitespace-nowrap" title={periodLabel ? `Calls in ${periodLabel}` : undefined}>Period</th>
            <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">In queue</th>
          </tr>
        </thead>
        <tbody>
          {sellers.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-xs" style={{ color: C.textMuted }}>
                No sellers found.
              </td>
            </tr>
          ) : rows.map(row => {
            const cfg = STATUS_CONFIG[row.status];
            const isActive = row.status === "live" || row.status === "recent";
            const hitGoal = row.callsToday >= dailyTarget;
            const noCallsAlert = row.callsToday === 0 && isActive;
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
                      {row.status === "live" ? "now" : timeAgo(row.lastSeenAt)}
                    </span>
                  </div>
                </td>

                {/* Last call */}
                <td className="px-3 py-3">
                  {row.lastCallAt ? (
                    <div className="flex items-center gap-1.5" style={{ color: C.textMuted }}>
                      <PhoneCall size={10} />
                      <span className="text-[11px]">{timeAgo(row.lastCallAt + "T12:00:00Z")}</span>
                    </div>
                  ) : (
                    <span className="text-[11px]" style={{ color: C.textDim }}>—</span>
                  )}
                </td>

                {/* Calls today */}
                <td className="px-3 py-3 text-right">
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center justify-end gap-1.5">
                      {noCallsAlert && (
                        <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: "rgba(239,68,68,0.12)", color: "#EF4444" }}>
                          ⚠
                        </span>
                      )}
                      <span
                        className="text-[13px] font-bold tabular-nums"
                        style={{ color: hitGoal ? "#22C55E" : noCallsAlert ? "#EF4444" : C.textPrimary }}>
                        {row.callsToday}
                        {hitGoal && <span className="text-[10px] ml-0.5">✓</span>}
                      </span>
                      <Phone size={10} style={{ color: hitGoal ? "#22C55E" : noCallsAlert ? "#EF4444" : C.textMuted }} />
                    </div>
                    {isActive && (
                      <div className="w-10 h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: "rgba(255,255,255,0.08)" }}>
                        <div className="h-full rounded-full" style={{
                          width: `${Math.min(100, Math.round((row.callsToday / dailyTarget) * 100))}%`,
                          backgroundColor: hitGoal ? "#22C55E" : row.callsToday > 0 ? "#C9A83A" : "#EF4444",
                        }} />
                      </div>
                    )}
                  </div>
                </td>

                {/* Calls in the selected period (matches the "Calls by user" table) */}
                <td className="px-3 py-3 text-right">
                  <span className="text-[12px] font-semibold tabular-nums" style={{ color: row.callsPeriod > 0 ? C.textBody : C.textDim }}>
                    {row.callsPeriod > 0 ? row.callsPeriod : "—"}
                  </span>
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
