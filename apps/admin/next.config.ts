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
    return [{ source: '/:path*', headers: securityHeaders() }];
  },
};

export default config;
