import { BrandSystem as BrandSystemSchema, motionPersonalityFor, newId, type BrandLogo, type BrandSystem, type BrandFont, type CornerStyle, type MotionStyle, type VisualStyle } from '@act-one/core';
import {
  contrastRatio,
  dedupeColors,
  ensureContrast,
  isDark,
  isNeutral,
  lightness,
  chroma,
  neutralRamp,
  withLightness,
} from '@act-one/design';
import type { PageCapture, StyleProfile } from '@act-one/providers';
import { absolutize } from './url.ts';

/**
 * Brand DNA from measurement.
 *
 * Every value here is derived from what the browser actually painted. No model
 * is asked what the brand "feels like" — that produces a plausible near-miss,
 * and a near-miss on radius, tracking or accent hue is precisely what makes an
 * automated film read as a template. The only inference is style *labelling*
 * (is this editorial or brutalist), and that is decided by thresholds on
 * measured values, not vibes.
 */
export type BrandExtractionInput = {
  organizationId: string;
  name: string;
  captures: PageCapture[];
  /** theme-color meta and og:image, which often carry the truest brand colour. */
  themeColor?: string | null;
};

export function extractBrandSystem(input: BrandExtractionInput): BrandSystem {
  const profiles = input.captures
    .map((capture) => capture.styleProfile)
    .filter((profile): profile is StyleProfile => profile !== null);

  const now = new Date().toISOString();
  if (profiles.length === 0) {
    return neutralFallback(input, now);
  }

  const colors = aggregateColors(profiles, input.themeColor ?? null);
  const typography = aggregateTypography(profiles);
  const radii = aggregateRadii(profiles);
  const spacing = aggregateSpacing(profiles);
  const hasGradients = profiles.some((p) => p.hasGradients);
  const hasGlow = profiles.some((p) => p.hasGlow);

  const cornerStyle = cornerStyleFor(radii.base);
  const visualStyle = visualStyleFor({
    radius: radii.base,
    spacing: spacing.median,
    accentChroma: chroma(colors.primary),
    headingScale: aggregateHeadingScale(profiles),
    hasGradients,
    fontCount: typography.length,
  });

  const canvasDark = deriveDarkCanvas(colors.primary, colors.backgrounds);
  const canvasLight = colors.backgrounds.find((c) => !isDark(c)) ?? '#ffffff';

  // Parsed on the way out so every field the schema has since grown is
  // present with its default, whatever this function was written to set.
  return BrandSystemSchema.parse({
    id: newId('brd'),
    organizationId: input.organizationId,
    name: input.name,
    logo: pickLogo(input.captures),
    logoVariants: allLogos(input.captures),
    primaryColor: colors.primary,
    secondaryColor: colors.secondary,
    accentColors: colors.accents,
    primaryCandidates: colors.candidates,
    neutrals: neutralRamp(colors.primary, 9, 0.05),
    canvasDark,
    canvasLight,
    typography,
    visualStyle,
    imageTreatment: hasGradients ? 'high_contrast' : 'none',
    iconography: iconographyFor(profiles),
    imageryStyle: imageryStyleFor(profiles),
    imagerySubjects: imagerySubjectsFor(profiles),
    faviconUrl: faviconFor(input.captures),
    layoutDensity: spacing.median >= 48 ? 'airy' : spacing.median <= 20 ? 'dense' : 'balanced',
    cornerStyle,
    cornerRadiusPx: radii.base,
    motionStyle: motionStyleFor(visualStyle, cornerStyle),
    motionPersonality: motionPersonalityFor(motionStyleFor(visualStyle, cornerStyle)),
    tone: toneFor(visualStyle),
    // Only brands that already use glow get glow. Adding it is the fastest way
    // to make a film look generated.
    allowsGlow: hasGlow,
    allowsGradient: hasGradients,
    confirmedByUser: false,
    sources: input.captures.map((c) => c.url),
    createdAt: now,
    updatedAt: now,
  });
}

