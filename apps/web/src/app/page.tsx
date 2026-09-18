import type { Metadata } from 'next';
import Link from 'next/link';
import { DEFAULT_PLANS, PRODUCT_NAME, signUpPolicy } from '@act-one/core';
import { CREATIVE_SYSTEMS } from '@act-one/creative';
import { Nav } from '@/components/Nav.tsx';
import { Footer } from '@/components/Footer.tsx';
import { StartProject } from '@/components/StartProject.tsx';
import { HeroFilm } from '@/components/HeroFilm.tsx';
import { FilmCard } from '@/components/FilmCard.tsx';
import { DotMatrix } from '@/components/ui/DotMatrix.tsx';
import { getProductConfig } from '@/server/product.ts';
import { listPublicFilms } from '@/server/collections.ts';
import { PublicFilmCard } from '@/components/PublicFilmCard.tsx';
import { site, LANDING_DESCRIPTION } from '@/lib/site.ts';
import { breadcrumbs, faqPage, itemList, jsonLd, pageMetadata } from '@/lib/seo.ts';
import { REFERENCE_FILMS } from '@/lib/reference-films.ts';
import styles from '@/components/marketing.module.css';

/**
 * The one page an operator may want to word themselves, and the one page a
 * search console looks at to confirm the site belongs to whoever says so.
 */
export async function generateMetadata(): Promise<Metadata> {
  const config = await getProductConfig().catch(() => null);
  const verification = {
    ...(config?.seo.googleVerification ? { google: config.seo.googleVerification } : {}),
    ...(config?.seo.bingVerification ? { other: { 'msvalidate.01': config.seo.bingVerification } } : {}),
  };
  return {
    ...pageMetadata({
      title: `${PRODUCT_NAME} — Your product. Directed.`,
      description: config?.seo.description || LANDING_DESCRIPTION,
      path: '/',
    }),
    ...(Object.keys(verification).length > 0 ? { verification } : {}),
  };
}

/**
 * The workflow as the customer lives it: five verbs, in order. Each one is
 * a stage the product actually runs, not a marketing gloss on one.
 */
const WORKFLOW = [
  { verb: 'Understand', line: 'We read your product the way a strategist would before a pitch. Every claim is traced to something you published.' },
  { verb: 'Concept', line: 'Three creative directions that genuinely disagree: a different argument, structure and language each.' },
  { verb: 'Direct', line: 'A storyboard you can argue with before anything expensive happens. Your brand, measured, not guessed.' },
  { verb: 'Produce', line: 'Motion set by a type engine, your real interface filmed like an object, sound designed against the cut.' },
  { verb: 'Launch', line: 'The master, and every cut your launch needs: the hero, the socials, the vertical, the six-second bumper.' },
] as const;

