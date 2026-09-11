// Template detail page — read view with action buttons. Server-rendered
// because the data is mostly static once saved; the row actions live in a
// thin client component (TemplateDetailActions) so navigation + duplicate
// + delete behave the same as the list view.

import { notFound } from "next/navigation";
import { getT, getServerLocale } from "@/lib/i18n-server";
import { intlTag } from "@/lib/i18n-locale";
import Link from "next/link";
import {
  ArrowLeft, Share2, Mail, Phone, MessageSquare, FileText, Sparkles,
  Trophy, Tag, Languages, Megaphone, Clock,
} from "lucide-react";
import { C } from "@/lib/design";
import { getSupabaseService } from "@/lib/supabase-service";
import { getUserScope } from "@/lib/scope";
import TemplateDetailActions from "./TemplateDetailActions";
import { signStepAttachments } from "@/lib/campaign-attachments";

const gold = "var(--brand, #c9a83a)";
const ACCENT = gold;

type Channel = "linkedin" | "email" | "call" | "whatsapp";

// Module scope, so all three maps hold keys. The tone and rewrite names are
// the ones the wizard already ships — same words on both screens.
const channelMeta: Record<Channel, { icon: typeof Share2; color: string; labelKey: string }> = {
  linkedin: { icon: Share2,        color: "#0A66C2", labelKey: "chan.linkedin" },
  email:    { icon: Mail,          color: "#7C3AED", labelKey: "chan.email" },
  call:     { icon: Phone,         color: "#F97316", labelKey: "chan.call" },
  whatsapp: { icon: MessageSquare, color: "#25D366", labelKey: "chan.whatsapp" },
};

const TONE_KEY: Record<string, string> = {
  conservative: "tpl.tone.conservative",
  balanced: "tpl.tone.balanced",
  direct: "tpl.tone.direct",
  spicy: "tpl.tone.spicy",
  custom: "tpl.tone.custom",
};

const REWRITE_KEY: Record<string, string> = {
  verbatim: "tpl.mode.verbatim",
  personalize: "tpl.mode.personalize",
  rewrite_with_source: "tpl.mode.rewrite",
};

type Tr = (key: string, vars?: Record<string, string | number>) => string;

