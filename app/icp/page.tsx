"use client";

import { useState, useEffect } from "react";
import PageHero from "@/components/PageHero";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { C } from "@/lib/design";
import Link from "next/link";
import {
  Target, Plus, X, CheckCircle, AlertCircle, Clock, Loader2, ArrowLeft,
  Pencil, Trash2, ChevronRight, Users, MapPin, Briefcase, Megaphone, ExternalLink,
  Building2, Lightbulb, BookOpen,
} from "lucide-react";

const gold = C.gold;
const goldLight = C.goldGlow;

type IcpProfile = {
  id: string;
  company_bio_id: string | null;
  profile_name: string;
  target_industries: string[];
  target_roles: string[];
  company_size: string;
  geography: string[];
  pain_points: string;
  solutions_offered: string;
  notes: string;
  status: "pending" | "reviewed" | "approved" | "rejected";
  created_at: string;
};

const emptyForm = {
  profile_name: "",
  target_industries: [] as string[],
  target_roles: [] as string[],
  company_size: "",
  geography: [] as string[],
  pain_points: "",
  solutions_offered: "",
  notes: "",
  leads_requested: null as number | null,
};

const statusConfig: Record<string, { label: string; color: string; bg: string; message: string }> = {
  pending:  { label: "Pending Review", color: C.yellow, bg: C.yellowLight, message: "Our team is reviewing your profile." },
  reviewed: { label: "Reviewed",       color: C.blue,   bg: C.blueLight,   message: "Your profile has been reviewed." },
  approved: { label: "Approved",       color: C.green,  bg: C.greenLight,  message: "Profile approved. We're generating your leads." },
};


function TagInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState("");
  function add() {
    const s = input.trim();
    if (!s || values.includes(s)) return;
    onChange([...values, s]);
    setInput("");
  }
  return (
    <div className="tag-input rounded-lg border px-3 py-2 flex flex-wrap gap-1.5 min-h-10 cursor-text transition-colors"
      style={{ borderColor: C.border, backgroundColor: C.bg }}
      onClick={e => (e.currentTarget.querySelector("input") as HTMLInputElement)?.focus()}>
      {values.map(v => (
        <span key={v} className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{ backgroundColor: goldLight, color: gold, border: `1px solid color-mix(in srgb, var(--brand, #c9a83a) 25%, transparent)` }}>
          {v}
          <button onClick={() => onChange(values.filter(x => x !== v))} className="opacity-60 hover:opacity-100"><X size={10} /></button>
        </span>
      ))}
      <input
        className="flex-1 min-w-24 text-sm bg-transparent outline-none border-none shadow-none"
        style={{ color: C.textPrimary, border: "none", boxShadow: "none" }}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => (e.key === "Enter" || e.key === "," || e.key === "Tab") && (e.preventDefault(), add())}
        onBlur={add}
        placeholder={values.length === 0 ? placeholder : ""}
      />
    </div>
  );
}

