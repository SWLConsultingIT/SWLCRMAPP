"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { User, Sparkles, Check, Loader2 } from "lucide-react";
import { C } from "@/lib/design";

type Mode = "manual" | "auto";

export default function CallClassificationToggle({ initialValue }: { initialValue: Mode }) {
  const router = useRouter();
  const [value, setValue] = useState<Mode>(initialValue);
  const [saving, setSaving] = useState<Mode | null>(null);
  const [savedAt, setSavedAt] = useState<Mode | null>(null);

  async function save(next: Mode) {
    if (next === value) return;
    setSaving(next);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_classification_mode: next }),
      });
      if (res.ok) {
        setValue(next);
        setSavedAt(next);
        setTimeout(() => setSavedAt(null), 2000);
        router.refresh();
      }
    } finally {
      setSaving(null);
    }
  }

  const options: { id: Mode; title: string; description: string; icon: typeof User; accent: string }[] = [
    {
      id: "manual",
      title: "Manual",
      description: "Salesperson picks the outcome after each call.",
      icon: User,
      accent: "#0EA5E9",
    },
    {
      id: "auto",
      title: "Automatic (AI)",
      description: "AI reads the call transcript and suggests an outcome. Requires Aircall transcription.",
      icon: Sparkles,
      accent: "var(--brand, #c9a83a)",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3">
      {options.map(opt => {
        const selected = value === opt.id;
        const busy = saving === opt.id;
        const justSaved = savedAt === opt.id;
        const Icon = opt.icon;

        return (
          <button
            key={opt.id}
            onClick={() => save(opt.id)}
            disabled={saving !== null}
            className="text-left rounded-xl p-4 border-2 transition-all hover:scale-[1.01] disabled:opacity-60 disabled:hover:scale-100"
            style={{
              backgroundColor: selected ? `${opt.accent}0D` : C.bg,
              borderColor: selected ? opt.accent : C.border,
              cursor: saving ? "progress" : "pointer",
            }}
          >
            <div className="flex items-start gap-3 mb-2">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: selected ? `${opt.accent}20` : C.card,
                  border: `1px solid ${selected ? opt.accent + "40" : C.border}`,
                }}
              >
                <Icon size={15} style={{ color: selected ? opt.accent : C.textDim }} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold" style={{ color: selected ? opt.accent : C.textPrimary }}>
                    {opt.title}
                  </h4>
                  {selected && !busy && !justSaved && (
                    <span
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                      style={{ backgroundColor: `${opt.accent}20`, color: opt.accent }}
                    >
                      Active
                    </span>
                  )}
                  {busy && <Loader2 size={12} className="animate-spin" style={{ color: opt.accent }} />}
                  {justSaved && (
                    <span className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                      style={{ backgroundColor: "#DCFCE7", color: "#16A34A" }}>
                      <Check size={10} /> Saved
                    </span>
                  )}
                </div>
              </div>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: C.textMuted }}>
              {opt.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}
