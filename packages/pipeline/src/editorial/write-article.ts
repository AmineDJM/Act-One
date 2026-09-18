import {
  Article,
  ArticleSource,
  ArticleTopic,
  articleSlug,
  editorialFindings,
  editorialRunDue,
  newId,
  type EditorialSchedule,
} from '@act-one/core';
import { z } from 'zod';
import type { CallContext, LlmProvider } from '@act-one/providers';
import type { Store } from '@act-one/db';

/**
 * The journal's writing pipeline.
 *
 * Topic → intent → outline → research → draft → checks, each step a separate
 * request with a schema, so a failure is one step rather than a garbled
 * article. Nothing here publishes: the pipeline's output is a draft waiting
 * for a person, and only an operator's explicit setting can change that.
 *
 * The rules the prompts are held to are the product's own: no invented
 * numbers, no listicles, no filler, and nothing said about Act One that the
 * product does not do.
 */
export type EditorialDeps = {
  store: Store;
  llm: LlmProvider;
  /** What the journal is for, from the console. */
  schedule: EditorialSchedule;
  /**
   * The provider call's context. The journal belongs to the platform rather
   * than to a customer, so its cost is recorded against the platform's own
   * workspace id, never a tenant's.
   */
  context: CallContext;
  now?: () => Date;
};

const TopicIdeas = z.object({
  topics: z
    .array(
      z.object({
        title: z.string().min(3).max(200),
        intent: z.string().max(300).default(''),
        rationale: z.string().max(400).default(''),
        keywords: z.array(z.string().min(1).max(60)).max(10).default([]),
        score: z.number().min(0).max(100).default(50),
      }),
    )
    .max(12),
});

const OutlineSchema = z.object({
  title: z.string().min(3).max(160),
  dek: z.string().max(300).default(''),
  intent: z.string().max(300).default(''),
  sections: z
    .array(z.object({ heading: z.string().min(2).max(160), intent: z.string().max(400).default('') }))
    .min(3)
    .max(8),
});

const SeoSchema = z.object({
  seoTitle: z.string().max(120).default(''),
  seoDescription: z.string().max(240).default(''),
  tags: z.array(z.string().min(1).max(40)).max(5).default([]),
  categories: z.array(z.string().min(1).max(60)).max(2).default([]),
});

const HOUSE_RULES = [
  'You write for founders and product people who are launching software.',
  'Every sentence must carry information. No filler, no throat-clearing, no "in today\'s fast-paced world".',
  'Never invent statistics, studies, quotes or customer names. If a figure is not in the sources given to you, do not state it.',
  'No listicles unless the subject genuinely is a list. Prefer an argument with evidence.',
  'Write in plain British-neutral English: short sentences, concrete nouns, active verbs.',
  'Act One makes launch films for software products: it reads a product, proposes creative directions, and produces the film. Never claim it does anything else.',
  'Never describe Act One as an "AI video generator" or compare it to template tools.',
].join('\n');

export type TopicIdea = { title: string; intent: string; rationale: string; keywords: string[]; score: number };

/**
 * What is worth writing next.
 *
 * Asks for more than it needs and keeps what is specific: a topic that could
 * have been written by anybody about any product is exactly what this
 * journal must not publish.
 */
