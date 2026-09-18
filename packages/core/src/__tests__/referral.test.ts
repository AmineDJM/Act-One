import { describe, it, expect } from 'vitest';
import { DEFAULT_REFERRAL_PROGRAM, ReferralProgram, referralCodeFor, referralLink, referralQualifies, referralRefusal, referralReward, referralTotals, type Referral } from '@act-one/core';

/**
 * The programme's arithmetic and its refusals, where they are decided.
 *
 * Everything here is pure, because the worker, the payment webhook and the
 * console all ask the same questions and must never answer differently.
 */
function referral(over: Partial<Referral> = {}): Referral {
  const at = '2026-01-01T00:00:00.000Z';
  return {
    id: 'ref_1', code: 'AMINE', inviteCodeId: 'inv_1', inviterUserId: 'usr_a', invitedUserId: 'usr_b',
    invitedOrganizationId: 'org_b', stage: 'signed_up', refusedReason: '', inviterCreditsGranted: 0, invitedCreditsGranted: 0,
    signedUpAt: at, qualifiedAt: null, paidAt: null, rewardedAt: null, createdAt: at, updatedAt: at, ...over,
  };
}

describe('a referral code', () => {
  it('is the person, when their name allows it', () => {
    expect(referralCodeFor('Amine Djouamaii', () => false, () => 'ACT-XXXX')).toBe('AMINEDJOUAMA');
    expect(referralCodeFor('Ada', () => false, () => 'ACT-XXXX')).toBe('ADA');
    expect(referralCodeFor('Ada', (candidate) => candidate === 'ADA', () => 'ACT-XXXX')).toBe('ADA2');
    // Nothing usable: a generated code rather than a bad one.
    expect(referralCodeFor('北', () => false, () => 'ACT-ABCD-EFGH')).toBe('ACT-ABCD-EFGH');
    expect(referralCodeFor('Zoé Lévy', () => false, () => 'ACT-XXXX')).toBe('ZOELEVY');
  });

  it('is a public address', () => {
    expect(referralLink('https://actone.com/', 'AMINE')).toBe('https://actone.com/invite/AMINE');
  });
});

describe('what a referral pays', () => {
  it('refuses the ways credits could be minted from nothing', () => {
    const base = {
      inviterUserId: 'usr_a',
      invitedUserId: 'usr_b',
      inviterOrganizationIds: ['org_a'],
      invitedOrganizationId: 'org_b',
      alreadyReferredInvited: false,
      rewardedForInviter: 0,
      program: DEFAULT_REFERRAL_PROGRAM,
    };
    expect(referralRefusal(base)).toBeNull();
    expect(referralRefusal({ ...base, invitedUserId: 'usr_a' })?.reason).toContain('themselves');
    expect(referralRefusal({ ...base, invitedOrganizationId: 'org_a' })?.reason).toContain('already in');
    expect(referralRefusal({ ...base, alreadyReferredInvited: true })?.reason).toContain('already referred');
    expect(referralRefusal({ ...base, rewardedForInviter: 25 })?.reason).toContain('limit of 25');
    // No ceiling configured: no ceiling enforced.
    const open = ReferralProgram.parse({ maxRewardedPerInviter: null });
    expect(referralRefusal({ ...base, rewardedForInviter: 900, program: open })).toBeNull();
  });

  it('pays both sides, and a tier exactly once', () => {
    const program = ReferralProgram.parse({
      inviterCredits: 200,
      invitedCredits: 100,
      tiers: [{ at: 5, bonusCredits: 1000, label: 'Five founders' }],
    });
    expect(referralReward(program, 1)).toMatchObject({ inviter: 200, invited: 100, tierBonus: 0 });
    expect(referralReward(program, 5)).toMatchObject({ inviter: 200, invited: 100, tierBonus: 1000, tierLabel: 'Five founders' });
    expect(referralReward(program, 6).tierBonus).toBe(0);
  });

  it('asks for what the programme asks for', () => {
    const onFilm = ReferralProgram.parse({ qualifyOn: 'film_ready' });
    const onPaid = ReferralProgram.parse({ qualifyOn: 'paid' });
    expect(referralQualifies(onFilm, { filmReady: true, paid: false })).toBe(true);
    expect(referralQualifies(onFilm, { filmReady: false, paid: true })).toBe(true);
    expect(referralQualifies(onPaid, { filmReady: true, paid: false })).toBe(false);
    expect(referralQualifies(onPaid, { filmReady: true, paid: true })).toBe(true);
  });

  it("counts a person's funnel the way their page shows it", () => {
    const totals = referralTotals([
      referral({ stage: 'signed_up' }),
      referral({ id: 'ref_2', stage: 'qualified', inviterCreditsGranted: 200 }),
      referral({ id: 'ref_3', stage: 'paid', inviterCreditsGranted: 600 }),
      referral({ id: 'ref_4', stage: 'refused', refusedReason: 'A person cannot invite themselves.' }),
    ]);
    expect(totals).toEqual({ signedUp: 4, qualified: 2, paid: 1, refused: 1, creditsEarned: 800 });
  });
});
