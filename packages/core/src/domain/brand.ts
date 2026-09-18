import { z } from 'zod';
import { hexColor, urlString, nonEmpty } from '../zod-helpers.ts';

/**
 * Brand DNA.
 *
 * Extracted primarily by *measuring* the customer's site (computed styles,
 * rendered colour frequency, radii, spacing rhythm) rather than by asking a
 * model what it thinks the brand looks like. Measurement is reproducible;
 * vibes are not, and a film that is 4px off the brand's corner radius reads as
 * a template.
 */
export const VisualStyle = z.enum([
  'minimal',
  'editorial',
  'technical',
  'bold',
  'luxury',
  'playful',
  'brutalist',
  'corporate',
]);
export type VisualStyle = z.infer<typeof VisualStyle>;

export const MotionStyle = z.enum([
  'precise',       // short, confident, near-linear easing. Stripe/Linear.
  'fluid',         // long spring-ish arcs
  'snappy',        // fast in, hard stop
  'cinematic',     // slow push, long holds
  'mechanical',    // stepped, grid-locked
]);
export type MotionStyle = z.infer<typeof MotionStyle>;

export const CornerStyle = z.enum(['sharp', 'subtle', 'rounded', 'pill']);
export type CornerStyle = z.infer<typeof CornerStyle>;

export const LayoutDensity = z.enum(['airy', 'balanced', 'dense']);
export type LayoutDensity = z.infer<typeof LayoutDensity>;

export const ImageTreatment = z.enum([
  'none',
  'duotone',
  'desaturated',
  'high_contrast',
  'warm_film',
  'cool_clinical',
]);
export type ImageTreatment = z.infer<typeof ImageTreatment>;

export const FontRole = z.enum(['display', 'body', 'mono']);

export const BrandFont = z.object({
  role: FontRole,
  /** Family as observed on the site. */
  family: nonEmpty(120),
  /** A licensed family we can actually render with, chosen to match metrics. */
  renderFamily: nonEmpty(120),
  weights: z.array(z.number().int().min(100).max(900)).default([400, 600]),
  /** Observed letter-spacing at display sizes, in em. */
  tracking: z.number().min(-0.1).max(0.4).default(-0.02),
  source: z.enum(['observed', 'declared', 'substituted', 'user']).default('observed'),
  webfontUrl: urlString.nullable().default(null),
});
export type BrandFont = z.infer<typeof BrandFont>;

/** How the brand draws its icons, measured from the inline SVGs on the page. */
export const Iconography = z.enum(['outline', 'filled', 'duotone', 'mixed', 'none']);
export type Iconography = z.infer<typeof Iconography>;

/** What kind of pictures the brand puts on its pages. */
export const ImageryStyle = z.enum(['photography', 'illustration', 'three_d', 'ui_only', 'abstract', 'mixed', 'none']);
export type ImageryStyle = z.infer<typeof ImageryStyle>;

/**
 * How the brand speaks.
 *
 * Read from the site's own copy: the words it reaches for, the way it names
 * itself and its things, the line it leads with, and what it never says. A
 * film that says "AI-powered" about a company that never does is off-brand
 * in a way no colour can fix.
 */
export const BrandCommunication = z.object({
  /** ISO 639-1 code of the site's own copy; empty when not established. */
  language: z.string().max(12).default(''),
  /** Words and phrases the brand uses again and again, as it writes them. */
  vocabulary: z.array(nonEmpty(60)).max(24).default([]),
  /** The one sentence the brand positions itself with, in its own terms. */
  positioning: z.string().max(300).default(''),
  /** What the brand claims about itself, verbatim from its pages. */
  claims: z.array(nonEmpty(200)).max(12).default([]),
  /** How the product, the company and their things are named. */
  naming: z.string().max(240).default(''),
  /** The site's own tagline, verbatim, when it has one. */
  tagline: z.string().max(160).default(''),
  /** Words the brand visibly avoids, or that would clash with its register. */
  wordsToAvoid: z.array(nonEmpty(60)).max(24).default([]),
});
export type BrandCommunication = z.infer<typeof BrandCommunication>;

/**
 * Something a later reading found that differs from what the brand says.
 *
 * Never applied on its own. A person is told "we found new brand signals",
 * sees each one — what the brand has, what was measured, where — and
 * accepts or dismisses it. A rebrand becomes a review, not a surprise.
 */
