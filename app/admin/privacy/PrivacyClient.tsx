"use client";

import { useState } from "react";
import { C } from "@/lib/design";
import { Lock, Shield, Sparkles, Mail, X, Bot, User, Server, Eye, ExternalLink } from "lucide-react";

type AccessEntry = {
  id: string;
  lead_id: string | null;
  caller: string;
  reason: string | null;
  encryption_mode: string | null;
  occurred_at: string;
};

const callerMeta: Record<string, { label: string; color: string; bg: string; icon: typeof Bot }> = {
  "agent-ai":  { label: "AI agent",     color: C.blue,  bg: C.blueLight,  icon: Bot },
  "client-app": { label: "Your team",   color: C.green, bg: C.greenLight, icon: User },
  "swl-admin":  { label: "SWL admin",   color: "#D97706", bg: "color-mix(in srgb, #D97706 13%, transparent)",  icon: Eye },
  "system":     { label: "System",      color: C.textMuted, bg: C.surface, icon: Server },
};

export default function PrivacyClient({
  mode, sovereignUrl, keyVersion, entries, tier,
}: {
  mode: "standard" | "sovereign";
  sovereignUrl: string | null;
  keyVersion: number;
  entries: AccessEntry[];
  tier: string | null;
}) {
  const [showSovereignModal, setShowSovereignModal] = useState(false);
  const isOwner = tier === "super_admin" || tier === "owner";

  return (
    <div className="space-y-6">
      <ModeCard
        mode={mode}
        sovereignUrl={sovereignUrl}
        keyVersion={keyVersion}
        canManage={isOwner}
        onUpgrade={() => setShowSovereignModal(true)}
      />

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Access log</h2>
          <p className="text-[10px]" style={{ color: C.textMuted }}>Last 100 reads — newest first</p>
        </div>

        {entries.length === 0 ? (
          <div className="rounded-2xl border p-8 text-center" style={{ borderColor: C.border, backgroundColor: C.card }}>
            <p className="text-sm" style={{ color: C.textMuted }}>No decrypts logged yet. Activity will appear here as soon as the AI agent or your team reads encrypted leads.</p>
          </div>
        ) : (
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: C.border, backgroundColor: C.card }}>
            <table className="w-full text-xs">
              <thead style={{ backgroundColor: C.bg }}>
                <tr style={{ color: C.textMuted }}>
                  <th className="text-left px-4 py-2 font-semibold">When</th>
                  <th className="text-left px-4 py-2 font-semibold">Caller</th>
                  <th className="text-left px-4 py-2 font-semibold">Reason</th>
                  <th className="text-left px-4 py-2 font-semibold">Lead</th>
                  <th className="text-left px-4 py-2 font-semibold">Mode</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => {
                  const meta = callerMeta[e.caller] ?? callerMeta.system;
                  const Icon = meta.icon;
                  return (
                    <tr key={e.id} className="border-t" style={{ borderColor: C.border }}>
                      <td className="px-4 py-2 font-mono text-[11px]" style={{ color: C.textBody }}>
                        {new Date(e.occurred_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold" style={{ backgroundColor: meta.bg, color: meta.color }}>
                          <Icon size={10} /> {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-2" style={{ color: C.textBody }}>{e.reason ?? "—"}</td>
                      <td className="px-4 py-2 font-mono text-[10px]" style={{ color: C.textDim }}>
                        {e.lead_id ? e.lead_id.slice(0, 8) : "(bulk)"}
                      </td>
                      <td className="px-4 py-2">
                        {e.encryption_mode === "sovereign" ? (
                          <span className="text-[10px] font-bold" style={{ color: C.green }}>SOVEREIGN</span>
                        ) : e.encryption_mode === "standard" ? (
                          <span className="text-[10px] font-bold" style={{ color: C.blue }}>STANDARD</span>
                        ) : (
                          <span className="text-[10px]" style={{ color: C.textDim }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showSovereignModal && <SovereignComingSoonModal onClose={() => setShowSovereignModal(false)} />}
    </div>
  );
}

function ModeCard({
  mode, sovereignUrl, keyVersion, canManage, onUpgrade,
}: {
  mode: "standard" | "sovereign";
  sovereignUrl: string | null;
  keyVersion: number;
  canManage: boolean;
  onUpgrade: () => void;
}) {
  const isStandard = mode === "standard";
  return (
    <div className="rounded-2xl border p-6" style={{ borderColor: C.border, backgroundColor: C.card, borderTop: `3px solid ${isStandard ? C.blue : C.green}` }}>
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: isStandard ? C.blueLight : C.greenLight }}>
          {isStandard ? <Shield size={20} style={{ color: C.blue }} /> : <Lock size={20} style={{ color: C.green }} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-base font-bold" style={{ color: C.textPrimary }}>
              {isStandard ? "Standard mode" : "Sovereign mode"}
            </h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ backgroundColor: isStandard ? C.blueLight : C.greenLight, color: isStandard ? C.blue : C.green }}>
              ACTIVE
            </span>
            <span className="text-[10px]" style={{ color: C.textMuted }}>· key v{keyVersion}</span>
          </div>
          <p className="text-xs leading-relaxed mb-4" style={{ color: C.textBody }}>
            {isStandard ? (
              <>Your client-uploaded leads are encrypted with AES-256 at rest. SWL operators don&apos;t see PII in admin views, every read is logged, and the contract guarantees no other use. The encryption key is custodied by SWL.</>
            ) : (
              <>Your encryption key lives in your own infrastructure — SWL technically cannot decrypt your leads without calling your endpoint. If you revoke access, the AI agent stops processing. Endpoint: <span className="font-mono">{sovereignUrl ?? "(not set)"}</span></>
            )}
          </p>

          {isStandard && canManage && (
            <button
              onClick={onUpgrade}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-opacity hover:opacity-90"
              style={{ background: `linear-gradient(135deg, ${C.green}, color-mix(in srgb, ${C.green} 70%, white))`, color: "#fff" }}
            >
              <Sparkles size={12} /> Upgrade to Sovereign
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SovereignComingSoonModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
      <div className="rounded-2xl border p-6 w-full max-w-lg shadow-2xl" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold" style={{ color: C.textPrimary }}>Sovereign Encryption</h2>
          <button onClick={onClose}><X size={18} style={{ color: C.textMuted }} /></button>
        </div>
        <div className="rounded-xl border p-4 mb-4" style={{ borderColor: `${C.green}30`, backgroundColor: C.greenLight }}>
          <p className="text-xs font-bold mb-2" style={{ color: C.green }}>Zero-knowledge encryption — coming soon</p>
          <p className="text-[11px] leading-relaxed" style={{ color: C.textBody }}>
            With Sovereign mode, your team deploys a small worker (free Cloudflare tier) holding the encryption key on your own infrastructure. SWL calls your worker every time it needs to decrypt a lead. If you revoke access, the AI agent immediately loses the ability to read your data.
          </p>
        </div>

        <div className="space-y-3 mb-5">
          <Bullet>Your team installs a 50-line Cloudflare Worker template (10–15 min setup).</Bullet>
          <Bullet>You generate the AES-256 key and paste it into the Worker&apos;s env var. SWL never sees it.</Bullet>
          <Bullet>SWL configures the worker URL + access token in this page. Validation runs end-to-end.</Bullet>
          <Bullet>You see every decrypt call in your Cloudflare logs <em>plus</em> the access log here.</Bullet>
        </div>

        <p className="text-[11px] mb-4" style={{ color: C.textMuted }}>
          Sovereign mode is being prepared for the first client that requests it. Book a call with us and we&apos;ll activate it for your tenant within 1–2 days.
        </p>

        <div className="flex items-center justify-end gap-3">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium" style={{ backgroundColor: C.surface, color: C.textBody }}>
            Maybe later
          </button>
          <a
            href="mailto:it@swlconsulting.com?subject=Sovereign Encryption — request"
            className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: `linear-gradient(135deg, ${C.green}, color-mix(in srgb, ${C.green} 70%, white))`, color: "#fff" }}
          >
            <Mail size={14} /> Book a call
            <ExternalLink size={12} />
          </a>
        </div>
      </div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div className="w-1 h-1 rounded-full mt-2 shrink-0" style={{ backgroundColor: C.green }} />
      <p className="text-[11px] leading-relaxed flex-1" style={{ color: C.textBody }}>{children}</p>
    </div>
  );
}
