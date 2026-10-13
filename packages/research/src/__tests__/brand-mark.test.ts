import { describe, expect, it } from 'vitest';
import type { PageCapture, StyleProfile } from '@act-one/providers';
import { dataUrlDrawsAMark, extractBrandSystem, inlineSvgDraws, keepDrawnLogos, siteName } from '../index.ts';

/**
 * The brand's name and mark as a film shows them: the site's own spelling,
 * and a logo that draws something. Both went wrong on kde.org — "Kde" on
 * screen, and a search glass copied without its sprite symbol as the logo.
 */
const svg = (markup: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
const MARK = svg('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="32"><rect width="32" height="32" rx="6" fill="#1d99f3"/><rect x="40" y="10" width="76" height="12" fill="#232629"/></svg>');
const SPRITE_GLASS = svg('<svg xmlns="http://www.w3.org/2000/svg" class="bi theme-icon"><use href="#search-icon"/></svg>');
const CARRIED = svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><defs><symbol id="m"><path d="M0 0h16v16H0z"/></symbol></defs><use href="#m"/></svg>');
const SHAPELESS = svg('<svg xmlns="http://www.w3.org/2000/svg"><g fill="red"></g></svg>');
const INVISIBLE = svg('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="none"/></svg>');

describe('the brand name', () => {
  it('is written as the site writes it, not as its address capitalised', () => {
    const kde = '<html><head><title>Plasma 5.20: One absolutely massive release - KDE Community</title></head></html>';
    expect(siteName(kde, 'https://kde.org/announcements/plasma/5/5.20.0/')).toBe('KDE');
    expect(siteName('<meta property="og:site_name" content="GitHub">', 'https://www.github.com/')).toBe('GitHub');
    expect(siteName('<meta content="Hugging Face" property="og:site_name"><title>x</title>', 'https://huggingface.co/')).toBe('Hugging Face');
    expect(siteName('<title>BBC News &amp; Sport</title>', 'https://www.bbc.co.uk/news')).toBe('BBC');
  });

  it('takes the name a site declares for itself when its address is not its name', () => {
    expect(siteName('<meta name="application-name" content="Figma">', 'https://figjam.example/')).toBe('Figma');
    const ld = '<script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"Northwind Traders"}]}</script>';
    expect(siteName(ld, 'https://nwt.example/')).toBe('Northwind Traders');
  });

  it('falls back to the address only when the page names itself nowhere usable', () => {
    expect(siteName('<title>Welcome to our homepage, where great things happen every day</title>', 'https://acme.com/')).toBe('Acme');
    expect(siteName('', 'not a url')).toBe('Product');
  });
});

describe('an inline mark', () => {
  it('draws when its shapes, and every element it refers to, are inside it', () => {
    expect(inlineSvgDraws(MARK)).toBe(true);
    expect(inlineSvgDraws(CARRIED)).toBe(true);
  });

  it('does not draw when it is a sprite reference, another file, or no shape at all', () => {
    expect(inlineSvgDraws(SPRITE_GLASS)).toBe(false);
    expect(inlineSvgDraws(svg('<svg xmlns="http://www.w3.org/2000/svg"><use href="/sprite.svg#logo"/></svg>'))).toBe(false);
    expect(inlineSvgDraws(SHAPELESS)).toBe(false);
    expect(inlineSvgDraws('data:image/svg+xml,%E0%A4%A')).toBe(false);
  });

  it('is drawn, pixel by pixel, before the brand keeps it', async () => {
    expect(await dataUrlDrawsAMark(MARK)).toBe(true);
    expect(await dataUrlDrawsAMark(INVISIBLE)).toBe(false);
    expect(await dataUrlDrawsAMark(`data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="4"/></svg>').toString('base64')}`)).toBe(true);
  });
});

function capture(logoCandidates: StyleProfile['logoCandidates']): PageCapture {
  return {
    url: 'https://kde.org/',
    title: 'KDE',
    text: 'KDE',
    html: '<html></html>',
    screenshot: null,
    styleProfile: {
      colorWeights: [{ color: '#ffffff', weight: 900_000, role: 'background' }, { color: '#1d99f3', weight: 14_000, role: 'accent' }],
      fontFamilies: [{ family: 'Noto Sans', weight: 9000, usage: 'body' }],
      borderRadii: [4],
      spacingScale: [8, 16],
      hasGradients: false,
      hasGlow: false,
      logoCandidates,
      maxHeadingSizePx: 48,
      bodySizePx: 16,
    },
    links: [],
    statusCode: 200,
    capturedAt: new Date().toISOString(),
  };
}

describe('the brand logo', () => {
  it('is the candidate with the most evidence, even when a weaker one is vector', () => {
    const brand = extractBrandSystem({
      organizationId: 'org_1',
      name: 'KDE',
      captures: [
        capture([
          { src: '/aether/kde-logo.png', alt: '', width: 120, height: 32, score: 9 },
          { src: '/aether/decoration.svg', alt: '', width: 40, height: 40, score: 1 },
        ]),
      ],
    });
    expect(brand.logo?.url).toBe('https://kde.org/aether/kde-logo.png');
  });

  it('never is a copied sprite icon that draws nothing — from a capture made before the probe knew better', () => {
    const brand = extractBrandSystem({
      organizationId: 'org_1',
      name: 'KDE',
      captures: [capture([{ src: SPRITE_GLASS, alt: 'Search', width: 20, height: 20 }, { src: '/logo.png', alt: 'KDE', width: 120, height: 32 }])],
    });
    expect(brand.logo?.url).toBe('https://kde.org/logo.png');
    expect(brand.logoVariants.map((logo) => logo.url)).toEqual(['https://kde.org/logo.png']);
  });

  it('loses an inline mark that renders empty, and keeps one at an address for the render to check', async () => {
    const brand = extractBrandSystem({
      organizationId: 'org_1',
      name: 'KDE',
      captures: [capture([{ src: INVISIBLE, alt: '', width: 64, height: 64, score: 5 }, { src: '/logo.svg', alt: 'KDE', width: 120, height: 32, score: 4 }])],
    });
    expect(brand.logo?.url).toBe(INVISIBLE);
    const kept = await keepDrawnLogos(brand);
    expect(kept.logo?.url).toBe('https://kde.org/logo.svg');
    expect(kept.logoVariants.map((logo) => logo.url)).toEqual(['https://kde.org/logo.svg']);
  });
});
