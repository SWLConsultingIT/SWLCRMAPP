"use client";

import { useState } from "react";
import { C } from "@/lib/design";
import { Copy, Check } from "lucide-react";

export default function CopyableId({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-lg border px-4 py-3 flex items-center justify-between cursor-pointer hover:opacity-80 transition-opacity"
      style={{ borderColor: C.border, backgroundColor: C.bg }}
      onClick={handleCopy}>
      <div>
        <p className="text-xs font-medium" style={{ color: C.textMuted }}>{label}</p>
        <p className="text-xs font-mono" style={{ color: C.textPrimary }}>{value}</p>
      </div>
      {copied ? (
        <Check size={14} style={{ color: C.green }} />
      ) : (
        <Copy size={14} style={{ color: C.textDim }} />
      )}
    </div>
  );
}
