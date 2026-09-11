"use client";

// Primary "Set result" hero action — surfaces the business-outcome flow
// (Won / Lost / Follow-up + optional auto-reply) that used to hide inside the
// More menu. Reuses LeadResultModal verbatim so there's one outcome path.

import { useState } from "react";
import { ClipboardCheck } from "lucide-react";
import LeadResultModal from "@/components/LeadResultModal";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";

export default function SetResultButton({
  leadId, autoReplies, size = "md",
}: {
  leadId: string;
  autoReplies?: { positive?: string; negative?: string } | null;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const { t } = useLocale();
  const pad = size === "sm" ? "px-3 py-2 text-xs" : "px-3.5 py-2 text-[13px]";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold border transition-colors hover:bg-black/[0.03] ${pad}`}
        style={{ borderColor: C.border, color: C.textBody }}
        title={t("ld2.setResult")}>
        <ClipboardCheck size={14} style={{ color: "var(--brand,#c9a83a)" }} /> {t("ld2.setResult")}
      </button>
      {open && <LeadResultModal leadId={leadId} autoReplies={autoReplies ?? null} onClose={() => setOpen(false)} />}
    </>
  );
}
