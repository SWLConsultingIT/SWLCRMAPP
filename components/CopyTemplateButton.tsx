"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

export default function CopyTemplateButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handle() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <button onClick={handle}
      className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded transition-opacity hover:opacity-80"
      style={{ backgroundColor: "#7C3AED", color: "#fff" }}>
      {copied ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy</>}
    </button>
  );
}
