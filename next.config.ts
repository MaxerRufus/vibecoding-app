import type { NextConfig } from "next";

// @ts-ignore - The Next.js types might not recognize this brand-new property yet
const nextConfig: NextConfig = {
  // Moved to the ROOT level
  allowedDevOrigins: ["localhost:3000", "192.168.56.1", "192.168.56.1:3000"],
};

export default nextConfig;