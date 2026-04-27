import { CardGridSkeleton } from "@/components/PageLoadingSkeleton";
export default function VoiceLoading() {
  return <CardGridSkeleton count={4} withFilters={false} />;
}
