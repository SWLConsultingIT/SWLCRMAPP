"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/design";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

export default function AdminActions({ id, table }: { id: string; table: "icp_profiles" | "campaign_requests" }) {
  const router = useRouter();
  const [acting, setActing] = useState<string | null>(null);

  async function handleAction(action: "approved" | "rejected") {
    setActing(action);
    const statusField = table === "campaign_requests" ? "status" : "status";
    await supabase.from(table).update({ [statusField]: action }).eq("id", id);
    router.refresh();
    setActing(null);
  }

  return (
    <div className="flex items-center gap-2">
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
