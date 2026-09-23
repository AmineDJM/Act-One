import { z } from 'zod';

/**
 * The contract of a brand ingestion.
 *
 * Everything a later stage may rely on is declared here and validated on the
 * way out, so a manifest that reaches the director, the audio engine or the
 * renderer is known to be whole. Binary payloads (fonts, SVG, PNG) are not in
 * the manifest; it references them by asset id and content hash.
 */
export const INGESTION_SCHEMA_VERSION = 1 as const;

const Hex = z.string().regex(/^#[0-9a-f]{6}$/);
const Hex8 = z.string().regex(/^#[0-9a-f]{8}$/);
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const AssetId = z.string().regex(/^ing_[a-z0-9]+_[0-9a-f]{12}$/);
const Unit = z.number().min(0).max(1);

export const CssColorSpaceName = z.enum([
  'srgb',
  'srgb-linear',
  'display-p3',
  'a98-rgb',
  'prophoto-rgb',
  'rec2020',
  'xyz-d50',
  'xyz-d65',
  'hsl',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
]);

export const Rect = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type Rect = z.infer<typeof Rect>;

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export const IngestionRequest = z.object({
  url: z.string().trim().min(1).max(2048),
  organizationId: z.string().trim().min(1).max(64),
  projectId: z.string().trim().min(1).max(64),
  /** The layout the brand is measured at. Desktop, because that is where brands are designed. */
  viewport: z
    .object({
      width: z.number().int().min(800).max(2560),
      height: z.number().int().min(600).max(1600),
    })
    .default({ width: 1440, height: 900 }),
  captures: z
    .object({
      hero: z.boolean().default(true),
      buttons: z.number().int().min(0).max(12).default(4),
      cards: z.number().int().min(0).max(12).default(4),
    })
    .default({ hero: true, buttons: 4, cards: 4 }),
  /** The whole run, navigation to manifest. Past it the run stops and says where. */
  timeoutMs: z.number().int().min(15_000).max(300_000).default(120_000),
});
export type IngestionRequest = z.infer<typeof IngestionRequest>;
export type IngestionRequestInput = z.input<typeof IngestionRequest>;

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

export const ColorUsage = z.enum(['background', 'text', 'border', 'fill', 'stroke', 'gradient', 'shadow']);
export type ColorUsage = z.infer<typeof ColorUsage>;

export const PaletteColor = z.object({
  hex: Hex,
  /** Alpha included: `rgba(0,0,0,0.1)` borders are a different colour from black. */
  hex8: Hex8,
  alpha: Unit,
  /** The computed value exactly as the browser serialised it, e.g. `oklch(0.62 0.19 259.8)`. */
  css: z.string().min(1).max(200),
  space: CssColorSpaceName,
  oklch: z.object({ l: z.number(), c: z.number().min(0), h: z.number().min(0).max(360) }),
  /** False when the brand wrote a colour wider than sRGB; `hex` is then its gamut-mapped rendition. */
  inGamut: z.boolean(),
  /** Share of the page's measured visual weight, 0..1; the palette's weights sum to 1. */
  weight: Unit,
  usages: z.array(ColorUsage).min(1),
  /** Design tokens (custom properties) whose value resolves to this colour. */
  tokens: z.array(z.string().max(120)).max(24),
  /** How many elements paint it. */
  elements: z.number().int().min(0),
  /** Painted by a button, a link or something with a button's role. */
  interactive: z.boolean(),
});
export type PaletteColor = z.infer<typeof PaletteColor>;

export const PaletteRole = z.enum([
  'background',
  'surface',
  'foreground',
  'mutedForeground',
  'primary',
  'primaryForeground',
  'accent',
  'border',
]);
export type PaletteRole = z.infer<typeof PaletteRole>;

/** Each role names a palette colour by its `hex8`, or is null when the page did not show one. */
export const PaletteRoles = z.object({
  background: Hex8,
  surface: Hex8.nullable(),
  foreground: Hex8,
  mutedForeground: Hex8.nullable(),
  primary: Hex8.nullable(),
  primaryForeground: Hex8.nullable(),
  accent: Hex8.nullable(),
  border: Hex8.nullable(),
});
export type PaletteRoles = z.infer<typeof PaletteRoles>;

export const GradientSample = z.object({
  css: z.string().min(1).max(2000),
  stops: z.array(Hex8).min(1).max(16),
  /** Painted area, CSS px². */
  area: z.number().min(0),
});

export const ColorToken = z.object({
  name: z.string().regex(/^--[A-Za-z0-9_-]+$/).max(120),
  /** The declared value, as authored. */
  value: z.string().max(400),
  resolved: Hex8,
  /** Whether the page actually paints this colour somewhere. */
  usedOnPage: z.boolean(),
});

export const Palette = z.object({
  colors: z.array(PaletteColor).min(1).max(48),
  roles: PaletteRoles,
  gradients: z.array(GradientSample).max(12),
  tokens: z.array(ColorToken).max(400),
  themeColor: Hex8.nullable(),
  scheme: z.enum(['light', 'dark']),
});
export type Palette = z.infer<typeof Palette>;

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export const TypeRole = z.enum(['display', 'heading', 'body', 'ui', 'mono']);
export type TypeRole = z.infer<typeof TypeRole>;

export const TypeSpec = z.object({
  role: TypeRole,
  /** The declared `font-family` stack, in order, unquoted. */
  stack: z.array(z.string().min(1).max(160)).min(1).max(16),
  /**
   * The face the browser actually drew the sample with, from its own font
   * matching rather than from reading the stack: a stack whose first family
   * failed to load renders in the second, and only the renderer knows.
   */
  rendered: z
    .object({
      family: z.string().min(1).max(160),
      postScriptName: z.string().max(160).nullable(),
      isWebFont: z.boolean(),
    })
    .nullable(),
  weight: z.number().int().min(1).max(1000),
  style: z.enum(['normal', 'italic', 'oblique']),
  sizePx: z.number().positive().max(2000),
  /** Line height over font size; null where the page says `normal`. */
  lineHeight: z.number().positive().max(10).nullable(),
  letterSpacingEm: z.number().min(-1).max(2),
  textTransform: z.enum(['none', 'uppercase', 'lowercase', 'capitalize']),
  color: Hex8.nullable(),
  sample: z.string().max(160),
});
export type TypeSpec = z.infer<typeof TypeSpec>;

export const FontEmbedding = z.enum(['installable', 'restricted', 'preview_print', 'editable', 'unknown']);

export const FontLicence = z.object({
  /**
   * `open`: a libre licence the file or its host declares (OFL, Apache, …).
   * `restricted`: the file forbids embedding. `proprietary`: licensed terms
   * that are not open. `unknown`: the file says nothing.
   */
  kind: z.enum(['open', 'proprietary', 'restricted', 'unknown']),
  /**
   * Whether rendering it into a film needs the customer to confirm they hold
   * the rights. Web-font licences commonly cover a website and not a video,
   * and the brand is the licensee, not us.
   */
  requiresAttestation: z.boolean(),
  embedding: FontEmbedding,
  fsType: z.number().int().min(0).max(0xffff).nullable(),
  licenseDescription: z.string().max(2000).nullable(),
  licenseUrl: z.string().max(500).nullable(),
  copyright: z.string().max(500).nullable(),
  manufacturer: z.string().max(200).nullable(),
  reason: z.string().min(1).max(300),
});
export type FontLicence = z.infer<typeof FontLicence>;

export const VariationAxis = z.object({
  tag: z.string().min(1).max(4),
  min: z.number(),
  default: z.number(),
  max: z.number(),
});

export const FontFaceAsset = z.object({
  assetId: AssetId,
  /** The family name the page's `@font-face` declares. */
  family: z.string().min(1).max(160),
  weight: z.string().min(1).max(40),
  style: z.string().min(1).max(40),
  stretch: z.string().max(40).nullable(),
  unicodeRange: z.string().max(8000).nullable(),
  format: z.enum(['woff2', 'woff', 'truetype', 'opentype']),
  sourceUrl: z.string().min(1).max(2048),
  /** From the file's own name table, which is what the renderer matches on. */
  postScriptName: z.string().max(160).nullable(),
  fullName: z.string().max(300).nullable(),
  version: z.string().max(200).nullable(),
  /** Variable-font axes; a kinetic headline can animate `wght` rather than swap faces. */
  axes: z.array(VariationAxis).max(16),
  bytes: z.number().int().positive(),
  sha256: Sha256,
  licence: FontLicence,
  usedBy: z.array(TypeRole).max(5),
});
export type FontFaceAsset = z.infer<typeof FontFaceAsset>;

export const Typography = z.object({
  roles: z.array(TypeSpec).min(1).max(5),
  faces: z.array(FontFaceAsset).max(64),
  /** Faces the page uses that could not be kept, and why. Never silently dropped. */
  missing: z.array(z.object({ family: z.string().max(160), reason: z.string().max(300) })).max(64),
});
export type Typography = z.infer<typeof Typography>;

// ---------------------------------------------------------------------------
// Logo and captures
// ---------------------------------------------------------------------------

export const LogoSource = z.enum(['inline-svg', 'svg-file', 'raster', 'favicon-svg']);

export const Logo = z.object({
  source: LogoSource,
  /** Sanitised vector, when the brand ships one. */
  svgAssetId: AssetId.nullable(),
  /** The mark as the page drew it, transparent, at high resolution. Always present. */
  pngAssetId: AssetId.nullable(),
  cssWidth: z.number().positive(),
  cssHeight: z.number().positive(),
  /** The colour behind the mark on the page: what it was designed to sit on. */
  backdrop: Hex8.nullable(),
  /**
   * How closely the kept vector reproduces what the page drew, 0..1, by
   * rendering both and comparing pixels. Null when there is no vector to judge.
   */
  vectorFidelity: Unit.nullable(),
  confidence: Unit,
  reasons: z.array(z.string().max(120)).max(12),
  label: z.string().max(200),
});
export type Logo = z.infer<typeof Logo>;

export const CaptureKind = z.enum(['hero', 'button', 'card', 'logo', 'viewport']);
export type CaptureKind = z.infer<typeof CaptureKind>;

export const CapturedStyle = z.object({
  background: Hex8.nullable(),
  color: Hex8.nullable(),
  borderColor: Hex8.nullable(),
  borderWidthPx: z.number().min(0),
  borderRadiusPx: z.number().min(0),
  boxShadow: z.string().max(600).nullable(),
  fontFamily: z.string().max(400),
  fontWeight: z.number().int().min(1).max(1000),
  fontSizePx: z.number().positive(),
  textTransform: z.string().max(20),
  paddingPx: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});
export type CapturedStyle = z.infer<typeof CapturedStyle>;

export const ComponentCapture = z.object({
  assetId: AssetId,
  kind: CaptureKind,
  label: z.string().max(200),
  /** The element's border box, document CSS px. */
  rect: Rect,
  /** What was captured: the box plus its shadow and overflow, document CSS px. */
  clip: Rect,
  scale: z.number().min(1).max(4),
  pixelWidth: z.number().int().positive(),
  pixelHeight: z.number().int().positive(),
  /** Whether any pixel is less than opaque: true for anything not rectangular. */
  transparent: z.boolean(),
  /** Share of pixels that are fully opaque. */
  opaqueCoverage: Unit,
  /** Taller than the frame it was captured in, and cut to it. */
  cropped: z.boolean(),
  style: CapturedStyle.nullable(),
  score: z.number(),
  reasons: z.array(z.string().max(120)).max(12),
});
export type ComponentCapture = z.infer<typeof ComponentCapture>;

// ---------------------------------------------------------------------------
// Assets and the manifest
// ---------------------------------------------------------------------------

export const AssetKind = z.enum(['font', 'logo-svg', 'logo-png', 'capture-png']);
export type AssetKind = z.infer<typeof AssetKind>;

export const AssetRef = z.object({
  id: AssetId,
  kind: AssetKind,
  mime: z.enum(['font/woff2', 'font/woff', 'font/ttf', 'font/otf', 'image/svg+xml', 'image/png']),
  fileName: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,120}$/),
  bytes: z.number().int().positive(),
  sha256: Sha256,
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
});
export type AssetRef = z.infer<typeof AssetRef>;

