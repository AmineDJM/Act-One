import type { Metadata } from 'next';
import { Nav } from '@/components/Nav.tsx';
import { Footer } from '@/components/Footer.tsx';
import { StartProject } from '@/components/StartProject.tsx';
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
    company: 'Northwind',
    kind: 'AI agent',
    concept: 'One run',
    idea: 'A week of manual reconciliation collapses into a single automated run.',
    system: 'Cinematic Black',
    swatch: { background: '#09090d', color: '#f4f5f8' },
  },
  {
    company: 'Meridian',
    kind: 'SaaS analytics',
    concept: 'Stop asking the data team',
    idea: 'The question you would have queued for a week, answered while you type it.',
    system: 'Kinetic Product',
    swatch: { background: '#5b7cfa', color: '#ffffff' },
  },
  {
    company: 'Halyard',
    kind: 'Developer tool',
    concept: 'Boring on purpose',
    idea: 'Infrastructure that is uninteresting to operate, argued as a virtue.',
    system: 'Editorial Tech',
    swatch: { background: '#f4f5f8', color: '#0b0b10' },
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
              of it was the client&apos;s existing brand. Each one shows the concept it was made from.
            </p>
          </div>

          <div className={styles.systems}>
            {DEMOS.map((demo) => (
              <article key={demo.company} className={styles.system}>
                <div className={styles.systemSwatch} style={demo.swatch}>
                  {demo.concept}
                </div>
                <div className={styles.systemBody}>
                  <h2 style={{ fontSize: '1rem' }}>
                    {demo.company} <span className="muted">· {demo.kind}</span>
                  </h2>
                  <p>{demo.idea}</p>
                  <p className="muted" style={{ fontSize: '0.8rem' }}>
                    {demo.system} · fictional company
                  </p>
                </div>
              </article>
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
