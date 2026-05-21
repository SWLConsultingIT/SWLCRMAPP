"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Play, MoreHorizontal, Copy, FolderTree, Trash2, X, ArrowRight, Loader2,
  Pencil, Save, Share2, Mail, Phone, MessageSquare, Plus, GripVertical,
} from "lucide-react";
import { C } from "@/lib/design";
import TemplateLaunchModal from "@/components/TemplateLaunchModal";
import StepAttachments, { type StepAttachment } from "@/components/StepAttachments";

const gold = "var(--brand, #c9a83a)";

type IcpOption = { id: string; profile_name: string };

type FullTemplate = {
  id: string; name: string; description?: string | null;
  sequence_steps: Array<{ channel: string; daysAfter: number }>;
  step_messages: {
    connectionRequest?: string;
    steps?: Array<{ step: number; channel: string; subject?: string | null; body: string; source_excerpt?: string; attachments?: StepAttachment[] }>;
    autoReplies?: { positive?: string; negative?: string; question?: string };
  };
  icp_profile_id?: string | null;
  tone_preset?: string | null;
  tone_custom_notes?: string | null;
  rewrite_mode?: string | null;
};

type TonePreset = "conservative" | "balanced" | "direct" | "spicy" | "custom";
type RewriteMode = "verbatim" | "personalize" | "rewrite_with_source";

const TONE_PRESETS: Array<{ id: TonePreset; label: string; desc: string }> = [
  { id: "conservative", label: "Conservative", desc: "Formal, safe, no hype." },
  { id: "balanced",     label: "Balanced",     desc: "Conversational professional. Default." },
  { id: "direct",       label: "Direct",       desc: "Punchy, no fluff." },
  { id: "spicy",        label: "Spicy",        desc: "Bold opener, sharp angles." },
  { id: "custom",       label: "Custom",       desc: "Bring your own style notes." },
];

const REWRITE_MODES: Array<{ id: RewriteMode; label: string; desc: string }> = [
  { id: "verbatim",            label: "Verbatim",                desc: "Use body as-is. Only {{first_name}} / {{seller_name}} substituted." },
  { id: "personalize",         label: "Personalize per lead",    desc: "Light per-lead rewrite by Claude." },
  { id: "rewrite_with_source", label: "Rewrite from source PDF", desc: "Per-lead rewrite anchored to the source PDFs." },
];

type EditStep = { channel: string; daysAfter: number; subject: string; body: string; attachments?: StepAttachment[] };

const CHANNELS = [
  { key: "linkedin", label: "LinkedIn", icon: Share2,        color: "#0A66C2" },
  { key: "email",    label: "Email",    icon: Mail,          color: "#7C3AED" },
  { key: "call",     label: "Call",     icon: Phone,         color: "#F97316" },
  { key: "whatsapp", label: "WhatsApp", icon: MessageSquare, color: "#25D366" },
];
const channelMeta = Object.fromEntries(CHANNELS.map(c => [c.key, c]));

