import type { Metadata } from 'next';
import { Nav } from '@/components/Nav.tsx';
import { getSignUpPolicy } from '@/server/product.ts';
import { Footer } from '@/components/Footer.tsx';
import { StartProject } from '@/components/StartProject.tsx';
import { FilmCard } from '@/components/FilmCard.tsx';
import { site, absoluteUrl } from '@/lib/site.ts';
import { breadcrumbs, itemList, jsonLd, pageMetadata } from '@/lib/seo.ts';
import { REFERENCE_FILMS } from '@/lib/reference-films.ts';
import styles from '@/components/marketing.module.css';

/*
 * Rendered per request, because a build has no database.
 *
 * The machine that runs the build is not the machine that runs the migrations,
 * so on a fresh environment the tables this reads do not exist yet and
 * prerendering fails the whole deploy. It also reads settings an operator can
 * change from the console, which a page baked at build time would not notice.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = pageMetadata({
  title: 'Work',
  description:
    'Reference films across an AI agent product, a SaaS analytics platform and a developer tool — each shown with the creative direction behind it.',
  path: '/work',
});

/**
 * Reference films.
 *
 * These are our own demonstration projects, built for fictional companies and
 * labelled as such. Presenting invented work as a real client's launch is the
 * exact dishonesty this product refuses to commit on a customer's behalf, and
 * it would be strange to do it on our own site.
 */
const DEMOS = REFERENCE_FILMS;

export default async function WorkPage() {
  return (
    <>
      <Nav policy={await getSignUpPolicy()} />
      <main id="main">
        <section className={`shell ${styles.section}`} style={{ paddingTop: 'var(--space-8)' }}>
          <div className={styles.sectionHead}>
            <p className="eyebrow">Work</p>
            <h1 style={{ fontSize: 'clamp(2.2rem, 4.6vw, 3.4rem)' }}>Reference films.</h1>
            <p className="lede">
              Built for fictional companies, so you can judge the craft without wondering how much
              of it was the client&apos;s existing brand. Every frame is rendered by the same engine
              that renders yours — no edits afterwards. Hover to play.
            </p>
          </div>

          <div className={styles.filmGrid}>
            {DEMOS.map((demo) => (
              <FilmCard key={demo.slug} {...demo} />
            ))}
          </div>
        </section>

        <section className={`shell ${styles.section}`}>
          <div className={styles.cta}>
            <h2 style={{ maxWidth: '20ch' }}>See what it would make for you.</h2>
            <StartProject />
          </div>
        </section>
      </main>
      <Footer />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            breadcrumbs([{ name: 'Work', path: '/work' }]),
            itemList('Reference films', DEMOS.map((demo) => ({ name: `${demo.company}: ${demo.concept}`, path: '/work' }))),
            ...DEMOS.map((demo) => ({
              '@type': 'VideoObject',
              '@id': absoluteUrl(`/work#${demo.slug}`),
              name: `${demo.company}: ${demo.concept}`,
              description: demo.idea,
              thumbnailUrl: [absoluteUrl(`/work/${demo.slug}.png`)],
              contentUrl: absoluteUrl(`/work/${demo.slug}.mp4`),
              uploadDate: '2026-01-01T00:00:00.000Z',
              // Stated plainly: these are our own demonstrations for invented
              // companies, and the page says so where a reader can see it.
              creditText: `${site.name} reference film`,
              publisher: { '@id': absoluteUrl('/#organization') },
              inLanguage: 'en',
            })),
          ),
        }}
      />
    </>
  );
}
