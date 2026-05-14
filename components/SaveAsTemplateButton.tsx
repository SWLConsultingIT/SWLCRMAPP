"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, X, CheckCircle } from "lucide-react";
import { C } from "@/lib/design";

/**
 * Tiny modal-based "Save as Template" action. Lives next to the campaign
 * edit page's primary Save Changes button — secondary action, low friction.
 * Captures only name + optional tags; the server-side POST extracts the
 * sequence + messages + attachments from the campaign automatically. Per
 * the Templates UX brief (Fran 2026-05-14): name should be the only
 * required field, no enterprise-style form.
 */
export default function SaveAsTemplateButton({ campaignId, defaultName }: {
  campaignId: string;
  defaultName?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName ?? "");
  const [tagsInput, setTagsInput] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function resetAndClose() {
    setOpen(false);
    setTimeout(() => {
      setName(defaultName ?? "");
      setTagsInput("");
      setDescription("");
      setSavedId(null);
      setErr(null);
    }, 200);
  }

  async function save() {
    if (saving || !name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const tags = tagsInput
        .split(",")
        .map(t => t.trim())
        .filter(Boolean)
        .slice(0, 10);
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          name: name.trim(),
          description: description.trim() || undefined,
          tags,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(body.error ?? `Failed (${res.status})`);
        setSaving(false);
        return;
      }
      setSavedId(body.template?.id ?? "saved");
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-[opacity,transform,box-shadow,background-color,border-color] cursor-pointer hover:shadow-sm"
        style={{ backgroundColor: C.surface, color: C.textBody, border: `1px solid ${C.border}` }}
        title="Save this campaign's sequence + messages as a reusable template"
      >
        <FileText size={14} />
        Save as Template
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
          onClick={resetAndClose}
        >
          <div
            className="w-full max-w-md rounded-2xl border shadow-2xl"
            style={{ backgroundColor: C.card, borderColor: C.border }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: C.border }}>
              <div className="flex items-center gap-2">
                <FileText size={16} style={{ color: "#7C3AED" }} />
                <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>
                  {savedId ? "Template saved" : "Save as Template"}
                </h3>
              </div>
              <button onClick={resetAndClose} className="p-1 rounded hover:bg-gray-100" style={{ color: C.textMuted }}>
                <X size={14} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              {savedId ? (
                <div className="text-center py-4">
                  <CheckCircle size={36} className="mx-auto mb-2" style={{ color: C.green }} />
                  <p className="text-sm font-semibold" style={{ color: C.textPrimary }}>
                    Saved to your library
                  </p>
                  <p className="text-xs mt-1" style={{ color: C.textMuted }}>
                    Find it under <strong>Campaigns → Templates</strong>. Reuse it on any future campaign.
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.textDim }}>
                      Template name <span style={{ color: C.red }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., Healthcare Asset Finance — CEO Outreach"
                      className="w-full mt-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
                      style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
                      autoFocus
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.textDim }}>
                      Description <span style={{ color: C.textMuted }}>(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="What's this sequence good for?"
                      className="w-full mt-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
                      style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.textDim }}>
                      Tags <span style={{ color: C.textMuted }}>(comma-separated, optional)</span>
                    </label>
                    <input
                      type="text"
                      value={tagsInput}
                      onChange={(e) => setTagsInput(e.target.value)}
                      placeholder="healthcare, asset-finance, c-level"
                      className="w-full mt-1 rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
                      style={{ borderColor: C.border, backgroundColor: C.bg, color: C.textPrimary }}
                    />
                  </div>

                  {err && (
                    <p className="text-xs" style={{ color: C.red }}>{err}</p>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t flex items-center justify-end gap-2" style={{ borderColor: C.border, backgroundColor: C.bg }}>
              {savedId ? (
                <>
                  <button
                    onClick={() => { router.push("/campaigns"); resetAndClose(); }}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md"
                    style={{ backgroundColor: C.surface, color: C.textBody, border: `1px solid ${C.border}` }}
                  >
                    View Templates
                  </button>
                  <button
                    onClick={resetAndClose}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md"
                    style={{ backgroundColor: "#7C3AED", color: "#fff" }}
                  >
                    Done
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={resetAndClose}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md"
                    style={{ color: C.textMuted }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={save}
                    disabled={saving || !name.trim()}
                    className="text-xs font-semibold px-4 py-1.5 rounded-md inline-flex items-center gap-1.5 disabled:opacity-50"
                    style={{ backgroundColor: "#7C3AED", color: "#fff" }}
                  >
                    {saving ? <Loader2 size={11} className="animate-spin" /> : <FileText size={11} />}
                    {saving ? "Saving…" : "Save Template"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
