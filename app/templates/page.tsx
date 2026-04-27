"use client";

import { useState, useEffect } from "react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { C } from "@/lib/design";
import { BookOpen, Plus, X, Pencil, Trash2, Loader2, MessageCircle, Mail, Phone, Share2 } from "lucide-react";

const gold = C.gold;

type Template = {
  id: string;
  company_bio_id: string;
  icp_profile_id: string | null;
  industry: string | null;
  channel: string;
  step_position: string;
  label: string | null;
  template_text: string;
  tone_tags: string[] | null;
  performance_score: number | null;
  status: "active" | "draft" | "archived";
  created_at: string;
  updated_at: string;
};

type IcpOption = { id: string; profile_name: string };

const CHANNELS = [
  { value: "linkedin", label: "LinkedIn", icon: Share2, color: C.linkedin },
  { value: "email",    label: "Email",    icon: Mail,   color: C.email },
  { value: "whatsapp", label: "WhatsApp", icon: MessageCircle, color: "#25D366" },
  { value: "sms",      label: "SMS",      icon: MessageCircle, color: "#9333EA" },
  { value: "call",     label: "Call",     icon: Phone,  color: C.phone },
];

const STEP_POSITIONS = [
  { value: "connection_request", label: "Connection Request" },
  { value: "first_dm",           label: "First DM (post-connection)" },
  { value: "followup_1",         label: "Follow-up 1" },
  { value: "followup_2",         label: "Follow-up 2" },
  { value: "cta",                label: "CTA / Book a call" },
  { value: "breakup",            label: "Breakup" },
  { value: "other",              label: "Other" },
];

const TONE_OPTIONS = ["formal", "casual", "witty", "direct", "soft", "consultative", "urgent"];

const STATUS_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  active:   { label: "Active",   color: C.green,  bg: C.greenLight },
  draft:    { label: "Draft",    color: C.yellow, bg: C.yellowLight },
  archived: { label: "Archived", color: C.textDim, bg: C.bg },
};

