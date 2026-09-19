import { describe, it, expect } from 'vitest';
import { ReferralProgram, newId, type Membership, type NewOrganization, type Organization, type Referral, type User } from '@act-one/core';
import { advanceReferral } from '../referrals.ts';
import type { Store } from '../store.ts';
import { storeCases, uniqueEmail, uniqueSlug } from './stores.ts';

/**
 * The payout, against every store: one reward per referral, credits landing
 * in the right workspaces, a ceiling that holds, and a programme that pays
 * only for what it asks for.
 */
function org(name: string, credits = 0): NewOrganization {
  return {
    id: newId('org'), name, slug: uniqueSlug(name), planId: 'pro', stripeCustomerId: null,
    creditBalance: credits, maxProjectCostUsd: 100, isSuspended: false, createdAt: new Date().toISOString(),
  };
}

function user(local: string): User {
  return { id: newId('usr'), email: uniqueEmail(local), name: local, avatarUrl: null, isSuperAdmin: false, createdAt: new Date().toISOString() };
}

function membership(organizationId: string, userId: string): Membership {
  return { id: newId('mem'), organizationId, userId, role: 'owner', createdAt: new Date().toISOString() };
}

function referral(over: Partial<Referral> & Pick<Referral, 'inviterUserId' | 'invitedUserId' | 'invitedOrganizationId' | 'inviteCodeId'>): Referral {
  const at = new Date().toISOString();
  return {
    id: newId('ref'), code: 'AMINE', stage: 'signed_up', refusedReason: '', inviterCreditsGranted: 0, invitedCreditsGranted: 0,
    signedUpAt: at, qualifiedAt: null, paidAt: null, rewardedAt: null, createdAt: at, updatedAt: at, ...over,
  };
}

async function programOf(store: Store, patch: Partial<ReferralProgram>): Promise<void> {
  const settings = await store.platform.getSettings();
  await store.platform.updateSettings(
    { product: { ...(settings.product as Record<string, unknown>), referrals: ReferralProgram.parse({ enabled: true, ...patch }) } },
    'test',
  );
}

/** An inviter, an invited workspace, and a live referral between them. */
async function scene(store: Store, patch: Partial<ReferralProgram> = {}) {
  await programOf(store, patch);
  const inviterOrg = await store.organizations.create(org('Inviter'));
  const invitedOrg = await store.organizations.create(org('Invited'));
  const inviter = await store.users.create(user('inviter'));
  const invited = await store.users.create(user('invited'));
  await store.memberships.create(membership(inviterOrg.id, inviter.id));
  await store.memberships.create(membership(invitedOrg.id, invited.id));
  const code = await store.invites.create({
    id: newId('inv'), code: `REF${newId('inv').slice(-6).toUpperCase()}`, kind: 'referral', note: '', maxUses: null, uses: 0,
    expiresAt: null, createdByUserId: inviter.id, ownerUserId: inviter.id, createdAt: new Date().toISOString(), revokedAt: null,
  });
  const record = await store.referrals.create(
    referral({ inviterUserId: inviter.id, invitedUserId: invited.id, invitedOrganizationId: invitedOrg.id, inviteCodeId: code.id }),
  );
  return { inviterOrg, invitedOrg, inviter, invited, code, record };
}

