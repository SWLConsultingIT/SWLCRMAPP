"use client";

// Add-to-existing-flow modal for the Lead Miner ticket detail page.
// Lists every active/paused outreach flow in the tenant with rich
// metadata (channel · status · current step · last activity · lead
// count) so the seller picks the right flow at a glance.
//
// Boss feedback 2026-05-28: "tiene que aparecer un buen pop up con las
// active campaigns a las cuales podes sumar esos leads. Que tenga info."
// SWL gold styling, multi-flow ready (one pick per submission).

import { useEffect, useState } from "react";
import { X, Loader2, Share2, Mail, Phone, Smartphone, MessageSquare, Calendar, Megaphone, CheckCircle, AlertCircle } from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

type Flow = {
  name: string;
  status: "active" | "paused" | "mixed";
  channels: string[];
  leadCount: number;
  activeLeads: number;
  pausedLeads: number;
  currentStep: number;
  totalSteps: number;
  lastStepAt: string | null;
  startedAt: string | null;
};

const channelMeta: Record<string, { Icon: React.ElementType; color: string; label: string }> = {
  linkedin: { Icon: Share2, color: "#0A66C2", label: "LinkedIn" },
  email:    { Icon: Mail,   color: "#059669", label: "Email" },
  call:     { Icon: Phone,  color: "#EA580C", label: "Call" },
  whatsapp: { Icon: Smartphone, color: "#25D366", label: "WhatsApp" },
  sms:      { Icon: MessageSquare, color: "#6B7280", label: "SMS" },
};

