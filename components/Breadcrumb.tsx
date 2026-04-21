import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { C } from "@/lib/design";

type Crumb = { label: string; href?: string };

export default function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <div className="flex items-center gap-1.5 text-xs mb-5 flex-wrap" style={{ color: C.textMuted }}>
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={11} style={{ color: C.textDim }} />}
            {c.href && !isLast ? (
              <Link href={c.href} className="hover:underline transition-colors" style={{ color: C.textMuted }}>
                {c.label}
              </Link>
            ) : (
              <span style={{ color: isLast ? C.textBody : C.textMuted }}>{c.label}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}
