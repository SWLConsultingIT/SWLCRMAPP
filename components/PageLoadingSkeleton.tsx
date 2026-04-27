import { C } from "@/lib/design";

function Shimmer({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`rounded-lg animate-pulse ${className}`} style={{ backgroundColor: "#E5E7EB", ...style }} />;
}

export default function PageLoadingSkeleton() {
  return (
    <div className="p-8 w-full max-w-7xl mx-auto">
      <div className="mb-6">
        <Shimmer className="w-24 h-3 mb-2" />
        <Shimmer className="w-48 h-7" />
      </div>
      <div className="h-px mb-6" style={{ backgroundColor: C.border }} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-5" style={{ backgroundColor: C.card, borderColor: C.border }}>
            <Shimmer className="w-3/5 h-4 mb-3" />
            <Shimmer className="w-full h-3 mb-2" />
            <Shimmer className="w-4/5 h-3 mb-4" />
            <div className="flex gap-2">
              <Shimmer className="w-16 h-6 rounded-full" />
              <Shimmer className="w-20 h-6 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
