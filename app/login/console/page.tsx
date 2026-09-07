// TEMPORARY review harness — sits under /login, which the proxy already
// treats as public by prefix, so the mock renders without a session and no
// shared file had to change. Delete with app/dashboard-console/.
import Shell from "../../dashboard-console/Shell";

export const metadata = { robots: { index: false, follow: false } };

export default function Page() { return <Shell />; }
