import type { Metadata } from 'next';
import Link from 'next/link';
import { Nav } from '@/components/Nav.tsx';
import { Footer } from '@/components/Footer.tsx';
import { StartProject } from '@/components/StartProject.tsx';
import { DotMatrix } from '@/components/ui/DotMatrix.tsx';
import { getProductConfig, getSignUpPolicy } from '@/server/product.ts';
import { listPublicArticles } from '@/server/blog.ts';
import { site, absoluteUrl } from '@/lib/site.ts';
import { breadcrumbs, itemList, jsonLd, pageMetadata } from '@/lib/seo.ts';
import styles from '@/components/marketing.module.css';

export const revalidate = 300;

export const metadata: Metadata = pageMetadata({
  title: 'Journal',
  description: `How software launches earn attention: what a launch film has to do, what separates one from a demo, and what founders get wrong on launch day. Written by ${site.name}.`,
  path: '/blog',
});

/**
 * The journal's index.
 *
 * Articles in the order they were published, newest first, with the reading
 * time stated so nobody is surprised. No infinite feed, no tag cloud: this
 * is a place to read one thing.
 */
export default async function BlogIndex() {
  const [articles, policy, config] = await Promise.all([listPublicArticles(60), getSignUpPolicy(), getProductConfig()]);
  const [lead, ...rest] = articles;

  return (
    <>
      <Nav policy={policy} />
      <main id="main">
        <section className={`shell ${styles.section}`} style={{ paddingTop: 'var(--space-8)' }}>
          <nav aria-label="Breadcrumb" className={styles.crumbs}>
            <Link href="/">{site.name}</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">Journal</span>
          </nav>
          <div className={styles.sectionHead}>
            <p className="prompt" data-tone="text">
              <span className="prompt__chevron" aria-hidden="true">&gt;</span> Journal
            </p>
            <h1 style={{ fontSize: 'clamp(2.2rem, 4.6vw, 3.4rem)' }}>On launching software.</h1>
            <p className="lede">
              What a launch film has to do in its first three seconds, why a demo is not a film, and what we have
              learned making them. Written here, edited by a person.
            </p>
          </div>

          {articles.length === 0 ? (
            <div className={styles.emptyGallery}>
              <div className="dots" aria-hidden="true">
                <DotMatrix seed="journal-empty" shape="drift" width={900} height={220} cell={14} opacity={0.3} />
              </div>
              <p className="prompt" data-tone="muted">
                <span className="prompt__chevron" aria-hidden="true">&gt;</span> The first pieces are being written.
              </p>
            </div>
          ) : null}

          {lead ? (
            <article className={styles.leadArticle}>
              <p className="prompt" data-tone="accent">
                <span className="prompt__chevron" aria-hidden="true">&gt;</span> {lead.categories[0] ?? 'Latest'}
              </p>
              <h2>
                <Link href={lead.path}>{lead.title}</Link>
              </h2>
              <p className="lede">{lead.dek}</p>
              <p className={styles.quiet}>
                {new Date(lead.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · {lead.readingMinutes} minute read
              </p>
            </article>
          ) : null}

          {rest.length > 0 ? (
            <ul className={styles.articleList}>
              {rest.map((article) => (
                <li key={article.slug}>
                  <Link href={article.path}>
                    <h3>{article.title}</h3>
                    <p>{article.dek}</p>
                    <span className={styles.quiet}>
                      {new Date(article.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {article.readingMinutes} min
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className={`shell ${styles.section}`}>
          <div className={styles.cta}>
            <div className="dots" aria-hidden="true">
              <DotMatrix seed="journal-cta" shape="wave" width={1200} height={300} cell={16} opacity={0.24} />
            </div>
            <h2 style={{ maxWidth: '22ch' }}>See how {site.name} would launch your product.</h2>
            <StartProject cta={config.landing.ctaLabel} policy={policy} idPrefix="journal" />
          </div>
        </section>
      </main>
      <Footer />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            { '@type': 'Blog', '@id': `${site.url}/blog#blog`, name: `${site.name} Journal`, url: `${site.url}/blog`, publisher: { '@id': `${site.url}/#organization` }, inLanguage: 'en' },
            breadcrumbs([{ name: 'Journal', path: '/blog' }]),
            itemList('Articles', articles.map((article) => ({ name: article.title, path: article.path }))),
          ),
        }}
      />
    </>
  );
}
