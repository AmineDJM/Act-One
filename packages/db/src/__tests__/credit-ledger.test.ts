import { describe, it, expect } from 'vitest';
import { newId, type NewOrganization } from '@act-one/core';
import { storeCases, uniqueSlug } from './stores.ts';

/**
 * Every movement of credits, written down once.
 *
 * The balance on the organisation row used to be the whole story — a number
 * that went up and down with nothing saying why — and every path that moved it
 * could run twice unnoticed. The rule this file exists to hold: a movement
 * carrying a key happens exactly once, the balance and the entry move together
 * or not at all, and a refusal leaves nothing behind.
 */
function org(name: string, credits = 0): NewOrganization {
  return {
    id: newId('org'), name, slug: uniqueSlug(name), planId: 'pro', stripeCustomerId: null,
    creditBalance: credits, maxProjectCostUsd: 100, isSuspended: false,
    createdAt: new Date().toISOString(),
  };
}

describe.each(storeCases())('the credit ledger ($name)', ({ open, close }) => {
  it('moves the balance and writes the entry together', async () => {
    const store = await open();
    try {
      const acme = await store.organizations.create(org('Acme'));
      const posting = await store.creditLedger.post({
        organizationId: acme.id,
        kind: 'purchase',
        delta: 2000,
        sourceKey: `purchase:${acme.id}:cs_1`,
        description: '2,000 credits bought',
      });

      expect(posting).toMatchObject({ applied: true, reason: 'applied', balance: 2000 });
      expect(posting.entry).toMatchObject({ kind: 'purchase', delta: 2000, balanceAfter: 2000 });
      expect((await store.organizations.get(acme.id))?.creditBalance).toBe(2000);
    } finally {
      await close(store);
    }
  });

  it('refuses a second movement under the same key, and reads as already done', async () => {
    const store = await open();
    try {
      const acme = await store.organizations.create(org('Acme'));
      const key = `allowance:${acme.id}:2026-01-15`;
      await store.creditLedger.post({ organizationId: acme.id, kind: 'allowance', delta: 2000, sourceKey: key });
      const again = await store.creditLedger.post({
        organizationId: acme.id, kind: 'allowance', delta: 2000, sourceKey: key,
      });

      // Not an error: the movement already happened, the balance is right, and
      // the caller carries on.
      expect(again).toMatchObject({ applied: false, reason: 'duplicate', balance: 2000 });
      expect((await store.organizations.get(acme.id))?.creditBalance).toBe(2000);
      expect(await store.creditLedger.listForOrganization(acme.id)).toHaveLength(1);
    } finally {
      await close(store);
    }
  });

  it('survives the same movement arriving at once from three places', async () => {
    const store = await open();
    try {
      const acme = await store.organizations.create(org('Acme'));
      const key = `allowance:${acme.id}:2026-02-15`;
      const postings = await Promise.all(
        [1, 2, 3].map(() =>
          store.creditLedger.post({ organizationId: acme.id, kind: 'allowance', delta: 2000, sourceKey: key }),
        ),
      );

      expect(postings.filter((posting) => posting.applied)).toHaveLength(1);
      expect((await store.organizations.get(acme.id))?.creditBalance).toBe(2000);
      expect(await store.creditLedger.listForOrganization(acme.id)).toHaveLength(1);
    } finally {
      await close(store);
    }
  });

  it('refuses a spend that would go below zero and leaves no trace of it', async () => {
    const store = await open();
    try {
      const acme = await store.organizations.create(org('Acme', 100));
      const refused = await store.creditLedger.post({
        organizationId: acme.id, kind: 'spend', delta: -400, sourceKey: `shot:${newId('scn')}`,
      });

      expect(refused).toMatchObject({ applied: false, reason: 'insufficient', balance: 100 });
      expect((await store.organizations.get(acme.id))?.creditBalance).toBe(100);
      // Nothing half-written: the entry was rolled back with the balance.
      expect(await store.creditLedger.listForOrganization(acme.id)).toHaveLength(0);
    } finally {
      await close(store);
    }
  });

  it('lets an unkeyed movement repeat, because some are meant to', async () => {
    const store = await open();
    try {
      const acme = await store.organizations.create(org('Acme'));
      await store.creditLedger.post({ organizationId: acme.id, kind: 'grant', delta: 50, sourceKey: `grant:${newId('cle')}` });
      await store.creditLedger.post({ organizationId: acme.id, kind: 'grant', delta: 50, sourceKey: `grant:${newId('cle')}` });

      // An operator granting the same amount twice usually means it.
      expect((await store.organizations.get(acme.id))?.creditBalance).toBe(100);
      expect(await store.creditLedger.listForOrganization(acme.id)).toHaveLength(2);
    } finally {
      await close(store);
    }
  });

  it('keeps one workspace’s statement out of another’s', async () => {
    const store = await open();
    try {
      const acme = await store.organizations.create(org('Acme'));
      const rival = await store.organizations.create(org('Rival'));
      await store.creditLedger.post({ organizationId: acme.id, kind: 'grant', delta: 10, sourceKey: `grant:${newId('cle')}` });
      await store.creditLedger.post({ organizationId: rival.id, kind: 'grant', delta: 20, sourceKey: `grant:${newId('cle')}` });

      expect(await store.creditLedger.listForOrganization(acme.id)).toHaveLength(1);
      expect((await store.creditLedger.listForOrganization(rival.id))[0]?.delta).toBe(20);
    } finally {
      await close(store);
    }
  });
});
