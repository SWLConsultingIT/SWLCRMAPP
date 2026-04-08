"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import Link from "next/link";
import { Phone, Building2, Briefcase, ExternalLink, CheckCircle, Check, Loader } from "lucide-react";

type CallItem = {
  id: string;
  last_step_at: string | null;
  leads: { id: string; first_name: string; last_name: string; company: string; role: string; email: string; linkedin_url: string } | null;
  sellers: { name: string } | null;
};

type HistoryItem = {
  id: string;
  completed_at: string | null;
  leads: { id: string; first_name: string; last_name: string; company: string } | null;
  sellers: { name: string } | null;
};

function timeAgo(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

export default function CallsClient({ initialQueue, history }: {
  initialQueue: CallItem[];
  history: HistoryItem[];
}) {
  const router = useRouter();
  const [queue, setQueue] = useState(initialQueue);
  const [completing, setCompleting] = useState<string | null>(null);

  async function complete(campaignId: string) {
    setCompleting(campaignId);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/complete`, { method: "POST" });
      if (res.ok) {
        setQueue(q => q.filter(c => c.id !== campaignId));
        router.refresh();
      }
    } finally {
      setCompleting(null);
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: C.gold }}>Ventas</p>
        <div className="flex items-end justify-between">
          <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>Cola de Llamadas</h1>
          {queue.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border"
              style={{ backgroundColor: C.goldGlow, borderColor: `${C.gold}30` }}>
              <span className="pulse-dot w-2 h-2 rounded-full inline-block" style={{ backgroundColor: C.gold }} />
              <span className="text-xs font-semibold" style={{ color: C.gold }}>
                {queue.length} pendiente{queue.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="gold-divider mb-6" />

      <div className="grid grid-cols-3 gap-6">
        {/* Queue */}
        <div className="col-span-2 space-y-3">
          {queue.length === 0 ? (
            <div className="rounded-xl border p-14 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <Phone size={28} style={{ color: C.textDim }} className="mx-auto mb-3" />
              <p className="text-sm font-medium" style={{ color: C.textMuted }}>No hay llamadas pendientes</p>
              <p className="text-xs mt-1" style={{ color: C.textDim }}>Las llamadas aparecerán cuando el orquestador las genere</p>
            </div>
          ) : (
            queue.map((c, i) => (
              <div key={c.id} className="rounded-xl border p-5 transition-all"
                style={{
                  backgroundColor: C.card,
                  borderColor: i === 0 ? `${C.gold}40` : C.border,
                  borderTop: `2px solid ${i === 0 ? C.gold : C.border}`,
                  boxShadow: i === 0 ? `0 0 0 1px ${C.gold}15, 0 4px 24px ${C.goldGlow}` : "none",
                }}>
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-black shrink-0"
                    style={{
                      background: i === 0 ? `linear-gradient(135deg, ${C.gold}, #e8c84a)` : C.surface,
                      color: i === 0 ? "#04070d" : C.textMuted,
                    }}>
                    {i + 1}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <Link href={`/leads/${c.leads?.id}`}
                          className="font-semibold text-base hover:underline"
                          style={{ color: C.textPrimary }}>
                          {c.leads?.first_name} {c.leads?.last_name}
                        </Link>
                        <div className="flex items-center flex-wrap gap-3 mt-1.5">
                          {c.leads?.role && (
                            <span className="flex items-center gap-1 text-xs" style={{ color: C.textBody }}>
                              <Briefcase size={11} style={{ color: C.textMuted }} />
                              {c.leads.role}
                            </span>
                          )}
                          {c.leads?.company && (
                            <span className="flex items-center gap-1 text-xs" style={{ color: C.textBody }}>
                              <Building2 size={11} style={{ color: C.textMuted }} />
                              {c.leads.company}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 flex flex-col items-end gap-2">
                        <p className="text-sm font-bold" style={{ color: C.gold }}>{c.sellers?.name}</p>
                        {c.last_step_at && (
                          <p className="text-xs" style={{ color: C.textMuted }}>
                            {timeAgo(c.last_step_at)}
                          </p>
                        )}
                        <button
                          onClick={() => complete(c.id)}
                          disabled={completing === c.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-60"
                          style={{ backgroundColor: C.greenGlow, color: C.green, border: `1px solid ${C.green}30` }}
                        >
                          {completing === c.id
                            ? <Loader size={11} className="animate-spin" />
                            : <Check size={11} />}
                          Completar
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t flex items-center gap-4" style={{ borderColor: C.border }}>
                      {c.leads?.email && (
                        <a href={`mailto:${c.leads.email}`} className="text-xs transition-colors"
                          style={{ color: C.textMuted }}>
                          {c.leads.email}
                        </a>
                      )}
                      {c.leads?.linkedin_url && (
                        <a href={c.leads.linkedin_url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs font-medium"
                          style={{ color: C.cyan }}>
                          <ExternalLink size={10} />
                          Ver perfil
                        </a>
                      )}
                      {c.leads?.id && (
                        <Link href={`/leads/${c.leads.id}`}
                          className="flex items-center gap-1 text-xs font-medium ml-auto"
                          style={{ color: C.textMuted }}>
                          Ver historial →
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* History sidebar */}
        <div className="space-y-4">
          <div className="rounded-xl border overflow-hidden"
            style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.green}` }}>
            <div className="px-5 py-4 border-b flex items-center justify-between"
              style={{ borderColor: C.border, background: "linear-gradient(90deg, rgba(61,220,132,0.04) 0%, transparent 60%)" }}>
              <div className="flex items-center gap-2">
                <CheckCircle size={13} style={{ color: C.green }} />
                <h2 className="text-sm font-semibold" style={{ color: C.textPrimary }}>Completadas</h2>
              </div>
              {history.length > 0 && (
                <span className="text-xs font-medium" style={{ color: C.textMuted }}>{history.length}</span>
              )}
            </div>
            <div className="p-5">
              {history.length === 0 ? (
                <p className="text-xs py-2" style={{ color: C.textDim }}>Sin historial aún</p>
              ) : (
                <div className="space-y-3">
                  {history.map((c) => (
                    <div key={c.id} className="flex items-start gap-2 pb-3 border-b last:border-0 last:pb-0"
                      style={{ borderColor: C.surface }}>
                      <div className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: C.green }} />
                      <div className="flex-1 min-w-0">
                        <Link href={c.leads?.id ? `/leads/${c.leads.id}` : "#"}
                          className="text-sm font-medium hover:underline"
                          style={{ color: C.textPrimary }}>
                          {c.leads?.first_name} {c.leads?.last_name}
                        </Link>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-xs truncate" style={{ color: C.textMuted }}>{c.leads?.company}</p>
                          <p className="text-xs tabular-nums shrink-0 ml-2" style={{ color: C.textDim }}>
                            {c.completed_at
                              ? new Date(c.completed_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })
                              : "—"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