function aggregateColors(
  profiles: StyleProfile[],
  themeColor: string | null,
): {
  primary: string;
  secondary: string;
  accents: string[];
  backgrounds: string[];
  candidates: string[];
} {
  const weights = new Map<
    string,
    { background: number; text: number; accent: number; pages: Set<number> }
  >();

  profiles.forEach((profile, pageIndex) => {
    for (const entry of profile.colorWeights) {
      const color = entry.color.toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(color)) continue;
      const current = weights.get(color) ?? {
        background: 0,
        text: 0,
        accent: 0,
        pages: new Set<number>(),
      };
      current[entry.role] += entry.weight;
      current.pages.add(pageIndex);
      weights.set(color, current);
    }
  });

  const entries = [...weights.entries()];
  const backgrounds = entries
    .filter(([, w]) => w.background > 0)
    .sort((a, b) => b[1].background - a[1].background)
    .map(([color]) => color);

  /**
   * Which colour is *the* brand colour.
   *
   * Ranking by painted area returns the page background — true and useless, so
   * neutrals are excluded. Ranking the remainder by weight alone is what the
   * first version did, and on a real site it returned a highlight yellow used
   * on one badge instead of the indigo used on every button on every page.
   *
   * Consistency across pages is the signal that actually separates a brand
   * colour from an accent: a brand colour is everywhere, a highlight is
   * somewhere. So presence across pages dominates, and weight breaks ties.
   */
  const pageCount = Math.max(1, profiles.length);
  const maxWeight = Math.max(
    1,
    ...entries.map(([, w]) => w.accent * 3 + w.text),
  );

  const scored = entries
    .filter(([color]) => !isNeutral(color))
    .map(([color, w]) => {
      const presence = w.pages.size / pageCount;
      const weight = (w.accent * 3 + w.text) / maxWeight;
      return { color, score: presence ** 1.5 * 0.7 + weight * 0.3, presence };
    })
    .sort((a, b) => b.score - a.score);

  const themeIsUsable =
    themeColor !== null && /^#[0-9a-f]{6}$/i.test(themeColor) && !isNeutral(themeColor);

  const candidates = dedupeColors(
    [...(themeIsUsable ? [themeColor.toLowerCase()] : []), ...scored.map((s) => s.color)],
    0.08,
  );

  const primary = candidates[0] ?? '#2f6fed';
  const secondary =
    candidates.find((c) => Math.abs(lightness(c) - lightness(primary)) > 0.12) ??
    withLightness(primary, isDark(primary) ? 0.72 : 0.34);

  return {
    primary,
    secondary,
    accents: candidates.slice(1, 5),
    backgrounds: dedupeColors(backgrounds, 0.04).slice(0, 4),
    candidates: candidates.slice(0, 5),
  };
}

/**
 * Maps observed families onto families we can actually render with.
 *
 * Substitution is metric-driven rather than name-driven: what matters for
 * typographic weight on screen is x-height, width and terminal style, not
 * whether the name matches. A wrong-but-close substitute set at the brand's
 * own tracking reads far better than a "correct" family we cannot license.
 */
const RENDERABLE_SUBSTITUTES: { match: RegExp; render: string; tracking: number }[] = [
  { match: /inter|geist|general sans|satoshi|switzer/i, render: 'Inter', tracking: -0.022 },
  { match: /helvetica|arial|neue haas|aktiv|suisse/i, render: 'Inter', tracking: -0.018 },
  { match: /sf pro|-apple-system|system-ui|segoe/i, render: 'Inter', tracking: -0.02 },
  { match: /roboto|open sans|noto sans|lato|source sans/i, render: 'Inter', tracking: -0.012 },
  { match: /graphik|founders|neue montreal|basis|söhne|sohne/i, render: 'Inter', tracking: -0.026 },
  { match: /georgia|times|garamond|freight|tiempos|canela|ivy/i, render: 'Source Serif 4', tracking: -0.005 },
  { match: /playfair|didot|bodoni/i, render: 'Playfair Display', tracking: -0.01 },
  { match: /mono|code|courier|consolas|menlo|jetbrains|ibm plex mono/i, render: 'JetBrains Mono', tracking: 0 },
  { match: /space grotesk|grotesk|druk|archivo/i, render: 'Space Grotesk', tracking: -0.03 },
];

