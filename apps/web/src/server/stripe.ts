import 'server-only';
import Stripe from 'stripe';
import { AppError, creditsToUsd, newId, type Organization, type Plan } from '@act-one/core';
import type { ProviderHealth } from '@act-one/providers';
import { getStore } from './store.ts';
import { readProviderCredentials } from './platform.ts';
import { site } from '@/lib/site.ts';

/**
 * Billing.
 *
 * Checkout, the customer portal and webhooks — not payment links. A payment
 * link cannot tell us which organisation paid, cannot be reconciled against an
 * entitlement, and gives the customer nowhere to change their card.
 */
export async function getStripe(): Promise<Stripe | null> {
  const credentials = await readProviderCredentials('stripe');
  const key = credentials['secretKey'];
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2025-02-24.acacia', typescript: true });
}

export async function testStripe(secretKey?: string): Promise<ProviderHealth> {
  const checkedAt = new Date().toISOString();
  const key = secretKey ?? (await readProviderCredentials('stripe'))['secretKey'];
  if (!key) {
    return {
      provider: 'stripe',
      kind: 'llm',
      healthy: false,
      checkedAt,
      message: 'No secret key configured.',
    };
  }
  try {
    const stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' });
    const account = await stripe.accounts.retrieve();
    return {
      provider: 'stripe',
      kind: 'llm',
      healthy: true,
      checkedAt,
      message: `Connected to ${account.settings?.dashboard?.display_name ?? account.id}${
        key.startsWith('sk_test') ? ' (test mode)' : ''
      }`,
    };
  } catch (error) {
    return {
      provider: 'stripe',
      kind: 'llm',
      healthy: false,
      checkedAt,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Ensures the organisation has a Stripe customer, creating one on first need. */
export async function ensureCustomer(
  organization: Organization,
  email: string,
): Promise<string> {
  if (organization.stripeCustomerId) return organization.stripeCustomerId;

  const stripe = await getStripe();
  if (!stripe) throw new AppError('provider_unavailable', 'Billing is not configured.');

  const customer = await stripe.customers.create({
    email,
    name: organization.name,
    // The organisation id travels with the customer so a webhook can always
    // resolve the tenant without a lookup table.
    metadata: { organizationId: organization.id },
  });

  await getStore().organizations.update(organization.id, { stripeCustomerId: customer.id });
  return customer.id;
}

export async function createCheckoutSession(params: {
  organization: Organization;
  email: string;
  plan: Plan;
  interval: 'month' | 'year';
}): Promise<string> {
  const stripe = await getStripe();
  if (!stripe) throw new AppError('provider_unavailable', 'Billing is not configured.');

  const priceId =
    params.interval === 'year' ? params.plan.stripeYearlyPriceId : params.plan.stripeMonthlyPriceId;
  const customerId = await ensureCustomer(params.organization, params.email);

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [
      priceId
        ? { price: priceId, quantity: 1 }
        : {
            // No price id configured yet: create the price inline from the plan
            // the operator set in Super Admin, so billing works before anybody
            // has wired up a Stripe catalogue.
            quantity: 1,
            price_data: {
              currency: 'eur',
              unit_amount:
                params.interval === 'year'
                  ? params.plan.yearlyPriceCents || params.plan.monthlyPriceCents * 10
                  : params.plan.monthlyPriceCents,
              recurring: { interval: params.interval },
              product_data: {
                name: `${site.name} ${params.plan.name}`,
                description: params.plan.description,
              },
            },
          },
    ],
    success_url: `${site.url}/app/billing?checkout=success`,
    cancel_url: `${site.url}/app/billing?checkout=cancelled`,
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { organizationId: params.organization.id, planId: params.plan.id },
    },
    metadata: { organizationId: params.organization.id, planId: params.plan.id },
  });

  if (!session.url) throw new AppError('provider_failed', 'Stripe did not return a checkout URL.');
  return session.url;
}

export async function createPortalSession(organization: Organization): Promise<string> {
  const stripe = await getStripe();
  if (!stripe) throw new AppError('provider_unavailable', 'Billing is not configured.');
  if (!organization.stripeCustomerId) {
    throw new AppError('not_found', 'This workspace has no billing account yet.');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: organization.stripeCustomerId,
    return_url: `${site.url}/app/billing`,
  });
  return session.url;
}

