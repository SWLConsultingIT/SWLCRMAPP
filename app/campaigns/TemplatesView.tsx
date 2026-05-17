"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FileText, Loader2, Search, Share2, Mail, Phone, MessageSquare, X,
  Trash2, Play, Plus, MoreHorizontal, Copy, FolderTree, Clock, List,
  ChevronDown, ChevronRight, AlertCircle, ArrowRight,
} from "lucide-react";
import { C } from "@/lib/design";
import EmptyState from "@/components/EmptyState";

// 2026-05-17 — Templates organized by ICP.
// Default view: "By ICP" with collapsible sections per ICP. A "Needs ICP"
// section sits pinned at the top when there are legacy rows with NULL
// icp_profile_id, with a one-click "Assign ICP" menu so the tenant can
// backfill at their own pace without blocking the UI.

const gold = "var(--brand, #c9a83a)";
const ACCENT = gold;

type TemplateListItem = {
  id: string;
  name: string;
  description: string | null;
  channels: string[];
  tags: string[];
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  icp_profile_id: string | null;
  tone_preset?: string | null;
  rewrite_mode?: string | null;
};

type IcpOption = { id: string; profile_name: string };
type ViewMode = "by_icp" | "recent" | "all";

const channelMeta: Record<string, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2,        color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,          color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,         color: "#F97316", label: "Call" },
  whatsapp: { icon: MessageSquare, color: "#25D366", label: "WhatsApp" },
};

function ChannelChip({ ch }: { ch: string }) {
  const m = channelMeta[ch];
  if (!m) return null;
  const Icon = m.icon;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
      style={{ backgroundColor: `${m.color}12`, color: m.color }}>
      <Icon size={9} /> {m.label}
    </span>
  );
}

