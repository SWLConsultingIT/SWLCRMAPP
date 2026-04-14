import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import PositiveReplyBanner from "@/components/PositiveReplyBanner";
import RealtimeRefresh from "@/components/RealtimeRefresh";
import CommandPalette from "@/components/CommandPalette";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "GrowthAI — Sales Engine",
  description: "Growth Engine — SWL Consulting",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} h-full`}>
      <body className="h-full antialiased">
        <div className="flex h-full">
          <Sidebar />
          <main className="flex-1 overflow-y-auto" style={{ backgroundColor: "#F7F8FB" }}>
            {children}
          </main>
        </div>
        <PositiveReplyBanner />
        <RealtimeRefresh />
        <CommandPalette />
      </body>
    </html>
  );
}
