// Template detail page — read view with action buttons. Server-rendered
// because the data is mostly static once saved; the row actions live in a
// thin client component (TemplateDetailActions) so navigation + duplicate
// + delete behave the same as the list view.

import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Share2, Mail, Phone, MessageSquare, FileText, Sparkles,
  Trophy, Tag, Languages, Megaphone, Clock,
} from "lucide-react";
import { C } from "@/lib/design";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import TemplateDetailActions from "./TemplateDetailActions";

const gold = "var(--brand, #c9a83a)";
const ACCENT = gold;

type Channel = "linkedin" | "email" | "call" | "whatsapp";

const channelMeta: Record<Channel, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2,        color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,          color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,         color: "#F97316", label: "Call" },
  whatsapp: { icon: MessageSquare, color: "#25D366", label: "WhatsApp" },
};

const TONE_LABEL: Record<string, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  direct: "Direct",
  spicy: "Spicy",
  custom: "Custom",
};

const REWRITE_LABEL: Record<string, string> = {
  verbatim: "Verbatim",
  personalize: "Personalize per lead",
  rewrite_with_source: "Rewrite from source PDF",
};

function timeAgo(iso: string | null) {
  if (!iso) return "Never";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

async function loadTemplate(id: string) {
  const scope = await getUserScope();
  if (!scope.userId || !scope.companyBioId) return null;
  const svc = getSupabaseService();
  const [{ data: tpl }, { data: icpRows }, { data: sellerRow }] = await Promise.all([
    svc.from("campaign_templates")
      .select("id, name, description, sequence_steps, step_messages, attachments, tags, channels, usage_count, last_used_at, created_at, tone_preset, tone_custom_notes, rewrite_mode, voice_anchor_seller_id, icp_profile_id")
      .eq("id", id).eq("company_bio_id", scope.companyBioId).maybeSingle(),
    svc.from("icp_profiles")
      .select("id, profile_name")
      .eq("company_bio_id", scope.companyBioId),
    Promise.resolve({ data: null }),
  ]);
  if (!tpl) return null;
  // Resolve linked names so the page doesn't ship raw IDs.
  const icpName = tpl.icp_profile_id
    ? (icpRows ?? []).find((i: any) => i.id === tpl.icp_profile_id)?.profile_name ?? "(deleted ICP)"
    : null;
  let voiceSellerName: string | null = null;
  if (tpl.voice_anchor_seller_id) {
    const { data: s } = await svc.from("sellers").select("name").eq("id", tpl.voice_anchor_seller_id).maybeSingle();
    voiceSellerName = s?.name ?? null;
  }
  return { tpl, icpName, voiceSellerName, icps: icpRows ?? [] };
}

export default async function TemplateDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadTemplate(id);
  if (!data) notFound();
  const { tpl, icpName, voiceSellerName, icps } = data;

  const stepMessages = (tpl.step_messages ?? {}) as {
    connectionRequest?: string;
    steps?: Array<{ step: number; channel: string; subject?: string | null; body: string; source_excerpt?: string; variants?: string[] }>;
    autoReplies?: { positive?: string; negative?: string; question?: string };
  };
  const sequence = Array.isArray(tpl.sequence_steps) ? tpl.sequence_steps : [];
  const orderedSteps = Array.isArray(stepMessages.steps) ? stepMessages.steps : [];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Breadcrumb + actions header */}
      <div className="flex items-start gap-3 mb-5">
        <Link href="/campaigns"
          className="p-2 rounded-lg border hover:bg-gray-50 mt-0.5"
          style={{ borderColor: C.border, color: C.textBody }}>
          <ArrowLeft size={14} />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: C.textDim }}>
            Template
          </p>
          <h1 className="text-2xl font-bold leading-tight" style={{ color: C.textPrimary }}>{tpl.name}</h1>
          {tpl.description && (
            <p className="text-sm mt-1" style={{ color: C.textBody }}>{tpl.description}</p>
          )}
        </div>
        <TemplateDetailActions
          templateId={tpl.id}
          templateName={tpl.name}
          currentIcpId={tpl.icp_profile_id}
          icps={icps.map((i: any) => ({ id: i.id, profile_name: i.profile_name }))}
        />
      </div>

      {/* Metadata chips */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {icpName ? (
          <Chip icon={<Trophy size={11} />} label={`ICP · ${icpName}`} />
        ) : (
          <Chip icon={<Trophy size={11} />} label="ICP · Needs assignment" tone="warn" />
        )}
        <Chip icon={<Sparkles size={11} />} label={`Tone · ${TONE_LABEL[tpl.tone_preset ?? "balanced"] ?? tpl.tone_preset}`} />
        <Chip icon={<Megaphone size={11} />} label={`Rewrite · ${REWRITE_LABEL[tpl.rewrite_mode ?? "personalize"] ?? tpl.rewrite_mode}`} />
        {voiceSellerName && <Chip icon={<Languages size={11} />} label={`Voice · ${voiceSellerName}`} />}
        {(tpl.tags ?? []).map((tag: string) => (
          <Chip key={tag} icon={<Tag size={11} />} label={`#${tag}`} tone="muted" />
        ))}
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <Stat label="Used" value={`${tpl.usage_count ?? 0}×`} />
        <Stat label="Last applied" value={timeAgo(tpl.last_used_at)} />
        <Stat label="Created" value={new Date(tpl.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} />
      </div>

      {/* Sequence */}
      <div className="rounded-2xl border overflow-hidden mb-5"
        style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
          <div>
            <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Sequence</h2>
            <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
              {sequence.length} step{sequence.length === 1 ? "" : "s"} · {(tpl.channels ?? []).map((c: string) => channelMeta[c as Channel]?.label ?? c).join(" → ")}
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {stepMessages.connectionRequest && stepMessages.connectionRequest.length > 0 && (
            <StepCard
              isInvite
              stepNum={0}
              channel="linkedin"
              daysAfter={0}
              body={stepMessages.connectionRequest}
            />
          )}
          {orderedSteps.map((s, i) => {
            const seqEntry = sequence[i + (stepMessages.connectionRequest ? 1 : 0)];
            const daysAfter = seqEntry?.daysAfter ?? 0;
            return (
              <StepCard
                key={i}
                stepNum={s.step}
                channel={s.channel as Channel}
                daysAfter={daysAfter}
                subject={s.subject ?? undefined}
                body={s.body}
                sourceExcerpt={s.source_excerpt}
                variantB={Array.isArray(s.variants) && s.variants[0] ? s.variants[0] : undefined}
              />
            );
          })}
        </div>
      </div>

      {/* Attachments */}
      {Array.isArray(tpl.attachments) && tpl.attachments.length > 0 && (
        <div className="rounded-2xl border overflow-hidden mb-5"
          style={{ backgroundColor: C.card, borderColor: C.border }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: C.border }}>
            <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Source attachments</h2>
            <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
              PDFs the AI read to draft this template. Re-used when rewrite_mode = rewrite_with_source.
            </p>
          </div>
          <div className="p-5 space-y-1.5">
            {tpl.attachments.map((a: any, i: number) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border px-3 py-2"
                style={{ borderColor: C.border, backgroundColor: C.bg }}>
                <FileText size={13} style={{ color: ACCENT }} />
                <span className="text-xs flex-1 truncate" style={{ color: C.textBody }}>{a.filename ?? "Attachment"}</span>
                {a.size_bytes && (
                  <span className="text-[10px] shrink-0" style={{ color: C.textMuted }}>{(a.size_bytes / 1024).toFixed(0)} KB</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Auto-replies (shown when configured — most templates won't have them yet) */}
      {stepMessages.autoReplies && (
        stepMessages.autoReplies.positive ||
        stepMessages.autoReplies.negative ||
        stepMessages.autoReplies.question
      ) && (
        <div className="rounded-2xl border overflow-hidden"
          style={{ backgroundColor: C.card, borderColor: C.border }}>
          <div className="px-5 py-4 border-b" style={{ borderColor: C.border }}>
            <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Auto-replies</h2>
            <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
              Fired by the dispatcher when a lead's reply matches the classification.
            </p>
          </div>
          <div className="p-5 space-y-3">
            {stepMessages.autoReplies.positive && (
              <AutoReplyBlock label="Positive reply" body={stepMessages.autoReplies.positive} color="#16A34A" />
            )}
            {stepMessages.autoReplies.question && (
              <AutoReplyBlock label="Question reply" body={stepMessages.autoReplies.question} color="#D97706" />
            )}
            {stepMessages.autoReplies.negative && (
              <AutoReplyBlock label="Negative reply" body={stepMessages.autoReplies.negative} color={C.red} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ icon, label, tone = "default" }: { icon: React.ReactNode; label: string; tone?: "default" | "warn" | "muted" }) {
  const colors = tone === "warn"
    ? { bg: "#FFFBEB", border: "#FCD34D", color: "#92400E" }
    : tone === "muted"
      ? { bg: C.surface, border: C.border, color: C.textMuted }
      : { bg: `color-mix(in srgb, ${ACCENT} 10%, transparent)`, border: `color-mix(in srgb, ${ACCENT} 30%, transparent)`, color: ACCENT };
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-md border"
      style={{ backgroundColor: colors.bg, borderColor: colors.border, color: colors.color }}>
      {icon}{label}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border px-4 py-3"
      style={{ backgroundColor: C.card, borderColor: C.border }}>
      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: C.textMuted }}>{label}</p>
      <p className="text-lg font-bold tabular-nums mt-0.5" style={{ color: C.textPrimary }}>{value}</p>
    </div>
  );
}

function StepCard({
  stepNum, channel, daysAfter, subject, body, sourceExcerpt, variantB, isInvite,
}: {
  stepNum: number; channel: Channel; daysAfter: number;
  subject?: string; body: string; sourceExcerpt?: string; variantB?: string;
  isInvite?: boolean;
}) {
  const meta = channelMeta[channel];
  const Icon = meta.icon;
  return (
    <div className="rounded-lg border p-4"
      style={{
        borderColor: isInvite ? "#0A66C240" : C.border,
        backgroundColor: isInvite ? "#EFF6FF" : C.bg,
      }}>
      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold"
          style={{ backgroundColor: `${meta.color}18`, color: meta.color }}>
          {isInvite ? "0" : stepNum}
        </div>
        <Icon size={13} style={{ color: meta.color }} />
        {isInvite ? (
          <span className="text-xs font-bold" style={{ color: "#0A66C2" }}>LinkedIn invite</span>
        ) : (
          <span className="text-xs font-bold" style={{ color: meta.color }}>{meta.label}</span>
        )}
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded"
          style={{ backgroundColor: C.surface, color: C.textMuted }}>
          <Clock size={9} /> Day {daysAfter}
        </span>
      </div>
      {subject && (
        <p className="text-xs font-semibold mb-1.5" style={{ color: C.textPrimary }}>
          Subject: <span className="font-normal">{subject}</span>
        </p>
      )}
      <p className="text-xs whitespace-pre-wrap leading-relaxed"
        style={{ color: C.textPrimary, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
        {body}
      </p>
      {sourceExcerpt && (
        <details className="mt-3 group">
          <summary className="text-[10px] cursor-pointer inline-flex items-center gap-1 select-none"
            style={{ color: C.textMuted }}>
            <FileText size={10} /> Source from PDF
          </summary>
          <p className="text-[11px] mt-1.5 pl-3 italic"
            style={{ color: C.textBody, borderLeft: `2px solid color-mix(in srgb, ${ACCENT} 40%, transparent)` }}>
            “{sourceExcerpt}”
          </p>
        </details>
      )}
      {variantB && (
        <div className="mt-3 rounded border p-3"
          style={{ borderColor: `color-mix(in srgb, ${ACCENT} 40%, transparent)`, backgroundColor: `color-mix(in srgb, ${ACCENT} 5%, transparent)` }}>
          <p className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: ACCENT }}>
            Variant B · A/B test
          </p>
          <p className="text-xs whitespace-pre-wrap leading-relaxed"
            style={{ color: C.textPrimary, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            {variantB}
          </p>
        </div>
      )}
    </div>
  );
}

function AutoReplyBlock({ label, body, color }: { label: string; body: string; color: string }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: `${color}40`, backgroundColor: `${color}08` }}>
      <p className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color }}>{label}</p>
      <p className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: C.textBody }}>{body}</p>
    </div>
  );
}
