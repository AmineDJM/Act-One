import { describe, it, expect } from 'vitest';
import { Article, ArticleTopic, newId } from '@act-one/core';
import type { Store } from '../store.ts';
import { storeCases } from './stores.ts';

/**
 * The journal's records, against every store: one address per article, the
 * public list published-first, a schedule that comes due, and topics that
 * keep their place in the queue.
 */
let tick = 0;
function article(over: Partial<Article> = {}): Article {
  tick += 1;
  const at = new Date(Date.UTC(2026, 0, 1, 0, 0, tick)).toISOString();
  return Article.parse({
    id: newId('art'),
    slug: `piece-${newId('art').slice(-8).toLowerCase()}`,
    title: 'What a launch film has to do',
    dek: 'The first ten seconds decide everything.',
    sections: [{ id: 's1', heading: 'One', body: 'Something specific.', intent: '' }],
    createdAt: at,
    updatedAt: at,
    ...over,
  });
}

function topic(over: Partial<ArticleTopic> = {}): ArticleTopic {
  const at = new Date().toISOString();
  return ArticleTopic.parse({ id: newId('top'), title: 'Launch day', createdAt: at, updatedAt: at, ...over });
}

for (const kase of storeCases()) {
  describe(`the journal (${kase.name})`, () => {
    it('keeps one address per article and finds it by id and address', async () => {
      const store: Store = await kase.open();
      try {
        const first = await store.articles.create(article());
        expect((await store.articles.get(first.id))?.title).toBe(first.title);
        expect((await store.articles.getBySlug(first.slug))?.id).toBe(first.id);
        await expect(store.articles.create(article({ slug: first.slug }))).rejects.toThrow();
        expect(await store.articles.getBySlug('nothing-here')).toBeNull();

        const renamed = await store.articles.update(first.id, { title: 'A better title', status: 'in_review' });
        expect(renamed).toMatchObject({ title: 'A better title', status: 'in_review' });
        await store.articles.delete(first.id);
        expect(await store.articles.get(first.id)).toBeNull();
      } finally {
        await kase.close(store);
      }
    });

    it('answers at an address the article used to have', async () => {
      const store: Store = await kase.open();
      try {
        const moved = await store.articles.create(article({ slug: `was-${newId('art').slice(-8).toLowerCase()}` }));
        const before = moved.slug;
        const after = `now-${newId('art').slice(-8).toLowerCase()}`;
        await store.articles.update(moved.id, { slug: after, previousSlugs: [before] });

        expect((await store.articles.getBySlug(after))?.id).toBe(moved.id);
        expect(await store.articles.getBySlug(before)).toBeNull();
        expect((await store.articles.getByFormerSlug(before))?.id).toBe(moved.id);
        expect(await store.articles.getByFormerSlug(after)).toBeNull();
        expect(await store.articles.getByFormerSlug('never-used')).toBeNull();
      } finally {
        await kase.close(store);
      }
    });

    it('lists what is published and hands over what is due', async () => {
      const store: Store = await kase.open();
      try {
        /*
         * Published now, and due further back than anything else, because the
         * Postgres case runs against a database that outlives the process.
         *
         * What is published is listed newest first and what is due is listed
         * oldest first, so after a few hundred rows accumulate a fixture dated
         * in the middle falls outside the limit and the assertion fails for a
         * reason that has nothing to do with what it is testing.
         */
        const published = await store.articles.create(
          article({ status: 'published', publishedAt: new Date().toISOString() }),
        );
        const draft = await store.articles.create(article({ status: 'draft' }));
        /*
         * Due further back than anything else in the table, for the same
         * reason: what is due is listed oldest first, and a hundred rows left
         * behind by earlier runs all scheduled for the same instant means ours
         * ties with them and may fall outside the limit.
         */
        const due = await store.articles.create(article({ status: 'scheduled', scheduledFor: '2020-01-01T00:00:00.000Z' }));
        const later = await store.articles.create(article({ status: 'scheduled', scheduledFor: '2030-01-01T00:00:00.000Z' }));

        const mine = new Set([published.id, draft.id, due.id, later.id]);
        const live = (await store.articles.list({ status: 'published', limit: 100 })).filter((item) => mine.has(item.id));
        expect(live.map((item) => item.id)).toEqual([published.id]);

        const ready = (await store.articles.listDue('2026-06-01T00:00:00.000Z', 50)).filter((item) => mine.has(item.id));
        expect(ready.map((item) => item.id)).toEqual([due.id]);
        expect((await store.articles.countByStatus())['published']).toBeGreaterThanOrEqual(1);
      } finally {
        await kase.close(store);
      }
    });

    it('keeps topics in the order an editor would work them', async () => {
      const store: Store = await kase.open();
      try {
        const low = await store.topics.create(topic({ title: 'Low', score: 20 }));
        const high = await store.topics.create(topic({ title: 'High', score: 90 }));
        const open = (await store.topics.list({ status: 'open', limit: 100 })).filter((item) => [low.id, high.id].includes(item.id));
        expect(open.map((item) => item.id)).toEqual([high.id, low.id]);

        // The link is a real article: the schema refuses a topic pointing at nothing.
        const piece = await store.articles.create(article());
        const written = await store.topics.update(high.id, { status: 'written', articleId: piece.id });
        expect(written).toMatchObject({ status: 'written', articleId: piece.id });
        expect((await store.topics.list({ status: 'open', limit: 100 })).some((item) => item.id === high.id)).toBe(false);
        await store.topics.delete(low.id);
        expect(await store.topics.get(low.id)).toBeNull();
      } finally {
        await kase.close(store);
      }
    });
  });
}
