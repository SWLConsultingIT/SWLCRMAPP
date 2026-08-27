"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { C } from "@/lib/design";
import {
  ArrowLeft, ArrowRight, Check, Share2, Mail, Phone, MessageCircle,
  Loader2, Send, Megaphone, Plus, Trash2, Globe, Settings, AlertTriangle, Lock,
  Sparkles,
} from "lucide-react";
import type { SampleLead, PlaceholderCoverage } from "@/components/ChannelMessageConfig";
import ChannelMessageConfig, { type ChannelMessages } from "@/components/ChannelMessageConfig";
import SignalPicker from "@/components/SignalPicker";
import LogoLoader from "@/components/LogoLoader";
import FlowTypePicker from "@/components/wizard/FlowTypePicker";
import SignalCoverageBanner from "@/components/wizard/SignalCoverageBanner";
import SampleLeadCards from "@/components/wizard/SampleLeadCards";
import LeadTagGrid from "@/components/wizard/LeadTagGrid";

type FlowType = "generic" | "tailored";

type PreviewOutput = {
  hook: string | null;
  fit: string | null;
  violations: string[];
};

const gold = C.gold;

import { type StepAttachment } from "@/components/StepAttachments";
import { readLeadSelection, clearLeadSelection, STASH_SENTINEL } from "@/lib/lead-selection";

type SequenceStep = { channel: string; daysAfter: number; attachments?: StepAttachment[] };


const languageOptions = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
];

const ALL_CHANNEL_OPTIONS = [
  { key: "linkedin",  label: "LinkedIn",  icon: Share2,         color: C.linkedin, short: "LI" },
  { key: "email",     label: "Email",     icon: Mail,           color: C.email,    short: "EM" },
  { key: "call",      label: "Call",      icon: Phone,          color: C.phone,    short: "CA" },
  { key: "whatsapp",  label: "WhatsApp",  icon: MessageCircle,  color: "#25D366",  short: "WA", superAdminOnly: true },
  { key: "telegram",  label: "Telegram",  icon: Send,           color: "#229ED9",  short: "TG", superAdminOnly: true },
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

const WIZARD_STEPS = ["Sequence", "Settings", "Messages", "Review"];

// Stable 32-bit-ish hash of a string. Used to scope the wizard's
// sessionStorage draft by the lead-subset so two campaigns off the
// same ICP with different leads don't share a draft.
function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(36);
}

