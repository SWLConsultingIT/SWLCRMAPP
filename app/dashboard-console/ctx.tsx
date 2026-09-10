"use client";
// One request's data, available to every sub-component without threading a
// prop through six levels. The console renders many small helper components
// and each of them needs a slice of the same snapshot.
import { createContext, useContext } from "react";
import type { OverviewData, TabsData } from "@/lib/console-data";

export type ConsoleSnapshot = { D: OverviewData; T: TabsData };
const Ctx = createContext<ConsoleSnapshot | null>(null);

export function ConsoleProvider({ value, children }: { value: ConsoleSnapshot; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function use(): ConsoleSnapshot {
  const v = useContext(Ctx);
  if (!v) throw new Error("Console components must render inside <ConsoleProvider>");
  return v;
}
export const useD = () => use().D;
export const useT = () => use().T;
