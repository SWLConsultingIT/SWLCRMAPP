"use client";

import { useEffect, useState, useMemo } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { C } from "@/lib/design";
import { Activity, Clock, Circle } from "lucide-react";

type ApiUser = {
  id: string;
  email: string;
  name: string;
  role: string | null;
  company_name: string | null;
  last_seen_at: string | null;
  last_sign_in_at: string | null;
};

type PresenceMeta = {
  user_id: string;
  name: string;
  online_at: string;
};

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
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ActivityWidget() {
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [presenceIds, setPresenceIds] = useState<Set<string>>(new Set());
  const [meId, setMeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch the user list (last_seen_at + display info) — admin-only API.
  // Refresh every 30s so "Recent" bucket stays current without a Realtime
  // hop for every heartbeat.
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/admin/active-users", { cache: "no-store" });
        if (!res.ok) return;
        const { users } = await res.json();
        if (alive) setUsers(users);
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Realtime Presence — every authenticated user joining this channel shows
  // up immediately in the "In app right now" bucket and disappears when they
  // close the tab. Zero polling.
  useEffect(() => {
    const sb = getSupabaseBrowser();
    let channel: ReturnType<typeof sb.channel> | null = null;

    sb.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setMeId(user.id);
      channel = sb.channel(PRESENCE_CHANNEL, {
        config: { presence: { key: user.id } },
      });
      channel.on("presence", { event: "sync" }, () => {
        const state = channel!.presenceState() as Record<string, PresenceMeta[]>;
        const ids = new Set<string>();
        for (const key of Object.keys(state)) ids.add(key);
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

    return () => { if (channel) sb.removeChannel(channel); };
  }, []);

  const buckets = useMemo(() => {
    const now = Date.now();
    const live: ApiUser[] = [];
    const recent: ApiUser[] = [];
    const idle: ApiUser[] = [];
    for (const u of users) {
      if (presenceIds.has(u.id)) {
        live.push(u);
        continue;
      }
      const lastMs = u.last_seen_at ? new Date(u.last_seen_at).getTime() : 0;
      const minsAgo = lastMs ? (now - lastMs) / 60000 : Infinity;
      if (minsAgo < 60) recent.push(u);
      else idle.push(u);
    }
    return { live, recent, idle };
  }, [users, presenceIds]);

  if (loading) {
    return (
      <div className="rounded-2xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-center gap-2 mb-3">
          <Activity size={14} style={{ color: C.gold }} />
          <h3 className="text-[13px] font-semibold" style={{ color: C.textPrimary }}>Activity</h3>
        </div>
        <p className="text-[11px]" style={{ color: C.textMuted }}>Loading…</p>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border p-5"
      style={{ backgroundColor: C.card, borderColor: C.border }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity size={14} style={{ color: C.gold }} />
          <h3 className="text-[13px] font-semibold" style={{ color: C.textPrimary }}>Activity</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ backgroundColor: "#22C55E" }} />
          <span className="text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: C.green }}>
            Live
          </span>
        </div>
      </div>

      <Bucket
        label={`In app now · ${buckets.live.length}`}
        accent="#22C55E"
        accentBg="#ECFDF5"
        users={buckets.live}
        emptyText="Nobody is in the app right now."
        meId={meId}
        timestampField="presence"
      />

      <div className="h-px my-3" style={{ backgroundColor: C.border }} />

      <Bucket
        label={`Recent · ${buckets.recent.length}`}
        accent="#D97706"
        accentBg="#FFFBEB"
        users={buckets.recent}
        emptyText="No-one active in the last hour."
        meId={meId}
        timestampField="seen"
      />

      {buckets.idle.length > 0 && (
        <>
          <div className="h-px my-3" style={{ backgroundColor: C.border }} />
          <Bucket
            label={`Idle · ${buckets.idle.length}`}
            accent={C.textDim}
            accentBg={C.bg}
            users={buckets.idle}
            emptyText=""
            meId={meId}
            timestampField="seen"
          />
        </>
      )}
    </div>
  );
}

function Bucket({ label, accent, accentBg, users, emptyText, meId, timestampField }: {
  label: string;
  accent: string;
  accentBg: string;
  users: ApiUser[];
  emptyText: string;
  meId: string | null;
  timestampField: "presence" | "seen";
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Circle size={6} fill={accent} stroke={accent} />
        <span className="text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: accent }}>
          {label}
        </span>
      </div>
      {users.length === 0 ? (
        emptyText && <p className="text-[11px] pl-3.5" style={{ color: C.textMuted }}>{emptyText}</p>
      ) : (
        <ul className="space-y-1.5 pl-3.5">
          {users.map(u => (
            <li key={u.id} className="flex items-center gap-2.5">
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                style={{ backgroundColor: accentBg, color: accent, border: `1px solid ${accent}33` }}
              >
                {initials(u.name)}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium truncate" style={{ color: C.textPrimary }}>
                  {u.name}
                  {meId === u.id && <span className="ml-1.5 text-[10px]" style={{ color: C.textDim }}>(you)</span>}
                </p>
                <div className="flex items-center gap-1.5 text-[10px]" style={{ color: C.textMuted }}>
                  {u.company_name && <span className="truncate">{u.company_name}</span>}
                  {u.role && <span style={{ color: C.textDim }}>· {u.role}</span>}
                </div>
              </div>
              <span className="text-[10px] flex items-center gap-1 shrink-0" style={{ color: C.textDim }}>
                <Clock size={9} />
                {timestampField === "presence" ? "now" : timeAgo(u.last_seen_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