export async function createCreditCheckout(params: {
  organization: Organization;
  email: string;
  credits: number;
}): Promise<string> {
  const stripe = await getStripe();
  if (!stripe) throw new AppError('provider_unavailable', 'Billing is not configured.');

  const customerId = await ensureCustomer(params.organization, params.email);
  // Credits are priced from the same constant the ledger reconciles against, so
  // what a customer pays and what we record can never drift.
  const amountCents = Math.round(creditsToUsd(params.credits) * 100);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: amountCents,
          product_data: {
            name: `${params.credits.toLocaleString('en-US')} creative credits`,
            description: 'Used for generated shots, 3D renders and extra versions.',
          },
        },
      },
    ],
    success_url: `${site.url}/app/billing?credits=success`,
    cancel_url: `${site.url}/app/billing`,
    metadata: {
      organizationId: params.organization.id,
      credits: String(params.credits),
      kind: 'credits',
    },
  });

  if (!session.url) throw new AppError('provider_failed', 'Stripe did not return a checkout URL.');
  return session.url;
}

/**
 * Applies a webhook event.
 *
 * Idempotent by event id: Stripe retries aggressively, and crediting an account
 * twice because a retry arrived is a real and expensive bug.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<{ handled: boolean; note: string }> {
  const store = getStore();
  const isNew = await store.platform.recordStripeEvent(event.id, event.type);
  if (!isNew) return { handled: false, note: 'Already processed.' };

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const organizationId = session.metadata?.['organizationId'];
      if (!organizationId) return { handled: false, note: 'No organisation on session.' };

      if (session.metadata?.['kind'] === 'credits') {
        const credits = Number(session.metadata['credits'] ?? 0);
        if (credits > 0) await store.organizations.adjustCredits(organizationId, credits);
        return { handled: true, note: `Added ${credits} credits.` };
      }
      return { handled: true, note: 'Checkout completed; subscription event will follow.' };
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const organizationId = subscription.metadata?.['organizationId'];
      const planId = subscription.metadata?.['planId'] ?? 'launch';
      if (!organizationId) return { handled: false, note: 'No organisation on subscription.' };

      const now = new Date().toISOString();
      await store.subscriptions.upsert({
        id: newId('inv'),
        organizationId,
        planId,
        status: mapStatus(subscription.status),
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        seats: subscription.items.data[0]?.quantity ?? 1,
        createdAt: now,
        updatedAt: now,
      });
      await store.organizations.update(organizationId, { planId });

      // Monthly credit allowance lands with the subscription, not on a cron.
      const { planById } = await import('@act-one/core');
      const { plans } = await import('./platform.ts').then((m) => m.getPlatformConfig());
      const plan = planById(plans, planId);
      if (event.type === 'customer.subscription.created' && plan.limits.monthlyCredits > 0) {
        await store.organizations.adjustCredits(organizationId, plan.limits.monthlyCredits);
      }

      return { handled: true, note: `Subscription ${subscription.status}.` };
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const organizationId = subscription.metadata?.['organizationId'];
      if (!organizationId) return { handled: false, note: 'No organisation on subscription.' };

      const existing = await store.subscriptions.getByStripeSubscriptionId(subscription.id);
      if (existing) {
        await store.subscriptions.upsert({ ...existing, status: 'canceled', updatedAt: new Date().toISOString() });
      }
      // Downgrade rather than suspend: the customer keeps their films and their
      // data, and loses only the entitlements they stopped paying for.
      await store.organizations.update(organizationId, { planId: 'free' });
      return { handled: true, note: 'Subscription cancelled; workspace downgraded to free.' };
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
      if (!customerId) return { handled: false, note: 'No customer on invoice.' };
      const organization = await store.organizations.getByStripeCustomerId(customerId);
      if (!organization) return { handled: false, note: 'Unknown customer.' };

      const existing = await store.subscriptions.getForOrganization(organization.id);
      if (existing) {
        await store.subscriptions.upsert({
          ...existing,
          status: 'past_due',
          updatedAt: new Date().toISOString(),
        });
      }
      return { handled: true, note: 'Marked past due.' };
    }

    default:
      return { handled: false, note: `Ignored ${event.type}.` };
  }
}

function mapStatus(status: Stripe.Subscription.Status) {
  switch (status) {
    case 'active':
      return 'active' as const;
    case 'trialing':
      return 'trialing' as const;
    case 'past_due':
    case 'unpaid':
      return 'past_due' as const;
    case 'canceled':
      return 'canceled' as const;
    default:
      return 'incomplete' as const;
  }
}