function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export default function AddToFlowModal({
  leadIds,
  leadNames,
  onClose,
  onAdded,
}: {
  leadIds: string[];
  leadNames?: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch("/api/flows/active");
        if (!res.ok) { if (!cancel) { setError("Failed to load flows"); setLoading(false); } return; }
        const j = await res.json();
        if (!cancel) { setFlows(j.flows ?? []); setLoading(false); }
      } catch (e) {
        if (!cancel) { setError((e as Error).message); setLoading(false); }
      }
    })();
    return () => { cancel = true; };
  }, []);

  async function submit() {
    if (!picked || busy) return;
    setBusy(true); setError(null);
    try {
      // /api/campaigns/[id]/add-leads takes a campaign row id; resolve the
      // chosen flow name → first campaign id via the active-list endpoint
      // (already exists, tenant-scoped). The server side will fan-out per lead.
      const alt = await fetch("/api/campaigns/active-list");
      const aj = await alt.json();
      const campaignId = (aj.campaigns ?? []).find((c: { id: string; name: string }) => c.name === picked)?.id ?? null;
      if (!campaignId) {
        setError("Couldn't resolve flow to a campaign row.");
        setBusy(false);
        return;
      }
      const res = await fetch(`/api/campaigns/${campaignId}/add-leads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadIds }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to add leads");
        setBusy(false);
        return;
      }
      onAdded();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const visibleFlows = (flows ?? []).filter(f =>
    search.trim() === "" || f.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
      onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border overflow-hidden flex flex-col"
        style={{
          backgroundColor: C.card,
          borderColor: `color-mix(in srgb, ${gold} 30%, ${C.border})`,
          boxShadow: `0 1px 0 color-mix(in srgb, ${gold} 22%, transparent), 0 28px 64px -16px rgba(11,15,26,0.55)`,
          maxHeight: "min(82vh, 720px)",
        }}
        onClick={e => e.stopPropagation()}>

        {/* Navy hero header with gold typography */}
        <div className="relative overflow-hidden px-6 py-4 flex items-center justify-between"
          style={{
            background: "linear-gradient(135deg, #0B0F1A 0%, #111827 60%, #0B0F1A 100%)",
            borderBottom: `1px solid color-mix(in srgb, ${gold} 28%, transparent)`,
          }}>
          <span aria-hidden className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none"
            style={{ background: `radial-gradient(circle, color-mix(in srgb, ${gold} 18%, transparent) 0%, transparent 60%)` }} />
          <div className="relative">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] mb-1" style={{ color: gold, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
              Add to Existing Flow
            </p>
            <h3 className="text-[18px] font-bold leading-tight" style={{ color: "#fff", fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
              {leadIds.length} {leadIds.length === 1 ? "lead" : "leads"} → pick a flow
            </h3>
            {leadNames && leadNames.length > 0 && (
              <p className="text-[11px] mt-1 truncate" style={{ color: "color-mix(in srgb, white 60%, transparent)", maxWidth: 440 }}>
                {leadNames.slice(0, 3).join(", ")}{leadNames.length > 3 ? ` +${leadNames.length - 3}` : ""}
              </p>
            )}
          </div>
          <button onClick={onClose} className="relative w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-white/10"
            style={{ color: "rgba(255,255,255,0.7)" }}>
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search flows by name..."
            className="w-full text-[13px] px-3 py-2 rounded-lg border outline-none transition-colors focus:border-amber-400"
            style={{ borderColor: C.border, backgroundColor: C.card, color: C.textPrimary }}
          />
        </div>

        {/* Flow list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2" style={{ background: C.bg }}>
          {loading ? (
            <div className="py-10 text-center">
              <Loader2 size={18} className="animate-spin mx-auto" style={{ color: C.textDim }} />
              <p className="text-xs mt-2" style={{ color: C.textDim }}>Loading flows...</p>
            </div>
          ) : visibleFlows.length === 0 ? (
            <div className="py-10 text-center">
              <Megaphone size={20} className="mx-auto mb-2" style={{ color: C.textDim }} />
              <p className="text-sm font-semibold" style={{ color: C.textBody }}>
                {(flows ?? []).length === 0 ? "No active flows yet" : "No flows match your search"}
              </p>
              <p className="text-xs mt-1" style={{ color: C.textDim }}>
                {(flows ?? []).length === 0
                  ? "Create a new flow instead to start one for these leads."
                  : "Try a different keyword or clear the search."}
              </p>
            </div>
          ) : visibleFlows.map(f => {
            const isPicked = picked === f.name;
            const stepProgress = f.totalSteps > 0 ? Math.min(100, Math.round((f.currentStep / f.totalSteps) * 100)) : 0;
            return (
              <button
                key={f.name}
                onClick={() => setPicked(f.name)}
                className="w-full text-left rounded-xl border px-4 py-3 transition-[border-color,box-shadow,transform] hover:-translate-y-px"
                style={{
                  borderColor: isPicked ? `color-mix(in srgb, ${gold} 55%, transparent)` : C.border,
                  backgroundColor: isPicked ? `color-mix(in srgb, ${gold} 7%, ${C.card})` : C.card,
                  boxShadow: isPicked ? `0 0 0 1px color-mix(in srgb, ${gold} 35%, transparent), 0 10px 28px -12px color-mix(in srgb, ${gold} 35%, transparent)` : "0 1px 2px rgba(0,0,0,0.03)",
                }}
              >
                <div className="flex items-start gap-3">
                  {/* Channel icons stack */}
                  <div className="flex flex-col gap-1 shrink-0">
                    {f.channels.slice(0, 3).map(ch => {
                      const meta = channelMeta[ch] ?? channelMeta.email;
                      const Icon = meta.Icon;
                      return (
                        <span key={ch} className="w-7 h-7 rounded-lg flex items-center justify-center"
                          style={{ background: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color, border: `1px solid color-mix(in srgb, ${meta.color} 22%, transparent)` }}
                          title={meta.label}>
                          <Icon size={12} />
                        </span>
                      );
                    })}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Title + status */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[14px] font-bold truncate" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                        {f.name}
                      </p>
                      <StatusPill status={f.status} />
                      {isPicked && <CheckCircle size={13} style={{ color: gold }} />}
                    </div>

                    {/* Meta row */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: C.textDim }}>
                      <span className="inline-flex items-center gap-1">
                        <Megaphone size={10} />
                        <span className="font-semibold tabular-nums" style={{ color: C.textBody }}>{f.leadCount}</span>
                        {f.leadCount === 1 ? "lead" : "leads"}
                      </span>
                      {f.totalSteps > 0 && (
                        <span className="inline-flex items-center gap-1">
                          Step <span className="font-semibold tabular-nums" style={{ color: C.textBody }}>{f.currentStep + 1}</span>/{f.totalSteps}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Calendar size={10} /> Last activity {timeAgo(f.lastStepAt)}
                      </span>
                    </div>

                    {/* Progress bar */}
                    {f.totalSteps > 0 && (
                      <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: C.surface }}>
                        <div className="h-full transition-[width]"
                          style={{ width: `${stepProgress}%`, background: `linear-gradient(90deg, ${gold}, color-mix(in srgb, ${gold} 65%, white))` }} />
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer with action buttons */}
        <div className="px-5 py-3 flex items-center justify-between gap-3 border-t" style={{ borderColor: C.border, backgroundColor: C.card }}>
          {error ? (
            <span className="text-[11.5px] inline-flex items-center gap-1.5 font-medium" style={{ color: C.red }}>
              <AlertCircle size={12} /> {error}
            </span>
          ) : (
            <span className="text-[11px]" style={{ color: C.textDim }}>
              {picked ? <>Selected: <span className="font-semibold" style={{ color: C.textBody }}>{picked}</span></> : "Pick a flow to continue."}
            </span>
          )}
          <div className="flex items-center gap-2">
            <button onClick={onClose}
              className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border transition-colors hover:bg-black/[0.03]"
              style={{ borderColor: C.border, color: C.textBody }}>
              Cancel
            </button>
            <button onClick={submit} disabled={!picked || busy}
              className="text-[12px] font-bold px-4 py-1.5 rounded-lg inline-flex items-center gap-1.5 transition-opacity"
              style={{
                background: !picked || busy ? C.surface : `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 75%, white))`,
                color: !picked || busy ? C.textDim : "#1A1505",
                cursor: !picked || busy ? "not-allowed" : "pointer",
                boxShadow: !picked || busy ? "none" : `0 4px 12px color-mix(in srgb, ${gold} 30%, transparent)`,
              }}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
              Add to flow
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: "active" | "paused" | "mixed" }) {
  const color = status === "active" ? "#059669" : status === "paused" ? "#D97706" : "#6B7280";
  const label = status === "active" ? "Active" : status === "paused" ? "Paused" : "Mixed";
  return (
    <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
      {status === "active" && <span className="w-1 h-1 rounded-full" style={{ background: color }} />}
      {label}
    </span>
  );
}
