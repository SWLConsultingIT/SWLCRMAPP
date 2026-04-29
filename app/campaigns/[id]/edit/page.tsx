"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { C } from "@/lib/design";
import Link from "next/link";
import {
  ArrowLeft, Save, Loader2, Plus, Trash2, GripVertical,
  ChevronUp, ChevronDown, Share2, Mail, Phone, MessageCircle,
  User, Settings, AlertCircle, CheckCircle,
} from "lucide-react";
import { LinkedInIcon, EmailIcon, PhoneIcon, WhatsAppIcon } from "@/components/SocialIcons";
import MessageAttachments, { type Attachment } from "@/components/MessageAttachments";

const gold = C.gold;

type SequenceStep = {
  channel: string;
  action: string;
  type?: string;
  wait_days: number;
};

type Seller = {
  id: string;
  name: string;
  email_account: string | null;
  linkedin_account_id: string | null;
  whatsapp_account: string | null;
};

type InstantlyAccount = {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
};

const channelConfig: Record<string, { label: string; color: string; svgIcon: React.FC<{ size?: number }>; actions: string[] }> = {
  linkedin: {
    label: "LinkedIn", color: "#0A66C2", svgIcon: LinkedInIcon,
    actions: ["Send Request", "Send DM"],
  },
  email: {
    label: "Email", color: "#7C3AED", svgIcon: EmailIcon,
    actions: ["Send Email"],
  },
  call: {
    label: "Call", color: "#F97316", svgIcon: PhoneIcon,
    actions: ["Call"],
  },
  whatsapp: {
    label: "WhatsApp", color: "#25D366", svgIcon: WhatsAppIcon,
    actions: ["Send Message"],
  },
};

