import { describe, it, expect } from 'vitest';
import { newId, type NewOrganization, type Payment } from '@act-one/core';
import { storeCases, uniqueSlug } from './stores.ts';

/**
 * The receipts.
 *
 * A credit balance says what a workspace has. Until this table existed nothing
 * said what anybody paid, when, or for what — so a customer could not be shown
 * their own receipts and an operator could not see a month's takings.
 *
 * Two rules, and both matter under a webhook that retries: one row per Stripe
 * event, and a workspace reads its own and nobody else's.
 */
function org(name: string): NewOrganization {
  return {
    id: newId('org'), name, slug: uniqueSlug(name), planId: 'pro', stripeCustomerId: null,
    creditBalance: 0, maxProjectCostUsd: 100, isSuspended: false, createdAt: new Date().toISOString(),
  };
}

function payment(organizationId: string, over: Partial<Payment> = {}): Payment {
  return {
    id: newId('pay'),
    organizationId,
    kind: 'credits',
    status: 'succeeded',
    amountCents: 24_000,
    currency: 'eur',
    credits: 2000,
    planId: null,
    description: '2,000 credits',
    stripeEventId: `evt_${newId('pay').slice(-10)}`,
    stripeObjectId: 'cs_1',
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe.each(storeCases())('payments ($name)', ({ open, close }) => {
  it('records one payment per Stripe event, however often it is delivered', async () => {
    const store = await open();
    try {
      const acme = await store.organizations.create(org('Acme'));
      const first = payment(acme.id);

      expect(await store.payments.record(first)).toMatchObject({ amountCents: 24_000, credits: 2000 });
      // The same event again — Stripe retries — writes nothing and says so.
      expect(await store.payments.record({ ...first, id: newId('pay') })).toBeNull();

      const recorded = await store.payments.listForOrganization(acme.id);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({ kind: 'credits', status: 'succeeded', currency: 'eur' });
    } finally {
      await close(store);
    }
  });

  it('keeps a failed attempt, because it is what explains a past due', async () => {
    const store = await open();
    try {
      const acme = await store.organizations.create(org('Acme'));
      await store.payments.record(
        payment(acme.id, { kind: 'subscription', status: 'failed', credits: null, planId: 'pro', amountCents: 149_000 }),
      );

      const [recorded] = await store.payments.listForOrganization(acme.id);
      expect(recorded).toMatchObject({ status: 'failed', kind: 'subscription', planId: 'pro', credits: null });
    } finally {
      await close(store);
    }
  });

  it('shows a workspace its own receipts and nobody else’s', async () => {
    const store = await open();
    try {
      const acme = await store.organizations.create(org('Acme'));
      const rival = await store.organizations.create(org('Rival'));
      await store.payments.record(payment(acme.id, { description: 'Acme' }));
      await store.payments.record(payment(rival.id, { description: 'Rival' }));

      expect((await store.payments.listForOrganization(acme.id)).map((p) => p.description)).toEqual(['Acme']);
      expect((await store.payments.listForOrganization(rival.id)).map((p) => p.description)).toEqual(['Rival']);
      // The operator sees both.
      const all = await store.payments.list(50);
      expect(all.filter((p) => p.organizationId === acme.id || p.organizationId === rival.id)).toHaveLength(2);
    } finally {
      await close(store);
    }
  });

  it('reads the newest first, which is the order an operator wants them', async () => {
    const store = await open();
    try {
      const acme = await store.organizations.create(org('Acme'));
      await store.payments.record(payment(acme.id, { description: 'older', createdAt: '2026-01-01T00:00:00.000Z' }));
      await store.payments.record(payment(acme.id, { description: 'newer', createdAt: '2026-06-01T00:00:00.000Z' }));

      expect((await store.payments.listForOrganization(acme.id)).map((p) => p.description)).toEqual([
        'newer',
        'older',
      ]);
    } finally {
      await close(store);
    }
  });
});
