import { z } from 'zod';

export const AssetKind = z.enum([
  'screenshot',
  'screen_recording',
  'logo',
  'brand_image',
  'generated_image',
  'generated_video',
  'threed_render',
  'scene_render',
  'audio_music',
  'audio_sfx',
  'audio_voice',
  'master_video',
  'variant_video',
  'animatic',
  'poster_frame',
  'caption_track',
  'user_upload',
]);
export type AssetKind = z.infer<typeof AssetKind>;

export const AssetOrigin = z.enum([
  'captured',      // our browser agent observed it in the real product
  'generated',     // a generative model made it
  'rendered',      // our own deterministic engines made it
  'uploaded',      // the customer gave it to us
  'licensed',      // our own music/SFX library
]);
export type AssetOrigin = z.infer<typeof AssetOrigin>;

/**
 * Rights tracking is not paperwork — it decides what the QA fact-checker will
 * allow on screen. `generated` assets can never be presented as the product.
 */
export const AssetRights = z.enum([
  'customer_owned',
  'our_license',
  'generated_derivative',
  'unknown',
]);
export type AssetRights = z.infer<typeof AssetRights>;

export const Asset = z.object({
  id: z.string(),
  organizationId: z.string(),
  projectId: z.string().nullable().default(null),
  conceptId: z.string().nullable().default(null),
  sceneId: z.string().nullable().default(null),
  kind: AssetKind,
  origin: AssetOrigin,
  rights: AssetRights.default('unknown'),
  /** Our own permanent storage key. Never a provider's temporary URL. */
  storageKey: z.string(),
  contentType: z.string().default('application/octet-stream'),
  bytes: z.number().int().min(0).default(0),
  width: z.number().int().min(0).nullable().default(null),
  height: z.number().int().min(0).nullable().default(null),
  durationSeconds: z.number().min(0).nullable().default(null),
  checksum: z.string().nullable().default(null),
  provider: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  sourceUrl: z.string().nullable().default(null),
  costUsd: z.number().min(0).default(0),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string(),
});
export type Asset = z.infer<typeof Asset>;

/** Storage layout: organisation / project / concept / scene / asset. */
export function storageKeyFor(parts: {
  organizationId: string;
  projectId?: string | null;
  conceptId?: string | null;
  sceneId?: string | null;
  assetId: string;
  extension: string;
}): string {
  const segments = [
    `org/${parts.organizationId}`,
    parts.projectId ? `project/${parts.projectId}` : null,
    parts.conceptId ? `concept/${parts.conceptId}` : null,
    parts.sceneId ? `scene/${parts.sceneId}` : null,
    `${parts.assetId}.${parts.extension.replace(/^\./, '')}`,
  ].filter(Boolean);
  return segments.join('/');
}

/**
 * May this asset stand for the customer's product on screen?
 *
 * Only material that came from the product itself: what our browser agent
 * observed, or what the customer handed us. A generated image of an interface
 * is the one thing this product must never present as somebody's software, and
 * `rendered` is excluded too — our own engines make typography and 3D staging,
 * neither of which is evidence of what the product looks like.
 *
 * A 3D hero shot stages a real capture rather than replacing it, so those
 * scenes keep pointing at the capture and pass this the same way a flat one
 * does.
 */
export function isRealProductAsset(asset: Pick<Asset, 'origin' | 'kind'>): boolean {
  if (asset.origin !== 'captured' && asset.origin !== 'uploaded') return false;
  return (
    asset.kind === 'screenshot' ||
    asset.kind === 'screen_recording' ||
    asset.kind === 'brand_image'
  );
}
