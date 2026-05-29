"use client";

// Add-to-existing-flow modal scoped to ONE icp_profile_id.
//
// Was previously defined inline in LeadsCampaignsClient.tsx and not
// exported. Promoted to its own file 2026-05-29 so the /leads bulk popup
// and the campaign-creation /pick page can both reuse it without
// duplicating the logic — both surfaces need the same ICP-scoped flow
// list under the one-ICP-per-campaign LAW.
//
// The server `/api/campaigns/active-list?icp=<id>` already enforces
// tenant scope + ICP filter; this component just renders the picker.

import { useEffect, useState } from "react";
import { Megaphone, CheckSquare, X } from "lucide-react";
import { C } from "@/lib/design";
import { useLocale } from "@/lib/i18n";
import { useToast } from "@/lib/toast";

const gold = "var(--brand, #c9a83a)";

export default function AddToFlowModalIcpScoped({
  leadIds,
  icpProfileId,
  onClose,
  onAdded,
}: {
  leadIds: string[];
  /** ICP shared by every lead in the selection. Server-side filter so
   * the operator can't violate the one-ICP-per-campaign LAW. */
  icpProfileId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<Array<{
    id: string; name: string; status: string; channel: string;
    sequence_steps: unknown[] | null; lead_count: number;
  }>>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/active-list?icp=${encodeURIComponent(icpProfileId)}`, { cache: "no-store" })
      .then(r => r.ok ? r.json() : { campaigns: [] })
      .then(data => { if (!cancelled) setCampaigns(Array.isArray(data.campaigns) ? data.campaigns : []); })
      .catch(() => { /* ignore — empty list */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [icpProfileId]);

  // Dedupe by flow name (one campaign row per lead) and keep only flows
  // with at least one active/paused row.
  const flowsByName: Record<string, { id: string; name: string; channel: string; sequence_steps: unknown[] | null; total: number; active: number }> = {};
  for (const c of campaigns) {
    if (!flowsByName[c.name]) flowsByName[c.name] = { id: c.id, name: c.name, channel: c.channel, sequence_steps: c.sequence_steps, total: 0, active: 0 };
    flowsByName[c.name].total++;
    if (c.status === "active" || c.status === "paused") flowsByName[c.name].active++;
  }
  const flows = Object.values(flowsByName).filter(f => f.active > 0).sort((a, b) => b.active - a.active);

  async function submit() {
    if (!pickedId || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${pickedId}/add-leads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadIds }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.show({ kind: "error", title: t("leadsPage.addToFlow.toast.failed"), description: json.error ?? t("leadsPage.bulk.toast.statusFailedDesc") });
        return;
      }
      toast.show({ kind: "success", title: t("leadsPage.addToFlow.toast.added", { n: json.added ?? leadIds.length }) });
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border overflow-hidden"
        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 flex items-center justify-between border-b" style={{ borderColor: C.border }}>
          <div>
            <h3 className="text-base font-bold" style={{ color: C.textPrimary }}>{t("leadsPage.addToFlow.title")}</h3>
            <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>
              {t(leadIds.length === 1 ? "leadsPage.addToFlow.descLead" : "leadsPage.addToFlow.descLeads", { n: leadIds.length })}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-black/[0.04]">
            <X size={14} style={{ color: C.textDim }} />
          </button>
        </div>

        <div className="p-5 space-y-2 max-h-[50vh] overflow-y-auto">
          {loading ? (
            <p className="text-sm py-6 text-center" style={{ color: C.textMuted }}>{t("leadsPage.addToFlow.loading")}</p>
          ) : flows.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: C.textMuted }}>
              {t("leadsPage.addToFlow.emptyHint")}
            </p>
          ) : flows.map(f => {
            const picked = pickedId === f.id;
            const steps = Array.isArray(f.sequence_steps) ? f.sequence_steps.length : 0;
            return (
              <button key={f.id}
                onClick={() => setPickedId(f.id)}
                className="w-full text-left rounded-xl border px-4 py-3 transition-[border-color,background-color]"
                style={{
                  borderColor: picked ? gold : C.border,
                  backgroundColor: picked ? `color-mix(in srgb, ${gold} 8%, transparent)` : C.bg,
                }}>
                <div className="flex items-center gap-2 mb-1">
                  <Megaphone size={11} style={{ color: gold }} />
                  <span className="text-[13px] font-semibold flex-1 truncate" style={{ color: C.textPrimary }}>{f.name}</span>
                  {picked && <CheckSquare size={13} style={{ color: gold }} />}
                </div>
                <p className="text-[11px]" style={{ color: C.textMuted }}>
                  {steps > 0
                    ? t("leadsPage.addToFlow.flowMetaSteps", { leads: f.total, channel: f.channel, steps })
                    : t("leadsPage.addToFlow.flowMeta",      { leads: f.total, channel: f.channel })}
                </p>
              </button>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-end gap-2" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          <button onClick={onClose}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border"
            style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.card }}>
            {t("leadsPage.addToFlow.cancel")}
          </button>
          <button onClick={submit}
            disabled={!pickedId || busy || flows.length === 0}
            className="text-xs font-bold px-3 py-1.5 rounded-lg transition-opacity disabled:opacity-50"
            style={{ backgroundColor: gold, color: "#1A1A2E" }}>
            {busy
              ? t("leadsPage.addToFlow.adding")
              : t(leadIds.length === 1 ? "leadsPage.addToFlow.addN" : "leadsPage.addToFlow.addNPlural", { n: leadIds.length })}
          </button>
        </div>
      </div>
    </div>
  );
}
