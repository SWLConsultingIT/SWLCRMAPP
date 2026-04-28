"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { C } from "@/lib/design";
import {
  MessageCircle, BookOpen, Plus, X, Pencil, Trash2, Loader2,
  Mail, Phone, Share2, Save, Layers,
} from "lucide-react";
import EmptyState from "@/components/EmptyState";
import PageHero from "@/components/PageHero";
import { useLocale } from "@/lib/i18n";

const gold = C.gold;

// ──────────────────────────────────────────────────────────────────────────────
// Brand Voice — tone + ideal_message_examples for the user's own tenant
// ──────────────────────────────────────────────────────────────────────────────

type VoiceExample = { body: string; step_type: string };

const STEP_TYPES = [
  "LINKEDIN_CONNECTION_REQUEST",
  "LINKEDIN_INTRO_DM",
  "LINKEDIN_FOLLOWUP_BUMP",
  "LINKEDIN_FOLLOWUP_PROOF",
  "LINKEDIN_FOLLOWUP_INTERRUPT",
  "LINKEDIN_FOLLOWUP_BREAKUP",
  "EMAIL_INTRO",
  "EMAIL_FOLLOWUP",
  "CALL_FIRST",
];

function BrandVoiceTab() {
  const { t } = useLocale();
  const [bio, setBio] = useState<{ id: string; company_name: string; tone_of_voice: string | null; ideal_message_examples: VoiceExample[] | null } | null>(null);
  const [tone, setTone] = useState("");
  const [examples, setExamples] = useState<VoiceExample[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    fetch("/api/voice").then(r => r.json()).then(d => {
      if (d.bio) {
        setBio(d.bio);
        setTone(d.bio.tone_of_voice ?? "");
        setExamples(d.bio.ideal_message_examples ?? []);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  function addExample() { setExamples(arr => [...arr, { body: "", step_type: "LINKEDIN_INTRO_DM" }]); }
  function updateExample(i: number, patch: Partial<VoiceExample>) {
    setExamples(arr => arr.map((e, idx) => idx === i ? { ...e, ...patch } : e));
  }
  function removeExample(i: number) { setExamples(arr => arr.filter((_, idx) => idx !== i)); }

  async function save() {
    setSaving(true);
    try {
      const cleaned = examples.map(e => ({ body: e.body.trim(), step_type: e.step_type })).filter(e => e.body);
      const res = await fetch("/api/voice", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tone_of_voice: tone.trim() || null, ideal_message_examples: cleaned }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Save failed" }));
        alert(error || "Save failed");
        return;
      }
      setSavedAt(new Date());
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 size={20} className="animate-spin" style={{ color: gold }} /></div>;
  if (!bio) return <p className="text-sm" style={{ color: C.textMuted }}>{t("voice.noTenant")}</p>;

  return (
    <div>
      <div className="flex items-start justify-between mb-5">
        <p className="text-sm max-w-xl" style={{ color: C.textMuted }}>
          {t("voice.brand.subtitle.before")} <span className="font-semibold" style={{ color: C.textBody }}>{bio.company_name}</span>{t("voice.brand.subtitle.after")}
        </p>
        <div className="flex items-center gap-3 shrink-0">
          {savedAt && (
            <span className="text-xs" style={{ color: C.green }}>
              {t("voice.saved")} {savedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-[opacity,transform,box-shadow] duration-150 hover:opacity-95 hover:shadow-md disabled:opacity-50"
            style={{
              background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 80%, white))`,
              color: "#04070d",
              boxShadow: `0 4px 16px color-mix(in srgb, ${gold} 28%, transparent)`,
            }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? t("voice.saving") : t("voice.save")}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border p-5 mb-6" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] mb-2 block" style={{ color: C.textMuted }}>{t("voice.brand.toneLabel")}</span>
          <textarea value={tone} onChange={e => setTone(e.target.value)}
            placeholder={t("voice.brand.tonePlaceholder")}
            rows={3}
            className="w-full text-sm px-3 py-2 rounded-lg border resize-y"
            style={{ borderColor: C.border, backgroundColor: C.bg }} />
        </label>
        <p className="text-[10px] mt-1.5" style={{ color: C.textMuted }}>
          {t("voice.brand.toneHelp")}
        </p>
      </div>

      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: C.textMuted }}>
          {t("voice.brand.examplesLabel")} ({examples.length})
        </span>
        <button onClick={addExample}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80"
          style={{ backgroundColor: C.goldGlow, color: gold, border: `1px solid color-mix(in srgb, ${gold} 25%, transparent)` }}>
          <Plus size={12} /> {t("voice.brand.addExample")}
        </button>
      </div>

      {examples.length === 0 ? (
        <EmptyState
          icon={MessageCircle}
          title={t("voice.brand.empty.title")}
          description={t("voice.brand.empty.desc")}
          primaryCta={{ label: t("voice.brand.empty.cta"), onClick: addExample }}
        />
      ) : (
        <div className="space-y-3">
          {examples.map((ex, i) => (
            <div key={i} className="rounded-2xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 16px rgba(0,0,0,0.04)" }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <select value={ex.step_type} onChange={e => updateExample(i, { step_type: e.target.value })}
                  className="text-xs px-3 py-1.5 rounded-lg border outline-none"
                  style={{ backgroundColor: C.bg, borderColor: C.border, color: C.textBody }}>
                  {STEP_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={() => removeExample(i)} className="p-1.5 rounded hover:bg-red-50" title={t("voice.brand.remove")}>
                  <Trash2 size={12} style={{ color: "#DC2626" }} />
                </button>
              </div>
              <textarea value={ex.body} onChange={e => updateExample(i, { body: e.target.value })}
                placeholder={t("voice.brand.examplePlaceholder")}
                rows={5}
                className="w-full text-sm px-3 py-2 rounded-lg border resize-y font-mono"
                style={{ borderColor: C.border, backgroundColor: C.bg }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Templates Library
// ──────────────────────────────────────────────────────────────────────────────

type Template = {
  id: string; company_bio_id: string; icp_profile_id: string | null;
  industry: string | null; channel: string; step_position: string;
  label: string | null; template_text: string; tone_tags: string[] | null;
  performance_score: number | null; status: "active" | "draft" | "archived";
  sequence_id: string | null; sequence_order: number | null;
  created_at: string; updated_at: string;
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

function TemplatesTab() {
  const { t: tr } = useLocale();
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

  const editingTemplate = editingId ? templates.find(t => t.id === editingId) : null;
  const initialForm = editingTemplate
    ? {
        icp_profile_id: editingTemplate.icp_profile_id, industry: editingTemplate.industry ?? "",
        channel: editingTemplate.channel, step_position: editingTemplate.step_position,
        label: editingTemplate.label ?? "", template_text: editingTemplate.template_text,
        tone_tags: editingTemplate.tone_tags ?? [], performance_score: editingTemplate.performance_score,
        status: editingTemplate.status,
      }
    : emptyForm;

  return (
    <div>
      <div className="flex items-start justify-between mb-5">
        <p className="text-sm max-w-xl" style={{ color: C.textMuted }}>
          Library of proven outreach copy. The AI uses these as few-shot references when generating new campaigns — keep the best ones marked Active.
        </p>
        <button onClick={() => { setEditingId(null); setShowForm(true); }}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold shrink-0"
          style={{ backgroundColor: gold, color: "#fff" }}>
          <Plus size={14} /> New Template
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <FilterPill label="Channel" value={filterChannel} onChange={setFilterChannel}
          options={[{ value: "all", label: "All" }, ...CHANNELS.map(c => ({ value: c.value, label: c.label }))]} />
        <FilterPill label="Step" value={filterStep} onChange={setFilterStep}
          options={[{ value: "all", label: "All" }, ...STEP_POSITIONS]} />
        <FilterPill label="Status" value={filterStatus} onChange={setFilterStatus}
          options={[{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "draft", label: "Draft" }, { value: "archived", label: "Archived" }]} />
        <span className="ml-auto text-xs" style={{ color: C.textMuted }}>{filtered.length} of {templates.length}</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 size={20} className="animate-spin" style={{ color: gold }} /></div>
      ) : filtered.length === 0 ? (
        templates.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={tr("voice.tpl.empty.title")}
            description={tr("voice.tpl.empty.desc")}
            primaryCta={{ label: `+ ${tr("voice.tpl.new")}`, onClick: () => { setEditingId(null); setShowForm(true); } }}
          />
        ) : (
          <EmptyState
            icon={BookOpen}
            title="No templates match the filters"
            description="Try a different channel, step, or status — or clear the filters above to see your full library."
            primaryCta={{ label: "Clear filters", onClick: () => { setFilterChannel("all"); setFilterStep("all"); setFilterStatus("all"); } }}
          />
        )
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(t => (
            <TemplateCard key={t.id} tpl={t}
              icpName={icpOptions.find(i => i.id === t.icp_profile_id)?.profile_name ?? null}
              onEdit={() => { setEditingId(t.id); setShowForm(true); }}
              onDelete={() => handleDelete(t.id)} />
          ))}
        </div>
      )}

      {showForm && (
        <TemplateForm initial={initialForm} icpOptions={icpOptions} isEdit={!!editingId}
          onCancel={() => { setShowForm(false); setEditingId(null); }}
          onSave={handleSave} />
      )}
    </div>
  );
}

function FilterPill({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="text-xs px-3 py-1.5 rounded-lg border outline-none"
        style={{ backgroundColor: C.card, borderColor: C.border, color: C.textBody }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function TemplateCard({ tpl, icpName, onEdit, onDelete }: { tpl: Template; icpName: string | null; onEdit: () => void; onDelete: () => void }) {
  const channelMeta = CHANNELS.find(c => c.value === tpl.channel);
  const stepMeta = STEP_POSITIONS.find(s => s.value === tpl.step_position);
  const statusMeta = STATUS_STYLES[tpl.status] ?? STATUS_STYLES.active;
  const Icon = channelMeta?.icon ?? Share2;
  return (
    <div className="rounded-xl border p-4 flex flex-col gap-3" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon size={14} style={{ color: channelMeta?.color ?? C.textMuted }} />
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>{stepMeta?.label ?? tpl.step_position}</span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color: statusMeta.color, backgroundColor: statusMeta.bg }}>{statusMeta.label}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} className="p-1.5 rounded hover:bg-black/5" title="Edit"><Pencil size={12} style={{ color: C.textMuted }} /></button>
          <button onClick={onDelete} className="p-1.5 rounded hover:bg-red-50" title="Delete"><Trash2 size={12} style={{ color: "#DC2626" }} /></button>
        </div>
      </div>
      {tpl.label && <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{tpl.label}</p>}
      <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{tpl.template_text}</p>
      <div className="flex flex-wrap items-center gap-1.5 mt-auto pt-2 border-t" style={{ borderColor: C.border }}>
        {icpName && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ color: gold, backgroundColor: C.goldGlow }}>ICP: {icpName}</span>}
        {tpl.industry && <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ color: C.textMuted, backgroundColor: C.bg }}>{tpl.industry}</span>}
        {(tpl.tone_tags ?? []).map(tag => (
          <span key={tag} className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ color: C.blue, backgroundColor: C.blueLight }}>{tag}</span>
        ))}
        {tpl.performance_score != null && <span className="ml-auto text-[10px] font-bold" style={{ color: C.green }}>★ {tpl.performance_score}</span>}
      </div>
    </div>
  );
}

function TemplateForm({ initial, icpOptions, isEdit, onSave, onCancel }: { initial: typeof emptyForm; icpOptions: IcpOption[]; isEdit: boolean; onSave: (form: typeof emptyForm) => Promise<void>; onCancel: () => void }) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  function toggleTone(tag: string) { setForm(f => ({ ...f, tone_tags: f.tone_tags.includes(tag) ? f.tone_tags.filter(t => t !== tag) : [...f.tone_tags, tag] })); }
  async function submit() {
    if (!form.template_text.trim()) { alert("Template text is required"); return; }
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" style={{ backgroundColor: C.card }}>
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: C.border }}>
          <h2 className="text-base font-bold" style={{ color: C.textPrimary }}>{isEdit ? "Edit Template" : "New Template"}</h2>
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
              <textarea value={form.template_text} onChange={e => setForm(f => ({ ...f, template_text: e.target.value }))}
                placeholder='Use {{first_name}}, {{role}}, {{company}}, {{seller_name}} and any enrichment placeholders.'
                rows={6} className="w-full text-sm px-3 py-2 rounded-lg border resize-y font-mono"
                style={{ borderColor: C.border, backgroundColor: C.bg }} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Tone tags">
              <div className="flex flex-wrap gap-1.5">
                {TONE_OPTIONS.map(tag => (
                  <button key={tag} onClick={() => toggleTone(tag)} type="button"
                    className="text-xs font-medium px-3 py-1 rounded-full border transition-[opacity,transform,box-shadow,background-color,border-color]"
                    style={{ borderColor: form.tone_tags.includes(tag) ? gold : C.border, backgroundColor: form.tone_tags.includes(tag) ? C.goldGlow : C.bg, color: form.tone_tags.includes(tag) ? gold : C.textBody }}>
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

// ──────────────────────────────────────────────────────────────────────────────
// Sequences — ordered groups of templates that tell a coherent story
// ──────────────────────────────────────────────────────────────────────────────

type Sequence = {
  id: string;
  company_bio_id: string;
  icp_profile_id: string | null;
  name: string;
  description: string | null;
  industry: string | null;
  channels: string[];
  status: "active" | "draft" | "archived";
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

type SequenceStep = { step_position: string; template_id: string };

const emptySequence = {
  name: "",
  description: "",
  industry: "",
  icp_profile_id: null as string | null,
  channels: ["linkedin"],
  status: "active" as "active" | "draft" | "archived",
  steps: [] as SequenceStep[],
};

function SequencesTab() {
  const { t: tr } = useLocale();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [allTemplates, setAllTemplates] = useState<Template[]>([]);
  const [icpOptions, setIcpOptions] = useState<IcpOption[]>([]);
  const [companyBioId, setCompanyBioId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingSteps, setEditingSteps] = useState<SequenceStep[]>([]);

  async function load() {
    const sb = getSupabaseBrowser();
    const [meRes, icpRes, tplRes, seqRes] = await Promise.all([
      fetch("/api/auth/me").then(r => r.json()),
      sb.from("icp_profiles").select("id, profile_name").order("profile_name"),
      sb.from("message_templates").select("*").order("step_position"),
      sb.from("message_sequences").select("*").order("updated_at", { ascending: false }),
    ]);
    setCompanyBioId(meRes?.user?.companyBioId ?? null);
    setIcpOptions((icpRes.data as IcpOption[]) ?? []);
    setAllTemplates((tplRes.data as Template[]) ?? []);
    setSequences((seqRes.data as Sequence[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // For showing each sequence card, compute its steps from templates
  function stepsOf(seqId: string): Template[] {
    return allTemplates
      .filter(t => t.sequence_id === seqId)
      .sort((a, b) => (a.sequence_order ?? 999) - (b.sequence_order ?? 999));
  }

  function startEdit(seq: Sequence) {
    setEditingId(seq.id);
    const tpls = stepsOf(seq.id);
    setEditingSteps(tpls.map(t => ({ step_position: t.step_position, template_id: t.id })));
    setShowForm(true);
  }
  function startNew() {
    setEditingId(null);
    setEditingSteps([]);
    setShowForm(true);
  }

  async function handleSave(form: typeof emptySequence) {
    const sb = getSupabaseBrowser();
    const payload = {
      company_bio_id: companyBioId,
      icp_profile_id: form.icp_profile_id || null,
      name: form.name.trim(),
      description: form.description.trim() || null,
      industry: form.industry.trim() || null,
      channels: form.channels,
      status: form.status,
    };

    let seqId = editingId;
    if (editingId) {
      const { error } = await sb.from("message_sequences").update(payload).eq("id", editingId);
      if (error) { alert(error.message); return; }
    } else {
      const { data, error } = await sb.from("message_sequences").insert(payload).select("id").single();
      if (error || !data) { alert(error?.message || "Insert failed"); return; }
      seqId = data.id;
    }

    if (!seqId) return;

    // Reset steps: clear current, then assign new ones
    await sb.from("message_templates").update({ sequence_id: null, sequence_order: null }).eq("sequence_id", seqId);
    for (let i = 0; i < form.steps.length; i++) {
      const s = form.steps[i];
      if (!s.template_id) continue;
      await sb.from("message_templates").update({ sequence_id: seqId, sequence_order: i }).eq("id", s.template_id);
    }

    setShowForm(false);
    setEditingId(null);
    setEditingSteps([]);
    await load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this sequence? Templates that belong to it will become standalone in the library (not deleted).")) return;
    const sb = getSupabaseBrowser();
    const { error } = await sb.from("message_sequences").delete().eq("id", id);
    if (error) { alert(error.message); return; }
    await load();
  }

  const editingSeq = editingId ? sequences.find(s => s.id === editingId) : null;
  const initialForm = editingSeq
    ? {
        name: editingSeq.name,
        description: editingSeq.description ?? "",
        industry: editingSeq.industry ?? "",
        icp_profile_id: editingSeq.icp_profile_id,
        channels: editingSeq.channels ?? ["linkedin"],
        status: editingSeq.status,
        steps: editingSteps,
      }
    : { ...emptySequence, steps: editingSteps };

  return (
    <div>
      <div className="flex items-start justify-between mb-5">
        <p className="text-sm max-w-xl" style={{ color: C.textMuted }}>
          Full outreach narratives — an ordered set of templates the AI follows in order so all messages in the campaign tell one coherent story.
          When creating a campaign, the user can pick a sequence as starting point or skip it and write everything from scratch.
        </p>
        <button onClick={startNew}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold shrink-0"
          style={{ backgroundColor: gold, color: "#fff" }}>
          <Plus size={14} /> New Sequence
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 size={20} className="animate-spin" style={{ color: gold }} /></div>
      ) : sequences.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={tr("voice.seq.empty.title")}
          description={tr("voice.seq.empty.desc")}
          primaryCta={{ label: `+ ${tr("voice.seq.new")}`, onClick: startNew }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sequences.map(seq => {
            const steps = stepsOf(seq.id);
            const statusMeta = STATUS_STYLES[seq.status] ?? STATUS_STYLES.active;
            return (
              <div key={seq.id} className="rounded-xl border p-4 flex flex-col gap-2" style={{ backgroundColor: C.card, borderColor: C.border }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold" style={{ color: C.textPrimary }}>{seq.name}</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color: statusMeta.color, backgroundColor: statusMeta.bg }}>{statusMeta.label}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => startEdit(seq)} className="p-1.5 rounded hover:bg-black/5"><Pencil size={12} style={{ color: C.textMuted }} /></button>
                    <button onClick={() => handleDelete(seq.id)} className="p-1.5 rounded hover:bg-red-50"><Trash2 size={12} style={{ color: "#DC2626" }} /></button>
                  </div>
                </div>
                {seq.description && <p className="text-xs" style={{ color: C.textBody }}>{seq.description}</p>}
                <div className="flex flex-wrap items-center gap-1.5 text-[10px]" style={{ color: C.textMuted }}>
                  <span className="font-semibold" style={{ color: C.textBody }}>{steps.length} step{steps.length === 1 ? "" : "s"}</span>
                  {seq.industry && <span>· {seq.industry}</span>}
                  {seq.icp_profile_id && icpOptions.find(i => i.id === seq.icp_profile_id) &&
                    <span>· ICP: {icpOptions.find(i => i.id === seq.icp_profile_id)?.profile_name}</span>}
                </div>
                {steps.length > 0 && (
                  <ol className="text-[11px] mt-1 space-y-0.5" style={{ color: C.textBody }}>
                    {steps.map((t, i) => (
                      <li key={t.id}>
                        <span className="font-semibold">{i + 1}.</span> {STEP_POSITIONS.find(s => s.value === t.step_position)?.label ?? t.step_position}
                        {t.label && <span style={{ color: C.textMuted }}> — {t.label}</span>}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <SequenceForm
          initial={initialForm}
          icpOptions={icpOptions}
          allTemplates={allTemplates}
          isEdit={!!editingId}
          editingSeqId={editingId}
          onCancel={() => { setShowForm(false); setEditingId(null); setEditingSteps([]); }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function SequenceForm({ initial, icpOptions, allTemplates, isEdit, editingSeqId, onSave, onCancel }: {
  initial: typeof emptySequence;
  icpOptions: IcpOption[];
  allTemplates: Template[];
  isEdit: boolean;
  editingSeqId: string | null;
  onSave: (form: typeof emptySequence) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);

  function addStep() {
    setForm(f => ({ ...f, steps: [...f.steps, { step_position: "first_dm", template_id: "" }] }));
  }
  function updateStep(i: number, patch: Partial<SequenceStep>) {
    setForm(f => ({ ...f, steps: f.steps.map((s, idx) => idx === i ? { ...s, ...patch } : s) }));
  }
  function removeStep(i: number) {
    setForm(f => ({ ...f, steps: f.steps.filter((_, idx) => idx !== i) }));
  }
  function moveStep(i: number, dir: -1 | 1) {
    setForm(f => {
      const next = [...f.steps];
      const j = i + dir;
      if (j < 0 || j >= next.length) return f;
      [next[i], next[j]] = [next[j], next[i]];
      return { ...f, steps: next };
    });
  }
  // Templates available for a step_position: those of that step_position AND
  // (currently in this sequence OR not in any sequence)
  function templatesForStep(stepPos: string) {
    return allTemplates.filter(t =>
      t.step_position === stepPos &&
      (t.sequence_id === null || t.sequence_id === editingSeqId)
    );
  }

  async function submit() {
    if (!form.name.trim()) { alert("Name is required"); return; }
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" style={{ backgroundColor: C.card }}>
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: C.border }}>
          <h2 className="text-base font-bold" style={{ color: C.textPrimary }}>{isEdit ? "Edit Sequence" : "New Sequence"}</h2>
          <button onClick={onCancel} className="p-1 rounded hover:bg-black/5"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name">
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder='e.g. "Pathway hot lead — Asset finance"'
                className="w-full text-sm px-3 py-2 rounded-lg border" style={{ borderColor: C.border, backgroundColor: C.bg }} />
            </Field>
            <Field label="Status">
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as "active" | "draft" | "archived" }))}
                className="w-full text-sm px-3 py-2 rounded-lg border" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
            <Field label="ICP (optional)">
              <select value={form.icp_profile_id ?? ""} onChange={e => setForm(f => ({ ...f, icp_profile_id: e.target.value || null }))}
                className="w-full text-sm px-3 py-2 rounded-lg border" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                <option value="">— Any ICP —</option>
                {icpOptions.map(i => <option key={i.id} value={i.id}>{i.profile_name}</option>)}
              </select>
            </Field>
            <Field label="Industry (optional)">
              <input type="text" value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}
                placeholder="e.g. Asset Finance"
                className="w-full text-sm px-3 py-2 rounded-lg border" style={{ borderColor: C.border, backgroundColor: C.bg }} />
            </Field>
            <div className="md:col-span-2">
              <Field label="Description">
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What this sequence is for, when to use it"
                  rows={2}
                  className="w-full text-sm px-3 py-2 rounded-lg border resize-y" style={{ borderColor: C.border, backgroundColor: C.bg }} />
              </Field>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
                Steps ({form.steps.length})
              </span>
              <button onClick={addStep} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-lg" style={{ backgroundColor: C.goldGlow, color: gold }}>
                <Plus size={11} /> Add step
              </button>
            </div>

            {form.steps.length === 0 ? (
              <div className="rounded-lg border p-6 text-center text-xs" style={{ backgroundColor: C.bg, borderColor: C.border, color: C.textMuted }}>
                No steps yet. Add steps in order — connection request, first DM, follow-ups, CTA, breakup.
              </div>
            ) : (
              <div className="space-y-2">
                {form.steps.map((s, i) => {
                  const opts = templatesForStep(s.step_position);
                  return (
                    <div key={i} className="flex items-center gap-2 rounded-lg border p-2" style={{ backgroundColor: C.bg, borderColor: C.border }}>
                      <span className="w-6 text-center text-xs font-bold" style={{ color: C.textMuted }}>{i + 1}</span>
                      <select value={s.step_position} onChange={e => updateStep(i, { step_position: e.target.value, template_id: "" })}
                        className="text-xs px-2 py-1.5 rounded border" style={{ borderColor: C.border, backgroundColor: C.card }}>
                        {STEP_POSITIONS.map(sp => <option key={sp.value} value={sp.value}>{sp.label}</option>)}
                      </select>
                      <select value={s.template_id} onChange={e => updateStep(i, { template_id: e.target.value })}
                        className="flex-1 text-xs px-2 py-1.5 rounded border" style={{ borderColor: C.border, backgroundColor: C.card }}>
                        <option value="">— Select template —</option>
                        {opts.map(t => <option key={t.id} value={t.id}>{t.label || `${t.template_text.slice(0, 50)}…`}</option>)}
                      </select>
                      <button onClick={() => moveStep(i, -1)} disabled={i === 0} className="px-1.5 text-xs disabled:opacity-30" title="Move up">↑</button>
                      <button onClick={() => moveStep(i, 1)} disabled={i === form.steps.length - 1} className="px-1.5 text-xs disabled:opacity-30" title="Move down">↓</button>
                      <button onClick={() => removeStep(i)} className="p-1 rounded hover:bg-red-50" title="Remove"><Trash2 size={12} style={{ color: "#DC2626" }} /></button>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-[10px] mt-2" style={{ color: C.textMuted }}>
              Pick templates from your library for each step. The dropdown only shows templates of the right step_position that aren't already used in another sequence.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: C.border }}>
          <button onClick={onCancel} className="text-sm font-medium px-3 py-1.5 rounded-lg" style={{ color: C.textBody }}>Cancel</button>
          <button onClick={submit} disabled={saving} className="flex items-center gap-1.5 text-sm font-semibold px-4 py-1.5 rounded-lg disabled:opacity-50" style={{ backgroundColor: gold, color: "#fff" }}>
            {saving ? <Loader2 size={12} className="animate-spin" /> : null}
            {isEdit ? "Save Changes" : "Create Sequence"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Page shell with tabs
// ──────────────────────────────────────────────────────────────────────────────

type TabKey = "voice" | "templates" | "sequences";

export default function VoicePage() {
  const { t: tr } = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const tabParam = ((): TabKey => {
    const t = params.get("tab");
    if (t === "templates") return "templates";
    if (t === "sequences") return "sequences";
    return "voice";
  })();
  const [tab, setTab] = useState<TabKey>(tabParam);

  function selectTab(t: TabKey) {
    setTab(t);
    const url = t === "voice" ? "/voice" : `/voice?tab=${t}`;
    router.replace(url);
  }

  return (
    <div className="p-6 w-full max-w-7xl mx-auto">
      <PageHero
        icon={MessageCircle}
        section="Growth Engine"
        title={tr("voice.title")}
        description={tr("voice.subtitle")}
        accentColor={gold}
        status={{ label: tr("voice.synced"), active: true }}
      />

      <div className="flex items-center gap-1 mb-6 border-b" style={{ borderColor: C.border }}>
        <TabButton active={tab === "voice"} onClick={() => selectTab("voice")} icon={MessageCircle} label={tr("voice.tab.brandVoice")} />
        <TabButton active={tab === "templates"} onClick={() => selectTab("templates")} icon={BookOpen} label={tr("voice.tab.templates")} />
        <TabButton active={tab === "sequences"} onClick={() => selectTab("sequences")} icon={Layers} label={tr("voice.tab.sequences")} />
      </div>

      {tab === "voice" ? <BrandVoiceTab /> : tab === "templates" ? <TemplatesTab /> : <SequencesTab />}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-[color,border-color,background-color] duration-150"
      style={{
        borderColor: active ? gold : "transparent",
        color: active ? gold : C.textMuted,
        backgroundColor: active ? `color-mix(in srgb, ${gold} 6%, transparent)` : "transparent",
      }}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}
