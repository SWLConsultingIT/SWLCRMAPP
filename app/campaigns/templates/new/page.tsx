"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, Save, Loader2, Plus, Trash2,
  Share2, Mail, Phone, MessageCircle, FileText, AlertCircle,
  X, Sparkles, Upload, Copy, FilePlus2, Check,
} from "lucide-react";
import { C } from "@/lib/design";
import StepAttachments, { type StepAttachment } from "@/components/StepAttachments";

// 3-step wizard for creating a template:
//   1. SOURCE     — pick how to start (PDF upload / import / scratch)
//   2. SEQUENCE   — edit the cadence + per-step message body
//   3. IDENTITY   — Name / Description / Tags and save
//
// Step 0 (the LinkedIn connection request) lives INSIDE the sequence array as
// an entry with channel="linkedin" + isConnectionRequest=true, so the user
// edits it in the same place as every other touchpoint. On save it's split
// back out into the `connectionRequest` field expected by the API.

// Brand-aware accent: gold for SWL, tenant color for clients via the
// `--brand` cascade. Hex-alpha concatenation (`accent + "15"`) doesn't work
// with CSS vars, so all soft-fill backgrounds go through `accentSoft()`
// which builds a proper color-mix() expression.
const ACCENT = "var(--brand, #c9a83a)";
const accentSoft = (pct: number) => `color-mix(in srgb, ${ACCENT} ${pct}%, transparent)`;

type Channel = "linkedin" | "email" | "call" | "whatsapp";

const channelMeta: Record<Channel, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2,        color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,          color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,         color: "#F97316", label: "Call" },
  whatsapp: { icon: MessageCircle, color: "#25D366", label: "WhatsApp" },
};

type Step = {
  channel: Channel;
  daysAfter: number;
  subject?: string;
  body: string;
  /** Marks step 0 as a LinkedIn connection request — gets a 300-char cap,
   *  different placeholder, and is serialized as `connectionRequest` on save. */
  isConnectionRequest?: boolean;
  /** Verbatim PDF snippet (≤200 chars) the AI used as anchor for this step. */
  sourceExcerpt?: string;
  /** Optional A/B variants. When non-empty, the dispatcher 50/50-splits between
   *  `body` (variant A) and `variants[0]` (variant B). */
  variants?: string[];
  /** Files attached to this step. Persisted into step_messages.steps[i].attachments
   *  and propagated to campaigns.sequence_steps[i].attachments at launch time so
   *  the dispatcher signs + sends them with the message. */
  attachments?: StepAttachment[];
};

type TonePreset = "conservative" | "balanced" | "direct" | "spicy" | "custom";
type RewriteMode = "verbatim" | "personalize" | "rewrite_with_source";

const TONE_PRESETS: Array<{ id: TonePreset; label: string; desc: string }> = [
  { id: "conservative", label: "Conservative", desc: "Formal, safe, no hype. For legal / healthcare / banking targets." },
  { id: "balanced",     label: "Balanced",     desc: "Conversational professional. One hook, one CTA. Default." },
  { id: "direct",       label: "Direct",       desc: "Blunt opener, sharp CTA. For technical buyers + operators." },
  { id: "spicy",        label: "Spicy",        desc: "Contrarian. Higher reply rate + higher unsubscribe risk." },
  { id: "custom",       label: "Custom",       desc: "Paste your own style guide / examples." },
];

const REWRITE_MODES: Array<{ id: RewriteMode; label: string; desc: string }> = [
  { id: "verbatim",            label: "Verbatim",                desc: "Use template body as-is. Only {{first_name}} / {{seller_name}} get substituted." },
  { id: "personalize",         label: "Personalize per lead",    desc: "Light per-lead rewrite. Default." },
  { id: "rewrite_with_source", label: "Rewrite from source PDF", desc: "Claude reads the PDFs per lead and rewrites anchored to source. Most flexible." },
];

type PendingAttachment = {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  base64: string;
};

type WizardStep = "source" | "sequence" | "identity";
type Source = "pdf" | "import" | "scratch" | null;

type ImportableTemplate = {
  id: string;
  name: string;
  description: string | null;
  channels: string[];
  tags: string[];
  usage_count: number;
};

const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MAX_PDFS = 5;

