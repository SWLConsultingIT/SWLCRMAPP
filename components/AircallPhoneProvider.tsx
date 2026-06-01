"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from "react";
import { Phone, X } from "lucide-react";
import { C } from "@/lib/design";

// Aircall Everywhere SDK — embeds the Aircall web phone inside our app via
// an iframe. The iframe stays mounted at the page root for the entire
// session so the agent only logs into Aircall once; we just show/hide the
// SWL-branded modal that wraps it. Microphone + speakers go through the
// browser (WebRTC), so the user does NOT need to have Aircall's desktop
// or mobile app open — the embed IS the phone.
//
// Why this layout (modal-on-demand instead of always-visible drawer):
// Fran 2026-06-01 didn't want a permanent phone panel in the sidebar —
// just a popup that surfaces when you click Call and disappears after
// the call ends. The hidden mount path is what keeps that snappy: we
// pay the login cost once and every subsequent call is instant.

type AircallSDK = {
  on: (event: string, cb: (data: any) => void) => void;
  send: (event: string, payload?: any, cb?: (success: boolean, data: any) => void) => void;
  isLoggedIn: (cb: (loggedIn: boolean) => void) => void;
  removeListener: (event: string, cb: (data: any) => void) => void;
};

type CallInfo = {
  callId: number | null;
  phoneNumber: string;
  leadId: string | null;
  state: "dialing" | "ringing" | "answered" | "ended";
  startedAt: number;
};

type Ctx = {
  isReady: boolean;
  isLoggedIn: boolean;
  currentCall: CallInfo | null;
  dial: (phoneNumber: string, leadId?: string | null) => Promise<{ ok: boolean; error?: string }>;
  openPhone: () => void;
  closePhone: () => void;
};

const AircallContext = createContext<Ctx | null>(null);

export function useAircallPhone(): Ctx {
  const ctx = useContext(AircallContext);
  if (!ctx) {
    throw new Error("useAircallPhone must be used inside AircallPhoneProvider");
  }
  return ctx;
}

const gold = "var(--brand, #c9a83a)";

