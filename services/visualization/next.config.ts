import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  typedRoutes: true,
  experimental: {
    allowedDevOrigins: ["127.0.0.1"]
  }
};

export default nextConfig;
