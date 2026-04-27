import { C } from "@/lib/design";

// Skeleton building blocks. The `.shimmer` class is defined in globals.css and
// uses a horizontal gradient sweep (1.4s, ease) — much smoother than Tailwind's
// fade-pulse and matches what apps like Linear / Vercel ship.

export function S({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`shimmer ${className ?? ""}`} style={style} />;
}

export default function PageLoadingSkeleton() {
  return (
    <div className="p-8 w-full max-w-7xl mx-auto">
      <div className="mb-6">
        <S className="w-24 h-3 mb-2" />
        <S className="w-48 h-7" />
      </div>
      <div className="h-px mb-6" style={{ backgroundColor: C.border }} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <S className="w-3/5 h-4 mb-3" />
            <S className="w-full h-3 mb-2" />
            <S className="w-4/5 h-3 mb-4" />
            <div className="flex gap-2">
              <S className="w-16 h-6 rounded-full" />
              <S className="w-20 h-6 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Table skeleton (used by /leads, /opportunities) ───────────────────────────
export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="p-8 w-full max-w-7xl mx-auto">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <S className="w-24 h-3 mb-2" />
          <S className="w-48 h-7" />
        </div>
        <S className="w-32 h-9 rounded-lg" />
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 mb-4">
        <S className="flex-1 h-9 max-w-md" />
        <S className="w-24 h-9" />
        <S className="w-24 h-9" />
        <S className="w-24 h-9" />
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="px-4 py-3 grid gap-4 border-b" style={{ borderColor: C.border, backgroundColor: C.bg, gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: cols }).map((_, i) => <S key={i} className="h-3" />)}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="px-4 py-3 grid gap-4 border-b last:border-0" style={{ borderColor: C.border, gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {Array.from({ length: cols }).map((_, c) => (
              <div key={c} className="flex items-center gap-2">
                {c === 0 && <S className="w-7 h-7 rounded-full shrink-0" />}
                <S className="h-3 flex-1" style={{ animationDelay: `${(r * cols + c) * 0.04}s` }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Stats + lists skeleton (used by /queue, /admin) ──────────────────────────
export function StatsListSkeleton() {
  return (
    <div className="p-8 w-full max-w-7xl mx-auto">
      <div className="mb-6">
        <S className="w-24 h-3 mb-2" />
        <S className="w-48 h-7" />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <S className="w-24 h-3 mb-3" />
            <S className="w-16 h-7" />
          </div>
        ))}
      </div>

      {/* Two-column lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Array.from({ length: 2 }).map((_, col) => (
          <div key={col} className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <S className="w-32 h-4 mb-4" />
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <S className="w-9 h-9 rounded-full shrink-0" />
                  <div className="flex-1">
                    <S className="w-3/5 h-3 mb-1.5" style={{ animationDelay: `${i * 0.05}s` }} />
                    <S className="w-2/5 h-3" style={{ animationDelay: `${i * 0.05 + 0.1}s` }} />
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

// ─── Card grid skeleton (used by /templates, /icp, /opportunities cards mode) ──
export function CardGridSkeleton({ count = 6, withFilters = true }: { count?: number; withFilters?: boolean }) {
  return (
    <div className="p-8 w-full max-w-7xl mx-auto">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <S className="w-24 h-3 mb-2" />
          <S className="w-56 h-7" />
        </div>
        <S className="w-36 h-9 rounded-lg" />
      </div>

      {withFilters && (
        <div className="flex gap-3 mb-5">
          <S className="w-32 h-8" />
          <S className="w-32 h-8" />
          <S className="w-32 h-8" />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border, animationDelay: `${i * 0.05}s` }}>
            <div className="flex items-center justify-between mb-3">
              <S className="w-32 h-3" style={{ animationDelay: `${i * 0.05}s` }} />
              <S className="w-14 h-5 rounded-full" />
            </div>
            <S className="w-3/4 h-4 mb-2" />
            <S className="w-full h-3 mb-1.5" />
            <S className="w-full h-3 mb-1.5" />
            <S className="w-4/5 h-3 mb-4" />
            <div className="flex gap-1.5 pt-3 border-t" style={{ borderColor: C.border }}>
              <S className="w-16 h-5 rounded-full" />
              <S className="w-20 h-5 rounded-full" />
              <S className="w-14 h-5 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
