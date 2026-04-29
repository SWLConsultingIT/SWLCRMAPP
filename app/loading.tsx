import { C } from "@/lib/design";

function Shimmer({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`rounded-lg animate-pulse ${className}`} style={{ backgroundColor: C.border, ...style }} />;
}

export default function DashboardLoading() {
  return (
    <div className="p-8 w-full">
      <div className="mb-6">
        <Shimmer className="w-24 h-3 mb-2" />
        <Shimmer className="w-40 h-7" />
      </div>
      <div className="h-px mb-8" style={{ backgroundColor: C.border }} />
      <div className="grid grid-cols-4 gap-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <Shimmer className="w-24 h-3 mb-4" />
            <Shimmer className="w-16 h-8" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 rounded-xl border p-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <Shimmer className="w-40 h-4 mb-5" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Shimmer key={i} className="w-full h-12" />)}
          </div>
        </div>
        <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <Shimmer className="w-24 h-4 mb-4" />
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => <Shimmer key={i} className="w-full h-14" />)}
          </div>
        </div>
      </div>
    </div>
  );
}
