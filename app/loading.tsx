import LogoLoader from "@/components/LogoLoader";

// Default page loader — fires for any route below `/` that doesn't ship its
// own loading.tsx. We unified on the SWL gold-glint mark so every navigation
// fades through the same brand beat instead of swapping between five
// different shimmer skeletons.
export default function RootLoading() {
  return <LogoLoader fullscreen />;
}
