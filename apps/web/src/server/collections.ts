import 'server-only';
import { revalidatePath } from 'next/cache';
import {
  AppError,
  COLLECTION_CATEGORY_LABELS,
  COLLECTION_STATUS_LABELS,
  CollectionCategory,
  CollectionEntry,
  can,
  collectionSlug,
  creditLine,
  newId,
  orderForPublic,
  rememberAddress,
  submissionNext,
  type Asset,
  type CollectionStatus,
  type Project,
  type Render,
} from '@act-one/core';
import { site } from '@/lib/site.ts';
import { getStore } from './store.ts';
import type { Session } from './auth.ts';

/**
 * Act One Collections, at the layer that keeps its rules.
 *
 * Two doors into the gallery, and only two. A customer submits their finished
 * film for selection and consents, in so many words, to public display; or
 * staff publish a film themselves and attest to the written consent they
 * hold. Nothing is published by a job, a schedule or a default. A person
 * selects, features, orders, retitles and unpublishes, and the public reads
 * only what is published right now.
 */

/** The words a customer agrees to. Shown in full beside the box, stored with the entry. */
export const CONSENT_STATEMENT =
  `I have the right to show this product publicly, and I consent to ${site.name} displaying this film, ` +
  'its stills, the product name and the product address in Act One Collections and in its own channels, ' +
  'until I withdraw it.';

// --- the customer's side ---------------------------------------------------------------

export type SubmissionView = {
  entry: CollectionEntry | null;
  next: ReturnType<typeof submissionNext>;
  /** The state in the customer's words, or nothing before a submission. */
  label: string | null;
  /** Whether there is a film that could be submitted right now, and if not, why. */
  eligible: boolean;
  reason: string | null;
  /** The public address once selected. */
  publicPath: string | null;
  canSubmit: boolean;
};

/** The film a project would show: its master, never a preview, never a cut. */
export async function deliverableFor(organizationId: string, project: Project): Promise<Render | null> {
  const renders = (await getStore().renders.listForProject(organizationId, project.id)).filter((render) => render.kind === 'film');
  return (
    renders.find((render) => render.id === project.latestRenderId && render.masterAssetId && render.status === 'completed') ??
    renders.find((render) => render.status === 'completed' && Boolean(render.masterAssetId)) ??
    null
  );
}

export async function loadSubmission(session: Session, project: Project): Promise<SubmissionView> {
  const store = getStore();
  const [entry, render] = await Promise.all([store.collections.getForProject(session.organizationId, project.id), deliverableFor(session.organizationId, project)]);
  const eligibility = eligibilityOf(render);
  return {
    entry,
    next: submissionNext(entry?.status ?? null),
    label: entry ? COLLECTION_STATUS_LABELS[entry.status] : null,
    eligible: eligibility === null,
    reason: eligibility,
    publicPath: entry?.status === 'published' ? `/collections/${entry.slug}` : null,
    canSubmit: can(session.actor, 'project:update'),
  };
}

function eligibilityOf(render: Render | null): string | null {
  if (!render || !render.masterAssetId) return 'Collections shows finished films. Render the master first.';
  if (render.watermarked) return 'A watermarked preview cannot be selected. Render the clean master first.';
  return null;
}

export type SubmitInput = {
  consent: boolean;
  tagline?: string;
  concept?: string;
  category?: string;
  launchDate?: string | null;
};

/**
 * Submits the project's film for selection.
 *
 * The consent is the whole point: without the box, nothing is written. A
 * project already under consideration or already selected is left as it
 * is; one that was withdrawn, declined or unpublished goes back under
 * consideration with a fresh consent and the current master, under the
 * address it already had.
 */
