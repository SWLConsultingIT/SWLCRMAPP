"use client";

import type { CSSProperties } from "react";

// Branded loader: typographic "SWL" wordmark with a gold gradient that
// shimmers across the letters. Uses background-clip:text so the highlight
// follows the actual letterforms — no PNG edges, no rectangular bounding
// box artifacts. Colors pull from the app's real --brand tokens so it
// matches whatever the active tenant's brand override is.
export default function LogoLoader({
  fullscreen = false,
  size = 180,
}: {
  /** When true, covers the entire viewport. Default false: fills its
   *  container so the Sidebar and TopHeader stay visible during page nav. */
  fullscreen?: boolean;
  /** Wordmark font-size in px. */
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

  return (
    <div className={containerClass} style={containerStyle} role="status" aria-live="polite">
      <span
        className="logo-loader-wordmark"
        style={{
          fontSize: size,
          lineHeight: 1,
          fontFamily: "var(--font-outfit), system-ui, sans-serif",
        }}
      >
        SWL
      </span>
    </div>
  );
}
