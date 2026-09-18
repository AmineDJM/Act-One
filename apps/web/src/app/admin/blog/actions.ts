'use server';

import { revalidatePath } from 'next/cache';
import { ArticleSource, EditorialCadence, type ArticleSection } from '@act-one/core';
import { requireSuperAdmin } from '@/server/auth.ts';
import { reportError } from '@/server/report.ts';
import {
  createArticle,
  decideArticle,
  deleteArticle,
  generateArticle,
  rewriteArticleSection,
  saveEditorialSchedule,
  suggestTopics,
  updateArticle,
  type PublishDecision,
} from '@/server/blog.ts';
import { getStore } from '@/server/store.ts';

export type BlogActionState = { error: string | null; message?: string; articleId?: string };

async function attempt(where: string, work: () => Promise<Partial<BlogActionState> | void>): Promise<BlogActionState> {
  try {
    const result = (await work()) ?? {};
    revalidatePath('/admin/blog');
    revalidatePath('/blog');
    revalidatePath('/sitemap.xml');
    return { error: null, ...result };
  } catch (error) {
    return { error: reportError(where, error).publicMessage };
  }
}

/** The journal's rules: whether the machine may draft, how often, and whether it may publish. */
export async function saveScheduleAction(_previous: BlogActionState, formData: FormData): Promise<BlogActionState> {
  return attempt('saveScheduleAction', async () => {
    const user = await requireSuperAdmin();
    await saveEditorialSchedule(
      {
        autoDraft: formData.get('autoDraft') === 'on',
        autoPublish: formData.get('autoPublish') === 'on',
        cadence: EditorialCadence.parse(String(formData.get('cadence') ?? 'weekly')),
        brief: String(formData.get('brief') ?? '').trim().slice(0, 1200),
        topics: String(formData.get('topics') ?? '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 50),
      },
      user.id,
    );
    return { message: 'Saved.' };
  });
}

export async function newArticleAction(_previous: BlogActionState, formData: FormData): Promise<BlogActionState> {
  return attempt('newArticleAction', async () => {
    const user = await requireSuperAdmin();
    const article = await createArticle(String(formData.get('title') ?? ''), user.id);
    return { message: 'Draft created.', articleId: article.id };
  });
}

/** Ask for topics worth writing. Costs a provider call; says so in the console. */
export async function suggestTopicsAction(): Promise<BlogActionState> {
  return attempt('suggestTopicsAction', async () => {
    const user = await requireSuperAdmin();
    const topics = await suggestTopics(5, user.id);
    return { message: `${topics.length} topics proposed.` };
  });
}

export async function dropTopicAction(input: { id: string }): Promise<BlogActionState> {
  return attempt('dropTopicAction', async () => {
    await requireSuperAdmin();
    await getStore().topics.update(input.id, { status: 'dropped' });
  });
}

/** Write one now: from a topic, or from a title a person typed. */
export async function generateArticleAction(_previous: BlogActionState, formData: FormData): Promise<BlogActionState> {
  return attempt('generateArticleAction', async () => {
    const user = await requireSuperAdmin();
    const sources = String(formData.get('sources') ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const [url, ...rest] = line.split(/\s+/);
        const parsed = ArticleSource.safeParse({ url, title: rest.join(' ') || url });
        return parsed.success ? [parsed.data] : [];
      })
      .slice(0, 20);
    const article = await generateArticle(
      {
        topicId: String(formData.get('topicId') ?? '') || undefined,
        title: String(formData.get('title') ?? '') || undefined,
        intent: String(formData.get('intent') ?? '') || undefined,
        sources,
      },
      user.id,
    );
    return { message: `Drafted “${article.title}”.`, articleId: article.id };
  });
}

export async function saveArticleAction(_previous: BlogActionState, formData: FormData): Promise<BlogActionState> {
  return attempt('saveArticleAction', async () => {
    const user = await requireSuperAdmin();
    const id = String(formData.get('id') ?? '');
    const text = (name: string) => String(formData.get(name) ?? '').trim();
    const headings = formData.getAll('sectionHeading').map(String);
    const bodies = formData.getAll('sectionBody').map(String);
    const ids = formData.getAll('sectionId').map(String);
    const intents = formData.getAll('sectionIntent').map(String);
    const sections: ArticleSection[] = headings
      .map((heading, index) => ({ id: ids[index] ?? '', heading: heading.trim(), body: (bodies[index] ?? '').trim(), intent: (intents[index] ?? '').trim() }))
      .filter((section) => section.heading.length > 0);

    const sources = text('sources')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const [url, ...rest] = line.split(/\s+/);
        const parsed = ArticleSource.safeParse({ url, title: rest.join(' ') || url });
        return parsed.success ? [parsed.data] : [];
      });

    await updateArticle(
      id,
      {
        title: text('title'),
        slug: text('slug'),
        dek: text('dek'),
        closing: text('closing'),
        authorName: text('authorName') || 'Act One',
        heroAssetId: text('heroAssetId') || null,
        heroAlt: text('heroAlt'),
        seoTitle: text('seoTitle'),
        seoDescription: text('seoDescription'),
        canonicalUrl: text('canonicalUrl'),
        categories: text('categories').split(',').map((value) => value.trim()).filter(Boolean).slice(0, 6),
        tags: text('tags').split(',').map((value) => value.trim()).filter(Boolean).slice(0, 12),
        sections,
        sources,
      },
      user.id,
    );
    revalidatePath(`/admin/blog/${id}`);
    return { message: 'Saved.' };
  });
}

export async function decideArticleAction(input: { id: string; decision: PublishDecision; scheduledFor?: string }): Promise<BlogActionState> {
  return attempt('decideArticleAction', async () => {
    const user = await requireSuperAdmin();
    const article = await decideArticle(input.id, input.decision, { scheduledFor: input.scheduledFor ?? null, userId: user.id });
    revalidatePath(`/admin/blog/${input.id}`);
    revalidatePath(`/blog/${article.slug}`);
    return { message: input.decision === 'publish' ? 'Published.' : input.decision === 'schedule' ? 'Scheduled.' : input.decision === 'unpublish' ? 'Unpublished.' : 'Moved to review.' };
  });
}

export async function rewriteSectionAction(input: { articleId: string; sectionId: string; instruction: string }): Promise<BlogActionState> {
  return attempt('rewriteSectionAction', async () => {
    await requireSuperAdmin();
    await rewriteArticleSection(input.articleId, input.sectionId, input.instruction);
    revalidatePath(`/admin/blog/${input.articleId}`);
    return { message: 'Section rewritten.' };
  });
}

export async function deleteArticleAction(input: { id: string }): Promise<BlogActionState> {
  return attempt('deleteArticleAction', async () => {
    await requireSuperAdmin();
    await deleteArticle(input.id);
    return { message: 'Deleted.' };
  });
}
