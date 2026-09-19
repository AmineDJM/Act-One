import { DEFAULT_REFERRAL_PROGRAM, ReferralProgram, referralReward, type Referral } from '@act-one/core';
import type { Store } from './store.ts';

/**
 * Paying a referral, from wherever the qualifying event happens.
 *
 * A film becomes ready inside the worker; a payment clears inside a webhook
 * in the app. Both must reach the same decision about the same referral, so
 * the decision lives here, beside the store, rather than in either one. The
 * arithmetic itself is pure and lives in @act-one/core.
 */
export type ReferralReason = 'film_ready' | 'paid';
export type ReferralOutcome = { referral: Referral; granted: { inviter: number; invited: number } } | null;

export async function readReferralProgram(store: Store): Promise<ReferralProgram> {
  try {
    const settings = await store.platform.getSettings();
    const parsed = ReferralProgram.safeParse((settings.product as { referrals?: unknown } | null)?.referrals ?? {});
    return parsed.success ? parsed.data : DEFAULT_REFERRAL_PROGRAM;
  } catch {
    return DEFAULT_REFERRAL_PROGRAM;
  }
}

/**
 * The invited workspace did something real. Pay once, within the cap.
 *
 * Producing a film pays when the programme asks for a film; a payment always
 * moves the referral to paid and adds the paid bonus once. Credits go to
 * workspaces, because a workspace is what spends them.
 */
export async function advanceReferral(store: Store, organizationId: string, reason: ReferralReason): Promise<ReferralOutcome> {
  const program = await readReferralProgram(store);
  if (!program.enabled) return null;

  const referral = await store.referrals.getForInvitedOrganization(organizationId);
  if (!referral || referral.stage === 'refused') return null;
  if (reason === 'film_ready' && referral.rewardedAt) return null;
  if (reason === 'paid' && referral.stage === 'paid') return null;

  const now = new Date().toISOString();
  if (reason === 'film_ready' && program.qualifyOn === 'paid') {
    // A film, under a programme that pays only on payment: noted, not paid.
    return { referral: await store.referrals.update(referral.id, { qualifiedAt: referral.qualifiedAt ?? now }), granted: { inviter: 0, invited: 0 } };
  }

  const cap = program.maxRewardedPerInviter;
  const rewarded = await store.referrals.countRewardedFor(referral.inviterUserId);
  if (cap !== null && rewarded >= cap && !referral.rewardedAt) {
    return {
      referral: await store.referrals.update(referral.id, {
        stage: reason === 'paid' ? 'paid' : referral.stage,
        qualifiedAt: referral.qualifiedAt ?? now,
        paidAt: reason === 'paid' ? now : referral.paidAt,
        refusedReason: `The inviter has reached the limit of ${cap} rewarded referrals.`,
      }),
      granted: { inviter: 0, invited: 0 },
    };
  }

  const reward = referralReward(program, rewarded + 1);
  const first = !referral.rewardedAt;
  const inviterCredits = (first ? reward.inviter + reward.tierBonus : 0) + (reason === 'paid' ? program.paidBonusCredits : 0);
  const invitedCredits = first ? reward.invited : 0;

  const inviterOrganizationId = (await store.memberships.listForUser(referral.inviterUserId))[0]?.organizationId ?? null;
  /*
   * Keyed by the referral and the side it pays, so the programme cannot pay
   * for the same introduction twice — a retried webhook, a second qualifying
   * event, a replayed job all land on the key that is already taken.
   */
  if (inviterCredits > 0 && inviterOrganizationId) {
    await store.creditLedger.post({
      organizationId: inviterOrganizationId,
      kind: 'referral',
      delta: inviterCredits,
      sourceKey: `referral:${referral.id}:inviter:${reason}`,
      description: 'Referral reward',
    });
  }
  if (invitedCredits > 0) {
    await store.creditLedger.post({
      organizationId: referral.invitedOrganizationId,
      kind: 'referral',
      delta: invitedCredits,
      sourceKey: `referral:${referral.id}:invited:${reason}`,
      description: 'Welcome credits from a referral',
    });
  }

  const updated = await store.referrals.update(referral.id, {
    stage: reason === 'paid' ? 'paid' : 'qualified',
    qualifiedAt: referral.qualifiedAt ?? now,
    paidAt: reason === 'paid' ? now : referral.paidAt,
    rewardedAt: referral.rewardedAt ?? now,
    inviterCreditsGranted: referral.inviterCreditsGranted + inviterCredits,
    invitedCreditsGranted: referral.invitedCreditsGranted + invitedCredits,
  });
  return { referral: updated, granted: { inviter: inviterCredits, invited: invitedCredits } };
}