export async function submitForSelection(session: Session, projectId: string, input: SubmitInput): Promise<CollectionEntry> {
  if (!can(session.actor, 'project:update')) throw new AppError('forbidden', 'Your role cannot submit a film for selection.');
  if (!input.consent) throw new AppError('validation_failed', 'Public display needs your explicit consent.');

  const store = getStore();
  const project = await store.projects.get(session.organizationId, projectId);
  if (!project) throw new AppError('not_found', 'Project not found.');
  const render = await deliverableFor(session.organizationId, project);
  const refusal = eligibilityOf(render);
  if (refusal || !render?.masterAssetId) throw new AppError('conflict', refusal ?? 'There is no master to submit.');

  const now = new Date().toISOString();
  const consent = { grantedByUserId: session.user.id, grantedAt: now, statement: CONSENT_STATEMENT, byStaff: false };
  const category = CollectionCategory.safeParse(input.category);
  const launchDate = input.launchDate && /^\d{4}-\d{2}-\d{2}$/.test(input.launchDate) ? input.launchDate : null;
  const words = {
    tagline: (input.tagline ?? '').trim().slice(0, 200),
    concept: (input.concept ?? '').trim().slice(0, 600),
  };

  const existing = await store.collections.getForProject(session.organizationId, project.id);
  if (existing && (existing.status === 'pending' || existing.status === 'published')) return existing;
  if (existing) {
    const updated = await store.collections.update(existing.id, {
      status: 'pending',
      renderId: render.id,
      masterAssetId: render.masterAssetId,
      posterAssetId: existing.posterAssetId ?? render.posterAssetId,
      durationSeconds: render.durationSeconds,
      consent,
      submittedByUserId: session.user.id,
      submittedAt: now,
      decidedByUserId: null,
      decidedAt: null,
      ...(category.success ? { category: category.data } : {}),
      ...(launchDate ? { launchDate } : {}),
      ...(words.tagline ? { tagline: words.tagline } : {}),
      ...(words.concept ? { concept: words.concept } : {}),
      updatedAt: now,
    });
    revalidatePath(`/app/projects/${project.id}`);
    return updated;
  }

  const [understanding, concept] = await Promise.all([
    project.productUnderstandingId
      ? store.understandings.get(session.organizationId, project.productUnderstandingId)
      : store.understandings.getLatestForProject(session.organizationId, project.id),
    project.selectedConceptId ? store.concepts.get(session.organizationId, project.selectedConceptId) : null,
  ]);
  const company = (understanding?.name || project.name).trim().slice(0, 120);
  const entry = CollectionEntry.parse({
    id: newId('col'),
    slug: 'pending',
    organizationId: session.organizationId,
    projectId: project.id,
    renderId: render.id,
    masterAssetId: render.masterAssetId,
    posterAssetId: render.posterAssetId,
    stillAssetIds: [],
    company,
    productUrl: project.websiteUrl,
    title: (concept?.name || project.name).trim().slice(0, 140),
    tagline: words.tagline || (understanding?.oneLiner ?? '').slice(0, 200),
    concept: words.concept || (concept?.keyIdea ?? '').slice(0, 600),
    category: category.success ? category.data : 'other',
    launchDate,
    durationSeconds: render.durationSeconds,
    status: 'pending',
    consent,
    submittedByUserId: session.user.id,
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const created = await createWithFreeSlug(entry);
  revalidatePath(`/app/projects/${project.id}`);
  return created;
}

/** Withdraws consent: the film leaves consideration, or the public gallery, at once. */
export async function withdrawFromSelection(session: Session, projectId: string): Promise<CollectionEntry> {
  if (!can(session.actor, 'project:update')) throw new AppError('forbidden', 'Your role cannot withdraw a film.');
  const store = getStore();
  const entry = await store.collections.getForProject(session.organizationId, projectId);
  if (!entry) throw new AppError('not_found', 'This film was not submitted.');
  if (entry.status !== 'pending' && entry.status !== 'published') return entry;
  const updated = await store.collections.update(entry.id, { status: 'withdrawn', updatedAt: new Date().toISOString() });
  revalidatePublic(entry.slug);
  revalidatePath(`/app/projects/${projectId}`);
  return updated;
}

/** Creates the entry under the company's address, or the next free one. */
async function createWithFreeSlug(entry: CollectionEntry): Promise<CollectionEntry> {
  const store = getStore();
  const base = collectionSlug(entry.company, () => false);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (await store.collections.getBySlug(slug)) continue;
    try {
      return await store.collections.create({ ...entry, slug });
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'conflict')) throw error;
    }
  }
  return store.collections.create({ ...entry, slug: `${base}-${Date.now().toString(36)}` });
}

// --- the editorial side -----------------------------------------------------------------

export type EditorialPatch = Partial<
  Pick<
    CollectionEntry,
    | 'title'
    | 'tagline'
    | 'concept'
    | 'company'
    | 'productUrl'
    | 'category'
    | 'launchDate'
    | 'slug'
    | 'posterAssetId'
    | 'stillAssetIds'
    | 'featured'
    | 'launchOfTheWeek'
    | 'original'
    | 'position'
    | 'editorialNote'
    | 'seoTitle'
    | 'seoDescription'
  >
