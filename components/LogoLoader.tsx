"use client";

import type { CSSProperties } from "react";

// Branded loader: the actual SWL brand mark PNG (native gold colors, no
// filter pipeline → no edge artifacts) + italic "SWL" wordmark in matching
// gold. Pulse + halo + a diagonal shine that's mask-clipped to the mark's
// silhouette so it follows the exact logo shape.

const LOGO_URL = "https://framerusercontent.com/images/xDo4WIo9yWn44s4NzORGGAUNxrI.png";

export default function LogoLoader({
  fullscreen = false,
  size = 110,
}: {
  /** When true, covers the entire viewport. Default false: fills its
   *  container so the Sidebar and TopHeader stay visible during page nav. */
  fullscreen?: boolean;
  /** Logo height in px; mark + wordmark scale together. */
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

  // PNG is 280×136 native — use that aspect for the mark slot.
  const markWidth = Math.round(size * (280 / 136));

  return (
    <div className={containerClass} style={containerStyle} role="status" aria-live="polite">
      <div className="logo-loader-stage">
        <div className="logo-loader-mark-wrap" style={{ width: markWidth, height: size }}>
          {/* Actual brand PNG — rendered at native gold colors */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={LOGO_URL}
            alt="SWL"
            className="logo-loader-mark-img"
            style={{ width: markWidth, height: size }}
          />
          {/* Shine overlay: linear-gradient sweeping diagonally, mask-clipped
              to the same PNG silhouette so the highlight only paints on the
              actual logo shape (no rectangular bounding box reveal). */}
          <span
            aria-hidden
            className="logo-loader-mark-shine"
            style={{
              width: markWidth,
              height: size,
              WebkitMaskImage: `url(${LOGO_URL})`,
              maskImage: `url(${LOGO_URL})`,
              WebkitMaskSize: "contain",
              maskSize: "contain",
              WebkitMaskRepeat: "no-repeat",
              maskRepeat: "no-repeat",
              WebkitMaskPosition: "center",
              maskPosition: "center",
            }}
          />
        </div>

        {/* Wordmark — italic-skewed "SWL" in gold gradient with shimmer */}
        <span
          className="logo-loader-wordmark"
          style={{
            fontSize: Math.round(size * 0.92),
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
