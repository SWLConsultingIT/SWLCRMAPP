import { C } from "@/lib/design";

function Shimmer({ className }: { className?: string }) {
  return <div className={`rounded-lg animate-pulse ${className}`} style={{ backgroundColor: C.surface }} />;
}

export default function ReportsLoading() {
  return (
    <div className="p-8">
      <div className="mb-6"><Shimmer className="w-20 h-3 mb-2" /><Shimmer className="w-28 h-7" /></div>
      <div className="h-px mb-8" style={{ backgroundColor: C.border }} />
      <div className="grid grid-cols-4 gap-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <Shimmer className="w-24 h-3 mb-3" />
            <Shimmer className="w-16 h-8" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border p-6 mb-6" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <Shimmer className="w-48 h-4 mb-5" />
        <Shimmer className="w-full h-24" />
      </div>
      <div className="grid grid-cols-3 gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <Shimmer className="w-32 h-4 mb-5" />
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, j) => <Shimmer key={j} className="w-full h-8" />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