>;

/**
 * Edits an entry's words, pictures and flags.
 *
 * Every picture named must be an image of the entry's own project: a poster
 * frame, a scene, a capture. Naming another workspace's asset here would
 * publish it, so the check is not optional. One film is the launch of the
 * week at a time.
 */
export async function editEntry(id: string, patch: EditorialPatch, staffUserId: string): Promise<CollectionEntry> {
  const store = getStore();
  const entry = await store.collections.get(id);
  if (!entry) throw new AppError('not_found', 'Entry not found.');

  const pictures = [...(patch.posterAssetId ? [patch.posterAssetId] : []), ...(patch.stillAssetIds ?? [])];
  if (pictures.length > 0) {
    const allowed = new Set((await pictureChoicesFor(entry)).map((asset) => asset.id));
    for (const pictureId of pictures) {
      if (!allowed.has(pictureId)) throw new AppError('validation_failed', 'That picture does not belong to this film.');
    }
  }

  const parsed = CollectionEntry.safeParse({ ...entry, ...patch, updatedAt: new Date().toISOString() });
  if (!parsed.success) throw new AppError('validation_failed', parsed.error.issues[0]?.message ?? 'That does not look right.');

  let previousSlugs = parsed.data.previousSlugs;
  if (parsed.data.slug !== entry.slug) {
    const taken = await store.collections.getBySlug(parsed.data.slug);
    if (taken && taken.id !== entry.id) throw new AppError('conflict', 'That address is taken.');
    // Keep the old address only if the film was ever public under it.
    previousSlugs = entry.publishedAt ? rememberAddress(entry.previousSlugs, entry.slug, parsed.data.slug) : parsed.data.previousSlugs;
  }
  if (patch.launchOfTheWeek === true && !entry.launchOfTheWeek) {
    for (const other of await store.collections.list({ limit: 500 })) {
      if (other.id !== entry.id && other.launchOfTheWeek) await store.collections.update(other.id, { launchOfTheWeek: false });
    }
  }

  const updated = await store.collections.update(entry.id, { ...parsed.data, previousSlugs, decidedByUserId: entry.decidedByUserId ?? staffUserId });
  revalidatePublic(entry.slug);
  if (updated.slug !== entry.slug) revalidatePublic(updated.slug);
  return updated;
}

export type Decision = 'publish' | 'reject' | 'unpublish';

/**
 * A person's decision. Publishing needs consent that still stands: a
 * withdrawn film cannot be put back by staff, only by the customer.
 */
export async function decideEntry(id: string, decision: Decision, staffUserId: string, note = ''): Promise<CollectionEntry> {
  const store = getStore();
  const entry = await store.collections.get(id);
  if (!entry) throw new AppError('not_found', 'Entry not found.');
  const now = new Date().toISOString();
  const editorial = note.trim() ? { editorialNote: note.trim().slice(0, 1000) } : {};

  let status: CollectionStatus;
  if (decision === 'publish') {
    if (entry.status === 'withdrawn') throw new AppError('conflict', 'The customer withdrew this film. Only they can submit it again.');
    if (entry.status === 'published') return entry;
    status = 'published';
  } else if (decision === 'reject') {
    if (entry.status !== 'pending') throw new AppError('conflict', `Only a film under consideration can be declined; this one is ${COLLECTION_STATUS_LABELS[entry.status].toLowerCase()}.`);
    status = 'rejected';
  } else {
    if (entry.status !== 'published') return entry;
    status = 'unpublished';
  }

  const updated = await store.collections.update(entry.id, {
    status,
    decidedByUserId: staffUserId,
    decidedAt: now,
    publishedAt: status === 'published' ? (entry.publishedAt ?? now) : entry.publishedAt,
    ...editorial,
    updatedAt: now,
  });
  revalidatePublic(entry.slug);
  revalidatePath(`/app/projects/${entry.projectId}`);
  return updated;
}

export type ManualPublishInput = {
  organizationId: string;
  projectId: string;
  /** The staff member's attestation, in their words, of the written consent held. */
  consentStatement: string;
  original: boolean;
  category?: string;
  staffUserId: string;
};

/**
 * Staff publish a film themselves, with the customer's written consent on
 * file. The attestation is stored with the entry, marked as staff's, so an
 * entry always says who agreed to public display and on what basis.
 */
