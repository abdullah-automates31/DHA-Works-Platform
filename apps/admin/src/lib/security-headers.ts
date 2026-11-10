// Response headers for every page (docs/SECURITY.md section 16). Pure, so it is unit tested.
//
// The Content-Security-Policy is built per request in the proxy with a fresh random nonce: only scripts that carry that
// nonce run, so injected markup cannot execute ('unsafe-inline' is gone from script-src). Styles keep 'unsafe-inline'
// because React writes style attributes; styles cannot run code. Everything else is locked down: no framing, no
// foreign scripts, forms and requests only to this site and the Supabase project.

function originOf(supabaseUrl: string): string {
  try {
    return supabaseUrl ? new URL(supabaseUrl).origin : '';
  } catch {
    return '';
  }
}

/** A fresh nonce for one response: 128 random bits, base64. */
export function makeNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

export function contentSecurityPolicy(supabaseUrl: string, dev: boolean, nonce: string): string {
  const origin = originOf(supabaseUrl);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${origin ? ` ${origin}` : ''}`,
    `media-src 'self' blob:${origin ? ` ${origin}` : ''}`,
    "font-src 'self'",
    `connect-src 'self'${origin ? ` ${origin}` : ''}${dev ? ' ws:' : ''}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

/** Every other header. The CSP comes from contentSecurityPolicy() in the proxy. */
export function securityHeaders(): { key: string; value: string }[] {
  return [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()' },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
    { key: 'X-DNS-Prefetch-Control', value: 'off' },
    { key: 'Cache-Control', value: 'no-store' },
  ];
}