export const BrandSignalStatus = z.enum(['pending', 'accepted', 'dismissed']);
export type BrandSignalStatus = z.infer<typeof BrandSignalStatus>;

export const BrandSignal = z.object({
  id: z.string(),
  /** Which value: `primaryColor`, `typography.display`, `communication.tagline`… */
  field: z.string(),
  label: z.string(),
  current: z.unknown(),
  proposed: z.unknown(),
  reason: z.string().max(300),
  sourceUrl: urlString.nullable().default(null),
  /** The project whose reading found it. */
  projectId: z.string().nullable().default(null),
  foundAt: z.string(),
  status: BrandSignalStatus.default('pending'),
  decidedAt: z.string().nullable().default(null),
});
export type BrandSignal = z.infer<typeof BrandSignal>;

/**
 * Where a mark lives: a page's own address, or the inline SVG the probe
 * serialised into a data URL — most well-built sites ship their logo
 * inline, and the vector is what a 4K logo reveal needs.
 */
export const imageUrlString = z.union([urlString, z.string().regex(/^data:image\/(svg\+xml|png|jpeg|webp|gif)[;,]/, 'Not a usable image address')]);

export const BrandLogo = z.object({
  assetId: z.string().nullable().default(null),
  url: imageUrlString.nullable().default(null),
  /** Rendered against which background this variant is legal. */
  background: z.enum(['light', 'dark', 'any']).default('any'),
  format: z.enum(['svg', 'png', 'jpg', 'unknown']).default('unknown'),
  /** Width / height of the logo's ink, used for optical sizing in the design engine. */
  aspectRatio: z.number().positive().default(1),
});
export type BrandLogo = z.infer<typeof BrandLogo>;

export const BrandSystem = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: nonEmpty(120),
  logo: BrandLogo.nullable().default(null),
  logoVariants: z.array(BrandLogo).default([]),
  primaryColor: hexColor,
  secondaryColor: hexColor,
  accentColors: z.array(hexColor).default([]),
  /**
   * Other colours that could legitimately be the brand's primary, best first.
   *
   * Some brands genuinely have two: an established mark colour and a newer
   * highlight, both used everywhere. No amount of measurement resolves that,
   * and guessing confidently is worse than asking — so the confirmation screen
   * offers these as one-click swaps instead of pretending we were sure.
   */
  primaryCandidates: z.array(hexColor).default([]),
  neutrals: z.array(hexColor).default([]),
  /** Film background. Dark films are the default for launch, but only if the brand allows it. */
  canvasDark: hexColor.default('#07070a'),
  canvasLight: hexColor.default('#ffffff'),
  typography: z.array(BrandFont).default([]),
  visualStyle: VisualStyle.default('minimal'),
  imageTreatment: ImageTreatment.default('none'),
  layoutDensity: LayoutDensity.default('balanced'),
  cornerStyle: CornerStyle.default('subtle'),
  /** Base radius in px at 1920 width, measured from the site. */
  cornerRadiusPx: z.number().min(0).max(64).default(10),
  motionStyle: MotionStyle.default('precise'),
  tone: nonEmpty(240).default('Confident, plain-spoken, technical.'),
  /** Brands that genuinely use glow; most do not, and faking it is an instant tell. */
  allowsGlow: z.boolean().default(false),
  allowsGradient: z.boolean().default(false),
  confirmedByUser: z.boolean().default(false),
  sources: z.array(urlString).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),

  // --- the brand belongs to a project ------------------------------------
  /** The project this DNA was measured for. Null for DNA measured before brands belonged to projects. */
  projectId: z.string().nullable().default(null),
  /** The confirmed DNA this one was inherited from, when a later project started from an earlier one. */
  parentBrandId: z.string().nullable().default(null),
  faviconUrl: imageUrlString.nullable().default(null),
  iconography: Iconography.default('none'),
  imageryStyle: ImageryStyle.default('none'),
  /** What the pictures show: "people at work", "the interface", "abstract shapes". */
  imagerySubjects: z.array(nonEmpty(80)).max(12).default([]),
  /** The motion style in a sentence, for a person: "Short and certain; nothing bounces." */
  motionPersonality: z.string().max(240).default(''),
  communication: BrandCommunication.default(() => BrandCommunication.parse({})),
  /** Components a person edited by hand. A later reading may propose; it never overwrites these. */
  overrides: z.array(z.string()).default([]),
  signals: z.array(BrandSignal).default([]),
  confirmedAt: z.string().nullable().default(null),
});
export type BrandSystem = z.infer<typeof BrandSystem>;

