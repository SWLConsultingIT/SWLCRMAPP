# SWL Consulting — Brand Kit

Everything needed to reproduce the SWL look in another app: colors, tokens
(light + dark), typography, and the animated logo loader.

## Files
| File | What it is |
|------|-----------|
| `brand.css` | Brand color + all design tokens (light/dark), base typography, focus ring, card/animation utilities, and the LogoLoader styles. Paste into your global CSS. |
| `design.ts` | TypeScript token objects (`C` colors, `T` type scale, `N` navy palette, `R` radii, `TX` text, `H` hover). Import as `@/lib/design`. |
| `LogoLoader.tsx` | The animated SWL loader (brand mark + shimmering gold wordmark). Client component. |

## Brand basics
- **Gold (brand):** `#C9A83A` — dark `#B79832`, soft `rgba(201,168,58,0.15)`
- **Navy counterpoint:** `#0B0F1A` / `#111827` (see `N` in design.ts)
- **Logo PNG:** `https://framerusercontent.com/images/xDo4WIo9yWn44s4NzORGGAUNxrI.png`
  - 280×136, gold parallelogram mark in the left ~34%, white "SWL" lettering on the right.
  - The loader **crops to the left 34%** (the gold mark) and renders its own gold typographic "SWL" beside it, so it works on light AND dark. If you want the raw wordmark too, use the full PNG.
  - ⚠️ It's hosted on Framer's CDN. For a production app, **download it and self-host** (or convert to base64) so you don't depend on that URL.

## Install (Next.js — the source stack)

1. **Fonts** (in `app/layout.tsx`):
   ```tsx
   import { Inter, Outfit } from "next/font/google";
   const inter  = Inter({  variable: "--font-inter",  subsets: ["latin"] });
   const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], weight: ["500","600","700","800"] });
   // on <html> or <body>:
   <body className={`${inter.variable} ${outfit.variable}`}>
   ```
   Not on Next? Load Inter + Outfit however you like and expose them as the CSS
   vars `--font-inter` and `--font-outfit`.

2. **CSS:** paste `brand.css` into your global stylesheet (after your CSS reset).
   It defines `:root` tokens for light mode and `[data-theme="dark"]` overrides —
   so toggle dark mode by setting `document.documentElement.dataset.theme = "dark"`.

3. **Tokens:** drop `design.ts` at `lib/design.ts` and use `C.*` etc.
   Example: `style={{ backgroundColor: C.card, color: C.textPrimary }}`.

4. **Loader:** drop `LogoLoader.tsx` at `components/LogoLoader.tsx`.
   ```tsx
   <LogoLoader fullscreen />                 // full-screen overlay
   <LogoLoader />                            // fills its container (page nav)
   <LogoLoader size={54} minHeight="200px" />// compact, inside a card
   ```

## Notes / gotchas
- Colors use `color-mix(in srgb, var(--brand) N%, transparent)` for tints —
  **never** concatenate hex alpha to `--brand` (it's a CSS var, not a hex).
- `--brand` is meant to be runtime-overridable per client (white-label). Default
  is SWL gold. Override by setting `--brand` on `:root` (or a wrapper).
- The typographic wordmark in the loader is **hardcoded gold** on purpose (SWL
  product identity), so it does NOT follow a `--brand` override.
- `brand.css` assumes Tailwind utility classes exist in your app (the `T`, `R`,
  `H` objects in design.ts are Tailwind class strings). If you're not on
  Tailwind, use the raw CSS vars/values instead.
