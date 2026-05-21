"use client";

import { useRef, useState } from "react";
import { Paperclip, X, FileText, Loader2, AlertTriangle } from "lucide-react";
import { C } from "@/lib/design";

export type StepAttachment = {
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
};

type Props = {
  channel: string; // step channel (linkedin / email / whatsapp / call) — used to gate
  attachments: StepAttachment[];
  onChange: (next: StepAttachment[]) => void;
};

const MAX_BYTES = 50 * 1024 * 1024; // mirrors API + bucket cap

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

/**
 * Per-step attachment input. Uploads directly to /api/campaigns/attachments/upload
 * and pushes the returned descriptor onto the step's attachments array. The
 * caller persists the array into sequence_steps[i].attachments when saving.
 *
 * `channel` is passed so we can warn (but not block) when the user attaches a
 * file to a LinkedIn connection request — LinkedIn doesn't allow files on
 * invites, so the dispatcher will skip the file on step 0 of linkedin.
 */
export default function StepAttachments({ channel, attachments, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cannotAttach = channel === "call"; // calls don't carry files
  const inviteWarning = channel === "linkedin" && attachments.length > 0;

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    setUploading(true);
    const uploaded: StepAttachment[] = [];
    try {
      for (const f of Array.from(fileList)) {
        if (f.size > MAX_BYTES) {
          throw new Error(`${f.name} exceeds 50MB limit`);
        }
        const fd = new FormData();
        fd.append("file", f);
        const res = await fetch("/api/campaigns/attachments/upload", { method: "POST", body: fd });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? `Upload failed for ${f.name}`);
        uploaded.push({
          path: body.path,
          name: body.name,
          mimeType: body.mimeType,
          sizeBytes: body.sizeBytes,
        });
      }
      onChange([...attachments, ...uploaded]);
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function removeAt(idx: number) {
    const toRemove = attachments[idx];
    onChange(attachments.filter((_, i) => i !== idx));
    // Best-effort delete from storage. If the network call fails the file
    // becomes orphaned — acceptable trade-off vs. blocking the UI.
    try {
      await fetch(`/api/campaigns/attachments/upload?path=${encodeURIComponent(toRemove.path)}`, { method: "DELETE" });
    } catch { /* ignore */ }
  }

  if (cannotAttach) return null;

  return (
    <div className="mt-1">
      {attachments.map((a, i) => (
        <div key={a.path}
          className="inline-flex items-center gap-2 mr-2 mb-1 rounded-md border px-2 py-1 text-[11px]"
          style={{ borderColor: C.border, backgroundColor: C.surface, color: C.textBody }}>
          <FileText size={11} style={{ color: C.textMuted }} />
          <span className="font-medium" style={{ color: C.textPrimary }}>{a.name}</span>
          <span style={{ color: C.textDim }}>· {fmtSize(a.sizeBytes)}</span>
          <button type="button" onClick={() => removeAt(i)}
            className="ml-1 opacity-50 hover:opacity-100 transition-opacity"
            aria-label={`Remove ${a.name}`}>
            <X size={11} />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium border border-dashed transition-opacity hover:opacity-80 disabled:opacity-50"
        style={{ borderColor: C.border, color: C.textMuted, backgroundColor: "transparent" }}
      >
        {uploading ? <Loader2 size={11} className="animate-spin" /> : <Paperclip size={11} />}
        {uploading ? "Uploading…" : attachments.length === 0 ? "Attach file" : "Add another"}
      </button>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
        multiple
        onChange={(e) => handleFiles(e.target.files)}
      />

      {error && (
        <p className="text-[10px] mt-1 flex items-center gap-1" style={{ color: "#B91C1C" }}>
          <AlertTriangle size={10} /> {error}
        </p>
      )}

      {inviteWarning && (
        <p className="text-[10px] mt-1" style={{ color: C.textMuted }}>
          Files on a LinkedIn step are only sent on follow-up DMs — connection requests can&apos;t carry attachments.
        </p>
      )}
    </div>
  );
}