export default function TemplateDetailActions({
  templateId, templateName, currentIcpId, icps,
}: {
  templateId: string; templateName: string;
  currentIcpId: string | null; icps: IcpOption[];
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [submenu, setSubmenu] = useState<"main" | "duplicate" | "move">("main");
  const [busy, setBusy] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) { setSubmenu("main"); return; }
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  async function handleAssign(icpId: string) {
    if (busy) return; setBusy(true);
    try {
      const res = await fetch(`/api/templates/${templateId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ icp_profile_id: icpId }) });
      if (!res.ok) { const b = await res.json().catch(() => ({})); alert(b.error ?? "Couldn't move"); return; }
      setMenuOpen(false); router.refresh();
    } finally { setBusy(false); }
  }

  async function handleDuplicate(icpId: string) {
    if (busy) return; setBusy(true);
    try {
      const res = await fetch(`/api/templates/${templateId}/duplicate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ icp_profile_id: icpId }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { alert(b.error ?? "Couldn't duplicate"); return; }
      if (b.template?.id) router.push(`/campaigns/templates/${b.template.id}`);
      else { setMenuOpen(false); router.refresh(); }
    } finally { setBusy(false); }
  }

  async function handleDelete() {
    if (busy) return;
    if (!confirm(`Delete template "${templateName}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/templates/${templateId}`, { method: "DELETE" });
      if (!res.ok) { const b = await res.json().catch(() => ({})); alert(b.error ?? "Couldn't delete"); return; }
      router.push("/campaigns");
    } finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <button onClick={() => setLaunchOpen(true)} disabled={busy}
        className="text-sm font-semibold px-4 py-2 rounded-lg inline-flex items-center gap-2 disabled:opacity-50"
        style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#1A1A2E" }}>
        <Play size={13} /> Use template
      </button>

      <div className="relative" ref={ref}>
        <button onClick={() => setMenuOpen(o => !o)} disabled={busy}
          className="p-2 rounded-lg border disabled:opacity-50"
          style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.card }}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <MoreHorizontal size={14} />}
        </button>

        {menuOpen && submenu === "main" && (
          <div className="absolute right-0 top-full mt-1 z-10 w-52 rounded-lg border shadow-lg overflow-hidden"
            style={{ backgroundColor: C.card, borderColor: C.border }}>
            <button onClick={() => { setMenuOpen(false); setEditOpen(true); }}
              className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-black/[0.04]"
              style={{ color: C.textBody }}>
              <Pencil size={12} /> Edit template
            </button>
            <button onClick={() => setSubmenu("duplicate")}
              className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-black/[0.04]"
              style={{ color: C.textBody }}>
              <Copy size={12} /> Duplicate to ICP… <ArrowRight size={10} className="ml-auto" />
            </button>
            <button onClick={() => setSubmenu("move")}
              className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-black/[0.04]"
              style={{ color: C.textBody }}>
              <FolderTree size={12} /> Move to ICP… <ArrowRight size={10} className="ml-auto" />
            </button>
            <button onClick={handleDelete}
              className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-black/[0.04] border-t"
              style={{ color: C.red, borderColor: C.border }}>
              <Trash2 size={12} /> Delete
            </button>
          </div>
        )}
        {menuOpen && submenu === "duplicate" && (
          <IcpPicker icps={icps} onPick={handleDuplicate} title="Duplicate to which ICP?" onCancel={() => setSubmenu("main")} />
        )}
        {menuOpen && submenu === "move" && (
          <IcpPicker icps={icps} onPick={handleAssign} title="Move to which ICP?" excludeId={currentIcpId} onCancel={() => setSubmenu("main")} />
        )}
      </div>

      {launchOpen && <TemplateLaunchModal templateId={templateId} templateName={templateName} icpProfileId={currentIcpId} onClose={() => setLaunchOpen(false)} />}
      {editOpen && <EditOverlay templateId={templateId} icps={icps} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); router.refresh(); }} />}
    </div>
  );
}

