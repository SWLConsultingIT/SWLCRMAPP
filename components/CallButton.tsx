"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Phone, Loader2, CheckCheck, PhoneOff, ChevronDown, RefreshCw, ThumbsUp, ThumbsDown, Clock, X, PhoneOff as PhoneOffIcon, Calendar } from "lucide-react";
import { C } from "@/lib/design";
import { useToast } from "@/lib/toast";
import { useAircallPhone } from "@/components/AircallPhoneProvider";

const DEFAULT_AIRCALL_USER_ID = process.env.NEXT_PUBLIC_AIRCALL_DEFAULT_USER_ID
  ? Number(process.env.NEXT_PUBLIC_AIRCALL_DEFAULT_USER_ID)
  : null; // null = let Aircall pick the first available user in the team

type AircallNumber = {
  id: number;
  name: string;
  digits: string;
  country: string;
};

const COUNTRY_FLAGS: Record<string, string> = {
  DE: "🇩🇪", US: "🇺🇸", AR: "🇦🇷", BR: "🇧🇷", MX: "🇲🇽",
  ES: "🇪🇸", FR: "🇫🇷", IT: "🇮🇹", UK: "🇬🇧", GB: "🇬🇧",
  CA: "🇨🇦", CO: "🇨🇴", CL: "🇨🇱", PE: "🇵🇪", UY: "🇺🇾",
};

function countryLabel(country: string): string {
  const names: Record<string, string> = {
    DE: "Germany", US: "United States", AR: "Argentina", BR: "Brazil",
    MX: "Mexico", ES: "Spain", FR: "France", IT: "Italy", UK: "UK", GB: "UK",
    CA: "Canada", CO: "Colombia", CL: "Chile", PE: "Peru", UY: "Uruguay",
  };
  return names[country] ?? country;
}

type PhoneOption = { label: string; value: string };

type Props = {
  phone: string | null;
  leadId: string;
  size?: "sm" | "md" | "lg";
  variant?: "solid" | "soft" | "ghost";
  // Override the default "Call {phone}" idle label. Used by the queue's
  // "Awaiting Outcome" sub-tab where the primary action is classifying,
  // not dialing again.
  label?: string;
  defaultNumberId?: number | null;
  // Optional: when a lead has multiple phones (eg primary_phone + work
  // secondary phone), pass them all here so the seller can pick which one to
  // dial before clicking Call. The first entry is the default selection. If
  // only one valid number exists or the prop is omitted, behaviour falls back
  // to the `phone` prop and the picker stays hidden.
  phones?: PhoneOption[];
};

