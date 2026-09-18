import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { Nav } from '@/components/Nav.tsx';
import { Footer } from '@/components/Footer.tsx';
import { StartProject } from '@/components/StartProject.tsx';
import { PublicFilmCard } from '@/components/PublicFilmCard.tsx';
import { DotMatrix } from '@/components/ui/DotMatrix.tsx';
import { getProductConfig, getSignUpPolicy } from '@/server/product.ts';
import { filmMovedTo, getPublicFilm, listPublicFilms } from '@/server/collections.ts';
import { site, absoluteUrl } from '@/lib/site.ts';
import { addresses, socialImage } from '@/lib/seo.ts';
import { monthYear } from '../CollectionsIndex.tsx';
import styles from '@/components/marketing.module.css';

/*
 * Rendered per request, because a build has no database.
 *
 * This page reads published rows, and the machine that runs `next build` is
 * not the machine that runs the migrations: on a fresh environment the table
 * does not exist yet and prerendering fails the whole build. Even where it
 * succeeds it bakes in whatever was published at build time, so a film
 * selected an hour after a deploy would not appear until something else
 * triggered a rebuild.
 */
export const dynamic = 'force-dynamic';


export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const film = await getPublicFilm((await params).slug);
  if (!film) return { title: 'Not found', robots: { index: false } };
  const poster = socialImage(
    film.posterPath ? { url: absoluteUrl(film.posterPath), width: 1920, height: 1080, alt: `${film.company}: ${film.title}` } : null,
  );
  return {
    title: film.seoTitle,
    description: film.seoDescription,
    alternates: addresses(film.path),
    openGraph: {
      type: 'video.other',
      title: `${film.company}: ${film.title}`,
      description: film.seoDescription,
      url: absoluteUrl(film.path),
      siteName: site.name,
      locale: site.locale,
      images: [poster],
      videos: [{ url: absoluteUrl(film.videoPath), type: 'video/mp4', width: 1920, height: 1080 }],
    },
    twitter: {
      card: 'player',
      title: `${film.company}: ${film.title}`,
      description: film.seoDescription,
      images: [poster.url],
    },
  };
}

