import { TableSkeleton } from "@/components/PageLoadingSkeleton";
export default function OpportunitiesLoading() {
  return <TableSkeleton rows={8} cols={6} />;
}