function aggregateTypography(profiles: StyleProfile[]): BrandFont[] {
  const usage = new Map<string, { weight: number; usage: 'display' | 'body' | 'mono' }>();
  for (const profile of profiles) {
    for (const font of profile.fontFamilies) {
      const key = font.family.trim();
      if (!key) continue;
      const current = usage.get(key) ?? { weight: 0, usage: font.usage };
      current.weight += font.weight;
      // Display wins ties: a family used once at 72px defines the brand more
      // than the same family used everywhere at 14px.
      if (font.usage === 'display') current.usage = 'display';
      else if (current.usage !== 'display') current.usage = font.usage;
      usage.set(key, current);
    }
  }

  const ranked = [...usage.entries()].sort((a, b) => b[1].weight - a[1].weight);
  const fonts: BrandFont[] = [];

  const build = (family: string, role: BrandFont['role']): BrandFont => {
    const substitute = RENDERABLE_SUBSTITUTES.find((s) => s.match.test(family));
    return {
      role,
      family,
      renderFamily: substitute?.render ?? 'Inter',
      weights: role === 'display' ? [600, 700] : role === 'mono' ? [400, 500] : [400, 500, 600],
      tracking: substitute?.tracking ?? (role === 'display' ? -0.025 : -0.01),
      source: substitute && new RegExp(substitute.render, 'i').test(family) ? 'observed' : 'substituted',
      webfontUrl: null,
    };
  };

  const display = ranked.find(([, v]) => v.usage === 'display')?.[0] ?? ranked[0]?.[0];
  const body = ranked.find(([family, v]) => v.usage === 'body' && family !== display)?.[0] ?? display;
  const mono = ranked.find(([, v]) => v.usage === 'mono')?.[0];

  if (display) fonts.push(build(display, 'display'));
  if (body) fonts.push(build(body, 'body'));
  if (mono) fonts.push(build(mono, 'mono'));
  return fonts;
}

function aggregateRadii(profiles: StyleProfile[]): { base: number; all: number[] } {
  const all = profiles.flatMap((p) => p.borderRadii).filter((r) => r > 0 && r <= 64);
  if (all.length === 0) return { base: 0, all: [] };
  // Mode, not mean: brands use one radius for almost everything plus a few
  // outliers (pills, avatars). Averaging turns 8px into 14px.
  const counts = new Map<number, number>();
  for (const radius of all) counts.set(radius, (counts.get(radius) ?? 0) + 1);
  const base = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
  return { base, all };
}

function aggregateSpacing(profiles: StyleProfile[]): { median: number; scale: number[] } {
  const all = profiles.flatMap((p) => p.spacingScale).filter((s) => s >= 4 && s <= 160).sort((a, b) => a - b);
  if (all.length === 0) return { median: 24, scale: [8, 16, 24, 32, 48] };
  return { median: all[Math.floor(all.length / 2)]!, scale: [...new Set(all)] };
}

function aggregateHeadingScale(profiles: StyleProfile[]): number {
  const ratios = profiles
    .filter((p) => p.bodySizePx > 0 && p.maxHeadingSizePx > 0)
    .map((p) => p.maxHeadingSizePx / p.bodySizePx);
  if (ratios.length === 0) return 2.5;
  return ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
}

function cornerStyleFor(radius: number): CornerStyle {
  if (radius <= 2) return 'sharp';
  if (radius <= 8) return 'subtle';
  if (radius <= 20) return 'rounded';
  return 'pill';
}

