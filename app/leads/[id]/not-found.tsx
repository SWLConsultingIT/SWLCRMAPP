import Link from "next/link";
import { C } from "@/lib/design";
import { UserX } from "lucide-react";

export default function LeadNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6"
        style={{ backgroundColor: C.redLight }}>
        <UserX size={28} style={{ color: C.red }} />
      </div>
      <h1 className="text-2xl font-bold mb-1" style={{ color: C.textPrimary }}>Lead not found</h1>
      <p className="text-sm mb-8" style={{ color: C.textMuted }}>This lead does not exist or was deleted.</p>
      <Link href="/leads"
        className="px-5 py-2.5 rounded-lg text-sm font-semibold"
        style={{ backgroundColor: C.accentLight, color: C.accent, border: `1px solid ${C.accent}30` }}>
        Back to Leads
      </Link>
    </div>
  );
}
