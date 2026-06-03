"use client";

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Bell, AtSign, Tag, MessageSquare, CheckCheck, FileText } from "lucide-react";
import { C } from "@/lib/design";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { useAuthUser } from "@/lib/auth-context";

// Personal notification center in the TopHeader: @mentions, lead tags and (later)
// chat messages. Recipient-scoped feed from /api/notifications, with a live
// unread badge driven by Supabase Realtime on the notifications table (RLS only
// delivers the current user's rows). Distinct from TodayPlanPopover, which
// surfaces task/queue state rather than person-to-person pings.

type Notif = {
  id: string;
  type: "mention" | "tag" | "note" | "message";
  actor_name: string | null;
  lead_id: string | null;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

const ICON: Record<Notif["type"], typeof AtSign> = {
  mention: AtSign,
  tag: Tag,
  message: MessageSquare,
  note: FileText,
};
const COLOR: Record<Notif["type"], string> = {
  mention: "var(--brand, #c9a83a)",
  tag: "#7C3AED",
  message: "#2563EB",
  note: "#0D9488",
};

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function NotificationBell() {
  const router = useRouter();
  const user = useAuthUser();
  const userId = user?.id ?? null;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const unread = items.filter(n => !n.read_at).length;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) return;
      const d = await res.json();
      setItems(d.notifications ?? []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live updates: a new notification row for me → refetch. RLS scopes delivery
  // to recipient_user_id = auth.uid(), and the explicit filter trims traffic.
  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabaseBrowser();
    const channel = supabase
      .channel(`notif-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_user_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, load]);

  useLayoutEffect(() => {
    if (!open) return;
    function position() {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      setAnchor({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
    position();
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => { window.removeEventListener("scroll", position, true); window.removeEventListener("resize", position); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    load();
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [open, load]);

  async function markAllRead() {
    setItems(prev => prev.map(n => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    try { await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) }); } catch { /* ignore */ }
  }

  async function openNotif(n: Notif) {
    setOpen(false);
    if (!n.read_at) {
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x));
      fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [n.id] }) }).catch(() => {});
    }
    if (n.link) router.push(n.link);
  }

  const panel = (
    <>
      <div className="fixed inset-0 z-[9998]" style={{ backgroundColor: "rgba(15,23,42,0.18)" }} onClick={() => setOpen(false)} aria-hidden />
      <div
        className="fixed rounded-xl border z-[9999] w-80 overflow-hidden"
        style={{ top: anchor?.top ?? 0, right: anchor?.right ?? 0, backgroundColor: C.card, borderColor: C.border, boxShadow: "0 24px 56px -20px rgba(0,0,0,0.35), 0 4px 12px -4px rgba(0,0,0,0.08)" }}
      >
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b" style={{ borderColor: C.border }}>
          <p className="text-xs font-bold" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
            {unread === 0 ? "Notifications" : `${unread} unread`}
          </p>
          {unread > 0 && (
            <button onClick={markAllRead} className="inline-flex items-center gap-1 text-[10px] font-semibold transition-opacity hover:opacity-70" style={{ color: "var(--brand, #c9a83a)" }}>
              <CheckCheck size={11} /> Mark all read
            </button>
          )}
        </div>
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Bell size={18} className="mx-auto mb-1.5" style={{ color: C.textDim }} />
            <p className="text-[11px]" style={{ color: C.textMuted }}>Nothing yet.</p>
          </div>
        ) : (
          <div className="max-h-[380px] overflow-y-auto py-1">
            {items.map(n => {
              const Icon = ICON[n.type] ?? Bell;
              const color = COLOR[n.type] ?? C.textMuted;
              return (
                <button key={n.id} onClick={() => openNotif(n)}
                  className="w-full flex items-start gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-black/[0.04]"
                  style={{ backgroundColor: n.read_at ? "transparent" : "color-mix(in srgb, var(--brand, #c9a83a) 6%, transparent)" }}>
                  <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
                    <Icon size={13} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs leading-snug" style={{ color: C.textPrimary }}>
                      {n.actor_name && <span className="font-semibold">{n.actor_name}</span>} <span style={{ color: C.textBody }}>{n.body}</span>
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: C.textDim }}>{ago(n.created_at)} ago</p>
                  </div>
                  {!n.read_at && <span className="w-2 h-2 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: "var(--brand, #c9a83a)" }} />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        title="Notifications"
        aria-label="Notifications"
        className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-gray-100 relative"
        style={{ color: C.textMuted }}
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full flex items-center justify-center text-[9px] font-bold"
            style={{ backgroundColor: C.red, color: "#fff" }}>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && typeof document !== "undefined" && createPortal(panel, document.body)}
    </>
  );
}
