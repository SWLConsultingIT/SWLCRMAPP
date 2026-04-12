"use client";

import { useState } from "react";
import { C } from "@/lib/design";
import {
  Share2, Mail, Phone, Sparkles, Loader2, ChevronDown, ChevronRight,
  MessageCircle, UserPlus, ThumbsUp, ThumbsDown, HelpCircle,
} from "lucide-react";
import MessageAttachments, { type Attachment } from "./MessageAttachments";

const gold = C.gold;

// ── Types ──

export type ChannelMessages = {
  linkedin?: {
    connectionNote: string;
    introDM: string;
    followUps: string[];
    replyPositive: string;
    replyNegative: string;
    replyQuestion: string;
  };
  email?: {
    introSubject: string;
    introBody: string;
    followUps: { subject: string; body: string }[];
    replyPositive: string;
    replyNegative: string;
    replyQuestion: string;
  };
  call?: {
    script: string;
    followUpScript: string;
  };
};

type Props = {
  channels: string[];
  channelMessages: ChannelMessages;
  onChange: (msgs: ChannelMessages) => void;
  sequence: { channel: string; daysAfter: number }[];
  leadId?: string;
  language: string;
};

// ── Field AI Generator ──

function AIButton({ onGenerate, loading, label }: { onGenerate: () => void; loading: boolean; label?: string }) {
  return (
    <button onClick={onGenerate} disabled={loading}
      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-50 shrink-0"
      style={{ backgroundColor: `${gold}15`, color: gold }}>
      {loading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
      {label || "Generate with AI"}
    </button>
  );
}

// ── Section Header ──

function SectionHeader({ icon: Icon, color, label, description }: { icon: React.ElementType; color: string; label: string; description: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${color}15` }}>
        <Icon size={16} style={{ color }} />
      </div>
      <div>
        <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>{label}</p>
        <p className="text-xs" style={{ color: C.textMuted }}>{description}</p>
      </div>
    </div>
  );
}

// ── Field Editor ──

function FieldEditor({
  label, description, value, onChange, rows, maxChars, onAIGenerate, aiLoading, placeholder,
}: {
  label: string; description?: string; value: string; onChange: (v: string) => void;
  rows?: number; maxChars?: number; onAIGenerate?: () => void; aiLoading?: boolean; placeholder?: string;
}) {
  return (
    <div className="rounded-lg border p-4 space-y-2" style={{ borderColor: C.border, backgroundColor: C.bg }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold" style={{ color: C.textPrimary }}>{label}</p>
          {description && <p className="text-xs" style={{ color: C.textDim }}>{description}</p>}
        </div>
        {onAIGenerate && <AIButton onGenerate={onAIGenerate} loading={aiLoading || false} />}
      </div>
      <textarea
        rows={rows || 3}
        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
        style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.card }}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || ""}
      />
      {maxChars && (
        <p className="text-xs text-right" style={{ color: value.length > maxChars ? C.red : C.textDim }}>
          {value.length}/{maxChars}
        </p>
      )}
    </div>
  );
}

// ── Main Component ──

export default function ChannelMessageConfig({ channels, channelMessages, onChange, sequence, leadId, language }: Props) {
  const [expandedChannel, setExpandedChannel] = useState<string>(channels[0] || "linkedin");
  const [aiLoading, setAiLoading] = useState<string | null>(null);

  const linkedinStepCount = sequence.filter(s => s.channel === "linkedin").length;
  const emailStepCount = sequence.filter(s => s.channel === "email").length;
  const linkedinFollowUps = Math.max(0, linkedinStepCount - 2); // minus connection + intro
  const emailFollowUps = Math.max(0, emailStepCount - 1); // minus intro

  // Ensure followUps arrays match sequence
  function ensureFollowUps() {
    const msgs = { ...channelMessages };
    if (msgs.linkedin && msgs.linkedin.followUps.length !== linkedinFollowUps) {
      msgs.linkedin = { ...msgs.linkedin, followUps: Array.from({ length: linkedinFollowUps }, (_, i) => msgs.linkedin!.followUps[i] || "") };
    }
    if (msgs.email && msgs.email.followUps.length !== emailFollowUps) {
      msgs.email = { ...msgs.email, followUps: Array.from({ length: emailFollowUps }, (_, i) => msgs.email!.followUps[i] || { subject: "", body: "" }) };
    }
    return msgs;
  }

  function update(channel: string, field: string, value: any) {
    const msgs = ensureFollowUps();
    const ch = msgs[channel as keyof ChannelMessages] as any;
    if (!ch) return;
    ch[field] = value;
    onChange(msgs);
  }

  function updateFollowUp(channel: string, idx: number, value: any) {
    const msgs = ensureFollowUps();
    if (channel === "linkedin" && msgs.linkedin) {
      msgs.linkedin.followUps[idx] = value;
    } else if (channel === "email" && msgs.email) {
      msgs.email.followUps[idx] = value;
    }
    onChange(msgs);
  }

  // AI generation per field
  async function generateField(channel: string, fieldType: string, idx?: number) {
    const key = `${channel}:${fieldType}:${idx ?? ""}`;
    setAiLoading(key);

    try {
      const res = await fetch("/api/campaigns/generate-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, fieldType, idx, leadId, language }),
      });
      const data = await res.json();
      if (data.content) {
        if (fieldType === "followUp" && idx !== undefined) {
          updateFollowUp(channel, idx, channel === "email" ? { subject: data.subject || "", body: data.content } : data.content);
        } else if (fieldType === "introEmail") {
          update("email", "introSubject", data.subject || "");
          update("email", "introBody", data.content);
        } else {
          const fieldMap: Record<string, string> = {
            connectionNote: "connectionNote",
            introDM: "introDM",
            replyPositive: "replyPositive",
            replyNegative: "replyNegative",
            replyQuestion: "replyQuestion",
            callScript: "script",
            callFollowUp: "followUpScript",
          };
          update(channel, fieldMap[fieldType] || fieldType, data.content);
        }
      }
    } catch { /* silent */ }

    setAiLoading(null);
  }

  const channelConfig = [
    { key: "linkedin", label: "LinkedIn", icon: Share2, color: C.linkedin },
    { key: "email", label: "Email", icon: Mail, color: C.email },
    { key: "call", label: "Call", icon: Phone, color: C.phone },
  ];

  return (
    <div className="space-y-4">
      {/* Channel tabs */}
      <div className="flex gap-2">
        {channelConfig.filter(c => channels.includes(c.key)).map(ch => {
          const active = expandedChannel === ch.key;
          const Icon = ch.icon;
          return (
            <button key={ch.key} onClick={() => setExpandedChannel(ch.key)}
              className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all"
              style={active
                ? { backgroundColor: ch.color, color: "#fff" }
                : { backgroundColor: C.bg, color: C.textMuted, border: `1px solid ${C.border}` }
              }>
              <Icon size={14} /> {ch.label}
            </button>
          );
        })}
      </div>

      {/* ═══ LINKEDIN CONFIG ═══ */}
      {expandedChannel === "linkedin" && channels.includes("linkedin") && (() => {
        const li = channelMessages.linkedin || {
          connectionNote: "", introDM: "", followUps: Array(linkedinFollowUps).fill(""),
          replyPositive: "", replyNegative: "", replyQuestion: "",
        };
        if (!channelMessages.linkedin) onChange({ ...channelMessages, linkedin: li });

        return (
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.linkedin}` }}>
            <div className="p-5 space-y-5">

              {/* Connection Request Note */}
              <div>
                <SectionHeader icon={UserPlus} color={C.linkedin} label="Connection Request"
                  description="Short note sent with the connection request (max 300 chars)" />
                <FieldEditor
                  label="Connection Note" description="Brief intro: who you are + why you want to connect"
                  value={li.connectionNote} onChange={v => update("linkedin", "connectionNote", v)}
                  rows={2} maxChars={300} placeholder="Hola [nombre], soy [vendedor] de SWL Consulting. Vi tu trabajo en [tema]..."
                  onAIGenerate={() => generateField("linkedin", "connectionNote")} aiLoading={aiLoading === "linkedin:connectionNote:"}
                />
              </div>

              {/* Intro DM */}
              <div>
                <SectionHeader icon={MessageCircle} color={C.linkedin} label="First Message (Post-Connection)"
                  description="Sent after they accept. Starts with 'Gracias por conectar' + full intro" />
                <FieldEditor
                  label="Introduction DM" description="Thank for connecting + who you are + what you offer + CTA"
                  value={li.introDM} onChange={v => update("linkedin", "introDM", v)}
                  rows={5} maxChars={1000} placeholder="Gracias por conectar, [nombre]. Soy [vendedor] de SWL Consulting..."
                  onAIGenerate={() => generateField("linkedin", "introDM")} aiLoading={aiLoading === "linkedin:introDM:"}
                />
              </div>

              {/* Follow-ups */}
              {linkedinFollowUps > 0 && (
                <div>
                  <SectionHeader icon={Share2} color={C.linkedin} label={`Follow-ups (${linkedinFollowUps})`}
                    description="Each adds new value. Sent if no reply to previous message" />
                  {li.followUps.map((fu: string, i: number) => (
                    <div key={i} className="mb-3">
                      <FieldEditor
                        label={`Follow-up ${i + 1}`} description={`New angle, case study, or insight`}
                        value={fu} onChange={v => updateFollowUp("linkedin", i, v)}
                        rows={4} maxChars={700} placeholder={`[nombre], volviendo a lo que te comenté sobre...`}
                        onAIGenerate={() => generateField("linkedin", "followUp", i)} aiLoading={aiLoading === `linkedin:followUp:${i}`}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Auto-replies */}
              <div className="border-t pt-5" style={{ borderColor: C.border }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Auto-Replies (when lead responds)</p>

                <div className="space-y-3">
                  <FieldEditor
                    label="Reply to Positive Response" description="Lead says yes / interested → schedule meeting"
                    value={li.replyPositive} onChange={v => update("linkedin", "replyPositive", v)}
                    rows={3} placeholder="¡Excelente! Me alegra mucho tu interés. Te propongo coordinar una llamada de 15 min..."
                    onAIGenerate={() => generateField("linkedin", "replyPositive")} aiLoading={aiLoading === "linkedin:replyPositive:"}
                  />
                  <FieldEditor
                    label="Reply to Negative Response" description="Lead says no → close respectfully"
                    value={li.replyNegative} onChange={v => update("linkedin", "replyNegative", v)}
                    rows={2} placeholder="Entiendo perfectamente. Gracias por tu tiempo. Si en el futuro..."
                    onAIGenerate={() => generateField("linkedin", "replyNegative")} aiLoading={aiLoading === "linkedin:replyNegative:"}
                  />
                  <FieldEditor
                    label="Reply to Question" description="Lead asks a question → answer and keep conversation going"
                    value={li.replyQuestion} onChange={v => update("linkedin", "replyQuestion", v)}
                    rows={3} placeholder="¡Buena pregunta! [Respuesta]. ¿Te gustaría profundizar en una llamada corta?"
                    onAIGenerate={() => generateField("linkedin", "replyQuestion")} aiLoading={aiLoading === "linkedin:replyQuestion:"}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ EMAIL CONFIG ═══ */}
      {expandedChannel === "email" && channels.includes("email") && (() => {
        const em = channelMessages.email || {
          introSubject: "", introBody: "", followUps: Array(emailFollowUps).fill({ subject: "", body: "" }),
          replyPositive: "", replyNegative: "", replyQuestion: "",
        };
        if (!channelMessages.email) onChange({ ...channelMessages, email: em });

        return (
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.email}` }}>
            <div className="p-5 space-y-5">

              {/* Intro Email */}
              <div>
                <SectionHeader icon={Mail} color={C.email} label="Introduction Email"
                  description="First email: subject + body with company intro" />
                <div className="space-y-2">
                  <div className="rounded-lg border p-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold" style={{ color: C.textPrimary }}>Subject + Body</p>
                      <AIButton onGenerate={() => generateField("email", "introEmail")} loading={aiLoading === "email:introEmail:"} />
                    </div>
                    <input
                      className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none mb-2"
                      style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.card }}
                      value={em.introSubject} onChange={e => update("email", "introSubject", e.target.value)}
                      placeholder="Subject line (max 60 chars)..."
                    />
                    <textarea
                      rows={6}
                      className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
                      style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.card }}
                      value={em.introBody} onChange={e => update("email", "introBody", e.target.value)}
                      placeholder="Hola [nombre], soy [vendedor] de SWL Consulting..."
                    />
                  </div>
                </div>
              </div>

              {/* Follow-ups */}
              {emailFollowUps > 0 && (
                <div>
                  <SectionHeader icon={Mail} color={C.email} label={`Follow-ups (${emailFollowUps})`}
                    description="Each adds new value. Short emails referencing the previous" />
                  {em.followUps.map((fu: any, i: number) => (
                    <div key={i} className="mb-3 rounded-lg border p-4" style={{ borderColor: C.border, backgroundColor: C.bg }}>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold" style={{ color: C.textPrimary }}>Follow-up {i + 1}</p>
                        <AIButton onGenerate={() => generateField("email", "followUp", i)} loading={aiLoading === `email:followUp:${i}`} />
                      </div>
                      <input
                        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none mb-2"
                        style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.card }}
                        value={fu.subject || ""} onChange={e => updateFollowUp("email", i, { ...fu, subject: e.target.value })}
                        placeholder="Re: subject..."
                      />
                      <textarea rows={3}
                        className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
                        style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.card }}
                        value={fu.body || ""} onChange={e => updateFollowUp("email", i, { ...fu, body: e.target.value })}
                        placeholder="Short follow-up referencing previous email..."
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Auto-replies */}
              <div className="border-t pt-5" style={{ borderColor: C.border }}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: C.textMuted }}>Auto-Replies</p>
                <div className="space-y-3">
                  <FieldEditor label="Reply to Positive" value={em.replyPositive} onChange={v => update("email", "replyPositive", v)} rows={3}
                    onAIGenerate={() => generateField("email", "replyPositive")} aiLoading={aiLoading === "email:replyPositive:"} />
                  <FieldEditor label="Reply to Negative" value={em.replyNegative} onChange={v => update("email", "replyNegative", v)} rows={2}
                    onAIGenerate={() => generateField("email", "replyNegative")} aiLoading={aiLoading === "email:replyNegative:"} />
                  <FieldEditor label="Reply to Question" value={em.replyQuestion} onChange={v => update("email", "replyQuestion", v)} rows={3}
                    onAIGenerate={() => generateField("email", "replyQuestion")} aiLoading={aiLoading === "email:replyQuestion:"} />
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ CALL CONFIG ═══ */}
      {expandedChannel === "call" && channels.includes("call") && (() => {
        const ca = channelMessages.call || { script: "", followUpScript: "" };
        if (!channelMessages.call) onChange({ ...channelMessages, call: ca });

        return (
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${C.phone}` }}>
            <div className="p-5 space-y-5">
              <SectionHeader icon={Phone} color={C.phone} label="Call Scripts" description="Talking points for sales calls" />
              <FieldEditor label="First Call Script" description="Opener → Context → Questions → Pitch → Close"
                value={ca.script} onChange={v => update("call", "script", v)} rows={6}
                placeholder="• Apertura: Hola [nombre], soy [vendedor] de SWL Consulting...&#10;• Contexto: ...&#10;• Preguntas: ...&#10;• Pitch: ...&#10;• Cierre: ..."
                onAIGenerate={() => generateField("call", "callScript")} aiLoading={aiLoading === "call:callScript:"} />
              {sequence.filter(s => s.channel === "call").length > 1 && (
                <FieldEditor label="Follow-up Call Script" description="Reference previous contact, new angle"
                  value={ca.followUpScript} onChange={v => update("call", "followUpScript", v)} rows={5}
                  onAIGenerate={() => generateField("call", "callFollowUp")} aiLoading={aiLoading === "call:callFollowUp:"} />
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
