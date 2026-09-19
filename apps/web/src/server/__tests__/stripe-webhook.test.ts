import { describe, it, expect, beforeEach } from 'vitest';
import Stripe from 'stripe';
import { newId } from '@act-one/core';
import { MemoryStore } from '@act-one/db';
import { resetRequest } from './request-scope.ts';
import { saveProviderCredentials } from '../platform.ts';
import { POST as webhook } from '../../app/api/stripe/webhook/route.ts';

/**
 * Billing, driven by signed webhooks and nothing else.
 *
 * Stripe has never been connected to this codebase, so the webhook route had
 * never received an event. It does not need Stripe to be exercised: the
 * signature is an HMAC over the exact bytes, and the SDK signs test payloads
 * with the same function it verifies with. What these prove is the contract
 * — a signed event changes the ledger, an unsigned or tampered one changes
 * nothing, a replay is refused, and a workspace's plan follows its
 * subscription up and back down.
 */
const SECRET_KEY = 'sk_test_act_one';
const WEBHOOK_SECRET = 'whsec_act_one_test';
const stripe = new Stripe(SECRET_KEY, { apiVersion: '2025-02-24.acacia' });

let store: MemoryStore;
let organizationId = '';

function eventPayload(type: string, object: Record<string, unknown>, id = `evt_${newId('inv').slice(-12)}`): string {
  return JSON.stringify({
    id,
    object: 'event',
    api_version: '2025-02-24.acacia',
    created: Math.floor(Date.now() / 1000),
    type,
    data: { object },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
  });
}

async function deliver(payload: string, signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })) {
  return webhook(
    new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      body: payload,
    }),
  );
}

beforeEach(async () => {
  store = new MemoryStore();
  globalThis.__actOneStore = store;
  resetRequest();
  await saveProviderCredentials('stripe', { secretKey: SECRET_KEY, webhookSecret: WEBHOOK_SECRET }, 'usr_staff');
  const organization = await store.organizations.create({
    id: newId('org'),
    name: 'Acme',
    slug: `acme-${newId('org').slice(-6)}`,
    planId: 'free',
    stripeCustomerId: 'cus_acme',
    creditBalance: 0,
    maxProjectCostUsd: 120,
    isSuspended: false,
    createdAt: new Date().toISOString(),
  });
  organizationId = organization.id;
});

