"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import {
  ArrowLeft, ArrowRight, Check, Share2, Mail, Phone,
  Loader2, Send, Megaphone, Plus, Trash2, User, Globe,
} from "lucide-react";
import ChannelMessageConfig, { type ChannelMessages } from "@/components/ChannelMessageConfig";

const gold = C.gold;

type SequenceStep = { channel: string; daysAfter: number };

const languageOptions = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
];

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

export default function NewLeadCampaignWizard() {
  const router = useRouter();
  const params = useParams();
  const leadId = params.leadId as string;

  const [wizardStep, setWizardStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [lead, setLead] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [bio, setBio] = useState<any>(null);

  // Sequence builder
  const [sequence, setSequence] = useState<SequenceStep[]>([
    { channel: "linkedin", daysAfter: 0 },
    { channel: "email", daysAfter: 3 },
    { channel: "linkedin", daysAfter: 3 },
  ]);

  // Channel messages (structured per-channel config)
  const [channelMessages, setChannelMessages] = useState<ChannelMessages>({ steps: [], autoReplies: { positive: "", negative: "", question: "" } });
  const [submitting, setSubmitting] = useState(false);
  const [language, setLanguage] = useState("es");

  useEffect(() => {
    async function load() {
      const { data: leadData } = await supabase
        .from("leads")
        .select("*")
        .eq("id", leadId)
        .single();

      if (!leadData) { setLoading(false); return; }
      setLead(leadData);

      const [{ data: profileData }, { data: bioData }] = await Promise.all([
        leadData.icp_profile_id
          ? supabase.from("icp_profiles").select("*").eq("id", leadData.icp_profile_id).single()
          : { data: null },
        leadData.company_bio_id
          ? supabase.from("company_bios").select("*").eq("id", leadData.company_bio_id).single()
          : supabase.from("company_bios").select("*").order("created_at", { ascending: false }).limit(1).single(),
      ]);

      setProfile(profileData);
      setBio(bioData);
      setLoading(false);
    }
    load();
  }, [leadId]);

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

  function cumulativeDays(): number[] {
    let day = 0;
    return sequence.map((s, i) => {
      if (i === 0) { day = s.daysAfter; return s.daysAfter; }
      day += s.daysAfter;
      return day;
    });
  }

  // Submit
  async function handleSubmit() {
    setSubmitting(true);
    const uniqueChannels = [...new Set(sequence.map(s => s.channel))];
    const leadName = `${lead?.primary_first_name ?? ""} ${lead?.primary_last_name ?? ""}`.trim();
    const { error } = await supabase.from("campaign_requests").insert({
      name: `${leadName} @ ${lead?.company_name ?? "Unknown"} — ${uniqueChannels.map(c => channelOptions.find(o => o.key === c)?.label).join(" + ")}`,
      icp_profile_id: lead?.icp_profile_id ?? null,
      lead_id: leadId,
      channels: uniqueChannels,
      sequence_length: sequence.length,
      frequency_days: 0,
      target_leads_count: 1,
      message_prompts: { sequence, channelMessages, language },
      status: "pending_review",
    });
    if (!error) {
      router.push("/campaigns?submitted=1");
    }
    setSubmitting(false);
  }

  const days = cumulativeDays();
  const totalDays = days.length > 0 ? days[days.length - 1] : 0;
  const leadName = lead ? `${lead.primary_first_name ?? ""} ${lead.primary_last_name ?? ""}`.trim() : "";
  const uniqueChannels = [...new Set(sequence.map(s => s.channel))];

  if (loading) {
    return <div className="p-8 flex items-center justify-center" style={{ color: C.textMuted }}><Loader2 size={20} className="animate-spin mr-2" /> Loading...</div>;
  }

  if (!lead) {
    return <div className="p-8 text-center" style={{ color: C.textMuted }}>Lead not found</div>;
  }

  return (
    <div className="p-6 w-full">
      {/* Header */}
      <button onClick={() => router.back()} className="flex items-center gap-1.5 text-xs font-medium mb-3 transition-colors hover:opacity-80" style={{ color: C.textMuted }}>
        <ArrowLeft size={13} /> Back
      </button>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>Individual Campaign</p>
        <h1 className="text-2xl font-bold flex items-center gap-2.5" style={{ color: C.textPrimary }}>
          <Megaphone size={22} style={{ color: gold }} /> Campaign for {leadName}
        </h1>
        <p className="text-sm mt-1" style={{ color: C.textMuted }}>
          {lead.primary_title_role ? `${lead.primary_title_role} at ` : ""}{lead.company_name ?? "Unknown Company"}
          {profile ? ` — ${profile.profile_name}` : ""}
        </p>
      </div>

      <div className="h-px mb-6" style={{ background: `linear-gradient(90deg, ${gold} 0%, rgba(201,168,58,0.15) 40%, transparent 100%)` }} />

      {/* Lead context card */}
      <div className="rounded-xl border p-5 mb-6 flex items-center gap-4" style={{ backgroundColor: C.card, borderColor: C.border, borderLeft: `3px solid ${gold}` }}>
        <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
          style={{ background: `linear-gradient(135deg, ${gold}, #e8c84a)`, color: "#fff" }}>
          <User size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{leadName}</p>
          <p className="text-xs" style={{ color: C.textMuted }}>
            {[lead.primary_title_role, lead.company_name, lead.company_industry].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs shrink-0" style={{ color: C.textMuted }}>
          {lead.primary_linkedin_url && (
            <span className="flex items-center gap-1" style={{ color: C.linkedin }}><Share2 size={11} /> LinkedIn</span>
          )}
          {lead.primary_work_email && (
            <span className="flex items-center gap-1" style={{ color: C.email }}><Mail size={11} /> Email</span>
          )}
          {lead.primary_phone && (
            <span className="flex items-center gap-1" style={{ color: C.phone }}><Phone size={11} /> Phone</span>
          )}
        </div>
      </div>

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
                  onClick={() => { setSequence(tpl.steps.map(s => ({ ...s }))); setChannelMessages({ steps: [], autoReplies: { positive: "", negative: "", question: "" } }); }}
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
                <p className="text-xs mt-0.5" style={{ color: C.textDim }}>Define the channel and timing for each step.</p>
              </div>
              <p className="text-xs" style={{ color: C.textMuted }}>{sequence.length} steps · ~{totalDays} days</p>
            </div>

            <div className="space-y-2">
              {sequence.map((s, i) => {
                const ch = channelOptions.find(c => c.key === s.channel)!;
                return (
                  <div key={i} className="flex items-center gap-3 rounded-lg border px-4 py-3"
                    style={{ borderColor: C.border, backgroundColor: i === 0 ? `${ch.color}06` : "transparent" }}>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ backgroundColor: `${ch.color}15`, color: ch.color }}>{i + 1}</div>
                    <div className="flex items-center gap-2">
                      {channelOptions.map(opt => {
                        const OptIcon = opt.icon;
                        return (
                          <button key={opt.key} onClick={() => updateStep(i, "channel", opt.key)}
                            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
                            style={s.channel === opt.key ? { backgroundColor: opt.color, color: "#fff" } : { backgroundColor: "#F3F4F6", color: C.textMuted }}>
                            <OptIcon size={12} /> {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2 ml-auto">
                      {i === 0 ? (
                        <span className="text-xs font-medium px-3 py-1.5 rounded-lg" style={{ backgroundColor: C.greenLight, color: C.green }}>Day 0 — Immediate</span>
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
                          <span className="text-xs tabular-nums" style={{ color: C.textDim }}>(Day {days[i]})</span>
                        </div>
                      )}
                      {sequence.length > 1 && (
                        <button onClick={() => removeStep(i)} className="ml-2 opacity-30 hover:opacity-100 transition-opacity" style={{ color: C.red }}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

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
              <div className="absolute left-3 top-3 bottom-3 w-0.5" style={{ backgroundColor: C.border }} />
              <div className="space-y-4">
                {sequence.map((s, i) => {
                  const ch = channelOptions.find(c => c.key === s.channel)!;
                  const Icon = ch.icon;
                  return (
                    <div key={i} className="flex items-center gap-4 relative">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 z-10" style={{ backgroundColor: ch.color }}>
                        <Icon size={12} color="#fff" />
                      </div>
                      <div className="flex-1 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium" style={{ color: C.textPrimary }}>{ch.label} — Step {i + 1}</p>
                          <p className="text-xs" style={{ color: C.textMuted }}>{i === 0 ? "Sent immediately" : `${s.daysAfter} days after previous step`}</p>
                        </div>
                        <span className="text-xs font-bold tabular-nums px-2.5 py-1 rounded-full"
                          style={{ backgroundColor: `${ch.color}12`, color: ch.color }}>Day {days[i]}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="text-xs mt-4 pt-3 border-t" style={{ borderColor: C.border, color: C.textMuted }}>
              1 lead · {sequence.length} steps · {totalDays} day campaign · {uniqueChannels.length} channels
            </p>
          </div>
        </div>
      )}

      {/* ═══ STEP 1: CHANNEL MESSAGE CONFIG ═══ */}
      {wizardStep === 1 && (
        <div className="space-y-5">
          {/* Language selector */}
          <div className="rounded-xl border px-5 py-3 flex items-center gap-3" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <Globe size={13} style={{ color: C.textMuted }} />
            <span className="text-xs font-medium" style={{ color: C.textMuted }}>Language:</span>
            <select value={language} onChange={e => setLanguage(e.target.value)}
              className="rounded-lg border px-2.5 py-1 text-xs font-medium focus:outline-none"
              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}>
              {languageOptions.map(l => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
            <span className="text-xs flex-1 text-right" style={{ color: C.textDim }}>
              Configure messages per channel. Use AI to generate or write manually.
            </span>
          </div>

          <ChannelMessageConfig
            channelMessages={channelMessages}
            onChange={setChannelMessages}
            sequence={sequence}
            leadId={leadId}
            language={language}
          />
        </div>
      )}

      {/* ═══ STEP 2: REVIEW ═══ */}
      {wizardStep === 2 && (
        <div className="space-y-5">
          <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-5" style={{ color: C.textMuted }}>Campaign Summary</h2>

            <div className="grid grid-cols-3 gap-4 mb-5">
              <div className="rounded-lg border p-4" style={{ borderColor: C.border }}>
                <p className="text-xs font-medium mb-1" style={{ color: C.textMuted }}>Lead</p>
                <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{leadName}</p>
                <p className="text-xs" style={{ color: C.textDim }}>{lead.company_name}</p>
              </div>
              <div className="rounded-lg border p-4" style={{ borderColor: C.border }}>
                <p className="text-xs font-medium mb-1" style={{ color: C.textMuted }}>Channels</p>
                <div className="flex gap-1.5 flex-wrap">
                  {uniqueChannels.map(ch => {
                    const conf = channelOptions.find(c => c.key === ch)!;
                    const Icon = conf.icon;
                    return (
                      <span key={ch} className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md"
                        style={{ backgroundColor: `${conf.color}12`, color: conf.color }}>
                        <Icon size={10} /> {conf.label}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-lg border p-4" style={{ borderColor: C.border }}>
                <p className="text-xs font-medium mb-1" style={{ color: C.textMuted }}>Duration</p>
                <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{sequence.length} steps · {totalDays} days</p>
              </div>
            </div>

            {/* Messages preview per channel */}
            {uniqueChannels.map(ch => {
              const conf = channelOptions.find(c => c.key === ch)!;
              const Icon = conf.icon;
              const msgs = channelMessages[ch as keyof ChannelMessages];
              if (!msgs) return null;

              return (
                <div key={ch} className="rounded-lg border p-4 mb-3" style={{ borderColor: C.border }}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center" style={{ backgroundColor: conf.color }}>
                      <Icon size={10} color="#fff" />
                    </div>
                    <span className="text-xs font-semibold" style={{ color: conf.color }}>{conf.label}</span>
                  </div>
                  {ch === "linkedin" && (msgs as any).connectionNote && (
                    <div className="mb-2">
                      <p className="text-xs font-medium" style={{ color: C.textMuted }}>Connection Note</p>
                      <p className="text-xs mt-0.5 truncate" style={{ color: C.textBody }}>{(msgs as any).connectionNote.slice(0, 100)}...</p>
                    </div>
                  )}
                  {ch === "linkedin" && (msgs as any).introDM && (
                    <div className="mb-2">
                      <p className="text-xs font-medium" style={{ color: C.textMuted }}>Intro DM</p>
                      <p className="text-xs mt-0.5 truncate" style={{ color: C.textBody }}>{(msgs as any).introDM.slice(0, 100)}...</p>
                    </div>
                  )}
                  {ch === "email" && (msgs as any).introSubject && (
                    <div className="mb-2">
                      <p className="text-xs font-medium" style={{ color: C.textMuted }}>Intro Email</p>
                      <p className="text-xs mt-0.5" style={{ color: C.textBody }}>Subject: {(msgs as any).introSubject}</p>
                    </div>
                  )}
                  {ch === "call" && (msgs as any).script && (
                    <div>
                      <p className="text-xs font-medium" style={{ color: C.textMuted }}>Call Script</p>
                      <p className="text-xs mt-0.5 truncate" style={{ color: C.textBody }}>{(msgs as any).script.slice(0, 100)}...</p>
                    </div>
                  )}
                </div>
              );
            })}

            <div className="rounded-lg border p-4" style={{ borderColor: C.border, backgroundColor: C.yellowLight }}>
              <p className="text-sm font-medium" style={{ color: C.textPrimary }}>Review required</p>
              <p className="text-xs mt-0.5" style={{ color: C.textBody }}>
                After launching, the SWL team will review your campaign before it starts sending.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ═══ NAVIGATION ═══ */}
      <div className="flex items-center justify-between mt-8 pt-6 border-t" style={{ borderColor: C.border }}>
        <button onClick={() => wizardStep === 0 ? router.back() : setWizardStep(s => s - 1)}
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
          <button onClick={handleSubmit} disabled={submitting}
            className="flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ backgroundColor: C.green, color: "#fff" }}>
            {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            {submitting ? "Submitting..." : "Launch Campaign"}
          </button>
        )}
      </div>
    </div>
  );
}
