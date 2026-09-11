import Link from "next/link";
import { getT } from "@/lib/i18n-server";
import { C } from "@/lib/design";
import { SearchX } from "lucide-react";

const gold = "var(--brand, #c9a83a)";

export default async function NotFound() {
  const t = await getT();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6"
        style={{ backgroundColor: "color-mix(in srgb, var(--brand, #c9a83a) 10%, transparent)" }}>
        <SearchX size={28} style={{ color: gold }} />
      </div>
      <h1 className="text-5xl font-black mb-2" style={{ color: C.textPrimary }}>404</h1>
      <p className="text-lg font-semibold mb-1" style={{ color: C.textBody }}>{t("nf.pageTitle")}</p>
      <p className="text-sm mb-8" style={{ color: C.textMuted }}>{t("nf.pageBody")}</p>
      <Link href="/"
        className="px-5 py-2.5 rounded-lg text-sm font-semibold transition-[opacity,transform,box-shadow,background-color,border-color]"
        style={{ backgroundColor: "color-mix(in srgb, var(--brand, #c9a83a) 10%, transparent)", color: gold, border: `1px solid color-mix(in srgb, var(--brand, #c9a83a) 30%, transparent)` }}>
        {t("nf.backToDashboard")}
      </Link>
    </div>
  );
}
