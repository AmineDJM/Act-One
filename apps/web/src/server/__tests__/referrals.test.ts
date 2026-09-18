import { describe, it, expect, beforeEach } from 'vitest';
import { AppError, newId } from '@act-one/core';
import { MemoryStore } from '@act-one/db';
import { request, resetRequest } from './request-scope.ts';
import { signUp, type Session } from '../auth.ts';
import { saveProductConfig } from '../product.ts';
import { advanceReferral, loadReferralOverview, recordReferral, referralCodeByCode, referralCodeOf, saveReferralProgram } from '../referrals.ts';

/**
 * The programme at the layer that records it: a code that belongs to a
 * person, a referral written down once, and rewards that only follow real
 * work. The arithmetic itself is proven in the core and db suites.
 */
let store: MemoryStore;

async function person(name: string): Promise<Session> {
  resetRequest();
  request().headers.set('x-forwarded-for', `203.0.113.${Math.floor(Math.random() * 200) + 1}`);
  return signUp({ email: `${name}-${newId('usr').slice(-6)}@example.com`, password: 'a-very-long-password', name });
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected a failure');
}

beforeEach(async () => {
  store = new MemoryStore();
  globalThis.__actOneStore = store;
});

describe('a customer’s referral code', () => {
  it('is made once, named after them, and reachable by its public address', async () => {
    const staff = await person('Ada Lovelace');
    await saveReferralProgram({ enabled: true }, staff.user.id);
    const code = await referralCodeOf(staff);
    expect(code).toMatchObject({ kind: 'referral', ownerUserId: staff.user.id, maxUses: null });
    expect(code.code).toBe('ADALOVELACE');
    // Asked again, the same code: a link a person shared must keep working.
    expect((await referralCodeOf(staff)).id).toBe(code.id);

    const found = await referralCodeByCode('adalovelace');
    expect(found?.code.id).toBe(code.id);
    expect(found?.inviterName).toBe('Ada Lovelace');
    expect(await referralCodeByCode('NOBODY')).toBeNull();

    const overview = await loadReferralOverview(staff);
    expect(overview.link.endsWith('/invite/ADALOVELACE')).toBe(true);
    expect(overview.totals).toMatchObject({ signedUp: 0, qualified: 0, creditsEarned: 0 });
  });

  it('records who brought whom, once, and refuses what cannot be rewarded', async () => {
    const inviter = await person('Ada');
    await saveReferralProgram({ enabled: true, inviterCredits: 200, invitedCredits: 100 }, inviter.user.id);
    const code = await referralCodeOf(inviter);

    const invited = await person('Bob');
    const referral = await recordReferral(code, invited);
    expect(referral).toMatchObject({ stage: 'signed_up', inviterUserId: inviter.user.id, invitedUserId: invited.user.id, code: code.code });
    // Recorded once: a second pass returns the same row rather than a second one.
    expect((await recordReferral(code, invited))?.id).toBe(referral?.id);

    // Inviting yourself is written down as refused, with the reason.
    const selfCode = await referralCodeOf(inviter);
    const self = await recordReferral(selfCode, inviter);
    expect(self).toMatchObject({ stage: 'refused' });
    expect(self?.refusedReason).toContain('themselves');

    // Nothing has been paid yet: a signup is not work.
    expect((await store.organizations.get(inviter.organizationId))?.creditBalance).toBe(0);

    const outcome = await advanceReferral(invited.organizationId, 'film_ready');
    expect(outcome?.granted).toEqual({ inviter: 200, invited: 100 });
    expect((await store.organizations.get(inviter.organizationId))?.creditBalance).toBe(200);
    expect((await store.organizations.get(invited.organizationId))?.creditBalance).toBe(100);

    const overview = await loadReferralOverview(inviter);
    expect(overview.totals).toMatchObject({ qualified: 1, creditsEarned: 200 });
  });

  it('does nothing at all while the programme is off', async () => {
    const inviter = await person('Ada');
    const code = await referralCodeOf(inviter);
    const invited = await person('Bob');
    expect(await recordReferral(code, invited)).toBeNull();
    expect(await advanceReferral(invited.organizationId, 'film_ready')).toBeNull();
    // A plain invitation code is not a referral, whatever the programme says.
    await saveReferralProgram({ enabled: true }, inviter.user.id);
    const plain = await store.invites.create({
      id: newId('inv'), code: 'ACT-PLAIN-CODE', kind: 'invite', note: '', maxUses: 1, uses: 0, expiresAt: null,
      createdByUserId: inviter.user.id, ownerUserId: null, createdAt: new Date().toISOString(), revokedAt: null,
    });
    const other = await person('Carol');
    expect(await recordReferral(plain, other)).toBeNull();
  });

  it('is only shown while the programme runs', async () => {
    const staff = await person('Ada');
    await saveProductConfig({ phase: 'production' }, staff.user.id);
    const overview = await loadReferralOverview(staff);
    expect(overview.program.enabled).toBe(false);
    expect((await failure(Promise.reject(new AppError('not_found', 'x')))).code).toBe('not_found');
  });
});