export const StageReport = z.object({
  name: z.string().max(40),
  ms: z.number().int().min(0),
  ok: z.boolean(),
  error: z.string().max(500).nullable(),
});
export type StageReport = z.infer<typeof StageReport>;

export const BrandIngestion = z.object({
  schemaVersion: z.literal(INGESTION_SCHEMA_VERSION),
  id: z.string().regex(/^ing_[a-z0-9]+$/),
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  sourceUrl: z.string().url(),
  finalUrl: z.string().url(),
  title: z.string().max(500),
  lang: z.string().max(35).nullable(),
  capturedAt: z.string().datetime(),
  durationMs: z.number().int().min(0),
  provider: z.string().min(1),
  sessionId: z.string().min(1),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  palette: Palette.nullable(),
  typography: Typography.nullable(),
  logo: Logo.nullable(),
  logoAlternates: z.array(Logo).max(3),
  captures: z.array(ComponentCapture).max(40),
  assets: z.array(AssetRef).max(160),
  diagnostics: z.object({
    warnings: z.array(z.string().max(500)).max(200),
    blockedRequests: z.array(z.object({ url: z.string().max(500), reason: z.string().max(200) })).max(200),
    stages: z.array(StageReport).max(20),
  }),
});
export type BrandIngestion = z.infer<typeof BrandIngestion>;
