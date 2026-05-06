"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { C } from "@/lib/design";
import { Eye, EyeOff } from "lucide-react";

// Toggle ?noise=1 in the URL so failed/skipped sections include rows older
// than the noise cutoff. Server component reads the flag from searchParams.
export default function HideNoiseToggle({ showing }: { showing: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = new URLSearchParams(params.toString());
    if (showing) next.delete("noise");
    else next.set("noise", "1");
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50"
      style={{ backgroundColor: C.surface, color: C.textBody, border: `1px solid ${C.border}` }}
    >
      {showing ? <EyeOff size={9} /> : <Eye size={9} />}
      {showing ? "Hide old" : "Show all"}
    </button>
  );
}