export async function discoverTopics(deps: EditorialDeps, count = 5): Promise<TopicIdea[]> {
  const existing = await deps.store.articles.list({ limit: 60 });
  const written = existing.map((article) => `- ${article.title}`).join('\n') || '- (nothing yet)';
  const seeds = deps.schedule.topics.length > 0 ? deps.schedule.topics.map((topic) => `- ${topic}`).join('\n') : '- (none given)';

  const { value } = await deps.llm.completeJson(
    [
      { role: 'system', content: `${HOUSE_RULES}\n\nYou are the editor of Act One's journal. ${deps.schedule.brief}` },
      {
        role: 'user',
        content: [
          'Propose article topics for the journal.',
          '',
          'Already written (do not repeat, and do not write a near-duplicate):',
          written,
          '',
          'Topics the operator wants covered:',
          seeds,
          '',
          `Return ${count + 3} candidates. Each must answer a question a founder actually types into a search`,
          'engine in the weeks around a launch. Score each 0-100 on how much a reader would gain from it,',
          'penalising anything generic, anything we have covered, and anything we cannot write honestly.',
        ].join('\n'),
      },
    ],
    { schema: TopicIdeas, schemaName: 'topics', tier: 'balanced' },
    deps.context,
  );
  const result = value;

  return (result.topics ?? [])
    .map((topic) => ({ ...topic, score: Math.max(0, Math.min(100, Math.round(topic.score ?? 50))) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
}

type Outline = { title: string; dek: string; intent: string; sections: { heading: string; intent: string }[] };

async function outlineFor(deps: EditorialDeps, topic: Pick<ArticleTopic, 'title' | 'intent' | 'keywords'>): Promise<Outline> {
  const { value } = await deps.llm.completeJson(
    [
      { role: 'system', content: `${HOUSE_RULES}\n\n${deps.schedule.brief}` },
      {
        role: 'user',
        content: [
          `Plan an article on: ${topic.title}`,
          topic.intent ? `The reader wants: ${topic.intent}` : '',
          topic.keywords.length > 0 ? `Words they would search: ${topic.keywords.join(', ')}` : '',
          '',
          'Give a title a person would click without feeling tricked, one line under it that says what',
          'they will learn, and four to seven sections. Each section states what it must establish —',
          'not what it will say, what it must prove. The last section must be genuinely useful rather',
          'than a sales pitch.',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
    { schema: OutlineSchema, schemaName: 'outline', tier: 'balanced' },
    deps.context,
  );
  return value;
}

async function draftSection(
  deps: EditorialDeps,
  outline: Outline,
  section: { heading: string; intent: string },
  sources: ArticleSource[],
): Promise<string> {
  const citations = sources.length > 0 ? sources.map((source, index) => `[${index + 1}] ${source.title} — ${source.url}`).join('\n') : '(none)';
  const { value: text } = await deps.llm.complete(
    [
      { role: 'system', content: `${HOUSE_RULES}\n\n${deps.schedule.brief}` },
      {
        role: 'user',
        content: [
          `Article: ${outline.title}`,
          `Line under the title: ${outline.dek}`,
          `Section: ${section.heading}`,
          `This section must establish: ${section.intent}`,
          '',
          'Sources you may cite, and the only source of any figure:',
          citations,
          '',
          'Write the section body in Markdown: 150 to 350 words, no heading (the heading is already set),',
          'no bullet list unless the content is genuinely a list, and no figure that is not in the sources.',
          'Reference a source as [1] where you use it.',
        ].join('\n'),
      },
    ],
    { tier: 'balanced', maxOutputTokens: 900 },
    deps.context,
  );
  return text.trim();
}

export type WriteArticleInput = {
  topic: Pick<ArticleTopic, 'title' | 'intent' | 'keywords'>;
  /** Sources a person supplied; the pipeline never invents one. */
  sources?: ArticleSource[];
  createdByUserId?: string | null;
};

/**
 * Writes one article, start to finish, and leaves it as a draft.
 *
 * The slug is taken against what exists so a draft can be published later
 * without a collision, and the pipeline's own notes are kept on the article
 * for the console: which step produced what, and what the checks said.
 */
export async function writeArticle(deps: EditorialDeps, input: WriteArticleInput): Promise<Article> {
  const now = (deps.now ?? (() => new Date()))();
  const notes: string[] = [];
  const sources = (input.sources ?? []).slice(0, 20);

  const outline = await outlineFor(deps, input.topic);
  notes.push(`Outline: ${outline.sections.length} sections.`);

  const sections = [];
  for (const section of outline.sections) {
    const body = await draftSection(deps, outline, section, sources);
    sections.push({ id: newId('art'), heading: section.heading, body, intent: section.intent });
  }
  notes.push(`Drafted ${sections.length} sections.`);

  const { value: closing } = await deps.llm.complete(
    [
      { role: 'system', content: `${HOUSE_RULES}\n\n${deps.schedule.brief}` },
      {
        role: 'user',
        content: [
          `Article: ${outline.title}`,
          'Write the closing paragraph: 60 to 110 words. It must follow from the argument, and it may',
          'mention that Act One produces launch films, in one sentence, without a slogan and without',
          'an exclamation mark. No call to action beyond a plain statement of what the product does.',
        ].join('\n'),
      },
    ],
    { tier: 'balanced', maxOutputTokens: 300 },
    deps.context,
  );

  const { value: seo } = await deps.llm.completeJson(
    [
      { role: 'system', content: HOUSE_RULES },
      {
        role: 'user',
        content: [
          `Title: ${outline.title}`,
          `Line under it: ${outline.dek}`,
          `Sections: ${sections.map((section) => section.heading).join('; ')}`,
          '',
          'Give a search title of at most 60 characters, a description of 120 to 158 characters that',
          'would make the right reader click and the wrong reader skip, up to five tags and one or two',
          'categories. Plain words, no keyword stuffing, no brackets, no pipes.',
        ].join('\n'),
      },
    ],
    { schema: SeoSchema, schemaName: 'article_seo', tier: 'fast' },
    deps.context,
  );

  const taken = new Set((await deps.store.articles.list({ limit: 500 })).map((article) => article.slug));
  const article = Article.parse({
    id: newId('art'),
    slug: articleSlug(outline.title, (candidate) => taken.has(candidate)),
    title: outline.title,
    dek: outline.dek,
    intent: outline.intent,
    sections,
    closing: closing.trim(),
    sources,
    categories: (seo.categories ?? []).filter(Boolean).slice(0, 2),
    tags: (seo.tags ?? []).filter(Boolean).slice(0, 5),
    status: 'draft',
    origin: 'generated',
    seoTitle: (seo.seoTitle ?? '').slice(0, 120),
    seoDescription: (seo.seoDescription ?? '').slice(0, 240),
    updatedByUserId: input.createdByUserId ?? null,
    pipelineNotes: notes,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });

  const findings = editorialFindings(article);
  const blocking = findings.filter((finding) => finding.severity === 'blocking');
  const stored = await deps.store.articles.create({
    ...article,
    pipelineNotes: [...notes, ...findings.map((finding) => `${finding.severity === 'blocking' ? 'Blocking' : 'Warning'}: ${finding.message}`)],
    // A draft that already fails its own checks is still a draft: the console
    // shows why, and a person fixes or discards it.
    status: blocking.length > 0 ? 'draft' : 'in_review',
  });
  return stored;
}

/** Rewrites one section against its own brief, leaving the rest alone. */
export async function rewriteSection(deps: EditorialDeps, article: Article, sectionId: string, instruction: string): Promise<Article> {
  const section = article.sections.find((candidate) => candidate.id === sectionId);
  if (!section) return article;
  const body = await draftSection(
    deps,
    { title: article.title, dek: article.dek, intent: article.intent, sections: [] },
    { heading: section.heading, intent: instruction.trim() || section.intent },
    article.sources,
  );
  return deps.store.articles.update(article.id, {
    sections: article.sections.map((candidate) => (candidate.id === sectionId ? { ...candidate, body } : candidate)),
    pipelineNotes: [...article.pipelineNotes, `Rewrote "${section.heading}"${instruction ? `: ${instruction.slice(0, 120)}` : ''}.`],
  });
}

/**
 * The scheduled tick: publish what is due, and draft one piece if the
 * cadence says so.
 *
 * Returns what it did, for the worker's log. Deliberately does one article
 * per tick: a journal that publishes in bursts reads like a content farm.
 */
export async function runEditorialTick(deps: EditorialDeps): Promise<{ published: string[]; drafted: string | null }> {
  const now = (deps.now ?? (() => new Date()))();
  const published: string[] = [];

  for (const due of await deps.store.articles.listDue(now.toISOString(), 10)) {
    await deps.store.articles.update(due.id, { status: 'published', publishedAt: now.toISOString(), scheduledFor: null });
    published.push(due.slug);
  }

  if (!editorialRunDue(deps.schedule, now)) return { published, drafted: null };

  const open = await deps.store.topics.list({ status: 'open', limit: 1 });
  let topic = open[0] ?? null;
  if (!topic) {
    const [idea] = await discoverTopics(deps, 1);
    if (!idea) return { published, drafted: null };
    topic = await deps.store.topics.create(
      ArticleTopic.parse({
        id: newId('top'),
        title: idea.title,
        intent: idea.intent,
        rationale: idea.rationale,
        keywords: idea.keywords,
        score: idea.score,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }),
    );
  }

  await deps.store.topics.update(topic.id, { status: 'writing' });
  const article = await writeArticle(deps, { topic });
  await deps.store.topics.update(topic.id, { status: 'written', articleId: article.id });

  // Publishing itself is a separate permission, off unless somebody said so.
  if (deps.schedule.autoPublish && article.status === 'in_review') {
    await deps.store.articles.update(article.id, { status: 'published', publishedAt: now.toISOString() });
    published.push(article.slug);
  }
  return { published, drafted: article.slug };
}
