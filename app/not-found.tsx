import Link from "next/link";
import { C } from "@/lib/design";
import { SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6"
        style={{ backgroundColor: C.goldGlow, boxShadow: `0 0 32px ${C.goldGlow}` }}>
        <SearchX size={28} style={{ color: C.gold }} />
      </div>
      <h1 className="text-5xl font-black mb-2" style={{ color: C.textPrimary }}>404</h1>
      <p className="text-lg font-semibold mb-1" style={{ color: C.textBody }}>Página no encontrada</p>
      <p className="text-sm mb-8" style={{ color: C.textMuted }}>La URL que intentás acceder no existe.</p>
      <Link href="/"
        className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-all"
        style={{ backgroundColor: C.goldGlow, color: C.gold, border: `1px solid ${C.gold}30` }}>
        Volver al Dashboard
      </Link>
    </div>
  );
}