export default function CallButton({ phone, leadId, size = "md", variant = "solid", label, defaultNumberId, phones }: Props) {
  const router = useRouter();
  const toast = useToast();
  // Aircall Everywhere SDK provider — gives us in-app calling (no desktop
  // Aircall required). Calling dial() opens the SWL-branded phone modal
  // and routes the call through the embedded workspace. The legacy POST
  // to /api/aircall/dial is gone; the Aircall webhook still populates
  // the calls row on call.created/ended.
  const aircall = useAircallPhone();
  const [numbers, setNumbers] = useState<AircallNumber[]>([]);
  const [selectedNumberId, setSelectedNumberId] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "calling" | "called" | "error">("idle");
  const [picker, setPicker] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // When multiple phones exist for the lead, sellers pick which to dial.
  // Defaults to first option (typically primary_phone / mobile).
  const phoneOptions: PhoneOption[] = (phones && phones.length > 0)
    ? phones.filter(p => p.value && p.value.trim().length > 0)
    : (phone ? [{ label: "Mobile", value: phone }] : []);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(phoneOptions[0]?.value ?? null);
  const [phonePicker, setPhonePicker] = useState(false);
  // Post-call outcome prompt — opens automatically after the embedded
  // Aircall workspace fires `call_ended`. 4 buttons map to 4 concrete
  // CRM actions (see /api/leads/[id]/call-outcome). Sellers were
  // forgetting to log outcomes when the popup wasn't auto-opening.
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [classifying, setClassifying] = useState(false);
  // Track the last currentCall state so we only open once per call
  // (not on every render while the call is in 'ended' state).
  const prevCallStateRef = useRef<string | null>(null);

  useEffect(() => {
    const state = aircall.currentCall?.state ?? null;
    const wasForThisLead = aircall.currentCall?.leadId === leadId;
    if (state === "ended" && prevCallStateRef.current !== "ended" && wasForThisLead) {
      setOutcomeOpen(true);
    }
    prevCallStateRef.current = state;
  }, [aircall.currentCall?.state, aircall.currentCall?.leadId, leadId]);

  async function submitOutcome(outcome: "interested" | "not_interested" | "bad_timing" | "wrong_number") {
    if (classifying) return;
    setClassifying(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/call-outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      if (!r.ok) {
        const { error } = await r.json().catch(() => ({ error: "Failed" }));
        toast.show({ kind: "error", title: "Couldn't log outcome", description: error || "Try again." });
        return;
      }
      const labelMap = {
        interested: "Interested — campaign closed as won",
        not_interested: "Not interested — campaign closed as lost",
        bad_timing: "Snoozed 30 days",
        wrong_number: "Wrong number — call channel disabled for lead",
      } as const;
      toast.show({ kind: "success", title: "Outcome logged", description: labelMap[outcome] });
      setOutcomeOpen(false);
      router.refresh();
    } finally {
      setClassifying(false);
    }
  }

  const loadNumbers = useCallback(async (opts?: { fresh?: boolean }) => {
    // Pass leadId so the API scopes to the LEAD's tenant (not the viewer's).
    // Super_admin viewing a SWL lead must NOT see Pathway/Arqy numbers in the
    // picker — that previously caused cross-tenant dialing.
    const qs = new URLSearchParams({ leadId });
    if (opts?.fresh) qs.set("fresh", "1");
    try {
      const r = await fetch(`/api/aircall/numbers?${qs.toString()}`, opts?.fresh ? { cache: "no-store" } : undefined);
      const d = (await r.json()) as { numbers: AircallNumber[] };
      setNumbers(d.numbers ?? []);
      // Preserve the seller's current selection if it's still in the new list;
      // otherwise fall back to the campaign default, then the first number.
      setSelectedNumberId((prev) => {
        if (prev && d.numbers?.some((n) => n.id === prev)) return prev;
        const preferred = defaultNumberId && d.numbers?.find((n) => n.id === defaultNumberId);
        if (preferred) return preferred.id;
        return d.numbers?.[0]?.id ?? null;
      });
    } catch { /* leave numbers as-is */ }
  }, [defaultNumberId, leadId]);

  useEffect(() => {
    void loadNumbers();
  }, [loadNumbers]);

  async function refreshNumbers() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await loadNumbers({ fresh: true });
    } finally {
      setRefreshing(false);
    }
  }

  if (phoneOptions.length === 0) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
        style={{ backgroundColor: C.surface, color: C.textDim }}
      >
        <PhoneOff size={12} /> No phone number
      </span>
    );
  }

  async function handleDial() {
    if (state === "calling") return;
    const dialingPhone = selectedPhone || phoneOptions[0]?.value;
    if (!dialingPhone) return;
    setState("calling");
    try {
      // Dial via the embedded Aircall workspace. If the agent hasn't
      // logged into Aircall yet, the modal still opens — they log in
      // there, the dial command queues and fires after `not_ready`
      // resolves (or they hit the dialpad themselves once in).
      // selectedNumberId is the tenant's outbound Aircall number — we
      // forward it as best-effort metadata so the workspace iframe can
      // skip its "Start conversation from" picker when the agent has
      // access to multiple numbers (e.g. SWL admin seeing all tenants).
      const fromNumberId = selectedNumberId ?? defaultNumberId ?? null;
      const result = await aircall.dial(dialingPhone, leadId, fromNumberId);
      if (result.ok) {
        setState("called");
        // No more pre-insert: the Aircall webhook will create the calls
        // row when Aircall reports call.created/ended. router.refresh
        // after a short delay lets the call appear in the lead timeline.
        setTimeout(() => { router.refresh(); }, 4000);
        setTimeout(() => setState("idle"), 4000);
      } else {
        // Surface common errors so the seller knows what to fix.
        const code = result.error || "unknown";
        const msg = code === "not_ready" ? "Sign in to Aircall in the phone window to start the call."
          : code === "in_call"  ? "Wait for the current call to end before starting another."
          : `Couldn't start the call (${code}).`;
        toast.show({ kind: "warning", title: "Call not started", description: msg });
        setState("error");
        setTimeout(() => setState("idle"), 3000);
      }
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  }

  const padding = size === "sm" ? "px-3 py-1.5" : size === "lg" ? "px-5 py-2.5" : "px-4 py-2";
  const text = size === "sm" ? "text-xs" : "text-sm";
  const iconSize = size === "sm" ? 12 : 14;

  const baseStyle = variant === "solid"
    ? { backgroundColor: "#F97316", color: "#fff" }
    : variant === "ghost"
    ? { backgroundColor: "transparent", color: "#EA580C", border: `1px solid ${C.border}` }
    : { backgroundColor: "#FFF7ED", color: "#EA580C", border: "1px solid #FED7AA" };

  const selected = numbers.find(n => n.id === selectedNumberId);
  const selectedPhoneOpt = phoneOptions.find(p => p.value === selectedPhone) ?? phoneOptions[0];
  const dialingPhoneDisplay = selectedPhoneOpt?.value ?? phone;

  return (
    <div className="inline-flex items-center gap-1.5 relative">
      <button
        onClick={handleDial}
        disabled={state === "calling" || !selectedNumberId}
        className={`flex items-center gap-1.5 rounded-lg ${padding} ${text} font-semibold transition-opacity hover:opacity-85 disabled:opacity-60`}
        style={{
          ...baseStyle,
          ...(state === "called" ? { backgroundColor: "#DCFCE7", color: "#16A34A", border: "1px solid #BBF7D0" } : {}),
          ...(state === "error" ? { backgroundColor: C.redLight, color: C.red, border: `1px solid ${C.red}30` } : {}),
        }}
      >
        {state === "calling" ? <><Loader2 size={iconSize} className="animate-spin" /> Calling…</>
          : state === "called" ? <><CheckCheck size={iconSize} /> Call initiated</>
          : state === "error" ? <><PhoneOff size={iconSize} /> Failed</>
          : <><Phone size={iconSize} /> {label ?? `Call ${dialingPhoneDisplay}`}</>
        }
      </button>

      {/* Lead phone picker — only shown when the lead has more than one
          valid phone number (eg mobile + corporate). For single-phone leads
          we hide the chip entirely to keep the row compact. */}
      {phoneOptions.length > 1 && (
        <>
          <button
            onClick={() => setPhonePicker(v => !v)}
            className={`flex items-center gap-1 rounded-lg ${padding} ${text} font-medium`}
            style={{ backgroundColor: C.bg, color: C.textMuted, border: `1px solid ${C.border}` }}
            title="Change which lead phone to dial"
          >
            <Phone size={iconSize - 2} />
            <span className="font-semibold">{selectedPhoneOpt?.label ?? "Phone"}</span>
            <ChevronDown size={10} />
          </button>
          {phonePicker && (
            <div
              className="absolute top-full left-0 mt-1 rounded-lg border shadow-lg z-50 min-w-[220px]"
              style={{ backgroundColor: C.card, borderColor: C.border }}
            >
              <div className="px-3 py-2 border-b" style={{ borderColor: C.border }}>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>Call which number</p>
              </div>
              {phoneOptions.map(opt => {
                const isSel = opt.value === selectedPhone;
                return (
                  <button
                    key={opt.value + opt.label}
                    onClick={() => { setSelectedPhone(opt.value); setPhonePicker(false); }}
                    className="w-full text-left px-3 py-2.5 hover:bg-black/[0.03] transition-colors flex items-center gap-2.5"
                    style={{
                      backgroundColor: isSel ? "#FFF7ED" : "transparent",
                      borderLeft: isSel ? "3px solid #F97316" : "3px solid transparent",
                    }}
                  >
                    <Phone size={12} style={{ color: isSel ? "#F97316" : C.textMuted }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold" style={{ color: isSel ? "#EA580C" : C.textPrimary }}>{opt.label}</p>
                      <p className="text-[10px] tabular-nums" style={{ color: C.textMuted }}>{opt.value}</p>
                    </div>
                    {isSel && <CheckCheck size={12} style={{ color: "#F97316" }} />}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {numbers.length > 0 && (
        <button
          onClick={() => setPicker(v => !v)}
          className={`flex items-center gap-1 rounded-lg ${padding} ${text} font-medium`}
          style={{ backgroundColor: C.bg, color: C.textMuted, border: `1px solid ${C.border}` }}
          title="Change outgoing number"
        >
          {selected ? (
            <>
              <span>{COUNTRY_FLAGS[selected.country] ?? "📞"}</span>
              <span className="tabular-nums">…{selected.digits.slice(-4)}</span>
            </>
          ) : "…"}
          <ChevronDown size={10} />
        </button>
      )}

      {picker && (
        <div
          className="absolute top-full right-0 mt-1 rounded-lg border shadow-lg z-50 min-w-[240px]"
          style={{ backgroundColor: C.card, borderColor: C.border }}
        >
          <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>Call from</p>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); void refreshNumbers(); }}
              disabled={refreshing}
              title="Refresh from Aircall — picks up newly-claimed numbers without waiting for the 5-min cache"
              className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded transition-opacity hover:opacity-70 disabled:opacity-50"
              style={{ color: C.textMuted }}
            >
              <RefreshCw size={9} className={refreshing ? "animate-spin" : ""} />
              {refreshing ? "Syncing" : "Refresh"}
            </button>
          </div>
          {numbers.map(n => {
            const isSelected = n.id === selectedNumberId;
            return (
              <button
                key={n.id}
                onClick={() => { setSelectedNumberId(n.id); setPicker(false); }}
                className="w-full text-left px-3 py-2.5 hover:bg-black/[0.03] transition-colors flex items-center gap-2.5"
                style={{
                  backgroundColor: isSelected ? "#FFF7ED" : "transparent",
                  borderLeft: isSelected ? "3px solid #F97316" : "3px solid transparent",
                }}
              >
                <span className="text-xl shrink-0">{COUNTRY_FLAGS[n.country] ?? "📞"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold" style={{ color: isSelected ? "#EA580C" : C.textPrimary }}>
                    {countryLabel(n.country)}
                  </p>
                  <p className="text-[10px] tabular-nums" style={{ color: C.textMuted }}>
                    {n.digits}
                  </p>
                </div>
                {isSelected && <CheckCheck size={12} style={{ color: "#F97316" }} />}
              </button>
            );
          })}
        </div>
      )}

      {/* Post-call outcome prompt — fixed bottom-right card, opens
          automatically when the Aircall workspace fires `call_ended`
          for this lead. Four mutually-exclusive outcomes, each maps
          to a concrete CRM action via /api/leads/[id]/call-outcome:
          Interested (book) / Not interested (close) / Bad timing
          (snooze 30d) / Wrong number (skip channel for this lead). */}
      {outcomeOpen && (
        <div
          className="fixed bottom-6 right-6 z-[1100] rounded-2xl border shadow-2xl p-5 animate-[fadeIn_0.2s_ease-out]"
          style={{
            backgroundColor: C.card,
            borderColor: `color-mix(in srgb, ${C.gold} 35%, ${C.border})`,
            boxShadow: "0 24px 60px -16px rgba(0,0,0,0.4)",
            width: 340,
            maxWidth: "calc(100vw - 3rem)",
          }}
        >
          <button
            type="button"
            onClick={() => setOutcomeOpen(false)}
            aria-label="Skip for now"
            className="absolute top-3 right-3 rounded p-1 hover:bg-black/[0.04] transition-colors"
            style={{ color: C.textDim }}
          >
            <X size={14} />
          </button>
          <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.gold, letterSpacing: "0.18em" }}>
            How did it go?
          </p>
          <p className="text-sm font-semibold mb-3 pr-6" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif", letterSpacing: "-0.01em" }}>
            Log the call outcome
          </p>
          <p className="text-[11px] mb-4" style={{ color: C.textMuted }}>
            One click — each option moves the lead through its flow correctly.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {([
              { v: "interested" as const,     label: "Interested",     desc: "Book meeting",      icon: ThumbsUp,      color: C.green,   bg: `color-mix(in srgb, ${C.green} 12%, transparent)` },
              { v: "not_interested" as const, label: "Not interested", desc: "Close",             icon: ThumbsDown,    color: C.red,     bg: `color-mix(in srgb, ${C.red} 12%, transparent)` },
              { v: "bad_timing" as const,     label: "Bad timing",     desc: "Snooze 30 days",    icon: Calendar,      color: "#D97706", bg: "color-mix(in srgb, #D97706 12%, transparent)" },
              { v: "wrong_number" as const,   label: "Wrong number",   desc: "Skip call channel", icon: PhoneOffIcon,  color: C.textMuted, bg: C.surface },
            ]).map(opt => {
              const OptIcon = opt.icon;
              return (
                <button
                  key={opt.v}
                  type="button"
                  disabled={classifying}
                  onClick={() => submitOutcome(opt.v)}
                  className="flex flex-col items-start gap-1 px-3 py-2.5 rounded-lg border text-left transition-opacity hover:opacity-85 disabled:opacity-50"
                  style={{
                    backgroundColor: opt.bg,
                    color: opt.color,
                    borderColor: `color-mix(in srgb, ${opt.color} 30%, transparent)`,
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <OptIcon size={13} />
                    <span className="text-[12px] font-semibold">{opt.label}</span>
                  </div>
                  <span className="text-[10px] opacity-80">{opt.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
