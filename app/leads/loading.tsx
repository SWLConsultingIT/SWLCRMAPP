import { TableSkeleton } from "@/components/PageLoadingSkeleton";

export default function LeadsLoading() {
  return <TableSkeleton rows={10} cols={7} />;
}
