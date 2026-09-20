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
  'audio_edition',
  'master_video',
  'variant_video',
  'animatic',
  'poster_frame',
  'caption_track',
  'user_upload',
]);
export type AssetKind = z.infer<typeof AssetKind>;

/**
 * Material a film can be made FROM, as against what a film is made INTO.
 *
 * A project's assets include everything it has produced — the master, its
 * poster, every scene render, the audio stems — and a planner that reads that
 * list as "footage we hold" concludes the film can use itself. It then writes
 * a shot of b-roll that does not exist, which is refused, and the loop spends
 * a replan finding out.
 */
export const SOURCE_MATERIAL_KINDS: readonly AssetKind[] = [
  'screenshot',
  'screen_recording',
  'logo',
  'brand_image',
  'generated_image',
  'generated_video',
  'threed_render',
  'user_upload',
];

export function isSourceMaterial(asset: Pick<Asset, 'kind'>): boolean {
  return SOURCE_MATERIAL_KINDS.includes(asset.kind);
}

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

/**
 * What a library asset is a picture of.
 *
 * Inferred after upload and never demanded at upload: a founder dropping
 * forty photos on the page is not asked forty questions. Every category can
 * be corrected, and a correction is kept over anything inferred later.
 */
export const LibraryCategory = z.enum([
  'product',
  'founder',
  'people',
  'team',
  'office',
  'ui',
  'screenshot',
  'logo',
  'brand',
  'illustration',
  'reference',
  'other',
]);
export type LibraryCategory = z.infer<typeof LibraryCategory>;

export const LIBRARY_CATEGORY_LABELS: Record<LibraryCategory, string> = {
  product: 'Product',
  founder: 'Founder',
  people: 'People',
  team: 'Team',
  office: 'Office',
  ui: 'UI',
  screenshot: 'Screenshot',
  logo: 'Logo',
  brand: 'Brand',
  illustration: 'Illustration',
  reference: 'Reference',
  other: 'Other',
};

/** Who or what decided the category: nobody yet, the classifier, or a person. */
export const CategorySource = z.enum(['none', 'inferred', 'user']);
export type CategorySource = z.infer<typeof CategorySource>;

/** Where a library asset came from, as the card says it. */
export const AssetSource = z.enum(['upload', 'browser_research', 'generated', 'rendered', 'edited', 'pipeline']);
export type AssetSource = z.infer<typeof AssetSource>;

export const ASSET_SOURCE_LABELS: Record<AssetSource, string> = {
  upload: 'Upload',
  browser_research: 'Browser Research',
  generated: 'Generated',
  rendered: 'Rendered',
  edited: 'Edited',
  pipeline: 'Pipeline',
};

/** How long the library's own two free-text fields may be. */
export const ASSET_NAME_LIMIT = 200;
export const ASSET_DESCRIPTION_LIMIT = 2000;

/**
 * A label cut to the length the record allows.
 *
 * What an asset is called comes from outside: a page title, a capture label,
 * a heading read off a customer's site. None of those are written to our
 * limits, and a two-hundred-and-one character title is not a reason to throw
 * away a crawl that has already been paid for. Cut at a word where there is
 * one late enough to still read as a name, and say that it was cut.
 */
export function fitLabel(text: string, limit: number): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  const kept = space > limit * 0.6 ? cut.slice(0, space) : cut;
  return `${kept.trimEnd()}\u2026`;
}

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

  // --- the library ------------------------------------------------------
  /**
   * In the workspace's library: reusable media a person can see, name, tag
   * and put in a film. Intermediate renders, poster frames and masters stay
   * out of it; they belong to the production that made them.
   */
  library: z.boolean().default(false),
  /** What a person calls it. The filename until they rename it. */
  name: z.string().max(ASSET_NAME_LIMIT).default(''),
  category: LibraryCategory.default('other'),
  categorySource: CategorySource.default('none'),
  /** What is in the picture, in a sentence, so the library can be searched by content. */
  description: z.string().max(ASSET_DESCRIPTION_LIMIT).default(''),
  tags: z.array(z.string().max(60)).max(40).default([]),
  favorite: z.boolean().default(false),
  /** Approved for use: the creative system prefers these over anything else in the library. */
  approved: z.boolean().default(false),
  /** The asset this one was made from: a generated shot's reference still, an edit's original. */
  parentAssetId: z.string().nullable().default(null),
  uploadedByUserId: z.string().nullable().default(null),
  source: AssetSource.default('pipeline'),
});
export type Asset = z.infer<typeof Asset>;
/** What a caller hands the store: every library field, and most others, may be left to its default. */
export type AssetInput = z.input<typeof Asset>;

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

