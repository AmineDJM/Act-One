import Link from 'next/link';
import { getStore } from '@/server/store.ts';
import { listPublicFilms } from '@/server/collections.ts';
import { listPublicArticles } from '@/server/blog.ts';
import { site, absoluteUrl, SEARCH_INTENTS, LANDING_DESCRIPTION } from '@/lib/site.ts';
import { getProductConfig } from '@/server/product.ts';
import { SeoForm } from './SeoForm.tsx';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

/**
 * What search engines can see, and what is standing in the way.
 *
 * Not a dashboard of vanity numbers: the set of facts an operator needs to
 * answer "is this site indexable, and is anything about to fall out of the
 * index?". Everything here is read from the same code the public pages use,
 * so it cannot claim a page is fine when the page disagrees.
 */
export default async function SeoPage() {
  const store = getStore();
  const [films, articles, counts, config] = await Promise.all([
    listPublicFilms().catch(() => []),
    listPublicArticles(500).catch(() => []),
    store.articles.countByStatus().catch(() => ({}) as Record<string, number>),
    getProductConfig(),
  ]);

  const production = !site.url.includes('localhost') && !config.seo.discourageIndexing;
  const indexed = [
    { path: '/', what: 'Landing' },
    { path: '/how-it-works', what: 'How it works' },
    { path: '/work', what: 'Reference films' },
    { path: '/pricing', what: 'Pricing' },
    { path: '/collections', what: 'Collections' },
    { path: '/blog', what: 'Journal' },
  ];

  // The two ways an article quietly fails: no description, or a picture with
  // nothing said about it. Both are visible here before a reader finds them.
  const thin = articles.filter((article) => article.seoDescription.length < 70 || article.seoDescription.length > 165);
  const mute = articles.filter((article) => article.heroPath && !article.heroAlt.trim());
  const noPicture = films.filter((film) => !film.posterPath);

  return (
    <>
      <header className={styles.head}>
        <h1>Search</h1>
        <p className="lede">
          {production
            ? 'This deployment is indexable.'
            : config.seo.discourageIndexing
              ? 'This deployment is held back from search by the setting below. Nothing here can be found until it is off.'
              : 'This deployment is not indexable: robots.txt disallows everything until the site runs on its real address.'}{' '}
          {indexed.length + films.length + articles.length} pages in the sitemap.
        </p>
      </header>

      <section className={styles.section}>
        <h2>What is in the map</h2>
        <div className={styles.metrics}>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>Fixed pages</span>
            <span className={styles.metricValue}>{indexed.length}</span>
            <span className={styles.metricNote}>Landing, process, work, pricing, gallery, journal</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>Published films</span>
            <span className={styles.metricValue}>{films.length}</span>
            <span className={styles.metricNote}>Each with VideoObject and a poster</span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>Published articles</span>
            <span className={styles.metricValue}>{articles.length}</span>
            <span className={styles.metricNote}>
              {Object.entries(counts)
                .filter(([status]) => status !== 'published')
                .map(([status, count]) => `${count} ${status}`)
                .join(' · ') || 'nothing waiting'}
            </span>
          </div>
        </div>
        <ul className={styles.linkList}>
          <li>
            <code>{absoluteUrl('/sitemap.xml')}</code>
            <a className="btn btn--ghost" href="/sitemap.xml" target="_blank" rel="noreferrer">
              Open
            </a>
          </li>
          <li>
            <code>{absoluteUrl('/robots.txt')}</code>
            <a className="btn btn--ghost" href="/robots.txt" target="_blank" rel="noreferrer">
              Open
            </a>
          </li>
          <li>
            <code>{absoluteUrl('/opengraph-image')}</code>
            <a className="btn btn--ghost" href="/opengraph-image" target="_blank" rel="noreferrer">
              Open
            </a>
          </li>
        </ul>
      </section>

      <SeoForm seo={config.seo} fallback={LANDING_DESCRIPTION} />

      <section className={styles.section}>
        <h2>Standing in the way</h2>
        {thin.length === 0 && mute.length === 0 && noPicture.length === 0 ? (
          <p className="hint">Nothing. Every published page has a description search results can use and a picture with words for it.</p>
        ) : (
          <ul className={styles.checklist}>
            {thin.map((article) => (
              <li key={`thin-${article.slug}`} data-ready="false" data-required="true">
                <span className={styles.tick} aria-hidden="true" />
                <span>
                  <Link href={`/blog/${article.slug}`} target="_blank" rel="noreferrer">
                    {article.title}
                  </Link>{' '}
                  has a {article.seoDescription.length}-character description; search shows about 155.
                </span>
                <span className="mono muted">journal</span>
              </li>
            ))}
            {mute.map((article) => (
              <li key={`mute-${article.slug}`} data-ready="false" data-required="true">
                <span className={styles.tick} aria-hidden="true" />
                <span>{article.title} has a picture with nothing said about it.</span>
                <span className="mono muted">journal</span>
              </li>
            ))}
            {noPicture.map((film) => (
              <li key={`film-${film.slug}`} data-ready="false" data-required="false">
                <span className={styles.tick} aria-hidden="true" />
                <span>
                  {film.company}: {film.title} has no poster frame, so its card and social preview are plain.
                </span>
                <span className="mono muted">collections</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section}>
        <h2>What the pages are written against</h2>
        <p className="muted" style={{ fontSize: '0.88rem', maxWidth: '68ch' }}>
          Not keywords in a meta tag — those have been ignored for a decade. These are the intents the copy, the
          headings and the internal links are pointed at, so the public pages argue for the same thing.
        </p>
        <ul className={styles.linkList}>
          <li>
            <code>{SEARCH_INTENTS.primary}</code>
          </li>
          {SEARCH_INTENTS.secondary.map((intent) => (
            <li key={intent}>
              <code>{intent}</code>
            </li>
          ))}
        </ul>
        <p className="muted" style={{ fontSize: '0.84rem' }}>
          Canonical origin: <code className="mono">{site.url}</code>. Set <code className="mono">ACT_ONE_SITE_URL</code> in production, or
          every canonical, sitemap entry and social card points at the wrong host.
        </p>
      </section>
    </>
  );
}
