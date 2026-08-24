import type { NextConfig } from 'next';

/**
 * Security headers are defined here rather than in middleware so that they are
 * applied by the edge/CDN layer for every response, including static assets and
 * error pages that never reach application code.
 */
const isDev = process.env.NODE_ENV === 'development';

/**
 * Next.js injects inline bootstrap scripts, so a nonce-less CSP needs
 * 'unsafe-inline' for scripts in development. In production we rely on
 * strict-dynamic + a per-request nonce injected by the middleware.
 */
const contentSecurityPolicy = (nonce: string | null): string =>
  [
    "default-src 'self'",
    nonce
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https: 'unsafe-inline'`
      : `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
    // Tailwind injects a stylesheet; styled-jsx and Next inline critical CSS.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self'",
    'upgrade-insecure-requests',
  ].join('; ');

export const buildContentSecurityPolicy = contentSecurityPolicy;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: false,
  experimental: {
    // Server Actions are not used as the mutation surface (see docs/architecture.md),
    // but Next still needs a sane body limit for the routes that do accept uploads.
    serverActions: {
      bodySizeLimit: '1mb',
    },
  },
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: [
              'camera=()',
              'microphone=()',
              'geolocation=()',
              'interest-cohort=()',
              'payment=()',
              'usb=()',
              'publickey-credentials-get=(self)',
            ].join(', '),
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          ...(isDev
            ? []
            : [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=63072000; includeSubDomains; preload',
                },
              ]),
        ],
      },
      {
        // The service worker must never be served from a stale cache.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' }],
      },
    ]);
  },
};

export default nextConfig;