function timeAgo(iso: string | null, t: Tr) {
  if (!iso) return t("tpd.never");
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return t("tpd.ago.min", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("tpd.ago.hour", { n: h });
  return t("tpd.ago.day", { n: Math.floor(h / 24) });
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
  const t = await getT();
  const locale = await getServerLocale();
  const data = await loadTemplate(id);
  if (!data) notFound();
  const { tpl, icpName, voiceSellerName, icps } = data;

  const stepMessages = (tpl.step_messages ?? {}) as {
    connectionRequest?: string;
    steps?: Array<{
      step: number; channel: string; subject?: string | null; body: string;
      source_excerpt?: string; variants?: string[];
      attachments?: Array<{ path: string; name: string; mimeType: string; sizeBytes: number }>;
    }>;
    autoReplies?: { positive?: string; negative?: string; question?: string };
  };
  const sequence = Array.isArray(tpl.sequence_steps) ? tpl.sequence_steps : [];
  const orderedSteps = Array.isArray(stepMessages.steps) ? stepMessages.steps : [];

  // Sign per-step attachments so the read-only preview can render thumbnails /
  // download links without exposing the storage bucket directly. 5-min TTL is
  // fine — the page is server-rendered on every nav, so a stale link is rare.
  const signedAttachmentsByStep = await Promise.all(
    orderedSteps.map(async (s) => {
      if (!Array.isArray(s.attachments) || s.attachments.length === 0) return [];
      try { return await signStepAttachments(s.attachments); }
      catch { return []; }
    })
  );

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
            {t("tpd.template")}
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
          <Chip icon={<Trophy size={11} />} label={t("tpd.icpChip", { name: icpName })} />
        ) : (
          <Chip icon={<Trophy size={11} />} label={t("tpd.needsIcp")} tone="warn" />
        )}
        <Chip icon={<Sparkles size={11} />} label={t("tpd.toneChip", { tone: TONE_KEY[tpl.tone_preset ?? "balanced"] ? t(TONE_KEY[tpl.tone_preset ?? "balanced"]) : (tpl.tone_preset ?? "") })} />
        <Chip icon={<Megaphone size={11} />} label={t("tpd.rewriteChip", { mode: REWRITE_KEY[tpl.rewrite_mode ?? "personalize"] ? t(REWRITE_KEY[tpl.rewrite_mode ?? "personalize"]) : (tpl.rewrite_mode ?? "") })} />
        {voiceSellerName && <Chip icon={<Languages size={11} />} label={t("tpd.voiceChip", { seller: voiceSellerName })} />}
        {(tpl.tags ?? []).map((tag: string) => (
          <Chip key={tag} icon={<Tag size={11} />} label={`#${tag}`} tone="muted" />
        ))}
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <Stat label={t("tpd.used")} value={`${tpl.usage_count ?? 0}×`} />
        <Stat label={t("tpd.lastApplied")} value={timeAgo(tpl.last_used_at, t)} />
        <Stat label={t("tpd.created")} value={new Date(tpl.created_at).toLocaleDateString(intlTag(locale), { day: "2-digit", month: "short", year: "numeric" })} />
      </div>

      {/* Connection Request — rendered above the Sequence as its own
          section. The LinkedIn invite is structurally different from a
          follow-up step (no Day delay, no subject, capped at 200 chars),
          and lumping it in as "Step 0" was the source of every off-by-one
          bug in the wizard apply path (2026-05-22). Surfacing it as a
          separate block makes the data model honest. */}
      {stepMessages.connectionRequest && stepMessages.connectionRequest.length > 0 && (
        <div className="rounded-2xl border overflow-hidden mb-5"
          style={{ backgroundColor: C.card, borderColor: C.border }}>
          <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
            <div>
              <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: C.textPrimary }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#0A66C2" }} />
                {t("tpd.connectionRequest")}
              </h2>
              <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
                {t("tpd.crHint")}
              </p>
            </div>
          </div>
          <div className="p-5">
            <StepCard
              isInvite
              stepNum={0}
              channel="linkedin"
              daysAfter={0}
              body={stepMessages.connectionRequest}
              t={t}
            />
          </div>
        </div>
      )}

      {/* Sequence — only the actual follow-up steps. The CR (if present)
          lives above as its own section, so the step count + numbering here
          reflect the messages the seller will actually compose / send after
          the invite is accepted. */}
      <div className="rounded-2xl border overflow-hidden mb-5"
        style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
          <div>
            <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>{t("tpd.sequence")}</h2>
            <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
              {t(orderedSteps.length === 1 ? "tpd.stepsOne" : "tpd.stepsN", {
                n: orderedSteps.length,
                channels: (tpl.channels ?? []).map((c: string) => channelMeta[c as Channel] ? t(channelMeta[c as Channel].labelKey) : c).join(" → "),
              })}
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {orderedSteps.map((s, i) => {
            const seqEntry = sequence[i + (stepMessages.connectionRequest ? 1 : 0)];
            const daysAfter = seqEntry?.daysAfter ?? 0;
            return (
              <StepCard
                key={i}
                stepNum={i + 1}
                channel={s.channel as Channel}
                daysAfter={daysAfter}
                subject={s.subject ?? undefined}
                body={s.body}
                sourceExcerpt={s.source_excerpt}
                variantB={Array.isArray(s.variants) && s.variants[0] ? s.variants[0] : undefined}
                attachments={signedAttachmentsByStep[i] ?? []}
                t={t}
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
            <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>{t("tpd.sourceAttach")}</h2>
            <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
              {t("tpd.sourceLede")}
            </p>
          </div>
          <div className="p-5 space-y-1.5">
            {tpl.attachments.map((a: any, i: number) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border px-3 py-2"
                style={{ borderColor: C.border, backgroundColor: C.bg }}>
                <FileText size={13} style={{ color: ACCENT }} />
                <span className="text-xs flex-1 truncate" style={{ color: C.textBody }}>{a.filename ?? t("tpd.attachment")}</span>
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
            <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>{t("tpd.autoReplies")}</h2>
            <p className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>
              {t("tpd.autoLede")}
            </p>
          </div>
          <div className="p-5 space-y-3">
            {stepMessages.autoReplies.positive && (
              <AutoReplyBlock label={t("tpd.posReply")} body={stepMessages.autoReplies.positive} color="#16A34A" />
            )}
            {stepMessages.autoReplies.question && (
              <AutoReplyBlock label={t("tpd.qReply")} body={stepMessages.autoReplies.question} color="#D97706" />
            )}
            {stepMessages.autoReplies.negative && (
              <AutoReplyBlock label={t("tpd.negReply")} body={stepMessages.autoReplies.negative} color={C.red} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ icon, label, tone = "default" }: { icon: React.ReactNode; label: string; tone?: "default" | "warn" | "muted" }) {
  const colors = tone === "warn"
    ? { bg: "color-mix(in srgb, #D97706 13%, transparent)", border: "color-mix(in srgb, #D97706 34%, transparent)", color: "#92400E" }
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
  stepNum, channel, daysAfter, subject, body, sourceExcerpt, variantB, isInvite, attachments, t,
}: {
  stepNum: number; channel: Channel; daysAfter: number;
  subject?: string; body: string; sourceExcerpt?: string; variantB?: string;
  isInvite?: boolean;
  attachments?: Array<{ path: string; name: string; mimeType: string; sizeBytes: number; signedUrl: string }>;
  t: Tr;
}) {
  const meta = channelMeta[channel];
  const Icon = meta.icon;
  return (
    <div className="rounded-lg border p-4"
      style={{
        borderColor: isInvite ? "#0A66C240" : C.border,
        backgroundColor: isInvite ? "color-mix(in srgb, #2563EB 12%, transparent)" : C.bg,
      }}>
      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold"
          style={{ backgroundColor: `${meta.color}18`, color: meta.color }}>
          {/* Invite renders an arrow glyph instead of a step number — the
              CR is not a numbered sequence step, it's the gate that opens
              the sequence. */}
          {isInvite ? "→" : stepNum}
        </div>
        <Icon size={13} style={{ color: meta.color }} />
        {isInvite ? (
          <span className="text-xs font-bold" style={{ color: "#0A66C2" }}>{t("tpd.liInvite")}</span>
        ) : (
          <span className="text-xs font-bold" style={{ color: meta.color }}>{t(meta.labelKey)}</span>
        )}
        {!isInvite && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded"
            style={{ backgroundColor: C.surface, color: C.textMuted }}>
            <Clock size={9} /> {t("tpd.day", { n: daysAfter ?? 0 })}
          </span>
        )}
      </div>
      {subject && (
        <p className="text-xs font-semibold mb-1.5" style={{ color: C.textPrimary }}>
          {t("tpd.subject")} <span className="font-normal">{subject}</span>
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
            <FileText size={10} /> {t("tpd.sourceFromPdf")}
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
            {t("tpd.variantB")}
          </p>
          <p className="text-xs whitespace-pre-wrap leading-relaxed"
            style={{ color: C.textPrimary, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
            {variantB}
          </p>
        </div>
      )}
      {attachments && attachments.length > 0 && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: C.border }}>
          <p className="text-[10px] uppercase tracking-wider font-bold mb-2" style={{ color: C.textMuted }}>
            {t("tpd.attachments", { n: attachments.length })}
          </p>
          <div className="flex flex-wrap gap-2">
            {attachments.map((a, i) => {
              const isImage = a.mimeType.startsWith("image/");
              return (
                <a key={i} href={a.signedUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border overflow-hidden hover:opacity-80 transition-opacity"
                  style={{ borderColor: C.border, backgroundColor: C.bg }}>
                  {isImage ? (
                    // Inline thumbnail — sized small so a 3-attachment row still
                    // fits the card width. Click opens full size in a new tab.
                    <img src={a.signedUrl} alt={a.name} className="h-20 w-20 object-cover shrink-0" />
                  ) : (
                    <span className="flex items-center justify-center h-10 w-10 shrink-0"
                      style={{ backgroundColor: `color-mix(in srgb, ${ACCENT} 8%, transparent)` }}>
                      <FileText size={14} style={{ color: ACCENT }} />
                    </span>
                  )}
                  <div className="px-2 py-1.5 min-w-0">
                    <p className="text-[11px] font-semibold truncate max-w-[180px]" style={{ color: C.textPrimary }}>{a.name}</p>
                    <p className="text-[10px]" style={{ color: C.textMuted }}>{(a.sizeBytes / 1024).toFixed(0)} KB</p>
                  </div>
                </a>
              );
            })}
          </div>
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
