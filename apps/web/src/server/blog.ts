import 'server-only';
import {
  AppError,
  Article,
  ArticleSource,
  ArticleTopic,
  DEFAULT_EDITORIAL_SCHEDULE,
  PLATFORM_ORGANIZATION_ID,
  EditorialSchedule,
  articleReadingMinutes,
  articleSlug,
  articleWordCount,
  editorialFindings,
  newId,
  rememberAddress,
  type EditorialFinding,
} from '@act-one/core';
import { site } from '@/lib/site.ts';
import { getStore } from './store.ts';
import { buildRegistry } from './platform.ts';
import { getProductConfig, saveProductConfig } from './product.ts';

/**
 * The journal, at the layer that decides what is public.
 *
 * Reading is open to anybody and only ever returns what is published;
 * everything that writes is staff-only and is called from the console's own
 * actions, which check first. Publication is an explicit act with a check
 * list behind it: an article that fails its own standards cannot be
 * published by accident.
 */
export async function getEditorialSchedule(): Promise<EditorialSchedule> {
  try {
    return (await getProductConfig()).editorial;
  } catch {
    return DEFAULT_EDITORIAL_SCHEDULE;
  }
}

export async function saveEditorialSchedule(patch: Partial<EditorialSchedule>, updatedBy: string): Promise<EditorialSchedule> {
  const current = await getEditorialSchedule();
  const next = EditorialSchedule.parse({ ...current, ...patch });
  await saveProductConfig({ editorial: next }, updatedBy);
  return next;
}

// --- the public journal -----------------------------------------------------------

export type PublicArticle = {
  slug: string;
  path: string;
  title: string;
  dek: string;
  sections: { id: string; heading: string; body: string }[];
  closing: string;
  sources: ArticleSource[];
  categories: string[];
  tags: string[];
  authorName: string;
  heroPath: string | null;
  heroAlt: string;
  publishedAt: string;
  updatedAt: string;
  readingMinutes: number;
  words: number;
  seoTitle: string;
  seoDescription: string;
  canonicalUrl: string;
};

function publicArticleOf(article: Article): PublicArticle {
  return {
    slug: article.slug,
    path: `/blog/${article.slug}`,
    title: article.title,
    dek: article.dek,
    sections: article.sections.map((section) => ({ id: section.id, heading: section.heading, body: section.body })),
    closing: article.closing,
    sources: article.sources,
    categories: article.categories,
    tags: article.tags,
    authorName: article.authorName || site.name,
    heroPath: article.heroAssetId ? `/api/blog/${article.slug}/hero` : null,
    heroAlt: article.heroAlt,
    publishedAt: article.publishedAt ?? article.updatedAt,
    updatedAt: article.updatedAt,
    readingMinutes: articleReadingMinutes(article),
    words: articleWordCount(article),
    seoTitle: article.seoTitle || article.title,
    seoDescription: article.seoDescription || article.dek,
    canonicalUrl: article.canonicalUrl,
  };
}

export async function listPublicArticles(limit = 50): Promise<PublicArticle[]> {
  const articles = await getStore().articles.list({ status: 'published', limit });
  return articles.map(publicArticleOf);
}

export async function getPublicArticle(slug: string): Promise<PublicArticle | null> {
  const article = await getStore().articles.getBySlug(slug);
  return article && article.status === 'published' ? publicArticleOf(article) : null;
}

/**
 * Where the article that used to answer at this address answers now.
 *
 * Null when no article ever had it, or when the one that did is not public.
 */
export async function articleMovedTo(slug: string): Promise<string | null> {
  const moved = await getStore().articles.getByFormerSlug(slug);
  return moved && moved.status === 'published' ? `/blog/${moved.slug}` : null;
}

/** The hero picture of a published article, by the article's own address. */
export async function publicArticleHero(slug: string): Promise<{ organizationId: string; assetId: string } | null> {
  const store = getStore();
  // An old address still serves the picture: a social card cached under the
  // previous link keeps working instead of turning into a broken box.
  const article = (await store.articles.getBySlug(slug)) ?? (await store.articles.getByFormerSlug(slug));
  if (!article || article.status !== 'published' || !article.heroAssetId) return null;
  // A hero is chosen in the console from the platform's own library; the id
  // carries its workspace so the bytes can be read without a session.
  const [organizationId, assetId] = article.heroAssetId.includes('/') ? article.heroAssetId.split('/') : [null, article.heroAssetId];
  return organizationId && assetId ? { organizationId, assetId } : null;
}

// --- the console ------------------------------------------------------------------

export type ArticleView = { article: Article; findings: EditorialFinding[]; words: number; readingMinutes: number };

export async function loadArticle(id: string): Promise<ArticleView> {
  const article = await getStore().articles.get(id);
  if (!article) throw new AppError('not_found', 'Article not found.');
  return { article, findings: editorialFindings(article), words: articleWordCount(article), readingMinutes: articleReadingMinutes(article) };
}

export async function createArticle(title: string, userId: string): Promise<Article> {
  const store = getStore();
  const clean = title.trim().slice(0, 160) || 'Untitled';
  const taken = new Set((await store.articles.list({ limit: 500 })).map((article) => article.slug));
  const now = new Date().toISOString();
  return store.articles.create(
    Article.parse({
      id: newId('art'),
      slug: articleSlug(clean, (candidate) => taken.has(candidate)),
      title: clean,
      status: 'draft',
      origin: 'written',
      updatedByUserId: userId,
      createdAt: now,
      updatedAt: now,
    }),
  );
}