describe('the webhook', () => {
  it('credits a workspace from a signed checkout, and only once', async () => {
    const payload = eventPayload('checkout.session.completed', {
      id: 'cs_1',
      object: 'checkout.session',
      metadata: { organizationId, kind: 'credits', credits: '500' },
    });
    const first = await deliver(payload);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ handled: true, note: 'Added 500 credits.' });
    expect((await store.organizations.get(organizationId))?.creditBalance).toBe(500);

    // The same event again — Stripe retries — must not credit twice.
    const replay = await deliver(payload);
    expect(await replay.json()).toMatchObject({ handled: false, note: 'Already processed.' });
    expect((await store.organizations.get(organizationId))?.creditBalance).toBe(500);
  });

  it('refuses a tampered body, a forged signature and no signature, and changes nothing', async () => {
    const payload = eventPayload('checkout.session.completed', {
      id: 'cs_2',
      object: 'checkout.session',
      metadata: { organizationId, kind: 'credits', credits: '900' },
    });
    const good = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

    expect((await deliver(payload.replace('900', '9000'), good)).status).toBe(400);
    expect((await deliver(payload, stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_somebody_else' }))).status).toBe(400);
    const unsigned = await webhook(new Request('http://localhost/api/stripe/webhook', { method: 'POST', body: payload }));
    expect(unsigned.status).toBe(400);

    expect((await store.organizations.get(organizationId))?.creditBalance).toBe(0);
  });

  it('refuses an old signature, because a captured request must not replay next week', async () => {
    const payload = eventPayload('checkout.session.completed', {
      id: 'cs_3',
      object: 'checkout.session',
      metadata: { organizationId, kind: 'credits', credits: '100' },
    });
    const stale = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
      timestamp: Math.floor(Date.now() / 1000) - 7 * 24 * 3600,
    });
    expect((await deliver(payload, stale)).status).toBe(400);
  });

  it('moves a workspace onto its plan when the subscription arrives, and back to free when it ends', async () => {
    const subscription = {
      id: 'sub_1',
      object: 'subscription',
      customer: 'cus_acme',
      status: 'active',
      metadata: { organizationId, planId: 'pro' },
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      cancel_at_period_end: false,
      items: { data: [{ quantity: 3 }] },
    };
    const created = await deliver(eventPayload('customer.subscription.created', subscription));
    expect(created.status).toBe(200);
    const organization = await store.organizations.get(organizationId);
    expect(organization?.planId).toBe('pro');
    // The plan's monthly allowance lands with the subscription, not on a cron.
    expect(organization?.creditBalance).toBeGreaterThan(0);
    const stored = await store.subscriptions.getByStripeSubscriptionId('sub_1');
    expect(stored).toMatchObject({ organizationId, planId: 'pro', status: 'active', seats: 3 });

    const failed = await deliver(eventPayload('invoice.payment_failed', { id: 'in_1', object: 'invoice', customer: 'cus_acme' }));
    expect(await failed.json()).toMatchObject({ handled: true, note: 'Marked past due.' });
    expect((await store.subscriptions.getForOrganization(organizationId))?.status).toBe('past_due');

    const deleted = await deliver(eventPayload('customer.subscription.deleted', { ...subscription, status: 'canceled' }));
    expect(deleted.status).toBe(200);
    expect((await store.organizations.get(organizationId))?.planId).toBe('free');
    expect((await store.subscriptions.getByStripeSubscriptionId('sub_1'))?.status).toBe('canceled');
  });

  it('writes down every payment, including the one that failed', async () => {
    await deliver(
      eventPayload('checkout.session.completed', {
        id: 'cs_pay',
        object: 'checkout.session',
        amount_total: 24_000,
        currency: 'eur',
        metadata: { organizationId, kind: 'credits', credits: '2000' },
      }),
    );
    await deliver(
      eventPayload('invoice.payment_failed', {
        id: 'in_bad',
        object: 'invoice',
        customer: 'cus_acme',
        amount_due: 149_000,
        currency: 'eur',
      }),
    );

    const payments = await store.payments.listForOrganization(organizationId);
    expect(payments).toHaveLength(2);
    expect(payments.find((payment) => payment.kind === 'credits')).toMatchObject({
      status: 'succeeded',
      amountCents: 24_000,
      currency: 'eur',
      credits: 2000,
      stripeObjectId: 'cs_pay',
    });
    // The failed attempt is on the record too: it is what explains the past due.
    expect(payments.find((payment) => payment.status === 'failed')).toMatchObject({
      kind: 'subscription',
      amountCents: 149_000,
    });
  });

  it('gives the month’s credits to the invoice that paid for the month, once', async () => {
    await deliver(
      eventPayload('customer.subscription.created', {
        id: 'sub_renew',
        object: 'subscription',
        customer: 'cus_acme',
        status: 'active',
        metadata: { organizationId, planId: 'pro' },
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
        cancel_at_period_end: false,
        items: { data: [{ quantity: 1 }] },
      }),
    );
    const firstMonth = (await store.organizations.get(organizationId))!.creditBalance;
    expect(firstMonth).toBe(2000);

    // The invoice that opened the subscription must not pay the allowance
    // twice: the subscription event already did.
    const opening = await deliver(
      eventPayload('invoice.payment_succeeded', {
        id: 'in_open',
        object: 'invoice',
        customer: 'cus_acme',
        amount_paid: 149_000,
        currency: 'eur',
        billing_reason: 'subscription_create',
      }),
    );
    expect(await opening.json()).toMatchObject({ handled: true, note: 'Payment recorded.' });
    expect((await store.organizations.get(organizationId))?.creditBalance).toBe(firstMonth);

    // Month two. This event was not handled at all before, so a customer sold
    // "2,000 credits a month" was given them once and never again.
    const renewal = await deliver(
      eventPayload('invoice.payment_succeeded', {
        id: 'in_month_2',
        object: 'invoice',
        customer: 'cus_acme',
        amount_paid: 149_000,
        currency: 'eur',
        billing_reason: 'subscription_cycle',
      }),
    );
    expect(await renewal.json()).toMatchObject({ handled: true, note: 'Renewed: 2000 credits.' });
    expect((await store.organizations.get(organizationId))?.creditBalance).toBe(firstMonth + 2000);

    // And Stripe's retry of that same delivery pays nothing a second time.
    const renewalPayload = eventPayload(
      'invoice.payment_succeeded',
      {
        id: 'in_month_2',
        object: 'invoice',
        customer: 'cus_acme',
        amount_paid: 149_000,
        currency: 'eur',
        billing_reason: 'subscription_cycle',
      },
      'evt_month_2_retry',
    );
    await deliver(renewalPayload);
    const afterFirst = (await store.organizations.get(organizationId))!.creditBalance;
    const retry = await deliver(renewalPayload);
    expect(await retry.json()).toMatchObject({ handled: false, note: 'Already processed.' });
    expect((await store.organizations.get(organizationId))?.creditBalance).toBe(afterFirst);

    // One receipt per month, and one for the invoice that opened it.
    const recorded = await store.payments.listForOrganization(organizationId);
    expect(recorded.filter((payment) => payment.kind === 'subscription')).toHaveLength(3);
  });

  it('refuses to trust an unsigned body when no webhook secret is configured', async () => {
    await saveProviderCredentials('stripe', { secretKey: SECRET_KEY }, 'usr_staff');
    const payload = eventPayload('checkout.session.completed', {
      id: 'cs_4',
      object: 'checkout.session',
      metadata: { organizationId, kind: 'credits', credits: '100' },
    });
    const response = await deliver(payload);
    expect(response.status).toBe(503);
    expect((await store.organizations.get(organizationId))?.creditBalance).toBe(0);
  });

  it('ignores an event it does not handle without failing the delivery', async () => {
    const response = await deliver(eventPayload('customer.created', { id: 'cus_x', object: 'customer' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ handled: false });
  });
});