function visualStyleFor(signals: {
  radius: number;
  spacing: number;
  accentChroma: number;
  headingScale: number;
  hasGradients: boolean;
  fontCount: number;
}): VisualStyle {
  // Thresholds, in priority order. Each corresponds to something a designer
  // would actually name from looking at the page.
  if (signals.radius === 0 && signals.headingScale >= 3.4) return 'brutalist';
  if (signals.headingScale >= 3.2 && signals.spacing >= 40) return 'editorial';
  if (signals.accentChroma >= 0.16 && signals.hasGradients) return 'bold';
  if (signals.radius >= 20 && signals.accentChroma >= 0.12) return 'playful';
  if (signals.accentChroma <= 0.05 && signals.spacing >= 36) return 'luxury';
  if (signals.radius <= 6 && signals.accentChroma <= 0.12) return 'technical';
  if (signals.spacing <= 18) return 'corporate';
  return 'minimal';
}

function motionStyleFor(visualStyle: VisualStyle, corner: CornerStyle): MotionStyle {
  switch (visualStyle) {
    case 'brutalist':
      return 'mechanical';
    case 'editorial':
    case 'luxury':
      return 'cinematic';
    case 'playful':
      return 'fluid';
    case 'bold':
      return 'snappy';
    case 'technical':
      return 'precise';
    default:
      return corner === 'pill' ? 'fluid' : 'precise';
  }
}

function toneFor(visualStyle: VisualStyle): string {
  const tones: Record<VisualStyle, string> = {
    minimal: 'Plain-spoken and confident. Short sentences. No adjectives it has not earned.',
    editorial: 'Considered and declarative. Writes in statements, not slogans.',
    technical: 'Precise and unembellished. Speaks to people who read docs.',
    bold: 'Direct and high-energy. Leads with the claim.',
    luxury: 'Restrained and assured. Says less than it could.',
    playful: 'Warm and human. Comfortable being informal.',
    brutalist: 'Blunt. Declarative. Unapologetic.',
    corporate: 'Clear and businesslike. Benefit first, proof immediately after.',
  };
  return tones[visualStyle];
}

/**
 * A dark canvas that belongs to the brand rather than a generic near-black.
 * Brand-tinted darks are one of the cheapest ways a film reads as bespoke.
 */
function deriveDarkCanvas(primary: string, backgrounds: string[]): string {
  const existingDark = backgrounds.find((c) => lightness(c) < 0.22);
  if (existingDark) return existingDark;
  const tinted = withLightness(primary, 0.11);
  // Keep it genuinely dark enough for white type to sit comfortably.
  return contrastRatio(tinted, '#ffffff') >= 12 ? tinted : withLightness(primary, 0.08);
}

function pickLogo(captures: PageCapture[]): BrandLogo | null {
  return allLogos(captures)[0] ?? null;
}

function allLogos(captures: PageCapture[]): BrandLogo[] {
  const logos: BrandLogo[] = [];
  for (const capture of captures) {
    for (const candidate of capture.styleProfile?.logoCandidates ?? []) {
      const url = absolutize(capture.url, candidate.src);
      if (!url) continue;
      // Inline marks arrive as data URLs, which carry their type in the
      // prefix rather than a file extension — and they are the ones we most
      // want to identify, because vector is what survives a 4K logo reveal.
      const format = /^data:image\/svg\+xml/i.test(url) || /\.svg(\?|$)/i.test(url)
        ? 'svg'
        : /^data:image\/png/i.test(url) || /\.png(\?|$)/i.test(url)
          ? 'png'
          : /^data:image\/jpe?g/i.test(url) || /\.jpe?g(\?|$)/i.test(url)
            ? 'jpg'
            : 'unknown';
      logos.push({
        assetId: null,
        url,
        background: 'any',
        format,
        aspectRatio: candidate.height > 0 ? candidate.width / candidate.height : 1,
      });
    }
  }
  // SVG first: it is the only format that survives a 4K logo reveal.
  return dedupeLogos(logos).sort((a, b) => (a.format === 'svg' ? -1 : 0) - (b.format === 'svg' ? -1 : 0));
}

