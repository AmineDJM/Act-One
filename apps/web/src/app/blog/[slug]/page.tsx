import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { Nav } from '@/components/Nav.tsx';
import { Footer } from '@/components/Footer.tsx';
import { StartProject } from '@/components/StartProject.tsx';
import { Prose } from '@/components/Prose.tsx';
import { DotMatrix } from '@/components/ui/DotMatrix.tsx';
import { getProductConfig, getSignUpPolicy } from '@/server/product.ts';
import { articleMovedTo, getPublicArticle, listPublicArticles } from '@/server/blog.ts';
import { site, absoluteUrl } from '@/lib/site.ts';
import { addresses, socialImage } from '@/lib/seo.ts';
import styles from '@/components/marketing.module.css';

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const article = await getPublicArticle((await params).slug);
  if (!article) return { title: 'Not found', robots: { index: false } };
  const image = socialImage(article.heroPath ? { url: absoluteUrl(article.heroPath), alt: article.heroAlt || article.title } : null);
  return {
    title: article.seoTitle,
    description: article.seoDescription,
    // A piece first published elsewhere points at the original; everything
    // written here points at itself.
    alternates: addresses(article.path, article.canonicalUrl),
    authors: [{ name: article.authorName }],
    openGraph: {
      type: 'article',
      title: article.title,
      description: article.seoDescription,
      url: absoluteUrl(article.path),
      siteName: site.name,
      locale: site.locale,
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt,
      authors: [article.authorName],
      tags: article.tags,
      images: [image],
    },
    twitter: { card: 'summary_large_image', title: article.title, description: article.seoDescription, images: [image.url] },
  };
}

/**
 * One article.
 *
 * The piece, the sources it leans on, and the one thing every public page
 * ends with. Bodies are Markdown rendered by our own small renderer: nothing
 * an editor or a model writes becomes HTML in this page.
 */
export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [article, policy, config] = await Promise.all([getPublicArticle(slug), getSignUpPolicy(), getProductConfig()]);
  if (!article) {
    // The piece may simply have been renamed. A permanent redirect keeps
    // every link anyone ever made to it, and tells search engines to move
    // the page rather than drop it.
    const moved = await articleMovedTo(slug);
    if (moved) permanentRedirect(moved);
    notFound();
  }
  const more = (await listPublicArticles(8)).filter((other) => other.slug !== article.slug).slice(0, 3);

  const structured = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        '@id': absoluteUrl(`${article.path}#article`),
        headline: article.title.slice(0, 110),
        description: article.seoDescription,
        datePublished: article.publishedAt,
        dateModified: article.updatedAt,
        author: { '@type': 'Organization', name: article.authorName, url: site.url },
        publisher: { '@id': absoluteUrl('/#organization') },
        mainEntityOfPage: absoluteUrl(article.path),
        ...(article.heroPath ? { image: [absoluteUrl(article.heroPath)] } : {}),
        ...(article.tags.length > 0 ? { keywords: article.tags.join(', ') } : {}),
        ...(article.sources.length > 0 ? { citation: article.sources.map((source) => source.url) } : {}),
        wordCount: article.words,
        inLanguage: 'en',
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: site.name, item: absoluteUrl('/') },
          { '@type': 'ListItem', position: 2, name: 'Journal', item: absoluteUrl('/blog') },
          { '@type': 'ListItem', position: 3, name: article.title, item: absoluteUrl(article.path) },
        ],
      },
    ],
  };

  return (
    <>
      <Nav policy={policy} />
      <main id="main">
        <article className={`shell ${styles.section}`} style={{ paddingTop: 'var(--space-8)' }}>
          <nav aria-label="Breadcrumb" className={styles.crumbs}>
            <Link href="/">{site.name}</Link>
            <span aria-hidden="true">/</span>
            <Link href="/blog">Journal</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{article.title}</span>
          </nav>

          <header className={styles.filmHead}>
            {article.categories.length > 0 ? (
              <p className="prompt" data-tone="accent">
                <span className="prompt__chevron" aria-hidden="true">&gt;</span> {article.categories.join(' · ')}
              </p>
            ) : null}
            <h1 style={{ fontSize: 'clamp(2rem, 4.2vw, 3.1rem)' }}>{article.title}</h1>
            {article.dek ? <p className="lede">{article.dek}</p> : null}
            <p className={styles.quiet}>
              {article.authorName} · {new Date(article.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} ·{' '}
              {article.readingMinutes} minute read
            </p>
          </header>

          {article.heroPath ? <img className={styles.articleHero} src={article.heroPath} alt={article.heroAlt || ''} /> : null}

          <div className={styles.articleBody}>
            {article.sections.map((section) => (
              <section key={section.id}>
                <h2>{section.heading}</h2>
                <Prose markdown={section.body} />
              </section>
            ))}
            {article.closing ? (
              <section>
                <Prose markdown={article.closing} />
              </section>
            ) : null}
          </div>

          {article.sources.length > 0 ? (
            <section className={styles.sources}>
              <p className="prompt" data-tone="muted">
                <span className="prompt__chevron" aria-hidden="true">&gt;</span> Sources
              </p>
              <ol>
                {article.sources.map((source, index) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noopener">
                      [{index + 1}] {source.title}
                    </a>
                    {source.note ? <span className="muted"> — {source.note}</span> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </article>

        <section className={`shell ${styles.section}`}>
          <div className={styles.cta}>
            <div className="dots" aria-hidden="true">
              <DotMatrix seed={`article-${article.slug}`} shape="radial" width={1200} height={300} cell={16} opacity={0.24} />
            </div>
            <h2 style={{ maxWidth: '22ch' }}>See how {site.name} would launch your product.</h2>
            <StartProject cta={config.landing.ctaLabel} policy={policy} idPrefix="article" />
          </div>
        </section>

        {more.length > 0 ? (
          <section className={`shell ${styles.section}`} aria-labelledby="more">
            <div className={styles.workHead}>
              <p className="prompt" data-tone="text">
                <span className="prompt__chevron" aria-hidden="true">&gt;</span> More from the journal
              </p>
              <h2 id="more" className="sr-only">
                More from the journal
              </h2>
              <hr className={styles.rule} />
              <Link href="/blog" className={styles.moreLink}>
                Everything →
              </Link>
            </div>
            <ul className={styles.articleList}>
              {more.map((other) => (
                <li key={other.slug}>
                  <Link href={other.path}>
                    <h3>{other.title}</h3>
                    <p>{other.dek}</p>
                    <span className={styles.quiet}>{other.readingMinutes} min</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
      <Footer />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structured) }} />
    </>
  );
}
