import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { site, absoluteUrl } from '@/lib/site.ts';
import './globals.css';

/**
 * Fonts are self-hosted by next/font at build time.
 *
 * No request to Google at runtime: it costs a DNS lookup plus a round trip on
 * the critical path, it leaks visitor IPs to a third party, and `display: swap`
 * with a matched fallback is what keeps CLS at zero.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
  // Metric-matched fallback: the reflow when the real face arrives is what
  // produces layout shift, and adjusting the fallback removes it.
  adjustFontFallback: true,
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — ${site.tagline}`,
    // Every page ends up branded without repeating the name in each file.
    template: `%s · ${site.name}`,
  },
  description: site.subline,
  applicationName: site.name,
  // Canonical on every page. Without it, query strings and trailing slashes
  // split ranking signal across duplicates of the same page.
  alternates: { canonical: '/' },
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
  themeColor: '#07070b',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <head>
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
                  email: site.supportEmail,
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
