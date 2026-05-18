"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Play, MoreHorizontal, Copy, FolderTree, Trash2, X, ArrowRight, Loader2,
  Pencil, Save, Share2, Mail, Phone, MessageSquare,
} from "lucide-react";
import { C } from "@/lib/design";
import TemplateLaunchModal from "@/components/TemplateLaunchModal";

const gold = "var(--brand, #c9a83a)";

type IcpOption = { id: string; profile_name: string };

type StepMsg = { step: number; channel: string; subject?: string | null; body: string; source_excerpt?: string };
type FullTemplate = {
  id: string; name: string; description?: string | null;
  sequence_steps: Array<{ channel: string; daysAfter: number }>;
  step_messages: {
    connectionRequest?: string;
    steps?: StepMsg[];
    autoReplies?: { positive?: string; negative?: string; question?: string };
  };
};

const channelMeta: Record<string, { icon: typeof Share2; color: string; label: string }> = {
  linkedin: { icon: Share2,        color: "#0A66C2", label: "LinkedIn" },
  email:    { icon: Mail,          color: "#7C3AED", label: "Email" },
  call:     { icon: Phone,         color: "#F97316", label: "Call" },
  whatsapp: { icon: MessageSquare, color: "#25D366", label: "WhatsApp" },
};

export default function TemplateDetailActions({
  templateId, templateName, currentIcpId, icps,
}: {
  templateId: string;
  templateName: string;
  currentIcpId: string | null;
  icps: IcpOption[];
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [submenu, setSubmenu] = useState<"main" | "duplicate" | "move">("main");
  const [busy, setBusy] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) { setSubmenu("main"); return; }
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  function handleUse() { setLaunchOpen(true); }

  async function handleAssign(icpId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icp_profile_id: icpId }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); alert(b.error ?? "Couldn't move"); return; }
      setMenuOpen(false);
      router.refresh();
    } finally { setBusy(false); }
  }

  async function handleDuplicate(icpId: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/templates/${templateId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icp_profile_id: icpId }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { alert(b.error ?? "Couldn't duplicate"); return; }
      if (b.template?.id) router.push(`/campaigns/templates/${b.template.id}`);
      else { setMenuOpen(false); router.refresh(); }
    } finally { setBusy(false); }
  }

  async function handleDelete() {
    if (busy) return;
    if (!confirm(`Delete template "${templateName}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/templates/${templateId}`, { method: "DELETE" });
      if (!res.ok) { const b = await res.json().catch(() => ({})); alert(b.error ?? "Couldn't delete"); return; }
      router.push("/campaigns");
    } finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <button onClick={handleUse} disabled={busy}
        className="text-sm font-semibold px-4 py-2 rounded-lg inline-flex items-center gap-2 disabled:opacity-50"
        style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#1A1A2E" }}>
        <Play size={13} /> Use template
      </button>

      <div className="relative" ref={ref}>
        <button onClick={() => setMenuOpen(o => !o)} disabled={busy}
          className="p-2 rounded-lg border disabled:opacity-50"
          style={{ borderColor: C.border, color: C.textBody, backgroundColor: C.card }}
          title="More actions">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <MoreHorizontal size={14} />}
        </button>

        {menuOpen && submenu === "main" && (
          <div className="absolute right-0 top-full mt-1 z-10 w-52 rounded-lg border shadow-lg overflow-hidden"
            style={{ backgroundColor: C.card, borderColor: C.border }}>
            <button onClick={() => { setMenuOpen(false); setEditOpen(true); }}
              className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-black/[0.04]"
              style={{ color: C.textBody }}>
              <Pencil size={12} /> Edit template
            </button>
            <button onClick={() => setSubmenu("duplicate")}
              className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-black/[0.04]"
              style={{ color: C.textBody }}>
              <Copy size={12} /> Duplicate to ICP… <ArrowRight size={10} className="ml-auto" />
            </button>
            <button onClick={() => setSubmenu("move")}
              className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-black/[0.04]"
              style={{ color: C.textBody }}>
              <FolderTree size={12} /> Move to ICP… <ArrowRight size={10} className="ml-auto" />
            </button>
            <button onClick={handleDelete}
              className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-black/[0.04] border-t"
              style={{ color: C.red, borderColor: C.border }}>
              <Trash2 size={12} /> Delete
            </button>
          </div>
        )}

        {menuOpen && submenu === "duplicate" && (
          <IcpPicker icps={icps} onPick={handleDuplicate}
            title="Duplicate to which ICP?" onCancel={() => setSubmenu("main")} />
        )}
        {menuOpen && submenu === "move" && (
          <IcpPicker icps={icps} onPick={handleAssign}
            title="Move to which ICP?" excludeId={currentIcpId} onCancel={() => setSubmenu("main")} />
        )}
      </div>

      {launchOpen && (
        <TemplateLaunchModal
          templateId={templateId}
          templateName={templateName}
          icpProfileId={currentIcpId}
          onClose={() => setLaunchOpen(false)}
        />
      )}

      {editOpen && (
        <EditOverlay
          templateId={templateId}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

/* ── Edit overlay ── */
function EditOverlay({ templateId, onClose, onSaved }: {
  templateId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tpl, setTpl] = useState<FullTemplate | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [connReq, setConnReq] = useState("");
  const [steps, setSteps] = useState<StepMsg[]>([]);

  useEffect(() => {
    fetch(`/api/templates/${templateId}`, { cache: "no-store" })
      .then(r => r.json())
      .then(({ template }) => {
        if (!template) return;
        setTpl(template);
        setName(template.name ?? "");
        setDescription(template.description ?? "");
        setConnReq(template.step_messages?.connectionRequest ?? "");
        setSteps(Array.isArray(template.step_messages?.steps) ? template.step_messages.steps : []);
      })
      .finally(() => setLoading(false));
  }, [templateId]);

  function updateStep(idx: number, field: "subject" | "body", val: string) {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: val } : s));
  }

  async function handleSave() {
    if (!tpl) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || tpl.name,
          description: description.trim() || null,
          step_messages: {
            ...tpl.step_messages,
            connectionRequest: connReq,
            steps,
          },
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        alert(b.error ?? "Save failed");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const cumulativeDays = (() => {
    if (!tpl) return [];
    let d = 0;
    return (tpl.sequence_steps ?? []).map((s, i) => {
      if (i === 0) { d = s.daysAfter; return s.daysAfter; }
      d += s.daysAfter;
      return d;
    });
  })();

  // offset: if there's a connection request, sequence[0] = invite (no regular step)
  const seqOffset = connReq ? 1 : 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ backgroundColor: C.bg }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0"
        style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-1.5 rounded-lg border"
            style={{ borderColor: C.border, color: C.textBody }}>
            <X size={14} />
          </button>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.textDim }}>Editing template</p>
            <p className="text-sm font-bold" style={{ color: C.textPrimary }}>{name || templateId}</p>
          </div>
        </div>
        <button onClick={handleSave} disabled={saving || loading}
          className="text-sm font-semibold px-4 py-2 rounded-lg inline-flex items-center gap-2 disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${gold}, color-mix(in srgb, var(--brand, #c9a83a) 72%, white))`, color: "#1A1A2E" }}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          Save changes
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto w-full">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 size={20} className="animate-spin" style={{ color: gold }} />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Name + description */}
            <div className="rounded-xl border p-5 space-y-3" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: C.textMuted }}>Name</label>
                <input value={name} onChange={e => setName(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm font-semibold focus:outline-none"
                  style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }} />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: C.textMuted }}>Description</label>
                <input value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="Optional"
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
                  style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }} />
              </div>
            </div>

            {/* Connection request */}
            {connReq !== "" && (
              <StepEditor
                label="LinkedIn invite"
                channel="linkedin"
                day={0}
                isInvite
                body={connReq}
                onBodyChange={setConnReq}
                charLimit={200}
              />
            )}

            {/* Regular steps */}
            {steps.map((s, idx) => {
              const seqIdx = idx + seqOffset;
              const day = cumulativeDays[seqIdx] ?? 0;
              return (
                <StepEditor
                  key={idx}
                  label={channelMeta[s.channel]?.label ?? s.channel}
                  channel={s.channel}
                  day={day}
                  stepNum={s.step}
                  subject={s.subject ?? undefined}
                  body={s.body}
                  onSubjectChange={val => updateStep(idx, "subject", val)}
                  onBodyChange={val => updateStep(idx, "body", val)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StepEditor({ label, channel, day, stepNum, isInvite, subject, body, charLimit,
  onSubjectChange, onBodyChange }: {
  label: string; channel: string; day: number; stepNum?: number; isInvite?: boolean;
  subject?: string; body: string; charLimit?: number;
  onSubjectChange?: (v: string) => void;
  onBodyChange: (v: string) => void;
}) {
  const meta = channelMeta[channel] ?? channelMeta.linkedin;
  const Icon = meta.icon;
  return (
    <div className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border, borderLeft: `3px solid ${meta.color}` }}>
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
          style={{ backgroundColor: `${meta.color}18`, color: meta.color }}>
          {isInvite ? "0" : stepNum}
        </div>
        <Icon size={13} style={{ color: meta.color }} />
        <span className="text-xs font-bold" style={{ color: meta.color }}>{isInvite ? "LinkedIn invite" : label}</span>
        <span className="text-[10px] px-2 py-0.5 rounded" style={{ backgroundColor: C.surface, color: C.textMuted }}>
          Day {day}
        </span>
        {charLimit && (
          <span className="ml-auto text-[10px] tabular-nums" style={{ color: body.length > charLimit ? C.red : C.textDim }}>
            {body.length}/{charLimit}
          </span>
        )}
      </div>

      {subject !== undefined && (
        <div className="mb-2">
          <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: C.textMuted }}>Subject</label>
          <input value={subject} onChange={e => onSubjectChange?.(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none"
            style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }} />
        </div>
      )}

      <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1" style={{ color: C.textMuted }}>Body</label>
      <textarea value={body} onChange={e => onBodyChange(e.target.value)} rows={5}
        className="w-full rounded-lg border px-3 py-2 text-sm leading-relaxed focus:outline-none resize-y"
        style={{
          borderColor: charLimit && body.length > charLimit ? C.red : C.border,
          backgroundColor: C.bg,
          color: C.textPrimary,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }} />
    </div>
  );
}

function IcpPicker({
  icps, onPick, onCancel, title, excludeId,
}: { icps: IcpOption[]; onPick: (id: string) => void; onCancel: () => void; title: string; excludeId?: string | null }) {
  const items = excludeId ? icps.filter(i => i.id !== excludeId) : icps;
  return (
    <div className="absolute right-0 top-full mt-1 z-10 w-64 rounded-lg border shadow-lg overflow-hidden"
      style={{ backgroundColor: C.card, borderColor: C.border }}>
      <div className="px-3 py-2 border-b flex items-center justify-between"
        style={{ borderColor: C.border, backgroundColor: C.bg }}>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: C.textMuted }}>{title}</span>
        <button onClick={onCancel} className="p-0.5" style={{ color: C.textMuted }}>
          <X size={11} />
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-3 py-3 text-xs text-center" style={{ color: C.textMuted }}>No ICPs available.</p>
        ) : items.map(icp => (
          <button key={icp.id} onClick={() => onPick(icp.id)}
            className="w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-black/[0.04]"
            style={{ color: C.textBody }}>
            <span className="truncate">{icp.profile_name}</span>
            <ArrowRight size={10} className="shrink-0 ml-2" style={{ color: C.textMuted }} />
          </button>
        ))}
      </div>
    </div>
  );
}
