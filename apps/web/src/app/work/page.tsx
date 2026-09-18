import type { Metadata } from 'next';
import { Nav } from '@/components/Nav.tsx';
import { getSignUpPolicy } from '@/server/product.ts';
import { Footer } from '@/components/Footer.tsx';
import { StartProject } from '@/components/StartProject.tsx';
import { FilmCard } from '@/components/FilmCard.tsx';
import { site, absoluteUrl } from '@/lib/site.ts';
import { REFERENCE_FILMS } from '@/lib/reference-films.ts';
import styles from '@/components/marketing.module.css';

export const metadata: Metadata = {
  title: 'Work',
  description:
    'Reference films across an AI agent product, a SaaS analytics platform and a developer tool — each shown with the creative direction behind it.',
  alternates: { canonical: '/work' },
  openGraph: {
    title: `Work · ${site.name}`,
    description: 'Reference launch films and the creative direction behind each one.',
    url: absoluteUrl('/work'),
  },
};

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
    </>
  );
}