export default function AircallPhoneProvider({ children }: { children: ReactNode }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sdkRef = useRef<AircallSDK | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [currentCall, setCurrentCall] = useState<CallInfo | null>(null);

  // Initialize the SDK once on mount. The library imports a default class —
  // dynamic import keeps it out of the SSR bundle (it touches `window` in
  // the constructor for postMessage setup).
  useEffect(() => {
    let alive = true;
    let sdk: AircallSDK | null = null;
    (async () => {
      try {
        const mod = await import("aircall-everywhere");
        const AircallWorkspace = (mod as any).default ?? mod;
        if (!alive || !containerRef.current) return;
        sdk = new AircallWorkspace({
          onLogin: () => { if (alive) setIsLoggedIn(true); },
          onLogout: () => { if (alive) setIsLoggedIn(false); },
          domToLoadWorkspace: "#aircall-iframe-target",
          size: "big",
          debug: false,
        });
        sdkRef.current = sdk;
        setIsReady(true);

        // Subscribe to call events from the workspace. We mainly care about
        // outgoing_call (capture call_id at start) and call_ended (close the
        // modal, surface the recording in the lead detail). The webhook
        // back-end keeps doing its job — these events are a faster path for
        // local UI updates so the seller doesn't wait for the cron loop.
        sdk!.on("outgoing_call", (data: any) => {
          setCurrentCall(c => c ? { ...c, callId: data?.call_id ?? null, state: "ringing" } : null);
        });
        sdk!.on("outgoing_answered", () => {
          setCurrentCall(c => c ? { ...c, state: "answered" } : null);
        });
        sdk!.on("call_ended", (_data: any) => {
          setCurrentCall(c => c ? { ...c, state: "ended" } : null);
          // Auto-close 3s after the call ends so the seller can read any
          // post-call screen if they want, then return to the CRM.
          window.setTimeout(() => {
            if (!alive) return;
            setIsOpen(false);
            setCurrentCall(null);
          }, 3000);
        });
        sdk!.on("incoming_call", () => {
          // Surface the embed on incoming so the seller can pick up
          // straight from the CRM tab.
          if (!alive) return;
          setIsOpen(true);
        });

        // Verify login state once after mount in case the SDK already had
        // a valid session (onLogin only fires on a fresh login).
        sdk!.isLoggedIn((logged: boolean) => { if (alive) setIsLoggedIn(logged); });
      } catch (e) {
        console.error("[aircall-phone] init failed:", e);
      }
    })();

    return () => {
      alive = false;
      // The SDK doesn't expose a teardown — we leak the iframe on unmount.
      // Provider sits at the root so this only fires on full page reload.
    };
  }, []);

  const dial = useCallback<Ctx["dial"]>(async (phoneNumber, leadId) => {
    if (!sdkRef.current) return { ok: false, error: "SDK not ready" };
    setIsOpen(true);
    setCurrentCall({
      callId: null,
      phoneNumber,
      leadId: leadId ?? null,
      state: "dialing",
      startedAt: Date.now(),
    });
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      sdkRef.current!.send("dial_number", { phone_number: phoneNumber }, (success, data) => {
        if (success) {
          resolve({ ok: true });
        } else {
          const errCode = (data && (data.code || data.error)) || "unknown";
          // Common error: 'not_ready' = workspace iframe loaded but agent
          // hasn't logged in yet. Keep the modal open so they can log in
          // and retry; surface the error to the caller for a toast.
          resolve({ ok: false, error: errCode });
        }
      });
    });
  }, []);

  const openPhone = useCallback(() => setIsOpen(true), []);
  const closePhone = useCallback(() => {
    setIsOpen(false);
    setCurrentCall(null);
  }, []);

  return (
    <AircallContext.Provider value={{ isReady, isLoggedIn, currentCall, dial, openPhone, closePhone }}>
      {children}

      {/* SWL-branded modal shell. The iframe lives INSIDE this DOM target
          (#aircall-iframe-target) for the SDK to mount into. We always
          keep the target rendered — toggling visibility instead of
          unmounting — so the SDK login + warm-up only happen once. */}
      <div
        aria-hidden={!isOpen}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          pointerEvents: isOpen ? "auto" : "none",
          opacity: isOpen ? 1 : 0,
          transition: "opacity 180ms ease",
          background: "rgba(0,0,0,0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        onClick={(e) => {
          // Close on backdrop click only when not in an active call —
          // we don't want a stray click to hide the phone mid-conversation.
          if (e.target === e.currentTarget && currentCall?.state !== "ringing" && currentCall?.state !== "answered") {
            closePhone();
          }
        }}
      >
        <div
          style={{
            width: 720,
            maxWidth: "92vw",
            background: "var(--c-card, #ffffff)",
            borderRadius: 16,
            boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
            border: `1px solid color-mix(in srgb, ${gold} 22%, var(--c-border, #e5e7eb))`,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* SWL branded header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 18px",
              background: `linear-gradient(135deg, var(--c-ink, #0d1224) 0%, var(--c-ink2, #161c33) 100%)`,
              borderBottom: `1px solid color-mix(in srgb, ${gold} 18%, transparent)`,
            }}
          >
            <div
              style={{
                width: 32, height: 32, borderRadius: 8,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 70%, white) 100%)`,
                color: "#0d1224",
              }}
            >
              <Phone size={16} strokeWidth={2.4} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.18em", color: gold }}>SWL Phone</p>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#fff" }}>
                {!isReady && "Loading workspace…"}
                {isReady && !isLoggedIn && "Sign in below to start calling"}
                {isReady && isLoggedIn && !currentCall && "Ready"}
                {currentCall?.state === "dialing" && `Dialing ${currentCall.phoneNumber}…`}
                {currentCall?.state === "ringing" && `Ringing ${currentCall.phoneNumber}`}
                {currentCall?.state === "answered" && `In call · ${currentCall.phoneNumber}`}
                {currentCall?.state === "ended" && "Call ended"}
              </p>
            </div>
            <button
              type="button"
              onClick={closePhone}
              aria-label="Close phone"
              style={{
                width: 30, height: 30, borderRadius: 8, border: "none", cursor: "pointer",
                background: "color-mix(in srgb, white 12%, transparent)",
                color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Aircall iframe target — SDK mounts the workspace iframe inside this div */}
          <div
            id="aircall-iframe-target"
            ref={containerRef}
            style={{
              width: "100%",
              height: 420,
              background: C.bg,
            }}
          />

          <div style={{ padding: "10px 16px", borderTop: `1px solid var(--c-border, #e5e7eb)`, fontSize: 11, color: C.textMuted }}>
            Powered by Aircall · audio runs through your browser, no app required
          </div>
        </div>
      </div>
    </AircallContext.Provider>
  );
}