const USES = [
  {
    title: 'Product launch films',
    body: 'The film for launch day: the argument for the product, its real interface, and one line you will hear quoted back. Built for SaaS launches and feature launches alike.',
    links: [{ href: '/work', label: 'See a launch film' }],
  },
  {
    title: 'Product films',
    body: 'The evergreen product film for your homepage hero, your demo request page and your sales deck — the one that has to be true for a year.',
    links: [{ href: '/how-it-works', label: 'How it is made' }],
  },
  {
    title: 'Launch videos for startups',
    body: 'A Product Hunt launch video, an AI startup announcing itself, a seed-stage company that needs to look like it already won. Studio quality, at the pace of a launch week.',
    links: [{ href: '/pricing', label: 'What it costs' }],
  },
] as const;

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
    a: 'A URL. Optionally a Product Hunt or LinkedIn page, your docs, your own pictures, and — if you want the film to show the product working — demo credentials. Everything else is inferred, and you approve it before it is used.',
  },
  {
    q: 'What happens to my demo credentials?',
    a: 'They are encrypted and bound to your production, never stored in plain text, and used only inside an isolated browser session that is destroyed when the work is done. The agent is blocked in code from taking any action that changes state in your product, and every action it takes is audited. You can revoke access at any time, which destroys the stored secret.',
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


export default async function HomePage() {
  const launch = DEFAULT_PLANS.find((plan) => plan.id === 'launch');
  const config = await getProductConfig();
  const policy = signUpPolicy(config);
  /*
   * Real launches first. Once Collections has selected films, they lead the
   * page and the reference films fill the remaining places; before that, the
   * reference films stand alone, labelled as the fictional work they are.
   */
  const selected = await listPublicFilms({ limit: 3 }).catch(() => []);
  const references = REFERENCE_FILMS.slice(0, Math.max(0, 3 - selected.length));

  return (
    <>
      <Nav policy={policy} />
      <main id="main">
        <section className={styles.hero}>
          <div className={`shell ${styles.heroInner}`}>
            <div className={styles.heroCopy}>
              <p className="prompt" data-tone="accent">
                <span className="prompt__chevron" aria-hidden="true">&gt;</span> {config.landing.eyebrow}
              </p>
              <h1 className={styles.heroTitle}>{config.landing.headline || site.tagline}</h1>
              <p className={`lede ${styles.heroLede}`}>
                {config.landing.subheadline ||
                  'Give us your product. We understand what it does, learn how your brand looks, develop three creative directions, and produce the launch film — with the restraint of a studio that has made a hundred of them.'}
              </p>
              <StartProject cta={config.landing.ctaLabel} policy={policy} />
            </div>

            {/*
              * A company that sells film has to show film above the fold. This is
              * a real render from the engine that would render yours, not a
              * mockup of one.
              */}
            <HeroFilm />
          </div>
        </section>

        {/* Real work first: three films made by the engine that would make yours. */}
        <section className={`shell ${styles.section}`} aria-labelledby="work">
          <div className={styles.workHead}>
            <p className="prompt" data-tone="text">
              <span className="prompt__chevron" aria-hidden="true">&gt;</span> Selected work
            </p>
            <h2 id="work" className="sr-only">
              Selected work
            </h2>
            <span className={styles.quiet}>Built to be published.</span>
            <hr className={styles.rule} />
            <Link href={selected.length > 0 ? '/collections' : '/work'} className={styles.moreLink}>
              {selected.length > 0 ? 'Collections →' : 'All work →'}
            </Link>
          </div>
          <div className={styles.filmGrid}>
            {selected.map((film) => (
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
                launchOfTheWeek={film.launchOfTheWeek}
              />
            ))}
            {references.map((film) => (
              <FilmCard key={film.slug} {...film} />
            ))}
          </div>
        </section>

        {/* The five verbs, in order. */}
        <section className={`shell ${styles.section}`} aria-labelledby="how">
          <div className={styles.sectionHead}>
            <p className="prompt" data-tone="text">
              <span className="prompt__chevron" aria-hidden="true">&gt;</span> How a film is made
            </p>
            <h2 id="how">Understand. Concept. Direct. Produce. Launch.</h2>
            <p className="lede">
              You should not have to fill in a creative brief to get creative work. The system does the
              reading, the measuring and the thinking, and brings you decisions rather than forms. Every
              frame has to earn its place.
            </p>
          </div>
          <ol className={styles.rail}>
            <div className={`dots ${styles.railDots}`} aria-hidden="true">
              <DotMatrix seed="how-a-film-is-made" shape="wave" width={1200} height={260} cell={14} opacity={0.28} />
            </div>
            {WORKFLOW.map((step, index) => (
              <li key={step.verb} className={styles.railStep}>
                <span className={styles.railIndex}>{String(index + 1).padStart(2, '0')}</span>
                <h3 className={styles.railVerb}>{step.verb}</h3>
                <p>{step.line}</p>
                {index < WORKFLOW.length - 1 ? (
                  <span className={styles.railArrow} aria-hidden="true">
                    →
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>

        <section className={`shell ${styles.section}`} aria-labelledby="difference">
          <div className={styles.sectionHead}>
            <p className="prompt" data-tone="text">
              <span className="prompt__chevron" aria-hidden="true">&gt;</span> What this is not
            </p>
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
            <p className="prompt" data-tone="text">
              <span className="prompt__chevron" aria-hidden="true">&gt;</span> Creative systems
            </p>
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

        {/* What it is for, in the words people use to look for it. */}
        <section className={`shell ${styles.section}`} aria-labelledby="uses">
          <div className={styles.sectionHead}>
            <p className="prompt" data-tone="text">
              <span className="prompt__chevron" aria-hidden="true">&gt;</span> What it is for
            </p>
            <h2 id="uses">One system for every film a software company launches with.</h2>
            <p className="lede">
              {PRODUCT_NAME} makes launch films, product films and launch videos for software companies:
              SaaS launches, AI startups announcing themselves, developer tools, Product Hunt launches.
              The same understanding of your product, directed differently for each.
            </p>
          </div>
          <div className={styles.uses}>
            {USES.map((use) => (
              <article key={use.title} className={styles.useCard}>
                <h3>{use.title}</h3>
                <p>{use.body}</p>
                <div className={styles.useLinks}>
                  {use.links.map((link) => (
                    <Link key={link.href} href={link.href}>
                      {link.label} →
                    </Link>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className={`shell ${styles.section}`} aria-labelledby="faq">
          <div className={styles.sectionHead}>
            <p className="prompt" data-tone="text">
              <span className="prompt__chevron" aria-hidden="true">&gt;</span> Questions
            </p>
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
            <div className="dots" aria-hidden="true">
              <DotMatrix seed="see-how" shape="orbit" width={900} height={320} cell={14} opacity={0.3} />
            </div>
            <p className="prompt" data-tone="accent">
              <span className="prompt__chevron" aria-hidden="true">&gt;</span> Start
            </p>
            <h2 style={{ maxWidth: '18ch' }}>See what it understands about your product.</h2>
            <p className="lede">
              Free to research, free to see your brand, free to read three concepts.
              {launch ? ` Production starts at €${(launch.monthlyPriceCents / 100).toLocaleString('en-US')}.` : ''}
            </p>
            <StartProject cta={config.landing.ctaLabel} policy={policy} idPrefix="website-cta" />
            <Link href="/pricing" className="btn btn--secondary">
              See pricing
            </Link>
          </div>
        </section>
      </main>
      <Footer />
      {/*
        The questions on this page, said again for machines, and the work it
        shows. Nothing here is invisible to a reader: structured data that
        describes something the page does not contain is a penalty waiting to
        happen.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            faqPage(FAQ.map((item) => ({ question: item.q, answer: item.a }))),
            itemList(
              'Selected work',
              [
                ...selected.map((film) => ({ name: `${film.company}: ${film.title}`, path: film.path })),
                ...references.map((film) => ({ name: `${film.company}: ${film.concept}`, path: '/work' })),
              ],
            ),
          ),
        }}
      />
    </>
  );
}
