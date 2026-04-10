"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import {
  ArrowLeft, ArrowRight, Check, Share2, Mail, Phone, MessageCircle,
  Loader2, Sparkles, Pencil, Send, Megaphone, Plus, Trash2, GripVertical,
} from "lucide-react";

const gold = C.gold;
const goldLight = C.goldGlow;

type SequenceStep = { channel: string; daysAfter: number };
type Message = { step: number; channel: string; subject: string | null; body: string };

const channelOptions = [
  { key: "linkedin", label: "LinkedIn", icon: Share2, color: C.linkedin, short: "LI" },
  { key: "email",    label: "Email",    icon: Mail,   color: C.email,    short: "EM" },
  { key: "call",     label: "Call",     icon: Phone,  color: C.phone,    short: "CA" },
];

const sequenceTemplates = [
  {
    name: "LinkedIn Only",
    desc: "3-step LinkedIn sequence",
    steps: [
      { channel: "linkedin", daysAfter: 0 },
      { channel: "linkedin", daysAfter: 3 },
      { channel: "linkedin", daysAfter: 5 },
    ],
  },
  {
    name: "LinkedIn + Email",
    desc: "Alternate between LinkedIn and Email",
    steps: [
      { channel: "linkedin", daysAfter: 0 },
      { channel: "email", daysAfter: 2 },
      { channel: "linkedin", daysAfter: 3 },
      { channel: "email", daysAfter: 3 },
      { channel: "linkedin", daysAfter: 5 },
    ],
  },
  {
    name: "Email Only",
    desc: "4-step email sequence",
    steps: [
      { channel: "email", daysAfter: 0 },
      { channel: "email", daysAfter: 3 },
      { channel: "email", daysAfter: 4 },
      { channel: "email", daysAfter: 5 },
    ],
  },
  {
    name: "Multichannel Aggressive",
    desc: "LinkedIn + Email + Call combo",
    steps: [
      { channel: "linkedin", daysAfter: 0 },
      { channel: "email", daysAfter: 2 },
      { channel: "call", daysAfter: 1 },
      { channel: "linkedin", daysAfter: 3 },
      { channel: "email", daysAfter: 3 },
      { channel: "call", daysAfter: 2 },
      { channel: "linkedin", daysAfter: 5 },
    ],
  },
  {
    name: "LinkedIn + Call",
    desc: "LinkedIn outreach with call follow-ups",
    steps: [
      { channel: "linkedin", daysAfter: 0 },
      { channel: "call", daysAfter: 2 },
      { channel: "linkedin", daysAfter: 3 },
      { channel: "call", daysAfter: 3 },
      { channel: "linkedin", daysAfter: 5 },
    ],
  },
];

const WIZARD_STEPS = ["Sequence", "Messages", "Review"];

