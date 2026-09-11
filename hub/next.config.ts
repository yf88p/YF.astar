import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // للمعاينة على منصة Arena
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "ALLOWALL" },
        ],
      },
    ];
  },
};

export default nextConfig;
