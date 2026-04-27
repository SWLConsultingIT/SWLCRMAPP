"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2, Save, Loader2, MessageCircle } from "lucide-react";
import { C } from "@/lib/design";

const gold = C.gold;

type VoiceExample = { body: string; step_type: string };

type Bio = {
  id: string;
  company_name: string;
  tone_of_voice: string | null;
  ideal_message_examples: VoiceExample[] | null;
};

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

export default function VoiceEditorClient({ bio }: { bio: Bio }) {
  const router = useRouter();
  const [tone, setTone] = useState(bio.tone_of_voice ?? "");
  const [examples, setExamples] = useState<VoiceExample[]>(bio.ideal_message_examples ?? []);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  function addExample() {
    setExamples(arr => [...arr, { body: "", step_type: "LINKEDIN_INTRO_DM" }]);
  }
  function updateExample(i: number, patch: Partial<VoiceExample>) {
    setExamples(arr => arr.map((e, idx) => idx === i ? { ...e, ...patch } : e));
  }
  function removeExample(i: number) {
    setExamples(arr => arr.filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaving(true);
    try {
      const cleaned = examples
        .map(e => ({ body: e.body.trim(), step_type: e.step_type }))
        .filter(e => e.body);
      const res = await fetch(`/api/admin/company-bios/${bio.id}/voice`, {
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
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <Link href={`/admin/${bio.id}`}
        className="inline-flex items-center gap-1 text-xs font-medium mb-4 hover:underline"
        style={{ color: C.textMuted }}>
        <ArrowLeft size={12} /> Back to {bio.company_name}
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <MessageCircle size={20} style={{ color: gold }} />
            <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>Brand Voice</h1>
          </div>
          <p className="text-sm" style={{ color: C.textMuted }}>
            Tone description + ideal message examples. Fed as few-shot to the AI message generator for {bio.company_name}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {savedAt && (
            <span className="text-xs" style={{ color: C.green }}>
              Saved {savedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ backgroundColor: gold, color: "#fff" }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      {/* Tone of voice */}
      <div className="rounded-xl border p-5 mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wider mb-2 block" style={{ color: C.textMuted }}>
            Tone of voice
          </span>
          <textarea
            value={tone}
            onChange={e => setTone(e.target.value)}
            placeholder="e.g. 'Professional but warm. Plain English, no jargon. Confident without being pushy. Short sentences.'"
            rows={3}
            className="w-full text-sm px-3 py-2 rounded-lg border resize-y"
            style={{ borderColor: C.border, backgroundColor: C.bg }}
          />
        </label>
        <p className="text-[10px] mt-1" style={{ color: C.textMuted }}>
          A short description of the brand voice. The AI uses this as the writing style guide for every generated message.
        </p>
      </div>

      {/* Examples */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
          Ideal message examples ({examples.length})
        </span>
        <button onClick={addExample}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
          style={{ backgroundColor: C.goldGlow, color: gold }}>
          <Plus size={12} /> Add Example
        </button>
      </div>

      {examples.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <MessageCircle size={28} className="mx-auto mb-3" style={{ color: C.textDim }} />
          <p className="text-sm font-medium mb-1" style={{ color: C.textBody }}>No examples yet</p>
          <p className="text-xs" style={{ color: C.textMuted }}>
            Add a few proven outreach messages — the AI will mirror their voice when generating new campaigns.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {examples.map((ex, i) => (
            <div key={i} className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <select value={ex.step_type} onChange={e => updateExample(i, { step_type: e.target.value })}
                  className="text-xs px-3 py-1.5 rounded-lg border outline-none"
                  style={{ backgroundColor: C.bg, borderColor: C.border, color: C.textBody }}>
                  {STEP_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <button onClick={() => removeExample(i)} className="p-1.5 rounded hover:bg-red-50" title="Remove">
                  <Trash2 size={12} style={{ color: "#DC2626" }} />
                </button>
              </div>
              <textarea
                value={ex.body}
                onChange={e => updateExample(i, { body: e.target.value })}
                placeholder='Use {{first_name}}, {{role}}, {{company}}, {{seller_name}} and any enrichment placeholders.'
                rows={5}
                className="w-full text-sm px-3 py-2 rounded-lg border resize-y font-mono"
                style={{ borderColor: C.border, backgroundColor: C.bg }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