export type ArticlePatch = Partial<
  Pick<Article, 'title' | 'slug' | 'dek' | 'intent' | 'sections' | 'closing' | 'sources' | 'categories' | 'tags' | 'authorName' | 'heroAssetId' | 'heroAlt' | 'seoTitle' | 'seoDescription' | 'canonicalUrl'>
>;

export async function updateArticle(id: string, patch: ArticlePatch, userId: string): Promise<Article> {
  const store = getStore();
  const current = await store.articles.get(id);
  if (!current) throw new AppError('not_found', 'Article not found.');
  const parsed = Article.safeParse({ ...current, ...patch, updatedByUserId: userId, updatedAt: new Date().toISOString() });
  if (!parsed.success) throw new AppError('validation_failed', parsed.error.issues[0]?.message ?? 'That does not look right.');
  let previousSlugs = parsed.data.previousSlugs;
  if (parsed.data.slug !== current.slug) {
    const taken = await store.articles.getBySlug(parsed.data.slug);
    if (taken && taken.id !== id) throw new AppError('conflict', 'That address is taken.');
    // Only an address the public could have linked to is worth keeping: a
    // draft renamed before it ever went live was never anywhere.
    previousSlugs = current.publishedAt ? rememberAddress(current.previousSlugs, current.slug, parsed.data.slug) : parsed.data.previousSlugs;
  }
  return store.articles.update(id, {
    ...parsed.data,
    previousSlugs,
    origin: current.origin === 'generated' ? 'assisted' : current.origin,
  });
}

export type PublishDecision = 'publish' | 'schedule' | 'unpublish' | 'review';

/**
 * Publication, with the standards in the way.
 *
 * A blocking finding stops it: a person may override the machine's opinion
 * by fixing the article, never by pressing harder.
 */
export async function decideArticle(id: string, decision: PublishDecision, options: { scheduledFor?: string | null; userId: string }): Promise<Article> {
  const store = getStore();
  const article = await store.articles.get(id);
  if (!article) throw new AppError('not_found', 'Article not found.');
  const now = new Date().toISOString();

  if (decision === 'unpublish') return store.articles.update(id, { status: 'unpublished', updatedByUserId: options.userId });
  if (decision === 'review') return store.articles.update(id, { status: 'in_review', updatedByUserId: options.userId });

  const blocking = editorialFindings(article).filter((finding) => finding.severity === 'blocking');
  if (blocking.length > 0) throw new AppError('validation_failed', blocking[0]!.message);

  if (decision === 'schedule') {
    const when = options.scheduledFor ?? '';
    if (!when || Number.isNaN(Date.parse(when))) throw new AppError('validation_failed', 'Give a date and time to publish it.');
    return store.articles.update(id, { status: 'scheduled', scheduledFor: new Date(when).toISOString(), updatedByUserId: options.userId });
  }
  return store.articles.update(id, { status: 'published', publishedAt: article.publishedAt ?? now, scheduledFor: null, updatedByUserId: options.userId });
}

export async function deleteArticle(id: string): Promise<void> {
  await getStore().articles.delete(id);
}

// --- the machine's side -----------------------------------------------------------

async function editorialDeps() {
  const registry = await buildRegistry({ organizationId: PLATFORM_ORGANIZATION_ID, projectId: null });
  return {
    store: getStore(),
    llm: registry.llm(),
    schedule: await getEditorialSchedule(),
    context: { organizationId: PLATFORM_ORGANIZATION_ID, projectId: null },
  };
}

/** Topics the console can act on: whatever is open, plus new ideas on demand. */
export async function suggestTopics(count: number, userId: string): Promise<ArticleTopic[]> {
  const { discoverTopics } = await import('@act-one/pipeline/editorial');
  const deps = await editorialDeps();
  const ideas = await discoverTopics(deps, Math.max(1, Math.min(count, 8)));
  const now = new Date().toISOString();
  return Promise.all(
    ideas.map((idea) =>
      getStore().topics.create(
        ArticleTopic.parse({
          id: newId('top'),
          title: idea.title,
          intent: idea.intent,
          rationale: idea.rationale,
          keywords: idea.keywords,
          score: idea.score,
          createdByUserId: userId,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    ),
  );
}

/** Writes an article now, from a topic or from a title a person typed. */
export async function generateArticle(input: { topicId?: string; title?: string; intent?: string; sources?: ArticleSource[] }, userId: string): Promise<Article> {
  const { writeArticle } = await import('@act-one/pipeline/editorial');
  const store = getStore();
  const deps = await editorialDeps();

  const topic = input.topicId ? await store.topics.get(input.topicId) : null;
  const brief = topic
    ? { title: topic.title, intent: topic.intent, keywords: topic.keywords }
    : { title: (input.title ?? '').trim(), intent: (input.intent ?? '').trim(), keywords: [] };
  if (!brief.title) throw new AppError('validation_failed', 'Say what the article is about.');

  if (topic) await store.topics.update(topic.id, { status: 'writing' });
  const article = await writeArticle(deps, { topic: brief, sources: input.sources ?? [], createdByUserId: userId });
  if (topic) await store.topics.update(topic.id, { status: 'written', articleId: article.id });
  return article;
}

export async function rewriteArticleSection(articleId: string, sectionId: string, instruction: string): Promise<Article> {
  const { rewriteSection } = await import('@act-one/pipeline/editorial');
  const store = getStore();
  const article = await store.articles.get(articleId);
  if (!article) throw new AppError('not_found', 'Article not found.');
  return rewriteSection(await editorialDeps(), article, sectionId, instruction);
}
