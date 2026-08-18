"use client";

// L-9 — "Volver a llamar": the call-back reminder list, a subtab inside
// Queue → Calls. Driven by leads.callback_at (set from the post-call popup).
// Groups Overdue / Today / Upcoming, filters per seller (default: the current
// user's own), and lets the seller open the lead to dial, mark the recall done
// (clears callback_at), or reschedule it.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Phone, Check, Clock, RotateCcw, X, Loader2 } from "lucide-react";
import { C } from "@/lib/design";

export type RecallItem = {
  leadId: string;
  leadName: string;
  company: string | null;
  phone: string | null;
  callbackAt: string;
  note: string | null;
  sellerName: string | null;
};

const gold = "var(--brand, #c9a83a)";

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

function whenLabel(iso: string, now: Date): { top: string; bottom: string; bucket: "over" | "today" | "up" } {
  const d = new Date(iso);
  const today = startOfDay(now).getTime();
  const day = startOfDay(d).getTime();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.getTime() < now.getTime()) {
    // overdue
    const dayLabel = day === today ? "Hoy" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    return { top: dayLabel, bottom: time, bucket: "over" };
  }
  if (day === today) return { top: "Hoy", bottom: time, bucket: "today" };
  return { top: d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }), bottom: time, bucket: "up" };
}

const BUCKET = {
  over:  { label: "Atrasadas", dot: "🔴", color: C.red,      mk: C.red },
  today: { label: "Hoy",       dot: "🟡", color: "#F0A73A",  mk: "#F0A73A" },
  up:    { label: "Próximas",  dot: "⚪", color: C.textMuted, mk: "#3a3f5e" },
} as const;

