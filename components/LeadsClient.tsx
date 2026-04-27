"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import {
  Link2, Mail, Phone, MessageCircle,
  CheckCircle, XCircle, Clock, MinusCircle,
  Search, Download, ChevronDown, MessageSquare, Users,
  ChevronUp, ChevronsUpDown, CheckSquare, Square, Loader,
} from "lucide-react";
import LeadStatusSelect from "@/components/LeadStatusSelect";

type Lead = {
  id: string; first_name: string; last_name: string; company: string;
  role: string; email: string; linkedin_url: string; status: string;
  assigned_seller: string; allow_linkedin: boolean; allow_email: boolean;
  allow_whatsapp: boolean; allow_call: boolean; n8n_flow: string;
  created_at: string; updated_at: string; odoo_lead_id: number | null;
  messages_sent: number; reply_count: number; has_positive: boolean;
  has_reply: boolean; last_activity: string; channels_active: string[];
};

const PAGE_SIZE = 50;

const statusConfig: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  new:           { label: "New",          color: C.blue,      bg: C.blueLight,    icon: Clock },
  contacted:     { label: "Contacted",    color: C.orange,    bg: C.orangeLight,  icon: Clock },
  connected:     { label: "Connected",    color: C.accent,    bg: C.accentLight,  icon: CheckCircle },
  responded:     { label: "Responded",    color: C.green,     bg: C.greenLight,   icon: MessageSquare },
  qualified:     { label: "Qualified",    color: C.green,     bg: C.greenLight,   icon: CheckCircle },
  proposal_sent: { label: "Proposal",     color: C.accent,    bg: C.accentLight,  icon: CheckCircle },
  closed_won:    { label: "Won",          color: C.green,     bg: C.greenLight,   icon: CheckCircle },
  closed_lost:   { label: "Lost",         color: C.red,       bg: C.redLight,     icon: XCircle },
  nurturing:     { label: "Nurturing",    color: C.textMuted, bg: "#F3F4F6",      icon: MinusCircle },
};

function relativeTime(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2)  return "ahora";
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `hace ${d}d`;
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

