"use client";

// Full Notifications Center (P2a) — the professional home for everything that
// pings the user: mentions, tags, notes, requests and activity reminders. Goes
// beyond the header bell: grouped by day, All/Unread + type filters, mark-all,
// pagination, live updates, deep-links. Reads the same /api/notifications feed.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { useAuthUser } from "@/lib/auth-context";
import PushToggle from "@/components/PushToggle";
import { Bell, AtSign, Tag, MessageSquare, FileText, CalendarClock, Inbox as InboxIcon, CheckCheck, CircleDot } from "lucide-react";

type Notif = {
  id: string;
  type: string;
  actor_name: string | null;
  lead_id: string | null;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

const ICON: Record<string, typeof AtSign> = {
  mention: AtSign, tag: Tag, message: MessageSquare, note: FileText, request: InboxIcon, activity_reminder: CalendarClock,
};
const COLOR: Record<string, string> = {
  mention: "var(--brand, #c9a83a)", tag: "#7C3AED", message: "#2563EB", note: "#0D9488", request: "#D97706", activity_reminder: "var(--brand, #c9a83a)",
};
const TYPES = ["mention", "tag", "note", "message", "request", "activity_reminder"] as const;

function dayBucket(iso: string): "today" | "yesterday" | "earlier" {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startToday) return "today";
  if (t >= startToday - 86400000) return "yesterday";
  return "earlier";
}

export default function NotificationsCenter() {
  const { t, locale } = useLocale();
  const router = useRouter();
  const user = useAuthUser();
  const userId = user?.id ?? null;

  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const loadingMore = useRef(false);

  const buildUrl = useCallback((before?: string | null) => {
    const p = new URLSearchParams({ limit: "30" });
    if (onlyUnread) p.set("unread", "1");
    if (typeFilter) p.set("type", typeFilter);
    if (before) p.set("before", before);
    return `/api/notifications?${p.toString()}`;
  }, [onlyUnread, typeFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(buildUrl(), { cache: "no-store" });
      const d = await r.json();
      setItems(d.notifications ?? []);
      setUnread(d.unread ?? 0);
      setNextBefore(d.nextBefore ?? null);
    } catch { /* keep */ }
    setLoading(false);
  }, [buildUrl]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabaseBrowser();
    const channel = supabase
      .channel(`notif-center-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_user_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, load]);

  async function loadMore() {
    if (!nextBefore || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const r = await fetch(buildUrl(nextBefore), { cache: "no-store" });
      const d = await r.json();
      setItems(prev => [...prev, ...(d.notifications ?? [])]);
      setNextBefore(d.nextBefore ?? null);
    } catch { /* keep */ }
    loadingMore.current = false;
  }

  async function markAll() {
    setItems(prev => prev.map(n => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    setUnread(0);
    try { await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) }); } catch { /* ignore */ }
  }

  function openNotif(n: Notif) {
    if (!n.read_at) {
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x));
      setUnread(u => Math.max(0, u - 1));
      fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [n.id] }) }).catch(() => {});
    }
    if (n.link) router.push(n.link);
  }

  const intlLocale = locale === "es" ? "es-AR" : "en-US";
  const fmt = (iso: string) => new Date(iso).toLocaleString(intlLocale, { hour: "2-digit", minute: "2-digit" });
  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(intlLocale, { day: "2-digit", month: "short" });

  const groups = useMemo(() => {
    const g: Record<"today" | "yesterday" | "earlier", Notif[]> = { today: [], yesterday: [], earlier: [] };
    for (const n of items) g[dayBucket(n.created_at)].push(n);
    return g;
  }, [items]);

  const chip = (active: boolean) => ({
    background: active ? "var(--brand, #c9a83a)" : C.card,
    color: active ? "#1a1205" : C.textMuted,
    border: `1px solid ${active ? "var(--brand, #c9a83a)" : C.border}`,
  });

  function Row({ n }: { n: Notif }) {
    const Icon = ICON[n.type] ?? Bell;
    const color = COLOR[n.type] ?? C.textMuted;
    return (
      <button onClick={() => openNotif(n)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-black/[0.03]"
        style={{ backgroundColor: n.read_at ? "transparent" : "color-mix(in srgb, var(--brand, #c9a83a) 6%, transparent)" }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
          <Icon size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: C.surface, color: C.textMuted }}>{t(`notif.type.${n.type}`)}</span>
            <span className="text-[10px]" style={{ color: C.textDim }}>{fmtDay(n.created_at)} · {fmt(n.created_at)}</span>
          </div>
          <p className="text-[13px] leading-snug mt-1" style={{ color: C.textPrimary }}>
            {n.actor_name && <span className="font-semibold">{n.actor_name} </span>}
            <span style={{ color: C.textBody }}>{n.body}</span>
          </p>
        </div>
        {!n.read_at && <CircleDot size={13} className="shrink-0 mt-1" style={{ color: "var(--brand, #c9a83a)" }} />}
      </button>
    );
  }

  const order: Array<"today" | "yesterday" | "earlier"> = ["today", "yesterday", "earlier"];

  return (
    <div className="w-full max-w-2xl">
      {/* Browser push opt-in (P2b) — self-hides when unsupported/unconfigured. */}
      <PushToggle />

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <button onClick={() => setOnlyUnread(false)} className="rounded-lg px-3 py-1.5 text-[12px] font-bold" style={chip(!onlyUnread)}>{t("notif.all")}</button>
        <button onClick={() => setOnlyUnread(true)} className="rounded-lg px-3 py-1.5 text-[12px] font-bold" style={chip(onlyUnread)}>
          {t("notif.unread")}{unread > 0 ? ` · ${unread}` : ""}
        </button>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="rounded-lg px-3 py-1.5 text-xs" style={{ color: C.textPrimary, backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <option value="">{t("notif.filter.type")}</option>
          {TYPES.map(ty => <option key={ty} value={ty}>{t(`notif.type.${ty}`)}</option>)}
        </select>
        {unread > 0 && (
          <button onClick={markAll} className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-semibold transition-opacity hover:opacity-70" style={{ color: "var(--brand, #c9a83a)" }}>
            <CheckCheck size={14} /> {t("notif.markAll")}
          </button>
        )}
      </div>

      {!loading && items.length === 0 && (
        <div className="rounded-2xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <Bell size={22} className="mx-auto mb-2" style={{ color: C.textDim }} />
          <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{t("notif.empty")}</p>
        </div>
      )}

      {order.map(bucket => {
        const rows = groups[bucket];
        if (rows.length === 0) return null;
        return (
          <div key={bucket} className="mb-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] mb-2" style={{ color: C.textMuted }}>{t(`notif.group.${bucket}`)}</p>
            <div className="rounded-2xl border overflow-hidden divide-y" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: C.shadow, ["--tw-divide-opacity" as string]: 1 }}>
              {rows.map(n => <Row key={n.id} n={n} />)}
            </div>
          </div>
        );
      })}

      {nextBefore && (
        <div className="text-center mt-2">
          <button onClick={loadMore} className="rounded-lg px-4 py-2 text-[12px] font-semibold" style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textMuted }}>
            {t("notif.loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}
