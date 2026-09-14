// Team Chat — its own section.
//
// It used to be tab 2 of /queue. It moved to its own route so it can have a
// place in the sidebar and /queue can stay focused on lead work (replies and
// calls).
//
// Deliberately a thin wrapper: the chat is the SAME component as before, not a
// copy. All this page does is the section frame plus handing down the
// ?thread= that notification links carry.

import type { Metadata } from "next";
import { Suspense } from "react";
import ChatPanel from "@/components/ChatPanel";
import AuroraHero from "@/shared/ui/AuroraHero";
import { getT } from "@/shared/i18n/server";

export const metadata: Metadata = { title: "Team Chat — Growth Engine" };

// The chat reads live and marks read on open: it must never be served cached.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TeamChatPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string }>;
}) {
  const { thread } = await searchParams;
  const t = await getT();

  return (
    <div className="p-4 sm:p-6 w-full">
      <AuroraHero
        eyebrow={t("teamChat.hero.section")}
        title={t("teamChat.hero.title")}
        subtitle={t("teamChat.hero.desc")}
      />
      <div className="mt-4">
        <Suspense fallback={null}>
          <ChatPanel initialThreadId={thread ?? null} />
        </Suspense>
      </div>
    </div>
  );
}