const DEFAULT_SCRATCH_STEPS: Step[] = [
  { channel: "linkedin", daysAfter: 0, body: "", isConnectionRequest: true },
  { channel: "linkedin", daysAfter: 3, body: "" },
  { channel: "email",    daysAfter: 7, body: "" },
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const base64 = result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function NewTemplatePage() {
  const router = useRouter();

  // ── Wizard ──────────────────────────────────────────────────────────────
  const [wizardStep, setWizardStep] = useState<WizardStep>("source");
  const [source, setSource] = useState<Source>(null);

  // ── Identity (step 3) ──────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");

  // ── Sequence (step 2) ──────────────────────────────────────────────────
  const [steps, setSteps] = useState<Step[]>([]);

  // ── Tone / rewrite / voice (carry through both generators) ─────────────
  const [tonePreset, setTonePreset] = useState<TonePreset>("balanced");
  const [toneCustom, setToneCustom] = useState("");
  const [rewriteMode, setRewriteMode] = useState<RewriteMode>("personalize");
  const [voiceAnchor, setVoiceAnchor] = useState<string | null>(null);
  const [voiceOptions, setVoiceOptions] = useState<Array<{ id: string; name: string }>>([]);

  // ── ICP target (required for new templates) ────────────────────────────
  // Loaded once at mount. Picking an ICP gates the source picker — you can't
  // generate / import / start a template without knowing what it targets.
  const [icpProfileId, setIcpProfileId] = useState<string | null>(null);
  const [icpOptions, setIcpOptions] = useState<Array<{ id: string; profile_name: string }>>([]);

  // ── PDF source state ───────────────────────────────────────────────────
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Import source state ────────────────────────────────────────────────
  const [importables, setImportables] = useState<ImportableTemplate[] | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);

  // ── Save (step 3 footer) ───────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch importables when the user picks the "import" source.
  useEffect(() => {
    if (source !== "import" || importables !== null) return;
    setImportLoading(true);
    fetch("/api/templates", { cache: "no-store" })
      .then(r => r.json())
      .then(data => setImportables(data.templates ?? []))
      .catch(() => setImportables([]))
      .finally(() => setImportLoading(false));
  }, [source, importables]);

  // Load active sellers for the voice anchor dropdown. Cheap query, runs once.
  useEffect(() => {
    fetch("/api/sellers?active=1", { cache: "no-store" })
      .then(r => r.ok ? r.json() : { sellers: [] })
      .then(d => {
        const opts = Array.isArray(d.sellers) ? d.sellers.map((s: any) => ({ id: s.id, name: s.name })) : [];
        setVoiceOptions(opts);
      })
      .catch(() => setVoiceOptions([]));
  }, []);

  // ICPs of the current tenant — populates the required picker in Step 1.
  useEffect(() => {
    fetch("/api/icp?status=approved", { cache: "no-store" })
      .then(r => r.ok ? r.json() : { icps: [] })
      .then(d => {
        const list = Array.isArray(d.icps) ? d.icps : Array.isArray(d) ? d : [];
        setIcpOptions(list.map((i: any) => ({ id: i.id, profile_name: i.profile_name ?? i.name ?? "Untitled ICP" })));
      })
      .catch(() => setIcpOptions([]));
  }, []);

  // Carry tone/rewrite/voice from an imported template so the wizard reflects
  // what the source template captured. Otherwise defaults stand.
  function applyImportedSettings(tpl: any) {
    if (tpl.tone_preset) setTonePreset(tpl.tone_preset);
    if (typeof tpl.tone_custom_notes === "string") setToneCustom(tpl.tone_custom_notes);
    if (tpl.rewrite_mode) setRewriteMode(tpl.rewrite_mode);
    if (tpl.voice_anchor_seller_id !== undefined) setVoiceAnchor(tpl.voice_anchor_seller_id);
    // Don't auto-override icpProfileId if the user already picked one. Only
    // adopt the source template's ICP if no choice has been made yet.
    if (!icpProfileId && tpl.icp_profile_id) setIcpProfileId(tpl.icp_profile_id);
  }

  // ── Step 1: source picking ─────────────────────────────────────────────
  function pickScratch() {
    setSource("scratch");
    setSteps(DEFAULT_SCRATCH_STEPS);
    setWizardStep("sequence");
  }

  async function importFromTemplate(id: string) {
    setImportingId(id);
    try {
      const res = await fetch(`/api/templates/${id}`, { cache: "no-store" });
      const data = await res.json();
      const tpl = data.template;
      if (!tpl) throw new Error("Template not found");
      // Reconstruct wizard steps from the imported template.
      const stepMessages = tpl.step_messages ?? {};
      const importedSteps: Step[] = [];
      if (stepMessages.connectionRequest && stepMessages.connectionRequest.length > 0) {
        importedSteps.push({
          channel: "linkedin",
          daysAfter: 0,
          body: stepMessages.connectionRequest,
          isConnectionRequest: true,
        });
      }
      const seq = Array.isArray(tpl.sequence_steps) ? tpl.sequence_steps : [];
      const msgs = Array.isArray(stepMessages.steps) ? stepMessages.steps : [];
      for (let i = 0; i < seq.length; i++) {
        const s = seq[i];
        // sequence_steps may include the connection request as step 0 with
        // daysAfter=0; skip if we already added it above.
        if (i === 0 && s.daysAfter === 0 && s.channel === "linkedin" && importedSteps[0]?.isConnectionRequest) continue;
        const msg = msgs.find((m: any) => m.step === i + 1) ?? msgs[i] ?? {};
        importedSteps.push({
          channel: s.channel as Channel,
          daysAfter: s.daysAfter ?? 0,
          subject: msg.subject ?? undefined,
          body: msg.body ?? "",
          // Round-trip attachments stored at template creation. The launch
          // endpoint will copy these into campaigns.sequence_steps[i].attachments.
          attachments: Array.isArray(msg.attachments) ? msg.attachments : undefined,
        });
      }
      if (importedSteps.length === 0) importedSteps.push(...DEFAULT_SCRATCH_STEPS);
      setSteps(importedSteps);
      // Pre-fill name with a suggestion so the user can rename in step 3.
      setName(`${tpl.name} (copy)`);
      setDescription(tpl.description ?? "");
      setTagsInput((tpl.tags ?? []).join(", "));
      applyImportedSettings(tpl);
      setWizardStep("sequence");
    } catch (e: any) {
      setError(e?.message ?? "Couldn't import that template");
    } finally {
      setImportingId(null);
    }
  }

  // ── PDF handling ───────────────────────────────────────────────────────
  async function addFiles(files: FileList | File[]) {
    setGenError(null);
    const arr = Array.from(files);
    const newOnes: PendingAttachment[] = [];
    for (const f of arr) {
      if (attachments.length + newOnes.length >= MAX_PDFS) {
        setGenError(`Max ${MAX_PDFS} PDFs at once`);
        break;
      }
      if (f.type !== "application/pdf") {
        setGenError(`${f.name}: only PDFs supported for now`);
        continue;
      }
      if (f.size > MAX_PDF_BYTES) {
        setGenError(`${f.name} is >${MAX_PDF_BYTES / 1024 / 1024}MB`);
        continue;
      }
      const base64 = await fileToBase64(f);
      newOnes.push({ filename: f.name, mimeType: f.type, sizeBytes: f.size, base64 });
    }
    if (newOnes.length > 0) setAttachments(prev => [...prev, ...newOnes]);
  }
  function removeAttachment(idx: number) {
    setAttachments(prev => prev.filter((_, i) => i !== idx));
  }

  // Extract sequence + draft messages from PDFs, then advance to step 2.
  async function generateFromPdfs() {
    if (generating || attachments.length === 0) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/templates/generate-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No `sequence` field → backend runs in DETECTED mode and extracts the
        // cadence from the PDFs. We DO forward tone + voice anchor so the
        // detected/drafted output already reflects the user's choices.
        body: JSON.stringify({
          attachments: attachments.map(a => ({ filename: a.filename, mimeType: a.mimeType, base64: a.base64 })),
          includesLinkedIn: true,
          tone_preset: tonePreset,
          tone_custom_notes: tonePreset === "custom" ? toneCustom : undefined,
          voice_anchor_seller_id: voiceAnchor ?? undefined,
          icp_profile_id: icpProfileId ?? undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGenError(body.error ?? `Generation failed (${res.status})`);
        return;
      }
      const detected: { channel: string; daysAfter: number }[] = Array.isArray(body.detected_sequence) ? body.detected_sequence : [];
      const draftedSteps: { step: number; channel: string; subject?: string | null; body: string; source_excerpt?: string }[] = Array.isArray(body.steps) ? body.steps : [];
      const connectionRequest: string = typeof body.connectionRequest === "string" ? body.connectionRequest : "";
      const connectionRequestSource: string = typeof body.connectionRequestSource === "string" ? body.connectionRequestSource : "";

      const builtSteps: Step[] = [];
      // If the backend detected a LinkedIn invite, add it as step 0.
      if (connectionRequest.trim().length > 0) {
        builtSteps.push({ channel: "linkedin", daysAfter: 0, body: connectionRequest, isConnectionRequest: true, sourceExcerpt: connectionRequestSource });
      }
      // Then map detected_sequence rows to drafted step bodies in order.
      for (let i = 0; i < detected.length; i++) {
        const d = detected[i];
        if (i === 0 && builtSteps[0]?.isConnectionRequest && d.channel === "linkedin" && d.daysAfter === 0) continue;
        const draft = draftedSteps.find(s => s.step === i + 1) ?? draftedSteps[i];
        builtSteps.push({
          channel: (d.channel as Channel) ?? "email",
          daysAfter: d.daysAfter ?? 0,
          subject: draft?.subject ?? undefined,
          body: draft?.body ?? "",
          sourceExcerpt: draft?.source_excerpt ?? undefined,
        });
      }
      if (builtSteps.length === 0) builtSteps.push(...DEFAULT_SCRATCH_STEPS);
      setSteps(builtSteps);
      setWizardStep("sequence");
    } catch (e: any) {
      setGenError(e?.message ?? "Network error");
    } finally {
      setGenerating(false);
    }
  }

  // ── Sequence editing helpers ───────────────────────────────────────────
  function updateStep(i: number, patch: Partial<Step>) {
    setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  }
  function addStep() {
    setSteps(prev => [...prev, { channel: "email", daysAfter: prev.length > 0 ? (prev[prev.length - 1].daysAfter + 3) : 3, body: "" }]);
  }
  function removeStep(i: number) {
    setSteps(prev => prev.filter((_, idx) => idx !== i));
  }
  function addConnectionRequest() {
    setSteps(prev => [{ channel: "linkedin", daysAfter: 0, body: "", isConnectionRequest: true }, ...prev]);
  }
  const hasConnectionRequest = steps[0]?.isConnectionRequest === true;

  // ── Save (step 3 → server) ─────────────────────────────────────────────
  async function save() {
    if (saving) return;
    if (!icpProfileId) { setError("Pick an ICP before saving — go back to step 1"); return; }
    if (!name.trim()) { setError("Template name is required"); return; }
    if (steps.length === 0) { setError("Add at least one step"); return; }
    const bodySteps = steps.filter(s => !s.isConnectionRequest);
    if (bodySteps.length === 0) { setError("Add at least one outreach step beyond the connection request"); return; }
    if (steps.some(s => !s.body.trim())) { setError("Every step needs message content"); return; }

    setSaving(true);
    setError(null);

    const tags = tagsInput.split(",").map(t => t.trim()).filter(Boolean).slice(0, 10);
    const sequence_steps = steps.map(s => ({ channel: s.channel, daysAfter: s.daysAfter }));
    const channels = Array.from(new Set(sequence_steps.map(s => s.channel)));
    const connectionRequest = hasConnectionRequest ? steps[0].body : "";
    // source_excerpt + variants[] carry through the JSONB column so the n8n
    // per-lead generator (when wired) and the dispatcher (for A/B splits) can
    // read them later. The template POST endpoint forwards them verbatim.
    const messageSteps = bodySteps.map((s, i) => ({
      step: i + 1,
      channel: s.channel,
      subject: s.channel === "email" ? (s.subject ?? null) : null,
      body: s.body,
      source_excerpt: s.sourceExcerpt ?? "",
      variants: Array.isArray(s.variants) && s.variants.length > 0 ? s.variants.slice(0, 1) : undefined,
      attachments: Array.isArray(s.attachments) && s.attachments.length > 0 ? s.attachments : undefined,
    }));

    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "from_scratch",
          name: name.trim(),
          description: description.trim() || undefined,
          tags,
          channels,
          sequence_steps,
          step_messages: {
            connectionRequest,
            steps: messageSteps,
            autoReplies: { positive: "", negative: "", question: "" },
          },
          tone_preset: tonePreset,
          tone_custom_notes: tonePreset === "custom" ? toneCustom.trim() : undefined,
          rewrite_mode: rewriteMode,
          voice_anchor_seller_id: voiceAnchor,
          icp_profile_id: icpProfileId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Failed (${res.status})`);
        setSaving(false);
        return;
      }
      router.push("/campaigns");
    } catch (e: any) {
      setError(e?.message ?? "Network error");
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header + breadcrumb */}
      <div className="flex items-center gap-3 mb-5">
        <Link href="/campaigns"
          className="p-2 rounded-lg border hover:bg-gray-50"
          style={{ borderColor: C.border, color: C.textBody }}>
          <ArrowLeft size={14} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold" style={{ color: C.textPrimary }}>New Template</h1>
          <p className="text-xs" style={{ color: C.textMuted }}>
            Define a reusable sequence + messages. Save once, apply to any future campaign.
          </p>
        </div>
      </div>

      {/* Wizard progress */}
      <WizardProgress current={wizardStep} />

      {/* Setup bar (Step 1 only): ICP target is required + tone + voice. ICP
          must be picked before any source action — the AI generation in
          Step 1 needs to know who it's writing for. */}
      {wizardStep === "source" && (
        <SetupBar
          icpProfileId={icpProfileId} setIcpProfileId={setIcpProfileId}
          icpOptions={icpOptions}
          tonePreset={tonePreset} setTonePreset={setTonePreset}
          toneCustom={toneCustom} setToneCustom={setToneCustom}
          voiceAnchor={voiceAnchor} setVoiceAnchor={setVoiceAnchor}
          voiceOptions={voiceOptions}
        />
      )}

      {/* ─── STEP 1: SOURCE ──────────────────────────────────────────────── */}
      {wizardStep === "source" && (
        <SourceStep
          locked={!icpProfileId}
          source={source}
          setSource={setSource}
          attachments={attachments}
          dragOver={dragOver}
          setDragOver={setDragOver}
          addFiles={addFiles}
          removeAttachment={removeAttachment}
          generating={generating}
          genError={genError}
          setGenError={setGenError}
          generate={generateFromPdfs}
          pickScratch={pickScratch}
          fileInputRef={fileInputRef}
          importables={importables}
          importLoading={importLoading}
          importingId={importingId}
          importFromTemplate={importFromTemplate}
        />
      )}

      {/* ─── STEP 2: SEQUENCE ────────────────────────────────────────────── */}
      {wizardStep === "sequence" && (
        <SequenceStep
          steps={steps}
          hasConnectionRequest={hasConnectionRequest}
          addConnectionRequest={addConnectionRequest}
          updateStep={updateStep}
          addStep={addStep}
          removeStep={removeStep}
          onBack={() => setWizardStep("source")}
          onNext={() => setWizardStep("identity")}
        />
      )}

      {/* ─── STEP 3: IDENTITY + SAVE ─────────────────────────────────────── */}
      {wizardStep === "identity" && (
        <IdentityStep
          name={name} setName={setName}
          description={description} setDescription={setDescription}
          tagsInput={tagsInput} setTagsInput={setTagsInput}
          steps={steps}
          tonePreset={tonePreset}
          rewriteMode={rewriteMode} setRewriteMode={setRewriteMode}
          voiceAnchor={voiceAnchor}
          voiceOptions={voiceOptions}
          error={error} setError={setError}
          saving={saving}
          onBack={() => setWizardStep("sequence")}
          onSave={save}
        />
      )}
    </div>
  );
}

// ─── Setup bar (Step 1) ──────────────────────────────────────────────────
// ICP target (required) + tone + voice anchor. Sits above the source picker
// so AI generation in Step 1 already knows who it's writing for and in what
// style. All three flow into the persisted template + the n8n per-lead
// generator at apply time.
function SetupBar(props: {
  icpProfileId: string | null; setIcpProfileId: (v: string | null) => void;
  icpOptions: Array<{ id: string; profile_name: string }>;
  tonePreset: TonePreset; setTonePreset: (v: TonePreset) => void;
  toneCustom: string; setToneCustom: (v: string) => void;
  voiceAnchor: string | null; setVoiceAnchor: (v: string | null) => void;
  voiceOptions: Array<{ id: string; name: string }>;
}) {
  const { icpProfileId, setIcpProfileId, icpOptions, tonePreset, setTonePreset, toneCustom, setToneCustom, voiceAnchor, setVoiceAnchor, voiceOptions } = props;
  const currentTone = TONE_PRESETS.find(t => t.id === tonePreset);
  return (
    <div className="rounded-2xl border p-4 mb-5"
      style={{ backgroundColor: C.card, borderColor: C.border }}>
      {/* ICP picker — required. Without it the user can't proceed to source. */}
      <div className="mb-3 pb-3 border-b" style={{ borderColor: C.border }}>
        <label className="text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5" style={{ color: C.textMuted }}>
          ICP target <span style={{ color: C.red }}>*</span>
          {!icpProfileId && (
            <span className="text-[10px] font-normal normal-case" style={{ color: C.textDim }}>
              · pick which ICP this template targets — messages will be drafted for them
            </span>
          )}
        </label>
        <select
          value={icpProfileId ?? ""}
          onChange={e => setIcpProfileId(e.target.value || null)}
          className="w-full mt-1.5 rounded-lg border px-3 py-2 text-sm outline-none"
          style={{
            borderColor: icpProfileId ? C.border : accentSoft(40),
            backgroundColor: icpProfileId ? C.bg : accentSoft(8),
            color: C.textPrimary,
          }}>
          <option value="">— Choose an ICP —</option>
          {icpOptions.map(o => (
            <option key={o.id} value={o.id}>{o.profile_name}</option>
          ))}
        </select>
        {icpOptions.length === 0 && (
          <p className="text-[11px] mt-1.5" style={{ color: C.textMuted }}>
            No ICPs yet. <a href="/icp" className="font-semibold underline" style={{ color: ACCENT }}>Create an ICP first</a> — templates are scoped to a target.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: C.textMuted }}>Tone</p>
          <div className="flex flex-wrap gap-1.5">
            {TONE_PRESETS.map(p => {
              const active = p.id === tonePreset;
              return (
                <button key={p.id} type="button" onClick={() => setTonePreset(p.id)}
                  title={p.desc}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-colors"
                  style={{
                    backgroundColor: active ? accentSoft(15) : C.bg,
                    borderColor: active ? accentSoft(40) : C.border,
                    color: active ? ACCENT : C.textBody,
                  }}>
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="h-10 w-px hidden md:block" style={{ backgroundColor: C.border }} />

        <div className="min-w-[180px]">
          <p className="text-[10px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: C.textMuted }}>Voice anchor <span className="opacity-60 normal-case font-normal">(optional)</span></p>
          <select
            value={voiceAnchor ?? ""}
            onChange={e => setVoiceAnchor(e.target.value || null)}
            className="text-xs rounded border px-2 py-1 outline-none w-full"
            style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textBody }}>
            <option value="">No anchor — use tenant tone</option>
            {voiceOptions.map(o => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      </div>

      {currentTone && (
        <p className="text-[11px] mt-2.5" style={{ color: C.textMuted }}>{currentTone.desc}</p>
      )}

      {tonePreset === "custom" && (
        <textarea
          value={toneCustom}
          onChange={e => setToneCustom(e.target.value)}
          placeholder="Paste your style guide / writing examples. Anything here gets appended verbatim to the AI's instructions."
          rows={3}
          maxLength={1500}
          className="w-full mt-2 rounded border px-2 py-1.5 text-xs outline-none resize-vertical"
          style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
        />
      )}
    </div>
  );
}

// ─── Wizard progress strip ───────────────────────────────────────────────
function WizardProgress({ current }: { current: WizardStep }) {
  const stepDefs: { key: WizardStep; label: string }[] = [
    { key: "source",   label: "Source" },
    { key: "sequence", label: "Sequence" },
    { key: "identity", label: "Save" },
  ];
  const idx = stepDefs.findIndex(s => s.key === current);
  return (
    <div className="flex items-center gap-2 mb-5">
      {stepDefs.map((s, i) => {
        const active = i === idx;
        const done = i < idx;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors"
              style={{
                backgroundColor: active ? accentSoft(15) : done ? "#DCFCE7" : C.bg,
                border: `1px solid ${active ? accentSoft(40) : done ? "#86EFAC" : C.border}`,
              }}>
              <span className="text-[11px] font-bold tabular-nums flex items-center justify-center rounded-full"
                style={{ width: 18, height: 18, backgroundColor: active ? ACCENT : done ? "#16A34A" : C.border, color: "#fff" }}>
                {done ? <Check size={11} /> : i + 1}
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: active ? ACCENT : done ? "#16A34A" : C.textMuted }}>
                {s.label}
              </span>
            </div>
            {i < stepDefs.length - 1 && (
              <div className="h-px flex-1 min-w-[20px]" style={{ backgroundColor: C.border }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: source picker ───────────────────────────────────────────────
function SourceStep(props: {
  locked: boolean;
  source: Source; setSource: (s: Source) => void;
  attachments: PendingAttachment[]; dragOver: boolean;
  setDragOver: (v: boolean) => void;
  addFiles: (files: FileList | File[]) => Promise<void>;
  removeAttachment: (i: number) => void;
  generating: boolean; genError: string | null;
  setGenError: (e: string | null) => void;
  generate: () => Promise<void>;
  pickScratch: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  importables: ImportableTemplate[] | null;
  importLoading: boolean;
  importingId: string | null;
  importFromTemplate: (id: string) => Promise<void>;
}) {
  const {
    locked,
    source, setSource,
    attachments, dragOver, setDragOver, addFiles, removeAttachment,
    generating, genError, setGenError, generate, pickScratch,
    fileInputRef,
    importables, importLoading, importingId, importFromTemplate,
  } = props;

  // Source picker is gated on the SetupBar's ICP selection — without an ICP
  // the AI generation can't reason about who it's writing to.
  if (locked) {
    return (
      <div className="rounded-2xl border p-6 text-center"
        style={{ backgroundColor: C.card, borderColor: C.border, opacity: 0.7 }}>
        <p className="text-sm font-semibold" style={{ color: C.textMuted }}>
          Pick an ICP above to continue.
        </p>
        <p className="text-xs mt-1" style={{ color: C.textDim }}>
          Templates are scoped to a single ICP so the messages stay relevant.
        </p>
      </div>
    );
  }

  // The 3-up source picker is only shown when no source has been chosen.
  // Once a source is picked, the relevant detail UI takes over the area below.
  if (!source) {
    return (
      <div>
        <h2 className="text-sm font-bold mb-3" style={{ color: C.textPrimary }}>Where does this template come from?</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SourceCard
            icon={<Sparkles size={20} style={{ color: ACCENT }} />}
            title="From a PDF"
            desc="Drop your playbook, sales deck, or case studies. AI extracts the cadence and drafts every message."
            badge="Recommended"
            onClick={() => setSource("pdf")}
          />
          <SourceCard
            icon={<Copy size={20} style={{ color: "#0A66C2" }} />}
            title="Copy an existing template"
            desc="Start from one that already works for you and tweak from there."
            onClick={() => setSource("import")}
          />
          <SourceCard
            icon={<FilePlus2 size={20} style={{ color: C.textBody }} />}
            title="From scratch"
            desc="Blank sequence with sensible defaults. You write everything yourself."
            onClick={pickScratch}
          />
        </div>
      </div>
    );
  }

  // ── PDF source detail ────────────────────────────────────────────────
  if (source === "pdf") {
    return (
      <div className="rounded-2xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2" style={{ color: C.textPrimary }}>
              <Sparkles size={16} style={{ color: ACCENT }} />
              Upload your playbook
            </h2>
            <p className="text-xs mt-1" style={{ color: C.textMuted }}>
              Drop your sales deck, case studies, or one-pagers. Claude reads them, extracts the cadence, and drafts each message. You can edit everything in the next step.
            </p>
          </div>
          <button onClick={() => setSource(null)}
            className="text-[11px] font-semibold" style={{ color: C.textMuted }}>
            ← Back to source
          </button>
        </div>

        {/* Drop area — full-width hero */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files) void addFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className="rounded-xl border-2 border-dashed py-12 px-6 text-center cursor-pointer transition-colors"
          style={{
            borderColor: dragOver ? ACCENT : C.border,
            backgroundColor: dragOver ? "#F5F3FF" : C.bg,
          }}>
          <Upload size={32} className="mx-auto mb-3" style={{ color: dragOver ? ACCENT : C.textDim }} />
          <p className="text-sm font-semibold" style={{ color: C.textBody }}>
            Drop PDFs here or click to browse
          </p>
          <p className="text-[11px] mt-1" style={{ color: C.textDim }}>
            Up to {MAX_PDFS} files, {MAX_PDF_BYTES / 1024 / 1024}MB each. PDF only.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }}
          />
        </div>

        {/* Attached files */}
        {attachments.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {attachments.map((a, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border px-3 py-2"
                style={{ borderColor: C.border, backgroundColor: C.bg }}>
                <FileText size={13} style={{ color: ACCENT }} className="shrink-0" />
                <span className="text-xs flex-1 truncate" style={{ color: C.textBody }}>{a.filename}</span>
                <span className="text-[10px] shrink-0" style={{ color: C.textMuted }}>
                  {(a.sizeBytes / 1024).toFixed(0)} KB
                </span>
                <button onClick={() => removeAttachment(i)} className="p-1" style={{ color: C.textMuted }}>
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {genError && (
          <div className="mt-3 rounded-lg border p-2.5 flex items-start justify-between gap-2"
            style={{ backgroundColor: C.redLight, borderColor: `${C.red}40` }}>
            <div className="flex items-start gap-2 min-w-0">
              <AlertCircle size={12} className="mt-0.5 shrink-0" style={{ color: C.red }} />
              <p className="text-xs leading-relaxed" style={{ color: C.red }}>{genError}</p>
            </div>
            <button onClick={() => setGenError(null)} className="shrink-0 p-0.5" style={{ color: C.red }}>
              <X size={12} />
            </button>
          </div>
        )}

        <div className="flex items-center justify-end mt-5 pt-4 border-t" style={{ borderColor: C.border }}>
          <button onClick={generate} disabled={generating || attachments.length === 0}
            className="text-sm font-semibold px-5 py-2.5 rounded-lg inline-flex items-center gap-2 disabled:opacity-50"
            style={{ backgroundColor: ACCENT, color: "#fff" }}>
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {generating ? "Reading PDFs…" : "Extract sequence + draft messages"}
            {!generating && <ArrowRight size={14} />}
          </button>
        </div>
      </div>
    );
  }

  // ── Import source detail ─────────────────────────────────────────────
  if (source === "import") {
    return (
      <div className="rounded-2xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2" style={{ color: C.textPrimary }}>
              <Copy size={16} style={{ color: "#0A66C2" }} />
              Copy from an existing template
            </h2>
            <p className="text-xs mt-1" style={{ color: C.textMuted }}>
              Pick one to copy. You can rename and edit every step in the next pass.
            </p>
          </div>
          <button onClick={() => setSource(null)}
            className="text-[11px] font-semibold" style={{ color: C.textMuted }}>
            ← Back to source
          </button>
        </div>

        {importLoading && (
          <div className="py-10 text-center">
            <Loader2 size={20} className="mx-auto animate-spin mb-2" style={{ color: C.textMuted }} />
            <p className="text-xs" style={{ color: C.textMuted }}>Loading templates…</p>
          </div>
        )}
        {!importLoading && importables && importables.length === 0 && (
          <div className="py-10 text-center">
            <p className="text-sm" style={{ color: C.textDim }}>No templates yet to copy from.</p>
            <p className="text-[11px] mt-1" style={{ color: C.textDim }}>Try the PDF or scratch options instead.</p>
          </div>
        )}
        {!importLoading && importables && importables.length > 0 && (
          <div className="space-y-2">
            {importables.map(t => (
              <button
                key={t.id}
                disabled={importingId !== null}
                onClick={() => importFromTemplate(t.id)}
                className="w-full text-left rounded-lg border p-3 transition-colors hover:bg-black/[0.02] disabled:opacity-50"
                style={{ borderColor: C.border, backgroundColor: C.bg }}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: C.textPrimary }}>{t.name}</p>
                    {t.description && (
                      <p className="text-[11px] truncate mt-0.5" style={{ color: C.textMuted }}>{t.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5">
                      {t.channels.map(ch => {
                        const meta = channelMeta[ch as Channel];
                        if (!meta) return null;
                        const I = meta.icon;
                        return <I key={ch} size={10} style={{ color: meta.color }} />;
                      })}
                      <span className="text-[10px]" style={{ color: C.textDim }}>
                        used {t.usage_count}×
                      </span>
                    </div>
                  </div>
                  {importingId === t.id ? (
                    <Loader2 size={14} className="animate-spin" style={{ color: ACCENT }} />
                  ) : (
                    <ArrowRight size={14} style={{ color: C.textMuted }} />
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return null;
}

function SourceCard({
  icon, title, desc, badge, onClick,
}: { icon: React.ReactNode; title: string; desc: string; badge?: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="text-left rounded-2xl border p-5 transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
      style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: accentSoft(10) }}>{icon}</div>
        {badge && (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: accentSoft(15), color: ACCENT, border: `1px solid ${accentSoft(30)}` }}>
            {badge}
          </span>
        )}
      </div>
      <p className="text-sm font-bold mb-1" style={{ color: C.textPrimary }}>{title}</p>
      <p className="text-[11px] leading-relaxed" style={{ color: C.textMuted }}>{desc}</p>
    </button>
  );
}

// ─── Step 2: sequence editor ─────────────────────────────────────────────
function SequenceStep(props: {
  steps: Step[];
  hasConnectionRequest: boolean;
  addConnectionRequest: () => void;
  updateStep: (i: number, patch: Partial<Step>) => void;
  addStep: () => void;
  removeStep: (i: number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { steps, hasConnectionRequest, addConnectionRequest, updateStep, addStep, removeStep, onBack, onNext } = props;
  const bodyStepCount = steps.filter(s => !s.isConnectionRequest).length;
  const allBodiesFilled = steps.every(s => s.body.trim().length > 0);

  const inviteStep = steps.find(s => s.isConnectionRequest);
  const bodySteps = steps.filter(s => !s.isConnectionRequest);
  const hasLinkedInStep = bodySteps.some(s => s.channel === "linkedin");

  return (
    <div className="rounded-2xl border" style={{ backgroundColor: C.card, borderColor: C.border }}>
      {/* LinkedIn connection request — prerequisite, not a numbered step */}
      {(hasConnectionRequest || hasLinkedInStep) && (
        <div className="px-5 py-3 border-b flex items-start gap-3" style={{ borderColor: "#0A66C220", backgroundColor: "#EFF6FF" }}>
          <Share2 size={13} className="mt-0.5 shrink-0" style={{ color: "#0A66C2" }} />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold mb-1" style={{ color: "#0A66C2" }}>
              LinkedIn Connection Request <span className="font-normal opacity-60">(sent before first LinkedIn message)</span>
            </p>
            <textarea
              value={inviteStep?.body ?? ""}
              onChange={e => {
                if (inviteStep) {
                  const idx = steps.indexOf(inviteStep);
                  updateStep(idx, { body: e.target.value });
                } else {
                  addConnectionRequest();
                }
              }}
              placeholder="Hi {{first_name}}, noticed your team is scaling — would love to connect. (≤200 chars)"
              maxLength={200}
              rows={4}
              className="w-full rounded border px-3 py-2 text-sm outline-none resize-vertical leading-relaxed"
              style={{ borderColor: "#0A66C230", backgroundColor: "#fff", color: C.textPrimary, minHeight: 90, fontFamily: "inherit" }}
            />
            <p className="text-[10px] mt-0.5" style={{ color: "#0A66C280" }}>
              200 chars max · {200 - (inviteStep?.body.length ?? 0)} left
            </p>
          </div>
          {hasConnectionRequest && (
            <button onClick={() => removeStep(steps.indexOf(inviteStep!))}
              className="p-1 rounded mt-0.5 shrink-0 transition-colors"
              style={{ color: "#0A66C260" }}
              onMouseEnter={e => { e.currentTarget.style.color = C.red; }}
              onMouseLeave={e => { e.currentTarget.style.color = "#0A66C260"; }}>
              <Trash2 size={12} />
            </button>
          )}
        </div>
      )}

      <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
        <div>
          <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Sequence</h2>
          <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
            {bodyStepCount} {bodyStepCount === 1 ? "step" : "steps"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!hasConnectionRequest && !hasLinkedInStep && (
            <button onClick={addConnectionRequest}
              className="text-[11px] font-semibold px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 border"
              style={{ borderColor: "#0A66C230", color: "#0A66C2", backgroundColor: "#EFF6FF" }}>
              <Share2 size={11} /> Add LinkedIn invite
            </button>
          )}
          <button onClick={addStep}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-md inline-flex items-center gap-1 border"
            style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.surface }}>
            <Plus size={11} /> Add step
          </button>
        </div>
      </div>

      <div className="p-5 space-y-3">
        {steps.map((s, i) => {
          const meta = channelMeta[s.channel];
          const isInvite = s.isConnectionRequest;
          if (isInvite) return null;
          const stepNum = hasConnectionRequest ? i : i + 1;
          // Body-step index ignoring the invite. The FIRST body step has special
          // scheduling semantics depending on whether there's a connection
          // request:
          //   - With invite  → fires the moment Unipile reports the accept,
          //                    so daysAfter is meaningless (event-triggered).
          //   - Without invite → fires day 0 of the campaign.
          // Either way the user shouldn't see a "days" input for step 1.
          const bodyStepIdx = hasConnectionRequest ? i - 1 : i;
          const isFirstBodyStep = bodyStepIdx === 0;
          return (
            <div key={i} className="rounded-lg border p-3"
              style={{ borderColor: C.border, backgroundColor: C.bg }}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold"
                  style={{ backgroundColor: `${meta.color}18`, color: meta.color }}>
                  {stepNum}
                </div>
                {(
                  <>
                    <select
                      value={s.channel}
                      onChange={e => updateStep(i, { channel: e.target.value as Channel })}
                      className="text-xs rounded border px-2 py-1 outline-none"
                      style={{ borderColor: C.border, backgroundColor: C.card, color: C.textBody }}>
                      {(Object.keys(channelMeta) as Channel[]).map(ch => (
                        <option key={ch} value={ch}>{channelMeta[ch].label}</option>
                      ))}
                    </select>
                    {isFirstBodyStep ? (
                      <span className="text-[11px] italic" style={{ color: C.textMuted }}>
                        {hasConnectionRequest
                          ? "fires when the lead accepts the invite"
                          : "fires at campaign start (day 0)"}
                      </span>
                    ) : (
                      <>
                        <span className="text-[11px]" style={{ color: C.textMuted }}>after</span>
                        <input
                          type="number"
                          value={s.daysAfter}
                          onChange={e => updateStep(i, { daysAfter: Math.max(0, parseInt(e.target.value || "0", 10)) })}
                          className="w-14 text-xs rounded border px-2 py-1 outline-none tabular-nums"
                          style={{ borderColor: C.border, backgroundColor: C.card, color: C.textBody }}
                        />
                        <span className="text-[11px]" style={{ color: C.textMuted }}>days</span>
                      </>
                    )}
                  </>
                )}
                <button onClick={() => removeStep(i)}
                  className="ml-auto p-1 rounded transition-colors"
                  style={{ color: C.textMuted }}
                  onMouseEnter={e => { e.currentTarget.style.color = C.red; }}
                  onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; }}>
                  <Trash2 size={12} />
                </button>
              </div>
              {!isInvite && s.channel === "email" && (
                <input
                  value={s.subject ?? ""}
                  onChange={e => updateStep(i, { subject: e.target.value })}
                  placeholder="Email subject (optional)"
                  className="w-full mb-2 rounded border px-2 py-1.5 text-xs outline-none"
                  style={{ borderColor: C.border, backgroundColor: C.card, color: C.textPrimary }}
                />
              )}
              <textarea
                value={s.body}
                onChange={e => updateStep(i, { body: e.target.value })}
                placeholder={`What should be said at step ${stepNum}? Use {{first_name}}, {{company_name}}, {{seller_name}} as variables.`}
                rows={10}
                className="w-full rounded border px-3 py-2.5 text-sm outline-none resize-vertical leading-relaxed"
                style={{ borderColor: C.border, backgroundColor: C.card, color: C.textPrimary, minHeight: 200, fontFamily: "inherit" }}
              />

              {/* Per-step attachments — uploaded to Supabase Storage and stored
                  as {path,name,mimeType,sizeBytes} descriptors. The launch
                  endpoint propagates these into campaigns.sequence_steps[i].
                  attachments, where the email + LinkedIn dispatchers sign and
                  send them. Hidden on the LinkedIn connection request because
                  LinkedIn invites can't carry files; calls have no payload. */}
              {!isInvite && s.channel !== "call" && (
                <div className="mt-3">
                  <StepAttachments
                    channel={s.channel}
                    attachments={s.attachments ?? []}
                    onChange={(next) => updateStep(i, { attachments: next })}
                  />
                </div>
              )}

              {/* Source excerpt — verbatim PDF snippet the AI anchored on.
                  Empty for scratch/imported templates that never went through
                  generation. Disclosure pattern so it doesn't crowd the page. */}
              {s.sourceExcerpt && s.sourceExcerpt.length > 0 && (
                <details className="mt-2 group">
                  <summary className="text-[10px] cursor-pointer inline-flex items-center gap-1 select-none"
                    style={{ color: C.textMuted }}>
                    <FileText size={10} /> Source from PDF
                  </summary>
                  <p className="text-[11px] mt-1.5 pl-3 italic"
                    style={{ color: C.textBody, borderLeft: `2px solid ${accentSoft(40)}` }}>
                    “{s.sourceExcerpt}”
                  </p>
                </details>
              )}

              {/* A/B variant — second body that the dispatcher 50/50-splits
                  with `body`. Hidden by default; "Add variant B" reveals. */}
              {!isInvite && (
                Array.isArray(s.variants) && s.variants.length > 0 ? (
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] uppercase tracking-wider font-semibold"
                        style={{ color: ACCENT }}>Variant B (A/B test)</span>
                      <button type="button"
                        onClick={() => updateStep(i, { variants: undefined })}
                        className="text-[10px]" style={{ color: C.textMuted }}>
                        Remove variant
                      </button>
                    </div>
                    <textarea
                      value={s.variants[0] ?? ""}
                      onChange={e => updateStep(i, { variants: [e.target.value] })}
                      placeholder="Variant B — same step, different angle. Dispatcher splits 50/50."
                      rows={8}
                      className="w-full rounded border px-3 py-2.5 text-sm outline-none resize-vertical leading-relaxed"
                      style={{ borderColor: accentSoft(40), backgroundColor: C.card, color: C.textPrimary, minHeight: 160, fontFamily: "inherit" }}
                    />
                  </div>
                ) : (
                  <button type="button"
                    onClick={() => updateStep(i, { variants: [""] })}
                    className="text-[10px] mt-2 font-semibold inline-flex items-center gap-1"
                    style={{ color: ACCENT }}>
                    <Plus size={10} /> Add A/B variant
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>

      <div className="px-5 py-4 border-t flex items-center justify-between" style={{ borderColor: C.border }}>
        <button onClick={onBack}
          className="text-sm font-semibold inline-flex items-center gap-1.5 px-3 py-2 rounded-lg"
          style={{ color: C.textBody }}>
          <ArrowLeft size={14} /> Back
        </button>
        <button onClick={onNext}
          disabled={bodyStepCount === 0 || !allBodiesFilled}
          className="text-sm font-semibold px-5 py-2.5 rounded-lg inline-flex items-center gap-2 disabled:opacity-50"
          style={{ backgroundColor: ACCENT, color: "#fff" }}>
          Continue <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: identity + save ────────────────────────────────────────────
function IdentityStep(props: {
  name: string; setName: (v: string) => void;
  description: string; setDescription: (v: string) => void;
  tagsInput: string; setTagsInput: (v: string) => void;
  steps: Step[];
  tonePreset: TonePreset;
  rewriteMode: RewriteMode; setRewriteMode: (v: RewriteMode) => void;
  voiceAnchor: string | null;
  voiceOptions: Array<{ id: string; name: string }>;
  error: string | null; setError: (e: string | null) => void;
  saving: boolean;
  onBack: () => void;
  onSave: () => void;
}) {
  const {
    name, setName, description, setDescription, tagsInput, setTagsInput, steps,
    tonePreset, rewriteMode, setRewriteMode, voiceAnchor, voiceOptions,
    error, setError, saving, onBack, onSave,
  } = props;
  const toneLabel = TONE_PRESETS.find(t => t.id === tonePreset)?.label ?? tonePreset;
  const voiceLabel = voiceAnchor ? (voiceOptions.find(v => v.id === voiceAnchor)?.name ?? "—") : null;
  const variantsCount = steps.filter(s => Array.isArray(s.variants) && s.variants.length > 0).length;
  return (
    <div className="rounded-2xl border" style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="px-5 py-4 border-b" style={{ borderColor: C.border }}>
        <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Name + tags</h2>
        <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
          How will you find this template later? Pick a clear name and tag it for filtering.
        </p>
      </div>

      <div className="p-5 space-y-3">
        <div>
          <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: C.textDim }}>
            Name <span style={{ color: C.red }}>*</span>
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g., Healthcare Asset Finance — CEO Outreach"
            className="w-full mt-1 rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
            autoFocus
          />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: C.textDim }}>
            Description
          </label>
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="When should this template be used?"
            className="w-full mt-1 rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
          />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: C.textDim }}>
            Tags (comma-separated)
          </label>
          <input
            value={tagsInput}
            onChange={e => setTagsInput(e.target.value)}
            placeholder="healthcare, asset-finance, c-level"
            className="w-full mt-1 rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
          />
        </div>

        {/* Rewrite mode picker — only meaningful at apply-time, so it sits at
            the Save step. Pills mirror the tone preset row in Step 1. */}
        <div>
          <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: C.textDim }}>
            How should the AI rewrite per lead?
          </label>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {REWRITE_MODES.map(p => {
              const active = p.id === rewriteMode;
              return (
                <button key={p.id} type="button" onClick={() => setRewriteMode(p.id)}
                  title={p.desc}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-colors"
                  style={{
                    backgroundColor: active ? accentSoft(15) : C.bg,
                    borderColor: active ? accentSoft(40) : C.border,
                    color: active ? ACCENT : C.textBody,
                  }}>
                  {p.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] mt-2" style={{ color: C.textMuted }}>
            {REWRITE_MODES.find(m => m.id === rewriteMode)?.desc}
          </p>
        </div>

        {/* Quick recap so the user can confirm what they're about to save */}
        <div className="rounded-lg border p-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
          <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: C.textMuted }}>Recap</p>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {steps.map((s, i) => {
              const meta = channelMeta[s.channel];
              const Icon = meta.icon;
              return (
                <div key={i} className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md"
                  style={{ backgroundColor: `${meta.color}10`, color: meta.color, border: `1px solid ${meta.color}30` }}>
                  <Icon size={10} />
                  <span className="font-semibold">{s.isConnectionRequest ? "Invite" : meta.label}</span>
                  <span className="opacity-60">· d{s.daysAfter}</span>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[10px]">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border"
              style={{ borderColor: accentSoft(40), backgroundColor: accentSoft(10), color: ACCENT }}>
              Tone · {toneLabel}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border"
              style={{ borderColor: accentSoft(40), backgroundColor: accentSoft(10), color: ACCENT }}>
              Rewrite · {REWRITE_MODES.find(m => m.id === rewriteMode)?.label}
            </span>
            {voiceLabel && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border"
                style={{ borderColor: accentSoft(40), backgroundColor: accentSoft(10), color: ACCENT }}>
                Voice · {voiceLabel}
              </span>
            )}
            {variantsCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border"
                style={{ borderColor: "#16A34A40", backgroundColor: "#DCFCE7", color: "#16A34A" }}>
                A/B · {variantsCount} step{variantsCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-5 mb-3 rounded-lg border p-3 flex items-start justify-between gap-2"
          style={{ backgroundColor: C.redLight, borderColor: `${C.red}40` }}>
          <div className="flex items-start gap-2 min-w-0">
            <AlertCircle size={12} className="mt-0.5 shrink-0" style={{ color: C.red }} />
            <p className="text-xs leading-relaxed" style={{ color: C.red }}>{error}</p>
          </div>
          <button onClick={() => setError(null)} className="shrink-0 p-0.5" style={{ color: C.red }}>
            <X size={12} />
          </button>
        </div>
      )}

      <div className="px-5 py-4 border-t flex items-center justify-between" style={{ borderColor: C.border }}>
        <button onClick={onBack}
          className="text-sm font-semibold inline-flex items-center gap-1.5 px-3 py-2 rounded-lg"
          style={{ color: C.textBody }}>
          <ArrowLeft size={14} /> Back
        </button>
        <button onClick={onSave} disabled={saving || !name.trim()}
          className="text-sm font-semibold px-5 py-2.5 rounded-lg inline-flex items-center gap-2 disabled:opacity-50"
          style={{ backgroundColor: ACCENT, color: "#fff" }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? "Saving…" : "Save Template"}
        </button>
      </div>
    </div>
  );
}