export default function RecallList({ recalls, mySellerNames = [] }: { recalls: RecallItem[]; mySellerNames?: string[] }) {
  const router = useRouter();
  const now = useMemo(() => new Date(), []);
  const mine = new Set(mySellerNames);
  const [sellerFilter, setSellerFilter] = useState<string>(mySellerNames.length > 0 ? "__me__" : "all");
  const [done, setDone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const [rsDate, setRsDate] = useState("");
  const [rsTime, setRsTime] = useState("10:00");

  const sellerNames = useMemo(
    () => Array.from(new Set(recalls.map(r => r.sellerName).filter((n): n is string => !!n))).sort(),
    [recalls],
  );

  const visible = recalls.filter(r => {
    if (done.has(r.leadId)) return false;
    if (sellerFilter === "all") return true;
    if (sellerFilter === "__me__") return r.sellerName ? mine.has(r.sellerName) : false;
    return r.sellerName === sellerFilter;
  });

  const groups = useMemo(() => {
    const g: Record<"over" | "today" | "up", (RecallItem & { w: ReturnType<typeof whenLabel> })[]> = { over: [], today: [], up: [] };
    for (const r of visible) {
      const w = whenLabel(r.callbackAt, now);
      g[w.bucket].push({ ...r, w });
    }
    return g;
  }, [visible, now]);

  async function markDone(leadId: string) {
    setBusy(leadId);
    try {
      await fetch(`/api/leads/${leadId}/callback`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callbackAt: null }),
      });
      setDone(s => new Set(s).add(leadId));
      router.refresh();
    } finally { setBusy(null); }
  }

  function openReschedule(r: RecallItem) {
    const d = new Date(r.callbackAt);
    setRsDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    setRsTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    setRescheduling(r.leadId);
  }

  async function saveReschedule(leadId: string) {
    setBusy(leadId);
    try {
      const callbackAt = new Date(`${rsDate}T${rsTime}`).toISOString();
      await fetch(`/api/leads/${leadId}/callback`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callbackAt }),
      });
      setRescheduling(null);
      router.refresh();
    } finally { setBusy(null); }
  }

  const total = visible.length;

  return (
    <div>
      {/* Seller filter */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap text-xs">
        <RotateCcw size={12} style={{ color: C.textDim }} />
        <span style={{ color: C.textMuted }}>Seller:</span>
        <div className="flex gap-1 rounded-lg border p-1" style={{ borderColor: C.border, backgroundColor: C.card }}>
          {mySellerNames.length > 0 && (
            <FilterPill active={sellerFilter === "__me__"} onClick={() => setSellerFilter("__me__")} label="Yo" />
          )}
          <FilterPill active={sellerFilter === "all"} onClick={() => setSellerFilter("all")} label="Todos" />
          {sellerNames.filter(n => !mine.has(n)).map(n => (
            <FilterPill key={n} active={sellerFilter === n} onClick={() => setSellerFilter(n)} label={n} />
          ))}
        </div>
      </div>

      {total === 0 ? (
        <div className="rounded-2xl border py-12 px-6 text-center max-w-xl mx-auto" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <div className="w-12 h-12 mx-auto mb-3 rounded-2xl flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, ${C.green} 12%, transparent)` }}>
            <Check size={22} style={{ color: C.green }} />
          </div>
          <p className="text-sm font-bold mb-1.5" style={{ color: C.textPrimary }}>Sin recalls pendientes</p>
          <p className="text-xs" style={{ color: C.textMuted }}>Cuando marques &ldquo;Volver a llamar&rdquo; en una llamada, el lead aparece acá.</p>
        </div>
      ) : (
        (["over", "today", "up"] as const).map(bk => {
          const rows = groups[bk];
          if (rows.length === 0) return null;
          const meta = BUCKET[bk];
          return (
            <div key={bk} className="mb-1">
              <p className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-wider mt-3 mb-2" style={{ color: meta.color }}>
                {meta.dot} {meta.label} <span className="font-semibold" style={{ color: C.textDim, letterSpacing: 0 }}>· {rows.length}</span>
              </p>
              <div className="space-y-1.5">
                {rows.map(r => (
                  <div key={r.leadId} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border relative" style={{ backgroundColor: C.surface, borderColor: C.border }}>
                    <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full" style={{ backgroundColor: meta.mk }} aria-hidden />
                    <div className="min-w-0 flex-1 pl-1.5">
                      <p className="text-[13px] font-semibold truncate" style={{ color: C.textPrimary }}>{r.leadName}</p>
                      <p className="text-[11px] truncate" style={{ color: C.textMuted }}>
                        {r.company ?? ""}{r.sellerName ? ` · ${r.sellerName}` : ""}
                      </p>
                      {r.note && <p className="text-[11px] italic truncate mt-0.5" style={{ color: C.textDim, maxWidth: 320 }}>&ldquo;{r.note}&rdquo;</p>}
                    </div>

                    {rescheduling === r.leadId ? (
                      <div className="flex items-end gap-1.5">
                        <input type="date" value={rsDate} onChange={e => setRsDate(e.target.value)} className="rounded-md border px-2 py-1 text-[11px] outline-none" style={{ backgroundColor: C.bg, borderColor: C.border, color: C.textPrimary, colorScheme: "dark" }} />
                        <input type="time" value={rsTime} onChange={e => setRsTime(e.target.value)} className="rounded-md border px-2 py-1 text-[11px] outline-none" style={{ backgroundColor: C.bg, borderColor: C.border, color: C.textPrimary, colorScheme: "dark" }} />
                        <button onClick={() => saveReschedule(r.leadId)} disabled={busy === r.leadId} className="w-7 h-7 rounded-md grid place-items-center" style={{ backgroundColor: gold, color: "#1A1505" }} title="Guardar">
                          {busy === r.leadId ? <Loader2 size={12} className="animate-spin" /> : <Check size={13} />}
                        </button>
                        <button onClick={() => setRescheduling(null)} className="w-7 h-7 rounded-md border grid place-items-center" style={{ borderColor: C.border, color: C.textDim }} title="Cancelar"><X size={12} /></button>
                      </div>
                    ) : (
                      <>
                        <div className="text-[11.5px] font-semibold tabular-nums text-right shrink-0 leading-tight" style={{ color: meta.color }}>
                          {r.w.top}<br />{r.w.bottom}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button onClick={() => router.push(`/leads/${r.leadId}`)} className="w-8 h-8 rounded-lg border grid place-items-center transition-colors" style={{ borderColor: `color-mix(in srgb, ${C.green} 45%, transparent)`, color: C.green }} title="Abrir para llamar"><Phone size={14} /></button>
                          <button onClick={() => markDone(r.leadId)} disabled={busy === r.leadId} className="w-8 h-8 rounded-lg border grid place-items-center transition-colors hover:opacity-80" style={{ borderColor: C.border, color: C.textMuted }} title="Hecho">
                            {busy === r.leadId ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
                          </button>
                          <button onClick={() => openReschedule(r)} className="w-8 h-8 rounded-lg border grid place-items-center transition-colors hover:opacity-80" style={{ borderColor: C.border, color: C.textMuted }} title="Reprogramar"><Clock size={14} /></button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function FilterPill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="text-[11.5px] font-semibold px-2.5 py-1 rounded-md transition-colors" style={{ backgroundColor: active ? C.surface : "transparent", color: active ? C.textPrimary : C.textMuted, boxShadow: active ? `0 0 0 1px ${C.border}` : "none" }}>
      {label}
    </button>
  );
}

// Count of "due" recalls (overdue + today) for a subtab badge.
export function recallDueCount(recalls: RecallItem[], mySellerNames: string[] = []): number {
  const now = new Date();
  const mine = new Set(mySellerNames);
  return recalls.filter(r => {
    if (mySellerNames.length > 0 && (!r.sellerName || !mine.has(r.sellerName))) return false;
    const b = whenLabel(r.callbackAt, now).bucket;
    return b === "over" || b === "today";
  }).length;
}
