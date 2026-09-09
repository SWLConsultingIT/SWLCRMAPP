"use client";

// Browser push opt-in toggle (P2b). Registers the service worker, subscribes
// via the PushManager with the server's VAPID public key, and stores the
// subscription. Renders nothing when the browser doesn't support push or push
// isn't configured server-side, so it never shows a dead control.

import { useEffect, useState } from "react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { BellRing, BellOff } from "lucide-react";

const gold = "var(--brand, #c9a83a)";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "loading" | "unsupported" | "unconfigured" | "off" | "on" | "blocked" | "busy";

export default function PushToggle() {
  const { t } = useLocale();
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setState("unsupported");
        return;
      }
      try {
        const res = await fetch("/api/push/public-key", { cache: "no-store" });
        const d = await res.json();
        if (!d?.configured || !d?.key) { if (!cancelled) setState("unconfigured"); return; }
        if (Notification.permission === "denied") { if (!cancelled) setState("blocked"); return; }
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setState(sub ? "on" : "off");
      } catch {
        if (!cancelled) setState("unsupported");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function enable() {
    setState("busy");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "blocked" : "off"); return; }
      const keyRes = await fetch("/api/push/public-key", { cache: "no-store" });
      const { key } = await keyRes.json();
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      setState("on");
    } catch {
      setState("off");
    }
  }

  async function disable() {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setState("on");
    }
  }

  // Nothing to show when unsupported/unconfigured — no dead control.
  if (state === "loading" || state === "unsupported" || state === "unconfigured") return null;

  return (
    <div className="flex items-center gap-3 rounded-xl border px-3.5 py-2.5 mb-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{ background: `color-mix(in srgb, ${gold} 12%, transparent)`, color: gold }}>
        {state === "on" ? <BellRing size={15} /> : <BellOff size={15} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold" style={{ color: C.textPrimary }}>{t("notif.push.title")}</p>
        <p className="text-[11px]" style={{ color: C.textMuted }}>
          {state === "blocked" ? t("notif.push.blocked") : state === "on" ? t("notif.push.enabled") : t("notif.push.hint")}
        </p>
      </div>
      {state !== "blocked" && (
        <button
          onClick={state === "on" ? disable : enable}
          disabled={state === "busy"}
          className="rounded-lg px-3 py-1.5 text-[12px] font-bold shrink-0"
          style={state === "on"
            ? { background: C.surface, color: C.textMuted, border: `1px solid ${C.border}` }
            : { background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 80%, white))`, color: "#1a1205" }}
        >
          {state === "on" ? t("notif.push.disable") : t("notif.push.enable")}
        </button>
      )}
    </div>
  );
}