const emptyForm = {
  icp_profile_id: null as string | null,
  industry: "",
  channel: "linkedin",
  step_position: "first_dm",
  label: "",
  template_text: "",
  tone_tags: [] as string[],
  performance_score: null as number | null,
  status: "active" as "active" | "draft" | "archived",
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [icpOptions, setIcpOptions] = useState<IcpOption[]>([]);
  const [companyBioId, setCompanyBioId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterChannel, setFilterChannel] = useState<string>("all");
  const [filterStep, setFilterStep] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("active");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    const sb = getSupabaseBrowser();
    const [meRes, icpRes, tplRes] = await Promise.all([
      fetch("/api/auth/me").then(r => r.json()),
      sb.from("icp_profiles").select("id, profile_name").order("profile_name"),
      sb.from("message_templates").select("*").order("updated_at", { ascending: false }),
    ]);
    setCompanyBioId(meRes?.user?.companyBioId ?? null);
    setIcpOptions((icpRes.data as IcpOption[]) ?? []);
    setTemplates((tplRes.data as Template[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = templates.filter(t => {
    if (filterChannel !== "all" && t.channel !== filterChannel) return false;
    if (filterStep !== "all" && t.step_position !== filterStep) return false;
    if (filterStatus !== "all" && t.status !== filterStatus) return false;
    return true;
  });

  async function handleSave(form: typeof emptyForm) {
    const sb = getSupabaseBrowser();
    const payload = {
      ...form,
      company_bio_id: companyBioId,
      industry: form.industry.trim() || null,
      label: form.label.trim() || null,
      icp_profile_id: form.icp_profile_id || null,
    };
    if (editingId) {
      const { error } = await sb.from("message_templates").update(payload).eq("id", editingId);
      if (error) { alert(error.message); return; }
    } else {
      const { error } = await sb.from("message_templates").insert(payload);
      if (error) { alert(error.message); return; }
    }
    setShowForm(false);
    setEditingId(null);
    await load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this template? This can't be undone.")) return;
    const sb = getSupabaseBrowser();
    const { error } = await sb.from("message_templates").delete().eq("id", id);
    if (error) { alert(error.message); return; }
    await load();
  }

  function startEdit(t: Template) {
    setEditingId(t.id);
    setShowForm(true);
  }
  function startNew() {
    setEditingId(null);
    setShowForm(true);
  }

  const editingTemplate = editingId ? templates.find(t => t.id === editingId) : null;
  const initialForm = editingTemplate
    ? {
        icp_profile_id: editingTemplate.icp_profile_id,
        industry: editingTemplate.industry ?? "",
        channel: editingTemplate.channel,
        step_position: editingTemplate.step_position,
        label: editingTemplate.label ?? "",
        template_text: editingTemplate.template_text,
        tone_tags: editingTemplate.tone_tags ?? [],
        performance_score: editingTemplate.performance_score,
        status: editingTemplate.status,
      }
    : emptyForm;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <BookOpen size={20} style={{ color: gold }} />
            <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>Message Templates</h1>
          </div>
          <p className="text-sm" style={{ color: C.textMuted }}>
            Library of proven outreach copy — fed as few-shot examples to the message generator when creating campaigns.
          </p>
        </div>
        <button
          onClick={startNew}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold"
          style={{ backgroundColor: gold, color: "#fff" }}>
          <Plus size={14} /> New Template
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <FilterPill label="Channel" value={filterChannel} onChange={setFilterChannel}
          options={[{ value: "all", label: "All" }, ...CHANNELS.map(c => ({ value: c.value, label: c.label }))]} />
        <FilterPill label="Step" value={filterStep} onChange={setFilterStep}
          options={[{ value: "all", label: "All" }, ...STEP_POSITIONS]} />
        <FilterPill label="Status" value={filterStatus} onChange={setFilterStatus}
          options={[{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "draft", label: "Draft" }, { value: "archived", label: "Archived" }]} />
        <span className="ml-auto text-xs" style={{ color: C.textMuted }}>
          {filtered.length} of {templates.length}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} className="animate-spin" style={{ color: gold }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <BookOpen size={32} className="mx-auto mb-3" style={{ color: C.textDim }} />
          <p className="text-sm font-medium mb-1" style={{ color: C.textBody }}>
            {templates.length === 0 ? "No templates yet" : "No templates match the filters"}
          </p>
          <p className="text-xs" style={{ color: C.textMuted }}>
            {templates.length === 0
              ? "Add your first proven outreach template — the AI will use it as a reference when generating new messages."
              : "Try changing the channel / step / status filters above."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(t => (
            <TemplateCard
              key={t.id}
              tpl={t}
              icpName={icpOptions.find(i => i.id === t.icp_profile_id)?.profile_name ?? null}
              onEdit={() => startEdit(t)}
              onDelete={() => handleDelete(t.id)}
            />
          ))}
        </div>
      )}

      {showForm && (
        <TemplateForm
          initial={initialForm}
          icpOptions={icpOptions}
          isEdit={!!editingId}
          onCancel={() => { setShowForm(false); setEditingId(null); }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function FilterPill({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="text-xs px-3 py-1.5 rounded-lg border outline-none"
        style={{ backgroundColor: C.card, borderColor: C.border, color: C.textBody }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function TemplateCard({ tpl, icpName, onEdit, onDelete }: {
  tpl: Template;
  icpName: string | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const channelMeta = CHANNELS.find(c => c.value === tpl.channel);
  const stepMeta = STEP_POSITIONS.find(s => s.value === tpl.step_position);
  const statusMeta = STATUS_STYLES[tpl.status] ?? STATUS_STYLES.active;
  const Icon = channelMeta?.icon ?? Share2;

  return (
    <div className="rounded-xl border p-4 flex flex-col gap-3" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={14} style={{ color: channelMeta?.color ?? C.textMuted }} />
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
            {stepMeta?.label ?? tpl.step_position}
          </span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color: statusMeta.color, backgroundColor: statusMeta.bg }}>
            {statusMeta.label}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} className="p-1.5 rounded hover:bg-black/5" title="Edit">
            <Pencil size={12} style={{ color: C.textMuted }} />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded hover:bg-red-50" title="Delete">
            <Trash2 size={12} style={{ color: "#DC2626" }} />
          </button>
        </div>
      </div>

      {tpl.label && (
        <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{tpl.label}</p>
      )}

      <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>
        {tpl.template_text}
      </p>

      <div className="flex flex-wrap items-center gap-1.5 mt-auto pt-2 border-t" style={{ borderColor: C.border }}>
        {icpName && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ color: gold, backgroundColor: C.goldGlow }}>
            ICP: {icpName}
          </span>
        )}
        {tpl.industry && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ color: C.textMuted, backgroundColor: C.bg }}>
            {tpl.industry}
          </span>
        )}
        {(tpl.tone_tags ?? []).map(tag => (
          <span key={tag} className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ color: C.blue, backgroundColor: C.blueLight }}>
            {tag}
          </span>
        ))}
        {tpl.performance_score != null && (
          <span className="ml-auto text-[10px] font-bold" style={{ color: C.green }}>
            ★ {tpl.performance_score}
          </span>
        )}
      </div>
    </div>
  );
}