export default function FlowEditorPage() {
  const router = useRouter();
  const params = useParams();
  const campaignId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Flow data
  const [flowName, setFlowName] = useState("");
  const [flowManagerId, setFlowManagerId] = useState<string | null>(null);
  const [steps, setSteps] = useState<SequenceStep[]>([]);
  const [emailAccount, setEmailAccount] = useState("");
  const [linkedinProfiles, setLinkedinProfiles] = useState<string[]>([]);
  const [callAssignees, setCallAssignees] = useState<string[]>([]);

  // Messages per step (step_number -> content)
  const [messages, setMessages] = useState<Record<number, { id: string; content: string; subject?: string }>>({});
  // Attachments per step (step_number -> attachments array)
  const [attachments, setAttachments] = useState<Record<number, Attachment[]>>({});

  // Reference data
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [emailAccounts, setEmailAccounts] = useState<InstantlyAccount[]>([]);
  const [originalName, setOriginalName] = useState("");
  // Lead's allowed channels
  const [allowedChannels, setAllowedChannels] = useState<Set<string>>(new Set(["linkedin", "email", "call", "whatsapp"]));

  // Expanded step for editing
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
  const supabase = getSupabaseBrowser();
      const [{ data: campaign }, { data: sellersList }, { data: emails }, { data: msgs }] = await Promise.all([
        supabase.from("campaigns").select("*, leads(allow_linkedin, allow_email, allow_call, allow_whatsapp), sellers(id, name, email_account, linkedin_account_id, whatsapp_account)").eq("id", campaignId).single(),
        supabase.from("sellers").select("id, name, email_account, linkedin_account_id, whatsapp_account").eq("active", true).order("name"),
        supabase.from("instantly_accounts").select("id, email, name, active").eq("active", true).order("email"),
        supabase.from("campaign_messages").select("id, step_number, channel, content, metadata").eq("campaign_id", campaignId).order("step_number"),
      ]);

      if (campaign) {
        // Build allowed channels set from lead flags
        const lead = campaign.leads;
        if (lead) {
          const allowed = new Set<string>();
          if (lead.allow_linkedin !== false) allowed.add("linkedin");
          if (lead.allow_email    !== false) allowed.add("email");
          if (lead.allow_call     !== false) allowed.add("call");
          if (lead.allow_whatsapp !== false) allowed.add("whatsapp");
          setAllowedChannels(allowed);
        }
        setFlowName(campaign.name ?? "");
        setOriginalName(campaign.name ?? "");
        setFlowManagerId(campaign.seller_id);
        // Normalize sequence_steps: support both { channel, daysAfter } and { channel, action, wait_days } formats
        const rawSteps: any[] = campaign.sequence_steps ?? [];
        let seenLinkedinRequest = false;
        const normalizedSteps = rawSteps.map((s: any) => {
          const channel = s.channel ?? "email";
          const waitDays = s.wait_days ?? s.daysAfter ?? 0;
          let action = s.action;
          if (!action) {
            if (channel === "linkedin") {
              if (!seenLinkedinRequest && waitDays === 0) { action = "Send Request"; seenLinkedinRequest = true; }
              else { action = "Send DM"; }
            } else if (channel === "email") { action = "Send Email"; }
            else if (channel === "call") { action = "Call"; }
            else if (channel === "whatsapp") { action = "Send Message"; }
            else { action = "Send"; }
          }
          if (action === "Send Request") seenLinkedinRequest = true;
          return { channel, action, wait_days: waitDays } as SequenceStep;
        });
        setSteps(normalizedSteps);
        setEmailAccount(campaign.email_account ?? "");
      }

      // Build messages map and attachments map
      const msgMap: Record<number, { id: string; content: string; subject?: string }> = {};
      const attMap: Record<number, Attachment[]> = {};
      (msgs ?? []).forEach(m => {
        const subject = m.metadata?.subject ?? undefined;
        msgMap[m.step_number] = { id: m.id, content: m.content ?? "", subject };
        if (m.metadata?.attachments && Array.isArray(m.metadata.attachments)) {
          attMap[m.step_number] = m.metadata.attachments;
        }
      });
      setMessages(msgMap);
      setAttachments(attMap);

      setSellers(sellersList ?? []);
      setEmailAccounts(emails ?? []);
      setLoading(false);
    }
    load();
  }, [campaignId]);

  function updateStep(index: number, updates: Partial<SequenceStep>) {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, ...updates } : s));
  }

  function updateMessage(stepNum: number, field: "content" | "subject", value: string) {
    setMessages(prev => ({
      ...prev,
      [stepNum]: { ...prev[stepNum], id: prev[stepNum]?.id ?? "", [field]: value },
    }));
  }

  function removeStep(index: number) {
    setSteps(prev => prev.filter((_, i) => i !== index));
    if (expandedStep === index) setExpandedStep(null);
    else if (expandedStep !== null && expandedStep > index) setExpandedStep(expandedStep - 1);
  }

  function hasLinkedinRequest(stepList: SequenceStep[]) {
    return stepList.some(s => s.channel === "linkedin" && s.action === "Send Request");
  }

  function addStep() {
    // Pick first allowed channel (prefer email, then linkedin, then whatever is available)
    const preferred = ["email", "linkedin", "call", "whatsapp"].find(c => allowedChannels.has(c)) ?? "email";
    const conf = channelConfig[preferred] ?? channelConfig.email;
    const newStep: SequenceStep = { channel: preferred, action: conf.actions[0], wait_days: 3 };
    setSteps(prev => [...prev, newStep]);
    setExpandedStep(steps.length);
  }

  function addLinkedinStep(action: "Send Request" | "Send DM") {
    setSteps(prev => {
      // If adding Send DM and no Send Request exists, auto-insert at position 0
      if (action === "Send DM" && !hasLinkedinRequest(prev)) {
        const requestStep: SequenceStep = { channel: "linkedin", action: "Send Request", wait_days: 0 };
        const dmStep: SequenceStep = { channel: "linkedin", action: "Send DM", wait_days: 3 };
        setExpandedStep(prev.length + 1);
        return [requestStep, ...prev, dmStep];
      }
      // If adding Send Request, insert at position 0 with day 0
      if (action === "Send Request") {
        setExpandedStep(0);
        return [{ channel: "linkedin", action: "Send Request", wait_days: 0 }, ...prev];
      }
      const newStep: SequenceStep = { channel: "linkedin", action, wait_days: 3 };
      setExpandedStep(prev.length);
      return [...prev, newStep];
    });
  }

  function moveStep(from: number, to: number) {
    if (to < 0 || to >= steps.length) return;
    const arr = [...steps];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    setSteps(arr);
    setExpandedStep(to);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    const messagesPayload: Record<number, any> = {};
    for (const [stepNum, msg] of Object.entries(messages)) {
      if (!msg.id) continue;
      const stepAtts = attachments[Number(stepNum)] ?? [];
      messagesPayload[Number(stepNum)] = {
        id: msg.id,
        content: msg.content,
        subject: msg.subject ?? "",
        attachments: stepAtts,
      };
    }

    try {
      const r = await fetch(`/api/campaigns/${campaignId}/edit-flow`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flowName,
          flowManagerId,
          steps,
          emailAccount: emailAccount || null,
          originalName,
          messages: messagesPayload,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "Save failed");
      }
      router.push(`/campaigns/${campaignId}`);
      router.refresh();
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24" style={{ color: C.textMuted }}>
        <Loader2 size={20} className="animate-spin mr-2" /> Loading flow...
      </div>
    );
  }

  const selectedSeller = sellers.find(s => s.id === flowManagerId);

  return (
    <div className="p-6 w-full max-w-4xl mx-auto">
      {/* Back */}
      <Link href="/campaigns" className="flex items-center gap-2 text-sm font-medium mb-6 transition-colors hover:opacity-70 cursor-pointer"
        style={{ color: C.textMuted }}>
        <ArrowLeft size={16} /> Back to Outreach Flow
      </Link>

      {/* Header */}
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: gold }}>Flow Editor</p>
        <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>Edit Sequence</h1>
      </div>

      {/* Success / Error */}
      {saved && (
        <div className="flex items-center gap-2 rounded-xl px-4 py-3 mb-6 text-sm font-medium fade-in"
          style={{ backgroundColor: C.greenLight, color: C.green }}>
          <CheckCircle size={15} /> Changes saved successfully.
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-xl px-4 py-3 mb-6 text-sm font-medium"
          style={{ backgroundColor: C.redLight, color: C.red }}>
          <AlertCircle size={15} /> {error}
        </div>
      )}

      <div className="h-px mb-6" style={{ background: `linear-gradient(90deg, ${gold} 0%, color-mix(in srgb, var(--brand, #c9a83a) 15%, transparent) 40%, transparent 100%)` }} />

      {/* ── Section 1: Flow Name ── */}
      <div className="rounded-xl p-5 mb-5" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: C.textMuted }}>Flow Name</label>
        <input value={flowName} onChange={e => setFlowName(e.target.value)}
          className="w-full rounded-lg px-4 py-3 text-base font-semibold focus:outline-none"
          style={{ color: C.textPrimary, backgroundColor: C.bg, border: `1px solid ${C.border}` }}
          placeholder="E.g.: Crop Nutrition Outbound" />
      </div>

      {/* ── Section 2: Flow Manager + Accounts ── */}
      <div className="rounded-xl p-5 mb-5" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <label className="block text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: C.textMuted }}>Flow Manager & Accounts</label>
        <div className="grid grid-cols-2 gap-4">
          {/* Flow Manager */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Flow Manager</label>
            <div className="relative">
              <select value={flowManagerId ?? ""} onChange={e => setFlowManagerId(e.target.value || null)}
                className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none appearance-none cursor-pointer"
                style={{ color: C.textPrimary, backgroundColor: C.bg, border: `1px solid ${C.border}` }}>
                <option value="">Unassigned</option>
                {sellers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <User size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: C.textDim }} />
            </div>
          </div>

          {/* Email Account */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Email Account</label>
            <div className="relative">
              <select value={emailAccount} onChange={e => setEmailAccount(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none appearance-none cursor-pointer"
                style={{ color: C.textPrimary, backgroundColor: C.bg, border: `1px solid ${C.border}` }}>
                <option value="">Auto-assign</option>
                {emailAccounts.map(a => <option key={a.id} value={a.email}>{a.email}{a.name ? ` (${a.name})` : ""}</option>)}
              </select>
              <Mail size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: C.textDim }} />
            </div>
          </div>

          {/* LinkedIn Profiles — modern multiselect */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>LinkedIn Profiles</label>
            <div className="space-y-2">
              {linkedinProfiles.length === 0 && (
                <div className="flex items-center gap-2.5 rounded-lg px-3.5 py-2.5"
                  style={{ backgroundColor: "#0A66C206", border: `1px dashed #0A66C230` }}>
                  <Share2 size={14} style={{ color: "#0A66C2", opacity: 0.4 }} />
                  <span className="text-xs" style={{ color: C.textDim }}>Auto-assign across all available profiles</span>
                </div>
              )}
              {linkedinProfiles.map(id => {
                const s = sellers.find(x => x.id === id);
                return (
                  <div key={id} className="flex items-center justify-between rounded-lg px-3.5 py-2.5"
                    style={{ backgroundColor: "#0A66C208", border: "1px solid #0A66C220" }}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                        style={{ backgroundColor: "#0A66C215", color: "#0A66C2" }}>
                        {s?.name?.[0] ?? "?"}
                      </div>
                      <div>
                        <p className="text-xs font-semibold" style={{ color: C.textPrimary }}>{s?.name ?? "Unknown"}</p>
                        <p className="text-[10px]" style={{ color: C.textDim }}>{s?.linkedin_account_id ?? ""}</p>
                      </div>
                    </div>
                    <button onClick={() => setLinkedinProfiles(prev => prev.filter(p => p !== id))}
                      className="p-1 rounded cursor-pointer hover:bg-red-50 transition-colors">
                      <Trash2 size={12} style={{ color: C.red }} />
                    </button>
                  </div>
                );
              })}
              {sellers.filter(s => s.linkedin_account_id && !linkedinProfiles.includes(s.id)).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {sellers.filter(s => s.linkedin_account_id && !linkedinProfiles.includes(s.id)).map(s => (
                    <button key={s.id} onClick={() => setLinkedinProfiles(prev => [...prev, s.id])}
                      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium cursor-pointer transition-[opacity,transform,box-shadow,background-color,border-color] hover:shadow-sm"
                      style={{ backgroundColor: C.cardHov, color: C.textMuted, border: `1px solid ${C.border}` }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = "#0A66C2"; e.currentTarget.style.color = "#0A66C2"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMuted; }}>
                      <Plus size={10} /> {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Call Assignment — modern multiselect */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Call Assignment</label>
            <div className="space-y-2">
              {callAssignees.length === 0 && (
                <div className="flex items-center gap-2.5 rounded-lg px-3.5 py-2.5"
                  style={{ backgroundColor: "#F9731606", border: `1px dashed #F9731630` }}>
                  <Phone size={14} style={{ color: "#F97316", opacity: 0.4 }} />
                  <span className="text-xs" style={{ color: C.textDim }}>Auto-assign to Flow Manager</span>
                </div>
              )}
              {callAssignees.map(id => {
                const s = sellers.find(x => x.id === id);
                return (
                  <div key={id} className="flex items-center justify-between rounded-lg px-3.5 py-2.5"
                    style={{ backgroundColor: "#F9731608", border: "1px solid #F9731620" }}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                        style={{ backgroundColor: "#F9731615", color: "#F97316" }}>
                        {s?.name?.[0] ?? "?"}
                      </div>
                      <p className="text-xs font-semibold" style={{ color: C.textPrimary }}>{s?.name ?? "Unknown"}</p>
                    </div>
                    <button onClick={() => setCallAssignees(prev => prev.filter(p => p !== id))}
                      className="p-1 rounded cursor-pointer hover:bg-red-50 transition-colors">
                      <Trash2 size={12} style={{ color: C.red }} />
                    </button>
                  </div>
                );
              })}
              {sellers.filter(s => !callAssignees.includes(s.id)).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {sellers.filter(s => !callAssignees.includes(s.id)).map(s => (
                    <button key={s.id} onClick={() => setCallAssignees(prev => [...prev, s.id])}
                      className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium cursor-pointer transition-[opacity,transform,box-shadow,background-color,border-color] hover:shadow-sm"
                      style={{ backgroundColor: C.cardHov, color: C.textMuted, border: `1px solid ${C.border}` }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = "#F97316"; e.currentTarget.style.color = "#F97316"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMuted; }}>
                      <Plus size={10} /> {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 3: Sequence ── */}
      <div className="rounded-xl p-5" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Sequence Steps</label>
            <p className="text-xs mt-0.5" style={{ color: C.textDim }}>{steps.length} steps · {steps.reduce((sum, s) => sum + s.wait_days, 0)} days total</p>
          </div>
          <button onClick={addStep}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold cursor-pointer transition-opacity hover:opacity-80"
            style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, color: gold, border: `1px solid color-mix(in srgb, ${gold} 19%, transparent)` }}>
            <Plus size={13} /> Add Step
          </button>
        </div>

        {/* Allowed channels badge row */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textDim }}>Lead allows:</span>
          {Object.entries(channelConfig).map(([key, c]) => {
            const ok = allowedChannels.has(key);
            return (
              <span key={key} className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: ok ? `${c.color}12` : C.surface, color: ok ? c.color : C.textDim, opacity: ok ? 1 : 0.5 }}>
                {ok ? <CheckCircle size={9} /> : <AlertCircle size={9} />} {c.label}
              </span>
            );
          })}
        </div>

        <div className="space-y-3">
          {steps.map((step, i) => {
            const conf = channelConfig[step.channel] ?? channelConfig.email;
            const SvgIcon = conf.svgIcon;
            const isExpanded = expandedStep === i;
            const cumulativeDays = steps.slice(0, i).reduce((sum, s) => sum + s.wait_days, 0);

            return (
              <div key={i} className="rounded-lg transition-[opacity,transform,box-shadow,background-color,border-color]" style={{
                border: `1px solid ${isExpanded ? conf.color + "40" : C.border}`,
                backgroundColor: isExpanded ? `${conf.color}04` : "transparent",
              }}>
                {/* Step header — always visible */}
                <div className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                  onClick={() => setExpandedStep(isExpanded ? null : i)}>
                  {/* Drag handle + order controls */}
                  <div className="flex flex-col items-center gap-0.5 shrink-0">
                    <button onClick={e => { e.stopPropagation(); moveStep(i, i - 1); }}
                      className="p-0.5 rounded cursor-pointer hover:bg-gray-100 disabled:opacity-20" disabled={i === 0}>
                      <ChevronUp size={12} style={{ color: C.textDim }} />
                    </button>
                    <GripVertical size={12} style={{ color: C.textDim }} />
                    <button onClick={e => { e.stopPropagation(); moveStep(i, i + 1); }}
                      className="p-0.5 rounded cursor-pointer hover:bg-gray-100 disabled:opacity-20" disabled={i === steps.length - 1}>
                      <ChevronDown size={12} style={{ color: C.textDim }} />
                    </button>
                  </div>

                  {/* Channel icon */}
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: `${conf.color}12` }}>
                    <SvgIcon size={18} />
                  </div>

                  {/* Step info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: gold }}>
                        Step {i + 1} — Day {cumulativeDays}
                      </span>
                    </div>
                    <p className="text-sm font-semibold truncate" style={{ color: C.textPrimary }}>
                      {conf.label} — {step.action}
                    </p>
                  </div>

                  {/* Quick info */}
                  <span className="text-xs shrink-0 px-2 py-0.5 rounded" style={{ backgroundColor: C.surface, color: C.textMuted }}>
                    {step.wait_days === 0 ? "Immediate" : `+${step.wait_days}d`}
                  </span>

                  {/* Delete */}
                  <button onClick={e => { e.stopPropagation(); removeStep(i); }}
                    className="p-1.5 rounded cursor-pointer hover:bg-red-50 transition-colors shrink-0">
                    <Trash2 size={14} style={{ color: C.red }} />
                  </button>
                </div>

                {/* Expanded editor */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 border-t fade-in" style={{ borderColor: `${conf.color}20` }}>
                    <div className="grid grid-cols-3 gap-3">
                      {/* Channel */}
                      <div>
                        <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>Channel</label>
                        <select value={step.channel} onChange={e => {
                          const newCh = e.target.value;
                          if (!allowedChannels.has(newCh)) return;
                          const newConf = channelConfig[newCh] ?? channelConfig.email;
                          const defaultAction = newConf.actions[0];
                          updateStep(i, { channel: newCh, action: defaultAction });
                          if (newCh === "linkedin" && !hasLinkedinRequest(steps)) {
                            const requestStep: SequenceStep = { channel: "linkedin", action: "Send Request", wait_days: 0 };
                            setSteps(prev => [requestStep, ...prev.slice(0, i), { ...prev[i], channel: newCh, action: "Send DM", wait_days: 3 }, ...prev.slice(i + 1)]);
                            setExpandedStep(i + 1);
                            return;
                          }
                          if (newCh === "linkedin" && defaultAction === "Send Request") {
                            updateStep(i, { channel: newCh, action: defaultAction, wait_days: 0 });
                          }
                        }}
                          className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none appearance-none cursor-pointer"
                          style={{ color: C.textPrimary, backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                          {Object.entries(channelConfig).map(([key, c]) => (
                            <option key={key} value={key} disabled={!allowedChannels.has(key)}>
                              {c.label}{!allowedChannels.has(key) ? " (not allowed)" : ""}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Action */}
                      <div>
                        <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>Action</label>
                        <select value={step.action} onChange={e => {
                          const newAction = e.target.value;
                          updateStep(i, { action: newAction });
                          // If selecting Send DM and no Send Request exists anywhere, insert at position 0
                          if (step.channel === "linkedin" && newAction === "Send DM" && !hasLinkedinRequest(steps)) {
                            const requestStep: SequenceStep = { channel: "linkedin", action: "Send Request", wait_days: 0 };
                            setSteps(prev => [requestStep, ...prev.slice(0, i), { ...prev[i], action: "Send DM", wait_days: 3 }, ...prev.slice(i + 1)]);
                            setExpandedStep(i + 1);
                          }
                          // If selecting Send Request, force day 0
                          if (step.channel === "linkedin" && newAction === "Send Request") {
                            updateStep(i, { action: newAction, wait_days: 0 });
                          }
                        }}
                          className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none appearance-none cursor-pointer"
                          style={{ color: C.textPrimary, backgroundColor: C.card, border: `1px solid ${C.border}` }}>
                          {conf.actions.map(a => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </div>

                      {/* Wait days */}
                      <div>
                        <label className="block text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: C.textMuted }}>Wait Time</label>
                        <div className="flex items-center gap-2">
                          <input type="number" min={0} max={30} value={step.wait_days}
                            onChange={e => updateStep(i, { wait_days: parseInt(e.target.value) || 0 })}
                            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                            style={{ color: C.textPrimary, backgroundColor: C.card, border: `1px solid ${C.border}` }} />
                          <span className="text-xs shrink-0" style={{ color: C.textMuted }}>days</span>
                        </div>
                      </div>
                    </div>

                    {/* Message template */}
                    {(() => {
                      // Map step index to message step_number:
                      // "Send Request" → step_number 0 (connection note)
                      // Other steps → offset by 1 if a Send Request exists in the sequence, else direct index
                      const hasConnectionReq = steps.some(s => s.channel === "linkedin" && s.action === "Send Request");
                      const msgKey = step.action === "Send Request" ? 0 : hasConnectionReq ? i + 1 : i;
                      const msg = messages[msgKey];
                      return (
                    <div className="mt-3 pt-3 border-t" style={{ borderColor: `${conf.color}15` }}>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>
                          {step.action === "Send Request" ? "Connection Note" : "Message Template"}
                        </label>
                        {msg?.content ? (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: C.greenLight, color: C.green }}>
                            Has content
                          </span>
                        ) : (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                            style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, color: gold }}>
                            AI will generate
                          </span>
                        )}
                      </div>
                      {step.channel === "email" && (
                        <input
                          value={msg?.subject ?? ""}
                          onChange={e => updateMessage(msgKey, "subject", e.target.value)}
                          placeholder="Email subject line (optional — AI will generate if empty)"
                          className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none mb-2"
                          style={{ color: C.textPrimary, backgroundColor: C.card, border: `1px solid ${C.border}` }}
                        />
                      )}
                      <textarea
                        value={msg?.content ?? ""}
                        onChange={e => updateMessage(msgKey, "content", e.target.value)}
                        placeholder={step.action === "Send Request"
                          ? "Connection note (max 300 chars)... Leave empty for AI-generated note."
                          : `Message for this step... Leave empty and the AI agent will generate a personalized message based on the lead's profile.`}
                        rows={4}
                        className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none resize-none"
                        style={{ color: C.textPrimary, backgroundColor: C.card, border: `1px solid ${C.border}` }}
                      />
                      <p className="text-[10px] mt-1 mb-2" style={{ color: C.textDim }}>
                        Leave empty for AI-generated content, or write a template. Use {"{{first_name}}"}, {"{{company}}"}, {"{{role}}"} as placeholders.
                      </p>
                      {step.channel !== "call" && (
                        <MessageAttachments
                          attachments={attachments[msgKey] ?? []}
                          onChange={atts => setAttachments(prev => ({ ...prev, [msgKey]: atts }))}
                          stepNumber={msgKey}
                        />
                      )}
                    </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}

          {/* Add step — dashed button */}
          {steps.length === 0 && (
            <button onClick={addStep}
              className="flex items-center gap-2 w-full justify-center py-6 rounded-lg border-2 border-dashed transition-colors cursor-pointer hover:border-gray-400"
              style={{ borderColor: C.border, color: C.textMuted }}>
              <Plus size={16} />
              <span className="text-sm font-medium">Add your first step</span>
            </button>
          )}
        </div>
      </div>

      {/* Bottom save bar */}
      <div className="flex items-center justify-end gap-3 mt-6 pt-5 border-t" style={{ borderColor: C.border }}>
        <Link href="/campaigns"
          className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-[opacity,transform,box-shadow,background-color,border-color] cursor-pointer hover:shadow-sm"
          style={{ backgroundColor: `${C.red}12`, color: C.red, border: `1px solid ${C.red}30` }}>
          Cancel
        </Link>
        <button onClick={handleSave} disabled={saving || !flowName.trim()}
          className="flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition-[opacity,transform,box-shadow,background-color,border-color] cursor-pointer hover:shadow-sm disabled:opacity-40"
          style={{ backgroundColor: C.goldGlow, color: gold, border: `1px solid color-mix(in srgb, ${gold} 19%, transparent)` }}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}
