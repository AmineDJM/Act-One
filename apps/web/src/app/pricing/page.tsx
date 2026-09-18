import type { Metadata } from 'next';
import Link from 'next/link';
import { CREDIT_USD_VALUE, planById } from '@act-one/core';
import { Nav } from '@/components/Nav.tsx';
import { getSignUpPolicy } from '@/server/product.ts';
import { Footer } from '@/components/Footer.tsx';
import { getPlatformConfig } from '@/server/platform.ts';
import { site, absoluteUrl } from '@/lib/site.ts';
import { breadcrumbs, jsonLd, pageMetadata } from '@/lib/seo.ts';
import styles from '@/components/marketing.module.css';
import pricing from './pricing.module.css';

export const metadata: Metadata = pageMetadata({
  title: 'Pricing',
  description:
    'Research, brand extraction and three creative concepts are free. You pay when you render. Plans from one launch film to an ongoing campaign programme.',
  path: '/pricing',
});

// Prices come from Super Admin, so a pricing experiment is a form submission
// rather than a deploy.
export const dynamic = 'force-dynamic';

const HIGHLIGHTS: Record<string, string[]> = {
  free: [
    'Product understanding, fully sourced',
    'Brand DNA measured from your site',
    'Three creative directions',
    'Storyboard preview',
    'Watermarked preview render',
  ],
  launch: [
    'One master film, 1080p',
    'Vertical and square cuts',
    'Real product capture with your demo access',
    '3D product staging',
    'Narration if the film needs it',
  ],
  pro: [
    'Everything in Launch',
    '4K masters',
    'Generative cinematography',
    'Full campaign cuts',
    'Unlimited revisions',
    'Team seats',
  ],
  studio: [
    'Everything in Pro',
    'Multiple brands',
    'Approval workflow',
    'Bulk campaigns',
    'API access',
  ],
};

export default async function PricingPage() {
  const { plans } = await getPlatformConfig();
  const visible = plans.filter((plan) => plan.isPublic).sort((a, b) => a.sortOrder - b.sortOrder);
  const free = planById(plans, 'free');

  return (
    <>
      <Nav policy={await getSignUpPolicy()} />
      <main id="main">
        <section className={`shell ${styles.section}`} style={{ paddingTop: 'var(--space-8)' }}>
          <div className={styles.sectionHead}>
            <p className="eyebrow">Pricing</p>
            <h1 style={{ fontSize: 'clamp(2.2rem, 4.6vw, 3.4rem)' }}>Free until you render.</h1>
            <p className="lede">
              Reading your product, measuring your brand and developing three creative directions
              costs nothing. You decide whether the work is good before you decide whether to pay
              for it.
            </p>
          </div>

          <div className={pricing.grid}>
            {visible.map((plan) => {
              const featured = plan.id === 'launch';
              return (
                <article key={plan.id} className={pricing.plan} data-featured={featured}>
                  {featured ? <span className={pricing.ribbon}>Most launches</span> : null}
                  <h2 className={pricing.name}>{plan.name}</h2>
                  <p className={pricing.desc}>{plan.description}</p>

                  <div className={pricing.price}>
                    <span className={pricing.amount}>
                      €{(plan.monthlyPriceCents / 100).toLocaleString('en-US')}
                    </span>
                    <span className={pricing.period}>
                      {plan.monthlyPriceCents === 0 ? 'forever' : '/month'}
                    </span>
                  </div>

                  <ul className={pricing.features}>
                    {(HIGHLIGHTS[plan.id] ?? []).map((feature) => (
                      <li key={feature}>
                        <span aria-hidden="true">→</span>
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <dl className={pricing.limits}>
                    <div>
                      <dt>Projects</dt>
                      <dd>{plan.limits.projectsPerMonth < 0 ? 'Unlimited' : `${plan.limits.projectsPerMonth}/mo`}</dd>
                    </div>
                    <div>
                      <dt>Max runtime</dt>
                      <dd>{plan.limits.maxMasterDurationSeconds}s</dd>
                    </div>
                    <div>
                      <dt>Revisions</dt>
                      <dd>
                        {plan.entitlements.includes('revisions.unlimited') || plan.limits.revisionsPerProject < 0
                          ? 'Unlimited'
                          : `${plan.limits.revisionsPerProject}/project`}
                      </dd>
                    </div>
                    <div>
                      <dt>Seats</dt>
                      <dd>{plan.limits.maxSeats < 0 ? 'Unlimited' : plan.limits.maxSeats}</dd>
                    </div>
                    <div>
                      <dt>Credits</dt>
                      <dd>{plan.limits.monthlyCredits.toLocaleString('en-US')}/mo</dd>
                    </div>
                  </dl>

                  <Link
                    href={plan.monthlyPriceCents === 0 ? '/auth/sign-up' : `/auth/sign-up?plan=${plan.id}`}
                    className={featured ? 'btn btn--lg' : 'btn btn--secondary btn--lg'}
                    style={{ marginTop: 'auto', width: '100%' }}
                  >
                    {plan.monthlyPriceCents === 0 ? 'Start free' : `Choose ${plan.name}`}
                  </Link>
                </article>
              );
            })}
          </div>

          <div className={pricing.credits}>
            <div>
              <h2 style={{ fontSize: '1.2rem', marginBottom: 'var(--space-3)' }}>
                Credits, not invoices you cannot read
              </h2>
              <p className="secondary" style={{ fontSize: '0.95rem', maxWidth: '70ch' }}>
                Expensive work — generated cinematography, 3D renders, extra versions, extra
                languages — draws on creative credits. Your plan includes a monthly allowance and
                you can top up at €{(CREDIT_USD_VALUE * 100).toFixed(0)} cents per credit. You never
                see a vendor bill, and we never mark up something you did not ask for.
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            {
              '@type': 'Product',
              name: site.name,
              description: site.subline,
              brand: { '@type': 'Brand', name: site.name },
              offers: visible.map((plan) => ({
                '@type': 'Offer',
                name: plan.name,
                price: (plan.monthlyPriceCents / 100).toFixed(2),
                priceCurrency: 'EUR',
                url: absoluteUrl('/pricing'),
                availability: 'https://schema.org/InStock',
                description: plan.description,
              })),
            },
            breadcrumbs([{ name: 'Pricing', path: '/pricing' }]),
          ),
        }}
      />
      <span className="sr-only">{free.name} includes {free.entitlements.length} capabilities.</span>
    </>
  );
}
