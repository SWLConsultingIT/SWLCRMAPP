"use client";

import { useState, useEffect } from "react";
import { Phone, Loader2, CheckCheck, PhoneOff, ChevronDown } from "lucide-react";
import { C } from "@/lib/design";

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

type Props = {
  phone: string | null;
  leadId: string;
  size?: "sm" | "md" | "lg";
  variant?: "solid" | "soft";
  defaultNumberId?: number | null;
};

export default function CallButton({ phone, leadId, size = "md", variant = "solid", defaultNumberId }: Props) {
  const [numbers, setNumbers] = useState<AircallNumber[]>([]);
  const [selectedNumberId, setSelectedNumberId] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "calling" | "called" | "error">("idle");
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    fetch("/api/aircall/numbers")
      .then(r => r.json())
      .then((d: { numbers: AircallNumber[] }) => {
        setNumbers(d.numbers ?? []);
        const preferred = defaultNumberId && d.numbers?.find(n => n.id === defaultNumberId);
        if (preferred) setSelectedNumberId(preferred.id);
        else if (d.numbers?.[0]) setSelectedNumberId(d.numbers[0].id);
      })
      .catch(() => {});
  }, [defaultNumberId]);

  if (!phone) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs"
        style={{ backgroundColor: "#F3F4F6", color: C.textDim }}
      >
        <PhoneOff size={12} /> No phone number
      </span>
    );
  }

  async function handleDial() {
    if (state === "calling") return;
    setState("calling");
    try {
      const res = await fetch("/api/aircall/dial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          leadId,
          numberId: selectedNumberId,
          aircallUserId: DEFAULT_AIRCALL_USER_ID,
        }),
      });
      if (res.ok) {
        setState("called");
        setTimeout(() => setState("idle"), 4000);
      } else {
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
    : { backgroundColor: "#FFF7ED", color: "#EA580C", border: "1px solid #FED7AA" };

  const selected = numbers.find(n => n.id === selectedNumberId);

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
          : <><Phone size={iconSize} /> Call {phone}</>
        }
      </button>

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
              <span>{selected.country}</span>
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
          <div className="px-3 py-2 border-b" style={{ borderColor: C.border }}>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>Call from</p>
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
  );
}
