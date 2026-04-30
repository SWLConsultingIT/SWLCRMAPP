import LogoLoader from "@/components/LogoLoader";

// Default page loader. Renders inside the `<main>` of AppShell — Sidebar +
// TopHeader stay visible, only the content area animates while the next
// route's data resolves. Big SWL mark with the gold shine sweep.
export default function RootLoading() {
  return <LogoLoader />;
}
