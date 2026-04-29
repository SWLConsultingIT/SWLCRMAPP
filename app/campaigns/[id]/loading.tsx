import { C } from "@/lib/design";
import { S } from "@/components/PageLoadingSkeleton";

export default function CampaignDetailLoading() {
  return (
    <div className="p-6 w-full max-w-7xl mx-auto fade-in">
      {/* Header: title + status pill + action buttons */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <S className="w-72 h-7" />
            <S className="w-20 h-5 rounded-full" />
          </div>
          <S className="w-48 h-3" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <S className="w-20 h-8 rounded-lg" />
          <S className="w-20 h-8 rounded-lg" />
          <S className="w-20 h-8 rounded-lg" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b" style={{ borderColor: C.border }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <S key={i} className="w-24 h-8" style={{ animationDelay: `${i * 0.05}s` }} />
        ))}
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border, animationDelay: `${i * 0.05}s` }}>
            <S className="w-20 h-3 mb-3" />
            <S className="w-14 h-6 mb-1" />
            <S className="w-24 h-3" />
          </div>
        ))}
      </div>

      {/* Sequence steps row */}
      <div className="rounded-xl border p-5 mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <S className="w-32 h-4 mb-4" />
        <div className="flex items-center gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex-1 flex items-center gap-2">
              <S className="w-9 h-9 rounded-full shrink-0" style={{ animationDelay: `${i * 0.05}s` }} />
              <div className="flex-1 min-w-0">
                <S className="w-full h-3 mb-1" />
                <S className="w-2/3 h-3" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Leads table */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="px-4 py-3 grid gap-4 border-b" style={{ borderColor: C.border, backgroundColor: C.bg, gridTemplateColumns: "2fr 1fr 1fr 1fr 0.5fr" }}>
          <S className="h-3" />
          <S className="h-3" />
          <S className="h-3" />
          <S className="h-3" />
          <S className="h-3" />
        </div>
        {Array.from({ length: 8 }).map((_, r) => (
          <div key={r} className="px-4 py-3 grid gap-4 border-b last:border-0 items-center" style={{ borderColor: C.border, gridTemplateColumns: "2fr 1fr 1fr 1fr 0.5fr" }}>
            <div className="flex items-center gap-2">
              <S className="w-7 h-7 rounded-full shrink-0" />
              <S className="h-3 flex-1" style={{ animationDelay: `${r * 0.04}s` }} />
            </div>
            <S className="h-5 w-16 rounded-md" />
            <S className="h-3" />
            <S className="h-3 w-3/4" />
            <S className="h-7 w-7 rounded-md ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
