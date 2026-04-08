import { C } from "@/lib/design";

function Shimmer({ className }: { className?: string }) {
  return <div className={`rounded-lg animate-pulse ${className}`} style={{ backgroundColor: C.surface }} />;
}

export default function CampaignsLoading() {
  return (
    <div className="p-8">
      <div className="mb-6"><Shimmer className="w-28 h-3 mb-2" /><Shimmer className="w-32 h-7" /></div>
      <div className="h-px mb-6" style={{ backgroundColor: C.border }} />
      <div className="grid grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-4" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <Shimmer className="w-12 h-8 mb-1" />
            <Shimmer className="w-20 h-3" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="px-4 py-3" style={{ backgroundColor: C.surface }}><Shimmer className="w-full h-4" /></div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b" style={{ borderColor: C.surface }}>
            <Shimmer className="w-32 h-4" />
            <Shimmer className="w-20 h-4 ml-4" />
            <Shimmer className="w-20 h-6 rounded-md ml-4" />
            <Shimmer className="w-32 h-3 ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
