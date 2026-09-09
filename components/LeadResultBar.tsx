"use client";

// Prominent business-RESULT bar for the Lead Detail (P0-4 + P0-5). Makes the
// outcome a primary, obvious action (it used to be buried) and — the moment a
// lead is marked Won — surfaces "Send to Odoo" right here, removing the
// go-to-Results-and-find-the-lead friction. Reuses the existing status route
// and SendToOdooPanel; no Odoo logic is duplicated.
//
// This is BUSINESS OUTCOME only. Reply sentiment (positive/negative) is a
// separate concept and lives in the conversation/inbox — we never conflate them.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { useToast } from "@/lib/toast";
import { useLocale } from "@/lib/i18n";
import SendToOdooPanel from "@/components/SendToOdooPanel";
import { Trophy, ThumbsDown, RefreshCw, CircleCheck, ChevronDown, CircleDashed } from "lucide-react";

const gold = "var(--brand, #c9a83a)";

type ResultKey = "won" | "qualified" | "renurture" | "lost" | "pending";

// UI option → canonical lead.status written via /api/leads/[id]/status.
const OPTIONS: { key: Exclude<ResultKey, "pending">; status: string; icon: React.ElementType; color: string }[] = [
  { key: "won", status: "closed_won", icon: Trophy, color: gold },
  { key: "qualified", status: "qualified", icon: CircleCheck, color: C.green },
  { key: "renurture", status: "nurturing", icon: RefreshCw, color: C.blue },
  { key: "lost", status: "closed_lost", icon: ThumbsDown, color: C.red },
];

function resultOf(status: string | null, transferred: boolean): ResultKey {
  const s = (status ?? "").toLowerCase();
  if (transferred || s === "closed_won" || s === "won") return "won";
  if (s === "qualified") return "qualified";
  if (s === "nurturing") return "renurture";
  if (s === "closed_lost") return "lost";
  return "pending";
}

export default function LeadResultBar({
  leadId, status, transferred, odooLeadId, showOdoo, canSetResult,
}: {
  leadId: string;
  status: string | null;
  transferred: boolean;
  odooLeadId: number | null;
  showOdoo: boolean;
  canSetResult: boolean;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const current = resultOf(status, transferred);
  const isWon = current === "won" || current === "qualified";

  const meta: Record<ResultKey, { label: string; icon: React.ElementType; color: string }> = {
    won: { label: t("result.won"), icon: Trophy, color: gold },
    qualified: { label: t("result.qualified"), icon: CircleCheck, color: C.green },
    renurture: { label: t("result.renurture"), icon: RefreshCw, color: C.blue },
    lost: { label: t("result.lost"), icon: ThumbsDown, color: C.red },
    pending: { label: t("result.pending"), icon: CircleDashed, color: C.textMuted },
  };
  const cur = meta[current];
  const CurIcon = cur.icon;

  async function setResult(newStatus: string) {
    setBusy(true); setOpen(false);
    try {
      const r = await fetch(`/api/leads/${leadId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!r.ok) throw new Error("error");
      toast.show({ kind: "success", title: t("result.toast.updated") });
      router.refresh();
    } catch {
      toast.show({ kind: "error", title: t("result.toast.error") });
    }
    setBusy(false);
  }

  return (
    <section className="rounded-2xl border p-3.5 mb-4" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: C.shadow }}>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.textMuted }}>{t("result.title")}</span>
        <span className="inline-flex items-center gap-1.5 text-[13px] font-bold px-2.5 py-1 rounded-lg"
          style={{ color: cur.color, background: `color-mix(in srgb, ${cur.color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${cur.color} 26%, transparent)` }}>
          <CurIcon size={14} /> {cur.label}
        </span>

        {canSetResult && (
          <div className="relative">
            <button onClick={() => setOpen(v => !v)} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold"
              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 80%, white))`, color: "#1a1205" }}>
              {t("result.set")} <ChevronDown size={13} />
            </button>
            {open && (
              <div className="absolute z-20 mt-1 rounded-xl p-1 min-w-[180px]" style={{ background: C.card, border: `1px solid ${C.border}`, boxShadow: C.shadowMd }}>
                {OPTIONS.map(o => {
                  const Icon = o.icon;
                  return (
                    <button key={o.key} onClick={() => setResult(o.status)}
                      className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] font-semibold text-left hover:bg-black/[0.04]"
                      style={{ color: C.textPrimary }}>
                      <Icon size={14} style={{ color: o.color }} /> {meta[o.key].label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Odoo status chip — derivable today from transferred_to_odoo_at. */}
        {showOdoo && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg"
            style={transferred
              ? { color: C.green, background: C.greenLight }
              : { color: C.textMuted, background: C.surface, border: `1px solid ${C.border}` }}>
            {transferred ? `${t("result.odoo.sent")}${odooLeadId ? ` · #${odooLeadId}` : ""}` : t("result.odoo.notSent")}
          </span>
        )}
      </div>

      {/* Won → surface Send to Odoo immediately (also stays available later). */}
      {showOdoo && isWon && (
        <div className="mt-3">
          <SendToOdooPanel leadId={leadId} transferred={transferred} />
        </div>
      )}
    </section>
  );
}
