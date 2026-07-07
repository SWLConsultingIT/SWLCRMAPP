import { getSupabaseService } from "@/lib/supabase-service";
import { requireAdminPage } from "@/lib/auth-admin";
import { C } from "@/lib/design";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Share2, Mail, Phone, Megaphone, Clock, User, Users,
  ThumbsUp, ThumbsDown, UserPlus, MessageCircle,
} from "lucide-react";
import AdminActions from "../../AdminActions";

const gold = "var(--brand, #c9a83a)";
const supabase = getSupabaseService();

const channelMeta: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  linkedin: { icon: Share2, color: C.linkedin, label: "LinkedIn" },
  email:    { icon: Mail,   color: C.email,    label: "Email" },
  call:     { icon: Phone,  color: C.phone,    label: "Call" },
};

async function getRequest(id: string) {
  const { data } = await supabase.from("campaign_requests").select("*").eq("id", id).single();
  return data;
}

async function getLeadInfo(leadId: string) {
  if (!leadId) return null;
  const { data } = await supabase.from("leads").select("id, primary_first_name, primary_last_name, company_name, primary_title_role, primary_linkedin_url, primary_work_email").eq("id", leadId).single();
  return data;
}

async function getProfileInfo(profileId: string) {
  if (!profileId) return null;
  const { data } = await supabase.from("icp_profiles").select("id, profile_name, target_industries, target_roles, pain_points, solutions_offered").eq("id", profileId).single();
  return data;
}

async function getSellerNames(ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  const m = new Map<string, string>();
  if (uniq.length === 0) return m;
  const { data } = await supabase.from("sellers").select("id, name").in("id", uniq);
  for (const s of data ?? []) m.set((s as any).id, (s as any).name);
  return m;
}

// Distinct accent per seller row (falls back to gold when the list is longer).
const SELLER_COLORS = ["#2563EB", "#0D9488", "#D97706", "#7C3AED", "#DB2777", "#059669"];

