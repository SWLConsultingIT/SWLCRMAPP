"use client";

import { useState } from "react";
import { X, Maximize2, MapPin } from "lucide-react";
import { C, N } from "@/lib/design";

// Rooftop satellite thumbnail that EXPANDS IN PLACE into an interactive Google
// Maps, right inside the panel — no overlay, no black screen, no navigating
// away (Fran: "no quiero que me anule toda la pantalla / quiero que se expanda").
// Collapsed it floats left (280×200) so the outreach text wraps beside it;
// expanded it becomes a full-width map that pushes the rest of the page down.
export default function RooftopMapThumb({
  photoUrl, lat, lng, alt,
}: {
  photoUrl: string; lat: number | null; lng: number | null; alt: string;
}) {
  const [open, setOpen] = useState(false);
  const hasMap = typeof lat === "number" && typeof lng === "number";
  const embed = hasMap ? `https://maps.google.com/maps?q=${lat},${lng}&t=k&z=18&hl=es&output=embed` : null;

  if (open && embed) {
    return (
      <div className="w-full rounded-xl overflow-hidden border relative mb-3" style={{ borderColor: C.border, height: 460 }}>
        <iframe title={alt} src={embed} style={{ width: "100%", height: "100%", border: 0 }} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
        <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md pointer-events-none" style={{ backgroundColor: "rgba(11,15,26,0.78)", color: "#fff" }}>
          <MapPin size={12} style={{ color: N.goldOnDark }} /> {alt}
        </span>
        <button onClick={() => setOpen(false)} className="absolute top-2.5 right-2.5 inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-md transition-colors" style={{ backgroundColor: C.gold, color: N.ink }}>
          <X size={13} /> Close map
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => hasMap && setOpen(true)}
      className="relative block rounded-xl overflow-hidden border group float-left mr-4 mb-3"
      style={{ width: 280, height: 200, borderColor: C.border, cursor: hasMap ? "zoom-in" : "default" }}
      title={hasMap ? "Expand interactive map" : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photoUrl} alt={alt} className="w-full h-full object-cover transition-transform group-hover:scale-[1.03]" />
      {hasMap && (
        <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md shadow-sm" style={{ backgroundColor: C.gold, color: N.ink }}>
          <Maximize2 size={10} /> Expand map
        </span>
      )}
    </button>
  );
}
