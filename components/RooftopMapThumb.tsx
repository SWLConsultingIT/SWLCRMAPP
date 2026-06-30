"use client";

import { useState } from "react";
import { X, Maximize2, MapPin } from "lucide-react";
import { C, N } from "@/lib/design";

// Rooftop satellite thumbnail → opens a FLOATING mini Google Maps, docked in the
// corner like the Aircall call widget. It never blacks out or dims the rest of
// the screen (Fran: "no quiero que me anule toda la pantalla") and never
// navigates away — the page stays fully usable behind it.
export default function RooftopMapThumb({
  photoUrl, lat, lng, alt,
}: {
  photoUrl: string; lat: number | null; lng: number | null; alt: string;
}) {
  const [open, setOpen] = useState(false);
  const hasMap = typeof lat === "number" && typeof lng === "number";
  const embed = hasMap ? `https://maps.google.com/maps?q=${lat},${lng}&t=k&z=18&hl=es&output=embed` : null;

  return (
    <>
      <button
        type="button"
        onClick={() => hasMap && setOpen(true)}
        className="relative block rounded-xl overflow-hidden border shrink-0 group"
        style={{ width: 280, height: 200, borderColor: C.border, cursor: hasMap ? "zoom-in" : "default" }}
        title={hasMap ? "Open interactive map" : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} alt={alt} className="w-full h-full object-cover transition-transform group-hover:scale-[1.03]" />
        {hasMap && (
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md"
            style={{ backgroundColor: C.gold, color: N.ink }}>
            <Maximize2 size={10} /> Map
          </span>
        )}
      </button>

      {/* Floating, non-blocking map widget — docked bottom-right like Aircall */}
      {open && embed && (
        <div
          className="fixed z-50 rounded-2xl overflow-hidden flex flex-col"
          style={{
            bottom: 24, right: 24,
            width: "min(440px, calc(100vw - 48px))",
            height: "min(420px, calc(100vh - 48px))",
            backgroundColor: N.ink,
            border: `1px solid ${N.hairline}`,
            boxShadow: "0 24px 60px -12px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.2)",
          }}
        >
          <div className="flex items-center justify-between px-3.5 py-2.5 shrink-0" style={{ borderBottom: `1px solid ${N.hairline}` }}>
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold truncate" style={{ color: "#fff" }}>
              <MapPin size={13} style={{ color: N.goldOnDark }} />
              <span className="truncate">{alt}</span>
            </span>
            <button onClick={() => setOpen(false)} aria-label="Close"
              className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors"
              style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "#fff" }}>
              <X size={15} />
            </button>
          </div>
          <iframe title={alt} src={embed} style={{ width: "100%", height: "100%", border: 0, flex: 1 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
        </div>
      )}
    </>
  );
}
