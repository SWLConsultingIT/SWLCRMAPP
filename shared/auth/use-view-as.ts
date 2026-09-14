"use client";

// Central, reusable read-only primitive for Admin "View as Seller".
//
// While an admin previews the app as a seller, every mutating action is ALREADY
// blocked server-side (proxy.ts + endpoint authz — untouched). This hook is the
// UX companion: it lets any mutating control disable itself with a friendly
// tooltip so the seller experience is faithful to walk through, but no action
// looks live and no internal error code ever surfaces.
//
// Usage on a mutating <button>:
//   const { readOnly, lockProps } = useViewAsReadOnly();
//   <button {...lockProps} disabled={busy || readOnly} onClick={...}>…</button>
// `lockProps` supplies title + aria-disabled in preview (and nothing otherwise);
// combine `readOnly` with any existing `disabled`. For non-button triggers, gate
// the handler with `guard(fn)` so a click can never fire the mutation.

import { useCallback } from "react";
import { useAuth } from "@/shared/auth/auth-context";
import { useLocale } from "@/shared/i18n/i18n";

export function useViewAsReadOnly() {
  const { viewAs } = useAuth();
  const { t } = useLocale();
  const readOnly = viewAs.active;
  const label = t("viewAs.actionUnavailable");

  // Wrap a mutating handler so it no-ops during preview (defense for triggers
  // that can't be visually disabled, e.g. menu items or <a> actions).
  const guard = useCallback(
    <A extends unknown[]>(fn: (...args: A) => void) =>
      (...args: A) => { if (readOnly) return; fn(...args); },
    [readOnly],
  );

  return {
    readOnly,
    /** Localized "Unavailable in Seller Preview". */
    label,
    /** Spread onto a mutating control — disables affordance in preview only. */
    lockProps: readOnly ? ({ title: label, "aria-disabled": true } as const) : ({} as const),
    guard,
  };
}
