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
  /*
   * Addresses the product used to have.
   *
   * The library became the archive and the brand became the identity, and
   * somebody has both bookmarked. These answer before anything renders, with
   * the query string carried over, so a filtered view survives the rename.
   * Kept here rather than in a page because a redirect belongs to routing:
   * a page that renders and then redirects has already done the work.
   */
  async redirects() {
    return [
      { source: '/app/library', destination: '/app/archive', permanent: true },
      { source: '/app/library/:path*', destination: '/app/archive/:path*', permanent: true },
      { source: '/app/brand', destination: '/app/identity', permanent: true },
      { source: '/app/brand/:path*', destination: '/app/identity/:path*', permanent: true },
    ];
  },
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
