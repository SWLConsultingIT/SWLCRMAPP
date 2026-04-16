import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import TopHeader from "@/components/TopHeader";
import PositiveReplyBanner from "@/components/PositiveReplyBanner";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import CommandPalette from "@/components/CommandPalette";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], weight: ["500", "600", "700", "800"] });

export const metadata: Metadata = {
  title: "GrowthAI — Sales Engine",
  description: "Growth Engine — SWL Consulting",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} ${outfit.variable} h-full`}>
      <body className="h-full antialiased">
        <div className="flex h-full">
          <Sidebar />
          <div className="flex-1 flex flex-col overflow-hidden">
            <TopHeader />
            <main className="flex-1 overflow-y-auto" style={{ backgroundColor: "#F7F8FB" }}>
              {children}
            </main>
          </div>
        </div>
        <PositiveReplyBanner />
        <RealtimeRefresh />
        <CommandPalette />
      </body>
    </html>
  );
}
