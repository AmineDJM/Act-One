import type { Metadata } from 'next';
import { CREATIVE_SYSTEMS } from '@act-one/creative';
import { Nav } from '@/components/Nav.tsx';
import { Footer } from '@/components/Footer.tsx';
import { StartProject } from '@/components/StartProject.tsx';
import { site, absoluteUrl } from '@/lib/site.ts';
import styles from '@/components/marketing.module.css';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'From a URL to a finished launch film: product research with cited evidence, measured brand extraction, three creative directions, a storyboard you can argue with, then motion, sound and every channel cut.',
  alternates: { canonical: '/how-it-works' },
  openGraph: {
    title: `How it works · ${site.name}`,
    description: 'Research, brand measurement, creative direction, storyboard, film.',
    url: absoluteUrl('/how-it-works'),
  },
};

const STAGES = [
  {
    eyebrow: 'Stage one',
    title: 'Research, with receipts',
    body: 'A browser agent reads your homepage, pricing, product and use-case pages the way a strategist would before a pitch, and keeps the verbatim excerpt behind every fact. Anything we cannot trace to your own material is dropped and reported back to you rather than repeated — including any figure that appears nowhere on your site.',
  },
  {
    eyebrow: 'Stage two',
    title: 'Your brand, measured',
    body: 'We do not ask a model what your brand looks like; we measure the rendered page. Colour is ranked by painted area and consistency across pages, type by ink weight, and your corner radius is the one you actually use rather than the average of your outliers. When a brand genuinely has two candidate colours, we show you both and ask.',
  },
  {
    eyebrow: 'Stage three',
    title: 'Three arguments, not three fonts',
    body: 'Each direction is assigned a different narrative structure and a different creative language before a word is written, then measured for divergence — if two come back as the same idea reworded, one is regenerated. One leads with the problem, one with the product, one with what becomes possible.',
  },
  {
    eyebrow: 'Stage four',
    title: 'A storyboard you can argue with',
    body: 'Everything expensive happens after this, so this is where composition, timing, legibility and budget are settled. On-screen text is checked against real type metrics before anything renders. You change things by writing a sentence — "the opening is too slow" — and only the scenes that changes get re-rendered.',
  },
  {
    eyebrow: 'Stage five',
    title: 'Production',
    body: 'Your real product interface staged as an object, typography set by a type engine on a real grid, sound designed against the cut, and a mix mastered for where the film will actually be watched. Then the campaign: vertical, square, fifteen-second ads that argue differently, a bumper and a homepage loop.',
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <Nav />
      <main id="main">
        <section className={`shell ${styles.section}`} style={{ paddingTop: 'var(--space-8)' }}>
          <div className={styles.sectionHead}>
            <p className="eyebrow">How it works</p>
            <h1 style={{ fontSize: 'clamp(2.2rem, 4.6vw, 3.4rem)' }}>
              A studio process, run at software speed.
            </h1>
            <p className="lede">
              The same five stages a creative studio would run. The difference is that research takes
              minutes instead of a week, and you see the work before you commit to it.
            </p>
          </div>

          <div className="stack" style={{ gap: 'var(--space-6)', maxWidth: '78ch' }}>
            {STAGES.map((stage) => (
              <article key={stage.title} className="card">
                <p className="eyebrow">{stage.eyebrow}</p>
                <h2 style={{ fontSize: '1.4rem', marginBlock: 'var(--space-3)' }}>{stage.title}</h2>
                <p className="secondary">{stage.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={`shell ${styles.section}`}>
          <div className={styles.sectionHead}>
            <p className="eyebrow">The systems</p>
            <h2>Every film is composed, not filled in.</h2>
          </div>
          <div className={styles.systems}>
            {Object.values(CREATIVE_SYSTEMS)
              .filter((system) => system.productionReady)
              .map((system) => (
                <article key={system.id} className={styles.system}>
                  <div className={styles.systemBody} style={{ padding: 'var(--space-5)' }}>
                    <h3 style={{ fontSize: '1.05rem' }}>{system.name}</h3>
                    <p>{system.essence}</p>
                    <p className="muted" style={{ fontSize: '0.8rem' }}>
                      Never: {system.prohibitions[0]?.replace(/^Never /, '').toLowerCase()}
                    </p>
                  </div>
                </article>
              ))}
          </div>
        </section>

        <section className={`shell ${styles.section}`}>
          <div className={styles.cta}>
            <h2 style={{ maxWidth: '20ch' }}>Start with your URL.</h2>
            <StartProject />
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
