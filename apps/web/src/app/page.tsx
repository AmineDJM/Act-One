import type { Metadata } from 'next';
import Link from 'next/link';
import { DEFAULT_PLANS, PRODUCT_NAME } from '@act-one/core';
import { CREATIVE_SYSTEMS } from '@act-one/creative';
import { Nav } from '@/components/Nav.tsx';
import { Footer } from '@/components/Footer.tsx';
import { StartProject } from '@/components/StartProject.tsx';
import { HeroFilm } from '@/components/HeroFilm.tsx';
import { site, absoluteUrl } from '@/lib/site.ts';
import styles from '@/components/marketing.module.css';

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} — ${site.tagline}`,
  description:
    'Give us your product URL. We research the product, extract your brand, write three creative directions and produce an agency-quality launch film. Free until you render.',
  alternates: { canonical: '/' },
  openGraph: {
    title: `${PRODUCT_NAME} — ${site.tagline}`,
    description:
      'Give us your product URL. We research the product, extract your brand, and produce an agency-quality launch film.',
    url: absoluteUrl('/'),
  },
};

const STEPS = [
  {
    title: 'We read your product',
    body: 'A browser agent reads your site the way a strategist would before a pitch: positioning, pricing, what you actually do. Every claim we make later is traced back to something you published.',
  },
  {
    title: 'We measure your brand',
    body: 'Colour by painted area, type by ink weight, your real corner radius and spacing rhythm — measured in the page, not guessed. It lands on your brand rather than near it.',
  },
  {
    title: 'You choose a direction',
    body: 'Three genuinely different concepts, not one idea in three fonts. Different narrative structure, different creative language, different argument. You pick one.',
  },
  {
    title: 'We produce the film',
    body: 'Storyboard first, so you can argue with it before anything expensive happens. Then motion, product cinematography, sound design, and every cut your launch needs.',
  },
];

const FAQ = [
  {
    q: 'Is this an AI video generator?',
    a: 'No. Generative models are used for atmosphere and metaphor — the kind of shot where they genuinely help — and they are capped at a fraction of the runtime. Typography, layout, brand colour and your product interface are rendered by our own engine, because those are exactly what generative models cannot hold steady.',
  },
  {
    q: 'Will it invent things about my product?',
    a: 'It is built specifically not to. Every claim in the brief has to be traceable to a verbatim excerpt from your own material. Any figure that does not appear somewhere we read is dropped and reported back to you rather than repeated.',
  },
  {
    q: 'Do you fake my interface?',
    a: 'Never. If your product has a real interface, the film shows the real interface. Where we have no capture, the scene falls back to typography rather than a generated screen — even when generation would look impressive.',
  },
  {
    q: 'What do you need from me?',
    a: 'A URL. Optionally a Product Hunt or LinkedIn page, your docs, and — if you want the film to show the product working — demo credentials. Everything else is inferred, and you approve it before it is used.',
  },
  {
    q: 'What happens to my demo credentials?',
    a: 'They are encrypted and bound to your project, never stored in plain text, and used only inside an isolated browser session that is destroyed when the work is done. The agent is blocked in code from taking any action that changes state in your product, and every action it takes is audited. You can revoke access at any time, which destroys the stored secret.',
  },
  {
    q: 'How long does it take?',
    a: 'Product understanding and three concepts in a few minutes. A storyboard shortly after you choose one. The finished film and its channel cuts the same day.',
  },
];

const FEATURED_SYSTEMS = ['cinematic_black', 'kinetic_product', 'editorial_tech'] as const;

/*
 * Each system is shown as a frame from a film actually made in it, not as a
 * colour swatch. A page arguing that these are distinct creative languages has
 * to demonstrate the distinction; three rectangles demonstrate nothing.
 */
const SYSTEM_FRAMES: Record<string, { poster: string; company: string }> = {
  cinematic_black: { poster: '/work/northwind.png', company: 'Northwind' },
  kinetic_product: { poster: '/work/meridian.png', company: 'Meridian' },
  editorial_tech: { poster: '/work/halyard.png', company: 'Halyard' },
};

export default function HomePage() {
  const launch = DEFAULT_PLANS.find((plan) => plan.id === 'launch');

  return (
    <>
      <Nav />
      <main id="main">
        <section className={styles.hero}>
          <div className={`shell ${styles.heroInner}`}>
            <div className={styles.heroCopy}>
              <p className="eyebrow">Launch films for software companies</p>
              <h1 className={styles.heroTitle}>{site.tagline}</h1>
              <p className={`lede ${styles.heroLede}`}>
                Give us your product. We understand what it does, learn how your brand looks, develop
                three creative directions, and produce the launch film — with the restraint of a studio
                that has made a hundred of them.
              </p>
              <StartProject />
            </div>

            {/*
              * A company that sells film has to show film above the fold. This is
              * a real render from the engine that would render yours, not a
              * mockup of one.
              */}
            <HeroFilm />
          </div>
        </section>

        <section className={`shell ${styles.section}`} aria-labelledby="how">
          <div className={styles.sectionHead}>
            <p className="eyebrow">How it works</p>
            <h2 id="how">Infer first. Ask only when necessary. You approve.</h2>
            <p className="lede">
              You should not have to fill in a creative brief to get creative work. The system does
              the reading, the measuring and the thinking, and brings you decisions rather than forms.
            </p>
          </div>
          <ol className={styles.steps}>
            {STEPS.map((step, index) => (
              <li key={step.title} className={styles.step}>
                <span className={styles.stepIndex}>{String(index + 1).padStart(2, '0')}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={`shell ${styles.section}`} aria-labelledby="difference">
          <div className={styles.sectionHead}>
            <p className="eyebrow">What this is not</p>
            <h2 id="difference">The difference is what we refuse to do.</h2>
          </div>
          <div className={styles.contrast}>
            <div className={styles.contrastCard}>
              <h3>What you get</h3>
              <ul className={styles.contrastList}>
                {[
                  'Your real product interface, filmed like an object',
                  'Typography set by a type engine, on a real grid',
                  'Your measured brand — radius, tracking, colour weight',
                  'Sound designed against the cut, not laid under it',
                  'Every claim traceable to something you published',
                  'Three directions that actually disagree with each other',
                ].map((item) => (
                  <li key={item}>
                    <span className={styles.tick} aria-hidden="true">
                      →
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className={styles.contrastCard}>
              <h3>What you never get</h3>
              <ul className={styles.contrastList}>
                {[
                  'A fabricated interface standing in for your product',
                  'Text rendered inside a generated image',
                  'Purple gradients, glowing brains, humanoid robots',
                  'A synthetic voice reading out the on-screen text',
                  'The same layout and transition in every scene',
                  'Metrics nobody at your company has ever claimed',
                ].map((item) => (
                  <li key={item}>
                    <span className={styles.cross} aria-hidden="true">
                      ✕
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className={`shell ${styles.section}`} aria-labelledby="systems">
          <div className={styles.sectionHead}>
            <p className="eyebrow">Creative systems</p>
            <h2 id="systems">Modular creative languages, not templates.</h2>
            <p className="lede">
              A template gives every film the same shape, and that shape is what people recognise as
              automated. A system supplies grammar — legal openings, scene archetypes, a transition
              vocabulary, how the cut breathes — and the director composes from it.
            </p>
          </div>
          <div className={styles.systems}>
            {FEATURED_SYSTEMS.map((id) => {
              const system = CREATIVE_SYSTEMS[id];
              const frame = SYSTEM_FRAMES[id]!;
              return (
                <article key={id} className={styles.system}>
                  <img
                    className={styles.systemFrame}
                    src={frame.poster}
                    alt={`A frame from the ${frame.company} reference film, made in ${system.name}`}
                    width={640}
                    height={360}
                    loading="lazy"
                  />
                  <div className={styles.systemBody}>
                    <h3 style={{ fontSize: '1rem' }}>{system.name}</h3>
                    <p>{system.essence}</p>
                    <p className="muted" style={{ fontSize: '0.82rem' }}>
                      Suits: {system.suitsWhen[0]}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className={`shell ${styles.section}`} aria-labelledby="faq">
          <div className={styles.sectionHead}>
            <p className="eyebrow">Questions</p>
            <h2 id="faq">The things people actually ask.</h2>
          </div>
          <div className={styles.faq}>
            {FAQ.map((item) => (
              <details key={item.q} className={styles.faqItem}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={`shell ${styles.section}`}>
          <div className={styles.cta}>
            <p className="eyebrow">Start</p>
            <h2 style={{ maxWidth: '18ch' }}>See what it understands about your product.</h2>
            <p className="lede">
              Free to research, free to see your brand, free to read three concepts.
              {launch ? ` Rendering starts at €${(launch.monthlyPriceCents / 100).toLocaleString('en-US')}.` : ''}
            </p>
            <StartProject cta="Understand my product" />
            <Link href="/pricing" className="btn btn--secondary">
              See pricing
            </Link>
          </div>
        </section>
      </main>
      <Footer />

      {/*
        FAQPage structured data. These are questions people genuinely ask us,
        answered honestly — which is the only version of this markup that keeps
        working after the next guideline update.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: FAQ.map((item) => ({
              '@type': 'Question',
              name: item.q,
              acceptedAnswer: { '@type': 'Answer', text: item.a },
            })),
          }),
        }}
      />
    </>
  );
}
