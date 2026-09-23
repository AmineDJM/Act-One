import {
  compositeOver,
  contrastRatio,
  parseCssColor,
  srgbToHex,
  srgbToOklabColor,
  type CssColor,
} from '@act-one/design';
import type { RawColorUsage, RawPalette } from '../probes/palette-probe.ts';
import type { ColorUsage, Palette, PaletteColor, PaletteRoles } from '../schema.ts';

/*
 * How much each kind of paint says about a brand. Backgrounds are most of
 * what a frame is; text is what the eye reads; borders, fills and gradients
 * are accents. Shadows are almost never a brand decision. Renormalised over
 * the usages a page actually has, so a page without gradients is not scored
 * as if it had some.
 */
const USAGE_SHARE: Record<ColorUsage, number> = {
  background: 0.46,
  text: 0.3,
  border: 0.07,
  fill: 0.08,
  stroke: 0.02,
  gradient: 0.06,
  shadow: 0.01,
};

/** Below this alpha a colour is not seen; it is a transparent layer that happens to have a hue. */
const MIN_ALPHA = 0.04;
/** Chroma below which a colour reads as grey. */
const CHROMATIC = 0.035;
/** An accent has to read as a colour, not as a tinted grey. */
const ACCENT_CHROMA = 0.08;
const MAX_COLORS = 48;

type Entry = {
  parsed: CssColor;
  forms: Map<string, number>;
  byUsage: Map<ColorUsage, number>;
  elements: number;
  interactive: boolean;
};

export type BuiltPalette = { palette: Palette; warnings: string[] };