function dedupeLogos(logos: BrandLogo[]): BrandLogo[] {
  const seen = new Set<string>();
  return logos.filter((logo) => {
    const key = logo.url ?? '';
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function neutralFallback(input: BrandExtractionInput, now: string): BrandSystem {
  const primary = '#2f6fed';
  return BrandSystemSchema.parse({
    id: newId('brd'),
    organizationId: input.organizationId,
    name: input.name,
    logo: null,
    logoVariants: [],
    primaryColor: primary,
    secondaryColor: withLightness(primary, 0.72),
    accentColors: [],
    primaryCandidates: [primary],
    neutrals: neutralRamp(primary, 9, 0.04),
    canvasDark: '#07070a',
    canvasLight: '#ffffff',
    typography: [],
    visualStyle: 'minimal',
    imageTreatment: 'none',
    layoutDensity: 'balanced',
    cornerStyle: 'subtle',
    cornerRadiusPx: 10,
    motionStyle: 'precise',
    tone: 'Plain-spoken and confident.',
    allowsGlow: false,
    allowsGradient: false,
    confirmedByUser: false,
    sources: input.captures.map((c) => c.url),
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Guarantees the type colours a film will actually use are legible on the
 * canvases it will actually use. Runs after extraction so the stored brand is
 * already safe, rather than relying on every render path to remember.
 */
export function resolveTypeColors(brand: BrandSystem): {
  onDark: { primary: string; secondary: string; accent: string };
  onLight: { primary: string; secondary: string; accent: string };
} {
  const neutralsLight = brand.neutrals.slice(-3);
  const neutralsDark = brand.neutrals.slice(0, 3);
  return {
    onDark: {
      primary: neutralsLight[neutralsLight.length - 1] ?? '#ffffff',
      secondary: ensureContrast(neutralsLight[0] ?? '#c9c9d1', brand.canvasDark, 4.5),
      accent: ensureContrast(brand.primaryColor, brand.canvasDark, 4.5),
    },
    onLight: {
      primary: neutralsDark[0] ?? '#0a0a0c',
      secondary: ensureContrast(neutralsDark[2] ?? '#3d3d45', brand.canvasLight, 4.5),
      accent: ensureContrast(brand.primaryColor, brand.canvasLight, 4.5),
    },
  };
}

// --- icons, pictures, the favicon, and motion in a sentence --------------------

function iconographyFor(profiles: StyleProfile[]): BrandSystem['iconography'] {
  let outline = 0;
  let filled = 0;
  for (const profile of profiles) {
    outline += profile.iconography?.outline ?? 0;
    filled += profile.iconography?.filled ?? 0;
  }
  const total = outline + filled;
  if (total < 3) return 'none';
  if (outline / total >= 0.75) return 'outline';
  if (filled / total >= 0.75) return 'filled';
  return 'mixed';
}

function imageryStyleFor(profiles: StyleProfile[]): BrandSystem['imageryStyle'] {
  let photos = 0;
  let illustrations = 0;
  let screenshots = 0;
  for (const profile of profiles) {
    photos += profile.imagery?.photos ?? 0;
    illustrations += profile.imagery?.illustrations ?? 0;
    screenshots += profile.imagery?.screenshots ?? 0;
  }
  const total = photos + illustrations + screenshots;
  if (total === 0) return 'none';
  const share = (count: number) => count / total;
  if (share(screenshots) >= 0.6) return 'ui_only';
  if (share(photos) >= 0.6) return 'photography';
  if (share(illustrations) >= 0.6) return 'illustration';
  return 'mixed';
}

function imagerySubjectsFor(profiles: StyleProfile[]): string[] {
  const subjects: string[] = [];
  for (const profile of profiles) {
    for (const subject of profile.imagery?.subjects ?? []) {
      const clean = subject.trim().slice(0, 80);
      if (clean && !subjects.includes(clean)) subjects.push(clean);
      if (subjects.length >= 12) return subjects;
    }
  }
  return subjects;
}

function faviconFor(captures: PageCapture[]): string | null {
  for (const capture of captures) {
    const href = capture.styleProfile?.faviconUrl ?? null;
    if (href && /^https?:\/\//.test(href)) return href;
    const declared = capture.html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/i)?.[1];
    if (declared) {
      const absolute = absolutize(capture.url, declared);
      if (absolute) return absolute;
    }
  }
  return null;
}

