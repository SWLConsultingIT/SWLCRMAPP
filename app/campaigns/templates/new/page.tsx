"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Save, Loader2, Plus, Trash2, Share2, Mail, Phone, MessageCircle, FileText, AlertCircle, X } from "lucide-react";
import { C } from "@/lib/design";

const gold = "var(--brand, #c9a83a)";

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
};

// Build the wizard-compatible step_messages payload from the editor state.
// The wizard expects: { connectionRequest, steps: [{step, channel, subject?, body}], autoReplies }
function buildStepMessages(connectionRequest: string, steps: Step[]) {
  return {
    connectionRequest,
    steps: steps.map((s, i) => ({
      step: i + 1,
      channel: s.channel,
      subject: s.channel === "email" ? (s.subject ?? null) : null,
      body: s.body,
    })),
    autoReplies: { positive: "", negative: "", question: "" },
  };
}

export default function NewTemplatePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [includesLinkedIn, setIncludesLinkedIn] = useState(true);
  const [connectionRequest, setConnectionRequest] = useState("");
  const [steps, setSteps] = useState<Step[]>([
    { channel: "linkedin", daysAfter: 1, body: "" },
    { channel: "email",    daysAfter: 3, body: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateStep(i: number, patch: Partial<Step>) {
    setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  }
  function addStep() {
    setSteps(prev => [...prev, { channel: "email", daysAfter: 3, body: "" }]);
  }
  function removeStep(i: number) {
    setSteps(prev => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    if (saving) return;
    if (!name.trim()) {
      setError("Template name is required");
      return;
    }
    if (steps.length === 0) {
      setError("Add at least one step");
      return;
    }
    if (steps.some(s => !s.body.trim())) {
      setError("Every step needs message content");
      return;
    }

    setSaving(true);
    setError(null);

    const tags = tagsInput.split(",").map(t => t.trim()).filter(Boolean).slice(0, 10);
    const sequence_steps = [
      // If LinkedIn invite included, step 0 is the connection request itself.
      ...(includesLinkedIn ? [{ channel: "linkedin", daysAfter: 0 }] : []),
      ...steps.map(s => ({ channel: s.channel, daysAfter: s.daysAfter })),
    ];
    const channels = Array.from(new Set(sequence_steps.map(s => s.channel)));

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
          step_messages: buildStepMessages(includesLinkedIn ? connectionRequest : "", steps),
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

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/campaigns"
            className="p-2 rounded-lg border hover:bg-gray-50"
            style={{ borderColor: C.border, color: C.textBody }}>
            <ArrowLeft size={14} />
          </Link>
          <div>
            <h1 className="text-xl font-bold" style={{ color: C.textPrimary }}>New Template</h1>
            <p className="text-xs" style={{ color: C.textMuted }}>
              Define a reusable sequence + messages. Save once, apply to any future campaign.
            </p>
          </div>
        </div>
      </div>

      {/* Basic info */}
      <div className="rounded-2xl border p-5 mb-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <h2 className="text-sm font-bold mb-3" style={{ color: C.textPrimary }}>Basic info</h2>
        <div className="space-y-3">
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
        </div>
      </div>

      {/* LinkedIn connection request toggle */}
      <div className="rounded-2xl border p-5 mb-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>LinkedIn connection request</h2>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includesLinkedIn}
              onChange={e => setIncludesLinkedIn(e.target.checked)}
              className="sr-only"
            />
            <div className="w-9 h-5 rounded-full relative transition-colors"
              style={{ backgroundColor: includesLinkedIn ? "#0A66C2" : C.border }}>
              <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                style={{ transform: includesLinkedIn ? "translateX(16px)" : "translateX(0)" }} />
            </div>
            <span className="text-xs" style={{ color: C.textBody }}>Include connection request</span>
          </label>
        </div>
        {includesLinkedIn && (
          <textarea
            value={connectionRequest}
            onChange={e => setConnectionRequest(e.target.value)}
            placeholder="Hi {{first_name}}, noticed your team is scaling — would love to connect."
            rows={2}
            maxLength={300}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none resize-none"
            style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
          />
        )}
        {includesLinkedIn && (
          <p className="text-[10px] mt-1" style={{ color: C.textDim }}>
            LinkedIn caps connection requests at 300 chars. Variables: <code>{"{{first_name}}"}</code>, <code>{"{{company_name}}"}</code>.
          </p>
        )}
      </div>

      {/* Steps */}
      <div className="rounded-2xl border p-5 mb-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Sequence steps</h2>
          <button onClick={addStep}
            className="text-xs font-medium px-3 py-1.5 rounded-md inline-flex items-center gap-1 border"
            style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.surface }}>
            <Plus size={12} /> Add step
          </button>
        </div>
        <div className="space-y-3">
          {steps.map((s, i) => {
            const meta = channelMeta[s.channel];
            const Icon = meta.icon;
            return (
              <div key={i} className="rounded-lg border p-3" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold"
                    style={{ backgroundColor: `${meta.color}18`, color: meta.color }}>
                    {i + 1}
                  </div>
                  <select
                    value={s.channel}
                    onChange={e => updateStep(i, { channel: e.target.value as Channel })}
                    className="text-xs rounded border px-2 py-1 outline-none"
                    style={{ borderColor: C.border, backgroundColor: C.card, color: C.textBody }}>
                    {(Object.keys(channelMeta) as Channel[]).map(ch => (
                      <option key={ch} value={ch}>{channelMeta[ch].label}</option>
                    ))}
                  </select>
                  <span className="text-[11px]" style={{ color: C.textMuted }}>after</span>
                  <input
                    type="number"
                    value={s.daysAfter}
                    onChange={e => updateStep(i, { daysAfter: Math.max(0, parseInt(e.target.value || "0", 10)) })}
                    className="w-14 text-xs rounded border px-2 py-1 outline-none"
                    style={{ borderColor: C.border, backgroundColor: C.card, color: C.textBody }}
                  />
                  <span className="text-[11px]" style={{ color: C.textMuted }}>days</span>
                  <button onClick={() => removeStep(i)}
                    className="ml-auto p-1 rounded transition-colors"
                    style={{ color: C.textMuted }}
                    onMouseEnter={e => { e.currentTarget.style.color = C.red; }}
                    onMouseLeave={e => { e.currentTarget.style.color = C.textMuted; }}>
                    <Trash2 size={12} />
                  </button>
                </div>
                {s.channel === "email" && (
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
                  placeholder={`What should be said at step ${i + 1}? Use {{first_name}}, {{company_name}}, {{seller_name}} as variables.`}
                  rows={4}
                  className="w-full rounded border px-2 py-1.5 text-xs outline-none resize-vertical"
                  style={{ borderColor: C.border, backgroundColor: C.card, color: C.textPrimary }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Errors + save */}
      {error && (
        <div className="rounded-lg border p-3 mb-4 flex items-start justify-between gap-2"
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

      <div className="flex items-center justify-end gap-3 pt-3 border-t" style={{ borderColor: C.border }}>
        <Link href="/campaigns"
          className="text-sm font-semibold px-5 py-2.5 rounded-lg border"
          style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.surface }}>
          Cancel
        </Link>
        <button onClick={save} disabled={saving || !name.trim()}
          className="text-sm font-semibold px-5 py-2.5 rounded-lg inline-flex items-center gap-2 disabled:opacity-50"
          style={{ backgroundColor: "#7C3AED", color: "#fff" }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
          {saving ? "Saving…" : "Save Template"}
        </button>
      </div>
    </div>
  );
}