export default function NewCampaignWizard() {
  const router = useRouter();
  const params = useParams();
  const profileId = params.profileId as string;

  const [wizardStep, setWizardStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [bio, setBio] = useState<any>(null);
  const [leadsCount, setLeadsCount] = useState(0);

  // Sequence builder
  const [sequence, setSequence] = useState<SequenceStep[]>([
    { channel: "linkedin", daysAfter: 0 },
    { channel: "email", daysAfter: 3 },
    { channel: "linkedin", daysAfter: 3 },
  ]);

  // Messages
  const [messages, setMessages] = useState<Message[]>([]);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      const [{ data: p }, { data: b }, { count }] = await Promise.all([
        supabase.from("icp_profiles").select("*").eq("id", profileId).single(),
        supabase.from("company_bios").select("*").order("created_at", { ascending: false }).limit(1).single(),
        supabase.from("leads").select("*", { count: "exact", head: true }).eq("icp_profile_id", profileId),
      ]);
      setProfile(p);
      setBio(b);
      setLeadsCount(count ?? 0);
      setLoading(false);
    }
    load();
  }, [profileId]);

  // Sequence helpers
  function addStep() {
    const lastChannel = sequence.length > 0 ? sequence[sequence.length - 1].channel : "linkedin";
    const nextChannel = channelOptions.find(c => c.key !== lastChannel)?.key ?? lastChannel;
    setSequence(s => [...s, { channel: nextChannel, daysAfter: 3 }]);
  }

  function removeStep(idx: number) {
    setSequence(s => s.filter((_, i) => i !== idx));
  }

  function updateStep(idx: number, field: keyof SequenceStep, value: any) {
    setSequence(s => s.map((step, i) => i === idx ? { ...step, [field]: value } : step));
  }

  // Calculate cumulative days
  function cumulativeDays(): number[] {
    let day = 0;
    return sequence.map((s, i) => {
      if (i === 0) { day = s.daysAfter; return s.daysAfter; }
      day += s.daysAfter;
      return day;
    });
  }

  // Generate messages
  async function generateMessages() {
    if (!bio || !profile) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/campaigns/generate-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sequence,
          companyBio: bio,
          icpProfile: profile,
        }),
      });
      const data = await res.json();
      if (data.messages && Array.isArray(data.messages)) {
        const mapped: Message[] = data.messages.map((msg: any, i: number) => ({
          step: msg.step ?? i + 1,
          channel: msg.channel ?? sequence[i]?.channel ?? "linkedin",
          subject: msg.subject ?? null,
          body: msg.body ?? "",
        }));
        setMessages(mapped);
      }
    } catch {
      // silent
    }
    setGenerating(false);
  }

  function updateMessage(idx: number, field: "subject" | "body", value: string) {
    setMessages(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  }

  // Submit
  async function handleSubmit() {
    setSubmitting(true);
    const uniqueChannels = [...new Set(sequence.map(s => s.channel))];
    const { error } = await supabase.from("campaign_requests").insert({
      name: `${profile?.profile_name} — ${uniqueChannels.map(c => channelOptions.find(o => o.key === c)?.label).join(" + ")}`,
      icp_profile_id: profileId,
      channels: uniqueChannels,
      sequence_length: sequence.length,
      frequency_days: 0,
      target_leads_count: leadsCount,
      message_prompts: { sequence, messages },
      status: "pending_review",
    });
    if (!error) {
      router.push("/campaigns?submitted=1");
    }
    setSubmitting(false);
  }

  const days = cumulativeDays();
  const totalDays = days.length > 0 ? days[days.length - 1] : 0;

  if (loading) {
    return <div className="p-8 flex items-center justify-center" style={{ color: C.textMuted }}><Loader2 size={20} className="animate-spin mr-2" /> Loading…</div>;
  }

  return (
    <div className="p-6 w-full">
      {/* Header */}
      <button onClick={() => router.push("/campaigns")} className="flex items-center gap-1.5 text-xs font-medium mb-3 transition-colors hover:opacity-80" style={{ color: C.textMuted }}>
        <ArrowLeft size={13} /> Back to Campaigns
      </button>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>New Campaign</p>
        <h1 className="text-2xl font-bold flex items-center gap-2.5" style={{ color: C.textPrimary }}>
          <Megaphone size={22} style={{ color: gold }} /> Configure Campaign
        </h1>
        <p className="text-sm mt-1" style={{ color: C.textMuted }}>
          {profile?.profile_name} — {leadsCount} leads
        </p>
      </div>

      <div className="h-px mb-6" style={{ background: `linear-gradient(90deg, ${gold} 0%, rgba(201,168,58,0.15) 40%, transparent 100%)` }} />

      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-8">
        {WIZARD_STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <button onClick={() => i < wizardStep && setWizardStep(i)} disabled={i > wizardStep}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
              style={i === wizardStep ? { backgroundColor: gold, color: "#04070d" } : i < wizardStep ? { backgroundColor: C.greenLight, color: C.green } : { backgroundColor: "#F3F4F6", color: C.textDim }}>
              {i < wizardStep ? <Check size={12} /> : <span>{i + 1}</span>}
              {s}
            </button>
            {i < WIZARD_STEPS.length - 1 && <div className="w-6 h-px" style={{ backgroundColor: C.border }} />}
          </div>
        ))}
      </div>

      {/* ═══ STEP 0: SEQUENCE BUILDER ═══ */}
      {wizardStep === 0 && (
        <div className="space-y-5">
          {/* Templates */}
          <div className="rounded-xl border p-5 mb-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: C.textMuted }}>Start from a template</p>
            <div className="flex gap-2 flex-wrap">
              {sequenceTemplates.map(tpl => (
                <button key={tpl.name}
                  onClick={() => { setSequence(tpl.steps.map(s => ({ ...s }))); setMessages([]); }}
                  className="rounded-lg border px-4 py-2.5 text-left transition-all hover:shadow-sm"
                  style={{ borderColor: C.border, backgroundColor: C.bg }}>
                  <p className="text-xs font-semibold" style={{ color: C.textPrimary }}>{tpl.name}</p>
                  <p className="text-xs" style={{ color: C.textDim }}>{tpl.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Build Your Sequence</h2>
                <p className="text-xs mt-0.5" style={{ color: C.textDim }}>Define the channel and timing for each step. Pick a template above or customize freely.</p>
              </div>
              <div className="text-right">
                <p className="text-xs" style={{ color: C.textMuted }}>{sequence.length} steps · ~{totalDays} days</p>
              </div>
            </div>

            {/* Steps */}
            <div className="space-y-2">
              {sequence.map((s, i) => {
                const ch = channelOptions.find(c => c.key === s.channel)!;
                const Icon = ch.icon;
                return (
                  <div key={i} className="flex items-center gap-3 rounded-lg border px-4 py-3"
                    style={{ borderColor: C.border, backgroundColor: i === 0 ? `${ch.color}06` : "transparent" }}>

                    {/* Step number */}
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ backgroundColor: `${ch.color}15`, color: ch.color }}>
                      {i + 1}
                    </div>

                    {/* Channel select */}
                    <div className="flex items-center gap-2">
                      {channelOptions.map(opt => {
                        const OptIcon = opt.icon;
                        const selected = s.channel === opt.key;
                        return (
                          <button key={opt.key} onClick={() => updateStep(i, "channel", opt.key)}
                            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
                            style={selected
                              ? { backgroundColor: opt.color, color: "#fff" }
                              : { backgroundColor: "#F3F4F6", color: C.textMuted }
                            }>
                            <OptIcon size={12} />
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Days after */}
                    <div className="flex items-center gap-2 ml-auto">
                      {i === 0 ? (
                        <span className="text-xs font-medium px-3 py-1.5 rounded-lg" style={{ backgroundColor: C.greenLight, color: C.green }}>
                          Day 0 — Immediate
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs" style={{ color: C.textMuted }}>Wait</span>
                          <select className="rounded-lg border px-2 py-1.5 text-xs font-medium focus:outline-none"
                            style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg, minWidth: 65 }}
                            value={s.daysAfter} onChange={e => updateStep(i, "daysAfter", Number(e.target.value))}>
                            {[1, 2, 3, 4, 5, 7, 10, 14, 21].map(d => (
                              <option key={d} value={d}>{d} {d === 1 ? "day" : "days"}</option>
                            ))}
                          </select>
                          <span className="text-xs tabular-nums" style={{ color: C.textDim }}>
                            (Day {days[i]})
                          </span>
                        </div>
                      )}

                      {/* Remove */}
                      {sequence.length > 1 && (
                        <button onClick={() => removeStep(i)} className="ml-2 opacity-30 hover:opacity-100 transition-opacity"
                          style={{ color: C.red }}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add step */}
            <button onClick={addStep}
              className="flex items-center gap-2 mt-3 rounded-lg px-4 py-2.5 text-xs font-medium w-full justify-center transition-opacity hover:opacity-80 border border-dashed"
              style={{ borderColor: C.border, color: C.textMuted }}>
              <Plus size={14} /> Add Step
            </button>
          </div>

          {/* Timeline preview */}
          <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Timeline Preview</p>
            <div className="relative">
              {/* Line */}
              <div className="absolute left-3 top-3 bottom-3 w-0.5" style={{ backgroundColor: C.border }} />

              <div className="space-y-4">
                {sequence.map((s, i) => {
                  const ch = channelOptions.find(c => c.key === s.channel)!;
                  const Icon = ch.icon;
                  return (
                    <div key={i} className="flex items-center gap-4 relative">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 z-10"
                        style={{ backgroundColor: ch.color }}>
                        <Icon size={12} color="#fff" />
                      </div>
                      <div className="flex-1 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium" style={{ color: C.textPrimary }}>
                            {ch.label} — Step {i + 1}
                          </p>
                          <p className="text-xs" style={{ color: C.textMuted }}>
                            {i === 0 ? "Sent immediately" : `${s.daysAfter} days after previous step`}
                          </p>
                        </div>
                        <span className="text-xs font-bold tabular-nums px-2.5 py-1 rounded-full"
                          style={{ backgroundColor: `${ch.color}12`, color: ch.color }}>
                          Day {days[i]}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="text-xs mt-4 pt-3 border-t" style={{ borderColor: C.border, color: C.textMuted }}>
              {leadsCount} leads · {sequence.length} steps · {totalDays} day campaign · {[...new Set(sequence.map(s => s.channel))].length} channels
            </p>
          </div>
        </div>
      )}

      {/* ═══ STEP 1: MESSAGES ═══ */}
      {wizardStep === 1 && (() => {
        // Ensure messages array matches sequence length
        const msgs = sequence.map((s, i) => messages[i] ?? {
          step: i + 1,
          channel: s.channel,
          subject: s.channel === "email" ? "" : null,
          body: "",
        });
        if (msgs.length !== messages.length) setMessages(msgs);

        return (
          <div className="space-y-5">
            {/* AI generate button */}
            <div className="flex items-center justify-between rounded-xl border px-5 py-4"
              style={{ backgroundColor: C.card, borderColor: C.border }}>
              <div className="flex items-center gap-3">
                <Sparkles size={18} style={{ color: gold }} />
                <div>
                  <p className="text-sm font-medium" style={{ color: C.textPrimary }}>AI Message Assistant</p>
                  <p className="text-xs" style={{ color: C.textMuted }}>Auto-fill all messages based on your Company Bio and Lead Gen profile</p>
                </div>
              </div>
              <button onClick={generateMessages} disabled={generating}
                className="flex items-center gap-2 rounded-lg px-5 py-2 text-xs font-semibold transition-opacity shrink-0"
                style={{ backgroundColor: gold, color: "#04070d" }}>
                {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                {generating ? "Generating…" : msgs.some(m => m.body) ? "Regenerate All" : "Generate All"}
              </button>
            </div>

            {/* Message editors */}
            {msgs.map((msg, i) => {
              const ch = channelOptions.find(c => c.key === msg.channel)!;
              const Icon = ch.icon;
              return (
                <div key={i} className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
                  <div className="px-5 py-3 flex items-center gap-3 border-b" style={{ borderColor: C.border, background: `${ch.color}06` }}>
                    <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: ch.color }}>
                      <Icon size={12} color="#fff" />
                    </div>
                    <span className="text-sm font-semibold" style={{ color: C.textPrimary }}>
                      Step {i + 1} — {ch.label}
                    </span>
                    <span className="text-xs ml-auto" style={{ color: C.textDim }}>Day {days[i]}</span>
                  </div>
                  <div className="px-5 py-4 space-y-3">
                    {msg.subject !== null && (
                      <div>
                        <label className="block text-xs font-medium mb-1" style={{ color: C.textMuted }}>Subject</label>
                        <input className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                          style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                          value={msg.subject ?? ""}
                          placeholder="Email subject line…"
                          onChange={e => updateMessage(i, "subject", e.target.value)} />
                      </div>
                    )}
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: C.textMuted }}>Message</label>
                      <textarea
                        rows={msg.channel === "email" ? 6 : msg.channel === "call" ? 4 : 3}
                        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
                        style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                        value={msg.body}
                        placeholder={msg.channel === "call" ? "Call script / talking points…" : "Write your message here…"}
                        onChange={e => updateMessage(i, "body", e.target.value)} />
                    </div>
                    <p className="text-xs" style={{ color: C.textDim }}>
                      Variables: {"{{first_name}}, {{last_name}}, {{company}}, {{role}}"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ═══ STEP 2: REVIEW ═══ */}
      {wizardStep === 2 && (
        <div className="space-y-5">
          <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-5" style={{ color: C.textMuted }}>Campaign Summary</h2>

            <div className="grid grid-cols-3 gap-4 mb-5">
              <div className="rounded-lg border p-4" style={{ borderColor: C.border }}>
                <p className="text-xs font-medium mb-1" style={{ color: C.textMuted }}>Profile</p>
                <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{profile?.profile_name}</p>
              </div>
              <div className="rounded-lg border p-4" style={{ borderColor: C.border }}>
                <p className="text-xs font-medium mb-1" style={{ color: C.textMuted }}>Leads</p>
                <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{leadsCount} prospects</p>
              </div>
              <div className="rounded-lg border p-4" style={{ borderColor: C.border }}>
                <p className="text-xs font-medium mb-1" style={{ color: C.textMuted }}>Duration</p>
                <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{sequence.length} steps · {totalDays} days</p>
              </div>
            </div>

            {/* Sequence summary */}
            <div className="space-y-1.5 mb-5">
              {sequence.map((s, i) => {
                const ch = channelOptions.find(c => c.key === s.channel)!;
                const Icon = ch.icon;
                const msg = messages[i];
                return (
                  <div key={i} className="flex items-center gap-3 rounded-lg px-4 py-2.5" style={{ backgroundColor: C.bg }}>
                    <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: ch.color }}>
                      <Icon size={10} color="#fff" />
                    </div>
                    <span className="text-xs font-semibold w-14 shrink-0" style={{ color: ch.color }}>Day {days[i]}</span>
                    <span className="text-xs font-medium" style={{ color: C.textPrimary }}>{ch.label}</span>
                    <span className="text-xs truncate flex-1" style={{ color: C.textMuted }}>
                      {msg?.body?.slice(0, 60)}…
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="rounded-lg border p-4" style={{ borderColor: C.border, backgroundColor: C.yellowLight }}>
              <p className="text-sm font-medium" style={{ color: C.textPrimary }}>Review required</p>
              <p className="text-xs mt-0.5" style={{ color: C.textBody }}>
                After launching, the SWL team will review your campaign before it starts sending. You'll be notified when it's approved.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ═══ NAVIGATION ═══ */}
      <div className="flex items-center justify-between mt-8 pt-6 border-t" style={{ borderColor: C.border }}>
        <button onClick={() => wizardStep === 0 ? router.push("/campaigns") : setWizardStep(s => s - 1)}
          className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity"
          style={{ color: C.textBody, backgroundColor: "#F3F4F6" }}>
          <ArrowLeft size={15} /> {wizardStep === 0 ? "Cancel" : "Previous"}
        </button>

        {wizardStep < WIZARD_STEPS.length - 1 ? (
          <button
            onClick={() => setWizardStep(s => s + 1)}
            disabled={wizardStep === 0 && sequence.length === 0}
            className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{ backgroundColor: gold, color: "#04070d" }}>
            Next <ArrowRight size={15} />
          </button>
        ) : (
          <button onClick={handleSubmit} disabled={submitting || messages.length === 0}
            className="flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ backgroundColor: C.green, color: "#fff" }}>
            {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {submitting ? "Submitting…" : "Launch Campaign"}
          </button>
        )}
      </div>
    </div>
  );
}
