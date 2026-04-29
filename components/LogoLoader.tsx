"use client";

import type { CSSProperties } from "react";

// Minimal SWL mark with a gold shimmer sweep + soft pulse glow. Use it for
// auth transitions, demo enter/exit, and other rare full-blank moments.
// NOT a default page loader — page-specific `loading.tsx` files keep their
// semantic skeletons.

export default function LogoLoader({
  fullscreen = false,
  size = 240,
}: {
  /** When true, covers the entire viewport. Default false: fills its
   *  container so the Sidebar and TopHeader stay visible during page nav. */
  fullscreen?: boolean;
  /** Logo width in px. Height auto from aspect ratio. */
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
      <div className="logo-loader-glint" style={{ width: size }}>
        {/* Gold-tinted version of the SWL mark — uses CSS filters to recolor
            the white PNG into our brand gold without shipping a separate asset. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://framerusercontent.com/images/xDo4WIo9yWn44s4NzORGGAUNxrI.png"
          alt="SWL"
          className="logo-loader-glint__mark"
          style={{ width: size, height: "auto", display: "block" }}
        />
        {/* Shine sweep — a translucent diagonal gradient that travels across
            the logo every few seconds, like light catching on metal. */}
        <span aria-hidden className="logo-loader-glint__sweep" />
      </div>
    </div>
  );
}
