import HomeClient from "@/components/HomeClient";

// The Home ("Tu día") — the landing after login. Live action surface, never
// cached. Sidebar + top header come from the shared AppShell (app/layout.tsx).
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function HomePage() {
  return (
    <div className="p-4 sm:p-6 w-full">
      <HomeClient />
    </div>
  );
}
