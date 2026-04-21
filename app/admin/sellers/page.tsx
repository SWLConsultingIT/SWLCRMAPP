import { supabase } from "@/lib/supabase";
import SellersClient from "./SellersClient";

export const dynamic = "force-dynamic";

export default async function SellersAdminPage() {
  const { data: sellers } = await supabase
    .from("sellers")
    .select("*")
    .order("created_at", { ascending: false });

  const { data: campCounts } = await supabase
    .from("campaigns")
    .select("seller_id, status");

  const stats: Record<string, { active: number; total: number }> = {};
  for (const c of campCounts ?? []) {
    if (!c.seller_id) continue;
    if (!stats[c.seller_id]) stats[c.seller_id] = { active: 0, total: 0 };
    stats[c.seller_id].total++;
    if (c.status === "active") stats[c.seller_id].active++;
  }

  return <SellersClient initialSellers={sellers ?? []} stats={stats} />;
}