for (const kase of storeCases()) {
  describe(`referral payouts (${kase.name})`, () => {
    it('pays both sides once when the invited workspace produces a film', async () => {
      const store: Store = await kase.open();
      try {
        const { inviterOrg, invitedOrg, record } = await scene(store, { inviterCredits: 200, invitedCredits: 100 });
        const first = await advanceReferral(store, invitedOrg.id, 'film_ready');
        expect(first?.granted).toEqual({ inviter: 200, invited: 100 });
        expect(first?.referral).toMatchObject({ stage: 'qualified', inviterCreditsGranted: 200, invitedCreditsGranted: 100 });
        expect((await store.organizations.get(inviterOrg.id))?.creditBalance).toBe(200);
        expect((await store.organizations.get(invitedOrg.id))?.creditBalance).toBe(100);

        // A second film pays nothing more.
        expect(await advanceReferral(store, invitedOrg.id, 'film_ready')).toBeNull();
        expect((await store.organizations.get(inviterOrg.id))?.creditBalance).toBe(200);
        expect((await store.referrals.get(record.id))?.rewardedAt).not.toBeNull();
        expect(await store.referrals.countRewardedFor(record.inviterUserId)).toBe(1);
      } finally {
        await kase.close(store);
      }
    });

    it('waits for the payment when the programme asks for one, then adds the bonus', async () => {
      const store: Store = await kase.open();
      try {
        const { inviterOrg, invitedOrg } = await scene(store, { qualifyOn: 'paid', inviterCredits: 200, invitedCredits: 100, paidBonusCredits: 400 });
        const film = await advanceReferral(store, invitedOrg.id, 'film_ready');
        expect(film?.granted).toEqual({ inviter: 0, invited: 0 });
        expect((await store.organizations.get(inviterOrg.id))?.creditBalance).toBe(0);

        const paid = await advanceReferral(store, invitedOrg.id, 'paid');
        expect(paid?.referral.stage).toBe('paid');
        // The reward and the paid bonus, together, the first time money arrives.
        expect(paid?.granted).toEqual({ inviter: 600, invited: 100 });
        expect((await store.organizations.get(inviterOrg.id))?.creditBalance).toBe(600);
        expect(await advanceReferral(store, invitedOrg.id, 'paid')).toBeNull();
      } finally {
        await kase.close(store);
      }
    });

    it('holds the ceiling, and pays nothing while the programme is off', async () => {
      const store: Store = await kase.open();
      try {
        const { inviterOrg, invitedOrg, inviter, code } = await scene(store, { maxRewardedPerInviter: 1, inviterCredits: 200, invitedCredits: 100 });
        await advanceReferral(store, invitedOrg.id, 'film_ready');
        expect((await store.organizations.get(inviterOrg.id))?.creditBalance).toBe(200);

        // A second person, same inviter, over the ceiling.
        const secondOrg = await store.organizations.create(org('Second'));
        const second = await store.users.create(user('second'));
        await store.memberships.create(membership(secondOrg.id, second.id));
        await store.referrals.create(
          referral({ inviterUserId: inviter.id, invitedUserId: second.id, invitedOrganizationId: secondOrg.id, inviteCodeId: code.id }),
        );
        const capped = await advanceReferral(store, secondOrg.id, 'film_ready');
        expect(capped?.granted).toEqual({ inviter: 0, invited: 0 });
        expect(capped?.referral.refusedReason).toContain('limit of 1');
        expect((await store.organizations.get(inviterOrg.id))?.creditBalance).toBe(200);

        // Off: nothing moves at all.
        await programOf(store, { enabled: false });
        const thirdOrg = await store.organizations.create(org('Third'));
        const third = await store.users.create(user('third'));
        await store.memberships.create(membership(thirdOrg.id, third.id));
        await store.referrals.create(
          referral({ inviterUserId: inviter.id, invitedUserId: third.id, invitedOrganizationId: thirdOrg.id, inviteCodeId: code.id }),
        );
        expect(await advanceReferral(store, thirdOrg.id, 'film_ready')).toBeNull();
      } finally {
        await kase.close(store);
      }
    });

    it('keeps one referral per invited person, and finds it by person and by workspace', async () => {
      const store: Store = await kase.open();
      try {
        const { record, invited, invitedOrg, inviter, code } = await scene(store);
        expect((await store.referrals.getForInvitedUser(invited.id))?.id).toBe(record.id);
        expect((await store.referrals.getForInvitedOrganization(invitedOrg.id))?.id).toBe(record.id);
        await expect(
          store.referrals.create(referral({ inviterUserId: inviter.id, invitedUserId: invited.id, invitedOrganizationId: invitedOrg.id, inviteCodeId: code.id })),
        ).rejects.toThrow();
        const mine = await store.referrals.list({ inviterUserId: inviter.id });
        expect(mine.map((item) => item.id)).toContain(record.id);
      } finally {
        await kase.close(store);
      }
    });
  });
}
