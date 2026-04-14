"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { C } from "@/lib/design";
import { Trash2, Loader2, AlertTriangle } from "lucide-react";

export default function DeleteLeadButton({ leadId, leadName }: { leadId: string; leadName: string }) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/leads");
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error ?? "Failed to delete lead");
        setDeleting(false);
      }
    } catch {
      setError("Network error");
      setDeleting(false);
    }
  }

  return (
    <>
      <button onClick={() => setShowConfirm(true)}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
        style={{ backgroundColor: C.redLight, color: C.red }}>
        <Trash2 size={12} /> Delete Lead
      </button>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}>
          <div className="rounded-xl border p-6 w-full max-w-sm shadow-xl" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                style={{ backgroundColor: C.redLight }}>
                <AlertTriangle size={20} style={{ color: C.red }} />
              </div>
              <div>
                <h3 className="text-sm font-bold" style={{ color: C.textPrimary }}>Delete Lead</h3>
                <p className="text-xs mt-0.5" style={{ color: C.textMuted }}>This action cannot be undone.</p>
              </div>
            </div>

            <p className="text-sm mb-5" style={{ color: C.textBody }}>
              Are you sure you want to delete <strong>{leadName}</strong>? All campaigns, messages, and replies associated with this lead will be permanently removed.
            </p>

            {error && (
              <div className="rounded-lg px-3 py-2 mb-4 text-xs font-medium"
                style={{ backgroundColor: C.redLight, color: C.red }}>
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setShowConfirm(false)} disabled={deleting}
                className="rounded-lg px-4 py-2 text-sm font-medium"
                style={{ backgroundColor: "#F3F4F6", color: C.textBody }}>
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: C.red }}>
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {deleting ? "Deleting..." : "Yes, Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