/** Library uploads live under the organisation, not a project: one file, any number of projects. */
export function libraryStorageKeyFor(parts: { organizationId: string; assetId: string; extension: string }): string {
  return `org/${parts.organizationId}/library/${parts.assetId}.${parts.extension.replace(/^\./, '')}`;
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
export function isRealProductAsset(asset: Pick<Asset, 'origin' | 'kind'> & Partial<Pick<Asset, 'category'>>): boolean {
  if (asset.origin !== 'captured' && asset.origin !== 'uploaded') return false;
  if (asset.kind === 'screenshot' || asset.kind === 'screen_recording' || asset.kind === 'brand_image') return true;
  // A library upload is the customer's own picture; when a person or the
  // classifier says it shows the interface, it is evidence of the interface.
  return asset.kind === 'user_upload' && (asset.category === 'ui' || asset.category === 'screenshot');
}

/**
 * A first guess at what an upload is, from nothing but its name.
 *
 * The classifier looks at the picture afterwards; this is what the card says
 * in the seconds before it has, and what stands when there is no model to
 * ask. It is deliberately conservative: a name that says nothing is `other`,
 * not a guess dressed as a finding.
 */
export function categoryFromFilename(filename: string, contentType = ''): LibraryCategory {
  const name = filename.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[_\-.]+/g, ' ');
  const has = (pattern: RegExp) => pattern.test(name);
  if (has(/\b(logo|logotype|wordmark|favicon|brandmark|monogram)\b/)) return 'logo';
  if (has(/\b(screenshot|screen ?shot|screen ?capture|capture|screen)\b/)) return 'screenshot';
  if (has(/\b(founder|ceo|cto|coo|cofounder|co founder|portrait|headshot)\b/)) return 'founder';
  if (has(/\b(team|crew|staff|offsite|all ?hands)\b/)) return 'team';
  if (has(/\b(office|hq|headquarters|workspace|building|campus)\b/)) return 'office';
  if (has(/\b(ui|dashboard|interface|app|mockup|mock up|wireframe)\b/)) return 'ui';
  if (has(/\b(product|device|hardware|packshot|pack shot|packaging|unit)\b/)) return 'product';
  if (has(/\b(illustration|illus|drawing|vector|sketch|artwork)\b/)) return 'illustration';
  if (has(/\b(brand|pattern|texture|palette|swatch|gradient|typography|type ?specimen)\b/)) return 'brand';
  if (has(/\b(reference|ref|moodboard|mood board|inspiration|inspo|benchmark)\b/)) return 'reference';
  if (has(/\b(people|customer|customers|user|users|person|community|event|conference|talk|meetup)\b/)) return 'people';
  if (contentType === 'image/svg+xml') return 'logo';
  return 'other';
}

/** A name for the card from a filename: the extension off, the separators spaces. */
export function nameFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 200) || base.slice(0, 200);
}

/**
 * The order the creative system looks at the library in.
 *
 * Approved first: a person said "use this". Then what they marked as a
 * favourite, then the newest. Real assets are consulted before anything is
 * generated, and this is the order they are consulted in.
 */
export function rankLibraryAssets<T extends Pick<Asset, 'approved' | 'favorite' | 'createdAt'>>(assets: readonly T[]): T[] {
  return [...assets].sort((a, b) => {
    if (a.approved !== b.approved) return a.approved ? -1 : 1;
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}
