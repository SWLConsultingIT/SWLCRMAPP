"use client";

// SWL-only positive-results pipeline (kanban). Buckets every "won" lead
// (positive/meeting reply OR already in Odoo) into a working stage stored in
// leads.opportunity_stage, plus a terminal "Sent to Odoo" column driven by
// transferred_to_odoo_at. Drag a card between the working columns to advance it
// — persists via PATCH /api/leads/[id]/stage. The Sent-to-Odoo column is
// system-owned (set by the Send-to-Odoo action, never a manual drag).

import { useMemo, useState } from "react";
import Link from "next/link";
import { C, N } from "@/lib/design";
import { Star, ChevronRight, Trophy, PhoneCall, MessageSquare, Loader2 } from "lucide-react";
import { OPP_STAGES, SENT_TO_ODOO, normalizeStage } from "@/lib/opportunity-stages";
import type { OpportunityLead } from "@/components/OpportunitiesTable";

const gold = "var(--brand, #c9a83a)";
const CALL_PREFIX = "[Call outcome]";
function whyParts(text: string | null | undefined) {
  if (!text) return null;
  const isCall = text.startsWith(CALL_PREFIX);
  const clean = (isCall ? text.slice(CALL_PREFIX.length) : text).trim();
  return clean ? { isCall, clean } : null;
}

const COLUMNS = [...OPP_STAGES, SENT_TO_ODOO];

export default function ResultsPipeline({ leads, search }: { leads: OpportunityLead[]; search: string }) {
  // stageById holds the live column for each lead so drag-drop is instant.
  const [stageById, setStageById] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const l of leads) m[l.id] = l.transferred ? SENT_TO_ODOO.id : normalizeStage(l.opportunity_stage);
    return m;
  });
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [hoverCol, setHoverCol] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter(l => `${l.first_name ?? ""} ${l.last_name ?? ""} ${l.company ?? ""} ${l.profile_name ?? ""}`.toLowerCase().includes(q));
  }, [leads, search]);

  const byColumn = useMemo(() => {
    const map: Record<string, OpportunityLead[]> = {};
    for (const c of COLUMNS) map[c.id] = [];
    for (const l of filtered) (map[stageById[l.id] ?? "interested"] ??= []).push(l);
    return map;
  }, [filtered, stageById]);

  async function moveTo(leadId: string, colId: string) {
    if (colId === SENT_TO_ODOO.id) return;           // terminal — only the Send-to-Odoo action lands here
    const current = stageById[leadId];
    if (current === SENT_TO_ODOO.id) return;          // already in Odoo → locked
    if (current === colId) return;
    setStageById(prev => ({ ...prev, [leadId]: colId }));
    setSaving(prev => new Set(prev).add(leadId));
    try {
      await fetch(`/api/leads/${leadId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunity_stage: colId }),
      });
    } catch { /* optimistic; a refresh will reconcile */ }
    finally { setSaving(prev => { const n = new Set(prev); n.delete(leadId); return n; }); }
  }

  return (
    <div className="w-full overflow-x-auto pb-2">
      <div className="flex gap-3" style={{ minWidth: COLUMNS.length * 272 }}>
        {COLUMNS.map(col => {
          const cards = byColumn[col.id] ?? [];
          const isOdoo = col.id === SENT_TO_ODOO.id;
          const isHover = hoverCol === col.id && !isOdoo && dragId != null;
          return (
            <div key={col.id} className="flex-1 min-w-[260px] flex flex-col rounded-2xl border"
              style={{ borderColor: isHover ? col.color : C.border, backgroundColor: C.bg, boxShadow: isHover ? `0 0 0 2px color-mix(in srgb, ${col.color} 35%, transparent)` : undefined }}
              onDragOver={e => { if (!isOdoo && dragId) { e.preventDefault(); setHoverCol(col.id); } }}
              onDragLeave={() => setHoverCol(h => (h === col.id ? null : h))}
              onDrop={e => { e.preventDefault(); const id = dragId ?? e.dataTransfer.getData("text/plain"); if (id) moveTo(id, col.id); setHoverCol(null); setDragId(null); }}
            >
              {/* Column header */}
              <div className="px-3.5 py-3 flex items-center gap-2 border-b" style={{ borderColor: C.border }}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                <span className="text-[12px] font-bold flex-1" style={{ color: C.textPrimary }}>{col.label}</span>
                <span className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-md" style={{ backgroundColor: `color-mix(in srgb, ${col.color} 12%, transparent)`, color: col.color }}>{cards.length}</span>
              </div>

              {/* Cards */}
              <div className="p-2 space-y-2 flex-1" style={{ minHeight: 140 }}>
                {cards.length === 0 ? (
                  <div className="text-center text-[11px] py-8 select-none" style={{ color: C.textDim }}>
                    {isOdoo ? "Se llenan al enviar a Odoo" : "Arrastrá acá"}
                  </div>
                ) : cards.map(lead => {
                  const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "—";
                  const w = whyParts(lead.win_text);
                  const locked = isOdoo || lead.transferred;
                  return (
                    <div key={lead.id}
                      draggable={!locked}
                      onDragStart={e => { setDragId(lead.id); e.dataTransfer.setData("text/plain", lead.id); e.dataTransfer.effectAllowed = "move"; }}
                      onDragEnd={() => { setDragId(null); setHoverCol(null); }}
                      className="rounded-xl border p-3 group relative transition-shadow hover:shadow-md"
                      style={{ backgroundColor: C.card, borderColor: C.border, borderLeftWidth: 3, borderLeftColor: col.color, cursor: locked ? "default" : "grab", opacity: dragId === lead.id ? 0.5 : 1 }}
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0" style={{ background: `linear-gradient(135deg, ${col.color}, color-mix(in srgb, ${col.color} 70%, white))`, color: "#fff" }}>
                          {(lead.company?.[0] ?? name[0] ?? "?").toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <span className="text-[12.5px] font-bold truncate" style={{ color: C.textPrimary }}>{name}</span>
                            {lead.is_priority && <Star size={9} fill={gold} stroke={gold} className="shrink-0" />}
                            {saving.has(lead.id) && <Loader2 size={10} className="animate-spin shrink-0" style={{ color: C.textDim }} />}
                          </div>
                          <p className="text-[11px] truncate" style={{ color: C.textMuted }}>{lead.role ? `${lead.role} · ` : ""}{lead.company ?? "—"}</p>
                        </div>
                      </div>

                      {w && (
                        <div className="flex items-center gap-1 mt-2" title={w.clean}>
                          {w.isCall ? <PhoneCall size={10} className="shrink-0" style={{ color: col.color }} /> : <MessageSquare size={10} className="shrink-0" style={{ color: col.color }} />}
                          <p className="text-[10.5px] italic truncate" style={{ color: C.textBody }}>“{w.clean}”</p>
                        </div>
                      )}

                      <div className="flex items-center justify-between mt-2.5">
                        {lead.transferred ? (
                          <span className="inline-flex items-center gap-1 text-[9.5px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: C.greenLight, color: C.green }}><Trophy size={8} /> In Odoo</span>
                        ) : lead.days_to_convert != null ? (
                          <span className="text-[9.5px] tabular-nums px-1.5 py-0.5 rounded" style={{ backgroundColor: `color-mix(in srgb, ${gold} 12%, transparent)`, color: gold }}>{lead.days_to_convert}d to reply</span>
                        ) : <span />}
                        <Link href={`/opportunities/${lead.id}`} className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: col.color }}>
                          Detalle <ChevronRight size={11} />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