// ─── Profile Form (create + edit) ────────────────────────
function ProfileForm({ initial, onSave, onCancel, isNew }: {
  initial: typeof emptyForm;
  onSave: (data: typeof emptyForm) => Promise<void>;
  onCancel: () => void;
  isNew: boolean;
}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  function fieldError(value: string | string[]): string | null {
    if (!tried) return null;
    if (Array.isArray(value)) return value.length === 0 ? "Required" : null;
    return !value.trim() ? "Required" : null;
  }

  async function handleSubmit() {
    setTried(true);
    const invalid = !form.profile_name.trim() || form.target_industries.length === 0 || form.target_roles.length === 0 || form.geography.length === 0 || !form.pain_points.trim() || !form.solutions_offered.trim();
    if (invalid) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(form);
    } catch (e: any) {
      setError(e.message ?? "Failed to save");
    }
    setSaving(false);
  }

  return (
    <div className="rounded-2xl border mb-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `3px solid ${gold}`, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b" style={{ borderColor: C.border }}>
        <h2 className="text-sm font-semibold" style={{ color: C.textPrimary }}>
          {isNew ? "New LeadMiner Ticket" : "Edit Profile"}
        </h2>
        <button onClick={onCancel} style={{ color: C.textMuted }}><X size={18} /></button>
      </div>
      <div className="p-6 space-y-5">
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-medium" style={{ color: C.textBody }}>Profile Name *</label>
            {fieldError(form.profile_name) && <span className="text-xs font-medium" style={{ color: C.red }}>{fieldError(form.profile_name)}</span>}
          </div>
          <input className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none"
            style={{ borderColor: fieldError(form.profile_name) ? C.red : C.border, color: C.textPrimary, backgroundColor: C.bg }}
            value={form.profile_name} onChange={e => setForm(f => ({ ...f, profile_name: e.target.value }))}
            placeholder="E.g.: CFO of Argentine SME" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium" style={{ color: C.textBody }}>Target Industries *</label>
              {fieldError(form.target_industries) && <span className="text-xs font-medium" style={{ color: C.red }}>{fieldError(form.target_industries)}</span>}
            </div>
            <TagInput values={form.target_industries} onChange={v => setForm(f => ({ ...f, target_industries: v }))} placeholder="Type and press Enter…" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium" style={{ color: C.textBody }}>Target Roles *</label>
              {fieldError(form.target_roles) && <span className="text-xs font-medium" style={{ color: C.red }}>{fieldError(form.target_roles)}</span>}
            </div>
            <TagInput values={form.target_roles} onChange={v => setForm(f => ({ ...f, target_roles: v }))} placeholder="CEO, CFO, Sales Manager…" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Company Size</label>
            <select className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none bg-transparent"
              style={{ borderColor: C.border, color: form.company_size ? C.textPrimary : C.textDim, backgroundColor: C.bg }}
              value={form.company_size} onChange={e => setForm(f => ({ ...f, company_size: e.target.value }))}>
              <option value="">Any size</option>
              {["1-10", "11-50", "51-200", "201-500", "500+"].map(s => <option key={s} value={s}>{s} employees</option>)}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium" style={{ color: C.textBody }}>Geography *</label>
              {fieldError(form.geography) && <span className="text-xs font-medium" style={{ color: C.red }}>{fieldError(form.geography)}</span>}
            </div>
            <TagInput values={form.geography} onChange={v => setForm(f => ({ ...f, geography: v }))} placeholder="Argentina, Spain, LATAM…" />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-medium" style={{ color: C.textBody }}>Pain Points You Solve *</label>
            {fieldError(form.pain_points) && <span className="text-xs font-medium" style={{ color: C.red }}>{fieldError(form.pain_points)}</span>}
          </div>
          <textarea rows={3} className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none resize-none"
            style={{ borderColor: fieldError(form.pain_points) ? C.red : C.border, color: C.textPrimary, backgroundColor: C.bg }}
            value={form.pain_points} onChange={e => setForm(f => ({ ...f, pain_points: e.target.value }))}
            placeholder="What problem do these prospects have that your company can solve" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-medium" style={{ color: C.textBody }}>Solutions You Offer *</label>
            {fieldError(form.solutions_offered) && <span className="text-xs font-medium" style={{ color: C.red }}>{fieldError(form.solutions_offered)}</span>}
          </div>
          <textarea rows={2} className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none resize-none"
            style={{ borderColor: fieldError(form.solutions_offered) ? C.red : C.border, color: C.textPrimary, backgroundColor: C.bg }}
            value={form.solutions_offered} onChange={e => setForm(f => ({ ...f, solutions_offered: e.target.value }))}
            placeholder="What specific service/product best fits this profile" />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Additional Notes</label>
          <textarea rows={2} className="w-full rounded-lg border px-3.5 py-2.5 text-sm focus:outline-none resize-none"
            style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
            value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            placeholder="Describe what you're specifically looking for in these leads. Include any personalized info, specific traits, behaviors, or qualifiers that would make a lead ideal for this campaign (e.g., 'recently raised funding', 'hiring for sales roles', 'using competitor X')." />
        </div>

        {/* Leads Requested */}
        <div className="rounded-2xl border p-4" style={{ borderColor: `color-mix(in srgb, ${gold} 25%, transparent)`, background: `linear-gradient(135deg, color-mix(in srgb, ${gold} 4%, var(--c-card)) 0%, var(--c-card) 100%)`, boxShadow: `0 0 16px color-mix(in srgb, ${gold} 8%, transparent)` }}>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: gold }}>
            How many leads do you need?
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            {[25, 50, 100, 200, 500].map(n => {
              const active = form.leads_requested === n;
              return (
                <button key={n} type="button"
                  onClick={() => setForm(f => ({ ...f, leads_requested: active ? null : n }))}
                  className="px-4 py-2 rounded-lg text-sm font-bold transition-[opacity,transform,box-shadow,background-color,border-color]"
                  style={{
                    backgroundColor: active ? gold : C.card,
                    color: active ? "#04070d" : C.textMuted,
                    border: `1.5px solid ${active ? gold : C.border}`,
                    boxShadow: active ? `0 2px 8px color-mix(in srgb, ${gold} 25%, transparent)` : "none",
                  }}>
                  {n}
                </button>
              );
            })}
            <div className="flex items-center gap-2 ml-1">
              <span className="text-xs font-medium" style={{ color: C.textDim }}>or</span>
              <input
                type="number" min={1} max={5000}
                placeholder="Custom"
                value={form.leads_requested !== null && ![25, 50, 100, 200, 500].includes(form.leads_requested) ? form.leads_requested : ""}
                onChange={e => {
                  const v = e.target.value === "" ? null : parseInt(e.target.value);
                  setForm(f => ({ ...f, leads_requested: v }));
                }}
                className="w-24 rounded-lg border px-3 py-2 text-sm font-bold focus:outline-none text-center"
                style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
              />
            </div>
          </div>
          {form.leads_requested !== null && (
            <p className="text-xs mt-2.5 font-medium" style={{ color: C.textMuted }}>
              Requesting <span style={{ color: gold, fontWeight: 700 }}>{form.leads_requested} leads</span> for this profile
            </p>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg p-3 text-sm" style={{ backgroundColor: C.redLight, color: C.red }}>
            <AlertCircle size={15} /> {error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button onClick={handleSubmit} disabled={saving}
            className="flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{ backgroundColor: gold, color: "#04070d" }}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : isNew ? <Plus size={15} /> : <CheckCircle size={15} />}
            {saving ? "Saving…" : isNew ? "Submit for Review" : "Save Changes"}
          </button>
          <button onClick={onCancel} className="rounded-lg px-5 py-2.5 text-sm font-medium"
            style={{ color: C.textMuted, backgroundColor: "#F3F4F6" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Profile Detail View ─────────────────────────────────
function ProfileDetail({ profile, onEdit, onDelete, onClose }: {
  profile: IcpProfile;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const st = statusConfig[profile.status] ?? statusConfig.pending;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [leads, setLeads] = useState<any[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [leadsOpen, setLeadsOpen] = useState(false);

  useEffect(() => {
    async function fetchLeads() {
      const supabase = getSupabaseBrowser();
      const { data: profileLeads } = await supabase
        .from("leads")
        .select("id, primary_first_name, primary_last_name, company_name, primary_title_role, status, lead_score")
        .eq("icp_profile_id", profile.id)
        .order("created_at", { ascending: false });

      if (!profileLeads || profileLeads.length === 0) { setLeads([]); setLoadingLeads(false); return; }

      const leadIds = profileLeads.map(l => l.id);
      const { data: campaigns } = await supabase
        .from("campaigns")
        .select("id, lead_id, name, status")
        .in("lead_id", leadIds)
        .in("status", ["active", "paused", "completed"]);

      const campByLead: Record<string, any> = {};
      for (const c of campaigns ?? []) { campByLead[c.lead_id] = c; }

      setLeads(profileLeads.map(l => ({ ...l, campaign: campByLead[l.id] ?? null })));
      setLoadingLeads(false);
    }
    fetchLeads();
  }, [profile.id]);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs mb-5" style={{ color: C.textMuted }}>
        <button onClick={onClose} className="hover:underline flex items-center gap-1">
          <ArrowLeft size={12} /> Lead Miner
        </button>
        <span>/</span>
        <span style={{ color: C.textBody }}>{profile.profile_name}</span>
      </div>

      <div className="rounded-2xl border overflow-hidden mb-6 relative" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 8px 32px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04)" }}>
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, transparent 0%, ${gold} 30%, color-mix(in srgb, ${gold} 72%, white) 50%, ${gold} 70%, transparent 100%)` }} />

      {/* Header */}
      <div className="p-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h2 className="text-xl font-bold" style={{ color: C.textPrimary }}>{profile.profile_name}</h2>
            <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold"
              style={{ backgroundColor: st.bg, color: st.color }}>
              <Clock size={11} /> {st.label}
            </span>
          </div>
          <p className="text-xs" style={{ color: C.textMuted }}>
            Created {new Date(profile.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {leads.length === 0 && (
            <button onClick={onEdit}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-80"
              style={{ backgroundColor: goldLight, color: gold, border: `1px solid color-mix(in srgb, var(--brand, #c9a83a) 30%, transparent)` }}>
              <Pencil size={12} /> Edit
            </button>
          )}
        </div>
      </div>

      <div className="border-t" style={{ borderColor: C.border }} />

      {/* Overview — category cards with icons */}
      <div className="px-6 py-5 grid grid-cols-2 gap-3">
        {profile.target_industries?.length > 0 && (
          <OverviewCard icon={Building2} label="Industries" accent={C.blue} bg={C.blueLight}>
            <div className="flex flex-wrap gap-1.5">
              {profile.target_industries.map(i => (
                <span key={i} className="text-[11px] font-medium px-2 py-0.5 rounded-md"
                  style={{ backgroundColor: C.blueLight, color: C.blue, border: `1px solid color-mix(in srgb, ${C.blue} 15%, transparent)` }}>{i}</span>
              ))}
            </div>
          </OverviewCard>
        )}
        {profile.target_roles?.length > 0 && (
          <OverviewCard icon={Briefcase} label="Target Roles" accent={C.accent} bg={C.accentLight}>
            <div className="flex flex-wrap gap-1.5">
              {profile.target_roles.map(r => (
                <span key={r} className="text-[11px] font-medium px-2 py-0.5 rounded-md"
                  style={{ backgroundColor: C.accentLight, color: C.accent, border: `1px solid color-mix(in srgb, ${C.accent} 15%, transparent)` }}>{r}</span>
              ))}
            </div>
          </OverviewCard>
        )}
        {profile.company_size && (
          <OverviewCard icon={Users} label="Company Size" accent={"#7C3AED"} bg={"#F5F3FF"}>
            <p className="text-[12px] leading-relaxed" style={{ color: C.textBody }}>
              {profile.company_size}
            </p>
          </OverviewCard>
        )}
        {profile.geography?.length > 0 && (
          <OverviewCard icon={MapPin} label="Geography" accent={C.orange} bg={C.orangeLight}>
            <div className="flex flex-wrap gap-1.5">
              {profile.geography.map(g => (
                <span key={g} className="text-[11px] font-medium px-2 py-0.5 rounded-md"
                  style={{ backgroundColor: C.orangeLight, color: C.orange, border: `1px solid color-mix(in srgb, ${C.orange} 15%, transparent)` }}>{g}</span>
              ))}
            </div>
          </OverviewCard>
        )}
      </div>

      {/* Pain Points + Solutions (color-accented side-by-side) */}
      {(profile.pain_points || profile.solutions_offered) && (
        <div className="px-6 pb-5 grid grid-cols-2 gap-4">
          {profile.pain_points && (
            <AccentBlock icon={AlertCircle} title="Pain Points" accent={C.red} bg={C.redLight}>
              <p className="text-[13px] leading-relaxed whitespace-pre-line" style={{ color: C.textBody }}>
                {profile.pain_points}
              </p>
            </AccentBlock>
          )}
          {profile.solutions_offered && (
            <AccentBlock icon={Lightbulb} title="Solutions Offered" accent={C.green} bg={C.greenLight}>
              <p className="text-[13px] leading-relaxed whitespace-pre-line" style={{ color: C.textBody }}>
                {profile.solutions_offered}
              </p>
            </AccentBlock>
          )}
        </div>
      )}

      {/* Classification Rubric (Notes) — parsed + tier badges highlighted */}
      {profile.notes && (
        <div className="px-6 pb-5">
          <AccentBlock icon={BookOpen} title="Classification Rubric" accent={"#7C3AED"} bg={"#F5F3FF"}>
            <NotesRenderer text={profile.notes} />
          </AccentBlock>
        </div>
      )}

      {/* Leads linked to this ticket */}
      <div className="px-6 pb-5">
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: C.border, boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
          <button onClick={() => setLeadsOpen(!leadsOpen)}
            className="w-full px-5 py-3 flex items-center gap-2 border-b text-left transition-colors hover:bg-gray-50"
            style={{ borderColor: C.border, backgroundColor: C.bg }}>
            <Users size={13} style={{ color: C.textMuted }} />
            <span className="text-sm font-bold" style={{ color: C.textPrimary }}>Leads</span>
            {!loadingLeads && <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: goldLight, color: gold }}>{leads.length}</span>}
            <div className="flex-1" />
            <ChevronRight size={14} style={{ color: C.textDim, transform: leadsOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s" }} />
          </button>
          {leadsOpen && loadingLeads && (
            <div className="px-5 py-6 text-center"><Loader2 size={16} className="animate-spin mx-auto" style={{ color: C.textDim }} /></div>
          )}
          {leadsOpen && !loadingLeads && leads.length === 0 && (
            <div className="px-5 py-6 text-center">
              <p className="text-sm" style={{ color: C.textDim }}>No leads uploaded yet for this ticket.</p>
            </div>
          )}
          {leadsOpen && !loadingLeads && leads.length > 0 && (
            <div className="divide-y" style={{ borderColor: C.border }}>
              {leads.map((lead: any) => {
                const nm = `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() || "Unknown";
                const hasCampaign = !!lead.campaign;
                return (
                  <div key={lead.id} className="flex items-center gap-3 px-5 py-2.5 table-row-hover">
                    <Link href={`/leads/${lead.id}`} className="flex-1 min-w-0 hover:underline">
                      <p className="text-sm font-medium" style={{ color: C.textPrimary }}>{nm}</p>
                      <p className="text-xs" style={{ color: C.textMuted }}>{lead.primary_title_role ?? ""}{lead.company_name ? ` · ${lead.company_name}` : ""}</p>
                    </Link>
                    {lead.lead_score != null && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded" style={{
                        backgroundColor: lead.lead_score >= 80 ? C.redLight : lead.lead_score >= 50 ? C.orangeLight : C.accentLight,
                        color: lead.lead_score >= 80 ? C.red : lead.lead_score >= 50 ? C.orange : C.accent,
                      }}>{lead.lead_score}</span>
                    )}
                    {hasCampaign ? (
                      <Link href={`/campaigns/${lead.campaign.id}`}
                        className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-md transition-opacity hover:opacity-80"
                        style={{ backgroundColor: C.greenLight, color: C.green }}>
                        <Megaphone size={10} /> {lead.campaign.status === "active" ? "Active Campaign" : lead.campaign.status === "paused" ? "Paused" : "Completed"}
                        <ExternalLink size={9} />
                      </Link>
                    ) : (
                      <Link href="/campaigns?tab=ready"
                        className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md transition-opacity hover:opacity-80"
                        style={{ backgroundColor: C.blueLight, color: C.blue }}>
                        No Campaign <ChevronRight size={10} />
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Delete */}
      <div className="px-6 pb-5 flex justify-end">
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-1.5 text-xs font-medium transition-opacity hover:opacity-80"
            style={{ color: C.red }}>
            <Trash2 size={12} /> Delete profile
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs" style={{ color: C.red }}>Are you sure?</span>
            <button onClick={onDelete} className="rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ backgroundColor: C.red, color: "#fff" }}>
              Yes, delete
            </button>
            <button onClick={() => setConfirmDelete(false)} className="rounded-lg px-3 py-1.5 text-xs font-medium"
              style={{ color: C.textMuted, backgroundColor: "#F3F4F6" }}>No</button>
          </div>
        )}
      </div>
    </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────
export default function LeadGenPage() {
  const [profiles, setProfiles] = useState<IcpProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  async function loadProfiles() {
    const supabase = getSupabaseBrowser();
    const { data } = await supabase
      .from("icp_profiles")
      .select("*")
      .order("created_at", { ascending: false });
    setProfiles(data ?? []);
    setLoading(false);
  }

  useEffect(() => { loadProfiles(); }, []);

  async function handleCreate(form: typeof emptyForm) {
    const supabase = getSupabaseBrowser();
    const { data: bio } = await supabase
      .from("company_bios").select("id").order("created_at", { ascending: false }).limit(1).maybeSingle();

    if (!bio?.id) {
      throw new Error("No Company Bio found. Please create one first at /company-bios before submitting a ticket.");
    }

    const { error } = await supabase
      .from("icp_profiles")
      .insert({ ...form, company_bio_id: bio.id, status: "pending" });

    if (error) throw error;
    setShowForm(false);
    setSavedMsg("Profile submitted for review.");
    setTimeout(() => setSavedMsg(null), 4000);
    await loadProfiles();
  }

  async function handleUpdate(id: string, form: typeof emptyForm) {
    const supabase = getSupabaseBrowser();
    const { error } = await supabase.from("icp_profiles").update(form).eq("id", id);
    if (error) throw error;
    setEditingId(null);
    setSavedMsg("Profile updated.");
    setTimeout(() => setSavedMsg(null), 4000);
    await loadProfiles();
  }

  async function handleDelete(id: string) {
    const supabase = getSupabaseBrowser();
    await supabase.from("icp_profiles").delete().eq("id", id);
    setSelectedId(null);
    await loadProfiles();
  }

  const selectedProfile = profiles.find(p => p.id === selectedId);
  const editingProfile = profiles.find(p => p.id === editingId);

  return (
    <div className="p-6 w-full">
      {/* Hero — hidden when viewing a profile detail */}
      {!selectedId && (
        <>
          <PageHero
            icon={Target}
            section="Growth Engine"
            title="Lead Miner™"
            description="Define your ideal prospect profiles. Each profile generates a tailored outreach strategy."
            accentColor={C.aiAccent}
            status={{ label: "AI Active", active: true }}
            badge="Lead Intelligence"
          />
          {!showForm && !editingId && profiles.length > 0 && (
            <div className="flex justify-end -mt-3 mb-4">
              <button
                onClick={() => setShowForm(true)}
                className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-80"
                style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#04070d" }}>
                <Plus size={15} /> New Profile
              </button>
            </div>
          )}
        </>
      )}

      {/* Success message */}
      {savedMsg && (
        <div className="flex items-center gap-2 rounded-xl px-4 py-3 mb-6 text-sm font-medium"
          style={{ backgroundColor: C.greenLight, color: C.green, border: `1px solid ${C.green}22` }}>
          <CheckCircle size={15} /> {savedMsg}
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <ProfileForm initial={emptyForm} isNew onSave={handleCreate} onCancel={() => setShowForm(false)} />
      )}

      {/* Edit form */}
      {editingId && editingProfile && (
        <ProfileForm
          initial={{
            profile_name: editingProfile.profile_name,
            target_industries: editingProfile.target_industries ?? [],
            target_roles: editingProfile.target_roles ?? [],
            company_size: editingProfile.company_size ?? "",
            geography: editingProfile.geography ?? [],
            pain_points: editingProfile.pain_points ?? "",
            solutions_offered: editingProfile.solutions_offered ?? "",
            notes: editingProfile.notes ?? "",
            leads_requested: (editingProfile as any).leads_requested ?? null,
          }}
          isNew={false}
          onSave={(form) => handleUpdate(editingId, form)}
          onCancel={() => setEditingId(null)}
        />
      )}

      {/* Detail view */}
      {selectedId && selectedProfile && !editingId && (
        <ProfileDetail
          profile={selectedProfile}
          onEdit={() => { setEditingId(selectedId); setSelectedId(null); }}
          onDelete={() => handleDelete(selectedId)}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-12" style={{ color: C.textMuted }}>
          <Loader2 size={20} className="animate-spin mr-2" /> Loading…
        </div>

      /* Empty state */
      ) : profiles.length === 0 && !showForm ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="rounded-2xl border p-10 max-w-lg w-full text-center relative overflow-hidden"
            style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white), ${gold})` }} />

            <div className="w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-5"
              style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${gold} 13%, transparent), color-mix(in srgb, ${gold} 3%, transparent))`, border: `1px solid color-mix(in srgb, ${gold} 19%, transparent)` }}>
              <Target size={28} style={{ color: gold }} />
            </div>

            <h2 className="text-lg font-bold mb-2" style={{ color: C.textPrimary }}>LeadMiner</h2>
            <p className="text-sm leading-relaxed mb-1" style={{ color: C.textBody }}>
              No prospect profiles yet.
            </p>
            <p className="text-xs mb-6" style={{ color: C.textMuted }}>
              Create a profile to define who you want to reach. AI will use this to personalize outreach.
            </p>

            <button onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 rounded-lg px-8 py-3 text-sm font-semibold transition-[opacity,transform,box-shadow,background-color,border-color] hover:shadow-lg hover:opacity-95"
              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#04070d" }}>
              <Plus size={16} /> Create First Profile
            </button>

            <div className="mt-8 pt-6 border-t grid grid-cols-3 gap-4" style={{ borderColor: C.border }}>
              {[
                { icon: "1", label: "Define your ideal prospect" },
                { icon: "2", label: "SWL reviews & approves" },
                { icon: "3", label: "Campaigns target the right people" },
              ].map(step => (
                <div key={step.icon} className="text-center">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center mx-auto mb-1.5 text-xs font-bold"
                    style={{ backgroundColor: goldLight, color: gold, border: `1px solid color-mix(in srgb, ${gold} 19%, transparent)` }}>
                    {step.icon}
                  </div>
                  <p className="text-xs" style={{ color: C.textMuted }}>{step.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

      /* Profiles list */
      ) : !showForm && !editingId && !selectedId ? (
        <div className="space-y-3">
          {profiles.map(p => {
            const tags = [...(p.target_industries ?? []), ...(p.target_roles ?? [])];
            const execStatus = (p as any).execution_status ?? "not_started";

            // Build pipeline steps with current position
            const pipelineSteps = [
              { key: "submitted",  label: "Submitted" },
              { key: "approved",   label: "Approved" },
              { key: "uploaded",   label: "Leads Ready" },
              { key: "completed",  label: "Completed" },
            ];
            let currentStep = 0;
            if (p.status === "approved" || p.status === "reviewed") currentStep = 1;
            if (p.status === "approved" && (execStatus === "uploaded" || execStatus === "in_progress")) currentStep = 2;
            if (p.status === "approved" && execStatus === "completed") currentStep = 3;
            if (p.status === "rejected") currentStep = -1;

            return (
              <button key={p.id} onClick={() => setSelectedId(p.id)}
                className="w-full text-left rounded-2xl border p-5 transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:shadow-md"
                style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 16px rgba(0,0,0,0.04)" }}>
                <div className="flex items-center gap-4 mb-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${gold} 13%, transparent), color-mix(in srgb, ${gold} 3%, transparent))`, border: `1px solid color-mix(in srgb, ${gold} 15%, transparent)` }}>
                    <Target size={18} style={{ color: gold }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm" style={{ color: C.textPrimary }}>{p.profile_name}</h3>
                    <div className="flex items-center gap-4 text-xs mt-0.5" style={{ color: C.textMuted }}>
                      {tags.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Briefcase size={10} /> {tags.slice(0, 3).join(", ")}{tags.length > 3 ? ` +${tags.length - 3}` : ""}
                        </span>
                      )}
                      {p.company_size && (
                        <span className="flex items-center gap-1"><Users size={10} /> {p.company_size}</span>
                      )}
                      {p.geography?.length > 0 && (
                        <span className="flex items-center gap-1"><MapPin size={10} /> {p.geography.slice(0, 2).join(", ")}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight size={16} style={{ color: C.textDim }} />
                </div>

                {/* Progress tracker */}
                {p.status === "rejected" ? (
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: C.redLight }}>
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: C.red }} />
                    <span className="text-xs font-medium" style={{ color: C.red }}>Profile was not approved. Please revise and resubmit.</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-0.5">
                    {pipelineSteps.map((step, i) => {
                      const isDone = i <= currentStep;
                      const isCurrent = i === currentStep;
                      return (
                        <div key={step.key} className="flex items-center gap-0.5 flex-1">
                          <div className="flex-1">
                            <div className="h-1.5 rounded-full" style={{
                              backgroundColor: isDone
                                ? isCurrent ? gold : C.green
                                : C.border,
                            }} />
                            <p className="text-xs mt-1 truncate" style={{
                              color: isCurrent ? gold : isDone ? C.green : C.textDim,
                              fontWeight: isCurrent ? 600 : 400,
                            }}>
                              {step.label}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ─── ProfileDetail helpers ──────────────────────────────────────────────────

function OverviewCard({
  icon: Icon, label, accent, bg, children,
}: {
  icon: typeof Target; label: string; accent: string; bg: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border p-3.5" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: bg }}>
          <Icon size={12} style={{ color: accent }} />
        </div>
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</p>
      </div>
      {children}
    </div>
  );
}

function AccentBlock({
  icon: Icon, title, accent, bg, children,
}: {
  icon: typeof Target; title: string; accent: string; bg: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderLeft: `3px solid ${accent}` }}>
      <div className="px-4 py-2.5 flex items-center gap-2 border-b"
        style={{ borderColor: C.border, background: `linear-gradient(90deg, ${bg}, transparent)` }}>
        <Icon size={13} style={{ color: accent }} />
        <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: accent }}>{title}</p>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// Renders ICP notes paragraph-by-paragraph and highlights tier tokens
// (HOT / WARM / NURTURE / DISCARD) + money figures (£XX) as inline badges.
function NotesRenderer({ text }: { text: string }) {
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());

  return (
    <div className="space-y-3">
      {paragraphs.map((para, idx) => (
        <p key={idx} className="text-[13px] leading-relaxed whitespace-pre-line" style={{ color: C.textBody }}>
          {highlightTokens(para)}
        </p>
      ))}
    </div>
  );
}

const TIER_STYLES: Record<string, { color: string; bg: string }> = {
  HOT:     { color: C.red,     bg: C.redLight },
  WARM:    { color: "#D97706", bg: C.yellowLight },
  NURTURE: { color: C.blue,    bg: C.blueLight },
  DISCARD: { color: C.textMuted, bg: "#F3F4F6" },
};

function highlightTokens(text: string): React.ReactNode[] {
  const pattern = /\b(HOT|WARM|NURTURE|DISCARD)\b/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const tier = match[1];
    const style = TIER_STYLES[tier];
    nodes.push(
      <span key={`t-${i++}`} className="inline-block text-[10px] font-bold px-1.5 py-0.5 rounded align-middle mx-0.5"
        style={{ backgroundColor: style.bg, color: style.color }}>
        {tier}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

