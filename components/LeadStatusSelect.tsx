"use client";

import { useState, useRef, useEffect } from "react";
import { C } from "@/lib/design";
import { CheckCircle, XCircle, Clock, MinusCircle, ChevronDown, Loader } from "lucide-react";

const statusConfig: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  new:         { label: "Nuevo",      color: C.cyan,     bg: C.cyanGlow,                    icon: Clock },
  contacted:   { label: "Contactado", color: C.gold,     bg: C.goldGlow,                    icon: Clock },
  qualified:   { label: "Calificado", color: C.green,    bg: C.greenGlow,                   icon: CheckCircle },
  cold:        { label: "Cold",       color: C.textBody, bg: "rgba(78,90,114,0.08)",         icon: MinusCircle },
  closed_lost: { label: "Perdido",    color: C.red,      bg: C.redGlow,                     icon: XCircle },
};

export default function LeadStatusSelect({ leadId, initialStatus, onUpdate }: {
  leadId: string;
  initialStatus: string;
  onUpdate?: (newStatus: string) => void;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function select(newStatus: string) {
    if (newStatus === status) { setOpen(false); return; }
    setOpen(false);
    setLoading(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setStatus(newStatus);
        onUpdate?.(newStatus);
      }
    } finally {
      setLoading(false);
    }
  }

  const st = statusConfig[status] ?? statusConfig.new;
  const Icon = loading ? Loader : st.icon;

  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition-all"
        style={{ backgroundColor: st.bg }}
      >
        <Icon size={11} style={{ color: st.color }} className={loading ? "animate-spin" : ""} />
        <span className="text-xs font-medium" style={{ color: st.color }}>{st.label}</span>
        <ChevronDown size={10} style={{ color: st.color, opacity: 0.6 }} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 rounded-lg border overflow-hidden min-w-36 shadow-xl"
          style={{ backgroundColor: C.surface, borderColor: C.border }}>
          {Object.entries(statusConfig).map(([key, cfg]) => {
            const Ic = cfg.icon;
            return (
              <button key={key} onClick={() => select(key)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-left transition-colors"
                style={{
                  color: cfg.color,
                  backgroundColor: status === key ? cfg.bg : "transparent",
                }}
                onMouseEnter={e => { if (status !== key) (e.currentTarget as HTMLElement).style.backgroundColor = cfg.bg; }}
                onMouseLeave={e => { if (status !== key) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
              >
                <Ic size={11} />
                {cfg.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