/* ── Edit overlay ── */
function EditOverlay({ templateId, icps, onClose, onSaved }: { templateId: string; icps: IcpOption[]; onClose: () => void; onSaved: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tpl, setTpl] = useState<FullTemplate | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [connReq, setConnReq] = useState<string | null>(null); // null = no invite step
  const [steps, setSteps] = useState<EditStep[]>([]);
  const [icpId, setIcpId] = useState<string | null>(null);
  const [tonePreset, setTonePreset] = useState<TonePreset>("balanced");
  const [toneCustom, setToneCustom] = useState("");
  const [rewriteMode, setRewriteMode] = useState<RewriteMode>("personalize");

  useEffect(() => {
    fetch(`/api/templates/${templateId}`, { cache: "no-store" })
      .then(r => r.json())
      .then(({ template }: { template: FullTemplate }) => {
        if (!template) return;
        setTpl(template);
        setName(template.name ?? "");
        setDescription(template.description ?? "");
        const cr = template.step_messages?.connectionRequest ?? null;
        setConnReq(cr && cr.length > 0 ? cr : null);
        // Build editSteps: skip sequence[0] if it's the connection request slot
        const seqSteps = template.sequence_steps ?? [];
        const msgSteps = template.step_messages?.steps ?? [];
        const offset = (cr && cr.length > 0 && seqSteps[0]?.channel === "linkedin" && seqSteps[0]?.daysAfter === 0) ? 1 : 0;
        const combined: EditStep[] = seqSteps.slice(offset).map((s, i) => {
          const msg = msgSteps[i];
          return {
            channel: s.channel,
            daysAfter: s.daysAfter,
            subject: msg?.subject ?? "",
            body: msg?.body ?? "",
            // Hydrate attachments so the user sees them in the edit view AND
            // the save payload preserves them (otherwise a save would wipe
            // any uploaded files).
            attachments: Array.isArray(msg?.attachments) ? msg.attachments : undefined,
          };
        });
        setSteps(combined);
        setIcpId(template.icp_profile_id ?? null);
        setTonePreset((template.tone_preset as TonePreset) ?? "balanced");
        setToneCustom(template.tone_custom_notes ?? "");
        setRewriteMode((template.rewrite_mode as RewriteMode) ?? "personalize");
      })
      .finally(() => setLoading(false));
  }, [templateId]);

  function addStep() {
    setSteps(prev => [...prev, { channel: "email", daysAfter: 3, subject: "", body: "" }]);
  }
  function removeStep(idx: number) {
    setSteps(prev => prev.filter((_, i) => i !== idx));
  }
  function updateStep(idx: number, patch: Partial<EditStep>) {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  }
  function moveStep(idx: number, dir: -1 | 1) {
    const next = idx + dir;
    if (next < 0 || next >= steps.length) return;
    setSteps(prev => {
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      return arr;
    });
  }

  const cumDays = (() => {
    let d = connReq !== null ? 0 : 0;
    return steps.map((s, i) => { if (i === 0 && connReq !== null) { d = s.daysAfter; return s.daysAfter; } if (i === 0) { d = s.daysAfter; return s.daysAfter; } d += s.daysAfter; return d; });
  })();

  async function handleSave() {
    if (!tpl) return;
    setSaving(true);
    try {
      const hasInvite = connReq !== null;
      const sequence_steps = [
        ...(hasInvite ? [{ channel: "linkedin", daysAfter: 0 }] : []),
        ...steps.map(s => ({ channel: s.channel, daysAfter: s.daysAfter })),
      ];
      const msgSteps = steps.map((s, i) => ({
        step: i + (hasInvite ? 1 : 1),
        channel: s.channel,
        subject: s.channel === "email" ? (s.subject || null) : null,
        body: s.body,
        // Preserve attachments through the round-trip. Without this the edit
        // overlay would silently wipe any per-step files the user uploaded
        // from the create wizard.
        attachments: Array.isArray(s.attachments) && s.attachments.length > 0 ? s.attachments : undefined,
      }));
      const res = await fetch(`/api/templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || tpl.name,
          description: description.trim() || null,
          sequence_steps,
          step_messages: { ...tpl.step_messages, connectionRequest: connReq ?? "", steps: msgSteps },
          icp_profile_id: icpId,
          tone_preset: tonePreset,
          tone_custom_notes: tonePreset === "custom" ? (toneCustom.trim() || null) : null,
          rewrite_mode: rewriteMode,
        }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); alert(b.error ?? "Save failed"); return; }
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: C.bg }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0"
        style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-1.5 rounded-lg border" style={{ borderColor: C.border, color: C.textBody }}>
            <X size={14} />
          </button>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textDim }}>Editing template</p>
            <p className="text-sm font-bold" style={{ color: C.textPrimary }}>{name || "…"}</p>
          </div>
        </div>
        <button onClick={handleSave} disabled={saving || loading}
          className="text-sm font-semibold px-4 py-2 rounded-lg inline-flex items-center gap-2 disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#1A1A2E" }}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          Save changes
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto w-full">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 size={20} className="animate-spin" style={{ color: gold }} />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Name + description */}
            <div className="rounded-xl border p-5 space-y-3" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: C.textMuted }}>Name</label>
                <input value={name} onChange={e => setName(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none"
                  style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }} />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: C.textMuted }}>Description</label>
                <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional"
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }} />
              </div>
            </div>

            {/* Targeting + behavior — ICP / Tone / Rewrite. These weren't editable
                before; users had to delete & rebuild the template just to change
                rewrite_mode or move it to a different ICP. */}
            <div className="rounded-xl border p-5 space-y-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
                Targeting &amp; behavior
              </p>

              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: C.textMuted }}>ICP target</label>
                <select value={icpId ?? ""} onChange={e => setIcpId(e.target.value || null)}
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}>
                  <option value="">— None —</option>
                  {icps.map(i => <option key={i.id} value={i.id}>{i.profile_name}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider block mb-2" style={{ color: C.textMuted }}>Tone</label>
                <div className="flex flex-wrap gap-1.5">
                  {TONE_PRESETS.map(t => (
                    <button key={t.id} onClick={() => setTonePreset(t.id)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-md border transition-colors"
                      style={{
                        borderColor: tonePreset === t.id ? gold : C.border,
                        backgroundColor: tonePreset === t.id ? `color-mix(in srgb, ${gold} 10%, transparent)` : C.bg,
                        color: tonePreset === t.id ? gold : C.textBody,
                      }}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] mt-1.5" style={{ color: C.textMuted }}>
                  {TONE_PRESETS.find(t => t.id === tonePreset)?.desc}
                </p>
                {tonePreset === "custom" && (
                  <textarea value={toneCustom} onChange={e => setToneCustom(e.target.value)}
                    placeholder="Paste your style guide / writing examples."
                    rows={3} maxLength={1500}
                    className="w-full mt-2 rounded-lg border px-3 py-2 text-sm focus:outline-none resize-y"
                    style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }} />
                )}
              </div>

              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider block mb-2" style={{ color: C.textMuted }}>Rewrite mode</label>
                <div className="space-y-1.5">
                  {REWRITE_MODES.map(m => (
                    <button key={m.id} onClick={() => setRewriteMode(m.id)}
                      className="w-full flex items-start gap-2 text-left px-3 py-2 rounded-md border transition-colors"
                      style={{
                        borderColor: rewriteMode === m.id ? gold : C.border,
                        backgroundColor: rewriteMode === m.id ? `color-mix(in srgb, ${gold} 8%, transparent)` : C.bg,
                      }}>
                      <span className="text-xs font-semibold shrink-0" style={{ color: rewriteMode === m.id ? gold : C.textBody }}>
                        {m.label}
                      </span>
                      <span className="text-[11px]" style={{ color: C.textMuted }}>{m.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Connection request */}
            {connReq !== null && (
              <StepEditor
                label="LinkedIn invite" channel="linkedin" day={0} isInvite
                body={connReq} onBodyChange={setConnReq} charLimit={200}
              />
            )}

            {/* Sequence steps */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
                  Sequence steps ({steps.length})
                </p>
              </div>

              {steps.map((s, idx) => {
                const meta = channelMeta[s.channel] ?? CHANNELS[0];
                const Icon = meta.icon;
                const day = cumDays[idx] ?? 0;
                return (
                  <div key={idx} className="rounded-xl border" style={{ backgroundColor: C.card, borderColor: C.border, borderLeft: `3px solid ${meta.color}` }}>
                    {/* Step header */}
                    <div className="flex items-center gap-2 px-4 pt-3 pb-2">
                      {/* Move up/down */}
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button onClick={() => moveStep(idx, -1)} disabled={idx === 0}
                          className="p-0.5 rounded opacity-40 hover:opacity-100 disabled:opacity-20 transition-opacity"
                          style={{ color: C.textMuted }}>
                          <GripVertical size={12} style={{ transform: "rotate(90deg) scaleX(-1)" }} />
                        </button>
                        <button onClick={() => moveStep(idx, 1)} disabled={idx === steps.length - 1}
                          className="p-0.5 rounded opacity-40 hover:opacity-100 disabled:opacity-20 transition-opacity"
                          style={{ color: C.textMuted }}>
                          <GripVertical size={12} style={{ transform: "rotate(90deg)" }} />
                        </button>
                      </div>

                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                        style={{ backgroundColor: `${meta.color}18`, color: meta.color }}>
                        {idx + 1}
                      </div>

                      {/* Channel selector */}
                      <div className="flex items-center gap-1 flex-1">
                        {CHANNELS.map(ch => {
                          const CIcon = ch.icon;
                          const active = s.channel === ch.key;
                          return (
                            <button key={ch.key} onClick={() => updateStep(idx, { channel: ch.key })}
                              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors"
                              style={{
                                backgroundColor: active ? `${ch.color}15` : "transparent",
                                color: active ? ch.color : C.textMuted,
                                border: `1px solid ${active ? ch.color + "40" : "transparent"}`,
                              }}>
                              <CIcon size={11} /> {ch.label}
                            </button>
                          );
                        })}
                      </div>

                      {/* Days after */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {idx === 0 && connReq !== null ? (
                          <span className="text-[10px] px-2 py-1 rounded" style={{ backgroundColor: C.surface, color: C.textMuted }}>Day 0</span>
                        ) : (
                          <>
                            <span className="text-[10px]" style={{ color: C.textMuted }}>Wait</span>
                            <input type="number" min={1} value={s.daysAfter}
                              onChange={e => updateStep(idx, { daysAfter: Math.max(1, parseInt(e.target.value || "1")) })}
                              className="w-14 rounded-lg border px-2 py-1 text-xs font-bold text-center focus:outline-none tabular-nums"
                              style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }} />
                            <span className="text-[10px]" style={{ color: C.textMuted }}>d · Day {day}</span>
                          </>
                        )}
                      </div>

                      <button onClick={() => removeStep(idx)}
                        className="p-1 rounded shrink-0 opacity-30 hover:opacity-100 transition-opacity ml-1"
                        style={{ color: C.red }}>
                        <Trash2 size={12} />
                      </button>
                    </div>

                    {/* Message body */}
                    <div className="px-4 pb-4 space-y-2">
                      {s.channel === "email" && (
                        <div>
                          <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: C.textMuted }}>Subject</label>
                          <input value={s.subject} onChange={e => updateStep(idx, { subject: e.target.value })}
                            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                            style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }} />
                        </div>
                      )}
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: C.textMuted }}>Body</label>
                        <textarea value={s.body} onChange={e => updateStep(idx, { body: e.target.value })} rows={10}
                          className="w-full rounded-lg border px-3 py-2.5 text-sm leading-relaxed focus:outline-none resize-y"
                          style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary, minHeight: 200, fontFamily: "inherit" }} />
                      </div>
                      {/* Per-step attachments — same component the create wizard +
                          campaign wizard use. Calls don't carry files, so the
                          uploader is hidden for that channel. */}
                      {s.channel !== "call" && (
                        <div className="pt-1">
                          <StepAttachments
                            channel={s.channel}
                            attachments={s.attachments ?? []}
                            onChange={(next) => updateStep(idx, { attachments: next })}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <button onClick={addStep}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed text-xs font-medium transition-opacity hover:opacity-80"
                style={{ borderColor: C.border, color: C.textMuted }}>
                <Plus size={13} /> Add step
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepEditor({ label, channel, day, isInvite, body, onBodyChange, charLimit }: {
  label: string; channel: string; day: number; isInvite?: boolean;
  body: string; onBodyChange: (v: string) => void; charLimit?: number;
}) {
  const meta = channelMeta[channel] ?? CHANNELS[0];
  const Icon = meta.icon;
  return (
    <div className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border, borderLeft: `3px solid ${meta.color}` }}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
          style={{ backgroundColor: `${meta.color}18`, color: meta.color }}>0</div>
        <Icon size={13} style={{ color: meta.color }} />
        <span className="text-xs font-bold" style={{ color: meta.color }}>{isInvite ? "LinkedIn invite" : label}</span>
        <span className="text-[10px] px-2 py-0.5 rounded" style={{ backgroundColor: C.surface, color: C.textMuted }}>Day {day}</span>
        {charLimit && (
          <span className="ml-auto text-[10px] tabular-nums" style={{ color: body.length > charLimit ? C.red : C.textDim }}>
            {body.length}/{charLimit}
          </span>
        )}
      </div>
      <textarea value={body} onChange={e => onBodyChange(e.target.value)} rows={3}
        className="w-full rounded-lg border px-3 py-2 text-sm leading-relaxed focus:outline-none resize-y"
        style={{ borderColor: charLimit && body.length > charLimit ? C.red : C.border, backgroundColor: C.bg, color: C.textPrimary, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }} />
    </div>
  );
}

function IcpPicker({ icps, onPick, onCancel, title, excludeId }: {
  icps: IcpOption[]; onPick: (id: string) => void; onCancel: () => void; title: string; excludeId?: string | null;
}) {
  const items = excludeId ? icps.filter(i => i.id !== excludeId) : icps;
  return (
    <div className="absolute right-0 top-full mt-1 z-10 w-64 rounded-lg border shadow-lg overflow-hidden"
      style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="px-3 py-2 border-b flex items-center justify-between" style={{ borderColor: C.border, backgroundColor: C.bg }}>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{title}</span>
        <button onClick={onCancel} className="p-0.5" style={{ color: C.textMuted }}><X size={11} /></button>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-3 py-3 text-xs text-center" style={{ color: C.textMuted }}>No ICPs available.</p>
        ) : items.map(icp => (
          <button key={icp.id} onClick={() => onPick(icp.id)}
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
