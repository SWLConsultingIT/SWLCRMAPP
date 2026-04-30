"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { C } from "@/lib/design";
import { Theater, Users, Target, Megaphone, ArrowLeft, ArrowRight, LogOut, Plus, Sparkles, X, Loader2, Sprout, Trash2, Globe, Wand2, Check } from "lucide-react";
import PageHero from "@/components/PageHero";
import { DEMO_INDUSTRY_OPTIONS, type DemoIndustryKey } from "@/lib/demo-seeds";
import type { DemoTenant } from "./page";

const gold = "var(--brand, #c9a83a)";
const goldDark = "var(--brand-dark, #b79832)";

type ScrapedBio = {
  company_name?: string;
  industry?: string;
  tagline?: string;
  description?: string;
  value_proposition?: string;
  main_services?: string[];
  differentiators?: string;
  target_market?: string;
  location?: string;
  tone_of_voice?: string;
  website?: string;
  linkedin_url?: string;
  instagram_url?: string;
  twitter_url?: string;
  facebook_url?: string;
  youtube_url?: string;
  tiktok_url?: string;
};

// Shape config for auto-populating a demo with ICPs / leads / campaigns /
// opportunities. Mirrors `DemoShapeConfig` on the server.
type ShapeState = {
  totalLeads: number;
  icps: number;
  campaigns: number;
  wonLeads: number;
  lostLeads: number;
  industryPreset: DemoIndustryKey;
};

// Map a free-text industry from the scrape to one of our seed pools so the
// "Industry preset" defaults to something sensible after auto-fill.
function autoPresetClient(industry: string | null | undefined): DemoIndustryKey {
  if (!industry) return "mixed";
  const i = industry.toLowerCase();
  if (/(saas|tech|software|platform|app)/i.test(i)) return "saas";
  if (/(agency|marketing|advertising|creative|growth)/i.test(i)) return "agency";
  if (/(manufactur|industrial|engineering|fabricat|machining)/i.test(i)) return "manufacturing";
  if (/(restaurant|hotel|hospitality|food|qsr)/i.test(i)) return "hospitality";
  if (/(consult|outsourc|advisory|professional services)/i.test(i)) return "consulting";
  return "mixed";
}