function exportCSV(leads: Lead[]) {
  const headers = ["Nombre","Email","Empresa","Rol","Estado","Seller","Mensajes","Respuestas","Odoo","Creado"];
  const rows = leads.map(l => [
    `${l.first_name} ${l.last_name}`, l.email ?? "", l.company ?? "", l.role ?? "",
    l.status, l.assigned_seller ?? "", l.messages_sent, l.reply_count,
    l.odoo_lead_id ?? "", new Date(l.created_at).toLocaleDateString("es-AR"),
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "leads_swl.csv"; a.click();
  URL.revokeObjectURL(url);
}

const ALL = "todos";

type SortKey = "last_activity" | "messages_sent" | "reply_count" | "first_name" | "company";

function SortIcon({ col, sortCol, sortDir }: { col: SortKey; sortCol: SortKey; sortDir: "asc"|"desc" }) {
  if (sortCol !== col) return <ChevronsUpDown size={11} style={{ color: C.textDim }} />;
  return sortDir === "asc"
    ? <ChevronUp size={11} style={{ color: C.gold }} />
    : <ChevronDown size={11} style={{ color: C.gold }} />;
}

export default function LeadsClient({ leads, sellers }: { leads: Lead[]; sellers: string[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState(ALL);
  const [filterSeller, setFilterSeller] = useState(ALL);
  const [filterChannel, setFilterChannel] = useState(ALL);
  const [sortCol, setSortCol] = useState<SortKey>("last_activity");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("desc");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});

  const leadsWithOverrides = useMemo(() =>
    leads.map(l => ({ ...l, status: statusOverrides[l.id] ?? l.status })),
    [leads, statusOverrides]
  );

  function toggleSort(col: SortKey) {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
    setPage(0);
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return leadsWithOverrides
      .filter(l => {
        const matchSearch = !q || [l.first_name, l.last_name, l.company, l.email, l.role].some(v => v?.toLowerCase().includes(q));
        const matchStatus  = filterStatus  === ALL || l.status === filterStatus;
        const matchSeller  = filterSeller  === ALL || l.assigned_seller === filterSeller;
        const matchChannel = filterChannel === ALL || l.channels_active.includes(filterChannel);
        return matchSearch && matchStatus && matchSeller && matchChannel;
      })
      .sort((a, b) => {
        const va = a[sortCol] ?? "";
        const vb = b[sortCol] ?? "";
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [leadsWithOverrides, search, filterStatus, filterSeller, filterChannel, sortCol, sortDir]);

  const counts = useMemo(() =>
    leadsWithOverrides.reduce<Record<string, number>>((acc, l) => {
      acc[l.status] = (acc[l.status] ?? 0) + 1; return acc;
    }, {}), [leadsWithOverrides]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageIds = new Set(paginated.map(l => l.id));
  const allPageSelected = paginated.length > 0 && paginated.every(l => selected.has(l.id));

  function toggleSelectAll() {
    setSelected(prev => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach(id => next.delete(id));
      else pageIds.forEach(id => next.add(id));
      return next;
    });
  }

  function toggleSelect(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  const bulkChangeStatus = useCallback(async (newStatus: string) => {
    setBulkLoading(true);
    const ids = [...selected];
    await Promise.all(ids.map(id =>
      fetch(`/api/leads/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
    ));
    setStatusOverrides(prev => {
      const next = { ...prev };
      ids.forEach(id => { next[id] = newStatus; });
      return next;
    });
    setSelected(new Set());
    setBulkLoading(false);
  }, [selected]);

  function changeFilter(setter: (v: string) => void, val: string) {
    setter(val); setPage(0); setSelected(new Set());
  }

  return (
    <div className="p-8 w-full">
      {/* Header */}
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: C.gold }}>Database</p>
        <div className="flex items-end justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>Leads</h1>
            <span className="text-sm px-2 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: C.goldGlow, color: C.gold }}>{leads.length}</span>
          </div>
          <div className="flex items-center gap-3">
            {filtered.length !== leads.length && (
              <span className="text-sm" style={{ color: C.textMuted }}>{filtered.length} filtered</span>
            )}
            <button onClick={() => exportCSV(filtered)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border"
              style={{ backgroundColor: C.goldGlow, borderColor: `color-mix(in srgb, ${C.gold} 19%, transparent)`, color: C.gold }}>
              <Download size={12} /> Export CSV
            </button>
          </div>
        </div>
      </div>

      <div className="h-px mb-5" style={{ background: `linear-gradient(90deg, ${C.gold} 0%, color-mix(in srgb, var(--brand, #c9a83a) 15%, transparent) 40%, transparent 100%)` }} />

      {/* Status chips */}
      <div className="flex flex-wrap gap-2 mb-5">
        <button onClick={() => changeFilter(setFilterStatus, ALL)}
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-[opacity,transform,box-shadow,background-color,border-color]"
          style={{ backgroundColor: filterStatus === ALL ? C.accentLight : "transparent", color: filterStatus === ALL ? C.accent : C.textMuted, borderColor: filterStatus === ALL ? `${C.accent}30` : C.border }}>
          <Users size={11} /> Todos <span className="font-bold">{leads.length}</span>
        </button>
        {(Object.entries(statusConfig) as [string, typeof statusConfig[string]][]).map(([key, { label, color, bg, icon: Icon }]) => (
          <button key={key} onClick={() => changeFilter(setFilterStatus, filterStatus === key ? ALL : key)}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium border transition-[opacity,transform,box-shadow,background-color,border-color]"
            style={{ backgroundColor: filterStatus === key ? bg : "transparent", color: filterStatus === key ? color : C.textMuted, borderColor: filterStatus === key ? `${color}30` : C.border }}>
            <Icon size={11} /> {label} <span className="font-bold">{counts[key] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.textMuted }} />
          <input type="text" placeholder="Buscar nombre, empresa, email..." value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            className="w-full pl-8 pr-3 py-2 rounded-lg border text-sm outline-none"
            style={{ backgroundColor: C.card, borderColor: C.border, color: C.textPrimary }} />
        </div>
        {[
          { value: filterSeller, setter: setFilterSeller, options: sellers.map(s => ({ v: s, l: s })), placeholder: "Todos los sellers" },
          { value: filterChannel, setter: setFilterChannel, options: [{ v:"linkedin",l:"LinkedIn"},{v:"email",l:"Email"},{v:"whatsapp",l:"WhatsApp"},{v:"call",l:"Call"}], placeholder: "Todos los canales" },
        ].map(({ value, setter, options, placeholder }, i) => (
          <div key={i} className="relative">
            <select value={value} onChange={e => changeFilter(setter, e.target.value)}
              className="appearance-none pl-3 pr-7 py-2 rounded-lg border text-sm outline-none"
              style={{ backgroundColor: C.card, borderColor: C.border, color: value === ALL ? C.textMuted : C.textPrimary }}>
              <option value={ALL}>{placeholder}</option>
              {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: C.textMuted }} />
          </div>
        ))}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-4 px-4 py-2.5 rounded-xl border fade-in"
          style={{ backgroundColor: C.accentLight, borderColor: `${C.accent}25` }}>
          <span className="text-sm font-semibold" style={{ color: C.gold }}>
            {selected.size} seleccionado{selected.size !== 1 ? "s" : ""}
          </span>
          <span className="text-xs" style={{ color: C.textMuted }}>Cambiar estado a:</span>
          {Object.entries(statusConfig).map(([key, { label, color }]) => (
            <button key={key} onClick={() => bulkChangeStatus(key)} disabled={bulkLoading}
              className="text-xs px-2.5 py-1 rounded-lg font-medium transition-[opacity,transform,box-shadow,background-color,border-color] disabled:opacity-50"
              style={{ backgroundColor: C.card, color, border: `1px solid ${color}25` }}>
              {label}
            </button>
          ))}
          {bulkLoading && <Loader size={13} style={{ color: C.gold }} className="animate-spin ml-auto" />}
          <button onClick={() => setSelected(new Set())}
            className="ml-auto text-xs" style={{ color: C.textMuted }}>✕ Limpiar</button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border overflow-hidden"
        style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.gold}` }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}`, background: `linear-gradient(90deg, color-mix(in srgb, var(--brand, #c9a83a) 4%, transparent) 0%, transparent 50%)` }}>
              <th className="px-4 py-3 w-8">
                <button onClick={toggleSelectAll}>
                  {allPageSelected
                    ? <CheckSquare size={14} style={{ color: C.gold }} />
                    : <Square size={14} style={{ color: C.textDim }} />}
                </button>
              </th>
              {[
                { label: "Nombre", col: "first_name" as SortKey },
                { label: "Empresa / Rol", col: "company" as SortKey },
                { label: "Canales", col: null },
                { label: "Mensajes", col: "messages_sent" as SortKey },
                { label: "Estado", col: null },
                { label: "Seller", col: null },
                { label: "Última actividad", col: "last_activity" as SortKey },
              ].map(({ label, col }) => (
                <th key={label}
                  className={`text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider ${col ? "cursor-pointer select-none" : ""}`}
                  style={{ color: sortCol === col ? C.accent : C.textMuted }}
                  onClick={() => col && toggleSort(col)}>
                  <div className="flex items-center gap-1">
                    {label}
                    {col && <SortIcon col={col} sortCol={sortCol} sortDir={sortDir} />}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.map((lead) => (
              <tr key={lead.id} className="table-row-hover"
                style={{ borderBottom: `1px solid ${C.surface}`, backgroundColor: selected.has(lead.id) ? `${C.accentLight}` : undefined }}
                onClick={() => router.push(`/leads/${lead.id}`)}>
                <td className="px-4 py-3" onClick={e => toggleSelect(lead.id, e)}>
                  {selected.has(lead.id)
                    ? <CheckSquare size={14} style={{ color: C.gold }} />
                    : <Square size={14} style={{ color: C.textDim }} />}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ backgroundColor: C.accentLight, color: C.accent }}>
                      {lead.first_name?.[0]}{lead.last_name?.[0]}
                    </div>
                    <div>
                      <p className="font-medium" style={{ color: C.textPrimary }}>{lead.first_name} {lead.last_name}</p>
                      <p className="text-xs" style={{ color: C.textDim }}>{lead.email}</p>
                    </div>
                    {lead.has_positive && (
                      <span className="ml-1 text-xs px-1.5 py-0.5 rounded font-semibold"
                        style={{ backgroundColor: C.greenLight, color: C.green }}>★</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <p className="text-sm font-medium" style={{ color: C.textBody }}>{lead.company ?? "—"}</p>
                  <p className="text-xs truncate max-w-36" style={{ color: C.textMuted }}>{lead.role ?? ""}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Link2          size={13} style={{ color: lead.allow_linkedin  ? C.linkedin    : C.textDim }} />
                    <Mail           size={13} style={{ color: lead.allow_email     ? C.green   : C.textDim }} />
                    <MessageCircle  size={13} style={{ color: lead.allow_whatsapp  ? "#22c55e" : C.textDim }} />
                    <Phone          size={13} style={{ color: lead.allow_call      ? C.accent    : C.textDim }} />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-semibold tabular-nums" style={{ color: C.gold }}>{lead.messages_sent}</span>
                      <span className="text-xs" style={{ color: C.textMuted }}>env</span>
                    </div>
                    {lead.reply_count > 0 && (
                      <div className="flex items-center gap-1">
                        <MessageSquare size={11} style={{ color: lead.has_positive ? C.green : C.linkedin }} />
                        <span className="text-sm font-semibold tabular-nums" style={{ color: lead.has_positive ? C.green : C.linkedin }}>{lead.reply_count}</span>
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                  <LeadStatusSelect leadId={lead.id} initialStatus={lead.status}
                    onUpdate={(s) => setStatusOverrides(prev => ({ ...prev, [lead.id]: s }))} />
                  {lead.odoo_lead_id && (
                    <p className="text-xs mt-0.5 font-mono" style={{ color: C.gold }}>Odoo #{lead.odoo_lead_id}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-xs" style={{ color: C.textBody }}>{lead.assigned_seller ?? "—"}</td>
                <td className="px-4 py-3 text-xs tabular-nums" style={{ color: C.textMuted }}>{relativeTime(lead.last_activity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-sm" style={{ color: C.textMuted }}>Sin leads con esos filtros</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs" style={{ color: C.textMuted }}>
            Mostrando {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} de {filtered.length}
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(0)} disabled={page === 0}
              className="px-2 py-1 rounded text-xs disabled:opacity-30"
              style={{ backgroundColor: C.surface, color: C.textMuted }}>«</button>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-2 py-1 rounded text-xs disabled:opacity-30"
              style={{ backgroundColor: C.surface, color: C.textMuted }}>‹</button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const start = Math.max(0, Math.min(page - 2, totalPages - 5));
              const p = start + i;
              return (
                <button key={p} onClick={() => setPage(p)}
                  className="w-7 h-7 rounded text-xs font-medium"
                  style={{ backgroundColor: p === page ? C.gold : "#F3F4F6", color: p === page ? "#fff" : C.textMuted }}>
                  {p + 1}
                </button>
              );
            })}
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
              className="px-2 py-1 rounded text-xs disabled:opacity-30"
              style={{ backgroundColor: C.surface, color: C.textMuted }}>›</button>
            <button onClick={() => setPage(totalPages - 1)} disabled={page === totalPages - 1}
              className="px-2 py-1 rounded text-xs disabled:opacity-30"
              style={{ backgroundColor: C.surface, color: C.textMuted }}>»</button>
          </div>
        </div>
      )}
    </div>
  );
}
