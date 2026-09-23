import { describe, expect, it } from 'vitest';
import { renderContactSheet } from '../contact-sheet.ts';
import { BrandIngestion } from '../schema.ts';

const HOSTILE = '</style><script>alert(1)</script><img src=x onerror=alert(2)>';

function manifest() {
  return BrandIngestion.parse({
    schemaVersion: 1,
    id: 'ing_abc123',
    organizationId: 'org_1',
    projectId: 'prj_1',
    sourceUrl: 'https://brand.example/',
    finalUrl: 'https://brand.example/',
    title: HOSTILE,
    lang: 'en',
    capturedAt: new Date().toISOString(),
    durationMs: 10,
    provider: 'browserbase',
    sessionId: 's',
    viewport: { width: 1440, height: 900 },
    palette: {
      colors: [
        {
          hex: '#3981f6', hex8: '#3981f6ff', alpha: 1, css: HOSTILE.slice(0, 200), space: 'oklch',
          oklch: { l: 0.62, c: 0.19, h: 259.8 }, inGamut: true, weight: 1, usages: ['background'],
          tokens: [HOSTILE.slice(0, 100)], elements: 1, interactive: true,
        },
      ],
      roles: { background: '#3981f6ff', surface: null, foreground: '#3981f6ff', mutedForeground: null, primary: '#3981f6ff', primaryForeground: null, accent: null, border: null },
      gradients: [],
      tokens: [],
      themeColor: null,
      scheme: 'light',
    },
    typography: {
      roles: [
        {
          role: 'display', stack: [HOSTILE.slice(0, 150)], rendered: { family: HOSTILE.slice(0, 150), postScriptName: null, isWebFont: true },
          weight: 700, style: 'normal', sizePx: 72, lineHeight: 1, letterSpacingEm: -0.03, textTransform: 'none', color: null, sample: HOSTILE.slice(0, 150),
        },
      ],
      faces: [],
      missing: [{ family: HOSTILE.slice(0, 150), reason: HOSTILE }],
    },
    logo: null,
    logoAlternates: [],
    captures: [],
    assets: [],
    diagnostics: { warnings: [HOSTILE], blockedRequests: [{ url: HOSTILE, reason: HOSTILE.slice(0, 200) }], stages: [] },
  });
}

describe('renderContactSheet', () => {
  it('never lets text from a website into the page as markup', () => {
    const html = renderContactSheet(manifest());
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
    expect(html.match(/<\/style>/g)).toHaveLength(1);
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders a sheet for a run that found nothing without failing', () => {
    const empty = { ...manifest(), palette: null, typography: null };
    expect(renderContactSheet(empty)).toContain('None measured.');
  });
});
