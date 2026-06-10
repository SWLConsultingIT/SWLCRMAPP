"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Phone, Loader2, CheckCheck, PhoneOff, ChevronDown, RefreshCw } from "lucide-react";
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
  // Optional: whether the lead is currently in a call step (for validation)
  isCallStep?: boolean;
  // Optional: next expected step name (shown in validation dialog)
  nextStepName?: string;
};

export default function CallButton({ phone, leadId, size = "md", variant = "solid", label, defaultNumberId, phones, isCallStep, nextStepName }: Props) {
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
    : (phone ? [{ label: "Personal", value: phone }] : []);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(() => {
    if (typeof window === "undefined") return phoneOptions[0]?.value ?? null;
    try {
      const saved = window.localStorage.getItem("swl-last-phone");
      if (saved && phoneOptions.some(p => p.value === saved)) return saved;
    } catch { /* ignore */ }
    return phoneOptions[0]?.value ?? null;
  });
  const [phonePicker, setPhonePicker] = useState(false);

  // Save phone preference (#15)
  useEffect(() => {
    if (selectedPhone && typeof window !== "undefined") {
      try {
        window.localStorage.setItem("swl-last-phone", selectedPhone);
      } catch { /* ignore */ }
    }
  }, [selectedPhone]);

  // The post-call outcome prompt now lives in AircallPhoneProvider (always
  // mounted) so it shows reliably on any page when a call ends — see
  // components/CallOutcomePrompt.tsx. CallButton no longer owns it.

  // Shared-seat busy state. Fran's tenants run on one Aircall user per
  // company (one seat shared across N sellers). Polling /api/aircall
  // /active-call every 5s lets the second seller see "Aircall busy by
  // <name>" before they waste a click. busy=null means "no other call
  // detected"; otherwise the object carries who started it + when.
  const [busy, setBusy] = useState<{ byName: string; startedAt: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const r = await fetch("/api/aircall/active-call", { cache: "no-store" });
        const body = await r.json().catch(() => ({}));
        if (!alive) return;
        if (r.ok && body.busy) setBusy({ byName: body.byName ?? "another seller", startedAt: body.startedAt ?? null });
        else setBusy(null);
      } catch { /* network blip — ignore one tick */ }
    }
    void poll();
    const id = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

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
    if (busy) {
      toast.show({
        kind: "warning",
        title: "Aircall is busy",
        description: `${busy.byName} is currently on a call. Wait for it to end and try again.`,
      });
      return;
    }
    // Validate if the lead is in a call step
    if (isCallStep === false) {
      const confirmed = confirm(
        `This lead is not yet in the call step (${nextStepName ? `next: ${nextStepName}` : "another step is next"}). Are you sure you want to call anyway?`
      );
      if (!confirmed) return;
    }
    const dialingPhone = selectedPhone || phoneOptions[0]?.value;
    if (!dialingPhone) return;
    setState("calling");
    try {
      // Write a dial marker BEFORE the SDK fires so the active-call
      // poller in other sellers' browsers sees us holding the seat
      // immediately, not 30s later when the webhook finally lands.
      // Fire-and-forget — if the row insert fails we still dial,
      // we just lose the busy-banner protection for this attempt.
      void fetch("/api/aircall/dial-marker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, phone: dialingPhone }),
      });

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
    <div className="inline-flex flex-col gap-1.5 relative">
      {busy && (
        // Shared-seat warning. Sits above the Call button so it's the
        // first thing the seller reads. Click handler is intentionally
        // absent — the banner is a status indicator, not a navigation
        // affordance; the seller knows what to do (wait).
        <div
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold"
          style={{
            backgroundColor: "color-mix(in srgb, #DC2626 12%, transparent)",
            color: "#DC2626",
            border: "1px solid color-mix(in srgb, #DC2626 30%, transparent)",
            alignSelf: "flex-start",
          }}
        >
          <Phone size={10} />
          Aircall busy — {busy.byName} is on a call
        </div>
      )}
      <div className="inline-flex items-center gap-1.5 relative">
      <button
        onClick={handleDial}
        disabled={state === "calling" || !selectedNumberId || !!busy}
        title={busy ? `Aircall in use by ${busy.byName} — wait for it to free up.` : undefined}
        className={`flex items-center gap-1.5 rounded-lg ${padding} ${text} font-semibold transition-opacity hover:opacity-85 disabled:opacity-60 ${state === "idle" && variant === "solid" ? "animate-pulse" : ""}`}
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

      </div>
    </div>
  );
}
