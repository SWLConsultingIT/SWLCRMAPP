"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, AlertOctagon, Info as InfoIcon, X } from "lucide-react";

// Lightweight toast system. Replaces every native `alert()` so error/success
// surfaces stop blocking the page and stop feeling cheap. One ToastProvider in
// AppShell, hook `useToast()` anywhere underneath.
//
// Why no library: the app already has too many primitives floating around; a
// single 100-line file avoids another dep + version churn. If we ever need
// stacking-by-id, undo actions, or queue limits, we revisit.

export type ToastKind = "success" | "error" | "warning" | "info";

export type ToastInput = {
  kind?: ToastKind;
  title?: string;
  description?: string;
  /** ms to auto-dismiss. Default 4500. Set to 0 to require manual dismiss. */
  duration?: number;
  /** Inline action button — e.g. {label: "Undo", onClick: ...}. The toast
   *  closes itself after the action runs (also auto-dismisses on timeout). */
  action?: { label: string; onClick: () => void };
};

type ToastItem = Required<Omit<ToastInput, "duration" | "action">> & {
  id: string;
  duration: number;
  action: ToastInput["action"];
};

type ToastCtx = {
  show: (t: ToastInput) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

let counter = 0;

const KIND_STYLE: Record<ToastKind, { bg: string; border: string; icon: typeof CheckCircle2; iconColor: string; titleColor: string; descColor: string }> = {
  success: {
    bg: "color-mix(in srgb, #10b981 12%, var(--c-card, #fff))",
    border: "color-mix(in srgb, #10b981 35%, transparent)",
    icon: CheckCircle2,
    iconColor: "#059669",
    titleColor: "var(--c-textPrimary, #0f172a)",
    descColor: "var(--c-textMuted, #475569)",
  },
  error: {
    bg: "color-mix(in srgb, #ef4444 14%, var(--c-card, #fff))",
    border: "color-mix(in srgb, #ef4444 45%, transparent)",
    icon: AlertOctagon,
    iconColor: "#dc2626",
    titleColor: "var(--c-textPrimary, #0f172a)",
    descColor: "var(--c-textMuted, #475569)",
  },
  warning: {
    bg: "color-mix(in srgb, #f59e0b 14%, var(--c-card, #fff))",
    border: "color-mix(in srgb, #f59e0b 40%, transparent)",
    icon: AlertTriangle,
    iconColor: "#d97706",
    titleColor: "var(--c-textPrimary, #0f172a)",
    descColor: "var(--c-textMuted, #475569)",
  },
  info: {
    bg: "color-mix(in srgb, var(--brand, #c9a83a) 12%, var(--c-card, #fff))",
    border: "color-mix(in srgb, var(--brand, #c9a83a) 40%, transparent)",
    icon: InfoIcon,
    iconColor: "var(--brand, #c9a83a)",
    titleColor: "var(--c-textPrimary, #0f172a)",
    descColor: "var(--c-textMuted, #475569)",
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setItems(prev => prev.filter(t => t.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback((input: ToastInput) => {
    const id = `t${++counter}`;
    // Toasts WITH an action button stay around longer (10s) so the user has
    // time to react — typical undo pattern. Plain success toasts dismiss
    // faster (2s) to avoid cluttering the corner.
    const defaultDuration = input.action ? 10_000 : input.kind === "success" ? 2_000 : 4_500;
    const item: ToastItem = {
      id,
      kind: input.kind ?? "info",
      title: input.title ?? "",
      description: input.description ?? "",
      duration: input.duration ?? defaultDuration,
      action: input.action,
    };
    setItems(prev => [...prev, item]);
    if (item.duration > 0) {
      const t = setTimeout(() => dismiss(id), item.duration);
      timers.current.set(id, t);
    }
  }, [dismiss]);

  useEffect(() => {
    return () => {
      timers.current.forEach(t => clearTimeout(t));
      timers.current.clear();
    };
  }, []);

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div
        className="fixed top-4 right-4 z-[1000] flex flex-col gap-2 pointer-events-none"
        style={{ maxWidth: "calc(100vw - 2rem)", width: 360 }}
        aria-live="polite"
        aria-atomic="true"
      >
        {/* Cap visible toasts at 3 — extra ones queue silently until one
            dismisses. Stacks of 5+ toasts used to bury the page. */}
        {items.slice(-3).map(t => {
          const style = KIND_STYLE[t.kind];
          const Icon = style.icon;
          return (
            <div
              key={t.id}
              role="status"
              className="pointer-events-auto rounded-xl border shadow-lg px-4 py-3 flex gap-3 items-start animate-[fadeIn_0.18s_ease-out]"
              style={{
                backgroundColor: style.bg,
                borderColor: style.border,
                boxShadow: "0 8px 28px -8px rgba(0,0,0,0.25)",
                backdropFilter: "blur(8px)",
              }}
            >
              <Icon size={16} strokeWidth={2.2} style={{ color: style.iconColor, flexShrink: 0, marginTop: 1 }} />
              <div className="flex-1 min-w-0">
                {t.title && (
                  <p className="text-[13px] font-semibold leading-snug" style={{ color: style.titleColor }}>
                    {t.title}
                  </p>
                )}
                {t.description && (
                  <p className="text-[12px] leading-snug mt-0.5" style={{ color: style.descColor }}>
                    {t.description}
                  </p>
                )}
                {t.action && (
                  <button
                    onClick={() => {
                      try { t.action!.onClick(); } catch { /* ignore */ }
                      dismiss(t.id);
                    }}
                    className="text-[12px] font-semibold mt-1.5 px-2 py-1 rounded-md transition-opacity hover:opacity-85"
                    style={{
                      backgroundColor: "rgba(255,255,255,0.7)",
                      color: style.iconColor,
                      border: `1px solid ${style.border}`,
                    }}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="rounded-md p-0.5 transition-opacity hover:opacity-70 flex-shrink-0"
                style={{ color: style.descColor }}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  // Graceful fallback to native alert if a caller mounts outside the provider.
  // Shouldn't happen in practice (ToastProvider wraps AppShell), but better
  // than throwing on an edge route.
  if (!ctx) {
    return {
      show: (t) => {
        if (typeof window !== "undefined") {
          const msg = [t.title, t.description].filter(Boolean).join(" — ");
          // eslint-disable-next-line no-alert
          if (msg) window.alert(msg);
        }
      },
    };
  }
  return ctx;
}