export default function NewCampaignWizard() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const profileId = params.profileId as string;

  // Selected lead IDs. Small selections ride in the URL (?leads=id1,id2,id3);
  // big ones come from sessionStorage because the inline URL trips Vercel's
  // 414 URI_TOO_LONG past ~385 ids. See lib/lead-selection.ts.
  const leadsParamRaw = searchParams.get("leads");
  const selectedLeadIds = useMemo(
    () => readLeadSelection(profileId, leadsParamRaw),
    [profileId, leadsParamRaw],
  );
  const isPartialSelection = selectedLeadIds.length > 0;
  // The URL claims a stashed selection but we can't read it back — a new tab,
  // a pasted link, or cleared storage. Proceeding would silently build a flow
  // with zero leads, so send the seller back to the picker instead.
  const selectionLost = leadsParamRaw === STASH_SENTINEL && selectedLeadIds.length === 0;

  const [wizardStep, setWizardStep] = useState(0);
  // null = the seller hasn't chosen yet; FlowTypePicker fronts the wizard
  // until they pick. Persisted in the draft + sent to campaign_requests
  // on submit (column added in migration 044).
  const [flowType, setFlowType] = useState<FlowType | null>(null);
  const [loading, setLoading] = useState(true);
  const [campaignName, setCampaignName] = useState("");
  const [profile, setProfile] = useState<any>(null);
  const [bio, setBio] = useState<any>(null);
  const [leadsCount, setLeadsCount] = useState(0);
  const [selectedLeadNames, setSelectedLeadNames] = useState<string[]>([]);
  const [sellers, setSellers] = useState<{ id: string; name: string; unipile_account_id: string | null; email_account: string | null; linkedin_daily_limit: number | null; email_daily_limit: number | null }[]>([]);
  type SellerQuota = { sellerId: string; quota: number };
  const [sellerQuotas, setSellerQuotas] = useState<SellerQuota[]>([]);
  const [icpTemplates, setIcpTemplates] = useState<Array<{ id: string; name: string; description: string | null; sequence_steps: any[]; step_messages: any }>>([]);
  const [aircallNumbers, setAircallNumbers] = useState<{ id: number; name: string; digits: string; country: string }[]>([]);
  const [selectedAircallNumberId, setSelectedAircallNumberId] = useState<number | null>(null);
  // Manual = sequence freezes at the call step until the seller dials.
  // Auto = cron auto-dials + auto-advances past the call step at daysAfter.
  // Default kept as 'auto' to match pre-2026-05-21 behavior.
  const [callAdvanceMode, setCallAdvanceMode] = useState<"auto" | "manual">("auto");

  // Channel coverage across the leads chosen for this campaign. Counted once
  // up front so the Sequence step can warn the operator BEFORE launch when
  // a channel is in the flow but some leads are missing the data for it
  // (no LinkedIn URL, no email, no phone). Without this guard, those leads
  // sit silently and the dispatcher fails them at send time, which is what
  // happened on Pathway 2026-05-11 — admin discovered 9 BLOCKED only after
  // they showed up in Failed Messages.
  //
  // missing[channel] holds the names of leads that CAN'T be reached on that
  // channel — used in the warning so admin sees exactly who's blocked, not
  // just an aggregate count.
  const [coverage, setCoverage] = useState<{
    total: number;
    linkedin: number; email: number; call: number; whatsapp: number;
    missing: { linkedin: string[]; email: string[]; call: string[]; whatsapp: string[] };
  }>({ total: 0, linkedin: 0, email: 0, call: 0, whatsapp: 0, missing: { linkedin: [], email: [], call: [], whatsapp: [] } });

  // Sequence builder
  const [sequence, setSequence] = useState<SequenceStep[]>([
    { channel: "linkedin", daysAfter: 0 },
    { channel: "email", daysAfter: 3 },
    { channel: "linkedin", daysAfter: 3 },
  ]);

  // Channel messages (structured per-channel config)
  const [channelMessages, setChannelMessages] = useState<ChannelMessages>({ steps: [], autoReplies: { positive: "", negative: "", question: "" } });

  // Template apply — checks both the URL (?template_id=X for direct deep
  // links from elsewhere) and sessionStorage (set by the /templates tab
  // before navigating through the chooser, since the URL param doesn't
  // survive the 2-step navigation). The wizard pre-fills sequence +
  // channelMessages, then clears sessionStorage so refreshing doesn't
  // reapply it.
  useEffect(() => {
    const fromUrl = searchParams.get("template_id");
    let fromSession: string | null = null;
    try { fromSession = sessionStorage.getItem("swl-pending-template-id"); } catch { /* SSR/private mode */ }
    const templateId = fromUrl ?? fromSession;
    if (!templateId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/templates/${templateId}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json().catch(() => ({}));
        const t = body.template;
        if (cancelled || !t) return;
        const rawSeq = Array.isArray(t.sequence_steps) ? t.sequence_steps as SequenceStep[] : [];
        const stepMsgs = (t.step_messages ?? {}) as ChannelMessages;
        const hasCRInSeq = typeof stepMsgs.connectionRequest === "string"
          && stepMsgs.connectionRequest.length > 0
          && rawSeq[0]?.channel === "linkedin"
          && rawSeq[0]?.daysAfter === 0;
        const strippedSeq = hasCRInSeq ? rawSeq.slice(1) : rawSeq;
        const rawMsgSteps = Array.isArray(stepMsgs.steps) ? stepMsgs.steps : [];
        // See applyTemplate() — when CR is stripped from sequence, steps[0]
        // must be stripped too or every body shifts by -1 against its slot.
        const msgSteps = hasCRInSeq ? rawMsgSteps.slice(1) : rawMsgSteps;
        const seq = strippedSeq.map((step, i) => {
          const msg = msgSteps.find((m: any) => m?.step === i + 1) ?? msgSteps[i];
          const attachments = (msg as any)?.attachments;
          return Array.isArray(attachments) && attachments.length > 0
            ? { ...step, attachments }
            : step;
        });
        if (seq.length > 0) setSequence(seq);
        if (t.step_messages && typeof t.step_messages === "object") {
          setChannelMessages({ ...stepMsgs, steps: msgSteps });
        }
        try { sessionStorage.removeItem("swl-pending-template-id"); } catch { /* no-op */ }
      } catch { /* template apply is best-effort; never block the wizard */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [selectedSignals, setSelectedSignals] = useState<string[]>([]);
  // Enrichment from a representative lead in this ICP — drives which signal chips render.
  // Each tenant has different enrichment keys; for Pathway they're rfa_*/ch_*, for another client they might be something else.
  const [sampleEnrichment, setSampleEnrichment] = useState<Record<string, unknown> | null>(null);
  // A representative lead of this ICP — passed to the AI message generator so
  // it can draft from real lead context. Without it the generator received
  // lead_id=null and the "AI Draft" button silently produced nothing
  // (boss 2026-06-08, on a Call-only flow).
  const [sampleLeadId, setSampleLeadId] = useState<string | null>(null);
  // Up to 3 real leads of this selection + how many leads have each
  // placeholder column filled. Feeds the Messages step's rendered preview
  // and the per-token coverage bars — both need real data, not estimates.
  const [sampleLeads, setSampleLeads] = useState<SampleLead[]>([]);
  const [placeholderCoverage, setPlaceholderCoverage] = useState<PlaceholderCoverage | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [messagesWarning, setMessagesWarning] = useState<string | null>(null);
  // Save-as-template prompt (shown after successful campaign submit)
  const [showSavePrompt, setShowSavePrompt] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplDesc, setTplDesc] = useState("");
  const [savingTpl, setSavingTpl] = useState(false);
  const [tplSaveError, setTplSaveError] = useState<string | null>(null);
  const [tplSaved, setTplSaved] = useState(false);
  const [coverageWarningDismissed, setCoverageWarningDismissed] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const channelOptions = ALL_CHANNEL_OPTIONS.filter(c => !c.superAdminOnly || isSuperAdmin);
  const [presetUndo, setPresetUndo] = useState<{ name: string; steps: SequenceStep[] } | null>(null);
  const [language, setLanguage] = useState("es");
  const [timezone, setTimezone] = useState("America/Argentina/La_Rioja");

  // Wizard draft autosave — persist sequence + channelMessages + the meta
  // settings to sessionStorage so a refresh or accidental nav never wipes
  // the work-in-progress. Scoped per (ICP, lead-subset) so two campaigns
  // off the SAME ICP but different leads don't collide on the same key
  // — Fran 2026-06-09 saw a wizard for Alberto Lupi + Covacig restore a
  // draft from a previous run on the same ICP. Hash the leads CSV so
  // the key length stays bounded.
  // Key the draft off the real selection, not the raw param — with a stashed
  // selection the param is just "stashed" and every large flow on this ICP
  // would collide on one draft key.
  const leadsKeyPart = selectedLeadIds.length > 0
    ? `sel-${selectedLeadIds.length}-${hashStr(selectedLeadIds.join(","))}`
    : "all";
  const draftKey = `swl-wizard-draft:${profileId}:${leadsKeyPart}`;
  const [draftRestored, setDraftRestored] = useState(false);
  // Tailored-mode state — populated lazily when the seller lands on
  // Step 3 in tailored mode so we don't pay query cost for generic.
  const [tenantBioId, setTenantBioId] = useState<string | null>(null);
  const [tailoredLeadIds, setTailoredLeadIds] = useState<string[]>([]);
  const [previewOutputs, setPreviewOutputs] = useState<Record<string, PreviewOutput>>({});
  // Track when state has been hydrated at least once so the save effect
  // doesn't write a half-empty draft on the very first render.
  const draftHydratedRef = useRef(false);
  // Ref mirror of draftRestored for synchronous reads inside async load().
  // React state isn't visible across effects on the same render cycle, but
  // a ref set synchronously in the restore effect IS visible to load() when
  // it eventually reaches the auto-seller check (after several awaits).
  const draftRestoredRef = useRef(false);

  // RESTORE on mount — runs BEFORE template apply so template-from-URL
  // takes precedence (user explicitly picked a template → ignore stale draft).
  useEffect(() => {
    const fromUrl = searchParams.get("template_id");
    let pendingTemplate: string | null = null;
    try { pendingTemplate = sessionStorage.getItem("swl-pending-template-id"); } catch { /* no-op */ }
    if (fromUrl || pendingTemplate) {
      // Template apply path owns the state. Skip draft restore.
      draftHydratedRef.current = true;
      return;
    }
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (!raw) { draftHydratedRef.current = true; return; }
      const d = JSON.parse(raw);
      if (d.campaignName) setCampaignName(d.campaignName);
      if (Array.isArray(d.sequence) && d.sequence.length > 0) setSequence(d.sequence);
      if (d.channelMessages && typeof d.channelMessages === "object") setChannelMessages(d.channelMessages);
      if (d.language) setLanguage(d.language);
      if (d.timezone) setTimezone(d.timezone);
      if (typeof d.wizardStep === "number" && d.wizardStep >= 0 && d.wizardStep <= 3) setWizardStep(d.wizardStep);
      if (Array.isArray(d.selectedSignals)) setSelectedSignals(d.selectedSignals);
      if (Array.isArray(d.sellerQuotas) && d.sellerQuotas.length > 0) setSellerQuotas(d.sellerQuotas);
      if (typeof d.selectedAircallNumberId === "number") setSelectedAircallNumberId(d.selectedAircallNumberId);
      if (d.callAdvanceMode === "auto" || d.callAdvanceMode === "manual") setCallAdvanceMode(d.callAdvanceMode);
      if (d.flowType === "generic" || d.flowType === "tailored") setFlowType(d.flowType);
      setDraftRestored(true);
      draftRestoredRef.current = true;
    } catch { /* corrupt draft — ignore */ }
    draftHydratedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SAVE on change — debounced so we don't write on every keystroke.
  useEffect(() => {
    if (!draftHydratedRef.current) return;
    const t = setTimeout(() => {
      try {
        sessionStorage.setItem(draftKey, JSON.stringify({
          campaignName,
          sequence,
          channelMessages,
          language,
          timezone,
          wizardStep,
          selectedSignals,
          sellerQuotas,
          selectedAircallNumberId,
          callAdvanceMode,
          flowType,
          savedAt: Date.now(),
        }));
      } catch { /* quota exceeded / private mode — ignore */ }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignName, sequence, channelMessages, language, timezone, wizardStep, selectedSignals, sellerQuotas, selectedAircallNumberId, callAdvanceMode, flowType]);

  // If the seller goes back to Step 2 (Messages) and edits the
  // template after having generated tailored preview outputs in
  // Step 3, those outputs are now stale (the templates they ran
  // against just changed). Drop them so the submit doesn't ship
  // stale per-lead slots into a different template.
  useEffect(() => {
    if (wizardStep === 2 && Object.keys(previewOutputs).length > 0) {
      setPreviewOutputs({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelMessages]);

  // Lazy load: when the seller lands on Step 3 in tailored mode, resolve
  // their tenant bio id + the full list of lead ids the batch is going
  // to target. Skipped for generic mode (no Step 3 review surface).
  useEffect(() => {
    if (wizardStep !== 3 || flowType !== "tailored") return;
    if (tenantBioId && tailoredLeadIds.length > 0) return;
    (async () => {
      const supabase = getSupabaseBrowser();
      if (!tenantBioId) {
        const { data: bioId } = await supabase.rpc("get_auth_company_bio_id");
        if (bioId) setTenantBioId(bioId as string);
      }
      if (tailoredLeadIds.length === 0) {
        if (isPartialSelection) {
          setTailoredLeadIds(selectedLeadIds);
        } else {
          // Pull all lead ids for the ICP, paginated in 1000-row pages so
          // we never hit the default Supabase row cap and miss leads from
          // the back of large batches.
          const ids: string[] = [];
          let from = 0;
          while (true) {
            const { data, error } = await supabase
              .from("leads")
              .select("id")
              .eq("icp_profile_id", profileId)
              .order("id", { ascending: true })
              .range(from, from + 999);
            if (error || !data || data.length === 0) break;
            ids.push(...(data as Array<{ id: string }>).map(r => r.id));
            if (data.length < 1000) break;
            from += 1000;
            if (from > 20000) break; // safety
          }
          setTailoredLeadIds(ids);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardStep, flowType]);

  useEffect(() => {
    async function load() {
  const supabase = getSupabaseBrowser();
      // Resolve the current user's tenant via /api/auth/me — that endpoint
      // honors BOTH the multi-tenant switcher cookie (active_tenant_bio_id)
      // and demo impersonation. Using the SQL RPC get_auth_company_bio_id
      // here was the source of a 2026-05-22 bug: super_admin scoped into
      // De Vera Grill kept seeing SWL sellers because the RPC reads the JWT
      // (the admin's own bio) and can't see HTTP cookies.
      let bioId: string | null = null;
      try {
        const meRes = await fetch("/api/auth/me", { cache: "no-store" });
        if (meRes.ok) {
          const me = await meRes.json();
          bioId = (me?.user?.companyBioId as string | null) ?? null;
        }
      } catch { /* fall through with null bioId */ }
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: prof } = await supabase.from("user_profiles").select("tier").eq("id", user.id).single();
        if (prof?.tier === "super_admin") setIsSuperAdmin(true);
      }
      let sellerQ = supabase.from("sellers")
        .select("id, name, unipile_account_id, email_account, linkedin_daily_limit, email_daily_limit")
        .eq("active", true)
        .order("name");
      // Tenant scope: own sellers + sellers shared from other tenants via the
      // admin "Sellers shared with this client" toggle. The OR clause keeps
      // the wizard tenant-isolated while honoring shared assignments.
      // Bug fix 2026-05-22: Supabase query builders return a NEW builder on
      // every .or() — without reassignment the scope filter was thrown away
      // and every tenant's wizard listed every active seller in the system.
      if (bioId) sellerQ = sellerQ.or(`company_bio_id.eq.${bioId},shared_with_company_bio_ids.cs.{${bioId}}`);
      const bioQ = bioId
        ? supabase.from("company_bios").select("*").eq("id", bioId).single()
        : supabase.from("company_bios").select("*").order("created_at", { ascending: false }).limit(1).single();
      const [{ data: p }, { data: b }, { data: sellerList }] = await Promise.all([
        supabase.from("icp_profiles").select("*").eq("id", profileId).single(),
        bioQ,
        sellerQ,
      ]);
      setSellers(sellerList ?? []);
      // Only auto-assign the first seller when the draft didn't already
      // restore a seller selection. Use the ref (not the state) because
      // React state set in the restore effect isn't visible here on the
      // same render cycle; the ref is set synchronously and always current.
      if (sellerList && sellerList.length > 0 && !draftRestoredRef.current) {
        setSellerQuotas([{ sellerId: sellerList[0].id, quota: 20 }]);
      }


      // Load saved templates for this ICP
      try {
        const tplRes = await fetch(`/api/templates?icp_id=${profileId}`, { cache: "no-store" });
        if (tplRes.ok) {
          const tplBody = await tplRes.json().catch(() => ({}));
          setIcpTemplates(tplBody.templates ?? []);
        }
      } catch {}

      // Fetch Aircall numbers
      try {
        const r = await fetch("/api/aircall/numbers");
        const d = await r.json();
        setAircallNumbers(d.numbers ?? []);
        if (d.numbers?.length === 1) setSelectedAircallNumberId(d.numbers[0].id);
      } catch {}

      // Count leads + channel coverage in one pass. We fetch the channel-relevant
      // columns for the selected/profile leads and tally per-channel availability.
      // Cheap: 4 fields × ~100 rows = a few KB. Keeps the Sequence step honest
      // about whether a chosen channel will actually reach all the leads.
      let coverageQ = supabase
        .from("leads")
        .select("id, source, primary_first_name, primary_last_name, primary_linkedin_url, primary_work_email, primary_personal_email, primary_phone, primary_secondary_phone, allow_linkedin, allow_email, allow_call")
        .eq("icp_profile_id", profileId);
      if (isPartialSelection) coverageQ = coverageQ.in("id", selectedLeadIds);
      const { data: covRows } = await coverageQ;
      const rows = covRows ?? [];
      const isValidLi = (u: string | null) => !!u && /linkedin\.com\/in\//i.test(u);
      const fullName = (r: any) => `${r.primary_first_name ?? ""} ${r.primary_last_name ?? ""}`.trim() || r.company_name || "Unknown";
      // Client-source leads keep their PII inside encrypted_payload — the
      // plain columns (primary_linkedin_url, primary_work_email, etc.) are
      // redacted to null in the browser. Without decrypting we can't see
      // which channels exist per-lead, but the importer guarantees the
      // payload carries whatever channels were supplied at import. So we
      // trust source='client' + non-null payload as "reachable on every
      // channel we could plausibly send on." If the data really IS missing
      // for some leads, the dispatcher will surface those at send time —
      // far better than the wizard blocking the campaign entirely with a
      // false "0 / 95 reachable" warning (De Vera Grill case 2026-05-22).
      const isEncrypted = (r: any) => r.source === "client";
      const okLi   = (r: any) => (isEncrypted(r) || isValidLi(r.primary_linkedin_url)) && r.allow_linkedin !== false;
      const okMail = (r: any) => (isEncrypted(r) || r.primary_work_email || r.primary_personal_email) && r.allow_email !== false;
      // Call reachability must mirror the dispatcher + queue, which dial
      // primary_phone ?? primary_secondary_phone. The old check only looked at
      // primary_phone, so leads with ONLY a corporate/secondary number were
      // wrongly flagged BLOCKED for Call (inflated the "21 blocked" warning).
      const okCall = (r: any) => (isEncrypted(r) || r.primary_phone || r.primary_secondary_phone) && r.allow_call !== false;
      const okWa   = (r: any) => (isEncrypted(r) || r.primary_phone || r.primary_secondary_phone) && r.allow_call !== false;
      const cov = {
        total: rows.length,
        linkedin:  rows.filter(okLi).length,
        email:     rows.filter(okMail).length,
        call:      rows.filter(okCall).length,
        whatsapp:  rows.filter(okWa).length,
        missing: {
          linkedin: rows.filter((r: any) => !okLi(r)).map(fullName),
          email:    rows.filter((r: any) => !okMail(r)).map(fullName),
          call:     rows.filter((r: any) => !okCall(r)).map(fullName),
          whatsapp: rows.filter((r: any) => !okWa(r)).map(fullName),
        },
      };
      setCoverage(cov);

      let count = rows.length;
      if (isPartialSelection) {
        setSelectedLeadNames(rows.map((n: any) => `${n.primary_first_name ?? ""} ${n.primary_last_name ?? ""}`.trim()));
      } else if (count === 0) {
        // Defensive: profile may have leads but we read 0 — fall back to count query.
        const { count: totalCount } = await supabase
          .from("leads")
          .select("*", { count: "exact", head: true })
          .eq("icp_profile_id", profileId);
        count = totalCount ?? 0;
      }

      // Grab a representative lead's enrichment so the SignalPicker shows only keys
      // that actually exist on leads belonging to this ICP (Pathway leads have rfa_*/ch_*;
      // another client's leads have whatever vocabulary they use).
      let sampleQuery = supabase
        .from("leads")
        .select("id, enrichment")
        .eq("icp_profile_id", profileId)
        .not("enrichment", "is", null)
        .limit(1);
      if (isPartialSelection) sampleQuery = sampleQuery.in("id", selectedLeadIds);
      const { data: sample } = await sampleQuery.maybeSingle();
      setSampleEnrichment((sample?.enrichment as Record<string, unknown> | null) ?? null);
      // Lead id for the AI generator. Prefer the enrichment-bearing sample;
      // otherwise grab any lead of this ICP (selection-scoped) so the draft
      // still has a real lead to personalize from.
      if (sample?.id) {
        setSampleLeadId(sample.id as string);
      } else {
        let anyQuery = supabase.from("leads").select("id").eq("icp_profile_id", profileId).limit(1);
        if (isPartialSelection) anyQuery = anyQuery.in("id", selectedLeadIds);
        const { data: anyLead } = await anyQuery.maybeSingle();
        setSampleLeadId((anyLead?.id as string | undefined) ?? null);
      }

      setProfile(p);
      setBio(b);
      setLeadsCount(count ?? 0);
      setLoading(false);
    }
    load();
  }, [profileId]);

  // Sample leads + placeholder coverage. Fetched when the author first
  // reaches the Messages step (step 2) rather than on page load — it costs a
  // handful of COUNT queries and steps 0/1 never use it. Runs once; the
  // selection can't change without leaving the wizard.
  useEffect(() => {
    if (wizardStep !== 2) return;
    if (placeholderCoverage !== undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/campaigns/wizard-sample-leads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadIds: isPartialSelection ? selectedLeadIds : undefined,
            icpProfileId: profileId,
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setSampleLeads(Array.isArray(data.leads) ? data.leads : []);
        setPlaceholderCoverage({
          counts: data.coverage ?? {},
          total: data.total ?? 0,
          encrypted: data.encrypted ?? 0,
        });
      } catch {
        // Preview and coverage are additive: on failure the Messages step
        // still works, it just shows the template instead of the rendered
        // message. Never block flow creation on this.
      }
    })();
    return () => { cancelled = true; };
  }, [wizardStep, placeholderCoverage, isPartialSelection, selectedLeadIds, profileId]);

  // Sequence helpers
  function addStep() {
    const lastChannel = sequence.length > 0 ? sequence[sequence.length - 1].channel : "linkedin";
    const nextChannel = channelOptions.find(c => c.key !== lastChannel)?.key ?? lastChannel;
    setSequence(s => [...s, { channel: nextChannel, daysAfter: 3 }]);
  }

  function removeStep(idx: number) {
    setSequence(s => s.filter((_, i) => i !== idx));
  }

  // Drop the LinkedIn Connection Request (the day-0 invite at sequence[0]).
  // For a Call-only / Email-only flow the CR is meaningless and shouldn't be
  // forced (boss 2026-06-08). The CR occupies sequence[0] AND a placeholder at
  // channelMessages.steps[0] (steps stay 1:1 with sequence — wizard storage
  // LAW), with its text in connectionRequest — so remove all three in lockstep.
  function removeConnectionRequest() {
    setSequence(s => (s[0]?.channel === "linkedin" && s[0]?.daysAfter === 0 ? s.slice(1) : s));
    setChannelMessages(m => ({
      ...m,
      steps: Array.isArray(m.steps) && m.steps.length > 0 ? m.steps.slice(1) : (m.steps ?? []),
      connectionRequest: "",
      connectionRequestPrompt: "",
    }));
  }

  function updateStep(idx: number, field: keyof SequenceStep, value: any) {
    setSequence(s => s.map((step, i) => i === idx ? { ...step, [field]: value } : step));
  }

  // Template builder saves the Connection Request as sequence_steps[0]
  // (LinkedIn D0 with isConnectionRequest=true) AND in step_messages.connectionRequest.
  // The wizard's sequence model does NOT include the CR — it lives solely in
  // channelMessages.connectionRequest, and every entry of `sequence` is a
  // numbered message step. Strip the CR marker on apply so a "3-step" template
  // shows as 3 numbered steps in the wizard, not 4.
  //
  // Per-step attachments live in step_messages.steps[i].attachments in the
  // template, but the wizard's AttachmentEditor reads them from
  // sequence[i].attachments (same shape the dispatcher reads at send time).
  // Merge them onto the stripped sequence so files survive the template apply.
  function applyTemplate(tpl: { name: string; sequence_steps: any[]; step_messages: any }) {
    const rawSeq = (tpl.sequence_steps ?? []) as SequenceStep[];
    const stepMsgs = (tpl.step_messages ?? {}) as ChannelMessages;
    const hasCRInSeq = typeof stepMsgs.connectionRequest === "string"
      && stepMsgs.connectionRequest.length > 0
      && rawSeq[0]?.channel === "linkedin"
      && rawSeq[0]?.daysAfter === 0;
    const strippedSeq = hasCRInSeq ? rawSeq.slice(1) : rawSeq;
    const rawMsgSteps = Array.isArray(stepMsgs.steps) ? stepMsgs.steps : [];
    // When we strip the LinkedIn-d0 CR from the sequence, drop steps[0] from
    // step_messages too — otherwise every followup body shifts by -1 against
    // its slot, putting email bodies in call slots, call scripts in LinkedIn
    // slots, etc. (Fran flagged this exact corruption on 2026-05-26.)
    const msgSteps = hasCRInSeq ? rawMsgSteps.slice(1) : rawMsgSteps;
    const seq = strippedSeq.map((step, i) => {
      const msg = msgSteps.find((m: any) => m?.step === i + 1) ?? msgSteps[i];
      const attachments = (msg as any)?.attachments;
      return Array.isArray(attachments) && attachments.length > 0
        ? { ...step, attachments }
        : step;
    });
    if (seq.length > 0) setSequence(seq);
    if (tpl.step_messages && typeof tpl.step_messages === "object") {
      // Use the realigned steps array so steps[i] matches strippedSeq[i].
      setChannelMessages({ ...stepMsgs, steps: msgSteps });
    }
    if (!campaignName.trim()) setCampaignName(tpl.name);
  }

  // Multi-seller quota helpers
  const SELLER_COLORS = [
    { bg: "color-mix(in srgb, #2563EB 16%, transparent)", text: "#1D4ED8" },
    { bg: "color-mix(in srgb, #7C3AED 16%, transparent)", text: "#6D28D9" },
    { bg: "color-mix(in srgb, #D97706 16%, transparent)", text: "#92400E" },
    { bg: "color-mix(in srgb, #16A34A 16%, transparent)", text: "#166534" },
    { bg: "#FCE7F3", text: "#9D174D" },
  ];

  function addSellerQuota() {
    const used = new Set(sellerQuotas.map(q => q.sellerId));
    const next = sellers.find(s => !used.has(s.id));
    if (!next) return;
    // Default quota — distribute the actual lead pool evenly across the
    // (new) total number of sellers. If there are 47 leads and the user
    // is adding the 2nd seller, both should default to ~24 (no over-cap
    // ratios like "20 leads / 1 available" the seller would have to fix
    // manually before launching).
    const totalSellersAfter = sellerQuotas.length + 1;
    const fairShare = leadsCount > 0
      ? Math.max(1, Math.ceil(leadsCount / totalSellersAfter))
      : 20;
    setSellerQuotas(prev => {
      // Rebalance existing quotas to the same fair share so the bar stays
      // sensible. The user can still override any row manually afterward.
      const rebalanced = prev.map(q => ({ ...q, quota: fairShare }));
      return [...rebalanced, { sellerId: next.id, quota: fairShare }];
    });
  }

  // When the real lead pool resolves AFTER the seller list (two parallel
  // queries, no guaranteed order), pull the single-seller default up from
  // the hardcoded `20` to the actual `leadsCount`. Only fires when the
  // seller still has the untouched 20 default so we don't trample manual
  // edits.
  useEffect(() => {
    if (leadsCount <= 0) return;
    if (sellerQuotas.length !== 1) return;
    if (sellerQuotas[0].quota !== 20) return;
    setSellerQuotas([{ ...sellerQuotas[0], quota: leadsCount }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadsCount]);
  function updateSellerQuota(idx: number, patch: Partial<SellerQuota>) {
    setSellerQuotas(prev => prev.map((q, i) => i === idx ? { ...q, ...patch } : q));
  }
  function removeSellerQuota(idx: number) {
    setSellerQuotas(prev => prev.filter((_, i) => i !== idx));
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

  // Applying a preset wipes whatever the author had built. It used to do that
  // silently, so we keep the previous sequence around for one undo.
  function applyPreset(tpl: { name: string; steps: { channel: string; daysAfter: number }[] }) {
    setPresetUndo({ name: tpl.name, steps: sequence.map(s => ({ ...s })) });
    setSequence(tpl.steps.map(s => ({ ...s })));
    setChannelMessages({ steps: [], autoReplies: { positive: "", negative: "", question: "" } });
  }
  function undoPreset() {
    if (!presetUndo) return;
    setSequence(presetUndo.steps.map(s => ({ ...s })));
    setPresetUndo(null);
  }

  // Same, for every step at once. Both of these change the STORED daysAfter,
  // never just the label: a toggle that moved only the displayed date would
  // have shown Monday while the dispatcher still sent on Saturday.
  function shiftOffWeekends() {
    setSequence(prev => {
      const next = prev.map(s => ({ ...s }));
      let cum = 0;
      for (let i = 0; i < next.length; i++) {
        cum += i === 0 ? next[i].daysAfter : next[i].daysAfter;
        if (i === 0) { /* day 0 goes out now; moving it would delay the whole flow */ }
        else {
          const d = new Date();
          d.setDate(d.getDate() + cum);
          const bump = d.getDay() === 6 ? 2 : d.getDay() === 0 ? 1 : 0;
          if (bump) { next[i].daysAfter += bump; cum += bump; }
        }
      }
      return next;
    });
  }

  // Push a step off a weekend by adding days to its wait. Acting on the
  // warning beats only being told about it — the old chip was decorative.
  function pushToWeekday(idx: number) {
    const target = stepCalendarDate(days[idx]);
    if (!target.isWeekend) return;
    const d = new Date();
    d.setDate(d.getDate() + days[idx]);
    const bump = d.getDay() === 6 ? 2 : 1; // Sat → Mon, Sun → Mon
    updateStep(idx, "daysAfter", sequence[idx].daysAfter + bump);
  }

  // A name the author can accept with one click. Built from the ICP and the
  // channels actually in the sequence, which is what people type by hand.
  const suggestedName = (() => {
    const base = (profile?.name as string | undefined)?.trim();
    if (!base) return "";
    const chans = [...new Set(sequence.map(s => s.channel))]
      .map(k => channelOptions.find(c => c.key === k)?.label ?? k);
    return chans.length > 0 ? `${base} — ${chans.join(" + ")}` : base;
  })();

  // Returns the real calendar date for a given day offset from today, and
  // whether it falls on a weekend.
  function stepCalendarDate(dayOffset: number): { label: string; isWeekend: boolean } {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    return { label, isWeekend };
  }

  // Submit
  async function handleSubmit() {
    const supabase = getSupabaseBrowser();
    setSubmitting(true);
    setSubmitError(null);

    // Tenant-isolation RLS on campaign_requests requires company_bio_id = the caller's tenant.
    // Resolve it from the signed-in user's profile; admins without a tenant can't submit here.
    const { data: companyBioId, error: scopeErr } = await supabase.rpc("get_auth_company_bio_id");
    if (scopeErr || !companyBioId) {
      setSubmitError(scopeErr?.message ?? "Your account has no company assigned — contact an admin.");
      setSubmitting(false);
      return;
    }

    const uniqueChannels = [...new Set(sequence.map(s => s.channel))];
    const insertData: Record<string, any> = {
      name: campaignName.trim() || `${profile?.profile_name} — ${uniqueChannels.map(c => channelOptions.find(o => o.key === c)?.label).join(" + ")}`,
      icp_profile_id: profileId,
      company_bio_id: companyBioId,
      channels: uniqueChannels,
      sequence_length: sequence.length,
      frequency_days: 0,
      target_leads_count: leadsCount,
      message_prompts: { sequence, channelMessages, language, timezone, selectedLeadIds: isPartialSelection ? selectedLeadIds : null, sellerId: sellerQuotas[0]?.sellerId ?? null, sellerQuotas: sellerQuotas.length > 0 ? sellerQuotas : null, aircallNumberId: selectedAircallNumberId, callAdvanceMode, preview_outputs: flowType === "tailored" && Object.keys(previewOutputs).length > 0 ? previewOutputs : undefined },
      flow_type: flowType ?? "generic",
      status: "pending_review",
    };
    const { error } = await supabase.from("campaign_requests").insert(insertData);
    if (error) {
      setSubmitError(error.message);
      setSubmitting(false);
    } else {
      setSubmitting(false);
      // Wizard succeeded — drop the autosave draft so the next visit to this
      // ICP's wizard starts fresh (not restoring an already-submitted state).
      try { sessionStorage.removeItem(draftKey); } catch { /* no-op */ }
      // Same for the stashed lead selection — this flow consumed it.
      clearLeadSelection(profileId);
      // Offer to save as a reusable template before showing the success screen.
      setTplName(campaignName.trim() || insertData.name);
      setTplDesc("");
      setTplSaveError(null);
      setShowSavePrompt(true);
    }
  }

  async function handleSaveTemplate(skip: boolean) {
    if (skip) { setShowSavePrompt(false); setSubmitted(true); return; }
    setSavingTpl(true);
    setTplSaveError(null);
    try {
      // Auto-fill the positive/negative auto-replies if the wizard never
      // generated them. Up until now templates landed with empty auto-replies
      // unless the seller manually clicked "Generate All" — so the template
      // dropped its inbox-handling content even though the template-apply
      // path supports them. Generates only what's missing, in parallel.
      const ar = channelMessages.autoReplies || { positive: "", negative: "", question: "" };
      // Always backfill empty auto-replies, regardless of whether THIS
      // wizard run used LinkedIn — the template is reusable and may
      // get applied later to a sequence that does include LinkedIn,
      // and the auto-reply slot expects content to be present.
      // (Round 3 fix #15: was gated on hasLinkedin only, which left
      // email/call-only templates without inbox-handling content when
      // they got later re-applied to a multichannel campaign.)
      let filledAutoReplies = ar;
      const needPos = !ar.positive || !ar.positive.trim();
      const needNeg = !ar.negative || !ar.negative.trim();
      if (needPos || needNeg) {
        const language = "es";
        const calls: Array<Promise<{ key: "positive" | "negative"; content: string }>> = [];
        const fetchReply = async (fieldType: "replyPositive" | "replyNegative", key: "positive" | "negative") => {
          try {
            const r = await fetch("/api/campaigns/generate-field", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ channel: "linkedin", fieldType, icpProfileId: profileId, language, sequence_meta: sequence, user_prompt: "" }),
            });
            if (!r.ok) return { key, content: "" };
            const d = await r.json().catch(() => ({}));
            return { key, content: (d?.content as string) ?? "" };
          } catch { return { key, content: "" }; }
        };
        if (needPos) calls.push(fetchReply("replyPositive", "positive"));
        if (needNeg) calls.push(fetchReply("replyNegative", "negative"));
        const results = await Promise.all(calls);
        filledAutoReplies = { ...ar };
        for (const r of results) {
          if (r.content) (filledAutoReplies as Record<string, string>)[r.key] = r.content;
        }
      }
      const body: Record<string, unknown> = {
        mode: "from_scratch",
        name: tplName.trim() || campaignName.trim(),
        description: tplDesc.trim() || null,
        icp_profile_id: profileId,
        sequence_steps: sequence,
        step_messages: { ...channelMessages, autoReplies: filledAutoReplies },
        channels: [...new Set(sequence.map(s => s.channel))],
      };
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTplSaveError(json.error ?? "Failed to save template");
        setSavingTpl(false);
        return; // keep modal open so user sees the error
      }
      setTplSaved(true);
      setShowSavePrompt(false);
      setSubmitted(true);
    } catch (e: any) {
      setTplSaveError((e as any)?.message ?? "Unexpected error");
    } finally {
      setSavingTpl(false);
    }
  }

  const days = cumulativeDays();
  const totalDays = days.length > 0 ? days[days.length - 1] : 0;

  if (loading) {
    return <LogoLoader />;
  }

  // The URL points at a stashed selection we can't read back (new tab, pasted
  // link, cleared storage). Building the flow anyway would create it with zero
  // leads, so stop and send them back to pick again.
  if (selectionLost) {
    return (
      <div className="p-6 w-full">
        <div className="max-w-lg rounded-xl border p-6" style={{ borderColor: C.border, backgroundColor: C.card }}>
          <h2 className="text-[16px] font-semibold mb-2" style={{ color: C.textPrimary }}>
            We lost your lead selection
          </h2>
          <p className="text-[13px] leading-relaxed mb-5" style={{ color: C.textMuted }}>
            Large selections are held for the current tab only, so they don&apos;t survive a new
            tab or a shared link. Nothing was created — pick the leads again and the flow will
            carry on from there.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => router.push(`/campaigns/new/${profileId}/pick`)}
              className="px-3.5 py-2 rounded-lg text-[12px] font-semibold"
              style={{ backgroundColor: C.textPrimary, color: C.card }}
            >
              Pick leads again
            </button>
            <button
              onClick={() => router.push("/campaigns")}
              className="px-3.5 py-2 rounded-lg text-[12px] font-medium border"
              style={{ borderColor: C.border, color: C.textMuted }}
            >
              Back to Campaigns
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Wizard pre-step: until the seller picks a flow type, front the wizard
  // with FlowTypePicker. Generic = legacy behavior (default). Tailored =
  // unlock per-lead AI hooks + new Step 3 review surface.
  if (flowType === null) {
    return (
      <div className="p-6 w-full">
        <FlowTypePicker
          profileName={profile?.profile_name ?? null}
          leadsCount={leadsCount}
          onChoose={setFlowType}
          onBack={() => router.push("/campaigns")}
        />
      </div>
    );
  }

  return (
    <div className="p-6 w-full">
      <button onClick={() => router.push("/campaigns")} className="flex items-center gap-1.5 text-[11px] font-medium mb-3 transition-colors hover:opacity-80" style={{ color: C.textMuted }}>
        <ArrowLeft size={12} /> Back to Campaigns
      </button>

      {/* Header card — gold-accented panel so the wizard's "you're configuring
          this flow for X leads" context reads as one cohesive block instead
          of plain text floating above the steps. Filters out empty lead
          names (happens when leads are client-source / encrypted and the
          plain columns are null) so we don't render blank pills. */}
      {(() => {
        const visibleNames = selectedLeadNames.filter(n => n && n.trim().length > 0);
        return (
          <div
            className="mb-5 rounded-2xl border px-5 py-4 relative overflow-hidden"
            style={{
              background: `
                radial-gradient(ellipse 40% 100% at 0% 0%, color-mix(in srgb, ${gold} 12%, transparent) 0%, transparent 65%),
                linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${C.card} 97%, ${gold}) 100%)
              `,
              borderColor: `color-mix(in srgb, ${gold} 26%, ${C.border})`,
              boxShadow: `0 2px 14px -8px color-mix(in srgb, ${gold} 30%, transparent)`,
            }}
          >
            {/* Gold left edge stripe */}
            <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: `linear-gradient(180deg, ${gold}, color-mix(in srgb, ${gold} 50%, transparent))` }} />
            <div className="flex items-center gap-3 flex-wrap">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={flowType === "tailored"
                  ? { background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`, color: "#1A1A2E", boxShadow: `0 3px 10px color-mix(in srgb, ${gold} 32%, transparent)` }
                  : { backgroundColor: `color-mix(in srgb, ${gold} 14%, transparent)`, color: gold }}
              >
                {flowType === "tailored" ? <Sparkles size={16} /> : <Megaphone size={16} />}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-[18px] font-bold leading-tight" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                  Configure Outreach Flow
                </h1>
                <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
                  <span style={{ color: C.textBody, fontWeight: 600 }}>{profile?.profile_name}</span>
                  {" · "}
                  <span style={{ color: gold, fontWeight: 700 }}>{leadsCount}</span>
                  {" "}{isPartialSelection ? "selected" : ""} lead{leadsCount === 1 ? "" : "s"}
                </p>
              </div>
              {/* Flow-type badge — large, prominent, clickable to switch
                  Generic ↔ Tailored. Two-line: mode name on top, "Change"
                  hint below. Much more visible than the small chip we
                  had before. */}
              <button
                type="button"
                onClick={() => {
                  // Switching flow type invalidates the per-lead preview
                  // outputs (they were generated against the previous mode
                  // and previous template). Clearing avoids submitting
                  // stale tailored slots into a generic flow or vice versa.
                  setPreviewOutputs({});
                  setFlowType(null);
                }}
                className="shrink-0 flex flex-col items-end gap-0.5 px-4 py-2 rounded-xl transition-opacity hover:opacity-85"
                title="Change flow type"
                style={flowType === "tailored"
                  ? {
                      background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`,
                      color: "#1A1A2E",
                      boxShadow: `0 4px 14px -4px color-mix(in srgb, ${gold} 45%, transparent)`,
                    }
                  : {
                      backgroundColor: `color-mix(in srgb, ${C.green} 12%, ${C.surface})`,
                      color: C.green,
                      border: `1.5px solid color-mix(in srgb, ${C.green} 28%, transparent)`,
                    }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{flowType === "tailored" ? "✨" : "⚡"}</span>
                  <span className="text-[13px] font-extrabold uppercase tracking-wider" style={{ fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                    {flowType === "tailored" ? "Tailored Flow" : "Generic Flow"}
                  </span>
                </div>
                <span className="text-[9px] font-semibold uppercase tracking-wider opacity-80">
                  {flowType === "tailored" ? "AI per-lead · click to change" : "One template · click to change"}
                </span>
              </button>
            </div>
            {/* Only render the chip strip if we actually have names. For
                encrypted/client-source leads the plain columns are null and
                rendering empty pills looked broken. */}
            {isPartialSelection && visibleNames.length > 0 && (
              <div className="mt-3 pt-3 border-t flex flex-wrap gap-1.5" style={{ borderColor: `color-mix(in srgb, ${gold} 18%, ${C.border})` }}>
                {visibleNames.slice(0, 8).map((name, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 rounded-full border"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${gold} 10%, transparent)`,
                      borderColor: `color-mix(in srgb, ${gold} 22%, transparent)`,
                      color: gold,
                    }}>{name}</span>
                ))}
                {visibleNames.length > 8 && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: C.bg, color: C.textMuted, border: `1px solid ${C.border}` }}>
                    +{visibleNames.length - 8} more
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Draft-restored notice — surfaces when we recovered a work-in-progress
          from sessionStorage so the seller knows their fields aren't fresh
          defaults. Dismissable; also auto-disappears when they navigate. */}
      {draftRestored && (
        <div className="mb-4 rounded-xl border px-4 py-2.5 flex items-center gap-3"
          style={{ backgroundColor: `color-mix(in srgb, ${gold} 6%, transparent)`, borderColor: `color-mix(in srgb, ${gold} 25%, transparent)` }}>
          <span className="text-xs font-semibold" style={{ color: gold }}>Draft restored</span>
          <span className="text-xs" style={{ color: C.textMuted }}>
            We restored your work in progress. To start fresh, discard the draft.
          </span>
          <button
            type="button"
            onClick={() => {
              try { sessionStorage.removeItem(draftKey); } catch { /* no-op */ }
              // Reset to defaults
              setCampaignName("");
              setSequence([
                { channel: "linkedin", daysAfter: 0 },
                { channel: "email", daysAfter: 3 },
                { channel: "linkedin", daysAfter: 3 },
              ]);
              setChannelMessages({ steps: [], autoReplies: { positive: "", negative: "", question: "" } });
              setSelectedSignals([]);
              setWizardStep(0);
              setFlowType(null);
              setPreviewOutputs({});
              setDraftRestored(false);
            }}
            className="ml-auto text-xs font-medium hover:underline"
            style={{ color: C.textMuted }}
          >
            Discard draft
          </button>
        </div>
      )}

      {/* Step indicator — sticky so the seller always knows where they are
          in the wizard. Background + border subtly differ by flow mode:
          Tailored has a stronger gold tint to reinforce the AI-per-lead
          identity throughout the wizard chrome. */}
      <div className="sticky top-2 z-30 mb-5 rounded-2xl border px-5 py-4 relative overflow-hidden"
        style={flowType === "tailored" ? {
          background: `
            radial-gradient(ellipse 80% 110% at 100% 0%, color-mix(in srgb, ${gold} 18%, transparent) 0%, transparent 55%),
            linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${C.card} 92%, ${gold}) 100%)
          `,
          borderColor: `color-mix(in srgb, ${gold} 45%, ${C.border})`,
          boxShadow: `0 8px 28px -10px color-mix(in srgb, ${gold} 32%, transparent), 0 2px 6px rgba(0,0,0,0.04)`,
        } : {
          background: `
            radial-gradient(ellipse 70% 100% at 100% 0%, color-mix(in srgb, ${gold} 9%, transparent) 0%, transparent 55%),
            linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${C.card} 97%, ${gold}) 100%)
          `,
          borderColor: `color-mix(in srgb, ${gold} 22%, ${C.border})`,
          boxShadow: "0 6px 22px -10px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.04)",
        }}>
        {/* Progress fill — visualizes how far into the wizard the seller is. */}
        <div className="absolute left-0 bottom-0 h-1" style={{ width: `${((wizardStep + 1) / WIZARD_STEPS.length) * 100}%`, background: `linear-gradient(90deg, ${gold}, color-mix(in srgb, ${gold} 60%, white))`, transition: "width 240ms ease" }} />
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 78%, white))`, color: "#04070d", boxShadow: `0 3px 10px color-mix(in srgb, ${gold} 32%, transparent)` }}>
              <span className="text-sm font-bold tabular-nums">{wizardStep + 1}</span>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: gold }}>
                Step {wizardStep + 1} of {WIZARD_STEPS.length}
              </p>
              <p className="text-base font-bold leading-tight" style={{ color: C.textPrimary, fontFamily: "var(--font-outfit), system-ui, sans-serif" }}>
                {WIZARD_STEPS[wizardStep]}
              </p>
            </div>
          </div>
          <p className="text-[11px] max-w-md text-right" style={{ color: C.textMuted }}>
            {wizardStep === 0 && "Pick channels + timing for every step in the sequence."}
            {wizardStep === 1 && "Choose seller(s) and the channel accounts that will deliver this flow."}
            {wizardStep === 2 && "Write the message body for each step. AI can draft from your tone + lead data."}
            {wizardStep === 3 && "Review the full flow before launching. You can still jump back to edit anything."}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {WIZARD_STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <button onClick={() => i < wizardStep && setWizardStep(i)} disabled={i > wizardStep}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold transition-[opacity,transform,box-shadow,background-color,border-color]"
                style={i === wizardStep
                  ? { backgroundColor: gold, color: "#04070d", boxShadow: `0 2px 8px color-mix(in srgb, ${gold} 30%, transparent)` }
                  : i < wizardStep
                  ? { backgroundColor: `color-mix(in srgb, ${C.green} 14%, transparent)`, color: C.green, border: `1px solid color-mix(in srgb, ${C.green} 30%, transparent)` }
                  : { backgroundColor: C.card, color: C.textDim, border: `1px solid ${C.border}` }}>
                {i < wizardStep ? <Check size={12} /> : <span>{i + 1}</span>}
                {s}
              </button>
              {i < WIZARD_STEPS.length - 1 && <div className="w-6 h-px" style={{ backgroundColor: i < wizardStep ? `color-mix(in srgb, ${C.green} 40%, transparent)` : C.border }} />}
            </div>
          ))}
        </div>
      </div>

      {/* ═══ STEP 0: SEQUENCE BUILDER (with flow name) ═══ */}
      {/* Express mode removed 2026-05-22 — auto-jumping past Settings could
          create misconfigured flows for tenants with multiple sellers or
          custom channel accounts. Restore later behind a feature flag once
          we have the right guardrails. */}
      {wizardStep === 0 && (
        <div className="space-y-4">
          {/* Flow name + templates combined — 2 visual fragments collapsed into
              one card to reduce stacked-card noise. */}
          <div className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: C.textMuted }}>
              Flow Name <span style={{ color: gold }}>· required</span>
            </label>
            <div className="flex gap-2 flex-wrap">
              <input
                type="text"
                value={campaignName}
                onChange={e => setCampaignName(e.target.value)}
                placeholder="e.g. LATAM SaaS Leaders — LinkedIn + Email"
                className="flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold focus:outline-none"
                style={{
                  color: C.textPrimary,
                  backgroundColor: C.bg,
                  // Marked from the start instead of rejecting on Next with a
                  // banner, which is how the author used to find out.
                  border: `1px solid ${campaignName.trim() ? C.border : "color-mix(in srgb, #D97706 55%, var(--c-border))"}`,
                  minWidth: 220,
                }}
              />
              {!campaignName.trim() && suggestedName && (
                <button type="button" onClick={() => setCampaignName(suggestedName)}
                  className="rounded-lg px-3 py-2.5 text-[12px] font-bold whitespace-nowrap"
                  style={{
                    border: `1px dashed color-mix(in srgb, ${gold} 40%, transparent)`,
                    backgroundColor: `color-mix(in srgb, ${gold} 7%, transparent)`,
                    color: gold,
                  }}>
                  Use &ldquo;{suggestedName}&rdquo;
                </button>
              )}
            </div>
            <p className="text-[11px] mt-1.5" style={{ color: campaignName.trim() ? C.textDim : "#D97706" }}>
              Sellers find this flow by name in the Inbox and in Results.
            </p>

            {/* Language belongs here, not next to the message editor: it is a
                language-lock sent to the generator, so it only does anything
                BEFORE the copy is drafted. Picking it afterwards did nothing. */}
            <div className="mt-4 pt-4 border-t" style={{ borderColor: C.border }}>
              <label className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: C.textMuted }}>
                Message language
              </label>
              <div className="flex items-center gap-3 flex-wrap">
                <select value={language} onChange={e => setLanguage(e.target.value)}
                  className="rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none"
                  style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}>
                  <option value="es">Español</option>
                  <option value="en">English</option>
                  <option value="it">Italiano</option>
                  <option value="pt">Português</option>
                </select>
                <p className="text-[11px] flex-1" style={{ color: C.textDim, minWidth: 200 }}>
                  Locks the language the AI drafts in. Set it before drafting.
                </p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t" style={{ borderColor: C.border }}>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: C.textMuted }}>Start from a template</p>
              {icpTemplates.length > 0 && (
                <div className="mb-3">
                  <label className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 block" style={{ color: gold }}>
                    Saved templates for this ICP
                  </label>
                  <select
                    defaultValue=""
                    onChange={async e => {
                      const id = e.target.value;
                      if (!id) return;
                      try {
                        const res = await fetch(`/api/templates/${id}`, { cache: "no-store" });
                        if (!res.ok) return;
                        const { template } = await res.json();
                        if (template) applyTemplate(template);
                      } catch {}
                    }}
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    style={{ borderColor: `color-mix(in srgb, ${gold} 30%, transparent)`, backgroundColor: `color-mix(in srgb, ${gold} 4%, transparent)`, color: C.textPrimary }}>
                    <option value="">— Pick a saved template —</option>
                    {icpTemplates.map(tpl => (
                      <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                    ))}
                  </select>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5 mt-3" style={{ color: C.textMuted }}>
                    Generic presets
                  </p>
                </div>
              )}
              {/* Each preset shows its own cadence before you apply it —
                  channels as dots, the wait between them as the gap. You used
                  to have to apply one to find out what it did, and applying
                  wiped whatever you had built with no way back. */}
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(158px, 1fr))" }}>
                {sequenceTemplates.map(tpl => {
                  const totalWait = tpl.steps.reduce((a, st, j) => a + (j === 0 ? 0 : st.daysAfter), 0);
                  const chans = [...new Set(tpl.steps.map(st => st.channel))].length;
                  return (
                    <button key={tpl.name} type="button"
                      onClick={() => applyPreset(tpl)}
                      className="rounded-lg border px-3 py-2.5 text-left flex flex-col gap-2 transition-[transform,box-shadow,border-color] hover:-translate-y-px hover:shadow-sm"
                      style={{ borderColor: C.border, backgroundColor: C.bg }}>
                      <p className="text-[12.5px] font-bold" style={{ color: C.textPrimary }}>{tpl.name}</p>
                      <span className="flex items-center h-3" aria-hidden>
                        {tpl.steps.map((st, j) => {
                          const col = channelOptions.find(c => c.key === st.channel)?.color ?? C.border;
                          return (
                            <span key={j} className="flex items-center" style={{ flexGrow: j === 0 ? 0 : Math.max(1, st.daysAfter) }}>
                              {j > 0 && <span className="h-px flex-1 min-w-[5px]" style={{ backgroundColor: C.border2 }} />}
                              <span className="rounded-full shrink-0" style={{ width: 8, height: 8, backgroundColor: col }} />
                            </span>
                          );
                        })}
                      </span>
                      <p className="text-[10.5px] tabular-nums" style={{ color: C.textDim }}>
                        {tpl.steps.length} steps · {totalWait} days · {chans} channel{chans === 1 ? "" : "s"}
                      </p>
                    </button>
                  );
                })}
              </div>
              {presetUndo && (
                <p className="flex items-center gap-2 text-[11.5px] mt-2.5" style={{ color: C.textMuted }}>
                  Applied <b style={{ color: C.textPrimary }}>{presetUndo.name}</b> — replaced {presetUndo.steps.length} step{presetUndo.steps.length === 1 ? "" : "s"}.
                  <button type="button" onClick={undoPreset} className="font-bold underline" style={{ color: gold }}>Undo</button>
                </p>
              )}
            </div>
          </div>

          <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
            {/* hasCR: when seq[0] is a LinkedIn D0 step, treat it as the
                Connection Request (the invite that opens the sequence) and
                pull it out of the numbered step list. This mirrors the
                template-detail page: CR is structurally different from a
                follow-up and lumping it in as "Step 1" was the source of
                every off-by-one bug in the wizard apply path. */}
            {/* ── THE RAIL ──────────────────────────────────────────────
                One list, one numbering. The invite is step 00 of the same
                sequence instead of a card above it with its own scheme —
                the builder numbered follow-ups from 1 while the Timeline
                Preview below counted the invite as "Step 1", so the two
                panels described the same sequence and disagreed. The rail
                IS the timeline now, so that second panel is gone.

                sequence[0] is still the Connection Request when it's a
                LinkedIn day-0 step: the data model is untouched, only the
                rendering changed. */}
            {(() => {
              const hasCR = sequence[0]?.channel === "linkedin" && sequence[0]?.daysAfter === 0;
              const followupCount = hasCR ? sequence.length - 1 : sequence.length;
              const channelCount = [...new Set(sequence.map(s => s.channel))].length;
              const canDropInvite = hasCR
                && sequence.length > 1
                && !sequence.slice(1).some(s => s.channel === "linkedin");
              return (
                <>
                  <div className="flex items-end justify-between gap-3 mb-3 flex-wrap">
                    <div>
                      <h2 className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>The sequence</h2>
                      <p className="text-[11px] mt-0.5" style={{ color: C.textDim }}>
                        Channel and timing per step. The day on the left is when it goes out.
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      {days.some((d, i) => i > 0 && stepCalendarDate(d).isWeekend) && (
                        <button
                          type="button"
                          onClick={shiftOffWeekends}
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors"
                          style={{
                            backgroundColor: "color-mix(in srgb, #D97706 10%, transparent)",
                            color: "#D97706",
                            border: "1px solid color-mix(in srgb, #D97706 28%, transparent)",
                          }}
                          title="Add a day or two to every step that lands on a Saturday or Sunday"
                        >
                          <AlertTriangle size={11} /> Shift all off weekends
                        </button>
                      )}
                      <p className="text-[11px] tabular-nums" style={{ color: C.textMuted }}>
                        {sequence.length} stop{sequence.length === 1 ? "" : "s"}
                        {hasCR ? ` (invite + ${followupCount})` : ""} · {totalDays} days · {channelCount} channel{channelCount === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>

                  <div className="relative">
                    {/* Spine — the line every stop hangs off. */}
                    <div
                      aria-hidden
                      className="absolute w-0.5"
                      style={{
                        left: 55, top: 8, bottom: 34,
                        background: `linear-gradient(180deg, color-mix(in srgb, ${gold} 38%, transparent), ${C.border})`,
                      }}
                    />
                    {sequence.map((s, i) => {
                      const isInvite = hasCR && i === 0;
                      const ch = channelOptions.find(c => c.key === s.channel)!;
                      const { label: dateLabel, isWeekend } = stepCalendarDate(days[i]);
                      return (
                        <div key={i} className="relative grid items-center gap-3.5" style={{ gridTemplateColumns: "40px 1fr", marginTop: i === 0 ? 0 : 18 }}>
                          {/* Day, to the left of the spine — this is what the
                              old design buried in a chip on the far right. */}
                          <div className="text-right pr-2 leading-tight">
                            <span className="block text-[10px] font-bold" style={{ color: C.textDim }}>day</span>
                            <span className="block text-[15px] font-bold tabular-nums" style={{ color: C.textMuted }}>{days[i]}</span>
                          </div>
                          {/* Node on the spine */}
                          <span
                            aria-hidden
                            className="absolute rounded-full"
                            style={{
                              left: 50, top: "50%", transform: "translateY(-50%)",
                              width: 12, height: 12, backgroundColor: C.card,
                              border: `2.5px solid ${ch.color}`, zIndex: 2,
                            }}
                          />
                          <div
                            className="ml-5 rounded-lg px-3.5 py-2.5 flex items-center gap-3 flex-wrap"
                            style={{
                              backgroundColor: isInvite ? "transparent" : C.card,
                              border: `1px ${isInvite ? "dashed" : "solid"} ${isInvite ? `color-mix(in srgb, ${ch.color} 30%, ${C.border})` : C.border}`,
                            }}
                          >
                            <span className="text-[12px] font-extrabold tabular-nums tracking-wide" style={{ color: C.textMuted, minWidth: 22 }}>
                              {String(i).padStart(2, "0")}
                            </span>

                            {isInvite ? (
                              <>
                                <span className="text-[9.5px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded"
                                  style={{ backgroundColor: `color-mix(in srgb, ${ch.color} 12%, transparent)`, color: ch.color }}>
                                  Invitation
                                </span>
                                <span className="text-[12px]" style={{ color: C.textMuted }}>
                                  LinkedIn · opens the sequence · max 200 chars
                                </span>
                              </>
                            ) : (
                              <div className="inline-flex gap-1 p-0.5 rounded-lg" style={{ backgroundColor: C.surface, border: `1px solid ${C.border}` }}>
                                {channelOptions.map(opt => {
                                  const OptIcon = opt.icon;
                                  const on = s.channel === opt.key;
                                  return (
                                    <button key={opt.key} type="button" onClick={() => updateStep(i, "channel", opt.key)}
                                      aria-pressed={on}
                                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors"
                                      style={on ? { backgroundColor: opt.color, color: "#fff" } : { color: C.textMuted }}>
                                      <OptIcon size={12} />
                                      {opt.label}
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {/* Wait */}
                            <div className="ml-auto flex items-center gap-2 flex-wrap">
                              {i === 0 ? (
                                <span className="text-[11.5px]" style={{ color: C.textMuted }}>Starts on day 0</span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: C.textMuted }}>
                                  Wait
                                  <select
                                    className="rounded-md border px-2 py-1 text-[11.5px] font-semibold focus:outline-none"
                                    style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.bg }}
                                    value={s.daysAfter}
                                    onChange={e => updateStep(i, "daysAfter", Number(e.target.value))}
                                  >
                                    {[...new Set([s.daysAfter, 0, 1, 2, 3, 4, 5, 7, 10, 14, 21])].sort((a, b) => a - b).map(d => (
                                      <option key={d} value={d}>{d === 0 ? "same day" : `${d} ${d === 1 ? "day" : "days"}`}</option>
                                    ))}
                                  </select>
                                </span>
                              )}
                              <span className="text-[11.5px] tabular-nums text-right" style={{ color: C.textDim, minWidth: 104 }}>{dateLabel}</span>

                              {/* The weekend is now an action, not a notice. */}
                              {isWeekend && i > 0 && (
                                <button
                                  type="button"
                                  onClick={() => pushToWeekday(i)}
                                  title="Move this step to the next weekday"
                                  className="inline-flex items-center gap-1 text-[10.5px] font-bold px-2 py-0.5 rounded-full transition-colors"
                                  style={{
                                    backgroundColor: "color-mix(in srgb, #D97706 12%, transparent)",
                                    color: "#D97706",
                                    border: "1px solid color-mix(in srgb, #D97706 30%, transparent)",
                                  }}
                                >
                                  <AlertTriangle size={10} /> weekend → Monday
                                </button>
                              )}

                              {isInvite
                                ? (canDropInvite ? (
                                    <button type="button" onClick={removeConnectionRequest}
                                      title="This sequence doesn't use LinkedIn — remove the invitation"
                                      className="opacity-40 hover:opacity-100 transition-opacity" style={{ color: C.red }}>
                                      <Trash2 size={14} />
                                    </button>
                                  ) : (
                                    <span title="You have to connect before you can DM, so the invitation stays" style={{ color: C.textDim }}>
                                      <Lock size={12} />
                                    </span>
                                  ))
                                : sequence.length > 1 && (
                                    <button onClick={() => removeStep(i)} className="opacity-30 hover:opacity-100 transition-opacity"
                                      style={{ color: C.red }} title="Remove step">
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}

            {/* Add step */}
            <button onClick={addStep}
              className="flex items-center gap-2 mt-3 rounded-lg px-4 py-2.5 text-xs font-medium w-full justify-center transition-opacity hover:opacity-80 border border-dashed"
              style={{ borderColor: C.border, color: C.textMuted }}>
              <Plus size={14} /> Add Step
            </button>
          </div>

          {/* The rail above IS the timeline, so the duplicated Timeline
              Preview panel that used to sit here is gone. What stays is the
              channel-coverage check: it answers a different question —
              whether the leads can even be reached on the channels chosen. */}
          <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Reach of this selection</p>
            <p className="text-[11px] mb-3" style={{ color: C.textDim }}>
              {leadsCount} leads · {sequence.length} steps · {totalDays} days · {[...new Set(sequence.map(s => s.channel))].length} channels
            </p>

            {/* Channel coverage warnings — surface missing data BEFORE launch.
                Per-channel breakdown with the actual lead names that will be
                blocked. Different leads may fail on different channels (a lead
                with email-only but no LinkedIn appears under LinkedIn only). */}
            {(() => {
              const usedChannels = [...new Set(sequence.map(s => s.channel))] as Array<"linkedin" | "email" | "call" | "whatsapp">;
              const gaps = usedChannels
                .map(ch => ({ ch, reachable: coverage[ch], blockedNames: coverage.missing[ch] }))
                .filter(x => x.blockedNames.length > 0);
              if (gaps.length === 0 || coverage.total === 0 || coverageWarningDismissed) return null;
              const label = (ch: string) => channelOptions.find(o => o.key === ch)?.label ?? ch;
              const color = (ch: string) => channelOptions.find(o => o.key === ch)?.color ?? "#64748B";
              const PREVIEW = 6;
              return (
                <div className="mt-4 rounded-lg border p-4"
                  style={{ borderColor: "color-mix(in srgb, #D97706 30%, transparent)", backgroundColor: "color-mix(in srgb, #D97706 13%, transparent)" }}>
                  <div className="flex items-start gap-2.5 mb-3">
                    <AlertTriangle size={16} style={{ color: "#D97706" }} className="shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-bold mb-0.5" style={{ color: "#92400E" }}>
                        Some leads can&apos;t be reached on every channel in this sequence.
                      </p>
                      <p className="text-xs" style={{ color: "#92400E" }}>
                        For each channel below, the listed leads will sit blocked on the steps that use it — they won&apos;t fail loudly, they just won&apos;t send. A lead with only email and no LinkedIn would appear under LinkedIn only.
                      </p>
                    </div>
                    <button onClick={() => setCoverageWarningDismissed(true)}
                      className="shrink-0 opacity-50 hover:opacity-100 transition-opacity ml-1"
                      style={{ color: "#92400E" }}>
                      ✕
                    </button>
                  </div>

                  <div className="space-y-2.5 pl-7">
                    {gaps.map(g => {
                      const shown = g.blockedNames.slice(0, PREVIEW);
                      const extra = g.blockedNames.length - shown.length;
                      return (
                        <div key={g.ch} className="rounded-md border bg-white p-2.5"
                          style={{ borderColor: "color-mix(in srgb, #D97706 30%, transparent)" }}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: color(g.ch) }}>
                              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color(g.ch) }} />
                              {label(g.ch)}
                              <span className="font-medium" style={{ color: "#78350F" }}>
                                · {g.reachable} / {coverage.total} reachable
                              </span>
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => setSequence(s => s.filter(step => step.channel !== g.ch))}
                                className="text-[10px] font-semibold px-2 py-0.5 rounded border transition-colors hover:bg-red-50"
                                style={{ borderColor: "#DC2626", color: "#DC2626" }}>
                                Remove {label(g.ch)} steps
                              </button>
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                                style={{ backgroundColor: "#DC2626", color: "#fff" }}>
                                {g.blockedNames.length} blocked
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {shown.map((n, idx) => (
                              <span key={idx} className="text-[10px] px-1.5 py-0.5 rounded"
                                style={{ backgroundColor: "color-mix(in srgb, #6B7280 14%, transparent)", color: "#374151" }}>{n}</span>
                            ))}
                            {extra > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                                style={{ color: "#78350F" }}>+ {extra} more</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ═══ STEP 1: SETTINGS (Seller + Channel Accounts) ═══ */}
      {wizardStep === 1 && (() => {
        const usedChannels = [...new Set(sequence.map(s => s.channel))];
        const selectedSellerObj = sellers.find(s => s.id === (sellerQuotas[0]?.sellerId ?? ""));

        return (
          <div className="space-y-5">
            <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
              <div className="flex items-center gap-2 mb-1">
                <Settings size={15} style={{ color: gold }} />
                <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Flow Settings</h2>
              </div>
              <p className="text-xs mb-6" style={{ color: C.textDim }}>
                Choose who will run this outreach flow and which accounts to use for each channel.
              </p>

              {/* Multi-seller with quotas */}
              {(() => {
                const totalCap = sellerQuotas.reduce((s, q) => s + q.quota, 0);
                const unallocated = leadsCount - totalCap;
                const isOver = totalCap > leadsCount && leadsCount > 0;
                const isExact = totalCap === leadsCount && leadsCount > 0;

                function handleQuotaChange(idx: number, raw: string) {
                  const val = Math.max(1, parseInt(raw || "1", 10));
                  // With 2 sellers auto-fill the other to cover the total
                  if (sellerQuotas.length === 2 && leadsCount > 0) {
                    const otherIdx = idx === 0 ? 1 : 0;
                    const otherVal = Math.max(1, leadsCount - val);
                    setSellerQuotas(prev => prev.map((q, i) =>
                      i === idx ? { ...q, quota: val } : i === otherIdx ? { ...q, quota: otherVal } : q
                    ));
                  } else {
                    updateSellerQuota(idx, { quota: val });
                  }
                }

                return (
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <label className="text-xs font-semibold uppercase tracking-wider block" style={{ color: C.textMuted }}>Assigned Salesperson(s)</label>
                        <p className="text-xs mt-0.5" style={{ color: C.textDim }}>
                          {leadsCount > 0 ? `${leadsCount} leads to assign — the salesperson who owns each lead: their LinkedIn sends AND they make the calls` : "The salesperson who owns each lead — their LinkedIn sends and they make the calls. Split across people below."}
                        </p>
                      </div>
                      {sellerQuotas.length < sellers.length && (
                        <button onClick={addSellerQuota}
                          className="text-[11px] font-semibold px-2.5 py-1 rounded-md border inline-flex items-center gap-1 shrink-0"
                          style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.bg }}>
                          <Plus size={11} /> Add seller
                        </button>
                      )}
                    </div>

                    <div className="space-y-2">
                      {sellerQuotas.length === 0 && sellers.length === 0 && (
                        <p className="text-xs text-center py-3 rounded-lg border border-dashed" style={{ color: C.textDim, borderColor: C.border }}>
                          No active sellers configured. Go to <b>Accounts → Sellers</b> and add one first.
                        </p>
                      )}
                      {sellerQuotas.length === 0 && sellers.length > 0 && (
                        <p className="text-xs text-center py-3 rounded-lg border border-dashed" style={{ color: C.textDim, borderColor: C.border }}>
                          No sellers added yet. Click <b>Add seller</b>.
                        </p>
                      )}
                      {sellerQuotas.map((q, idx) => {
                        const clr = SELLER_COLORS[idx % SELLER_COLORS.length];
                        const usedIds = new Set(sellerQuotas.filter((_, i) => i !== idx).map(x => x.sellerId));
                        const sellerObj = sellers.find(s => s.id === q.sellerId);
                        const needsLinkedin = usedChannels.includes("linkedin");
                        const missingLinkedin = needsLinkedin && !sellerObj?.unipile_account_id;
                        const pct = leadsCount > 0 ? Math.round((q.quota / leadsCount) * 100) : 0;
                        return (
                          <div key={idx} className="rounded-xl border px-4 py-3"
                            style={{ borderColor: clr.text + "35", backgroundColor: clr.bg + "50" }}>
                            <div className="flex items-center gap-3">
                              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: clr.text }} />
                              <select value={q.sellerId}
                                onChange={e => updateSellerQuota(idx, { sellerId: e.target.value })}
                                className="text-sm font-medium rounded-lg border px-2 py-1.5 outline-none flex-1"
                                style={{ borderColor: clr.text + "25", backgroundColor: C.card, color: C.textBody }}>
                                {sellers.filter(s => s.id === q.sellerId || !usedIds.has(s.id)).map(s => (
                                  <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                              </select>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <input type="number" min={1} max={leadsCount || undefined} value={q.quota}
                                  onChange={e => handleQuotaChange(idx, e.target.value)}
                                  className="w-16 text-sm font-bold rounded-lg border px-2 py-1.5 outline-none tabular-nums text-center"
                                  style={{ borderColor: clr.text + "40", backgroundColor: C.card, color: C.textBody }} />
                                <span className="text-xs" style={{ color: C.textMuted }}>leads</span>
                                {leadsCount > 0 && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                    style={{ backgroundColor: clr.text + "18", color: clr.text }}>
                                    {pct}%
                                  </span>
                                )}
                              </div>
                              {missingLinkedin && (
                                <span className="text-[9px] font-bold shrink-0" style={{ color: C.red }}>No LinkedIn</span>
                              )}
                              {sellerQuotas.length > 1 && (
                                <button onClick={() => removeSellerQuota(idx)} className="p-1 rounded shrink-0 opacity-30 hover:opacity-100 transition-opacity"
                                  style={{ color: C.red }}>
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </div>

                            {/* Per-seller progress bar */}
                            {leadsCount > 0 && (
                              <div className="mt-2.5 ml-5">
                                <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: clr.text + "18" }}>
                                  <div className="h-full rounded-full transition-all duration-200"
                                    style={{ width: `${Math.min(100, pct)}%`, backgroundColor: clr.text }} />
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Total summary bar */}
                    {sellerQuotas.length > 0 && leadsCount > 0 && (
                      <div className="mt-3 rounded-xl border px-4 py-3" style={{ backgroundColor: C.bg, borderColor: C.border }}>
                        {/* Stacked bar */}
                        <div className="flex h-2 rounded-full overflow-hidden mb-2.5 gap-px">
                          {sellerQuotas.map((q, idx) => {
                            const clr = SELLER_COLORS[idx % SELLER_COLORS.length];
                            const w = Math.min(100, (q.quota / leadsCount) * 100);
                            return <div key={idx} className="h-full transition-all duration-200" style={{ width: `${w}%`, backgroundColor: clr.text }} />;
                          })}
                          {unallocated > 0 && (
                            <div className="h-full flex-1" style={{ backgroundColor: C.border }} />
                          )}
                        </div>
                        {/* Legend */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-wrap">
                            {sellerQuotas.map((q, idx) => {
                              const clr = SELLER_COLORS[idx % SELLER_COLORS.length];
                              const sel = sellers.find(s => s.id === q.sellerId);
                              return (
                                <span key={idx} className="flex items-center gap-1 text-[10px] font-semibold">
                                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: clr.text }} />
                                  <span style={{ color: C.textMuted }}>{sel?.name ?? "—"} · {q.quota}</span>
                                </span>
                              );
                            })}
                          </div>
                          <span className="text-[11px] font-bold tabular-nums"
                            style={{ color: isExact ? C.green : isOver ? C.red : "#D97706" }}>
                            {totalCap}/{leadsCount}
                            {isExact && " ✓"}
                            {isOver && " · over cap"}
                            {!isExact && !isOver && ` · ${unallocated} unassigned`}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Channel accounts (based on selected seller + used channels) */}
              {sellerQuotas.length > 0 && (
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider block mb-2" style={{ color: C.textMuted }}>Channel Accounts</label>
                  <p className="text-xs mb-4" style={{ color: C.textDim }}>These accounts will be used to send messages for each channel in your sequence.</p>
                  <div className="space-y-3">
                    {usedChannels.map(ch => {
                      const meta = channelOptions.find(c => c.key === ch);
                      if (!meta) return null;
                      const Icon = meta.icon;

                      // For LinkedIn: collect all assigned sellers with a Unipile account.
                      // For other channels: single shared account.
                      if (ch === "linkedin") {
                        const assignedSellers = sellerQuotas
                          .map(q => sellers.find(s => s.id === q.sellerId))
                          .filter(Boolean) as typeof sellers;
                        const withLi = assignedSellers.filter(s => s.unipile_account_id);
                        const missingLi = assignedSellers.filter(s => !s.unipile_account_id);
                        const isConfigured = withLi.length > 0;
                        return (
                          <div key={ch} className="rounded-xl border p-4"
                            style={{ borderColor: isConfigured ? `${meta.color}30` : C.red + "30", backgroundColor: isConfigured ? `${meta.color}04` : `${C.red}04` }}>
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${meta.color}15` }}>
                                <Icon size={18} style={{ color: meta.color }} />
                              </div>
                              <div className="flex-1">
                                <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>LinkedIn</p>
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                  {withLi.map(s => (
                                    <span key={s.id} className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                                      style={{ backgroundColor: `${meta.color}15`, color: meta.color }}>
                                      {s.name}
                                    </span>
                                  ))}
                                  {missingLi.map(s => (
                                    <span key={s.id} className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                                      style={{ backgroundColor: C.redLight, color: C.red }}>
                                      {s.name} — no account
                                    </span>
                                  ))}
                                </div>
                              </div>
                              {isConfigured ? (
                                <span className="text-[10px] font-semibold flex items-center gap-1 px-2.5 py-1 rounded-full shrink-0" style={{ backgroundColor: C.greenLight, color: C.green }}>
                                  <Check size={10} /> Ready
                                </span>
                              ) : (
                                <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full shrink-0" style={{ backgroundColor: C.redLight, color: C.red }}>
                                  Missing
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      }

                      let accountLabel = "Not configured";
                      let isConfigured = false;

                      if (ch === "email") {
                        accountLabel = "Instantly — Shared pool";
                        isConfigured = true;
                      } else if (ch === "call") {
                        accountLabel = "Aircall — shared SWL number";
                        isConfigured = true;
                      }

                      return (
                        <div key={ch} className="flex items-center gap-4 rounded-xl border p-4"
                          style={{ borderColor: isConfigured ? `${meta.color}30` : C.red + "30", backgroundColor: isConfigured ? `${meta.color}04` : `${C.red}04` }}>
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${meta.color}15` }}>
                            <Icon size={18} style={{ color: meta.color }} />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{meta.label}</p>
                            <p className="text-xs" style={{ color: isConfigured ? C.textMuted : C.red }}>
                              {accountLabel}
                            </p>
                          </div>
                          {isConfigured ? (
                            <span className="text-[10px] font-semibold flex items-center gap-1 px-2.5 py-1 rounded-full" style={{ backgroundColor: C.greenLight, color: C.green }}>
                              <Check size={10} /> Ready
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: C.redLight, color: C.red }}>
                              Missing
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {usedChannels.includes("call") && (
                    <div className="mt-4">
                      <label className="text-xs font-semibold uppercase tracking-wider block mb-2" style={{ color: C.textMuted }}>Call Step Behavior</label>
                      <p className="text-xs mb-3" style={{ color: C.textDim }}>What happens when a lead reaches a call step in the sequence.</p>
                      <div className="grid grid-cols-2 gap-3 mb-5">
                        {([
                          { key: "auto", title: "Auto-advance (3 days)", desc: "Seller dials manually from /queue. If they don't dial within 3 days, the call is skipped and the sequence keeps moving (LinkedIn / email follow-ups continue on schedule). Best for high-volume top-of-funnel." },
                          { key: "manual", title: "Wait for seller (5 days)", desc: "Same idea but with a longer window — the seller has 5 days to dial before the call is skipped. Best for high-value leads where the call matters more, but you still don't want the lead to sit forever if the call never happens." },
                        ] as const).map(opt => {
                          const isSelected = callAdvanceMode === opt.key;
                          return (
                            <button
                              key={opt.key}
                              onClick={() => setCallAdvanceMode(opt.key)}
                              className="rounded-xl border p-4 text-left transition-[opacity,transform,box-shadow,background-color,border-color] hover:shadow-sm"
                              style={{
                                borderColor: isSelected ? C.phone : C.border,
                                backgroundColor: isSelected ? `${C.phone}08` : "transparent",
                                boxShadow: isSelected ? `0 0 0 1px ${C.phone}` : "none",
                              }}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-semibold" style={{ color: C.textPrimary }}>{opt.title}</span>
                                {isSelected && <Check size={13} style={{ color: C.phone }} />}
                              </div>
                              <p className="text-[11px] leading-snug" style={{ color: C.textMuted }}>{opt.desc}</p>
                            </button>
                          );
                        })}
                      </div>
                      <label className="text-xs font-semibold uppercase tracking-wider block mb-2" style={{ color: C.textMuted }}>Aircall Number</label>
                      <p className="text-xs mb-3" style={{ color: C.textDim }}>Which outbound number will be used for call steps in this sequence.</p>
                      {aircallNumbers.length === 0 ? (
                        <div className="rounded-lg border px-4 py-3 text-xs" style={{ backgroundColor: C.redLight, borderColor: `${C.red}30`, color: C.red }}>
                          No Aircall numbers available for this account.
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3">
                          {aircallNumbers.map(n => {
                            const isSelected = selectedAircallNumberId === n.id;
                            const flags: Record<string, string> = { DE: "🇩🇪", US: "🇺🇸", AR: "🇦🇷", BR: "🇧🇷", MX: "🇲🇽", ES: "🇪🇸", FR: "🇫🇷", UK: "🇬🇧", GB: "🇬🇧" };
                            return (
                              <button
                                key={n.id}
                                onClick={() => setSelectedAircallNumberId(n.id)}
                                className="rounded-xl border p-4 text-left transition-[opacity,transform,box-shadow,background-color,border-color] hover:shadow-sm flex items-center gap-3"
                                style={{
                                  borderColor: isSelected ? C.phone : C.border,
                                  backgroundColor: isSelected ? `${C.phone}08` : "transparent",
                                  boxShadow: isSelected ? `0 0 0 1px ${C.phone}` : "none",
                                }}
                              >
                                <span className="text-2xl shrink-0">{flags[n.country] ?? "📞"}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{n.name || n.country}</p>
                                  <p className="text-xs tabular-nums" style={{ color: C.textMuted }}>{n.digits}</p>
                                </div>
                                {isSelected && <Check size={14} style={{ color: C.phone }} />}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {selectedSellerObj && (
                    <div className="mt-4 rounded-lg px-4 py-3 flex items-center gap-3" style={{ backgroundColor: C.bg }}>
                      <span className="text-xs" style={{ color: C.textMuted }}>Daily limits for {selectedSellerObj.name}:</span>
                      {usedChannels.includes("linkedin") && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: `${C.linkedin}12`, color: C.linkedin }}>
                          LinkedIn: {selectedSellerObj.linkedin_daily_limit ?? 15}/day
                        </span>
                      )}
                      {usedChannels.includes("email") && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ backgroundColor: `${C.email}12`, color: C.email }}>
                          Email: {selectedSellerObj.email_daily_limit ?? "∞"}/day
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ═══ STEP 2: CHANNEL MESSAGE CONFIG ═══ */}
      {wizardStep === 2 && (
        <div className="space-y-5">
          {/* The language + timezone strip that used to sit here is gone.
              Language moved to Step 0, where it can still affect the drafting.
              Timezone was written into campaign_requests.message_prompts and
              read by nothing at all — no dispatcher has a send window, they
              only respect the per-seller daily cap and 3 minutes between
              sends — so the control promised scheduling we don't do. The
              stored field stays at its default for shape compatibility.

              The "Variables: {{first_name}}…" line is gone too: it was the
              third place on this screen explaining the same thing. The
              placeholder panel below now carries it, with each token's real
              fill rate over this selection. */}
          <div className="rounded-xl border px-5 py-3 flex items-center gap-3 flex-wrap" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <Globe size={13} style={{ color: C.textMuted }} />
            <span className="text-xs" style={{ color: C.textMuted }}>
              Drafting in <b style={{ color: C.textPrimary }}>{languageOptions.find(l => l.code === language)?.label ?? language}</b>
            </span>
            <button type="button" onClick={() => setWizardStep(0)}
              className="text-[11px] font-semibold underline" style={{ color: gold }}>
              change in Step 1
            </button>
            <span className="text-xs flex-1 text-right" style={{ color: C.textDim, minWidth: 180 }}>
              One step at a time. Write the intent, let AI draft, check the preview.
            </span>
          </div>

          {flowType === "tailored" && (
            <div className="rounded-2xl border p-4 relative overflow-hidden"
              style={{
                background: `linear-gradient(135deg, ${C.card} 0%, color-mix(in srgb, ${gold} 7%, ${C.card}) 100%)`,
                borderColor: `color-mix(in srgb, ${gold} 35%, ${C.border})`,
                boxShadow: `0 4px 18px -10px color-mix(in srgb, ${gold} 30%, transparent)`,
              }}>
              <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: `linear-gradient(180deg, ${gold}, color-mix(in srgb, ${gold} 50%, transparent))` }} />
              <div className="flex items-start gap-3 pl-2">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))` }}>
                  <span className="text-lg" aria-hidden>✨</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>Tailored mode is on</h3>
                    <span className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`, color: "#1A1A2E" }}>
                      AI per-lead
                    </span>
                  </div>
                  <p className="text-[12px] leading-relaxed" style={{ color: C.textBody }}>
                    The template you write here is <strong>the same for every lead</strong>. The AI only swaps the two slots —{" "}
                    <code className="text-[11px] px-1 py-0.5 rounded font-mono" style={{ backgroundColor: `color-mix(in srgb, ${gold} 14%, transparent)`, color: gold }}>{"{{tailored:hook}}"}</code>{" "}and{" "}
                    <code className="text-[11px] px-1 py-0.5 rounded font-mono" style={{ backgroundColor: `color-mix(in srgb, ${gold} 14%, transparent)`, color: gold }}>{"{{tailored:fit}}"}</code>{" "}
                    — per-lead at send time, drawing from each lead&apos;s LinkedIn posts, news, and tech stack. Click <strong>Preview all</strong> to let the AI draft the templates with the slots embedded, then jump to <strong>Step 4 (Review)</strong> to see the per-lead result lead-by-lead.
                  </p>
                </div>
              </div>
            </div>
          )}

          <SignalPicker
            enrichment={sampleEnrichment}
            selected={selectedSignals}
            onChange={setSelectedSignals}
          />
          <ChannelMessageConfig
            channelMessages={channelMessages}
            onChange={setChannelMessages}
            sequence={sequence}
            language={language}
            flowType={flowType ?? "generic"}
            icpProfileId={profileId}
            leadId={sampleLeadId ?? undefined}
            signals={selectedSignals}
            sampleLeads={sampleLeads}
            sellerName={sellers.find(s => s.id === sellerQuotas[0]?.sellerId)?.name ?? undefined}
            placeholderCoverage={placeholderCoverage}
            onAttachmentsChange={(stepIdx, next) => {
              setSequence(seq => seq.map((step, i) => i === stepIdx ? { ...step, attachments: next } : step));
            }}
            onReorderStep={(fromIdx, toIdx) => {
              // Reorder must move BOTH the sequence definition (channel/day/
              // attachments) AND the per-step body/subject the user wrote, in
              // lockstep. If we only moved one, the message body would jump to
              // a different step and the seller would lose track of which copy
              // belongs where. daysAfter is left as-is (the schedule pattern
              // is sequence-position-driven, not body-driven).
              if (toIdx < 0 || toIdx >= sequence.length || fromIdx === toIdx) return;
              setSequence(seq => {
                const next = [...seq];
                const [moved] = next.splice(fromIdx, 1);
                next.splice(toIdx, 0, moved);
                return next;
              });
              setChannelMessages(msgs => {
                const steps = [...(msgs.steps ?? [])];
                if (steps.length === 0) return msgs;
                const [moved] = steps.splice(fromIdx, 1);
                steps.splice(toIdx, 0, moved);
                return { ...msgs, steps };
              });
            }}
          />
        </div>
      )}

      {/* ═══ STEP 3: REVIEW ═══
          Generic flow → simple Flow Summary card (legacy behavior).
          Tailored flow → adds three sections: signal coverage banner,
          3 auto-rendered sample leads, and a tag grid for the whole batch
          with per-lead expansion. */}
      {wizardStep === 3 && (
        <div className="space-y-5">
          <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
            <h2 className="text-sm font-semibold uppercase tracking-wider mb-5" style={{ color: C.textMuted }}>Flow Summary</h2>
            <div className="grid grid-cols-3 gap-4">
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
          </div>

          {flowType === "tailored" && tenantBioId && tailoredLeadIds.length > 0 && (() => {
            // Build the steps array for the preview/batch endpoints. CR slot
            // (channelMessages.connectionRequest) is passed separately because
            // it's not a numbered step in the sequence — same shape the
            // preview-tailor + batch-preview endpoints expect.
            const stepsForPreview = (channelMessages.steps ?? [])
              .map(s => ({ channel: s?.channel ?? "linkedin", body: s?.body ?? "", subject: s?.subject ?? null }))
              .filter(s => s.body && s.body.trim().length > 0);
            const cr = channelMessages.connectionRequest ?? undefined;
            // Guard: with no step bodies AND no connection request, the
            // tailor endpoints have nothing to generate against and
            // would respond "no tailored slots in template" — surface
            // a clear nudge to go back to Step 2 instead of three
            // empty AI panels.
            if (stepsForPreview.length === 0 && !cr) {
              return (
                <div className="rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: `color-mix(in srgb, ${gold} 35%, ${C.border})` }}>
                  <p className="text-sm font-semibold mb-1.5" style={{ color: C.textPrimary }}>No message bodies to preview yet</p>
                  <p className="text-xs leading-relaxed mb-3" style={{ color: C.textBody }}>
                    Go back to <strong>Step 3 (Messages)</strong> and click <strong>Preview all</strong> so the AI drafts the templates first. Then jump back here to validate per-lead.
                  </p>
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md transition-opacity hover:opacity-85"
                    style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`, color: "#1A1A2E" }}>
                    ← Go to Messages
                  </button>
                </div>
              );
            }
            return (
              <>
                <SignalCoverageBanner leadIds={tailoredLeadIds} />
                <SampleLeadCards
                  leadIds={tailoredLeadIds}
                  companyBioId={tenantBioId}
                  icpProfileId={profileId}
                  sellerId={sellerQuotas[0]?.sellerId ?? null}
                  steps={stepsForPreview}
                  connectionRequest={cr}
                  language={language}
                />
                <LeadTagGrid
                  leadIds={tailoredLeadIds}
                  companyBioId={tenantBioId}
                  icpProfileId={profileId}
                  sellerId={sellerQuotas[0]?.sellerId ?? null}
                  steps={stepsForPreview}
                  connectionRequest={cr}
                  language={language}
                  onResults={setPreviewOutputs}
                />
              </>
            );
          })()}

          {flowType === "tailored" && tailoredLeadIds.length === 0 && (
            <div className="rounded-xl border p-5 text-center" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <Loader2 size={16} className="animate-spin inline mr-2" style={{ color: C.textMuted }} />
              <span className="text-sm" style={{ color: C.textMuted }}>Loading batch…</span>
            </div>
          )}
        </div>
      )}

      {/* ═══ POST-SUBMIT FLOW ═══
          Two-step modal sequence: the Save-as-template prompt shows FIRST,
          then the success screen. The prompt opens with a "✓ Submitted" pill
          at the top so the seller knows the submission already worked and
          this is a bonus offer — not another action they have to complete
          for the campaign to go through. */}
      {showSavePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
          <div className="rounded-2xl border p-7 w-full max-w-md shadow-2xl fade-in"
            style={{ backgroundColor: C.card, borderColor: C.border }}>
            {/* Submission-confirmed banner so the modal doesn't read as a
                blocker. The actual campaign_request is already in the DB. */}
            <div className="inline-flex items-center gap-1.5 mb-4 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider"
              style={{
                backgroundColor: `color-mix(in srgb, ${C.green} 14%, transparent)`,
                color: C.green,
                border: `1px solid color-mix(in srgb, ${C.green} 30%, transparent)`,
                letterSpacing: "0.06em",
              }}>
              <Check size={11} /> Flow submitted
            </div>
            <h2 className="text-lg font-bold mb-1" style={{ color: C.textPrimary }}>Save this as a template?</h2>
            <p className="text-sm mb-5" style={{ color: C.textMuted }}>
              Optional. Save the sequence + messages so you can launch it again next time without rebuilding from scratch. You can skip and the flow goes through anyway.
            </p>
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: C.textMuted }}>Template name</label>
                <input
                  value={tplName}
                  onChange={e => setTplName(e.target.value)}
                  maxLength={100}
                  placeholder="e.g. LinkedIn + Email 5-step"
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ backgroundColor: C.surface, borderColor: C.border, color: C.textPrimary }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: C.textMuted }}>Description <span className="font-normal">(optional)</span></label>
                <input
                  value={tplDesc}
                  onChange={e => setTplDesc(e.target.value)}
                  maxLength={200}
                  placeholder="Short note about this template…"
                  className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ backgroundColor: C.surface, borderColor: C.border, color: C.textPrimary }}
                />
              </div>
              {tplSaveError && (
                <p className="text-xs" style={{ color: C.red }}>{tplSaveError}</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleSaveTemplate(true)}
                disabled={savingTpl}
                className="flex-1 rounded-lg py-2.5 text-sm font-medium"
                style={{ backgroundColor: C.surface, color: C.textBody }}>
                Skip
              </button>
              <button
                onClick={() => handleSaveTemplate(false)}
                disabled={savingTpl || !tplName.trim()}
                className="flex-1 rounded-lg py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
                style={{ backgroundColor: gold, color: "#04070d", opacity: (!tplName.trim() || savingTpl) ? 0.6 : 1 }}>
                {savingTpl ? <Loader2 size={14} className="animate-spin" /> : null}
                Save Template
              </button>
            </div>
          </div>
        </div>
      )}

      {submitted && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
          <div className="rounded-2xl border p-8 w-full max-w-md shadow-2xl text-center fade-in"
            style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
              style={{ backgroundColor: C.greenLight }}>
              <Check size={32} style={{ color: C.green }} />
            </div>
            <h2 className="text-xl font-bold mb-2" style={{ color: C.textPrimary }}>Flow Submitted</h2>
            <p className="text-sm mb-1" style={{ color: C.textBody }}>
              Your outreach flow has been submitted for review.
            </p>
            {tplSaved && (
              <p className="text-xs mb-1 font-medium" style={{ color: C.green }}>
                Template &ldquo;{tplName}&rdquo; saved.
              </p>
            )}
            <p className="text-sm mb-6" style={{ color: C.textMuted }}>
              The SWL team will review your flow and you will be notified in your <strong>Queue</strong> once it is approved.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => router.push("/leads")}
                className="rounded-lg px-5 py-2.5 text-sm font-medium"
                style={{ backgroundColor: C.surface, color: C.textBody }}>
                Back to Leads
              </button>
              <button onClick={() => router.push("/campaigns")}
                className="rounded-lg px-5 py-2.5 text-sm font-semibold"
                style={{ backgroundColor: gold, color: "#04070d" }}>
                View Campaigns
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Warnings & errors */}
      {messagesWarning && (
        <div className="mt-4 rounded-lg border px-4 py-3" style={{ borderColor: "#D97706", backgroundColor: "color-mix(in srgb, #D97706 13%, transparent)" }}>
          <p className="text-sm font-medium" style={{ color: "#D97706" }}>{messagesWarning}</p>
        </div>
      )}
      {submitError && (
        <div className="mt-4 rounded-lg border px-4 py-3" style={{ borderColor: C.red, backgroundColor: C.redLight }}>
          <p className="text-sm font-medium" style={{ color: C.red }}>Failed to create campaign</p>
          <p className="text-xs mt-0.5" style={{ color: C.textBody }}>{submitError}</p>
        </div>
      )}

      {/* ═══ NAVIGATION ═══ */}
      <div className="flex items-center justify-between mt-8 pt-6 border-t" style={{ borderColor: C.border }}>
        <button onClick={() => wizardStep === 0 ? router.push("/campaigns") : setWizardStep(s => s - 1)}
          className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity"
          style={{ color: C.textBody, backgroundColor: C.surface }}>
          <ArrowLeft size={15} /> {wizardStep === 0 ? "Cancel" : "Previous"}
        </button>

        {wizardStep < WIZARD_STEPS.length - 1 ? (
          <button
            onClick={() => {
              if (wizardStep === 0 && !campaignName.trim()) {
                setMessagesWarning("Please enter a flow name.");
                return;
              }
              if (wizardStep === 0 && sequence.length === 0) {
                setMessagesWarning("Please add at least one step to the sequence.");
                return;
              }
              if (wizardStep === 1 && sellerQuotas.length === 0) {
                setMessagesWarning("Please select a seller before continuing.");
                return;
              }
              if (wizardStep === 2) {
                const hasAnyContent = channelMessages.steps?.some((s: any) => s.body?.trim());
                if (!hasAnyContent) {
                  setMessagesWarning("Please write or generate at least one message before continuing.");
                  return;
                }
              }
              setMessagesWarning(null);
              setWizardStep(s => s + 1);
            }}
            disabled={false}
            className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-40"
            style={{ backgroundColor: gold, color: "#04070d" }}>
            Next <ArrowRight size={15} />
          </button>
        ) : (
          <button onClick={handleSubmit} disabled={submitting}
            className="flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50"
            style={flowType === "tailored"
              ? { background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, ${gold} 72%, white))`, color: "#1A1A2E", boxShadow: `0 4px 14px -4px color-mix(in srgb, ${gold} 50%, transparent)` }
              : { backgroundColor: C.green, color: "#fff" }}>
            {submitting ? <Loader2 size={15} className="animate-spin" /> : (flowType === "tailored" ? <Sparkles size={15} /> : <Send size={15} />)}
            {submitting ? "Submitting…" : (flowType === "tailored" ? "Launch Tailored Flow" : "Launch Flow")}
          </button>
        )}
      </div>
    </div>
  );
}