export default async function CollectionFilmPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [film, policy, config] = await Promise.all([getPublicFilm(slug), getSignUpPolicy(), getProductConfig()]);
  if (!film) {
    // A film whose address changed keeps answering at the old one.
    const moved = await filmMovedTo(slug);
    if (moved) permanentRedirect(moved);
    notFound();
  }
  const more = (await listPublicFilms({ limit: 12 })).filter((other) => other.slug !== film.slug).slice(0, 3);

  const video = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'VideoObject',
        '@id': absoluteUrl(`${film.path}#video`),
        name: `${film.company}: ${film.title}`,
        description: film.seoDescription,
        ...(film.posterPath ? { thumbnailUrl: [absoluteUrl(film.posterPath)] } : {}),
        uploadDate: film.publishedAt,
        duration: isoDuration(film.durationSeconds),
        contentUrl: absoluteUrl(film.videoPath),
        embedUrl: absoluteUrl(film.path),
        url: absoluteUrl(film.path),
        inLanguage: 'en',
        genre: film.categoryLabel,
        producer: { '@id': absoluteUrl('/#organization') },
        publisher: { '@id': absoluteUrl('/#organization') },
        ...(film.original ? {} : { about: { '@type': 'Organization', name: film.company, url: film.productUrl } }),
        isPartOf: { '@id': absoluteUrl('/collections#page') },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: site.name, item: absoluteUrl('/') },
          { '@type': 'ListItem', position: 2, name: 'Collections', item: absoluteUrl('/collections') },
          { '@type': 'ListItem', position: 3, name: film.categoryLabel, item: absoluteUrl(`/collections/category/${film.category}`) },
          { '@type': 'ListItem', position: 4, name: `${film.company}: ${film.title}`, item: absoluteUrl(film.path) },
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
            <Link href="/collections">Collections</Link>
            <span aria-hidden="true">/</span>
            <Link href={`/collections/category/${film.category}`}>{film.categoryLabel}</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{film.company}</span>
          </nav>

          <header className={styles.filmHead}>
            <p className="prompt" data-tone="accent">
              <span className="prompt__chevron" aria-hidden="true">&gt;</span> {film.company}
              {film.launchOfTheWeek ? ' · Launch of the week' : film.featured ? ' · Featured' : ''}
            </p>
            <h1 style={{ fontSize: 'clamp(2.1rem, 4.4vw, 3.3rem)' }}>{film.title}</h1>
            {film.tagline ? <p className="lede">{film.tagline}</p> : null}
          </header>

          <div className={styles.filmPlayer}>
            <video src={film.videoPath} {...(film.posterPath ? { poster: film.posterPath } : {})} controls playsInline preload="metadata" />
          </div>

          <div className={styles.filmFacts}>
            <dl className={styles.factList}>
              <div>
                <dt>Product</dt>
                <dd>
                  <a href={film.productUrl} target="_blank" rel="noopener">
                    {film.productHost} ↗
                  </a>
                </dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>
                  <Link href={`/collections/category/${film.category}`}>{film.categoryLabel}</Link>
                </dd>
              </div>
              {film.launchDate ? (
                <div>
                  <dt>Launched</dt>
                  <dd>{monthYear(film.launchDate)}</dd>
                </div>
              ) : null}
              <div>
                <dt>Runtime</dt>
                <dd>{Math.round(film.durationSeconds)}s</dd>
              </div>
              <div>
                <dt>Credit</dt>
                <dd className={styles.credit}>{film.credit}</dd>
              </div>
            </dl>
            {film.concept ? (
              <div className={styles.concept}>
                <p className="prompt" data-tone="muted">
                  <span className="prompt__chevron" aria-hidden="true">&gt;</span> The concept
                </p>
                <p>{film.concept}</p>
              </div>
            ) : null}
          </div>

          {film.stillPaths.length > 0 ? (
            <div className={styles.stills} aria-label="Stills">
              {film.stillPaths.map((still, index) => (
                <img key={still} src={still} alt={`${film.company}: ${film.title}, frame ${index + 1}`} loading="lazy" />
              ))}
            </div>
          ) : null}
        </article>

        <section className={`shell ${styles.section}`}>
          <div className={styles.cta}>
            <div className="dots" aria-hidden="true">
              <DotMatrix seed={`film-${film.slug}`} shape="orbit" width={1200} height={320} cell={16} opacity={0.26} />
            </div>
            <p className="prompt" data-tone="text">
              <span className="prompt__chevron" aria-hidden="true">&gt;</span> Create your Act One
            </p>
            <h2 style={{ maxWidth: '22ch' }}>See how {site.name} would launch your product.</h2>
            <StartProject cta={config.landing.ctaLabel} policy={policy} idPrefix="film" />
          </div>
        </section>

        {more.length > 0 ? (
          <section className={`shell ${styles.section}`} aria-labelledby="more">
            <div className={styles.workHead}>
              <p className="prompt" data-tone="text">
                <span className="prompt__chevron" aria-hidden="true">&gt;</span> More from Collections
              </p>
              <h2 id="more" className="sr-only">
                More from Collections
              </h2>
              <hr className={styles.rule} />
              <Link href="/collections" className={styles.moreLink}>
                All of Collections →
              </Link>
            </div>
            <div className={styles.filmGrid}>
              {more.map((other) => (
                <PublicFilmCard
                  key={other.slug}
                  href={other.path}
                  videoSrc={other.videoPath}
                  posterSrc={other.posterPath}
                  company={other.company}
                  title={other.title}
                  tagline={other.tagline}
                  categoryLabel={other.categoryLabel}
                  credit={other.credit}
                  durationSeconds={other.durationSeconds}
                  featured={other.featured}
                />
              ))}
            </div>
          </section>
        ) : null}
      </main>
      <Footer />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(video) }} />
    </>
  );
}

function isoDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `PT${minutes > 0 ? `${minutes}M` : ''}${rest}S`;
}