export function buildPalette(raw: RawPalette): BuiltPalette | null {
  const warnings: string[] = [];
  const entries = new Map<string, Entry>();
  const unreadable = new Set<string>();

  for (const use of raw.uses) {
    const parsed = parseCssColor(use.css);
    if (!parsed) {
      unreadable.add(use.css.slice(0, 60));
      continue;
    }
    if (parsed.alpha < MIN_ALPHA) continue;
    const entry =
      entries.get(parsed.hex8) ??
      ({ parsed, forms: new Map(), byUsage: new Map(), elements: 0, interactive: false } satisfies Entry);
    entry.forms.set(use.css, (entry.forms.get(use.css) ?? 0) + use.weight);
    entry.byUsage.set(use.usage, (entry.byUsage.get(use.usage) ?? 0) + use.weight);
    entry.elements += use.elements;
    entry.interactive ||= use.interactive;
    entries.set(parsed.hex8, entry);
  }
  if (unreadable.size > 0) {
    warnings.push(`${unreadable.size} colour value(s) could not be read: ${[...unreadable].slice(0, 5).join(', ')}`);
  }
  if (raw.truncated) warnings.push(`The page has more elements than were measured (${raw.scanned}); the palette is from the first ones.`);

  const canvas = parseCssColor(raw.canvas) ?? parseCssColor('#ffffff')!;
  if (entries.size === 0) {
    // A page that paints nothing still has a canvas; that is its palette.
    entries.set(canvas.hex8, {
      parsed: canvas,
      forms: new Map([[canvas.css, 1]]),
      byUsage: new Map([['background', 1]]),
      elements: 1,
      interactive: false,
    });
    warnings.push('No painted colour was found; the palette is the page canvas alone.');
  }

  // Weights: each colour's share within each usage, blended across usages.
  const totals = new Map<ColorUsage, number>();
  for (const entry of entries.values()) {
    for (const [usage, weight] of entry.byUsage) totals.set(usage, (totals.get(usage) ?? 0) + weight);
  }
  const present = [...totals.keys()];
  const shareSum = present.reduce((sum, usage) => sum + USAGE_SHARE[usage], 0) || 1;
  const scored = [...entries.values()].map((entry) => {
    let weight = 0;
    for (const [usage, value] of entry.byUsage) {
      weight += (value / (totals.get(usage) || 1)) * (USAGE_SHARE[usage] / shareSum);
    }
    return { entry, weight };
  });

  const background = pickBackground(scored, canvas);
  const backdrop = background.parsed.srgb;
  const seen = (entry: Entry): string => srgbToHex(compositeOver(entry.parsed, backdrop));
  const contrast = (entry: Entry): number => contrastRatio(seen(entry), background.parsed.hex);
  const share = (entry: Entry, usage: ColorUsage): number => (entry.byUsage.get(usage) ?? 0) / (totals.get(usage) || 1);
  const distance = (a: Entry, b: Entry): number => {
    const left = srgbToOklabColor(a.parsed.srgb);
    const right = srgbToOklabColor(b.parsed.srgb);
    return Math.hypot(left.l - right.l, left.a - right.a, left.b - right.b);
  };

  const byUsage = (usage: ColorUsage): Entry[] =>
    scored
      .filter(({ entry }) => entry.byUsage.has(usage))
      .sort((a, b) => share(b.entry, usage) - share(a.entry, usage))
      .map(({ entry }) => entry);

  const texts = byUsage('text');
  const foreground =
    texts.find((entry) => contrast(entry) >= 3) ??
    texts[0] ??
    [...entries.values()].sort((a, b) => contrast(b) - contrast(a))[0]!;
  const mutedForeground =
    texts.find(
      (entry) => entry !== foreground && contrast(entry) >= 2.5 && distance(entry, foreground) > 0.03 && share(entry, 'text') >= 0.03,
    ) ?? null;

  const surface =
    byUsage('background').find(
      (entry) =>
        entry !== background && entry.parsed.alpha >= 0.95 && distance(entry, background) > 0.015 && share(entry, 'background') >= 0.015,
    ) ?? null;

  const primary = pickPrimary(raw, entries, scored, background);
  const primaryForeground = primary ? pickPrimaryForeground(raw, entries, primary) : null;
  // An accent is a colour the brand adds, not its ink or its ground.
  const taken = [background, foreground, surface].filter((entry): entry is Entry => entry !== null);
  const accent =
    scored
      .filter(
        ({ entry }) =>
          entry !== primary &&
          entry.parsed.oklch.c >= ACCENT_CHROMA &&
          taken.every((other) => distance(entry, other) > 0.08) &&
          (!primary || distance(entry, primary) > 0.08),
      )
      // Colour a viewer notices: how much of it there is, and how coloured it is.
      .sort((a, b) => b.weight * b.entry.parsed.oklch.c - a.weight * a.entry.parsed.oklch.c)[0]?.entry ?? null;
  const border = byUsage('border').find((entry) => entry.parsed.alpha >= 0.08 && entry !== background) ?? null;

  const roles: PaletteRoles = {
    background: background.parsed.hex8,
    surface: surface?.parsed.hex8 ?? null,
    foreground: foreground.parsed.hex8,
    mutedForeground: mutedForeground?.parsed.hex8 ?? null,
    primary: primary?.parsed.hex8 ?? null,
    primaryForeground: primaryForeground?.parsed.hex8 ?? null,
    accent: accent?.parsed.hex8 ?? null,
    border: border?.parsed.hex8 ?? null,
  };

  // Keep the heaviest colours, and always the ones the roles name.
  const roleKeys = new Set(Object.values(roles).filter((value): value is string => value !== null));
  const ranked = scored.sort((a, b) => b.weight - a.weight);
  const kept = [
    ...ranked.filter(({ entry }) => roleKeys.has(entry.parsed.hex8)),
    ...ranked.filter(({ entry }) => !roleKeys.has(entry.parsed.hex8)),
  ]
    .slice(0, MAX_COLORS)
    .sort((a, b) => b.weight - a.weight);
  const keptWeight = kept.reduce((sum, item) => sum + item.weight, 0) || 1;

  const tokenNames = new Map<string, string[]>();
  const tokens: Palette['tokens'] = [];
  const keptKeys = new Set(kept.map(({ entry }) => entry.parsed.hex8));
  for (const token of raw.tokens) {
    if (!token.color || !/^--[A-Za-z0-9_-]+$/.test(token.name) || token.name.length > 120) continue;
    const parsed = parseCssColor(token.color);
    if (!parsed) continue;
    const usedOnPage = keptKeys.has(parsed.hex8);
    if (tokens.length < 400) tokens.push({ name: token.name, value: token.value.slice(0, 400), resolved: parsed.hex8, usedOnPage });
    if (usedOnPage) tokenNames.set(parsed.hex8, [...(tokenNames.get(parsed.hex8) ?? []), token.name]);
  }

  const colors: PaletteColor[] = kept.map(({ entry, weight }) => {
    const css = [...entry.forms.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    return {
      hex: entry.parsed.hex,
      hex8: entry.parsed.hex8,
      alpha: round(entry.parsed.alpha, 4),
      css: css.slice(0, 200),
      space: entry.parsed.space,
      oklch: {
        l: round(entry.parsed.oklch.l, 4),
        c: round(entry.parsed.oklch.c, 4),
        h: round(entry.parsed.oklch.h, 2) % 360,
      },
      inGamut: entry.parsed.inGamut,
      weight: round(weight / keptWeight, 5),
      usages: [...entry.byUsage.keys()].sort((a, b) => (entry.byUsage.get(b) ?? 0) - (entry.byUsage.get(a) ?? 0)),
      tokens: (tokenNames.get(entry.parsed.hex8) ?? []).sort((a, b) => a.length - b.length).slice(0, 24),
      elements: entry.elements,
      interactive: entry.interactive,
    };
  });

  const gradients: Palette['gradients'] = [];
  const seenGradients = new Set<string>();
  for (const gradient of [...raw.gradients].sort((a, b) => b.area - a.area)) {
    if (gradients.length >= 12 || seenGradients.has(gradient.css)) continue;
    const stops = gradient.stops
      .map((stop) => parseCssColor(stop))
      .filter((stop): stop is CssColor => stop !== null)
      .map((stop) => stop.hex8)
      .slice(0, 16);
    if (stops.length === 0) continue;
    seenGradients.add(gradient.css);
    gradients.push({ css: gradient.css.slice(0, 2000), stops, area: Math.round(gradient.area) });
  }

  const themeColor = raw.themeColor ? parseCssColor(raw.themeColor)?.hex8 ?? null : null;

  return {
    palette: {
      colors,
      roles,
      gradients,
      tokens,
      themeColor,
      scheme: background.parsed.oklch.l < 0.5 ? 'dark' : 'light',
    },
    warnings,
  };
}

function pickBackground(scored: { entry: Entry; weight: number }[], canvas: CssColor): Entry {
  const opaque = scored
    .filter(({ entry }) => entry.byUsage.has('background') && entry.parsed.alpha >= 0.95)
    .sort((a, b) => (b.entry.byUsage.get('background') ?? 0) - (a.entry.byUsage.get('background') ?? 0));
  return (
    opaque[0]?.entry ??
    scored.find(({ entry }) => entry.parsed.hex8 === canvas.hex8)?.entry ??
    scored[0]!.entry
  );
}

/**
 * The brand colour is the one on its buttons.
 *
 * Painted area would return the page background, and weight alone returned a
 * highlight used once. A call to action is where a brand spends its colour on
 * purpose, so the painted background of interactive elements decides first,
 * by area; the design tokens, the theme colour and plain chroma follow, in
 * that order, for pages whose buttons are all neutral.
 */
function pickPrimary(
  raw: RawPalette,
  entries: Map<string, Entry>,
  scored: { entry: Entry; weight: number }[],
  background: Entry,
): Entry | null {
  const areaByColor = new Map<string, number>();
  for (const pair of raw.pairs) {
    const parsed = parseCssColor(pair.background);
    if (!parsed || parsed.alpha < 0.9 || parsed.oklch.c < CHROMATIC) continue;
    areaByColor.set(parsed.hex8, (areaByColor.get(parsed.hex8) ?? 0) + pair.area);
  }
  const fromButtons = [...areaByColor.entries()].sort((a, b) => b[1] - a[1])[0];
  if (fromButtons && entries.has(fromButtons[0])) return entries.get(fromButtons[0])!;

  const chromatic = (entry: Entry): boolean => entry.parsed.oklch.c >= CHROMATIC && entry !== background;
  const interactive = scored
    .filter(({ entry }) => entry.interactive && chromatic(entry))
    .sort((a, b) => b.weight - a.weight)[0];
  if (interactive) return interactive.entry;

  for (const token of raw.tokens) {
    if (!token.color || !/(^|-)(primary|brand|accent)(-|$)/i.test(token.name.slice(2))) continue;
    const parsed = parseCssColor(token.color);
    const entry = parsed ? entries.get(parsed.hex8) : undefined;
    if (entry && chromatic(entry)) return entry;
  }

  if (raw.themeColor) {
    const parsed = parseCssColor(raw.themeColor);
    const entry = parsed ? entries.get(parsed.hex8) : undefined;
    if (entry && chromatic(entry)) return entry;
  }

  return scored.filter(({ entry, weight }) => chromatic(entry) && weight >= 0.01).sort((a, b) => b.entry.parsed.oklch.c - a.entry.parsed.oklch.c)[0]?.entry ?? null;
}

function pickPrimaryForeground(raw: RawPalette, entries: Map<string, Entry>, primary: Entry): Entry | null {
  const votes = new Map<string, number>();
  for (const pair of raw.pairs) {
    const background = parseCssColor(pair.background);
    const color = parseCssColor(pair.color);
    if (!background || !color || background.hex8 !== primary.parsed.hex8) continue;
    votes.set(color.hex8, (votes.get(color.hex8) ?? 0) + pair.area);
  }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? (entries.get(best[0]) ?? null) : null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export type { RawColorUsage };