export default function DemosClient({
  demos,
  isInDemoMode,
  currentDemoBioId,
}: {
  demos: DemoTenant[];
  isInDemoMode: boolean;
  currentDemoBioId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [buildFor, setBuildFor] = useState<DemoTenant | null>(null);
  const [deleteFor, setDeleteFor] = useState<DemoTenant | null>(null);

  async function enterDemo(bioId: string) {
    setBusy(bioId);
    try {
      const res = await fetch("/api/admin/demos/enter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bioId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? "Failed to enter demo");
        setBusy(null);
        return;
      }
      // Hard nav — Sidebar role, BrandProvider, TopHeader all read from
      // /api/auth/me on mount and would otherwise still render the admin's
      // real identity until the next full reload. router.refresh() only
      // re-runs server components; we need every client component to
      // re-mount under the new cookie too.
      window.location.assign("/");
    } catch (e) {
      alert(String(e));
      setBusy(null);
    }
  }

  async function exitDemo() {
    setBusy("__exit");
    try {
      await fetch("/api/admin/demos/exit", { method: "POST" });
      window.location.assign("/admin/demos");
    } catch {
      setBusy(null);
    }
  }

  return (
    <div className="p-6 w-full max-w-7xl mx-auto">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link href="/admin" className="inline-flex items-center gap-1.5 text-xs font-semibold hover:underline" style={{ color: C.textMuted }}>
          <ArrowLeft size={12} /> Back to Admin
        </Link>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-opacity hover:opacity-90"
          style={{
            background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 80%, white))`,
            color: "#04070d",
            boxShadow: `0 4px 16px color-mix(in srgb, ${gold} 28%, transparent)`,
          }}
        >
          <Plus size={12} /> New demo
        </button>
      </div>

      <PageHero
        icon={Theater}
        section="Internal"
        title="Demo Tenants"
        description="Sales-ready impersonation. Paste a URL, auto-fill from the website, seed sample leads, and walk a prospect through the product in their context. Your SWL data stays untouched."
        accentColor={gold}
        status={{ label: "Internal", active: true }}
      />

      {isInDemoMode && currentDemoBioId && (
        <div
          className="rounded-2xl border mb-6 p-4 flex items-center justify-between gap-4 relative overflow-hidden"
          style={{
            backgroundColor: `color-mix(in srgb, ${goldDark} 8%, ${C.card})`,
            borderColor: `color-mix(in srgb, ${goldDark} 30%, ${C.border})`,
          }}
        >
          <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, transparent 0%, ${goldDark} 50%, transparent 100%)`, opacity: 0.7 }} />
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, ${goldDark} 16%, transparent)` }}>
              <Sparkles size={18} style={{ color: goldDark }} />
            </div>
            <div>
              <p className="text-sm font-bold" style={{ color: C.textPrimary }}>You are currently inside a demo tenant</p>
              <p className="text-xs" style={{ color: C.textMuted }}>
                {demos.find(d => d.id === currentDemoBioId)?.company_name ?? "Unknown demo"}
              </p>
            </div>
          </div>
          <button
            onClick={exitDemo}
            disabled={busy === "__exit"}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold border transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ borderColor: `color-mix(in srgb, ${goldDark} 35%, transparent)`, color: goldDark, backgroundColor: C.card }}
          >
            <LogOut size={11} /> Exit demo
          </button>
        </div>
      )}

      {demos.length === 0 ? (
        <div className="rounded-2xl border p-12 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, ${goldDark} 10%, transparent)` }}>
            <Theater size={22} style={{ color: goldDark }} />
          </div>
          <h2 className="text-base font-bold mb-1" style={{ color: C.textPrimary }}>No demo tenants yet</h2>
          <p className="text-sm mb-4" style={{ color: C.textMuted }}>
            Paste a URL — we auto-fill industry, tagline, value prop, services. Then seed sample leads.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-opacity hover:opacity-90"
            style={{
              background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 80%, white))`,
              color: "#04070d",
              boxShadow: `0 4px 16px color-mix(in srgb, ${gold} 28%, transparent)`,
            }}
          >
            <Plus size={12} /> Create your first demo
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {demos.map(d => {
            const isCurrent = currentDemoBioId === d.id;
            return (
              <div
                key={d.id}
                className="rounded-2xl border p-5 relative overflow-hidden transition-all hover:shadow-md group/card"
                style={{
                  backgroundColor: C.card,
                  borderColor: isCurrent ? `color-mix(in srgb, ${goldDark} 40%, ${C.border})` : C.border,
                  boxShadow: isCurrent ? `0 0 0 3px color-mix(in srgb, ${goldDark} 12%, transparent)` : "0 1px 3px rgba(0,0,0,0.04)",
                }}
              >
                <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent 0%, ${goldDark} 50%, transparent 100%)`, opacity: isCurrent ? 0.8 : 0.35 }} />

                {/* Delete button (top-right, appears on hover) */}
                <button
                  onClick={() => setDeleteFor(d)}
                  title="Delete demo"
                  className="absolute top-3 right-3 rounded-lg p-1.5 border transition-all opacity-0 group-hover/card:opacity-100 hover:scale-105"
                  style={{
                    backgroundColor: C.card,
                    borderColor: `color-mix(in srgb, ${C.red} 25%, ${C.border})`,
                    color: C.red,
                  }}
                >
                  <Trash2 size={11} />
                </button>

                <div className="flex items-start gap-3 mb-4">
                  {d.logo_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={d.logo_url} alt={d.company_name} className="w-12 h-12 rounded-xl object-cover shrink-0 border" style={{ borderColor: C.border, backgroundColor: "white" }} />
                  ) : (
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 text-white font-bold text-lg" style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))` }}>
                      {d.company_name?.[0]?.toUpperCase() ?? "?"}
                    </div>
                  )}
                  <div className="flex-1 min-w-0 pr-6">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-bold leading-tight truncate" style={{ color: C.textPrimary }}>{d.company_name}</h3>
                      {isCurrent && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 uppercase tracking-wider" style={{ backgroundColor: `color-mix(in srgb, ${goldDark} 14%, transparent)`, color: goldDark }}>Active</span>
                      )}
                    </div>
                    {d.industry && <p className="text-xs mt-0.5 truncate" style={{ color: C.textMuted }}>{d.industry}</p>}
                    {d.tagline && <p className="text-[11px] mt-1 line-clamp-2" style={{ color: C.textDim }}>{d.tagline}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-4">
                  <Stat label="Leads" value={d.leads} icon={Users} color={C.blue} />
                  <Stat label="ICPs" value={d.profiles} icon={Target} color={C.accent} />
                  <Stat label="Camps" value={d.campaigns} icon={Megaphone} color={C.green} />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => enterDemo(d.id)}
                    disabled={!!busy || isCurrent}
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{
                      background: isCurrent ? C.surface : `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 80%, white))`,
                      color: isCurrent ? C.textMuted : "#04070d",
                      boxShadow: isCurrent ? "none" : `0 4px 16px color-mix(in srgb, ${gold} 28%, transparent)`,
                    }}
                  >
                    {isCurrent ? "You're here" : busy === d.id ? "Entering…" : (<><span>Enter demo</span><ArrowRight size={11} /></>)}
                  </button>
                  <button
                    onClick={() => setBuildFor(d)}
                    title="Build demo data (leads, ICPs, campaigns, opportunities)"
                    className="rounded-lg px-2.5 py-2 text-xs font-bold border transition-colors hover:bg-black/5"
                    style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.card }}
                  >
                    <Sprout size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateDemoModal
          onClose={() => setShowCreate(false)}
          onCreated={async (bioId) => {
            setShowCreate(false);
            await enterDemo(bioId);
          }}
        />
      )}

      {buildFor && (
        <BuildDemoModal
          demo={buildFor}
          onClose={() => setBuildFor(null)}
          onDone={() => {
            setBuildFor(null);
            router.refresh();
          }}
        />
      )}

      {deleteFor && (
        <DeleteDemoModal
          demo={deleteFor}
          onClose={() => setDeleteFor(null)}
          onDone={() => {
            setDeleteFor(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, icon: Icon, color }: { label: string; value: number; icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>; color: string }) {
  return (
    <div className="rounded-lg border p-2" style={{ backgroundColor: C.surface, borderColor: C.border }}>
      <div className="flex items-center gap-1 mb-0.5">
        <Icon size={10} style={{ color }} />
        <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: C.textDim }}>{label}</span>
      </div>
      <p className="text-base font-bold tabular-nums leading-none" style={{ color: C.textPrimary }}>{value}</p>
    </div>
  );
}

// ─── Create demo modal (with URL auto-fill) ─────────────────────────────────
function CreateDemoModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (bioId: string) => void | Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [scraped, setScraped] = useState<ScrapedBio | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [industry, setIndustry] = useState("");
  const [tagline, setTagline] = useState("");
  const [valueProp, setValueProp] = useState("");
  const [scraping, setScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function autoFill() {
    setScrapeError(null);
    if (!url.trim()) {
      setScrapeError("Paste a URL first");
      return;
    }
    let normalized = url.trim();
    if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
    setScraping(true);
    try {
      const res = await fetch("/api/company-bios/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalized, lang: "EN" }),
      });
      const body = (await res.json()) as ScrapedBio & { error?: string };
      if (!res.ok) {
        setScrapeError(body.error ?? "Scrape failed");
        setScraping(false);
        return;
      }
      setScraped(body);
      setCompanyName(body.company_name ?? "");
      setIndustry(body.industry ?? "");
      setTagline(body.tagline ?? "");
      setValueProp(body.value_proposition ?? "");
      // Sync the lead-pool preset with the detected industry so the seed
      // leads land in a coherent vertical (no SaaS reps for a hospitality demo).
      setShape(s => ({ ...s, industryPreset: autoPresetClient(body.industry) }));
      setScraping(false);
    } catch (e) {
      setScrapeError(String(e));
      setScraping(false);
    }
  }

  // Shape sliders state — when totalLeads > 0, the backend auto-populates
  // ICPs + leads + campaigns + opportunities in the same request.
  const [shape, setShape] = useState<ShapeState>({
    totalLeads: 20,
    icps: 2,
    campaigns: 2,
    wonLeads: 3,
    lostLeads: 2,
    industryPreset: "mixed",
  });

  async function submit() {
    setError(null);
    if (!companyName.trim()) {
      setError("Company name required");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        ...scraped,
        company_name: companyName.trim(),
        industry: industry.trim() || null,
        tagline: tagline.trim() || null,
        value_proposition: valueProp.trim() || null,
        website: scraped?.website ?? (url.trim() ? (/^https?:\/\//i.test(url) ? url.trim() : `https://${url.trim()}`) : null),
        shape: shape.totalLeads > 0 ? shape : undefined,
      };
      const res = await fetch("/api/admin/demos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Create failed");
        setBusy(false);
        return;
      }
      await onCreated(body.bioId);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(4,7,13,0.55)" }} onClick={onClose}>
      <div
        className="rounded-2xl border w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto"
        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 16px 48px rgba(0,0,0,0.25)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl" style={{ background: `linear-gradient(90deg, transparent 0%, ${goldDark} 50%, transparent 100%)`, opacity: 0.5 }} />
        <button onClick={onClose} className="absolute top-3 right-3 rounded p-1 hover:bg-black/5"><X size={14} style={{ color: C.textDim }} /></button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, ${goldDark} 14%, transparent)` }}>
            <Theater size={18} style={{ color: goldDark }} />
          </div>
          <div>
            <h2 className="text-base font-bold" style={{ color: C.textPrimary }}>Create demo tenant</h2>
            <p className="text-xs" style={{ color: C.textMuted }}>Paste a URL → AI fills the rest. You can edit before saving.</p>
          </div>
        </div>

        {/* URL + auto-fill */}
        <div className="rounded-xl border p-3 mb-4" style={{ borderColor: C.border, backgroundColor: C.surface }}>
          <label className="block text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: C.textMuted, letterSpacing: "0.06em" }}>
            <Globe size={10} className="inline mr-1" /> Company website
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); autoFill(); } }}
              placeholder="swlconsulting.com"
              className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ borderColor: C.border, backgroundColor: C.card, color: C.textPrimary }}
            />
            <button
              onClick={autoFill}
              disabled={scraping || !url.trim()}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold transition-opacity hover:opacity-90 disabled:opacity-50 shrink-0"
              style={{
                background: scraped ? `color-mix(in srgb, ${C.green} 14%, transparent)` : `linear-gradient(135deg, ${C.aiAccent}, color-mix(in srgb, ${C.aiAccent} 80%, white))`,
                color: scraped ? C.green : "#fff",
                border: scraped ? `1px solid color-mix(in srgb, ${C.green} 35%, transparent)` : "none",
              }}
            >
              {scraping ? <Loader2 size={11} className="animate-spin" /> : scraped ? <Check size={11} /> : <Wand2 size={11} />}
              {scraping ? "Reading…" : scraped ? "Filled" : "Auto-fill"}
            </button>
          </div>
          {scrapeError && <p className="mt-2 text-[11px]" style={{ color: C.red }}>{scrapeError}</p>}
          {scraped && !scrapeError && (
            <p className="mt-2 text-[11px]" style={{ color: C.textMuted }}>
              Filled from {new URL(scraped.website ?? url).hostname}. Edit anything below before saving.
            </p>
          )}
        </div>

        <div className="space-y-3">
          <Field label="Company name" value={companyName} onChange={setCompanyName} placeholder="SWL Consulting" autoFocus />
          <Field label="Industry" value={industry} onChange={setIndustry} placeholder="B2B Sales & Growth Consulting" />
          <Field label="Tagline" value={tagline} onChange={setTagline} placeholder="The growth engine for B2B sales teams" />
          <Field label="Value proposition" value={valueProp} onChange={setValueProp} placeholder="What problem they solve, for whom" />
        </div>

        {/* Shape sliders — when totalLeads > 0, the same request also seeds
            ICPs, leads, campaigns, and opportunities. Set totalLeads to 0
            to create an empty demo and populate it later from the card. */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted, letterSpacing: "0.06em" }}>
              <Sprout size={10} className="inline mr-1" /> Shape your demo data
            </h3>
            <span className="text-[10px]" style={{ color: C.textDim }}>{shape.totalLeads === 0 ? "Empty (skip)" : "Auto-populate on create"}</span>
          </div>
          <ShapeSliders value={shape} onChange={setShape} />
        </div>

        {error && (
          <div className="mt-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: C.redLight, color: C.red, border: `1px solid color-mix(in srgb, ${C.red} 25%, transparent)` }}>
            {error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-semibold transition-colors hover:bg-black/5" style={{ color: C.textMuted }}>Cancel</button>
          <button
            onClick={submit}
            disabled={busy || !companyName.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{
              background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 80%, white))`,
              color: "#04070d",
              boxShadow: `0 4px 16px color-mix(in srgb, ${gold} 28%, transparent)`,
            }}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            {busy ? (shape.totalLeads > 0 ? "Building…" : "Creating…") : "Create & enter"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Reusable shape-config sliders ──────────────────────────────────────────
function ShapeSliders({ value, onChange }: { value: ShapeState; onChange: (next: ShapeState) => void }) {
  const set = <K extends keyof ShapeState>(k: K, v: ShapeState[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: C.border, backgroundColor: C.surface }}>
      {/* Industry preset */}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: C.textMuted, letterSpacing: "0.06em" }}>Industry preset</label>
        <div className="grid grid-cols-2 gap-1.5">
          {DEMO_INDUSTRY_OPTIONS.map(opt => {
            const active = value.industryPreset === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => set("industryPreset", opt.key)}
                className="text-left rounded-lg border px-2.5 py-1.5 transition-all"
                style={{
                  backgroundColor: active ? `color-mix(in srgb, ${goldDark} 10%, transparent)` : C.bg,
                  borderColor: active ? `color-mix(in srgb, ${goldDark} 35%, ${C.border})` : C.border,
                }}
              >
                <p className="text-[11px] font-bold" style={{ color: active ? goldDark : C.textPrimary }}>{opt.label}</p>
                <p className="text-[9px] line-clamp-1" style={{ color: C.textMuted }}>{opt.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      <Slider label="Total leads" value={value.totalLeads} min={0} max={50} step={5} onChange={n => set("totalLeads", n)} />

      {value.totalLeads > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Slider label="ICPs" value={value.icps} min={0} max={4} step={1} onChange={n => set("icps", n)} compact />
            <Slider label="Campaigns" value={value.campaigns} min={0} max={4} step={1} onChange={n => set("campaigns", n)} compact />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Slider label="Won leads" value={value.wonLeads} min={0} max={Math.min(10, value.totalLeads)} step={1} onChange={n => set("wonLeads", n)} compact accent={C.green} />
            <Slider label="Lost leads" value={value.lostLeads} min={0} max={Math.min(10, value.totalLeads)} step={1} onChange={n => set("lostLeads", n)} compact accent={C.red} />
          </div>
          {value.wonLeads + value.lostLeads > value.totalLeads && (
            <p className="text-[10px]" style={{ color: C.red }}>
              Won + lost ({value.wonLeads + value.lostLeads}) exceeds total leads ({value.totalLeads}). The server will cap the lost count.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Slider({
  label, value, min, max, step = 1, onChange, compact, accent,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  compact?: boolean;
  accent?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted, letterSpacing: "0.06em" }}>{label}</label>
        <span className="text-[11px] font-bold tabular-nums" style={{ color: accent ?? C.textPrimary }}>{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full"
        style={accent ? { accentColor: accent } : undefined}
      />
      {!compact && (
        <div className="flex justify-between text-[9px] mt-0.5" style={{ color: C.textDim }}>
          <span>{min}</span><span>{Math.round((min + max) / 2)}</span><span>{max}</span>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, autoFocus }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: C.textMuted, letterSpacing: "0.06em" }}>{label}</label>
      <input
        type="text"
        autoFocus={autoFocus}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
        style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
      />
    </div>
  );
}

// ─── Build demo data modal ───────────────────────────────────────────────
// Standalone "+ data" entry point for an existing demo. Re-runs the same
// populate logic as the create flow so admins can keep adding leads/ICPs/
// campaigns over the lifetime of a demo.
function BuildDemoModal({
  demo,
  onClose,
  onDone,
}: {
  demo: DemoTenant;
  onClose: () => void;
  onDone: () => void;
}) {
  const [shape, setShape] = useState<ShapeState>({
    totalLeads: 15,
    icps: 2,
    campaigns: 2,
    wonLeads: 3,
    lostLeads: 2,
    industryPreset: "mixed",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ insertedLeads: number; insertedIcps: number; insertedCampaigns: number } | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/demos/${demo.id}/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shape),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Build failed");
        setBusy(false);
        return;
      }
      setDone({
        insertedLeads: body.insertedLeads ?? 0,
        insertedIcps: body.insertedIcps ?? 0,
        insertedCampaigns: body.insertedCampaigns ?? 0,
      });
      // Brief pause so the user sees the receipt, then dismiss + refresh.
      setTimeout(() => onDone(), 900);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(4,7,13,0.55)" }} onClick={onClose}>
      <div
        className="rounded-2xl border w-full max-w-md p-6 relative max-h-[90vh] overflow-y-auto"
        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 16px 48px rgba(0,0,0,0.25)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl" style={{ background: `linear-gradient(90deg, transparent 0%, ${C.green} 50%, transparent 100%)`, opacity: 0.5 }} />
        <button onClick={onClose} className="absolute top-3 right-3 rounded p-1 hover:bg-black/5"><X size={14} style={{ color: C.textDim }} /></button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, ${C.green} 14%, transparent)` }}>
            <Sprout size={18} style={{ color: C.green }} />
          </div>
          <div>
            <h2 className="text-base font-bold" style={{ color: C.textPrimary }}>Build demo data</h2>
            <p className="text-xs" style={{ color: C.textMuted }}>Add ICPs, leads, campaigns, and opportunities to <span className="font-bold" style={{ color: C.textBody }}>{demo.company_name}</span>.</p>
          </div>
        </div>

        <ShapeSliders value={shape} onChange={setShape} />

        {error && (
          <div className="mt-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: C.redLight, color: C.red, border: `1px solid color-mix(in srgb, ${C.red} 25%, transparent)` }}>
            {error}
          </div>
        )}
        {done && (
          <div className="mt-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: `color-mix(in srgb, ${C.green} 12%, transparent)`, color: C.green, border: `1px solid color-mix(in srgb, ${C.green} 25%, transparent)` }}>
            <Check size={11} className="inline mr-1" /> Added {done.insertedLeads} leads · {done.insertedIcps} ICPs · {done.insertedCampaigns} campaigns
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-semibold transition-colors hover:bg-black/5" style={{ color: C.textMuted }}>Cancel</button>
          <button
            onClick={submit}
            disabled={busy || !!done || shape.totalLeads === 0}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{
              background: `linear-gradient(135deg, ${C.green}, color-mix(in srgb, ${C.green} 80%, white))`,
              color: "#04070d",
              boxShadow: `0 4px 16px color-mix(in srgb, ${C.green} 28%, transparent)`,
            }}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : done ? <Check size={12} /> : <Sprout size={12} />}
            {busy ? "Building…" : done ? "Done" : `Build ${shape.totalLeads} leads`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete demo modal ──────────────────────────────────────────────────────
function DeleteDemoModal({
  demo,
  onClose,
  onDone,
}: {
  demo: DemoTenant;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/demos/${demo.id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Delete failed");
        setBusy(false);
        return;
      }
      onDone();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  const total = demo.leads + demo.profiles + demo.campaigns;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(4,7,13,0.55)" }} onClick={onClose}>
      <div
        className="rounded-2xl border w-full max-w-md p-6 relative"
        style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 16px 48px rgba(0,0,0,0.25)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-2xl" style={{ background: `linear-gradient(90deg, transparent 0%, ${C.red} 50%, transparent 100%)`, opacity: 0.5 }} />
        <button onClick={onClose} className="absolute top-3 right-3 rounded p-1 hover:bg-black/5"><X size={14} style={{ color: C.textDim }} /></button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, ${C.red} 14%, transparent)` }}>
            <Trash2 size={18} style={{ color: C.red }} />
          </div>
          <div>
            <h2 className="text-base font-bold" style={{ color: C.textPrimary }}>Delete demo?</h2>
            <p className="text-xs" style={{ color: C.textMuted }}>This permanently removes the demo and everything in it.</p>
          </div>
        </div>

        <div className="rounded-xl border p-3 mb-4" style={{ backgroundColor: C.redLight, borderColor: `color-mix(in srgb, ${C.red} 25%, transparent)` }}>
          <p className="text-xs font-semibold mb-1" style={{ color: C.red }}>About to delete <span className="font-bold">{demo.company_name}</span></p>
          {total > 0 ? (
            <p className="text-[11px]" style={{ color: C.red }}>
              Cascade: {demo.leads} lead{demo.leads === 1 ? "" : "s"} · {demo.profiles} ICP{demo.profiles === 1 ? "" : "s"} · {demo.campaigns} campaign{demo.campaigns === 1 ? "" : "s"}
            </p>
          ) : (
            <p className="text-[11px]" style={{ color: C.red }}>Empty demo — nothing else to clean.</p>
          )}
        </div>

        {error && (
          <div className="mb-3 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: C.redLight, color: C.red, border: `1px solid color-mix(in srgb, ${C.red} 25%, transparent)` }}>
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-semibold transition-colors hover:bg-black/5" style={{ color: C.textMuted }}>Cancel</button>
          <button
            onClick={submit}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{
              backgroundColor: C.red,
              color: "#fff",
              boxShadow: `0 4px 16px color-mix(in srgb, ${C.red} 28%, transparent)`,
            }}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            {busy ? "Deleting…" : "Delete demo"}
          </button>
        </div>
      </div>
    </div>
  );
}
