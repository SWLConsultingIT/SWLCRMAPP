"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import {
  Target, Plus, X, CheckCircle, AlertCircle, Clock, Loader2,
  Pencil, Trash2, ChevronRight, Users, MapPin, Briefcase,
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
          style={{ backgroundColor: goldLight, color: gold, border: `1px solid rgba(201,168,58,0.25)` }}>
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
    <div className="rounded-xl border mb-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b" style={{ borderColor: C.border }}>
        <h2 className="text-sm font-semibold" style={{ color: C.textPrimary }}>
          {isNew ? "New Lead Gen Profile" : "Edit Profile"}
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
            placeholder="Additional context, references, similar case studies…" />
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

  return (
    <div className="rounded-xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${gold}, #e8c84a, ${gold})` }} />

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
          <button onClick={onEdit}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-80"
            style={{ backgroundColor: goldLight, color: gold, border: `1px solid rgba(201,168,58,0.3)` }}>
            <Pencil size={12} /> Edit
          </button>
          <button onClick={onClose} style={{ color: C.textMuted }}><X size={18} /></button>
        </div>
      </div>

      <div className="border-t" style={{ borderColor: C.border }} />

      {/* Metrics */}
      <div className="px-6 py-4 grid grid-cols-4 gap-4">
        {profile.target_industries?.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>Industries</p>
            <div className="flex flex-wrap gap-1">
              {profile.target_industries.map(i => (
                <span key={i} className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: C.blueLight, color: C.blue }}>{i}</span>
              ))}
            </div>
          </div>
        )}
        {profile.target_roles?.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>Roles</p>
            <div className="flex flex-wrap gap-1">
              {profile.target_roles.map(r => (
                <span key={r} className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: C.accentLight, color: C.accent }}>{r}</span>
              ))}
            </div>
          </div>
        )}
        {profile.company_size && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>Company Size</p>
            <p className="text-sm font-bold" style={{ color: C.textPrimary }}>{profile.company_size} employees</p>
          </div>
        )}
        {profile.geography?.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>Geography</p>
            <div className="flex flex-wrap gap-1">
              {profile.geography.map(g => (
                <span key={g} className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: C.orangeLight, color: C.orange }}>{g}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Content grid */}
      {(profile.pain_points || profile.solutions_offered) && (
        <div className="px-6 pb-5 grid grid-cols-2 gap-6">
          {profile.pain_points && (
            <div className="rounded-lg border p-4" style={{ borderColor: C.border, backgroundColor: "#F9FAFB" }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: gold }}>Pain Points</p>
              <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: C.textBody }}>{profile.pain_points}</p>
            </div>
          )}
          {profile.solutions_offered && (
            <div className="rounded-lg border p-4" style={{ borderColor: C.border, backgroundColor: "#F9FAFB" }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: gold }}>Solutions Offered</p>
              <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: C.textBody }}>{profile.solutions_offered}</p>
            </div>
          )}
        </div>
      )}

      {profile.notes && (
        <div className="px-6 pb-5">
          <div className="rounded-lg border p-4" style={{ borderColor: C.border, backgroundColor: "#F9FAFB" }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: C.textMuted }}>Notes</p>
            <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: C.textBody }}>{profile.notes}</p>
          </div>
        </div>
      )}

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
    const { data } = await supabase
      .from("icp_profiles")
      .select("*")
      .order("created_at", { ascending: false });
    setProfiles(data ?? []);
    setLoading(false);
  }

  useEffect(() => { loadProfiles(); }, []);

  async function handleCreate(form: typeof emptyForm) {
    const { data: bio } = await supabase
      .from("company_bios").select("id").order("created_at", { ascending: false }).limit(1).single();

    const { error } = await supabase
      .from("icp_profiles")
      .insert({ ...form, company_bio_id: bio?.id ?? null, status: "pending" });

    if (error) throw error;
    setShowForm(false);
    setSavedMsg("Profile submitted for review.");
    setTimeout(() => setSavedMsg(null), 4000);
    await loadProfiles();
  }

  async function handleUpdate(id: string, form: typeof emptyForm) {
    const { error } = await supabase.from("icp_profiles").update(form).eq("id", id);
    if (error) throw error;
    setEditingId(null);
    setSavedMsg("Profile updated.");
    setTimeout(() => setSavedMsg(null), 4000);
    await loadProfiles();
  }

  async function handleDelete(id: string) {
    await supabase.from("icp_profiles").delete().eq("id", id);
    setSelectedId(null);
    await loadProfiles();
  }

  const selectedProfile = profiles.find(p => p.id === selectedId);
  const editingProfile = profiles.find(p => p.id === editingId);

  return (
    <div className="p-6 w-full">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>Setup</p>
          <h1 className="text-2xl font-bold flex items-center gap-2.5" style={{ color: C.textPrimary }}>
            <Target size={22} style={{ color: gold }} />
            Lead Gen
          </h1>
          <p className="text-sm mt-1" style={{ color: C.textMuted }}>
            Define your ideal prospect profiles. Each profile generates a tailored outreach strategy.
          </p>
        </div>
        {!showForm && !editingId && !selectedId && profiles.length > 0 && (
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ backgroundColor: gold, color: "#04070d" }}>
            <Plus size={15} /> New Profile
          </button>
        )}
      </div>

      <div className="h-px mb-6" style={{ background: `linear-gradient(90deg, ${gold} 0%, rgba(201,168,58,0.15) 40%, transparent 100%)` }} />

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
            <div className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${gold}, #e8c84a, ${gold})` }} />

            <div className="w-16 h-16 rounded-xl flex items-center justify-center mx-auto mb-5"
              style={{ background: `linear-gradient(135deg, ${gold}20, ${gold}08)`, border: `1px solid ${gold}30` }}>
              <Target size={28} style={{ color: gold }} />
            </div>

            <h2 className="text-lg font-bold mb-2" style={{ color: C.textPrimary }}>Lead Gen</h2>
            <p className="text-sm leading-relaxed mb-1" style={{ color: C.textBody }}>
              No prospect profiles yet.
            </p>
            <p className="text-xs mb-6" style={{ color: C.textMuted }}>
              Create a profile to define who you want to reach. AI will use this to personalize outreach.
            </p>

            <button onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 rounded-lg px-8 py-3 text-sm font-semibold transition-all hover:shadow-lg hover:opacity-95"
              style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#04070d" }}>
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
                    style={{ backgroundColor: goldLight, color: gold, border: `1px solid ${gold}30` }}>
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
                className="w-full text-left rounded-xl border p-5 transition-all hover:shadow-sm"
                style={{ backgroundColor: C.card, borderColor: C.border }}>
                <div className="flex items-center gap-4 mb-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: `linear-gradient(135deg, ${gold}20, ${gold}08)`, border: `1px solid ${gold}25` }}>
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
