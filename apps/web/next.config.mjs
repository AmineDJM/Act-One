/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source rather than build output, so Next
  // compiles them with the app. One build step instead of a build graph.
  transpilePackages: [
    '@act-one/core',
    '@act-one/db',
    '@act-one/design',
    '@act-one/providers',
    '@act-one/research',
    '@act-one/creative',
  ],
  poweredByHeader: false,
  compress: true,
  // Keeps the heavy Node-only packages out of the client bundle entirely.
  // (Moved out of `experimental` in Next 15 — the old key is ignored silently
  // apart from a startup warning, which is exactly how it stays wrong.)
  serverExternalPackages: ['pg', 'playwright-core', 'stripe'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
