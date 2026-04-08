import Link from "next/link";
import { C } from "@/lib/design";
import { UserX } from "lucide-react";

export default function LeadNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6"
        style={{ backgroundColor: C.redGlow, boxShadow: `0 0 32px ${C.redGlow}` }}>
        <UserX size={28} style={{ color: C.red }} />
      </div>
      <h1 className="text-2xl font-bold mb-1" style={{ color: C.textPrimary }}>Lead no encontrado</h1>
      <p className="text-sm mb-8" style={{ color: C.textMuted }}>Este lead no existe o fue eliminado.</p>
      <Link href="/leads"
        className="px-5 py-2.5 rounded-lg text-sm font-semibold"
        style={{ backgroundColor: C.goldGlow, color: C.gold, border: `1px solid ${C.gold}30` }}>
        ← Volver a Leads
      </Link>
    </div>
  );
}