function TemplateForm({ initial, icpOptions, isEdit, onSave, onCancel }: {
  initial: typeof emptyForm;
  icpOptions: IcpOption[];
  isEdit: boolean;
  onSave: (form: typeof emptyForm) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);

  function toggleTone(tag: string) {
    setForm(f => ({
      ...f,
      tone_tags: f.tone_tags.includes(tag) ? f.tone_tags.filter(t => t !== tag) : [...f.tone_tags, tag],
    }));
  }

  async function submit() {
    if (!form.template_text.trim()) { alert("Template text is required"); return; }
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" style={{ backgroundColor: C.card }}>
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: C.border }}>
          <h2 className="text-base font-bold" style={{ color: C.textPrimary }}>
            {isEdit ? "Edit Template" : "New Template"}
          </h2>
          <button onClick={onCancel} className="p-1 rounded hover:bg-black/5"><X size={16} /></button>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Channel">
            <select value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))} className="w-full text-sm px-3 py-2 rounded-lg border" style={{ borderColor: C.border, backgroundColor: C.bg }}>
              {CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Step Position">
            <select value={form.step_position} onChange={e => setForm(f => ({ ...f, step_position: e.target.value }))} className="w-full text-sm px-3 py-2 rounded-lg border" style={{ borderColor: C.border, backgroundColor: C.bg }}>
              {STEP_POSITIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="ICP Profile (optional)">
            <select value={form.icp_profile_id ?? ""} onChange={e => setForm(f => ({ ...f, icp_profile_id: e.target.value || null }))} className="w-full text-sm px-3 py-2 rounded-lg border" style={{ borderColor: C.border, backgroundColor: C.bg }}>
              <option value="">— Any ICP —</option>
              {icpOptions.map(i => <option key={i.id} value={i.id}>{i.profile_name}</option>)}
            </select>
          </Field>
          <Field label="Industry (optional)">
            <input type="text" value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} placeholder="e.g. Asset Finance, SaaS, Healthcare" className="w-full text-sm px-3 py-2 rounded-lg border" style={{ borderColor: C.border, backgroundColor: C.bg }} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Label (short description)">
              <input type="text" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder='e.g. "Pathway opener — Asset finance hot lead"' className="w-full text-sm px-3 py-2 rounded-lg border" style={{ borderColor: C.border, backgroundColor: C.bg }} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Template text">
              <textarea
                value={form.template_text}
                onChange={e => setForm(f => ({ ...f, template_text: e.target.value }))}
                placeholder='Use {{first_name}}, {{role}}, {{company}}, {{seller_name}} and any enrichment placeholders. Example: "Hola {{first_name}}, vi que en {{company}} ..."'
                rows={6}
                className="w-full text-sm px-3 py-2 rounded-lg border resize-y font-mono"
                style={{ borderColor: C.border, backgroundColor: C.bg }}
              />
            </Field>
            <p className="text-[10px] mt-1" style={{ color: C.textMuted }}>
              Available placeholders: <code>{"{{first_name}} {{last_name}} {{role}} {{company}} {{seller_name}}"}</code> + any enrichment field on the lead.
            </p>
          </div>
          <div className="md:col-span-2">
            <Field label="Tone tags">
              <div className="flex flex-wrap gap-1.5">
                {TONE_OPTIONS.map(tag => (
                  <button key={tag} onClick={() => toggleTone(tag)} type="button"
                    className="text-xs font-medium px-3 py-1 rounded-full border transition-all"
                    style={{
                      borderColor: form.tone_tags.includes(tag) ? gold : C.border,
                      backgroundColor: form.tone_tags.includes(tag) ? C.goldGlow : C.bg,
                      color: form.tone_tags.includes(tag) ? gold : C.textBody,
                    }}>
                    {tag}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <Field label="Performance score (optional)">
            <input type="number" value={form.performance_score ?? ""} onChange={e => setForm(f => ({ ...f, performance_score: e.target.value ? parseFloat(e.target.value) : null }))} placeholder="e.g. 8.5" step="0.1" className="w-full text-sm px-3 py-2 rounded-lg border" style={{ borderColor: C.border, backgroundColor: C.bg }} />
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as "active" | "draft" | "archived" }))} className="w-full text-sm px-3 py-2 rounded-lg border" style={{ borderColor: C.border, backgroundColor: C.bg }}>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: C.border }}>
          <button onClick={onCancel} className="text-sm font-medium px-3 py-1.5 rounded-lg" style={{ color: C.textBody }}>Cancel</button>
          <button onClick={submit} disabled={saving} className="flex items-center gap-1.5 text-sm font-semibold px-4 py-1.5 rounded-lg disabled:opacity-50" style={{ backgroundColor: gold, color: "#fff" }}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : null}
            {isEdit ? "Save Changes" : "Create Template"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-wider mb-1 block" style={{ color: C.textMuted }}>{label}</span>
      {children}
    </label>
  );
}
