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
  /**
   * The film exists and is not good enough to deliver.
   *
   * Distinct from `failed`, which is the render throwing. A customer can be
   * told the difference between "something broke" and "we are not happy with
   * this", and before this they could not: both read as failed.
   */
  'needs_attention',
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

/**
 * Which engine drew the film's picture, and how.
 *
 * Two engines take the same storyboard to the same silent master, and a film
 * that looks wrong is first a question of which one drew it. For HyperFrames
 * the record also says who drew each scene — the agent, the scene store, or
 * the engine's own port of the Remotion component when the agent's version
 * would not pass — what the scene writing cost, and what HyperFrames noted
 * about the film without refusing it.
 */
export const RenderEngine = z.object({
  name: z.enum(['remotion', 'hyperframes']),
  version: z.string().max(80),
  /** The scene contract the scenes were written to; null for Remotion. */
  sceneContract: z.number().int().min(1).nullable().default(null),
  scenes: z
    .array(
      z.object({
        sceneId: z.string(),
        source: z.enum(['agent', 'cache', 'fallback']),
        attempts: z.number().int().min(0),
        costUsd: z.number().min(0),
        fallbackReason: z.string().max(400).nullable().default(null),
      }),
    )
    .max(200)
    .default([]),
  warnings: z.array(z.string().max(400)).max(50).default([]),
  costUsd: z.number().min(0).default(0),
});
export type RenderEngine = z.infer<typeof RenderEngine>;

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
  /**
   * Two gates, recorded separately, because they ask different questions.
   *
   * Production QA asks whether the film is technically complete: the pictures
   * arrived, the track can be heard, the container plays. Creative QA asks
   * whether it is any good, by watching the finished file. A film can pass
   * either and fail the other, and collapsing them into one `status` meant
   * "completed" was said of a film nobody had judged.
   *
   * `null` means the gate has not run — which is not the same as passing, and
   * is what every render made before this existed will honestly say.
   */
  productionVerdict: z.enum(['pass', 'needs_attention', 'failed']).nullable().default(null),
  creativeVerdict: z.enum(['pass', 'pass_with_concerns', 'revise', 'block']).nullable().default(null),
  /** What the creative gate said, in the director's words. */
  creativeReason: z.string().max(800).default(''),
  /** Null for a film drawn before engines were recorded, and until this one is drawn. */
  engine: RenderEngine.nullable().default(null),
  error: z.string().nullable().default(null),
  startedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type Render = z.infer<typeof Render>;
/**
 * What a caller hands the store. Every field the schema gives a default may
 * be left out, so a column added to a render is not a change to every place
 * that has ever made one.
 */
export type RenderInput = z.input<typeof Render>;

/**
 * Whether this render may be handed over as the finished film.
 *
 * The one place that answers it, so the page, the download route, Collections
 * and the campaign stage cannot each decide differently — which they did: the
 * project page offered "Download the master" for anything that had produced
 * bytes, including cuts the quality gate had held back.
 *
 * A master artifact may exist and be watched long before this is true. What it
 * may not do is call itself finished.
 */
export function releasable(render: {
  kind: string;
  status: RenderStatus;
  masterAssetId: string | null;
  productionVerdict?: 'pass' | 'needs_attention' | 'failed' | null;
  creativeVerdict?: 'pass' | 'pass_with_concerns' | 'revise' | 'block' | null;
}): boolean {
  if (!render.masterAssetId) return false;
  if (render.status !== 'completed') return false;
  // An animatic is a preview by definition and is never the deliverable.
  if (render.kind === 'animatic') return false;
  /*
   * A verdict that never ran is not a pass. Renders made before the gates
   * existed carry null and are trusted on their status alone, which is the
   * only honest reading: nothing judged them, and rewriting history to say
   * something did would be worse than either answer.
   */
  if (render.productionVerdict !== null && render.productionVerdict !== undefined) {
    if (render.productionVerdict !== 'pass') return false;
  }
  if (render.creativeVerdict !== null && render.creativeVerdict !== undefined) {
    if (render.creativeVerdict !== 'pass' && render.creativeVerdict !== 'pass_with_concerns') return false;
  }
  return true;
}

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
