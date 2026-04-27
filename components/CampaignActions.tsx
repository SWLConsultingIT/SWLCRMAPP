"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { Pause, Play, Loader } from "lucide-react";

export default function CampaignActions({ campaignId, status }: { campaignId: string; status: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState(status);

  if (current === "completed" || current === "failed") return null;

  async function toggle() {
    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/toggle-pause`, { method: "POST" });
      if (res.ok) {
        const { newStatus } = await res.json();
        setCurrent(newStatus);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  const isPaused = current === "paused";

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-[opacity,transform,box-shadow,background-color,border-color] disabled:opacity-50"
      style={{
        backgroundColor: isPaused ? C.greenGlow : C.yellowGlow,
        color: isPaused ? C.green : C.yellow,
        border: `1px solid ${isPaused ? C.green : C.yellow}20`,
      }}
    >
      {loading ? <Loader size={10} className="animate-spin" /> : isPaused ? <Play size={10} /> : <Pause size={10} />}
      {isPaused ? "Resume" : "Pause"}
    </button>
  );
}
