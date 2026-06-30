"use client";

import { useState } from "react";
import { X, Map as MapIcon } from "lucide-react";
import { C } from "@/lib/design";

// Rooftop satellite thumbnail → opens a contained, interactive mini Google Maps
// INSIDE the app (no full-screen takeover, no navigating away). The thumbnail is
// the static satellite image; clicking it pops a card with a live, pan/zoom map.
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
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md"
            style={{ backgroundColor: "rgba(0,0,0,0.6)", color: "#fff" }}>
            <MapIcon size={11} /> Map
          </span>
        )}
      </button>

      {open && embed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{ backgroundColor: "rgba(11,15,26,0.45)", backdropFilter: "blur(2px)" }}
          onClick={() => setOpen(false)}>
          <div className="relative rounded-2xl overflow-hidden shadow-2xl border"
            style={{ width: "min(840px, 92vw)", height: "min(560px, 80vh)", borderColor: "rgba(255,255,255,0.15)", backgroundColor: "#000" }}
            onClick={e => e.stopPropagation()}>
            <iframe title={alt} src={embed} style={{ width: "100%", height: "100%", border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
            <button onClick={() => setOpen(false)}
              className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "rgba(0,0,0,0.6)", color: "#fff" }} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
