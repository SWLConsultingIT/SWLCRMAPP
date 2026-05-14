"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileText, Loader2, Search, Share2, Mail, Phone, MessageSquare, X, Trash2, Play, Plus } from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

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
};

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
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("q", search.trim());
      if (channelFilter) params.set("channel", channelFilter);
      const res = await fetch(`/api/templates?${params.toString()}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body.error ?? `Failed (${res.status})`);
        return;
      }
      setTemplates(body.templates ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // intentionally not in deps — we manually re-fetch on search/filter via onChange
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch when filters change (debounced via inline 250ms is overkill; on blur or enter is fine for now)
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, channelFilter]);

  const filtered = templates ?? [];

  async function handleDelete(t: TemplateListItem) {
    if (deletingId) return;
    if (!confirm(`Delete template "${t.name}"? This can't be undone.`)) return;
    setDeletingId(t.id);
    try {
      const res = await fetch(`/api/templates/${t.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? "Couldn't delete");
        setDeletingId(null);
        return;
      }
      setTemplates(prev => (prev ?? []).filter(x => x.id !== t.id));
    } catch (e: any) {
      alert(e?.message ?? "Couldn't delete");
    } finally {
      setDeletingId(null);
    }
  }

  function handleUse(t: TemplateListItem) {
    // The wizard is two pages away (/campaigns/new chooser → /campaigns/new/[profileId]),
    // so the URL param doesn't survive the navigation. Park the template_id in
    // sessionStorage; the wizard reads + clears it on mount. This also keeps
    // the chooser URL clean.
    try { sessionStorage.setItem("swl-pending-template-id", t.id); } catch { /* private mode */ }
    router.push("/campaigns/new");
  }

  return (
    <div>
      {/* Toolbar: search + channel chips + new template button */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 w-full sm:w-72"
          style={{ borderColor: C.border, backgroundColor: C.card }}>
          <Search size={13} style={{ color: C.textDim }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search templates..."
            className="bg-transparent text-sm outline-none flex-1"
            style={{ color: C.textPrimary }} />
          {search && <button onClick={() => setSearch("")}><X size={12} style={{ color: C.textDim }} /></button>}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
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
            style={{ backgroundColor: "#7C3AED", color: "#fff" }}>
            <Plus size={12} /> New Template
          </Link>
        </div>
      </div>

      {/* List / empty / loading */}
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
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border py-16 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <FileText size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
          <p className="text-sm font-medium" style={{ color: C.textBody }}>
            {search || channelFilter ? "No templates match" : "No templates yet"}
          </p>
          <p className="text-xs mt-1 mb-4 max-w-md mx-auto" style={{ color: C.textMuted }}>
            {search || channelFilter
              ? "Try clearing filters."
              : "Build a reusable outreach sequence + messages once, apply it to any future campaign in one click."}
          </p>
          {!search && !channelFilter && (
            <Link href="/campaigns/templates/new"
              className="text-xs font-semibold px-4 py-2 rounded-md inline-flex items-center gap-1.5"
              style={{ backgroundColor: "#7C3AED", color: "#fff" }}>
              <Plus size={12} /> Create your first template
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(t => (
            <div key={t.id}
              className="rounded-xl border px-4 py-3 flex items-start gap-4 transition-[box-shadow] hover:shadow-md"
              style={{ backgroundColor: C.card, borderColor: C.border }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{t.name}</p>
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
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleUse(t)}
                  className="text-xs font-medium px-3 py-1.5 rounded-md inline-flex items-center gap-1"
                  style={{ backgroundColor: gold, color: "#04070d" }}
                  title="Use this template in a new campaign">
                  <Play size={11} /> Use
                </button>
                <button
                  onClick={() => handleDelete(t)}
                  disabled={deletingId === t.id}
                  className="p-1.5 rounded transition-colors"
                  style={{ color: C.textMuted }}
                  onMouseEnter={e => { e.currentTarget.style.color = C.red; }}
                  onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; }}
                  title="Delete template">
                  {deletingId === t.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
