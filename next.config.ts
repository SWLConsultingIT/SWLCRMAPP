import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // v16 dropped the dynamic default to 0s, so back-nav refetches every page
    // segment. 30s/180s gives instant back/forward without staling lead data.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
