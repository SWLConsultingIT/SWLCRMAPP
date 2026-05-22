import { redirect } from "next/navigation";

// The dedicated /inbox route was unified into the Queue's "Inbox" tab so the
// sidebar stays lean and replies sit next to other pending tasks. Old bookmarks
// + the legacy "Open Inbox" CTAs still land somewhere useful via this redirect.
export default function InboxRedirect() {
  redirect("/queue?tab=inbox");
}
