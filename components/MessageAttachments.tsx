"use client";

import { useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { Paperclip, X, FileText, Image as ImageIcon, Loader2 } from "lucide-react";

export type Attachment = {
  name: string;
  url: string;
  type: string; // "image" | "pdf" | "file"
  size: number;
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getFileType(file: File): "image" | "pdf" | "file" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf") return "pdf";
  return "file";
}

export default function MessageAttachments({
  attachments,
  onChange,
  stepNumber,
}: {
  attachments: Attachment[];
  onChange: (attachments: Attachment[]) => void;
  stepNumber: number;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    const newAttachments = [...attachments];

    for (const file of Array.from(files)) {
      // Max 10MB
      if (file.size > 10 * 1024 * 1024) continue;

      const ext = file.name.split(".").pop() ?? "bin";
      const path = `campaign-attachments/${Date.now()}-step${stepNumber}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error } = await supabase.storage
        .from("campaign-files")
        .upload(path, file, { upsert: false });

      if (!error) {
        const { data: urlData } = supabase.storage
          .from("campaign-files")
          .getPublicUrl(path);

        newAttachments.push({
          name: file.name,
          url: urlData.publicUrl,
          type: getFileType(file),
          size: file.size,
        });
      }
    }

    onChange(newAttachments);
    setUploading(false);

    // Reset input
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeAttachment(idx: number) {
    onChange(attachments.filter((_, i) => i !== idx));
  }

  return (
    <div>
      {/* Existing attachments */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map((att, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border px-3 py-2"
              style={{ borderColor: C.border, backgroundColor: C.bg }}>
              {att.type === "image" ? (
                <ImageIcon size={14} style={{ color: C.blue }} />
              ) : att.type === "pdf" ? (
                <FileText size={14} style={{ color: C.red }} />
              ) : (
                <Paperclip size={14} style={{ color: C.textMuted }} />
              )}
              <div className="min-w-0">
                <p className="text-xs font-medium truncate max-w-40" style={{ color: C.textPrimary }}>{att.name}</p>
                <p className="text-xs" style={{ color: C.textDim }}>{formatSize(att.size)}</p>
              </div>
              {att.type === "image" && (
                <img src={att.url} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
              )}
              <button onClick={() => removeAttachment(i)} className="shrink-0 opacity-40 hover:opacity-100 transition-opacity"
                style={{ color: C.red }}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upload button */}
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.pdf"
          multiple
          onChange={handleUpload}
          className="hidden"
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50 border"
          style={{ borderColor: C.border, color: C.textMuted, backgroundColor: C.bg }}
        >
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}
          {uploading ? "Uploading…" : "Attach file"}
        </button>
        <span className="text-xs" style={{ color: C.textDim }}>PDF or images, max 10MB</span>
      </div>
    </div>
  );
}
