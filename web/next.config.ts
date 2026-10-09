import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Lean production server: one Node process, no image optimizer workers.
  images: { unoptimized: true },
  // Same alias the next-intl plugin would add. The plugin itself is skipped because it pulls in
  // @swc/core's native addon, which this laptop's application-control policy will not load.
  turbopack: { resolveAlias: { "next-intl/config": "./src/i18n/request.ts" } },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

export default config;
