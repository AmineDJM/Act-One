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

export const BrandLogo = z.object({
  assetId: z.string().nullable().default(null),
  url: urlString.nullable().default(null),
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
});
export type BrandSystem = z.infer<typeof BrandSystem>;

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

export const cornerRadiusScale: Record<CornerStyle, number> = {
  sharp: 0,
  subtle: 1,
  rounded: 1.8,
  pill: 3.4,
};
