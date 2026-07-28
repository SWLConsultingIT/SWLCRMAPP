"use client";

// Log the outcome of a call the seller made OUTSIDE the app (e.g. from a
// personal phone, so no Aircall dial fired and the post-call prompt never
// appeared). Opens the SAME CallOutcomePrompt used after an in-app dial and
// hits the SAME endpoint (/api/leads/[id]/call-outcome) — so lead + campaign
// side-effects (qualified / closed_lost / follow-up / wrong-number) are
// identical. No Aircall call row is required; the route writes a lead_replies
// row unconditionally. Boss request (Simo, 2026-07-28).

import { useState } from "react";
import { ClipboardCheck } from "lucide-react";
import CallOutcomePrompt from "@/components/CallOutcomePrompt";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";

export default function LogOutcomeButton({ leadId }: { leadId: string }) {
  const [open, setOpen] = useState(false);
  const { locale } = useLocale();
  const label = locale === "es" ? "Registrar resultado" : "Log outcome";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors hover:bg-black/[0.03]"
        style={{ borderColor: C.border, color: C.textBody }}
        title={locale === "es" ? "Registrar el resultado de una llamada hecha por fuera de la app" : "Record the outcome of a call made outside the app"}
      >
        <ClipboardCheck size={13} /> {label}
      </button>
      {open && <CallOutcomePrompt leadId={leadId} onClose={() => setOpen(false)} />}
    </>
  );
}