export default async function ReviewCampaignPage({ params }: { params: Promise<{ requestId: string }> }) {
  await requireAdminPage();
  const { requestId } = await params;
  const req = await getRequest(requestId);
  if (!req) notFound();

  const [lead, profile] = await Promise.all([
    getLeadInfo(req.lead_id),
    getProfileInfo(req.icp_profile_id),
  ]);

  const prompts = req.message_prompts ?? {};
  const sequence: { channel: string; daysAfter: number }[] = prompts.sequence ?? [];
  const channels: string[] = req.channels ?? [...new Set(sequence.map((s: any) => s.channel))];
  const cm = prompts.channelMessages ?? {};
  const connectionRequest: string = cm.connectionRequest ?? "";
  const steps: any[] = cm.steps ?? prompts.messages ?? [];
  const autoReplies = cm.autoReplies ?? {};
  const isIndividual = !!req.lead_id && req.target_leads_count === 1;

  // Seller assignment: multi-seller uses prompts.sellerQuotas [{sellerId, quota}]
  // (leads distributed in order); single-seller falls back to prompts.sellerId.
  const rawQuotas: { sellerId: string; quota: number }[] =
    Array.isArray(prompts.sellerQuotas) ? prompts.sellerQuotas.filter((q: any) => q && q.sellerId) : [];
  const singleSellerId: string | null = prompts.sellerId ?? null;
  const sellerNames = await getSellerNames(
    rawQuotas.length ? rawQuotas.map(q => q.sellerId) : (singleSellerId ? [singleSellerId] : []),
  );
  const quotaSum = rawQuotas.reduce((a, q) => a + (Number(q.quota) || 0), 0);
  // Rows to render: the multi-seller split, or a single 100% row, or nothing.
  const sellerRows: { name: string; quota: number; pct: number }[] =
    rawQuotas.length > 0
      ? rawQuotas.map(q => ({
          name: sellerNames.get(q.sellerId) ?? "Unknown seller",
          quota: Number(q.quota) || 0,
          pct: quotaSum > 0 ? Math.round(((Number(q.quota) || 0) / quotaSum) * 100) : 0,
        }))
      : singleSellerId
      ? [{ name: sellerNames.get(singleSellerId) ?? "Unknown seller", quota: req.target_leads_count ?? 0, pct: 100 }]
      : [];

  let totalDays = 0;
  let cumDay = 0;
  const dayPerStep = sequence.map((s: any, i: number) => {
    cumDay += i === 0 ? 0 : s.daysAfter;
    totalDays = cumDay;
    return cumDay;
  });

  return (
    <div className="p-6 w-full">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs mb-4" style={{ color: C.textMuted }}>
        <Link href="/admin" className="hover:underline flex items-center gap-1"><ArrowLeft size={12} /> Admin</Link>
        <span>/</span>
        <span style={{ color: C.textBody }}>Campaign Review</span>
      </div>

      {/* Header */}
      <div className="rounded-xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="p-6 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              {isIndividual && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md"
                  style={{ backgroundColor: `color-mix(in srgb, ${gold} 8%, transparent)`, color: gold }}>
                  <User size={10} /> Individual
                </span>
              )}
              <span className="text-xs font-semibold px-2 py-0.5 rounded-md"
                style={{ backgroundColor: "color-mix(in srgb, #D97706 13%, transparent)", color: "#D97706" }}>
                Pending Review
              </span>
            </div>
            <h1 className="text-2xl font-bold" style={{ color: C.textPrimary }}>{req.name}</h1>
            <div className="flex items-center gap-3 mt-2 text-xs" style={{ color: C.textMuted }}>
              <span><Clock size={11} className="inline mr-1" />{new Date(req.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
              <span>·</span>
              <span>{req.target_leads_count} {req.target_leads_count === 1 ? "lead" : "leads"}</span>
              <span>·</span>
              <span>{sequence.length} steps · ~{totalDays} days</span>
              {prompts.language && <><span>·</span><span className="uppercase">{prompts.language}</span></>}
            </div>
          </div>
          <AdminActions id={req.id} table="campaign_requests" />
        </div>

        <div className="border-t" style={{ borderColor: C.border }} />

        {/* Metrics */}
        <div className="px-6 py-4 grid grid-cols-4 gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Channels</p>
            <div className="flex gap-1.5 flex-wrap">
              {channels.map(ch => {
                const meta = channelMeta[ch];
                if (!meta) return null;
                const Icon = meta.icon;
                return (
                  <span key={ch} className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-md"
                    style={{ backgroundColor: `${meta.color}12`, color: meta.color }}>
                    <Icon size={11} /> {meta.label}
                  </span>
                );
              })}
            </div>
          </div>
          {lead && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Lead</p>
              <Link href={`/leads/${lead.id}`} className="text-sm font-bold hover:underline" style={{ color: C.textPrimary }}>
                {lead.primary_first_name} {lead.primary_last_name}
              </Link>
              <p className="text-xs" style={{ color: C.textMuted }}>{lead.company_name} · {lead.primary_title_role}</p>
            </div>
          )}
          {profile && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Lead Miner Profile</p>
              <p className="text-sm font-medium" style={{ color: C.textPrimary }}>{profile.profile_name}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: C.textMuted }}>Duration</p>
            <p className="text-sm font-bold" style={{ color: C.textPrimary }}>{sequence.length} steps · {totalDays} days</p>
          </div>
        </div>
      </div>

      {/* Sellers & Split */}
      {sellerRows.length > 0 && (
        <div className="rounded-xl border p-5 mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: C.textMuted }}>
              <Users size={12} /> {sellerRows.length > 1 ? "Sellers & Split" : "Assigned Seller"}
            </p>
            {sellerRows.length > 1 && (
              <span className="text-xs" style={{ color: C.textDim }}>
                {quotaSum} {quotaSum === 1 ? "lead" : "leads"} across {sellerRows.length} sellers
              </span>
            )}
          </div>
          <div className="space-y-3">
            {sellerRows.map((s, i) => {
              const color = SELLER_COLORS[i % SELLER_COLORS.length];
              const initials = s.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
              return (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold"
                    style={{ backgroundColor: `${color}18`, color }}>
                    {initials || <User size={13} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-semibold truncate" style={{ color: C.textPrimary }}>{s.name}</span>
                      <span className="text-xs font-medium tabular-nums ml-2 shrink-0" style={{ color: C.textMuted }}>
                        {s.quota} {s.quota === 1 ? "lead" : "leads"}{sellerRows.length > 1 ? ` · ${s.pct}%` : ""}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: C.border }}>
                      <div className="h-full rounded-full" style={{ width: `${s.pct}%`, backgroundColor: color }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sequence Timeline */}
      <div className="rounded-xl border p-5 mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Sequence Timeline</p>
        <div className="flex items-center gap-2 flex-wrap">
          {sequence.map((step: any, i: number) => {
            const meta = channelMeta[step.channel];
            if (!meta) return null;
            const Icon = meta.icon;
            return (
              <div key={i} className="flex items-center gap-2">
                <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: C.bg, border: `1px solid ${C.border}` }}>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: meta.color }}>
                    <Icon size={12} color="#fff" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold" style={{ color: C.textPrimary }}>{meta.label}</p>
                    <p className="text-xs" style={{ color: C.textDim }}>Day {dayPerStep[i]}{i > 0 ? ` (+${step.daysAfter}d)` : ""}</p>
                  </div>
                </div>
                {i < sequence.length - 1 && <div className="w-6 h-px" style={{ backgroundColor: C.border }} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Connection Request */}
      {connectionRequest && (
        <div className="rounded-xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: C.border, borderLeft: `3px solid ${C.linkedin}` }}>
          <div className="px-5 py-3 flex items-center gap-2 border-b" style={{ borderColor: C.border, background: `${C.linkedin}06` }}>
            <UserPlus size={14} style={{ color: C.linkedin }} />
            <span className="text-sm font-bold" style={{ color: C.linkedin }}>LinkedIn Connection Request</span>
            <span className="text-xs ml-auto" style={{ color: C.textDim }}>Max 200 chars · {connectionRequest.length}/200</span>
          </div>
          <div className="px-5 py-4">
            <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{connectionRequest}</p>
          </div>
        </div>
      )}

      {/* Messages — when sequence[0] is the LinkedIn day-0 invite, it IS the
          Connection Request (rendered as the dedicated card above) and must
          NOT also appear as Step 1 in the numbered list. */}
      <div className="space-y-4 mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Outreach Messages</p>
        {(() => {
          const hasCR = sequence[0]?.channel === "linkedin" && sequence[0]?.daysAfter === 0;
          let displayNum = 0;
          return steps.map((msg: any, i: number) => {
            if (hasCR && i === 0) return null;
            displayNum += 1;
            const ch = msg.channel ?? sequence[i]?.channel ?? "linkedin";
            const meta = channelMeta[ch];
            if (!meta) return null;
            const Icon = meta.icon;
            return (
              <div key={i} className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
                <div className="px-5 py-3 flex items-center gap-3 border-b" style={{ borderColor: C.border, background: `${meta.color}06` }}>
                  <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: meta.color }}>
                    <Icon size={12} color="#fff" />
                  </div>
                  <span className="text-sm font-bold" style={{ color: C.textPrimary }}>Step {displayNum}</span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-md" style={{ backgroundColor: `${meta.color}15`, color: meta.color }}>
                    {msg.label || meta.label}
                  </span>
                  <span className="text-xs ml-auto tabular-nums" style={{ color: C.textDim }}>Day {dayPerStep[i] ?? 0}</span>
                </div>
                <div className="px-5 py-4">
                  {msg.subject && (
                    <p className="text-xs font-semibold mb-2" style={{ color: C.textMuted }}>
                      Subject: <span style={{ color: C.textPrimary }}>{msg.subject}</span>
                    </p>
                  )}
                  <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>
                    {msg.body || "(empty)"}
                  </p>
                </div>
              </div>
            );
          });
        })()}
      </div>

      {/* Auto-Replies */}
      {(autoReplies.positive || autoReplies.negative) && (
        <div className="rounded-xl border overflow-hidden mb-6" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
          <div className="px-5 py-3 border-b" style={{ borderColor: C.border }}>
            <p className="text-sm font-bold" style={{ color: C.textPrimary }}>Auto-Replies</p>
            <p className="text-xs" style={{ color: C.textMuted }}>Sent automatically when the lead responds</p>
          </div>
          <div className="p-5 space-y-4">
            {autoReplies.positive && (
              <div className="rounded-lg border p-4" style={{ borderColor: C.border, backgroundColor: `${C.green}04` }}>
                <div className="flex items-center gap-2 mb-2">
                  <ThumbsUp size={13} style={{ color: C.green }} />
                  <p className="text-xs font-semibold" style={{ color: C.green }}>Positive Response</p>
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{autoReplies.positive}</p>
              </div>
            )}
            {autoReplies.negative && (
              <div className="rounded-lg border p-4" style={{ borderColor: C.border, backgroundColor: `${C.red}04` }}>
                <div className="flex items-center gap-2 mb-2">
                  <ThumbsDown size={13} style={{ color: C.red }} />
                  <p className="text-xs font-semibold" style={{ color: C.red }}>Negative Response</p>
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>{autoReplies.negative}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom action bar */}
      <div className="rounded-xl border px-6 py-4 flex items-center justify-between" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <Link href={`/admin/${req.icp_profile_id ? req.icp_profile_id : ""}`}
          className="text-xs font-medium" style={{ color: C.textMuted }}>
          <ArrowLeft size={12} className="inline mr-1" /> Back to client
        </Link>
        <AdminActions id={req.id} table="campaign_requests" />
      </div>
    </div>
  );
}
