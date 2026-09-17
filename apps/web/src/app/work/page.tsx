import type { Metadata } from 'next';
import { Nav } from '@/components/Nav.tsx';
import { Footer } from '@/components/Footer.tsx';
import { StartProject } from '@/components/StartProject.tsx';
import { FilmCard } from '@/components/FilmCard.tsx';
import { site, absoluteUrl } from '@/lib/site.ts';
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
const DEMOS = [
  {
    slug: 'northwind',
    company: 'Northwind',
    kind: 'AI agent',
    concept: 'One run',
    idea: 'A week of manual reconciliation collapses into a single automated run.',
    system: 'Cinematic Black',
    duration: '19s',
  },
  {
    slug: 'meridian',
    company: 'Meridian',
    kind: 'SaaS analytics',
    concept: 'Stop asking the data team',
    idea: 'The question you would have queued for a week, answered while you type it.',
    system: 'Kinetic Product',
    duration: '14s',
  },
  {
    slug: 'halyard',
    company: 'Halyard',
    kind: 'Developer tool',
    concept: 'Boring on purpose',
    idea: 'Infrastructure that is uninteresting to operate, argued as a virtue.',
    system: 'Editorial Tech',
    duration: '18s',
  },
];

export default function WorkPage() {
  return (
    <>
      <Nav />
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