// --- the brand as components -------------------------------------------------

/**
 * The DNA as a person reads and confirms it: eight components, each measured,
 * each editable, each ticked off on its own. Everything in the schema above
 * belongs to exactly one of them.
 */
export const BRAND_COMPONENTS = [
  { key: 'logo', label: 'Logo & favicon' },
  { key: 'colors', label: 'Colours' },
  { key: 'typography', label: 'Typography' },
  { key: 'layout', label: 'Density & corners' },
  { key: 'iconography', label: 'Iconography' },
  { key: 'imagery', label: 'Imagery' },
  { key: 'communication', label: 'Communication' },
  { key: 'motion', label: 'Motion' },
] as const;
export type BrandComponentKey = (typeof BRAND_COMPONENTS)[number]['key'];
export const BrandComponentKey = z.enum(BRAND_COMPONENTS.map((component) => component.key) as [BrandComponentKey, ...BrandComponentKey[]]);

/** The component a field belongs to, for grouping signals and marking overrides. */
export function componentOfField(field: string): BrandComponentKey {
  if (field === 'logo' || field === 'faviconUrl' || field === 'logoVariants') return 'logo';
  if (/^(primaryColor|secondaryColor|accentColors|neutrals|canvasDark|canvasLight|allowsGlow|allowsGradient)$/.test(field)) return 'colors';
  if (field.startsWith('typography')) return 'typography';
  if (/^(layoutDensity|cornerStyle|cornerRadiusPx|visualStyle)$/.test(field)) return 'layout';
  if (field === 'iconography') return 'iconography';
  if (field.startsWith('imagery') || field === 'imageTreatment') return 'imagery';
  if (field.startsWith('communication') || field === 'tone') return 'communication';
  return 'motion';
}

