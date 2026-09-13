"use client";

import { createContext, useContext, useState } from "react";

type MobileMenuCtx = { open: boolean; toggle: () => void; close: () => void };

const MobileMenuContext = createContext<MobileMenuCtx>({
  open: false,
  toggle: () => {},
  close: () => {},
});

export function MobileMenuProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen(v => !v);
  const close = () => setOpen(false);
  return (
    <MobileMenuContext.Provider value={{ open, toggle, close }}>
      {children}
    </MobileMenuContext.Provider>
  );
}

export function useMobileMenu() {
  return useContext(MobileMenuContext);
}
