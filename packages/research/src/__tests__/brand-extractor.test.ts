import { describe, it, expect } from 'vitest';
import { contrastRatio, lightness, isNeutral } from '@act-one/design';
import type { PageCapture, StyleProfile } from '@act-one/providers';
import { extractBrandSystem, resolveTypeColors } from '../index.ts';

function profile(over: Partial<StyleProfile> = {}): StyleProfile {
  return {
    colorWeights: [
      { color: '#ffffff', weight: 900_000, role: 'background' },
      { color: '#0a0a0c', weight: 22_000, role: 'text' },
      { color: '#2f6fed', weight: 14_000, role: 'accent' },
    ],
    fontFamilies: [
      { family: 'Söhne', weight: 9000, usage: 'display' },
      { family: 'Inter', weight: 4200, usage: 'body' },
      { family: 'JetBrains Mono', weight: 300, usage: 'mono' },
    ],
    borderRadii: [8, 8, 8, 8, 24, 999],
    spacingScale: [8, 16, 24, 24, 32, 48],
    hasGradients: false,
    hasGlow: false,
    logoCandidates: [{ src: '/logo.svg', alt: 'Acme', width: 120, height: 32 }],
    maxHeadingSizePx: 64,
    bodySizePx: 16,
    ...over,
  };
}

function capture(styleProfile: StyleProfile | null, url = 'https://acme.com/'): PageCapture {
  return {
    url,
    title: 'Acme',
    text: 'Acme',
    html: '<html></html>',
    screenshot: null,
    styleProfile,
    links: [],
    statusCode: 200,
    capturedAt: new Date().toISOString(),
  };
}

describe('extractBrandSystem', () => {
  it('picks the accent as primary, not the page background', () => {
    const brand = extractBrandSystem({
      organizationId: 'org_1',
      name: 'Acme',
      captures: [capture(profile())],
    });
    // White covers 900k px of the page; it is true and useless as a brand colour.
    expect(brand.primaryColor).toBe('#2f6fed');
    expect(isNeutral(brand.primaryColor)).toBe(false);
  });

  it('takes the modal radius rather than the mean', () => {
    const brand = extractBrandSystem({
      organizationId: 'org_1',
      name: 'Acme',
      captures: [capture(profile())],
    });
    // 8 appears four times; 24 and 999 are outliers (a pill and an avatar).
    expect(brand.cornerRadiusPx).toBe(8);
    expect(brand.cornerStyle).toBe('subtle');
  });

  it('maps observed families to families we can actually render', () => {
    const brand = extractBrandSystem({
      organizationId: 'org_1',
      name: 'Acme',
      captures: [capture(profile())],
    });
    const display = brand.typography.find((f) => f.role === 'display');
    expect(display?.family).toBe('Söhne');
    expect(display?.renderFamily).toBe('Inter');
    expect(display?.source).toBe('substituted');
    expect(display?.tracking).toBeLessThan(0);
  });

  it('never enables glow or gradient for a brand that does not use them', () => {
    const plain = extractBrandSystem({
      organizationId: 'org_1',
      name: 'Acme',
      captures: [capture(profile())],
    });
    expect(plain.allowsGlow).toBe(false);
    expect(plain.allowsGradient).toBe(false);

    const glowing = extractBrandSystem({
      organizationId: 'org_1',
      name: 'Acme',
      captures: [capture(profile({ hasGlow: true, hasGradients: true }))],
    });
    expect(glowing.allowsGlow).toBe(true);
    expect(glowing.allowsGradient).toBe(true);
  });

  it('derives a dark canvas that is genuinely dark and brand-tinted', () => {
    const brand = extractBrandSystem({
      organizationId: 'org_1',
      name: 'Acme',
      captures: [capture(profile())],
    });
    expect(lightness(brand.canvasDark)).toBeLessThan(0.25);
    expect(contrastRatio(brand.canvasDark, '#ffffff')).toBeGreaterThan(10);
    // Tinted, not a generic near-black.
    expect(brand.canvasDark).not.toBe('#000000');
  });

  it('classifies an editorial brand from its measured type scale and spacing', () => {
    const brand = extractBrandSystem({
      organizationId: 'org_1',
      name: 'Broadsheet',
      captures: [
        capture(
          profile({
            maxHeadingSizePx: 96,
            bodySizePx: 18,
            spacingScale: [40, 48, 56, 64, 72],
            borderRadii: [2, 2, 2],
          }),
        ),
      ],
    });
    expect(brand.visualStyle).toBe('editorial');
    expect(brand.motionStyle).toBe('cinematic');
    expect(brand.layoutDensity).toBe('airy');
  });

  it('prefers SVG logos and absolutises their URLs', () => {
    const brand = extractBrandSystem({
      organizationId: 'org_1',
      name: 'Acme',
      captures: [
        capture(
          profile({
            logoCandidates: [
              { src: '/logo.png', alt: 'Acme', width: 120, height: 32 },
              { src: '/logo.svg', alt: 'Acme', width: 120, height: 32 },
            ],
          }),
        ),
      ],
    });
    expect(brand.logo?.format).toBe('svg');
    expect(brand.logo?.url).toBe('https://acme.com/logo.svg');
    expect(brand.logo?.aspectRatio).toBeCloseTo(120 / 32);
  });

  it('falls back to a usable system when nothing could be measured', () => {
    const brand = extractBrandSystem({
      organizationId: 'org_1',
      name: 'Acme',
      captures: [capture(null)],
    });
    expect(brand.primaryColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(brand.neutrals.length).toBeGreaterThan(4);
    expect(brand.confirmedByUser).toBe(false);
  });

  it('uses theme-color when it is a real brand colour', () => {
    const brand = extractBrandSystem({
      organizationId: 'org_1',
      name: 'Acme',
      captures: [capture(profile())],
      themeColor: '#ff5a1f',
    });
    expect(brand.primaryColor).toBe('#ff5a1f');
  });

  it('ignores a neutral theme-color rather than making the brand grey', () => {
    const brand = extractBrandSystem({
      organizationId: 'org_1',
      name: 'Acme',
      captures: [capture(profile())],
      themeColor: '#ffffff',
    });
    expect(brand.primaryColor).toBe('#2f6fed');
  });
});

describe('resolveTypeColors', () => {
  it('guarantees legible type on both canvases', () => {
    const brand = extractBrandSystem({
      organizationId: 'org_1',
      name: 'Acme',
      captures: [capture(profile())],
    });
    const colors = resolveTypeColors(brand);

    for (const [key, value] of Object.entries(colors.onDark)) {
      expect(contrastRatio(value, brand.canvasDark), `onDark.${key}`).toBeGreaterThanOrEqual(4.4);
    }
    for (const [key, value] of Object.entries(colors.onLight)) {
      expect(contrastRatio(value, brand.canvasLight), `onLight.${key}`).toBeGreaterThanOrEqual(4.4);
    }
  });
});