/** Which brands confirmed for this organisation a new project may start from: the same site first, then the newest. */
export function pickParentBrand(brands: readonly BrandSystem[], host: string): BrandSystem | null {
  const confirmed = brands.filter((brand) => brand.confirmedByUser);
  if (confirmed.length === 0) return null;
  const sameHost = confirmed.filter((brand) => brand.sources.some((url) => hostOf(url) === host));
  const pool = sameHost.length > 0 ? sameHost : confirmed;
  return [...pool].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

type SignalSeed = { field: string; label: string; current: unknown; proposed: unknown; reason: string };

/**
 * What a fresh reading says differently from what the brand holds.
 *
 * Compared value by value, with the tolerance a person would use: a radius
 * two pixels off is the same radius; a different display face is not. Each
 * difference becomes a pending signal. Nothing is changed here.
 */
export function diffBrandSignals(
  current: BrandSystem,
  measured: BrandSystem,
  context: { projectId: string | null; sourceUrl: string | null; now?: string; newId: (prefix: 'bsg') => string },
): BrandSignal[] {
  const seeds: SignalSeed[] = [];
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const font = (brand: BrandSystem, role: 'display' | 'body') => brand.typography.find((entry) => entry.role === role)?.family ?? '';

  if (!same(current.primaryColor, measured.primaryColor)) {
    seeds.push({ field: 'primaryColor', label: 'Primary colour', current: current.primaryColor, proposed: measured.primaryColor, reason: 'The pages now lead with a different colour.' });
  }
  if (!same(current.secondaryColor, measured.secondaryColor)) {
    seeds.push({ field: 'secondaryColor', label: 'Secondary colour', current: current.secondaryColor, proposed: measured.secondaryColor, reason: 'The second colour on the pages has changed.' });
  }
  for (const role of ['display', 'body'] as const) {
    const before = font(current, role);
    const after = font(measured, role);
    if (after && !same(before, after)) {
      seeds.push({ field: `typography.${role}`, label: role === 'display' ? 'Display type' : 'Body type', current: before || null, proposed: after, reason: `The site sets its ${role} text in a different face.` });
    }
  }
  if (Math.abs(current.cornerRadiusPx - measured.cornerRadiusPx) > 2) {
    seeds.push({ field: 'cornerRadiusPx', label: 'Corner radius', current: current.cornerRadiusPx, proposed: measured.cornerRadiusPx, reason: 'The corners measure differently now.' });
  }
  if (current.layoutDensity !== measured.layoutDensity) {
    seeds.push({ field: 'layoutDensity', label: 'Density', current: current.layoutDensity, proposed: measured.layoutDensity, reason: 'The pages are spaced differently.' });
  }
  if (current.visualStyle !== measured.visualStyle) {
    seeds.push({ field: 'visualStyle', label: 'Visual language', current: current.visualStyle, proposed: measured.visualStyle, reason: 'The measured style reads differently.' });
  }
  if (current.motionStyle !== measured.motionStyle) {
    seeds.push({ field: 'motionStyle', label: 'Motion', current: current.motionStyle, proposed: measured.motionStyle, reason: 'The site moves differently.' });
  }
  if (measured.iconography !== 'none' && current.iconography !== measured.iconography) {
    seeds.push({ field: 'iconography', label: 'Iconography', current: current.iconography, proposed: measured.iconography, reason: 'The icons on the pages are drawn differently.' });
  }
  if (measured.imageryStyle !== 'none' && current.imageryStyle !== measured.imageryStyle) {
    seeds.push({ field: 'imageryStyle', label: 'Imagery', current: current.imageryStyle, proposed: measured.imageryStyle, reason: 'The pages carry a different kind of picture.' });
  }
  if (measured.communication.tagline && !same(current.communication.tagline, measured.communication.tagline)) {
    seeds.push({ field: 'communication.tagline', label: 'Tagline', current: current.communication.tagline || null, proposed: measured.communication.tagline, reason: 'The site leads with a different line.' });
  }
  if (measured.communication.naming && !same(current.communication.naming, measured.communication.naming)) {
    seeds.push({ field: 'communication.naming', label: 'Naming', current: current.communication.naming || null, proposed: measured.communication.naming, reason: 'The site names things differently.' });
  }
  if (measured.communication.positioning && !same(current.communication.positioning, measured.communication.positioning)) {
    seeds.push({ field: 'communication.positioning', label: 'Positioning', current: current.communication.positioning || null, proposed: measured.communication.positioning, reason: 'The site positions itself differently.' });
  }
  if (measured.logo?.url && measured.logo.url !== current.logo?.url) {
    seeds.push({ field: 'logo', label: 'Logo', current: current.logo?.url ?? null, proposed: measured.logo.url, reason: 'A different mark is on the pages.' });
  }

  const now = context.now ?? new Date().toISOString();
  return seeds.map((seed) => ({
    ...seed,
    id: context.newId('bsg'),
    sourceUrl: context.sourceUrl,
    projectId: context.projectId,
    foundAt: now,
    status: 'pending' as const,
    decidedAt: null,
  }));
}

/** Adds fresh signals to a brand's list, once each: a value already proposed and still open is not proposed twice. */
export function mergeBrandSignals(existing: readonly BrandSignal[], fresh: readonly BrandSignal[]): BrandSignal[] {
  const open = new Set(existing.filter((signal) => signal.status === 'pending').map((signal) => `${signal.field}:${JSON.stringify(signal.proposed)}`));
  const dismissed = new Set(existing.filter((signal) => signal.status === 'dismissed').map((signal) => `${signal.field}:${JSON.stringify(signal.proposed)}`));
  const additions = fresh.filter((signal) => {
    const key = `${signal.field}:${JSON.stringify(signal.proposed)}`;
    return !open.has(key) && !dismissed.has(key);
  });
  return [...existing, ...additions];
}

/** The change one accepted signal makes to the brand. The component it touches is not marked as a person's override: a person chose the reading, not a value. */
export function applyBrandSignal(brand: BrandSystem, signal: BrandSignal): Partial<BrandSystem> {
  const value = signal.proposed;
  const str = typeof value === 'string' ? value : null;
  switch (signal.field) {
    case 'primaryColor':
      return str ? { primaryColor: str } : {};
    case 'secondaryColor':
      return str ? { secondaryColor: str } : {};
    case 'typography.display':
    case 'typography.body': {
      if (!str) return {};
      const role = signal.field.endsWith('display') ? 'display' : 'body';
      const rest = brand.typography.filter((font) => font.role !== role);
      const current = brand.typography.find((font) => font.role === role);
      return { typography: [...rest, { ...(current ?? fontFor(brand, role)), family: str, renderFamily: str, source: 'observed' }] };
    }
    case 'cornerRadiusPx':
      return typeof value === 'number' ? { cornerRadiusPx: value } : {};
    case 'layoutDensity':
      return LayoutDensity.safeParse(value).success ? { layoutDensity: value as LayoutDensity } : {};
    case 'visualStyle':
      return VisualStyle.safeParse(value).success ? { visualStyle: value as VisualStyle } : {};
    case 'motionStyle':
      return MotionStyle.safeParse(value).success ? { motionStyle: value as MotionStyle } : {};
    case 'iconography':
      return Iconography.safeParse(value).success ? { iconography: value as Iconography } : {};
    case 'imageryStyle':
      return ImageryStyle.safeParse(value).success ? { imageryStyle: value as ImageryStyle } : {};
    case 'communication.tagline':
      return str !== null ? { communication: { ...brand.communication, tagline: str } } : {};
    case 'communication.naming':
      return str !== null ? { communication: { ...brand.communication, naming: str } } : {};
    case 'communication.positioning':
      return str !== null ? { communication: { ...brand.communication, positioning: str } } : {};
    case 'logo':
      return str ? { logo: { ...(brand.logo ?? { assetId: null, url: null, background: 'any', format: 'unknown', aspectRatio: 1 }), url: str, format: str.endsWith('.svg') ? 'svg' : brand.logo?.format ?? 'unknown' } } : {};
    default:
      return {};
  }
}

/**
 * A new project's brand, started from a confirmed one.
 *
 * The confirmed DNA carries over whole — a second film for one company must
 * match the first — and the fresh reading is kept as signals for a person to
 * review. The new brand is the project's own from here: an edit on it never
 * reaches back to the one it came from.
 */
export function inheritBrand(
  parent: BrandSystem,
  measured: BrandSystem,
  context: { id: string; projectId: string; now?: string; newId: (prefix: 'bsg') => string },
): BrandSystem {
  const now = context.now ?? new Date().toISOString();
  return {
    ...parent,
    id: context.id,
    projectId: context.projectId,
    parentBrandId: parent.id,
    sources: measured.sources,
    signals: diffBrandSignals(parent, measured, { projectId: context.projectId, sourceUrl: measured.sources[0] ?? null, now, newId: context.newId }),
    createdAt: now,
    updatedAt: now,
  };
}

/** How many readings a person still has to look at. */
export function pendingBrandSignals(brand: Pick<BrandSystem, 'signals'>): BrandSignal[] {
  return brand.signals.filter((signal) => signal.status === 'pending');
}

export function fontFor(brand: BrandSystem, role: z.infer<typeof FontRole>): BrandFont {
  const found = brand.typography.find((f) => f.role === role);
  if (found) return found;
  const fallback: Record<z.infer<typeof FontRole>, BrandFont> = {
    display: {
      role: 'display',
      family: 'Inter',
      renderFamily: 'Inter',
      weights: [600, 700],
      tracking: -0.03,
      source: 'substituted',
      webfontUrl: null,
    },
    body: {
      role: 'body',
      family: 'Inter',
      renderFamily: 'Inter',
      weights: [400, 500],
      tracking: -0.01,
      source: 'substituted',
      webfontUrl: null,
    },
    mono: {
      role: 'mono',
      family: 'JetBrains Mono',
      renderFamily: 'JetBrains Mono',
      weights: [400, 500],
      tracking: 0,
      source: 'substituted',
      webfontUrl: null,
    },
  };
  return fallback[role];
}

/** The motion style as a designer would say it to a client. */
export function motionPersonalityFor(style: MotionStyle): string {
  const sentences: Record<MotionStyle, string> = {
    precise: 'Short and certain. Things arrive, settle, and stay; nothing bounces.',
    fluid: 'Long, soft arcs. Elements ease in like they have weight and time.',
    snappy: 'Fast in, hard stop. Energy over grace; cuts land on the beat.',
    cinematic: 'Slow pushes and long holds. The camera does the work; the type waits.',
    mechanical: 'Stepped and grid-locked. Movement snaps between positions like a machine.',
  };
  return sentences[style];
}

export const cornerRadiusScale: Record<CornerStyle, number> = {
  sharp: 0,
  subtle: 1,
  rounded: 1.8,
  pill: 3.4,
};
