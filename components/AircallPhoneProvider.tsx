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
  dial: (phoneNumber: string, leadId?: string | null, fromNumberId?: number | null) => Promise<{ ok: boolean; error?: string }>;
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

  const dial = useCallback<Ctx["dial"]>(async (phoneNumber, leadId, fromNumberId) => {
    if (!sdkRef.current) return { ok: false, error: "SDK not ready" };
    setIsOpen(true);
    setCurrentCall({
      callId: null,
      phoneNumber,
      leadId: leadId ?? null,
      state: "dialing",
      startedAt: Date.now(),
    });
    // Payload kitchen-sink experiment 2026-06-01: the SDK docs only mention
    // `phone_number`, but the SDK source just forwards `value` to the
    // workspace iframe via postMessage — so any extra keys are passed
    // through transparently. Throw the most likely names at the wall so
    // that if Aircall's workspace honours any of them, we skip both the
    // "Start conversation from" picker AND the confirm-to-dial screen.
    // The phone_number key is the only required one; everything else is
    // best-effort and silently ignored by older workspace builds.
    const payload: Record<string, unknown> = { phone_number: phoneNumber };
    if (fromNumberId != null) {
      payload.from_number_id = fromNumberId;
      payload.outbound_number_id = fromNumberId;
      payload.number_id = fromNumberId;
    }
    payload.auto_call = true;
    payload.dial_immediately = true;
    payload.direct_dial = true;

    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      sdkRef.current!.send("dial_number", payload, (success, data) => {
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
          (#aircall-iframe-target) for the SDK to mount into. Iframe stays
          mounted permanently — we toggle visibility on the wrapper so the
          login + warm-up cost only happens once per session. */}
      <div
        aria-hidden={!isOpen}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          pointerEvents: isOpen ? "auto" : "none",
          opacity: isOpen ? 1 : 0,
          transition: "opacity 200ms cubic-bezier(0.16, 1, 0.3, 1)",
          background: "rgba(8, 12, 28, 0.55)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
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
            width: 460,
            maxWidth: "100%",
            background: "var(--c-card, #ffffff)",
            borderRadius: 20,
            boxShadow: "0 30px 80px -10px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.06)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            transform: isOpen ? "translateY(0) scale(1)" : "translateY(12px) scale(0.98)",
            transition: "transform 220ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* SWL branded header — slimmer, more premium */}
          <div
            style={{
              position: "relative",
              padding: "16px 20px",
              background: `linear-gradient(135deg, var(--c-ink, #0d1224) 0%, var(--c-ink2, #161c33) 100%)`,
              overflow: "hidden",
            }}
          >
            {/* Hairline gold accent on the bottom edge — editorial detail */}
            <span aria-hidden style={{
              position: "absolute", inset: "auto 0 0 0", height: 1,
              background: `linear-gradient(90deg, transparent 0%, color-mix(in srgb, ${gold} 55%, transparent) 30%, color-mix(in srgb, ${gold} 55%, transparent) 70%, transparent 100%)`,
            }} />
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  width: 38, height: 38, borderRadius: 10,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: `linear-gradient(135deg, ${gold} 0%, color-mix(in srgb, ${gold} 70%, white) 100%)`,
                  boxShadow: `0 6px 18px color-mix(in srgb, ${gold} 36%, transparent)`,
                  color: "#0d1224",
                  flexShrink: 0,
                }}
              >
                <Phone size={17} strokeWidth={2.4} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  margin: 0, fontSize: 9.5, fontWeight: 700, textTransform: "uppercase",
                  letterSpacing: "0.22em", color: gold, fontFamily: "var(--font-outfit), system-ui, sans-serif",
                }}>SWL Phone</p>
                <p style={{
                  margin: "2px 0 0", fontSize: 14, fontWeight: 600, color: "#fff",
                  letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  textShadow: `0 1px 12px color-mix(in srgb, ${gold} 18%, transparent)`,
                }}>
                  {!isReady && "Connecting to workspace…"}
                  {isReady && !isLoggedIn && "Sign in to start calling"}
                  {isReady && isLoggedIn && !currentCall && "Ready"}
                  {currentCall?.state === "dialing" && `Dialing ${currentCall.phoneNumber}`}
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
                  width: 32, height: 32, borderRadius: 8, border: "none", cursor: "pointer",
                  background: "color-mix(in srgb, white 8%, transparent)",
                  color: "color-mix(in srgb, white 70%, transparent)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "background 140ms, color 140ms",
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "color-mix(in srgb, white 18%, transparent)";
                  e.currentTarget.style.color = "#fff";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "color-mix(in srgb, white 8%, transparent)";
                  e.currentTarget.style.color = "color-mix(in srgb, white 70%, transparent)";
                }}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Aircall iframe target — fixed size matching SDK 'big' preset (376×666) */}
          <div
            style={{
              padding: "16px 0 0",
              background: "var(--c-card, #ffffff)",
              display: "flex",
              justifyContent: "center",
            }}
          >
            <div
              id="aircall-iframe-target"
              ref={containerRef}
              style={{
                width: 376,
                height: 666,
                maxWidth: "100%",
                borderRadius: 12,
                overflow: "hidden",
                background: "#f6f7fb",
                boxShadow: "0 1px 0 rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.06)",
              }}
            />
          </div>

          <div style={{
            padding: "12px 20px 14px",
            fontSize: 10.5, color: C.textMuted, textAlign: "center",
            letterSpacing: "0.04em",
          }}>
            Audio runs through your browser · no desktop app required
          </div>
        </div>
      </div>
    </AircallContext.Provider>
  );
}
