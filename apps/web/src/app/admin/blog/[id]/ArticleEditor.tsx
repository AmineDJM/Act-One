'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Article, EditorialFinding } from '@act-one/core';
import { decideArticleAction, deleteArticleAction, rewriteSectionAction, saveArticleAction, type BlogActionState } from '../actions.ts';
import styles from '../../admin.module.css';

/**
 * The article, editable.
 *
 * Section by section, because that is how a person fixes a draft: a heading
 * that is wrong, a paragraph that says nothing, a claim that needs a source.
 * Publishing sits under the checks, so nobody presses it without reading
 * what is in the way.
 */
export function ArticleEditor({ article, findings }: { article: Article; findings: EditorialFinding[] }) {
  const router = useRouter();
  const [state, save, saving] = useActionState<BlogActionState, FormData>(saveArticleAction, { error: null });
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [when, setWhen] = useState(article.scheduledFor?.slice(0, 16) ?? '');
  const blocking = findings.filter((finding) => finding.severity === 'blocking');

  const run = (work: () => Promise<BlogActionState>) =>
    start(async () => {
      const result = await work();
      setMessage(result.error ?? result.message ?? null);
      if (!result.error) router.refresh();
    });

  return (
    <>
      <section className={styles.section}>
        <h2>Before it goes out</h2>
        {findings.length === 0 ? (
          <p className="hint">Nothing in the way.</p>
        ) : (
          <ul className={styles.checklist}>
            {findings.map((finding, index) => (
              <li key={index} data-ready={finding.severity === 'warning'} data-required={finding.severity === 'blocking'}>
                <span className={styles.tick} aria-hidden="true" />
                <span>{finding.message}</span>
                <span className="mono muted">{finding.severity === 'blocking' ? 'must fix' : 'worth a look'}</span>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.customerControls}>
          <button type="button" className="btn" disabled={pending || blocking.length > 0} onClick={() => run(() => decideArticleAction({ id: article.id, decision: 'publish' }))}>
            Publish
          </button>
          <input type="datetime-local" className="input" value={when} onChange={(event) => setWhen(event.target.value)} style={{ width: 210 }} />
          <button
            type="button"
            className="btn btn--secondary"
            disabled={pending || blocking.length > 0 || !when}
            onClick={() => run(() => decideArticleAction({ id: article.id, decision: 'schedule', scheduledFor: when }))}
          >
            Schedule
          </button>
          {article.status === 'published' ? (
            <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => run(() => decideArticleAction({ id: article.id, decision: 'unpublish' }))}>
              Unpublish
            </button>
          ) : null}
          <button type="button" className="btn btn--ghost" disabled={pending} onClick={() => run(() => decideArticleAction({ id: article.id, decision: 'review' }))}>
            Mark for review
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={pending}
            onClick={() => {
              if (!confirm('Delete this article for good?')) return;
              run(async () => {
                const result = await deleteArticleAction({ id: article.id });
                if (!result.error) router.push('/admin/blog');
                return result;
              });
            }}
          >
            Delete
          </button>
          {message ? <span className="hint">{message}</span> : null}
        </div>
      </section>

      <form action={save} className={styles.section}>
        <h2>The words</h2>
        <input type="hidden" name="id" value={article.id} />
        <div className={styles.formGrid}>
          <label className="field">
            <span>Title</span>
            <input name="title" className="input" defaultValue={article.title} maxLength={160} required />
          </label>
          <label className="field">
            <span>Address</span>
            <input name="slug" className="input mono" defaultValue={article.slug} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={120} required />
          </label>
          <label className="field">
            <span>Author</span>
            <input name="authorName" className="input" defaultValue={article.authorName} maxLength={80} />
          </label>
        </div>
        <label className="field">
          <span>The line under the title</span>
          <input name="dek" className="input" defaultValue={article.dek} maxLength={300} />
        </label>

        {article.sections.map((section, index) => (
          <fieldset key={section.id} className={styles.fieldset}>
            <legend>Section {index + 1}</legend>
            <input type="hidden" name="sectionId" value={section.id} />
            <input type="hidden" name="sectionIntent" value={section.intent} />
            <label className="field">
              <span>Heading</span>
              <input name="sectionHeading" className="input" defaultValue={section.heading} maxLength={160} />
            </label>
            <label className="field">
              <span>Body (Markdown)</span>
              <textarea name="sectionBody" className="input" rows={8} defaultValue={section.body} />
            </label>
            <RewriteSection articleId={article.id} sectionId={section.id} intent={section.intent} />
          </fieldset>
        ))}

        <label className="field">
          <span>Closing</span>
          <textarea name="closing" className="input" rows={4} defaultValue={article.closing} maxLength={2000} />
        </label>
        <label className="field">
          <span>Sources, one per line: address, then the title</span>
          <textarea name="sources" className="input" rows={4} defaultValue={article.sources.map((source) => `${source.url} ${source.title}`).join('\n')} />
        </label>

        <h2>What search engines read</h2>
        <div className={styles.formGrid}>
          <label className="field">
            <span>Search title</span>
            <input name="seoTitle" className="input" defaultValue={article.seoTitle} maxLength={120} placeholder={article.title} />
          </label>
          <label className="field">
            <span>Search description</span>
            <input name="seoDescription" className="input" defaultValue={article.seoDescription} maxLength={240} placeholder={article.dek} />
          </label>
          <label className="field">
            <span>Canonical (only if this was published elsewhere first)</span>
            <input name="canonicalUrl" className="input" defaultValue={article.canonicalUrl} maxLength={400} />
          </label>
          <label className="field">
            <span>Categories, comma separated</span>
            <input name="categories" className="input" defaultValue={article.categories.join(', ')} />
          </label>
          <label className="field">
            <span>Tags, comma separated</span>
            <input name="tags" className="input" defaultValue={article.tags.join(', ')} />
          </label>
          <label className="field">
            <span>Hero picture (workspace/asset id)</span>
            <input name="heroAssetId" className="input mono" defaultValue={article.heroAssetId ?? ''} placeholder="org_…/ast_…" />
          </label>
        </div>
        <label className="field">
          <span>What the picture shows, for people who cannot see it</span>
          <input name="heroAlt" className="input" defaultValue={article.heroAlt} maxLength={200} />
        </label>

        <div className="row" style={{ gap: 'var(--space-3)', alignItems: 'center' }}>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {state.error ? <span className="error">{state.error}</span> : state.message ? <span className="hint">{state.message}</span> : null}
        </div>
      </form>
    </>
  );
}

/** One section, rewritten against a fresh instruction. */
function RewriteSection({ articleId, sectionId, intent }: { articleId: string; sectionId: string; intent: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [instruction, setInstruction] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className={styles.customerControlRow}>
      <input
        className="input"
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        placeholder={intent ? `Rewrite: ${intent}` : 'What this section should establish instead'}
        maxLength={300}
      />
      <button
        type="button"
        className="btn btn--ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await rewriteSectionAction({ articleId, sectionId, instruction });
            setMessage(result.error ?? result.message ?? null);
            if (!result.error) {
              setInstruction('');
              router.refresh();
            }
          })
        }
      >
        {pending ? 'Rewriting…' : 'Rewrite this section'}
      </button>
      {message ? <span className="hint">{message}</span> : null}
    </div>
  );
}
