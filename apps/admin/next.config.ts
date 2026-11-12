import type { NextConfig } from 'next';
import { securityHeaders } from './src/lib/security-headers.ts';

const config: NextConfig = {
  // A second dev server (for example against the local stack) needs its own build folder: NEXT_DIST_DIR=.next-local
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  // The Content-Security-Policy (with a per-request nonce) is added by src/proxy.ts.
  async headers() {
    // Pages and data stay no-store. Hashed build files under /_next/static keep Next.js's own long-lived cache header
    // (they contain no user data), so a reload does not download the scripts and styles again.
    return [
      { source: '/((?!_next/static).*)', headers: securityHeaders() },
      { source: '/_next/static/:path*', headers: securityHeaders().filter((h) => h.key !== 'Cache-Control') },
    ];
  },
};

export default config;