export async function publishManually(input: ManualPublishInput): Promise<CollectionEntry> {
  const statement = input.consentStatement.trim();
  if (statement.length < 12) throw new AppError('validation_failed', 'Say what consent is held, and where. This is stored with the entry.');
  const store = getStore();
  const project = await store.projects.get(input.organizationId, input.projectId);
  if (!project) throw new AppError('not_found', 'Project not found.');
  const render = await deliverableFor(input.organizationId, project);
  const refusal = eligibilityOf(render);
  if (refusal || !render?.masterAssetId) throw new AppError('conflict', refusal ?? 'There is no master to publish.');

  const existing = await store.collections.getForProject(input.organizationId, project.id);
  if (existing?.status === 'published') return existing;
  if (existing?.status === 'withdrawn') throw new AppError('conflict', 'The customer withdrew this film. Only they can submit it again.');

  const now = new Date().toISOString();
  const consent = { grantedByUserId: input.staffUserId, grantedAt: now, statement, byStaff: true };
  const category = CollectionCategory.safeParse(input.category);
  if (existing) {
    const updated = await store.collections.update(existing.id, {
      status: 'published',
      renderId: render.id,
      masterAssetId: render.masterAssetId,
      posterAssetId: existing.posterAssetId ?? render.posterAssetId,
      durationSeconds: render.durationSeconds,
      consent,
      original: input.original,
      ...(category.success ? { category: category.data } : {}),
      decidedByUserId: input.staffUserId,
      decidedAt: now,
      publishedAt: existing.publishedAt ?? now,
      updatedAt: now,
    });
    revalidatePublic(updated.slug);
    return updated;
  }

  const [understanding, concept] = await Promise.all([
    project.productUnderstandingId
      ? store.understandings.get(input.organizationId, project.productUnderstandingId)
      : store.understandings.getLatestForProject(input.organizationId, project.id),
    project.selectedConceptId ? store.concepts.get(input.organizationId, project.selectedConceptId) : null,
  ]);
  const company = (understanding?.name || project.name).trim().slice(0, 120);
  const created = await createWithFreeSlug(
    CollectionEntry.parse({
      id: newId('col'),
      slug: 'pending',
      organizationId: input.organizationId,
      projectId: project.id,
      renderId: render.id,
      masterAssetId: render.masterAssetId,
      posterAssetId: render.posterAssetId,
      company,
      productUrl: project.websiteUrl,
      title: (concept?.name || project.name).trim().slice(0, 140),
      tagline: (understanding?.oneLiner ?? '').slice(0, 200),
      concept: (concept?.keyIdea ?? '').slice(0, 600),
      category: category.success ? category.data : 'other',
      durationSeconds: render.durationSeconds,
      status: 'published',
      original: input.original,
      consent,
      submittedByUserId: null,
      submittedAt: now,
      decidedByUserId: input.staffUserId,
      decidedAt: now,
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
    }),
  );
  revalidatePublic(created.slug);
  return created;
}

/** Sets the editorial order: the first id comes first. */
export async function reorderEntries(ids: string[], _staffUserId: string): Promise<void> {
  const store = getStore();
  await Promise.all(ids.map((id, position) => store.collections.update(id, { position })));
  revalidatePublic();
}

/** The pictures an entry may use for its poster and stills: the film's own frames and the project's captures. */
export async function pictureChoicesFor(entry: Pick<CollectionEntry, 'organizationId' | 'projectId'>): Promise<Asset[]> {
  const assets = await getStore().assets.listForProject(entry.organizationId, entry.projectId);
  return assets.filter((asset) => asset.contentType.startsWith('image/') && !asset.contentType.includes('svg')).slice(0, 60);
}

/** Film-ready projects across the platform, for staff to publish from. */
export async function publishableProjects(limit = 50): Promise<{ project: Project; organizationName: string; entry: CollectionEntry | null }[]> {
  const store = getStore();
  const projects = await store.projects.listByStage('film_ready', limit);
  return Promise.all(
    projects.map(async (project) => {
      const [organization, entry] = await Promise.all([store.organizations.get(project.organizationId), store.collections.getForProject(project.organizationId, project.id)]);
      return { project, organizationName: organization?.name ?? project.organizationId, entry };
    }),
  );
}

function revalidatePublic(slug?: string): void {
  revalidatePath('/');
  revalidatePath('/collections');
  revalidatePath('/collections/category/[category]', 'page');
  revalidatePath('/sitemap.xml');
  if (slug) revalidatePath(`/collections/${slug}`);
}

