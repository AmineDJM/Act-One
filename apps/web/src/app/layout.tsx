import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { site, absoluteUrl } from '@/lib/site.ts';
import { RSC_BUFFER_SCRIPT } from '@/lib/rsc-buffer.ts';
import './globals.css';

/*
 * Fonts ship with the app — Geist for the interface, Geist Mono for the
 * terminal details — and are served from our own origin by next/font. No
 * request to a font service at runtime: it costs a round trip on the critical
 * path, it leaks visitor IPs to a third party, and a build that reaches out
 * for its fonts is a build that fails without a network.
 */

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — ${site.tagline}`,
    // Every page ends up branded without repeating the name in each file.
    template: `%s · ${site.name}`,
  },
  description: site.subline,
  applicationName: site.name,
  /*
   * No canonical here on purpose. A canonical inherited from the root would
   * make every page that forgot to set one claim to be the landing page,
   * which is worse than having none: it tells a search engine to drop the
   * page. Public pages set their own through lib/seo.ts; the pages behind
   * the door say `noindex` instead.
   */
  openGraph: {
    type: 'website',
    siteName: site.name,
    locale: site.locale,
    url: site.url,
    title: `${site.name} — ${site.tagline}`,
    description: site.subline,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${site.name} — ${site.tagline}`,
    description: site.subline,
    ...(site.twitter ? { creator: site.twitter } : {}),
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  formatDetection: { telephone: false, address: false, email: false },
  category: 'technology',
};

export const viewport: Viewport = {
  themeColor: '#050609',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        {/* Server-component payloads arrive whole: see lib/rsc-buffer.ts for the why. */}
        <script dangerouslySetInnerHTML={{ __html: RSC_BUFFER_SCRIPT }} />
        {/* Organisation and product structured data, once, at the root. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@graph': [
                {
                  '@type': 'Organization',
                  '@id': absoluteUrl('/#organization'),
                  name: site.legalName,
                  url: site.url,
                  ...(site.supportEmail ? { email: site.supportEmail } : {}),
                },
                {
                  '@type': 'WebSite',
                  '@id': absoluteUrl('/#website'),
                  url: site.url,
                  name: site.name,
                  description: site.subline,
                  publisher: { '@id': absoluteUrl('/#organization') },
                  inLanguage: 'en',
                },
              ],
            }),
          }}
        />
      </head>
      <body>
        {/* Keyboard users should not have to tab through the nav on every page. */}
        <a href="#main" className="sr-only">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
