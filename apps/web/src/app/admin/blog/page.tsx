import Link from 'next/link';
import { ARTICLE_STATUS_LABELS, ArticleStatus, articleReadingMinutes, articleWordCount } from '@act-one/core';
import { getStore } from '@/server/store.ts';
import { getEditorialSchedule } from '@/server/blog.ts';
import { ScheduleForm } from './ScheduleForm.tsx';
import { TopicBoard } from './TopicBoard.tsx';
import { NewArticle } from './NewArticle.tsx';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

/**
 * The journal, for the operator.
 *
 * Three things, in the order they are used: what is in flight, what is worth
 * writing next, and the rules the machine is held to. Writing an article is
 * a provider call, so every button that costs money says so.
 */
export default async function BlogAdminPage() {
  const store = getStore();
  const [schedule, articles, topics, counts] = await Promise.all([
    getEditorialSchedule(),
    store.articles.list({ limit: 200 }),
    store.topics.list({ status: 'open', limit: 30 }),
    store.articles.countByStatus(),
  ]);

  return (
    <>
      <header className={styles.head}>
        <h1>The journal</h1>
        <p className="lede">
          {ArticleStatus.options.map((status) => `${counts[status] ?? 0} ${ARTICLE_STATUS_LABELS[status].toLowerCase()}`).join(' · ')}
          {schedule.autoDraft ? ` · drafting ${schedule.cadence.replace(/_/g, ' ')}` : ' · drafting off'}
          {schedule.autoPublish ? ' · publishing itself' : ''}
        </p>
      </header>

      <NewArticle topics={topics.map((topic) => ({ id: topic.id, title: topic.title }))} />

      <section className={styles.section}>
        <h2>Articles</h2>
        {articles.length === 0 ? (
          <p className={styles.empty}>Nothing written yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Origin</th>
                  <th className={styles.num}>Words</th>
                  <th className={styles.num}>Read</th>
                  <th>Address</th>
                  <th>Last touched</th>
                </tr>
              </thead>
              <tbody>
                {articles.map((article) => (
                  <tr key={article.id}>
                    <td>
                      <Link href={`/admin/blog/${article.id}`}>{article.title}</Link>
                    </td>
                    <td>
                      {ARTICLE_STATUS_LABELS[article.status]}
                      {article.scheduledFor ? ` · ${article.scheduledFor.slice(0, 16).replace('T', ' ')}` : ''}
                    </td>
                    <td className="muted">{article.origin}</td>
                    <td className={styles.num}>{articleWordCount(article)}</td>
                    <td className={styles.num}>{articleReadingMinutes(article)}m</td>
                    <td className="mono">/blog/{article.slug}</td>
                    <td className="mono muted">{article.updatedAt.slice(0, 16).replace('T', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <TopicBoard topics={topics.map((topic) => ({ id: topic.id, title: topic.title, intent: topic.intent, rationale: topic.rationale, score: topic.score, keywords: topic.keywords }))} />

      <ScheduleForm schedule={schedule} />
    </>
  );
}
