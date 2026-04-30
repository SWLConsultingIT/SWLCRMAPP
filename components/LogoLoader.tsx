"use client";

import type { CSSProperties } from "react";

// Branded loader: brand-mark PNG (cropped to just the gold parallelograms,
// since the PNG's "SWL" portion is white and disappears on light mode) +
// gold typographic "SWL" wordmark beside it. Both are visible regardless of
// theme. Halo + masked shine sweep follows the mark's silhouette.

const LOGO_URL = "https://framerusercontent.com/images/xDo4WIo9yWn44s4NzORGGAUNxrI.png";

export default function LogoLoader({
  fullscreen = false,
  size = 140,
}: {
  /** When true, covers the entire viewport. Default false: fills its
   *  container so the Sidebar and TopHeader stay visible during page nav. */
  fullscreen?: boolean;
  /** Lockup height in px. */
  size?: number;
}) {
  const containerClass = fullscreen
    ? "fixed inset-0 z-[100] flex items-center justify-center"
    : "w-full min-h-[70vh] flex items-center justify-center";

  const containerStyle: CSSProperties = fullscreen
    ? {
        backgroundColor: "color-mix(in srgb, var(--c-bg, #F7F8FB) 92%, transparent)",
        backdropFilter: "blur(2px)",
      }
    : {};

  // PNG is 280×136 native. The brand mark sits in the left ~35%; the rest
  // is the white "SWL" lettering which we DON'T want (white doesn't read on
  // light backgrounds). We give the wrapper the cropped width and use
  // object-fit + object-position to render only the mark portion.
  const markCropRatio = 0.34; // visible portion of the PNG (left 34%)
  const fullPngWidth = size * (280 / 136); // what 100% of the PNG would be
  const markWidth = Math.round(fullPngWidth * markCropRatio);

  return (
    <div className={containerClass} style={containerStyle} role="status" aria-live="polite">
      <div className="logo-loader-stage">
        {/* Brand mark — cropped PNG showing only the gold parallelograms */}
        <div className="logo-loader-mark-wrap" style={{ width: markWidth, height: size }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGO_URL}
            alt=""
            className="logo-loader-mark-img"
            style={{
              width: fullPngWidth,
              height: size,
              objectFit: "cover",
              objectPosition: "left center",
            }}
          />
          {/* Shine overlay clipped to the visible portion of the PNG */}
          <span
            aria-hidden
            className="logo-loader-mark-shine"
            style={{
              width: markWidth,
              height: size,
              WebkitMaskImage: `url(${LOGO_URL})`,
              maskImage: `url(${LOGO_URL})`,
              WebkitMaskSize: `${fullPngWidth}px ${size}px`,
              maskSize: `${fullPngWidth}px ${size}px`,
              WebkitMaskRepeat: "no-repeat",
              maskRepeat: "no-repeat",
              WebkitMaskPosition: "left center",
              maskPosition: "left center",
            }}
          />
        </div>

        {/* Gold typographic wordmark — works on any background */}
        <span
          className="logo-loader-wordmark"
          style={{
            fontSize: Math.round(size * 0.85),
            lineHeight: 1,
            fontFamily: "var(--font-outfit), system-ui, sans-serif",
          }}
        >
          SWL
        </span>
      </div>
    </div>
  );
}
