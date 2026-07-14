"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { C } from "@/lib/design";
import Link from "next/link";
import LogoLoader from "@/components/LogoLoader";
import {
  ArrowLeft, Save, Loader2, Plus, Trash2, GripVertical,
  ChevronUp, ChevronDown, Share2, Mail, Phone, MessageCircle,
  User, Settings, AlertCircle, CheckCircle,
} from "lucide-react";
import { LinkedInIcon, EmailIcon, PhoneIcon, WhatsAppIcon } from "@/components/SocialIcons";
import MessageAttachments, { type Attachment } from "@/components/MessageAttachments";
import SaveAsTemplateButton from "@/components/SaveAsTemplateButton";

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
  // The Unipile account is what the LinkedIn dispatcher actually sends from
  // (dispatch-queue keys on unipile_account_id). linkedin_account_id is a
  // legacy field only a few sellers carry, so filtering the picker on it hid
  // every seller with a connected LinkedIn but no legacy id.
  unipile_account_id: string | null;
  whatsapp_account: string | null;
  // Tenant ownership — the account pickers must only offer sellers that belong
  // to (or are shared with) the campaign's tenant, never another client's.
  company_bio_id: string | null;
  shared_with_company_bio_ids: string[] | null;
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
      // campaign_messages has RLS enabled with no policies → browser-side
      // SELECT returns empty. Fetch via server route which uses service key.
      const [{ data: campaign }, { data: sellersList }, { data: emails }, msgsRes] = await Promise.all([
        supabase.from("campaigns").select("*, leads(allow_linkedin, allow_email, allow_call, allow_whatsapp), sellers(id, name, email_account, linkedin_account_id, unipile_account_id, whatsapp_account)").eq("id", campaignId).single(),
        supabase.from("sellers").select("id, name, email_account, linkedin_account_id, unipile_account_id, whatsapp_account, company_bio_id, shared_with_company_bio_ids").eq("active", true).order("name"),
        supabase.from("instantly_accounts").select("id, email, name, active").eq("active", true).order("email"),
        fetch(`/api/campaigns/${campaignId}/messages`, { cache: "no-store" }).then(r => r.json()).catch(() => ({ messages: [] })),
      ]);
      const msgs = (msgsRes?.messages ?? []) as Array<{ id: string; step_number: number; channel: string; content: string | null; metadata: Record<string, unknown> | null }>;

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
        // Normalize sequence_steps to the editor's internal shape.
        // Two formats coexist:
        //   - LEGACY: each entry has { channel, action, wait_days }; the
        //     "Send Request" entry is explicit at index 0.
        //   - NEW (post-2026-04-30 wizard): each entry only has
        //     { channel, daysAfter }. The connection note is implicit and
        //     lives in campaign_messages at step_number=0; sequence_steps
        //     contains only the post-acceptance steps.
        // Detect "new format with implicit connection note" by checking if
        // a step_number=0 LinkedIn message exists. If so, do NOT auto-infer
        // "Send Request" on the first LinkedIn entry — that's the DM, not
        // the invite — and prepend a synthetic Send Request card so the
        // connection note remains editable.
        const rawSteps: any[] = campaign.sequence_steps ?? [];
        // Format detection: legacy entries carry an explicit `action` field
        // ("Send Request" / "Send DM" / "Send Email" / etc.); the new wizard
        // (post-2026-04-30) writes only `{channel, daysAfter}`. We use the
        // presence of any explicit `action` as the signal — more reliable
        // than reading campaign_messages (which can be empty / RLS-blocked
        // / arrive after this code runs in some browser configurations).
        const isLegacyWithAction = rawSteps.some(
          (s: any) => typeof s.action === "string" && s.action.length > 0,
        );
        let seenLinkedinRequest = false;
        const normalizedSteps: SequenceStep[] = rawSteps.map((s: any) => {
          const channel = s.channel ?? "email";
          const waitDays = s.wait_days ?? s.daysAfter ?? 0;
          let action = s.action;
          if (!action) {
            if (channel === "linkedin") {
              // Legacy: first LI step at waitDays=0 was a Send Request entry.
              // New: every LI entry in sequence_steps is a post-acceptance DM
              // (the Send Request lives implicitly in messages step_number=0).
              if (isLegacyWithAction && !seenLinkedinRequest && waitDays === 0) {
                action = "Send Request"; seenLinkedinRequest = true;
              } else { action = "Send DM"; }
            } else if (channel === "email") { action = "Send Email"; }
            else if (channel === "call") { action = "Call"; }
            else if (channel === "whatsapp") { action = "Send Message"; }
            else { action = "Send"; }
          }
          if (action === "Send Request") seenLinkedinRequest = true;
          return { channel, action, wait_days: waitDays } as SequenceStep;
        });
        // New-format LinkedIn campaigns: the connection note is implicit
        // in sequence_steps but lives as message step_number=0. Prepend a
        // synthetic Send Request card so the editor exposes it for editing.
        const firstIsLinkedin = rawSteps[0]?.channel === "linkedin";
        if (firstIsLinkedin && !normalizedSteps.some(s => s.action === "Send Request")) {
          normalizedSteps.unshift({ channel: "linkedin", action: "Send Request", wait_days: 0 });
        }
        setSteps(normalizedSteps);
        setEmailAccount(campaign.email_account ?? "");
        // Pre-populate from DB columns (new). Fall back to the flow manager
        // for existing campaigns that pre-date these columns (linkedin_seller_ids = NULL).
        const savedLinkedin = (campaign as any).linkedin_seller_ids as string[] | null;
        const savedCalls    = (campaign as any).call_seller_ids    as string[] | null;
        if (savedLinkedin && savedLinkedin.length > 0) {
          setLinkedinProfiles(savedLinkedin);
        } else if (campaign.seller_id) {
          // Default: show the flow manager — they're the LinkedIn account in use
          const mgr = (sellersList ?? []).find((s: Seller) => s.id === campaign.seller_id);
          if (mgr?.unipile_account_id) setLinkedinProfiles([campaign.seller_id]);
        }
        if (savedCalls && savedCalls.length > 0) {
          setCallAssignees(savedCalls);
        } else if (campaign.seller_id) {
          setCallAssignees([campaign.seller_id]);
        }
      }

      // Build messages map and attachments map
      const msgMap: Record<number, { id: string; content: string; subject?: string }> = {};
      const attMap: Record<number, Attachment[]> = {};
      (msgs ?? []).forEach((m: any) => {
        const subject = m.metadata?.subject ?? undefined;
        msgMap[m.step_number] = { id: m.id, content: m.content ?? "", subject };
        if (m.metadata?.attachments && Array.isArray(m.metadata.attachments)) {
          attMap[m.step_number] = m.metadata.attachments;
        }
      });
      setMessages(msgMap);
      setAttachments(attMap);

      // Scope the account pickers to the campaign's tenant — own sellers plus
      // any explicitly shared with it. Without this, a super_admin editing one
      // client's flow saw every tenant's sellers and could assign another
      // client's LinkedIn/phone by mistake.
      {
        const campBio = (campaign as { company_bio_id?: string | null }).company_bio_id ?? null;
        const scoped = (sellersList ?? []).filter((s: Seller) =>
          !campBio
          || s.company_bio_id === campBio
          || (Array.isArray(s.shared_with_company_bio_ids) && s.shared_with_company_bio_ids.includes(campBio))
        );
        setSellers(scoped);
      }
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
    // New messages: steps added during this edit session (no campaign_messages row yet)
    const newMessagesPayload: Record<number, any> = {};

    for (const [stepNum, msg] of Object.entries(messages)) {
      const stepAtts = attachments[Number(stepNum)] ?? [];
      if (msg.id) {
        messagesPayload[Number(stepNum)] = {
          id: msg.id,
          content: msg.content,
          subject: msg.subject ?? "",
          attachments: stepAtts,
        };
      } else {
        // New step — find its channel + wait_days so the API can create DB rows
        // Recompute msgKey → step index mapping
        let stepIdx = -1;
        let curKey = 0;
        for (let si = 0; si < steps.length; si++) {
          const sk = steps[si].action === "Send Request" ? 0 : (() => {
            const nb = steps.slice(0, si).filter(s => s.action !== "Send Request").length;
            return nb + 1;
          })();
          if (sk === Number(stepNum)) { stepIdx = si; break; }
        }
        const step = stepIdx >= 0 ? steps[stepIdx] : null;
        newMessagesPayload[Number(stepNum)] = {
          content: msg.content ?? "",
          subject: msg.subject ?? "",
          channel: step?.channel ?? "email",
          waitDays: step?.wait_days ?? 3,
        };
      }
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
          newMessages: newMessagesPayload,
          linkedinSellerIds: linkedinProfiles.length > 0 ? linkedinProfiles : [],
          callSellerIds: callAssignees.length > 0 ? callAssignees : [],
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
    // Use the global LogoLoader so the in-page spinner doesn't visibly hand
    // off from the route-transition loader.
    return <LogoLoader />;
  }

  const selectedSeller = sellers.find(s => s.id === flowManagerId);

  return (
    <div className="p-6 w-full">
      {/* Top bar: back + header + actions */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <Link href={`/campaigns/${campaignId}`} className="flex items-center gap-1.5 text-xs font-medium mb-3 transition-colors hover:opacity-70 cursor-pointer"
            style={{ color: C.textMuted }}>
            <ArrowLeft size={14} /> Back to Outreach Flow
          </Link>
          <p className="text-xs font-semibold uppercase tracking-widest mb-0.5" style={{ color: gold }}>Flow Editor</p>
          <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>Edit Sequence</h1>
        </div>
        <div className="flex items-center gap-3 pt-8 shrink-0">
          <Link href="/campaigns"
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-70 cursor-pointer"
            style={{ color: C.textMuted, border: `1px solid ${C.border}` }}>
            Cancel
          </Link>
          <SaveAsTemplateButton campaignId={campaignId} defaultName={flowName} />
          <button onClick={handleSave} disabled={saving || !flowName.trim()}
            className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold cursor-pointer disabled:opacity-40"
            style={{ backgroundColor: C.goldGlow, color: gold, border: `1px solid color-mix(in srgb, ${gold} 19%, transparent)` }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>

      <div className="h-px mb-6" style={{ background: `linear-gradient(90deg, ${gold} 0%, color-mix(in srgb, var(--brand, #c9a83a) 15%, transparent) 40%, transparent 100%)` }} />

      {/* Alerts */}
      {saved && (
        <div className="flex items-center gap-2 rounded-xl px-4 py-3 mb-4 text-sm font-medium fade-in"
          style={{ backgroundColor: C.greenLight, color: C.green }}>
          <CheckCircle size={15} /> Changes saved successfully.
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-xl px-4 py-3 mb-4 text-sm font-medium"
          style={{ backgroundColor: C.redLight, color: C.red }}>
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {/* ── Two-column layout ── */}
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>

        {/* ── LEFT SIDEBAR: metadata ── */}
        <div style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>

          {/* Flow Name */}
          <div className="rounded-xl p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
            <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: C.textMuted }}>Flow Name</label>
            <input value={flowName} onChange={e => setFlowName(e.target.value)}
              className="w-full rounded-lg px-3 py-2.5 text-sm font-semibold focus:outline-none"
              style={{ color: C.textPrimary, backgroundColor: C.bg, border: `1px solid ${C.border}` }}
              placeholder="E.g.: Crop Nutrition Outbound" />
          </div>

          {/* Manager + Email */}
          <div className="rounded-xl p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
            <label className="block text-[10px] font-semibold uppercase tracking-wider mb-3" style={{ color: C.textMuted }}>Accounts</label>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Flow Manager</label>
                <div className="relative">
                  <select value={flowManagerId ?? ""} onChange={e => setFlowManagerId(e.target.value || null)}
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none appearance-none cursor-pointer"
                    style={{ color: C.textPrimary, backgroundColor: C.bg, border: `1px solid ${C.border}` }}>
                    <option value="">Unassigned</option>
                    {sellers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <User size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: C.textDim }} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: C.textBody }}>Email Account</label>
                <div className="relative">
                  <select value={emailAccount} onChange={e => setEmailAccount(e.target.value)}
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none appearance-none cursor-pointer"
                    style={{ color: C.textPrimary, backgroundColor: C.bg, border: `1px solid ${C.border}` }}>
                    <option value="">Auto-assign</option>
                    {emailAccounts.map(a => <option key={a.id} value={a.email}>{a.email}{a.name ? ` (${a.name})` : ""}</option>)}
                  </select>
                  <Mail size={13} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: C.textDim }} />
                </div>
              </div>
            </div>
          </div>

          {/* LinkedIn Profiles */}
          <div className="rounded-xl p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
            <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2.5" style={{ color: C.textMuted }}>LinkedIn Profiles</label>
            {linkedinProfiles.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 mb-2"
                style={{ backgroundColor: "#0A66C206", border: "1px dashed #0A66C230" }}>
                <Share2 size={12} style={{ color: "#0A66C2", opacity: 0.5 }} />
                <span className="text-xs" style={{ color: C.textDim }}>Auto-assign — all available profiles</span>
              </div>
            ) : (
              <div className="space-y-1.5 mb-2">
                {linkedinProfiles.map(id => {
                  const s = sellers.find(x => x.id === id);
                  return (
                    <div key={id} className="flex items-center justify-between rounded-lg px-3 py-2"
                      style={{ backgroundColor: "#0A66C208", border: "1px solid #0A66C220" }}>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                          style={{ backgroundColor: "#0A66C215", color: "#0A66C2" }}>
                          {s?.name?.[0] ?? "?"}
                        </div>
                        <span className="text-xs font-semibold" style={{ color: C.textPrimary }}>{s?.name ?? "Unknown"}</span>
                      </div>
                      <button onClick={() => setLinkedinProfiles(prev => prev.filter(p => p !== id))}
                        className="p-1 rounded cursor-pointer hover:opacity-60">
                        <Trash2 size={11} style={{ color: C.textMuted }} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {sellers.filter(s => s.unipile_account_id && !linkedinProfiles.includes(s.id)).map(s => (
                <button key={s.id} onClick={() => setLinkedinProfiles(prev => [...prev, s.id])}
                  className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium cursor-pointer transition-colors hover:opacity-80"
                  style={{ backgroundColor: C.bg, color: C.textMuted, border: `1px solid ${C.border}` }}>
                  <Plus size={9} /> {s.name}
                </button>
              ))}
            </div>
          </div>

          {/* Call Assignment */}
          <div className="rounded-xl p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
            <label className="block text-[10px] font-semibold uppercase tracking-wider mb-2.5" style={{ color: C.textMuted }}>Call Assignment</label>
            {callAssignees.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 mb-2"
                style={{ backgroundColor: "#F9731606", border: "1px dashed #F9731630" }}>
                <Phone size={12} style={{ color: "#F97316", opacity: 0.5 }} />
                <span className="text-xs" style={{ color: C.textDim }}>Auto-assign to Flow Manager</span>
              </div>
            ) : (
              <div className="space-y-1.5 mb-2">
                {callAssignees.map(id => {
                  const s = sellers.find(x => x.id === id);
                  return (
                    <div key={id} className="flex items-center justify-between rounded-lg px-3 py-2"
                      style={{ backgroundColor: "#F9731608", border: "1px solid #F9731620" }}>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                          style={{ backgroundColor: "#F9731615", color: "#F97316" }}>
                          {s?.name?.[0] ?? "?"}
                        </div>
                        <span className="text-xs font-semibold" style={{ color: C.textPrimary }}>{s?.name ?? "Unknown"}</span>
                      </div>
                      <button onClick={() => setCallAssignees(prev => prev.filter(p => p !== id))}
                        className="p-1 rounded cursor-pointer hover:opacity-60">
                        <Trash2 size={11} style={{ color: C.textMuted }} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {sellers.filter(s => !callAssignees.includes(s.id)).map(s => (
                <button key={s.id} onClick={() => setCallAssignees(prev => [...prev, s.id])}
                  className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium cursor-pointer transition-colors hover:opacity-80"
                  style={{ backgroundColor: C.bg, color: C.textMuted, border: `1px solid ${C.border}` }}>
                  <Plus size={9} /> {s.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── RIGHT MAIN: Sequence Steps ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
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
                      // Map step index → campaign_messages.step_number.
                      // "Send Request" always maps to step_number 0 (the connection note).
                      // For every other card, count the non-Send-Request steps that
                      // appear before it in the sequence and add 1 — that's the
                      // step_number used by the wizard / approve route. Works for
                      // both legacy (explicit Send Request entry) and new wizard
                      // (synthetic Send Request prepended at load time) formats,
                      // and for non-LinkedIn campaigns where no Send Request exists
                      // (msgKey starts at 1, since approve writes msg.step ?? i+1).
                      let msgKey: number;
                      if (step.action === "Send Request") {
                        msgKey = 0;
                      } else {
                        const realStepsBefore = steps.slice(0, i).filter(s => s.action !== "Send Request").length;
                        msgKey = realStepsBefore + 1;
                      }
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
        </div>
      </div>
    </div>
  );
}
