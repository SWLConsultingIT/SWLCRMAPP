"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ZoomIn, ZoomOut, X, Maximize2 } from "lucide-react";

export default function RooftopImageLightbox({
  photoUrl,
  alt,
  lat,
  lng,
}: {
  photoUrl: string;
  alt: string;
  // When coordinates are present (Gruppo Everest leads carry rooftop_lat/lng),
  // the lightbox opens a NAVIGABLE Google Maps satellite view instead of a
  // static zoom image — pan/zoom the real rooftop + surroundings. No API key
  // needed (classic ?output=embed). Falls back to the image viewer otherwise.
  lat?: number | null;
  lng?: number | null;
}) {
  const hasMap = typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng);
  const mapEmbed = hasMap ? `https://maps.google.com/maps?q=${lat},${lng}&t=k&z=18&hl=es&output=embed` : null;
  const mapLink  = hasMap ? `https://www.google.com/maps/@${lat},${lng},19z/data=!3m1!1e3` : null;
  const [open, setOpen]   = useState(false);
  const [zoom, setZoom]   = useState(1);
  const [pos, setPos]     = useState({ x: 0, y: 0 });
  const dragging          = useRef(false);
  const dragStart         = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  const clampZoom = (z: number) => Math.min(5, Math.max(1, z));

  const openLightbox = () => { setOpen(true); setZoom(1); setPos({ x: 0, y: 0 }); };
  const closeLightbox = () => setOpen(false);

  // Mouse wheel zoom
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    setZoom(z => clampZoom(z - e.deltaY * 0.001));
  }, []);

  // Keyboard: Escape to close, +/- to zoom
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "+" || e.key === "=") setZoom(z => clampZoom(z + 0.25));
      if (e.key === "-") setZoom(z => clampZoom(z - 0.25));
      if (e.key === "0") { setZoom(1); setPos({ x: 0, y: 0 }); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Attach wheel listener to container
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !open) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open, onWheel]);

  // Drag to pan (only when zoomed)
  const onMouseDown = (e: React.MouseEvent) => {
    if (zoom <= 1) return;
    dragging.current = true;
    dragStart.current = { mx: e.clientX, my: e.clientY, px: pos.x, py: pos.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    setPos({
      x: dragStart.current.px + e.clientX - dragStart.current.mx,
      y: dragStart.current.py + e.clientY - dragStart.current.my,
    });
  };
  const onMouseUp = () => { dragging.current = false; };

  // Reset pan when zoom returns to 1
  useEffect(() => { if (zoom <= 1) setPos({ x: 0, y: 0 }); }, [zoom]);

  return (
    <>
      {/* Thumbnail — replaces the <a target="_blank"> */}
      <button
        onClick={openLightbox}
        className="relative block rounded-lg overflow-hidden border group shrink-0 cursor-zoom-in"
        style={{ borderColor: "var(--border, #1E2238)", width: 220, height: 165 }}
        title="Ver foto a tamaño completo"
        type="button"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoUrl}
          alt={alt}
          className="w-full h-full object-cover transition-transform group-hover:scale-[1.02]"
        />
        <span
          className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-1 rounded"
          style={{ backgroundColor: "rgba(0,0,0,0.55)", color: "#fff" }}
        >
          <Maximize2 size={10} /> {hasMap ? "Ver mapa" : "Ver"}
        </span>
      </button>

      {/* Lightbox */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.88)", backdropFilter: "blur(4px)" }}
          onClick={closeLightbox}
        >
          {/* Toolbar */}
          <div
            className="absolute top-4 right-4 flex items-center gap-2 z-10"
            onClick={e => e.stopPropagation()}
          >
            {hasMap ? (
              <a
                href={mapLink!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 h-8 rounded-lg text-white hover:bg-white/10 transition-colors"
                title="Abrir en Google Maps"
              >
                Abrir en Google Maps
              </a>
            ) : (
              <>
                <button
                  onClick={() => setZoom(z => clampZoom(z - 0.25))}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white hover:bg-white/10 transition-colors"
                  title="Alejar (–)"
                >
                  <ZoomOut size={16} />
                </button>
                <span className="text-xs font-bold text-white/70 w-10 text-center select-none">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={() => setZoom(z => clampZoom(z + 0.25))}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white hover:bg-white/10 transition-colors"
                  title="Acercar (+)"
                >
                  <ZoomIn size={16} />
                </button>
              </>
            )}
            <button
              onClick={closeLightbox}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white hover:bg-white/10 transition-colors ml-2"
              title="Cerrar (Esc)"
            >
              <X size={16} />
            </button>
          </div>

          {/* Navigable Google Maps satellite (Everest leads with coordinates) */}
          {hasMap && (
            <div
              className="relative rounded-lg overflow-hidden"
              style={{ width: "90vw", height: "85vh", backgroundColor: "#000" }}
              onClick={e => e.stopPropagation()}
            >
              <iframe
                title={alt}
                src={mapEmbed!}
                style={{ width: "100%", height: "100%", border: 0 }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
              />
            </div>
          )}

          {/* Reset zoom hint */}
          {!hasMap && zoom > 1 && (
            <button
              className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-white/50 hover:text-white/80 transition-colors"
              onClick={e => { e.stopPropagation(); setZoom(1); setPos({ x: 0, y: 0 }); }}
            >
              Resetear zoom · presioná 0
            </button>
          )}

          {/* Image container (static-photo fallback when no coordinates) */}
          {!hasMap && (
          <div
            ref={containerRef}
            className="relative overflow-hidden"
            style={{
              width: "90vw",
              height: "85vh",
              cursor: zoom > 1 ? "grab" : "zoom-in",
            }}
            onClick={e => e.stopPropagation()}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoUrl}
              alt={alt}
              draggable={false}
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px)) scale(${zoom})`,
                transformOrigin: "center",
                maxWidth: "90vw",
                maxHeight: "85vh",
                objectFit: "contain",
                transition: dragging.current ? "none" : "transform 0.15s ease",
                userSelect: "none",
              }}
            />
          </div>
          )}

          {/* Scroll hint */}
          {!hasMap && zoom === 1 && (
            <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] text-white/40 select-none pointer-events-none">
              Scroll para hacer zoom · arrastrá para mover · Esc para cerrar
            </p>
          )}
        </div>
      )}
    </>
  );
}
