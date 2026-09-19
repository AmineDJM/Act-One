import Link from 'next/link';
import {
  DEFAULT_PLANS,
  INTERNAL_PLAN,
  creditsToUsd,
  planById,
  subscriptionIsLive,
  type Organization,
  type Plan,
  type Subscription,
} from '@act-one/core';
import { getStore } from '@/server/store.ts';
import { getPlatformConfig } from '@/server/platform.ts';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

/**
 * The money.
 *
 * Costs and margin already exist on their own page; this is the other half —
 * what is actually being paid, by whom, on what, and what is about to stop.
 * An operator asking "how are we doing" wants recurring revenue and the list
 * of subscriptions behind it, not a count of signups.
 *
 * Internal workspaces are held apart everywhere here. They are the operator's
 * own, they are not billed, and counting them as customers on nothing a month
 * is how an average revenue figure quietly becomes a lie.
 */
export default async function RevenuePage() {
  const store = getStore();
  const [subscriptions, organizations, payments, { plans: configured }] = await Promise.all([
    store.subscriptions.list(500),
    store.organizations.list(500),
    store.payments.list(200),
    getPlatformConfig(),
  ]);
  const plans = configured.length > 0 ? configured : DEFAULT_PLANS;

  const byId = new Map(organizations.map((organization) => [organization.id, organization]));
  const rows = subscriptions
    .map((subscription) => ({
      subscription,
      organization: byId.get(subscription.organizationId) ?? null,
      plan: planById(plans, subscription.planId),
    }))
    .filter((row) => !row.organization?.isInternal);

  const live = rows.filter((row) => subscriptionIsLive(row.subscription.status));
  const mrr = live.reduce((sum, row) => sum + monthlyCents(row.plan, row.subscription), 0);
  const ending = live.filter((row) => row.subscription.cancelAtPeriodEnd);
  const trouble = rows.filter(
    (row) => row.subscription.status === 'past_due',
  );

  /*
   * A workspace with no subscription row is on whatever plan it was put on by
   * hand — normally free, occasionally a plan an operator set. Counted apart
   * from the paying ones because it is a different question: how many people
   * are here, against how many are paying.
   */
  const paying = new Set(live.map((row) => row.subscription.organizationId));
  const customers = organizations.filter((organization) => !organization.isInternal);
  const internal = organizations.filter((organization) => organization.isInternal);
  const granted = customers.filter(
    (organization) =>
      Object.keys(organization.limitOverrides).length > 0 ||
      organization.extraEntitlements.length > 0,
  );
  const credits = customers.reduce((sum, organization) => sum + organization.creditBalance, 0);

  /*
   * Collected, as opposed to recurring.
   *
   * MRR is what should arrive each month if nothing changes; this is what
   * actually did arrive, one-off credit purchases included. They are different
   * numbers and a dashboard that shows only the first is a forecast wearing
   * the clothes of an accounts page.
   */
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const collected = payments.filter(
    (payment) => payment.status === 'succeeded' && payment.createdAt >= thirtyDaysAgo,
  );
  /*
   * Per currency, not one sum.
   *
   * Adding euros to dollars because both are stored as integer cents produces
   * a number that is wrong in every currency at once. Almost always there is
   * one, and then this reads as one figure; where there are two, it says so
   * rather than quietly averaging them.
   */
  const collectedByCurrency = new Map<string, number>();
  for (const payment of collected) {
    const currency = payment.currency.toUpperCase();
    collectedByCurrency.set(currency, (collectedByCurrency.get(currency) ?? 0) + payment.amountCents);
  }
  const [largestCurrency, largestAmount] = [...collectedByCurrency.entries()].sort(
    (left, right) => right[1] - left[1],
  )[0] ?? ['USD', 0];
  const organizationName = (id: string) => byId.get(id)?.name ?? id;

  /*
   * A plan price, in the currency the product actually charges.
   *
   * `Plan` carries cents and no currency, and every customer-facing page —
   * pricing, billing, the plan editor — renders them with a euro sign. This
   * page was the one place quoting the same numbers in dollars, which is how
   * an operator reads €1,490 off the pricing page and $1,490 off the console
   * and believes they are looking at two different things.
   */
  const price = (cents: number) => money(cents, PRICE_CURRENCY);

  return (
    <>
      <header className={styles.head}>
        <h1>Revenue</h1>
        <p className="lede">
          What is being paid, by whom, and what is about to stop. Internal workspaces are held
          apart: they are ours, they are not billed, and counting them would flatter every
          average on this page.
        </p>
      </header>

      <div className={styles.metrics}>
        <Metric label="Monthly recurring" value={price(mrr)} note={`${live.length} live`} />
        <Metric
          label="Annualised"
          value={price(mrr * 12)}
          note="At today's run rate"
        />
        <Metric
          label="Paying"
          value={`${paying.size} of ${customers.length}`}
          note={customers.length > 0 ? `${Math.round((paying.size / customers.length) * 100)}% of workspaces` : 'No workspaces yet'}
        />
        <Metric
          label="Average"
          value={paying.size > 0 ? price(mrr / paying.size) : '—'}
          note="Per paying workspace"
        />
        <Metric
          label="Credits outstanding"
          value={`$${creditsToUsd(credits).toFixed(2)}`}
          note={`${credits.toLocaleString('en-US')} credits held`}
          tone={credits > 0 ? 'neutral' : undefined}
        />
        <Metric
          label="Collected, 30 days"
          value={money(largestAmount, largestCurrency)}
          note={
            collectedByCurrency.size > 1
              ? `${collected.length} payments, ${collectedByCurrency.size} currencies`
              : `${collected.length} payment${collected.length === 1 ? '' : 's'} in the window`
          }
        />
        <Metric
          label="Lifted limits"
          value={String(granted.length)}
          note={granted.length > 0 ? 'Workspaces on more than their plan' : 'Everybody on their plan'}
        />
      </div>

      {trouble.length > 0 ? (
        <div className={styles.notice} data-tone="danger">
          <strong>
            {trouble.length} subscription{trouble.length === 1 ? '' : 's'} failing to collect
          </strong>{' '}
          — {trouble.map((row) => row.organization?.name ?? row.subscription.organizationId).join(', ')}.
          They have already fallen back to the free plan&rsquo;s entitlements.
        </div>
      ) : null}

      {ending.length > 0 ? (
        <div className={styles.notice} data-tone="warning">
          <strong>
            {ending.length} cancel{ending.length === 1 ? 's' : ''} at period end
          </strong>{' '}
          — {price(ending.reduce((sum, row) => sum + monthlyCents(row.plan, row.subscription), 0))} a
          month, leaving.
        </div>
      ) : null}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Subscriptions</h2>
          <Link href="/admin/customers" className={styles.sectionLink}>
            Manage workspaces →
          </Link>
        </div>

        {rows.length === 0 ? (
          <p className={styles.empty}>
            Nobody is subscribed yet. Workspaces put on a plan by hand do not appear here — they
            are on the customers page.
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Plan</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Seats</th>
                <th style={{ textAlign: 'right' }}>A month</th>
                <th>Renews</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.subscription.id}>
                  <td>{row.organization?.name ?? row.subscription.organizationId}</td>
                  <td>{row.plan.name}</td>
                  <td>
                    <span className={styles.pill} data-tone={toneFor(row.subscription.status)}>
                      {row.subscription.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{row.subscription.seats}</td>
                  <td style={{ textAlign: 'right' }}>
                    {subscriptionIsLive(row.subscription.status)
                      ? price(monthlyCents(row.plan, row.subscription))
                      : '—'}
                  </td>
                  <td>
                    {row.subscription.cancelAtPeriodEnd
                      ? `Ends ${day(row.subscription.currentPeriodEnd)}`
                      : day(row.subscription.currentPeriodEnd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>Payments</h2>
        </div>
        {payments.length === 0 ? (
          <p className={styles.empty}>
            Nothing has been paid yet. Every credit purchase and every renewal lands here the
            moment Stripe says it collected — including the attempts that failed.
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Workspace</th>
                <th>For</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.slice(0, 50).map((payment) => (
                <tr key={payment.id}>
                  <td>{day(payment.createdAt)}</td>
                  <td>{organizationName(payment.organizationId)}</td>
                  <td>{payment.description || payment.kind}</td>
                  <td>
                    <span
                      className={styles.pill}
                      data-tone={payment.status === 'succeeded' ? 'ok' : payment.status === 'failed' ? 'danger' : 'muted'}
                    >
                      {payment.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{money(payment.amountCents, payment.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {internal.length > 0 ? (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2>Ours</h2>
          </div>
          <p className="hint" style={{ marginBottom: 'var(--space-3)' }}>
            Not billed, not limited, and not in any number above. On {INTERNAL_PLAN.name}.
          </p>
          <ul className={styles.plainList}>
            {internal.map((organization) => (
              <li key={organization.id}>
                {organization.name} <span className="mono">{organization.slug}</span> ·{' '}
                {organization.creditBalance.toLocaleString('en-US')} credits
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {granted.length > 0 ? (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2>Lifted by hand</h2>
            <Link href="/admin/customers" className={styles.sectionLink}>
              Change them →
            </Link>
          </div>
          <p className="hint" style={{ marginBottom: 'var(--space-3)' }}>
            Workspaces running on more than their plan sells. Each of these was a decision; this
            is where they are all visible at once.
          </p>
          <ul className={styles.plainList}>
            {granted.map((organization) => (
              <li key={organization.id}>
                {/* The slug too: workspace names are not unique, and two rows
                    reading "Operator's workspace" tell an operator nothing. */}
                <strong>{organization.name}</strong> <span className="mono">{organization.slug}</span>{' '}
                — {describeGrants(organization)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'neutral';
}) {
  return (
    <div className={styles.metric} data-tone={tone}>
      <span className={styles.metricLabel}>{label}</span>
      <strong className={styles.metricValue}>{value}</strong>
      {note ? <span className={styles.metricNote}>{note}</span> : null}
    </div>
  );
}

/**
 * What this subscription is worth a month.
 *
 * Per seat, because that is how the plans are priced and how Stripe bills
 * them. A yearly subscription is not divided down here: the plans carry a
 * monthly price and a yearly one, and guessing which is in force from a row
 * that does not say would be a number that looks precise and is not.
 */
function monthlyCents(plan: Plan, subscription: Subscription): number {
  return plan.monthlyPriceCents * Math.max(1, subscription.seats);
}

/**
 * An amount in the currency it was actually taken in.
 *
 * The plans are quoted in one currency; a payment is a fact about a charge
 * that already happened, and rendering a euro charge with a dollar sign is the
 * kind of quiet wrongness that gets a figure repeated in a board deck.
 */
const PRICE_CURRENCY = 'EUR';

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    currencyDisplay: 'narrowSymbol',
  }).format(cents / 100);
}

function toneFor(status: Subscription['status']): string {
  if (status === 'active' || status === 'trialing') return 'ok';
  if (status === 'past_due') return 'danger';
  return 'muted';
}

function day(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The grants on one workspace, read back as a sentence. */
function describeGrants(organization: Organization): string {
  const limits = Object.entries(organization.limitOverrides)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${LIMIT_LABEL[name] ?? name} ${value === -1 ? 'unlimited' : value}`);
  const features = organization.extraEntitlements.map((entitlement) => entitlement);
  return [...limits, ...features].join(', ') || 'nothing';
}

const LIMIT_LABEL: Record<string, string> = {
  maxMasterDurationSeconds: 'films up to',
  projectsPerMonth: 'productions a month',
  rendersPerProject: 'masters per production',
  revisionsPerProject: 'revisions',
  maxSeats: 'seats',
  maxBrands: 'identities',
  maxGenerativeSecondsPerFilm: 'generated seconds',
};
