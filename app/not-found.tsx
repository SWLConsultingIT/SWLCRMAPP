import Link from "next/link";
import { C } from "@/lib/design";
import { SearchX } from "lucide-react";

const gold = "#C9A83A";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6"
        style={{ backgroundColor: "rgba(201,168,58,0.1)" }}>
        <SearchX size={28} style={{ color: gold }} />
      </div>
      <h1 className="text-5xl font-black mb-2" style={{ color: C.textPrimary }}>404</h1>
      <p className="text-lg font-semibold mb-1" style={{ color: C.textBody }}>Page not found</p>
      <p className="text-sm mb-8" style={{ color: C.textMuted }}>The URL you are trying to access does not exist.</p>
      <Link href="/"
        className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-all"
        style={{ backgroundColor: "rgba(201,168,58,0.1)", color: gold, border: `1px solid rgba(201,168,58,0.3)` }}>
        Back to Dashboard
      </Link>
    </div>
  );
}
