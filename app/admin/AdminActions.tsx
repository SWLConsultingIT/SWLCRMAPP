"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

export default function AdminActions({ id, table }: { id: string; table: "icp_profiles" | "campaign_requests" }) {
  const router = useRouter();
  const [acting, setActing] = useState<string | null>(null);
  const [result, setResult] = useState<{ msg: string; ok: boolean } | null>(null);

  async function handleAction(action: "approved" | "rejected") {
    setActing(action);
    setResult(null);

    try {
      if (table === "campaign_requests" && action === "approved") {
        // Campaign approval creates campaigns + messages via dedicated endpoint
        const res = await fetch("/api/campaigns/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: id }),
        });
        const data = await res.json();
        if (res.ok) {
          setResult({ msg: `${data.campaignsCreated} campaign${data.campaignsCreated !== 1 ? "s" : ""} created`, ok: true });
        } else {
          setResult({ msg: data.error ?? "Failed to approve", ok: false });
        }
      } else {
        // Generic status update for ICP (approve/reject) and campaign (reject)
        const res = await fetch("/api/admin/reject", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, table, status: action }),
        });
        const data = await res.json();
        if (res.ok) {
          setResult({ msg: action === "approved" ? "Approved" : "Rejected", ok: true });
        } else {
          setResult({ msg: data.error ?? "Failed", ok: false });
        }
      }
    } catch {
      setResult({ msg: "Network error", ok: false });
    }

    router.refresh();
    setActing(null);
  }

  return (
    <div className="flex items-center gap-2">
      {result && (
        <span className="text-xs font-medium px-2 py-1 rounded-md" style={{
          backgroundColor: result.ok ? C.greenLight : C.redLight,
          color: result.ok ? C.green : C.red,
        }}>
          {result.msg}
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
