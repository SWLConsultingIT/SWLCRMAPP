// Notifications Center page (P2a). Thin server shell — the client component
// owns fetching/filters/pagination/realtime against /api/notifications.

import AuroraHero from "@/components/AuroraHero";
import NotificationsCenter from "@/components/NotificationsCenter";
import { getT } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const t = await getT();
  return (
    <div className="p-6 w-full">
      <AuroraHero eyebrow="Growth Engine" title={t("notif.center.title")} subtitle={t("notif.center.subtitle")} />
      <NotificationsCenter />
    </div>
  );
}
