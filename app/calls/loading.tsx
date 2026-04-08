import { C } from "@/lib/design";

function Shimmer({ className }: { className?: string }) {
  return <div className={`rounded-lg animate-pulse ${className}`} style={{ backgroundColor: C.surface }} />;
}

export default function CallsLoading() {
  return (
    <div className="p-8">
      <div className="mb-6"><Shimmer className="w-16 h-3 mb-2" /><Shimmer className="w-44 h-7" /></div>
      <div className="h-px mb-6" style={{ backgroundColor: C.border }} />
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
              <div className="flex gap-4">
                <Shimmer className="w-10 h-10 rounded-full shrink-0" />
                <div className="flex-1"><Shimmer className="w-40 h-5 mb-2" /><Shimmer className="w-56 h-3" /></div>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
          <Shimmer className="w-24 h-4 mb-4" />
          <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Shimmer key={i} className="w-full h-12" />)}</div>
        </div>
      </div>
    </div>
  );
}
