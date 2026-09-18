import { describe, it, expect } from 'vitest';
import { newId, type BetaApplication, type InviteCode, type User } from '@act-one/core';
import type { Store } from '../store.ts';
import { storeCases, uniqueEmail } from './stores.ts';

/**
 * The door, against every store: a code is one use per person and no more
 * than it allows, two people racing for the last use get one each, a
 * withdrawn or expired code opens nothing, and a request for access waits
 * for a decision.
 */
function user(email: string): User {
  const [local = 'someone', domain = 'example.com'] = email.split('@');
  return { id: newId('usr'), email: uniqueEmail(local, domain), name: local, avatarUrl: null, isSuperAdmin: false, createdAt: new Date().toISOString() };
}

function code(over: Partial<InviteCode> = {}): InviteCode {
  return {
    id: newId('inv'), code: `ACT-${newId('inv').slice(-8).toUpperCase()}`, kind: 'invite', note: '', maxUses: 1, uses: 0, expiresAt: null,
    createdByUserId: null, ownerUserId: null, createdAt: new Date().toISOString(), revokedAt: null, ...over,
  };
}

function application(over: Partial<BetaApplication> = {}): BetaApplication {
  return {
    id: newId('bap'), email: uniqueEmail('founder'), name: 'Ada', company: 'Acme', website: 'https://acme.example', message: 'Launching in October.',
    status: 'pending', inviteCodeId: null, note: '', createdAt: new Date().toISOString(), decidedAt: null, decidedByUserId: null, ...over,
  };
}

for (const kase of storeCases()) {
  describe(`invitations (${kase.name})`, () => {
    it('opens once per person and no more than it allows', async () => {
      const store: Store = await kase.open();
      try {
        const ada = await store.users.create(user('ada@acme.com'));
        const bob = await store.users.create(user('bob@acme.com'));
        const two = await store.invites.create(code({ maxUses: 2 }));
        expect(await store.invites.redeem(two.id, ada.id)).toBe(true);
        expect(await store.invites.redeem(two.id, ada.id)).toBe(false);
        expect(await store.invites.redeem(two.id, bob.id)).toBe(true);
        expect((await store.invites.get(two.id))?.uses).toBe(2);
        const carol = await store.users.create(user('carol@acme.com'));
        expect(await store.invites.redeem(two.id, carol.id)).toBe(false);
        expect((await store.invites.listRedemptions(two.id)).map((entry) => entry.userId)).toEqual([ada.id, bob.id]);
        expect((await store.invites.redemptionFor(bob.id))?.codeId).toBe(two.id);
        expect(await store.invites.redemptionFor(carol.id)).toBeNull();
        expect((await store.invites.getByCode(two.code))?.id).toBe(two.id);
        expect(await store.invites.getByCode('ACT-NOPE-NOPE')).toBeNull();
      } finally {
        await kase.close(store);
      }
    });

    it('gives the last use to exactly one of two people racing for it', async () => {
      const store: Store = await kase.open();
      try {
        const people = await Promise.all([user('a@acme.com'), user('b@acme.com'), user('c@acme.com'), user('d@acme.com')].map((entry) => store.users.create(entry)));
        const last = await store.invites.create(code({ maxUses: 1 }));
        const outcomes = await Promise.all(people.map((person) => store.invites.redeem(last.id, person.id)));
        expect(outcomes.filter(Boolean)).toHaveLength(1);
        expect((await store.invites.get(last.id))?.uses).toBe(1);
      } finally {
        await kase.close(store);
      }
    });

    it('opens nothing once withdrawn or expired, and unlimited means unlimited', async () => {
      const store: Store = await kase.open();
      try {
        const ada = await store.users.create(user('ada@acme.com'));
        const bob = await store.users.create(user('bob@acme.com'));
        const withdrawn = await store.invites.create(code());
        await store.invites.revoke(withdrawn.id);
        expect((await store.invites.get(withdrawn.id))?.revokedAt).not.toBeNull();
        expect(await store.invites.redeem(withdrawn.id, ada.id)).toBe(false);
        const expired = await store.invites.create(code({ expiresAt: '2020-01-01T00:00:00.000Z' }));
        expect(await store.invites.redeem(expired.id, ada.id)).toBe(false);
        const open = await store.invites.create(code({ maxUses: null, kind: 'referral', ownerUserId: ada.id }));
        expect(await store.invites.redeem(open.id, ada.id)).toBe(true);
        expect(await store.invites.redeem(open.id, bob.id)).toBe(true);
        expect((await store.invites.list({ kind: 'referral', ownerUserId: ada.id })).map((entry) => entry.id)).toEqual([open.id]);
        await expect(store.invites.create(code({ code: open.code }))).rejects.toThrow();
      } finally {
        await kase.close(store);
      }
    });

    it('keeps a request for access until a person decides', async () => {
      const store: Store = await kase.open();
      try {
        const admin = await store.users.create(user('staff@actone.example'));
        const request = await store.applications.create(application());
        expect((await store.applications.getByEmail(request.email.toUpperCase()))?.id).toBe(request.id);
        expect((await store.applications.list({ status: 'pending' })).map((entry) => entry.id)).toContain(request.id);
        const invite = await store.invites.create(code({ note: `Approved: ${request.email}` }));
        const decided = await store.applications.update(request.id, { status: 'approved', inviteCodeId: invite.id, decidedAt: new Date().toISOString(), decidedByUserId: admin.id });
        expect(decided).toMatchObject({ status: 'approved', inviteCodeId: invite.id, decidedByUserId: admin.id });
        expect((await store.applications.get(request.id))?.status).toBe('approved');
        expect((await store.applications.countByStatus())['approved']).toBeGreaterThanOrEqual(1);
      } finally {
        await kase.close(store);
      }
    });
  });
}
