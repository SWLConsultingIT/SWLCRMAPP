"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

export default function AdminActions({ id, table }: { id: string; table: "icp_profiles" | "campaign_requests" }) {
  const router = useRouter();
  const [acting, setActing] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function handleAction(action: "approved" | "rejected") {
    setActing(action);
    setResult(null);

    if (table === "campaign_requests" && action === "approved") {
      // Call the approve API to create campaigns + messages
      try {
        const res = await fetch("/api/campaigns/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: id }),
        });
        const data = await res.json();
        if (res.ok) {
          setResult(`${data.campaignsCreated} campaign${data.campaignsCreated !== 1 ? "s" : ""} created`);
        } else {
          setResult(data.error ?? "Failed to approve");
        }
      } catch {
        setResult("Network error");
      }
    } else {
      // Simple status update (ICP profiles or campaign rejection)
      await supabase.from(table).update({ status: action }).eq("id", id);
    }

    router.refresh();
    setActing(null);
  }

  return (
    <div className="flex items-center gap-2">
      {result && (
        <span className="text-xs font-medium px-2 py-1 rounded-md" style={{ backgroundColor: C.greenLight, color: C.green }}>
          {result}
        </span>
      )}
      <button onClick={() => handleAction("approved")} disabled={!!acting}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-50"
        style={{ backgroundColor: C.greenLight, color: C.green }}>
        {acting === "approved" ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
        Approve
      </button>
      <button onClick={() => handleAction("rejected")} disabled={!!acting}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity disabled:opacity-50"
        style={{ backgroundColor: C.redLight, color: C.red }}>
        {acting === "rejected" ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
        Reject
      </button>
    </div>
  );
}
