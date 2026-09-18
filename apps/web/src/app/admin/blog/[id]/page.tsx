import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ARTICLE_STATUS_LABELS, toAppError } from '@act-one/core';
import { loadArticle } from '@/server/blog.ts';
import { ArticleEditor } from './ArticleEditor.tsx';
import styles from '../../admin.module.css';

export const dynamic = 'force-dynamic';

/**
 * One article, with everything a person needs to decide about it: the words,
 * the fields search engines read, the sources, what the checks say, and what
 * the pipeline did to produce it.
 */
export default async function ArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let view: Awaited<ReturnType<typeof loadArticle>>;
  try {
    view = await loadArticle(id);
  } catch (error) {
    if (toAppError(error).code === 'not_found') notFound();
    throw error;
  }

  const { article, findings, words, readingMinutes } = view;

  return (
    <>
      <header className={styles.head}>
        <h1>{article.title}</h1>
        <p className="lede">
          {ARTICLE_STATUS_LABELS[article.status]} · {article.origin} · {words} words · {readingMinutes} minute read ·{' '}
          <Link href={`/blog/${article.slug}`} target="_blank" rel="noreferrer">
            /blog/{article.slug}
          </Link>
        </p>
      </header>

      <ArticleEditor article={article} findings={findings} />

      {article.pipelineNotes.length > 0 ? (
        <section className={styles.section}>
          <h2>What the editor did</h2>
          <ul className={styles.linkList}>
            {article.pipelineNotes.map((note, index) => (
              <li key={index}>
                <code>{note}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
