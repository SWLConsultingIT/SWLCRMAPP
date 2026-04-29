"use client";

import type { CSSProperties } from "react";

// Branded loader: the full SWL logo (mark + wordmark) as inline SVG.
// The three angled parallelograms pulse on staggered offsets like a wave,
// while a shimmer gradient travels diagonally across the whole composition.
// Vector means clean edges at any size — no PNG bounding-box artifacts.
//
// Colors come from --brand tokens so a tenant brand override is honored;
// the three parallelograms are rendered as the canonical dark/medium/light
// gold trio.

export default function LogoLoader({
  fullscreen = false,
  size = 120,
}: {
  /** When true, covers the entire viewport. Default false: fills its
   *  container so the Sidebar and TopHeader stay visible during page nav. */
  fullscreen?: boolean;
  /** Approximate height of the logo in px; mark + wordmark scale together. */
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

  const markWidth = Math.round(size * 1.05);
  const markHeight = size;

  return (
    <div className={containerClass} style={containerStyle} role="status" aria-live="polite">
      <div className="logo-loader-stage">
        {/* Mark — 3 angled parallelograms in dark/medium/light gold,
            each pulsing on its own delay so they read as a wave. */}
        <svg
          className="logo-loader-mark"
          viewBox="0 0 110 100"
          width={markWidth}
          height={markHeight}
          aria-hidden
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <linearGradient id="logoLoaderG1" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--brand-dark, #b79832)" />
              <stop offset="60%" stopColor="color-mix(in srgb, var(--brand-dark, #b79832) 75%, #5a4720)" />
              <stop offset="100%" stopColor="var(--brand-dark, #b79832)" />
            </linearGradient>
            <linearGradient id="logoLoaderG2" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--brand, #c9a83a)" />
              <stop offset="55%" stopColor="color-mix(in srgb, var(--brand, #c9a83a) 70%, #fff8d8)" />
              <stop offset="100%" stopColor="var(--brand, #c9a83a)" />
            </linearGradient>
            <linearGradient id="logoLoaderG3" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="color-mix(in srgb, var(--brand, #c9a83a) 55%, #fff5d0)" />
              <stop offset="55%" stopColor="#fff8e0" />
              <stop offset="100%" stopColor="color-mix(in srgb, var(--brand, #c9a83a) 60%, #fff5d0)" />
            </linearGradient>
          </defs>

          {/* Three slanted parallelograms — top edge shifted right ~26 units
              from the bottom edge, mirroring the brand mark's ~15° lean. */}
          <path
            d="M 26 2 L 48 2 L 22 98 L 0 98 Z"
            fill="url(#logoLoaderG1)"
            className="logo-loader-bar logo-loader-bar--1"
            rx="2"
          />
          <path
            d="M 52 2 L 74 2 L 48 98 L 26 98 Z"
            fill="url(#logoLoaderG2)"
            className="logo-loader-bar logo-loader-bar--2"
          />
          <path
            d="M 78 2 L 100 2 L 74 98 L 52 98 Z"
            fill="url(#logoLoaderG3)"
            className="logo-loader-bar logo-loader-bar--3"
          />
        </svg>

        {/* Wordmark — italic-skewed "SWL" in gold gradient with shimmer */}
        <span
          className="logo-loader-wordmark"
          style={{
            fontSize: Math.round(size * 0.95),
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
