import { z } from 'zod';

export const AspectRatio = z.enum(['16:9', '9:16', '1:1', '4:5']);
export type AspectRatio = z.infer<typeof AspectRatio>;

export const ASPECT_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
};

export const ASPECT_DIMENSIONS_4K: Record<AspectRatio, { width: number; height: number }> = {
  '16:9': { width: 3840, height: 2160 },
  '9:16': { width: 2160, height: 3840 },
  '1:1': { width: 2160, height: 2160 },
  '4:5': { width: 2160, height: 2700 },
};

export const RenderQuality = z.enum(['preview', 'hd', 'uhd']);
export type RenderQuality = z.infer<typeof RenderQuality>;

export const RenderStatus = z.enum([
  'queued',
  'rendering_scenes',
  'compositing',
  'sound',
  'qa',
  'repairing',
  'completed',
  'failed',
  'canceled',
]);
export type RenderStatus = z.infer<typeof RenderStatus>;

export const AudioStem = z.enum(['full', 'no_voice', 'no_music', 'clean_product']);
export type AudioStem = z.infer<typeof AudioStem>;

/**
 * What a render is for.
 *
 * A film is the deliverable. A cut is one channel's version of a finished film.
 * An animatic is a rough preview of a storyboard, built before anybody has
 * committed to rendering. They are three different things and only the first
 * one is what a customer bought, so nothing may treat them as interchangeable:
 * the project's master, its version numbers and the plan's render allowance all
 * count films.
 */
/**
 * What a render is.
 *
 * Only a film is the project's master. A cut is a re-edit for a channel, an
 * animatic is a timing preview, and a localised master is the same film in
 * another language — a deliverable the customer keeps, which must not replace
 * the film on the page, must not be what the next campaign is cut from, and
 * must not spend a render from a plan that sells renders of the film.
 */
export const RenderKind = z.enum(['film', 'cut', 'animatic', 'localised']);
export type RenderKind = z.infer<typeof RenderKind>;

export const Render = z.object({
  id: z.string(),
  projectId: z.string(),
  storyboardId: z.string(),
  organizationId: z.string(),
  kind: RenderKind.default('film'),
  version: z.number().int().min(1).default(1),
  aspect: AspectRatio.default('16:9'),
  quality: RenderQuality.default('hd'),
  fps: z.number().int().min(24).max(60).default(30),
  status: RenderStatus.default('queued'),
  masterAssetId: z.string().nullable().default(null),
  posterAssetId: z.string().nullable().default(null),
  /**
   * The caption track, as WebVTT.
   *
   * A sidecar rather than part of the picture, because a caption burned into
   * the frame cannot be turned off, translated, or read by anything but a
   * human eye. Cuts for muted feeds get both: burned in so they are seen, and
   * a track so they can still be used.
   */
  captionsAssetId: z.string().nullable().default(null),
  watermarked: z.boolean().default(false),
  durationSeconds: z.number().min(0).default(0),
  costUsd: z.number().min(0).default(0),
  qaReportId: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
  startedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type Render = z.infer<typeof Render>;

export const VariantPurpose = z.enum([
  'hero_60',
  'vertical_30',
  'ad_15_a',
  'ad_15_b',
  'ad_15_c',
  'bumper_6',
  'homepage_loop',
  'product_hunt',
  'linkedin_cut',
  'reel',
  'tiktok',
  'youtube_short',
]);
export type VariantPurpose = z.infer<typeof VariantPurpose>;

export const Variant = z.object({
  id: z.string(),
  renderId: z.string(),
  projectId: z.string(),
  purpose: VariantPurpose,
  aspect: AspectRatio,
  durationSeconds: z.number().min(1),
  /** Scene ids kept, in order. Variants are recomposed, never cropped. */
  sceneIds: z.array(z.string()).default([]),
  audioStem: AudioStem.default('full'),
  captionsBurned: z.boolean().default(false),
  assetId: z.string().nullable().default(null),
  status: RenderStatus.default('queued'),
  costUsd: z.number().min(0).default(0),
  createdAt: z.string(),
});
export type Variant = z.infer<typeof Variant>;

/**
 * Channel specs. Duration targets are what the edit is cut to, not a hard
 * trim — the variant planner picks whole scenes that fit.
 */
export const VARIANT_SPECS: Record<
  VariantPurpose,
  { aspect: AspectRatio; targetSeconds: number; label: string; captions: boolean }
> = {
  hero_60: { aspect: '16:9', targetSeconds: 60, label: 'Hero film', captions: false },
  vertical_30: { aspect: '9:16', targetSeconds: 30, label: 'Vertical 30', captions: true },
  ad_15_a: { aspect: '9:16', targetSeconds: 15, label: 'Ad A — problem led', captions: true },
  ad_15_b: { aspect: '9:16', targetSeconds: 15, label: 'Ad B — product led', captions: true },
  ad_15_c: { aspect: '1:1', targetSeconds: 15, label: 'Ad C — proof led', captions: true },
  bumper_6: { aspect: '16:9', targetSeconds: 6, label: 'Bumper', captions: false },
  homepage_loop: { aspect: '16:9', targetSeconds: 12, label: 'Homepage loop', captions: false },
  product_hunt: { aspect: '16:9', targetSeconds: 45, label: 'Product Hunt', captions: true },
  linkedin_cut: { aspect: '1:1', targetSeconds: 30, label: 'LinkedIn', captions: true },
  reel: { aspect: '9:16', targetSeconds: 22, label: 'Reel', captions: true },
  tiktok: { aspect: '9:16', targetSeconds: 20, label: 'TikTok', captions: true },
  youtube_short: { aspect: '9:16', targetSeconds: 28, label: 'YouTube Short', captions: true },
};

export function dimensionsFor(aspect: AspectRatio, quality: RenderQuality) {
  if (quality === 'uhd') return ASPECT_DIMENSIONS_4K[aspect];
  if (quality === 'preview') {
    const base = ASPECT_DIMENSIONS[aspect];
    return { width: Math.round(base.width / 2), height: Math.round(base.height / 2) };
  }
  return ASPECT_DIMENSIONS[aspect];
}
