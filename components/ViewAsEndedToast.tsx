"use client";

// When a stale/invalid view-as cookie is self-healed server-side (the seller
// went inactive / deleted / cross-tenant / the cookie was tampered), /api/auth/me
// clears it and flags `viewAsEnded`. This surfaces that as one explicit toast so
// the admin is never silently dropped from a seller preview back to full Admin
// scope without knowing — the exact UX trap we set out to close. Central: one
// mount in AppShell, no per-page checks.

import { useEffect, useRef } from "react";
import { useAuth } from "@/shared/auth/auth-context";
import { useToast } from "@/shared/ui/toast";
import { useLocale } from "@/shared/i18n/i18n";

export default function ViewAsEndedToast() {
  const { viewAsEnded } = useAuth();
  const { show } = useToast();
  const { t } = useLocale();
  const firedFor = useRef(false);

  useEffect(() => {
    if (viewAsEnded && !firedFor.current) {
      firedFor.current = true;
      show({
        kind: "info",
        title: t("viewAs.endedTitle"),
        description: t("viewAs.endedBody"),
        duration: 6000,
      });
    }
    if (!viewAsEnded) firedFor.current = false;
  }, [viewAsEnded, show, t]);

  return null;
}
