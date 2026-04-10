"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import {
  Share2, Mail, Phone, Check, Pencil, X, Save,
  PlayCircle, PauseCircle, Loader2, Pause, Play, Trash2, Send,
} from "lucide-react";

const gold = "#C9A83A";

const channelMeta: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  linkedin: { icon: Share2, color: C.linkedin, label: "LinkedIn" },
  email:    { icon: Mail,   color: C.email,    label: "Email" },
  whatsapp: { icon: Mail,   color: "#22c55e",  label: "WhatsApp" },
  call:     { icon: Phone,  color: C.phone,    label: "Call" },
};

type Message = {
  id: string;
  campaign_id: string;
  lead_id: string;
  step_number: number;
  channel: string;
  content: string;
  subject?: string | null;
  status: string;
  sent_at: string | null;
  created_at: string;
};

export default function CampaignDetailClient({
  campaignId,
  campaignStatus,
  sequence,
  messages,
  dayPerStep,
  currentStep,
}: {
  campaignId: string;
  campaignStatus: string;
  sequence: { channel: string; daysAfter: number }[];
  messages: Message[];
  dayPerStep: number[];
  currentStep: number;
}) {
  const router = useRouter();
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  function startEdit(msg: Message) {
    setEditingIdx(msg.step_number);
    setEditContent(msg.content ?? "");
    setEditSubject(msg.subject ?? "");
  }

  function cancelEdit() {
    setEditingIdx(null);
    setEditContent("");
    setEditSubject("");
  }

  async function saveEdit(msg: Message) {
    setSaving(true);
    const res = await fetch(`/api/messages/${msg.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editContent }),
    });
    if (res.ok) {
      setEditingIdx(null);
      router.refresh();
    }
    setSaving(false);
  }

  async function handleCampaignAction(action: "pause" | "resume" | "cancel") {
    setActing(action);
    const newStatus = action === "pause" ? "paused" : action === "resume" ? "active" : "completed";
    await supabase.from("campaigns").update({ status: newStatus }).eq("id", campaignId);
    setActing(null);
    router.refresh();
  }

  const isEditable = campaignStatus === "active" || campaignStatus === "paused";

  return (
    <div>
      {/* Campaign actions bar */}
      {isEditable && (
        <div className="rounded-xl border px-5 py-3 mb-6 flex items-center gap-3"
          style={{ backgroundColor: C.card, borderColor: C.border }}>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.textMuted }}>Campaign Actions</span>
          <div className="flex-1" />
          {campaignStatus === "active" ? (
            <button onClick={() => handleCampaignAction("pause")} disabled={!!acting}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity disabled:opacity-50"
              style={{ backgroundColor: "#FFFBEB", color: "#D97706" }}>
              {acting === "pause" ? <Loader2 size={12} className="animate-spin" /> : <Pause size={12} />}
              Pause Campaign
            </button>
          ) : (
            <button onClick={() => handleCampaignAction("resume")} disabled={!!acting}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity disabled:opacity-50"
              style={{ backgroundColor: C.greenLight, color: C.green }}>
              {acting === "resume" ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              Resume Campaign
            </button>
          )}
          <button onClick={() => { if (confirm("Cancel this campaign? This will stop all future messages.")) handleCampaignAction("cancel"); }}
            disabled={!!acting}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity disabled:opacity-50"
            style={{ backgroundColor: C.redLight, color: C.red }}>
            {acting === "cancel" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            Cancel Campaign
          </button>
        </div>
      )}

      {/* Sequence timeline with messages */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, borderTop: `2px solid ${gold}` }}>
        <div className="px-6 py-4 border-b" style={{ borderColor: C.border }}>
          <h2 className="text-sm font-bold" style={{ color: C.textPrimary }}>Message Sequence</h2>
          <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>Click the edit icon to modify pending messages</p>
        </div>

        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-9 top-0 bottom-0 w-0.5" style={{ backgroundColor: C.border }} />

          {sequence.map((step, i) => {
            const meta = channelMeta[step.channel] ?? channelMeta.linkedin;
            const Icon = meta.icon;
            const msg = messages.find(m => m.step_number === i + 1);
            const isSent = msg?.status === "sent";
            const isPending = msg?.status === "draft" || msg?.status === "pending";
            const isCurrent = i + 1 === currentStep + 1;
            const isPast = i + 1 <= currentStep;
            const isEditing = editingIdx === i + 1;

            return (
              <div key={i} className="relative px-6 py-5" style={{ borderBottom: i < sequence.length - 1 ? `1px solid ${C.border}` : "none" }}>
                <div className="flex items-start gap-4">
                  {/* Step indicator */}
                  <div className="relative z-10 shrink-0">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center"
                      style={{
                        backgroundColor: isPast ? meta.color : isCurrent ? gold : C.bg,
                        border: isPast || isCurrent ? "none" : `2px solid ${C.border}`,
                      }}>
                      {isPast ? (
                        <Check size={13} color="#fff" />
                      ) : isCurrent ? (
                        <PlayCircle size={13} color="#fff" />
                      ) : (
                        <span className="text-xs font-bold" style={{ color: C.textDim }}>{i + 1}</span>
                      )}
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Header */}
                    <div className="flex items-center gap-3 mb-2">
                      <span className="flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-md"
                        style={{ backgroundColor: `${meta.color}12`, color: meta.color }}>
                        <Icon size={11} /> {meta.label}
                      </span>
                      <span className="text-xs tabular-nums font-medium" style={{ color: C.textDim }}>Day {dayPerStep[i] ?? 0}</span>
                      {i > 0 && (
                        <span className="text-xs" style={{ color: C.textDim }}>
                          (+{step.daysAfter}d from previous)
                        </span>
                      )}
                      <div className="flex-1" />
                      {isSent && (
                        <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-md"
                          style={{ backgroundColor: C.greenLight, color: C.green }}>
                          <Send size={10} /> Sent {msg.sent_at ? new Date(msg.sent_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : ""}
                        </span>
                      )}
                      {isPending && !isEditing && isEditable && (
                        <button onClick={() => startEdit(msg!)}
                          className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md transition-opacity hover:opacity-80"
                          style={{ backgroundColor: `${gold}15`, color: gold }}>
                          <Pencil size={11} /> Edit
                        </button>
                      )}
                      {isPending && !isSent && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-md"
                          style={{ backgroundColor: "#F3F4F6", color: C.textMuted }}>
                          {isCurrent ? "Up Next" : "Pending"}
                        </span>
                      )}
                    </div>

                    {/* Message content */}
                    {msg && !isEditing && (
                      <div className="rounded-lg border p-4" style={{
                        borderColor: isSent ? `${C.green}30` : isCurrent ? `${gold}30` : C.border,
                        backgroundColor: isSent ? `${C.green}04` : isCurrent ? `${gold}04` : C.bg,
                      }}>
                        {msg.subject && (
                          <p className="text-xs font-semibold mb-2" style={{ color: C.textMuted }}>
                            Subject: <span style={{ color: C.textPrimary }}>{msg.subject}</span>
                          </p>
                        )}
                        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.textBody }}>
                          {msg.content}
                        </p>
                      </div>
                    )}

                    {/* Edit mode */}
                    {isEditing && msg && (
                      <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: gold, backgroundColor: `${gold}04` }}>
                        {msg.channel === "email" && (
                          <div>
                            <label className="block text-xs font-medium mb-1" style={{ color: C.textMuted }}>Subject</label>
                            <input
                              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                              style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.card }}
                              value={editSubject}
                              onChange={e => setEditSubject(e.target.value)}
                            />
                          </div>
                        )}
                        <div>
                          <label className="block text-xs font-medium mb-1" style={{ color: C.textMuted }}>Message</label>
                          <textarea
                            rows={msg.channel === "email" ? 8 : msg.channel === "call" ? 5 : 4}
                            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none resize-none"
                            style={{ borderColor: C.border, color: C.textPrimary, backgroundColor: C.card }}
                            value={editContent}
                            onChange={e => setEditContent(e.target.value)}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => saveEdit(msg)} disabled={saving}
                            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50"
                            style={{ backgroundColor: C.green, color: "#fff" }}>
                            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                            Save
                          </button>
                          <button onClick={cancelEdit}
                            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium"
                            style={{ backgroundColor: "#F3F4F6", color: C.textBody }}>
                            <X size={12} /> Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* No message yet */}
                    {!msg && (
                      <div className="rounded-lg border border-dashed p-4 text-center" style={{ borderColor: C.border }}>
                        <p className="text-xs" style={{ color: C.textDim }}>No message generated for this step</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
