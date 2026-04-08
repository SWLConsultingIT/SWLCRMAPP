import { C } from "@/lib/design";

function Shimmer({ className }: { className?: string }) {
  return <div className={`rounded-lg animate-pulse ${className}`} style={{ backgroundColor: C.surface }} />;
}

export default function LeadsLoading() {
  return (
    <div className="p-8">
      <div className="mb-6 flex items-end justify-between">
        <div><Shimmer className="w-28 h-3 mb-2" /><Shimmer className="w-20 h-7" /></div>
        <Shimmer className="w-28 h-8 rounded-lg" />
      </div>
      <div className="h-px mb-5" style={{ backgroundColor: C.border }} />
      <div className="flex gap-2 mb-5">
        {Array.from({ length: 5 }).map((_, i) => <Shimmer key={i} className="w-24 h-7 rounded-full" />)}
      </div>
      <div className="flex gap-3 mb-5">
        <Shimmer className="w-64 h-9 rounded-lg" />
        <Shimmer className="w-40 h-9 rounded-lg" />
        <Shimmer className="w-36 h-9 rounded-lg" />
      </div>
      <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: C.card, borderColor: C.border }}>
        <div className="px-4 py-3" style={{ backgroundColor: C.surface }}>
          <Shimmer className="w-full h-4" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 border-b" style={{ borderColor: C.surface }}>
            <Shimmer className="w-7 h-7 rounded-full shrink-0" />
            <Shimmer className="w-36 h-4" />
            <Shimmer className="w-28 h-4 ml-4" />
            <Shimmer className="w-16 h-4 ml-auto" />
            <Shimmer className="w-20 h-6 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
