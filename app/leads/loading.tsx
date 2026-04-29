import { C } from "@/lib/design";
import { S } from "@/components/PageLoadingSkeleton";

// Leads page is grouped by campaigns (collapsible accordions). The old
// TableSkeleton looked nothing like the actual UI and made the swap-in feel
// abrupt. This skeleton mirrors the real layout: hero header → filters →
// stacked campaign accordions, each with a card grid placeholder.
export default function LeadsLoading() {
  return (
    <div className="p-6 w-full max-w-7xl mx-auto fade-in">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <S className="w-24 h-3 mb-2" />
          <S className="w-48 h-7" />
        </div>
        <div className="flex items-center gap-2">
          <S className="w-32 h-9 rounded-lg" />
          <S className="w-28 h-9 rounded-lg" />
        </div>
      </div>

      <div className="flex gap-2 mb-5">
        <S className="flex-1 h-9 max-w-md" />
        <S className="w-28 h-9" />
        <S className="w-28 h-9" />
        <S className="w-28 h-9" />
      </div>

      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, c) => (
          <div key={c} className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, animationDelay: `${c * 0.06}s` }}>
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: C.border, backgroundColor: C.bg }}>
              <div className="flex items-center gap-3">
                <S className="w-5 h-5 rounded" />
                <S className="w-48 h-4" />
                <S className="w-16 h-5 rounded-full" />
              </div>
              <div className="flex items-center gap-2">
                <S className="w-20 h-3" />
                <S className="w-24 h-3" />
              </div>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-xl border p-4" style={{ borderColor: C.border, animationDelay: `${(c * 3 + i) * 0.04}s` }}>
                  <div className="flex items-start gap-3 mb-3">
                    <S className="w-10 h-10 rounded-full shrink-0" />
                    <div className="flex-1 min-w-0">
                      <S className="w-3/5 h-3 mb-1.5" />
                      <S className="w-2/3 h-3" />
                    </div>
                    <S className="w-12 h-5 rounded-md" />
                  </div>
                  <div className="rounded-lg px-3 py-2.5 border" style={{ backgroundColor: C.bg, borderColor: C.border }}>
                    <S className="w-full h-3 mb-2" />
                    <S className="w-4/5 h-3 mb-3" />
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full" style={{ backgroundColor: C.border }} />
                      <S className="w-12 h-2" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
