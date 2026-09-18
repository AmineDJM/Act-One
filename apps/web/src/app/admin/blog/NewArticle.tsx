'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { generateArticleAction, newArticleAction, type BlogActionState } from './actions.ts';
import styles from '../admin.module.css';

/**
 * Two ways to start: a person writes it, or the machine drafts it.
 *
 * Both produce a draft in the same place. The generated one says where its
 * figures may come from, because the pipeline will not invent any.
 */
export function NewArticle({ topics }: { topics: { id: string; title: string }[] }) {
  const router = useRouter();
  const [blank, startBlank, creating] = useActionState<BlogActionState, FormData>(newArticleAction, { error: null });
  const [drafted, startDraft, drafting] = useActionState<BlogActionState, FormData>(generateArticleAction, { error: null });
  const [open, setOpen] = useState(false);

  const goto = (state: BlogActionState) => {
    if (state.articleId) router.push(`/admin/blog/${state.articleId}`);
  };
  if (blank.articleId) goto(blank);
  if (drafted.articleId) goto(drafted);

  return (
    <section className={styles.section}>
      <h2>Write something</h2>
      <form action={startBlank} className={styles.customerControlRow}>
        <input name="title" className="input" placeholder="Title of a new empty draft" maxLength={160} required />
        <button type="submit" className="btn btn--secondary" disabled={creating}>
          {creating ? 'Creating…' : 'New draft'}
        </button>
        {blank.error ? <span className="error">{blank.error}</span> : null}
      </form>

      {!open ? (
        <div>
          <button type="button" className="btn btn--ghost" onClick={() => setOpen(true)}>
            Have it drafted →
          </button>
        </div>
      ) : (
        <form action={startDraft} className={styles.entryForm}>
          <div className={styles.formGrid}>
            <label className="field">
              <span>From a topic</span>
              <select name="topicId" className="input" defaultValue="">
                <option value="">(type a title instead)</option>
                {topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Or a title</span>
              <input name="title" className="input" maxLength={160} placeholder="What a launch film has to do in ten seconds" />
            </label>
          </div>
          <label className="field">
            <span>What the reader wants (optional)</span>
            <input name="intent" className="input" maxLength={300} />
          </label>
          <label className="field">
            <span>Sources, one per line: address, then the title. Any figure in the article must come from one of these.</span>
            <textarea name="sources" className="input" rows={3} placeholder="https://example.com/study  The title of the study" />
          </label>
          <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
            <button type="submit" className="btn" disabled={drafting}>
              {drafting ? 'Writing…' : 'Draft it'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)} disabled={drafting}>
              Cancel
            </button>
            <span className="muted" style={{ fontSize: '0.84rem' }}>
              Costs a handful of model calls. The result is a draft; nothing publishes itself.
            </span>
            {drafted.error ? <span className="error">{drafted.error}</span> : drafted.message ? <span className="hint">{drafted.message}</span> : null}
          </div>
        </form>
      )}
    </section>
  );
}
