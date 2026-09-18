import Link from 'next/link';
import { COLLECTION_CATEGORY_LABELS, CollectionCategory, type SignUpPolicy } from '@act-one/core';
import { Nav } from '@/components/Nav.tsx';
import { Footer } from '@/components/Footer.tsx';
import { StartProject } from '@/components/StartProject.tsx';
import { PublicFilmCard } from '@/components/PublicFilmCard.tsx';
import { DotMatrix } from '@/components/ui/DotMatrix.tsx';
import { site, absoluteUrl } from '@/lib/site.ts';
import type { PublicFilm } from '@/server/collections.ts';
import styles from '@/components/marketing.module.css';

/**
 * The gallery, on one page or narrowed to a category.
 *
 * Real launches, made here, selected by a person. The launch of the week
 * leads when there is one; the rest follow in the editorial order. Every
 * film is a page of its own, and the page ends where every public page
 * ends: at the door.
 */
export function CollectionsIndex({ films, category, policy, cta }: { films: PublicFilm[]; category: CollectionCategory | null; policy: SignUpPolicy; cta: string }) {
  const lead = category === null ? (films.find((film) => film.launchOfTheWeek) ?? null) : null;
  const rest = lead ? films.filter((film) => film.slug !== lead.slug) : films;
  const counts = new Map<CollectionCategory, number>();
  for (const film of films) counts.set(film.category, (counts.get(film.category) ?? 0) + 1);

  return (
    <>
      <Nav policy={policy} />
      <main id="main">
        <section className={`shell ${styles.section}`} style={{ paddingTop: 'var(--space-8)' }}>
          <nav aria-label="Breadcrumb" className={styles.crumbs}>
            <Link href="/">{site.name}</Link>
            <span aria-hidden="true">/</span>
            {category ? (
              <>
                <Link href="/collections">Collections</Link>
                <span aria-hidden="true">/</span>
                <span aria-current="page">{COLLECTION_CATEGORY_LABELS[category]}</span>
              </>
            ) : (
              <span aria-current="page">Collections</span>
            )}
          </nav>
          <div className={styles.sectionHead}>
            <p className="prompt" data-tone="text">
              <span className="prompt__chevron" aria-hidden="true">&gt;</span> Act One Collections
            </p>
            <h1 style={{ fontSize: 'clamp(2.2rem, 4.6vw, 3.4rem)' }}>
              {category ? `${COLLECTION_CATEGORY_LABELS[category]} launches, directed.` : 'Launch films, selected.'}
            </h1>
            <p className="lede">
              Real products, launched with a film made here. Each one was submitted by the people who make the
              product and selected by a person at {site.name}. Nothing in this gallery was published automatically.
            </p>
          </div>

          <nav className={styles.chips} aria-label="Category">
            <Link href="/collections" data-active={category === null ? 'true' : undefined}>
              All
            </Link>
            {CollectionCategory.options
              .filter((option) => category === option || (counts.get(option) ?? 0) > 0)
              .map((option) => (
                <Link key={option} href={`/collections/category/${option}`} data-active={category === option ? 'true' : undefined}>
                  {COLLECTION_CATEGORY_LABELS[option]}
                </Link>
              ))}
          </nav>

          {films.length === 0 ? (
            <div className={styles.emptyGallery}>
              <div className="dots" aria-hidden="true">
                <DotMatrix seed="collections-empty" shape="radial" width={900} height={220} cell={14} opacity={0.3} />
              </div>
              <p className="prompt" data-tone="muted">
                <span className="prompt__chevron" aria-hidden="true">&gt;</span> {category ? 'Nothing selected in this category yet.' : 'The first selections are being made.'}
              </p>
              <p className="secondary">
                Meanwhile, the <Link href="/work">reference films</Link> show the craft on fictional products.
              </p>
            </div>
          ) : null}

          {lead ? (
            <article className={styles.lead}>
              <Link href={lead.path} className={styles.leadFrame} aria-label={`${lead.company}: ${lead.title}`}>
                <video src={lead.videoPath} {...(lead.posterPath ? { poster: lead.posterPath } : {})} muted loop playsInline preload="none" autoPlay aria-hidden="true" />
                <span className={styles.leadMark}>Launch of the week</span>
              </Link>
              <div className={styles.leadCopy}>
                <p className="prompt" data-tone="accent">
                  <span className="prompt__chevron" aria-hidden="true">&gt;</span> {lead.company}
                </p>
                <h2>
                  <Link href={lead.path}>{lead.title}</Link>
                </h2>
                {lead.tagline ? <p className="lede">{lead.tagline}</p> : null}
                <p className={styles.quiet}>
                  {lead.categoryLabel} · {Math.round(lead.durationSeconds)}s · {lead.credit}
                </p>
                <Link href={lead.path} className="btn btn--secondary">
                  Watch the launch →
                </Link>
              </div>
            </article>
          ) : null}

          {rest.length > 0 ? (
            <div className={styles.filmGrid}>
              {rest.map((film) => (
                <PublicFilmCard
                  key={film.slug}
                  href={film.path}
                  videoSrc={film.videoPath}
                  posterSrc={film.posterPath}
                  company={film.company}
                  title={film.title}
                  tagline={film.tagline}
                  categoryLabel={film.categoryLabel}
                  credit={film.credit}
                  durationSeconds={film.durationSeconds}
                  featured={film.featured}
                  aside={film.launchDate ? `Launched ${monthYear(film.launchDate)}` : undefined}
                />
              ))}
            </div>
          ) : null}
        </section>

        <section className={`shell ${styles.section}`}>
          <div className={styles.cta}>
            <div className="dots" aria-hidden="true">
              <DotMatrix seed="collections-cta" shape="drift" width={1200} height={320} cell={16} opacity={0.26} />
            </div>
            <h2 style={{ maxWidth: '20ch' }}>Your product, directed.</h2>
            <p className="lede" style={{ maxWidth: '52ch' }}>
              Paste your address. {site.name} reads the product, proposes three directions and produces the launch film.
              The best ones end up here.
            </p>
            <StartProject cta={cta} policy={policy} idPrefix="collections" />
          </div>
        </section>
      </main>
      <Footer />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            '@id': absoluteUrl(category ? `/collections/category/${category}#page` : '/collections#page'),
            name: category ? `${COLLECTION_CATEGORY_LABELS[category]} launch films` : 'Act One Collections',
            url: absoluteUrl(category ? `/collections/category/${category}` : '/collections'),
            isPartOf: { '@id': absoluteUrl('/#website') },
            hasPart: films.slice(0, 50).map((film) => ({ '@type': 'VideoObject', '@id': absoluteUrl(`${film.path}#video`), name: `${film.company}: ${film.title}`, url: absoluteUrl(film.path) })),
          }),
        }}
      />
    </>
  );
}

export function monthYear(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? day : date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
