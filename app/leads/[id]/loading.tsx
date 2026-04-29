import { C } from "@/lib/design";
import { S } from "@/components/PageLoadingSkeleton";

export default function LeadDetailLoading() {
  return (
    <div className="p-6 w-full max-w-7xl mx-auto fade-in">
      {/* Header card with score ring + identity */}
      <div className="rounded-2xl border mb-6 relative overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: "linear-gradient(90deg, transparent 0%, var(--brand-dark, #b79832) 50%, transparent 100%)", opacity: 0.5 }} />
        <div className="p-6 flex items-start justify-between gap-6">
          <div className="flex items-start gap-4 flex-1">
            <S className="w-16 h-16 rounded-2xl shrink-0" />
            <div className="flex-1 min-w-0">
              <S className="w-64 h-5 mb-2" />
              <S className="w-40 h-3 mb-2" />
              <S className="w-32 h-3 mb-3" />
              <div className="flex items-center gap-2 flex-wrap">
                <S className="w-20 h-6 rounded-full" />
                <S className="w-24 h-6 rounded-full" />
                <S className="w-16 h-6 rounded-full" />
              </div>
            </div>
          </div>
          <div className="flex items-start gap-6 shrink-0">
            <div className="flex items-center gap-1.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <S key={i} className="w-8 h-8 rounded-full" style={{ animationDelay: `${i * 0.04}s` }} />
              ))}
            </div>
            <S className="w-14 h-14 rounded-full" />
          </div>
        </div>
      </div>

      {/* Sequence progress card */}
      <div className="rounded-2xl border p-6 mb-6" style={{ backgroundColor: C.card, borderColor: C.border, boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <S className="w-32 h-3 mb-2" />
            <S className="w-48 h-3" />
          </div>
          <S className="w-20 h-4" />
        </div>
        <div className="flex items-center justify-between gap-2 px-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2 flex-1">
              <S className="w-10 h-10 rounded-full" style={{ animationDelay: `${i * 0.05}s` }} />
              <S className="w-12 h-2" />
            </div>
          ))}
        </div>
      </div>

      {/* Two-column body — summary + activity timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border, animationDelay: `${i * 0.06}s` }}>
              <div className="flex items-center gap-3 mb-3">
                <S className="w-9 h-9 rounded-full" />
                <div className="flex-1">
                  <S className="w-32 h-3 mb-1.5" />
                  <S className="w-20 h-3" />
                </div>
              </div>
              <S className="w-full h-3 mb-1.5" />
              <S className="w-4/5 h-3" />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <S className="w-28 h-4 mb-4" />
            <S className="w-full h-3 mb-2" />
            <S className="w-full h-3 mb-2" />
            <S className="w-3/4 h-3" />
          </div>
          <div className="rounded-2xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <S className="w-24 h-4 mb-4" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 py-2">
                <S className="w-2 h-2 rounded-full" />
                <S className="flex-1 h-3" style={{ animationDelay: `${i * 0.05}s` }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
