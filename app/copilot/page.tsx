import CopilotChat from "@/components/CopilotChat";
import { C } from "@/lib/design";

export const dynamic = "force-dynamic";

export default async function CopilotPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return (
    <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">
      <h1 className="text-2xl font-bold tracking-tight" style={{ color: C.textPrimary }}>Copilot</h1>
      <p className="text-sm mt-1 mb-5" style={{ color: C.textMuted }}>
        Your strategic memory across every prospect — compare objections, reactions and what&apos;s working.
      </p>
      <CopilotChat initialQuestion={q} />
    </div>
  );
}