function timeAgo(iso: string | null) {
  if (!iso) return "Never used";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function TemplatesView() {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateListItem[] | null>(null);
  const [icps, setIcps] = useState<IcpOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("by_icp");
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      if (channelFilter) params.set("channel", channelFilter);
      const [tplRes, icpRes] = await Promise.all([
        fetch(`/api/templates?${params.toString()}`, { cache: "no-store" }),
        fetch("/api/icp", { cache: "no-store" }),
      ]);
      const tplBody = await tplRes.json().catch(() => ({}));
      const icpBody = await icpRes.json().catch(() => ({}));
      if (!tplRes.ok) {
        setErr(tplBody.error ?? `Failed (${tplRes.status})`);
        return;
      }
      setTemplates(tplBody.templates ?? []);
      setIcps((icpBody.icps ?? []).map((i: any) => ({ id: i.id, profile_name: i.profile_name ?? "Untitled ICP" })));
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, channelFilter]);

  // Close row menu on outside click.
  useEffect(() => {
    if (!menuOpenId) return;
    const handler = () => setMenuOpenId(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [menuOpenId]);

  // Group templates by ICP for the "By ICP" view. Returns [{icp, templates}]
  // sorted by total usage_count desc, with the special "needs_icp" bucket
  // pinned first when present.
  const groupedByIcp = useMemo(() => {
    const list = templates ?? [];
    const byIcp = new Map<string | null, TemplateListItem[]>();
    for (const t of list) {
      const k = t.icp_profile_id;
      if (!byIcp.has(k)) byIcp.set(k, []);
      byIcp.get(k)!.push(t);
    }
    const icpMap = new Map(icps.map(i => [i.id, i.profile_name]));
    const groups: Array<{ key: string; label: string; items: TemplateListItem[]; isOrphan: boolean }> = [];

    // Pinned orphan bucket
    const orphans = byIcp.get(null);
    if (orphans && orphans.length > 0) {
      groups.push({ key: "needs_icp", label: "Needs ICP", items: orphans, isOrphan: true });
    }

    // Real ICPs — sort by total usage desc, then profile_name asc
    const realKeys = Array.from(byIcp.keys()).filter((k): k is string => k !== null);
    realKeys.sort((a, b) => {
      const ua = (byIcp.get(a) ?? []).reduce((s, t) => s + (t.usage_count ?? 0), 0);
      const ub = (byIcp.get(b) ?? []).reduce((s, t) => s + (t.usage_count ?? 0), 0);
      if (ub !== ua) return ub - ua;
      return (icpMap.get(a) ?? "").localeCompare(icpMap.get(b) ?? "");
    });
    for (const k of realKeys) {
      groups.push({ key: k, label: icpMap.get(k) ?? "(deleted ICP)", items: byIcp.get(k) ?? [], isOrphan: false });
    }
    return groups;
  }, [templates, icps]);

  const flatRecent = useMemo(() => {
    const list = [...(templates ?? [])];
    return list.sort((a, b) => {
      const av = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
      const bv = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
      return bv - av;
    });
  }, [templates]);

  async function handleDelete(t: TemplateListItem) {
    if (busyId) return;
    if (!confirm(`Delete template "${t.name}"? This can't be undone.`)) return;
    setBusyId(t.id);
    try {
      const res = await fetch(`/api/templates/${t.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? "Couldn't delete");
        return;
      }
      setTemplates(prev => (prev ?? []).filter(x => x.id !== t.id));
    } catch (e: any) {
      alert(e?.message ?? "Couldn't delete");
    } finally {
      setBusyId(null);
    }
  }

  async function handleAssignIcp(t: TemplateListItem, icpId: string) {
    if (busyId) return;
    setBusyId(t.id);
    try {
      const res = await fetch(`/api/templates/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icp_profile_id: icpId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { alert(body.error ?? "Couldn't move"); return; }
      setTemplates(prev => (prev ?? []).map(x => x.id === t.id ? { ...x, icp_profile_id: icpId } : x));
      setMenuOpenId(null);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDuplicateToIcp(t: TemplateListItem, icpId: string) {
    if (busyId) return;
    setBusyId(t.id);
    try {
      const res = await fetch(`/api/templates/${t.id}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icp_profile_id: icpId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { alert(body.error ?? "Couldn't duplicate"); return; }
      // Reload so the new template shows up under its new ICP section.
      void load();
      setMenuOpenId(null);
    } finally {
      setBusyId(null);
    }
  }

  function handleUse(t: TemplateListItem) {
    try { sessionStorage.setItem("swl-pending-template-id", t.id); } catch { /* private mode */ }
    router.push("/campaigns/new");
  }

  function toggleSection(key: string) {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div>
      {/* Toolbar: view tabs + search + filters + new */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        {/* View mode tabs */}
        <div className="flex items-center gap-0.5 rounded-lg p-0.5 border"
          style={{ borderColor: C.border, backgroundColor: C.bg }}>
          {([
            { id: "by_icp", label: "By ICP", icon: FolderTree },
            { id: "recent", label: "Recent", icon: Clock },
            { id: "all",    label: "All",    icon: List },
          ] as const).map(t => {
            const Icon = t.icon;
            const active = view === t.id;
            return (
              <button key={t.id} onClick={() => setView(t.id)}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-md inline-flex items-center gap-1.5 transition-colors"
                style={{
                  backgroundColor: active ? C.card : "transparent",
                  color: active ? C.textPrimary : C.textMuted,
                  boxShadow: active ? `0 0 0 1px ${C.border}` : "none",
                }}>
                <Icon size={11} /> {t.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 w-full sm:w-64"
            style={{ borderColor: C.border, backgroundColor: C.card }}>
            <Search size={13} style={{ color: C.textDim }} />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search templates..."
              className="bg-transparent text-sm outline-none flex-1"
              style={{ color: C.textPrimary }} />
            {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {(["linkedin", "email", "call", "whatsapp"] as const).map(ch => {
              const m = channelMeta[ch];
              const Icon = m.icon;
              const active = channelFilter === ch;
              return (
                <button key={ch}
                  onClick={() => setChannelFilter(active ? null : ch)}
                  className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md border transition-colors"
                  style={{
                    backgroundColor: active ? `${m.color}18` : "transparent",
                    borderColor: active ? `${m.color}40` : C.border,
                    color: active ? m.color : C.textMuted,
                  }}>
                  <Icon size={11} /> {m.label}
                </button>
              );
            })}
          </div>
          <Link href="/campaigns/templates/new"
            className="text-xs font-semibold px-3 py-1.5 rounded-md inline-flex items-center gap-1.5"
            style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#1A1A2E" }}>
            <Plus size={12} /> New Template
          </Link>
        </div>
      </div>

      {/* Body */}
      {loading && templates === null ? (
        <div className="flex items-center justify-center py-16" style={{ color: C.textMuted }}>
          <Loader2 size={16} className="animate-spin mr-2" />
          <span className="text-sm">Loading templates…</span>
        </div>
      ) : err ? (
        <div className="rounded-2xl border py-8 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <p className="text-sm" style={{ color: C.red }}>{err}</p>
          <button onClick={load} className="text-xs mt-2 underline" style={{ color: gold }}>Try again</button>
        </div>
      ) : (templates ?? []).length === 0 ? (
        (search || channelFilter) ? (
          <EmptyState
            icon={FileText}
            title="No templates match"
            description="Try clearing the search or channel filter to see your full library."
            accent="var(--brand, #c9a83a)"
            accentSoft="color-mix(in srgb, var(--brand, #c9a83a) 12%, transparent)"
          />
        ) : (
          <EmptyState
            icon={FileText}
            title="No templates yet"
            description="Build a reusable outreach sequence + messages once, then apply it to any future campaign in one click. Templates support PDF attachments so the AI can pull context from your sales decks."
            primaryCta={{ label: "Create your first template", href: "/campaigns/templates/new" }}
            accent="var(--brand, #c9a83a)"
            accentSoft="color-mix(in srgb, var(--brand, #c9a83a) 12%, transparent)"
          />
        )
      ) : view === "by_icp" ? (
        <div className="space-y-3">
          {groupedByIcp.map(group => {
            const collapsed = collapsedSections[group.key] ?? false;
            const isOrphan = group.isOrphan;
            return (
              // overflow-visible (not hidden): the row-action dropdown needs
              // to escape the section box. Header button gets explicit
              // rounded-t corners so its hover bg still respects the card
              // shape; bottom rows are subtle enough that the missing clip
              // isn't visible.
              <div key={group.key} className="rounded-xl border"
                style={{
                  backgroundColor: C.card,
                  borderColor: isOrphan ? "#FBBF2440" : C.border,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
                }}>
                <button onClick={() => toggleSection(group.key)}
                  className="w-full px-4 py-3 flex items-center gap-2 text-left transition-colors hover:bg-black/[0.02] rounded-t-xl"
                  style={{ borderBottom: collapsed ? "none" : `1px solid ${C.border}` }}>
                  {collapsed ? <ChevronRight size={14} style={{ color: C.textMuted }} /> : <ChevronDown size={14} style={{ color: C.textMuted }} />}
                  {isOrphan && <AlertCircle size={13} style={{ color: "#D97706" }} />}
                  <span className="text-sm font-bold" style={{ color: isOrphan ? "#92400E" : C.textPrimary }}>{group.label}</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: isOrphan ? "#FEF3C7" : C.bg, color: isOrphan ? "#92400E" : C.textMuted, border: `1px solid ${isOrphan ? "#FCD34D" : C.border}` }}>
                    {group.items.length}
                  </span>
                  {isOrphan && (
                    <span className="text-[11px] font-normal" style={{ color: "#B45309" }}>
                      · Legacy templates without an ICP — assign one to organize them
                    </span>
                  )}
                </button>
                {!collapsed && (
                  <div>
                    {group.items.map(t => (
                      <TemplateRow
                        key={t.id}
                        t={t} icps={icps}
                        menuOpen={menuOpenId === t.id}
                        setMenuOpen={(v) => setMenuOpenId(v ? t.id : null)}
                        onUse={() => handleUse(t)}
                        onDelete={() => handleDelete(t)}
                        onAssignIcp={(icp) => handleAssignIcp(t, icp)}
                        onDuplicateToIcp={(icp) => handleDuplicateToIcp(t, icp)}
                        busy={busyId === t.id}
                        showAssignAsMain={isOrphan}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {(view === "recent" ? flatRecent : (templates ?? [])).map(t => (
            <div key={t.id} className="rounded-xl border"
              style={{ backgroundColor: C.card, borderColor: C.border }}>
              <TemplateRow
                t={t} icps={icps}
                menuOpen={menuOpenId === t.id}
                setMenuOpen={(v) => setMenuOpenId(v ? t.id : null)}
                onUse={() => handleUse(t)}
                onDelete={() => handleDelete(t)}
                onAssignIcp={(icp) => handleAssignIcp(t, icp)}
                onDuplicateToIcp={(icp) => handleDuplicateToIcp(t, icp)}
                busy={busyId === t.id}
                showAssignAsMain={t.icp_profile_id === null}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Row + actions menu ──────────────────────────────────────────────────
function TemplateRow({
  t, icps, menuOpen, setMenuOpen, onUse, onDelete, onAssignIcp, onDuplicateToIcp,
  busy, showAssignAsMain,
}: {
  t: TemplateListItem;
  icps: IcpOption[];
  menuOpen: boolean;
  setMenuOpen: (v: boolean) => void;
  onUse: () => void;
  onDelete: () => void;
  onAssignIcp: (icpId: string) => void;
  onDuplicateToIcp: (icpId: string) => void;
  busy: boolean;
  showAssignAsMain: boolean;
}) {
  const [submenu, setSubmenu] = useState<"main" | "move" | "duplicate">("main");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) setSubmenu("main");
  }, [menuOpen]);

  return (
    <div className="px-4 py-3 flex items-start gap-4 transition-colors hover:bg-black/[0.015]"
      style={{ borderTop: "1px solid transparent" }}>
      <Link href={`/campaigns/templates/${t.id}`}
        className="flex-1 min-w-0 group"
        style={{ textDecoration: "none" }}>
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <p className="text-sm font-semibold group-hover:underline" style={{ color: C.textPrimary }}>{t.name}</p>
          {t.channels.map(ch => <ChannelChip key={ch} ch={ch} />)}
          {t.tags.slice(0, 3).map(tag => (
            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ backgroundColor: C.surface, color: C.textMuted }}>
              #{tag}
            </span>
          ))}
        </div>
        {t.description && (
          <p className="text-xs truncate mb-1" style={{ color: C.textBody }}>{t.description}</p>
        )}
        <p className="text-[10px]" style={{ color: C.textDim }}>
          Used {t.usage_count}× · Last {timeAgo(t.last_used_at)}
        </p>
      </Link>
      <div className="flex items-center gap-1 shrink-0 relative">
        {showAssignAsMain ? (
          <div className="relative" onClick={e => e.stopPropagation()}>
            <button onClick={() => { setMenuOpen(!menuOpen); setSubmenu("move"); }}
              disabled={busy}
              className="text-xs font-medium px-3 py-1.5 rounded-md inline-flex items-center gap-1 border disabled:opacity-50"
              style={{ borderColor: "#FCD34D", backgroundColor: "#FFFBEB", color: "#92400E" }}>
              {busy ? <Loader2 size={11} className="animate-spin" /> : <FolderTree size={11} />}
              Assign ICP <ChevronDown size={11} />
            </button>
            {menuOpen && submenu === "move" && (
              <IcpPickerMenu icps={icps} onPick={onAssignIcp} onCancel={() => setMenuOpen(false)} />
            )}
          </div>
        ) : (
          <button onClick={onUse}
            className="text-xs font-medium px-3 py-1.5 rounded-md inline-flex items-center gap-1"
            style={{ backgroundColor: ACCENT, color: "#04070d" }}
            title="Use this template in a new campaign">
            <Play size={11} /> Use
          </button>
        )}

        <div className="relative" ref={menuRef} onClick={e => e.stopPropagation()}>
          <button onClick={() => setMenuOpen(!menuOpen)}
            className="p-1.5 rounded transition-colors"
            style={{ color: C.textMuted }}
            title="More actions">
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && submenu === "main" && (
            <div className="absolute right-0 top-full mt-1 z-10 w-52 rounded-lg border shadow-lg overflow-hidden"
              style={{ backgroundColor: C.card, borderColor: C.border }}>
              <button onClick={() => setSubmenu("duplicate")}
                className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-black/[0.04]"
                style={{ color: C.textBody }}>
                <Copy size={12} /> Duplicate to ICP… <ArrowRight size={10} className="ml-auto" />
              </button>
              {!showAssignAsMain && (
                <button onClick={() => setSubmenu("move")}
                  className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-black/[0.04]"
                  style={{ color: C.textBody }}>
                  <FolderTree size={12} /> Move to ICP… <ArrowRight size={10} className="ml-auto" />
                </button>
              )}
              <button onClick={onDelete}
                className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-black/[0.04] border-t"
                style={{ color: C.red, borderColor: C.border }}>
                <Trash2 size={12} /> Delete
              </button>
            </div>
          )}
          {menuOpen && submenu === "duplicate" && (
            <IcpPickerMenu icps={icps} onPick={onDuplicateToIcp} onCancel={() => setSubmenu("main")} title="Duplicate to which ICP?" />
          )}
          {menuOpen && submenu === "move" && !showAssignAsMain && (
            <IcpPickerMenu icps={icps} onPick={onAssignIcp} onCancel={() => setSubmenu("main")} title="Move to which ICP?" excludeId={t.icp_profile_id} />
          )}
        </div>
      </div>
    </div>
  );
}

function IcpPickerMenu({
  icps, onPick, onCancel, title, excludeId,
}: { icps: IcpOption[]; onPick: (id: string) => void; onCancel: () => void; title?: string; excludeId?: string | null }) {
  const items = excludeId ? icps.filter(i => i.id !== excludeId) : icps;
  return (
    <div className="absolute right-0 top-full mt-1 z-10 w-64 rounded-lg border shadow-lg overflow-hidden"
      style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: C.border, backgroundColor: C.bg }}>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>
          {title ?? "Choose an ICP"}
        </span>
        <button onClick={(e) => { e.stopPropagation(); onCancel(); }} className="p-0.5" style={{ color: C.textMuted }}>
          <X size={11} />
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-3 py-3 text-xs text-center" style={{ color: C.textMuted }}>No ICPs available.</p>
        ) : items.map(icp => (
          <button key={icp.id} onClick={(e) => { e.stopPropagation(); onPick(icp.id); }}
            className="w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-black/[0.04]"
            style={{ color: C.textBody }}>
            <span className="truncate">{icp.profile_name}</span>
            <ArrowRight size={10} className="shrink-0 ml-2" style={{ color: C.textMuted }} />
          </button>
        ))}
      </div>
    </div>
  );
}