// --- the public side -------------------------------------------------------------------

export type PublicFilm = {
  slug: string;
  path: string;
  company: string;
  title: string;
  tagline: string;
  concept: string;
  category: CollectionCategory;
  categoryLabel: string;
  launchDate: string | null;
  durationSeconds: number;
  productUrl: string;
  productHost: string;
  credit: string;
  original: boolean;
  featured: boolean;
  launchOfTheWeek: boolean;
  publishedAt: string;
  updatedAt: string;
  videoPath: string;
  posterPath: string | null;
  stillPaths: string[];
  seoTitle: string;
  seoDescription: string;
};

/** Everything published, in the editorial order. */
export async function listPublicFilms(query: { category?: CollectionCategory; limit?: number } = {}): Promise<PublicFilm[]> {
  const entries = await getStore().collections.list({ status: 'published', ...(query.category ? { category: query.category } : {}), limit: 500 });
  const ordered = orderForPublic(entries).map(publicFilmOf);
  return query.limit ? ordered.slice(0, query.limit) : ordered;
}

export async function getPublicFilm(slug: string): Promise<PublicFilm | null> {
  const entry = await getStore().collections.getBySlug(slug);
  return entry && entry.status === 'published' ? publicFilmOf(entry) : null;
}

/**
 * Where the film that used to answer at this address answers now.
 *
 * Null when no film ever had it, or when the one that did is no longer public.
 */
export async function filmMovedTo(slug: string): Promise<string | null> {
  const moved = await getStore().collections.getByFormerSlug(slug);
  return moved && moved.status === 'published' ? `/collections/${moved.slug}` : null;
}

export function publicFilmOf(entry: CollectionEntry): PublicFilm {
  const base = `/api/collections/${entry.slug}`;
  return {
    slug: entry.slug,
    path: `/collections/${entry.slug}`,
    company: entry.company,
    title: entry.title,
    tagline: entry.tagline,
    concept: entry.concept,
    category: entry.category,
    categoryLabel: COLLECTION_CATEGORY_LABELS[entry.category],
    launchDate: entry.launchDate,
    durationSeconds: entry.durationSeconds,
    productUrl: entry.productUrl,
    productHost: hostOf(entry.productUrl),
    credit: creditLine(entry),
    original: entry.original,
    featured: entry.featured,
    launchOfTheWeek: entry.launchOfTheWeek,
    publishedAt: entry.publishedAt ?? entry.updatedAt,
    updatedAt: entry.updatedAt,
    videoPath: `${base}/film`,
    posterPath: entry.posterAssetId ? `${base}/poster` : null,
    stillPaths: entry.stillAssetIds.map((_, index) => `${base}/still-${index + 1}`),
    seoTitle: entry.seoTitle || `${entry.company}: ${entry.title}`,
    seoDescription: entry.seoDescription || entry.tagline || `${entry.company}'s launch film, made by ${site.name}.`,
  };
}

export type PublicPart = 'film' | 'poster' | `still-${number}`;

/**
 * The bytes behind a public film page: the master, its poster, a still.
 *
 * Only a published entry answers, whatever the caller knows about ids. The
 * asset is read under its own workspace, because the entry is the
 * authorisation here, not a session.
 */
export async function publicFilmAsset(slug: string, part: string): Promise<Asset | null> {
  const store = getStore();
  // An old address still serves the bytes, so a poster embedded in somebody
  // else's page or a cached social card survives a rename.
  const entry = (await store.collections.getBySlug(slug)) ?? (await store.collections.getByFormerSlug(slug));
  if (!entry || entry.status !== 'published') return null;
  let assetId: string | null = null;
  if (part === 'film') assetId = entry.masterAssetId;
  else if (part === 'poster') assetId = entry.posterAssetId;
  else {
    const still = /^still-(\d+)$/.exec(part);
    if (still) assetId = entry.stillAssetIds[Number(still[1]) - 1] ?? null;
  }
  if (!assetId) return null;
  const asset = await store.assets.get(entry.organizationId, assetId);
  if (!asset) return null;
  // A film page never serves a document: an SVG from a workspace would run as us.
  if (!asset.contentType.startsWith('video/') && !asset.contentType.startsWith('image/')) return null;
  if (asset.contentType.includes('svg')) return null;
  return asset;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
