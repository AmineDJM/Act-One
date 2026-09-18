import 'server-only';
import {
  AppError,
  DEFAULT_REFERRAL_PROGRAM,
  REFERRAL_STAGE_LABELS,
  Referral,
  ReferralProgram,
  generateInviteCode,
  newId,
  normalizeInviteCode,
  referralCodeFor,
  referralLink,
  referralRefusal,
  referralReward,
  referralTotals,
  type InviteCode,
  type ReferralTotals,
} from '@act-one/core';
import { site } from '@/lib/site.ts';
import { getStore } from './store.ts';
import { getProductConfig, saveProductConfig } from './product.ts';
import type { Session } from './auth.ts';

/**
 * The referral programme, at the layer that decides what it pays.
 *
 * A customer's code is a durable invitation with their name on it. Somebody
 * who signs up through it is recorded once and only once, and nothing is
 * paid at that moment: the reward lands when the person they brought does
 * the work the programme asks for — produces a film, or pays a bill. Every
 * refusal is written down rather than silently dropped, so the console can
 * say why a referral earned nothing.
 */
export async function getReferralProgram(): Promise<ReferralProgram> {
  try {
    return (await getProductConfig()).referrals;
  } catch {
    return DEFAULT_REFERRAL_PROGRAM;
  }
}

export async function saveReferralProgram(patch: Partial<ReferralProgram>, updatedBy: string): Promise<ReferralProgram> {
  const current = await getReferralProgram();
  const next = ReferralProgram.parse({ ...current, ...patch });
  await saveProductConfig({ referrals: next }, updatedBy);
  return next;
}

// --- a person's own code ----------------------------------------------------------

/**
 * The customer's referral code, made on first ask and kept for good.
 *
 * Named after them where their name allows it — /invite/AMINE reads like a
 * person rather than a coupon — and unlimited in uses, because the cap that
 * matters is on rewards, not on how many people they may tell.
 */
export async function referralCodeOf(session: Session): Promise<InviteCode> {
  const store = getStore();
  const existing = (await store.invites.list({ kind: 'referral', ownerUserId: session.user.id, limit: 5 })).find((code) => !code.revokedAt);
  if (existing) return existing;

  const taken = new Set((await store.invites.list({ limit: 1000 })).map((code) => code.code));
  const now = new Date().toISOString();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = referralCodeFor(session.user.name || session.user.email.split('@')[0] || '', (candidate) => taken.has(candidate), () => generateInviteCode(Math.random, 'ACT'));
    try {
      return await store.invites.create({
        id: newId('inv'),
        code,
        kind: 'referral',
        note: `Referral code for ${session.user.email}`,
        maxUses: null,
        uses: 0,
        expiresAt: null,
        createdByUserId: session.user.id,
        ownerUserId: session.user.id,
        createdAt: now,
        revokedAt: null,
      });
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'conflict') || attempt === 4) throw error;
      taken.add(code);
    }
  }
  throw new AppError('conflict', 'Could not make a referral code.');
}

export type ReferralOverview = {
  code: string;
  link: string;
  program: ReferralProgram;
  totals: ReferralTotals;
  rows: { id: string; stage: string; label: string; when: string; credits: number }[];
};

/** The customer's referral page: their link, who came, and what it paid. */
export async function loadReferralOverview(session: Session): Promise<ReferralOverview> {
  const [program, code] = await Promise.all([getReferralProgram(), referralCodeOf(session)]);
  const referrals = await getStore().referrals.list({ inviterUserId: session.user.id, limit: 200 });
  return {
    code: code.code,
    link: referralLink(site.url, code.code),
    program,
    totals: referralTotals(referrals),
    rows: referrals.map((referral) => ({
      id: referral.id,
      stage: referral.stage,
      label: REFERRAL_STAGE_LABELS[referral.stage],
      when: referral.signedUpAt,
      credits: referral.inviterCreditsGranted,
    })),
  };
}

// --- the funnel -------------------------------------------------------------------

/**
 * Records that this account arrived on somebody's code.
 *
 * Called once, from sign-up, after the account and its workspace exist.
 * Nothing is paid here. A referral that can never pay is still recorded,
 * refused, with the reason — an operator asking "why did this not count?"
 * should find the answer rather than an absence.
 */
export async function recordReferral(code: InviteCode | null, session: Session): Promise<Referral | null> {
  if (!code || code.kind !== 'referral' || !code.ownerUserId) return null;
  const store = getStore();
  const program = await getReferralProgram();
  if (!program.enabled) return null;

  const [memberships, already, rewarded] = await Promise.all([
    store.memberships.listForUser(code.ownerUserId),
    store.referrals.getForInvitedUser(session.user.id),
    store.referrals.countRewardedFor(code.ownerUserId),
  ]);
  if (already) return already;

  const refusal = referralRefusal({
    inviterUserId: code.ownerUserId,
    invitedUserId: session.user.id,
    inviterOrganizationIds: memberships.map((membership) => membership.organizationId),
    invitedOrganizationId: session.organizationId,
    alreadyReferredInvited: false,
    rewardedForInviter: rewarded,
    program,
  });

  const now = new Date().toISOString();
  try {
    return await store.referrals.create(
      Referral.parse({
        id: newId('ref'),
        code: code.code,
        inviteCodeId: code.id,
        inviterUserId: code.ownerUserId,
        invitedUserId: session.user.id,
        invitedOrganizationId: session.organizationId,
        stage: refusal ? 'refused' : 'signed_up',
        refusedReason: refusal?.reason ?? '',
        signedUpAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    );
  } catch (error) {
    // A race on the unique invited user: the first one stands.
    if (error instanceof AppError && error.code === 'conflict') return store.referrals.getForInvitedUser(session.user.id);
    throw error;
  }
}

export type { ReferralOutcome } from '@act-one/db';

/**
 * The invited workspace did something real. Pay, once.
 *
 * The decision itself lives beside the store, because a film becomes ready
 * in the worker and a payment clears here; both must answer the same way.
 */
export async function advanceReferral(organizationId: string, reason: 'film_ready' | 'paid') {
  const { advanceReferral: advance } = await import('@act-one/db');
  return advance(getStore(), organizationId, reason);
}

// --- the public link --------------------------------------------------------------

/** The code behind /invite/{code}, when it is a live referral code. */
export async function referralCodeByCode(raw: string): Promise<{ code: InviteCode; inviterName: string } | null> {
  const typed = normalizeInviteCode(raw);
  if (!typed) return null;
  const store = getStore();
  const code = await store.invites.getByCode(typed);
  if (!code || code.kind !== 'referral' || code.revokedAt || !code.ownerUserId) return null;
  const owner = await store.users.get(code.ownerUserId);
  return { code, inviterName: owner?.name || owner?.email.split('@')[0] || 'A customer' };
}

// --- the console ------------------------------------------------------------------

export type ReferralRow = {
  referral: Referral;
  inviterEmail: string;
  invitedEmail: string;
  organizationName: string;
};

export async function listReferralsForConsole(limit = 200): Promise<{ rows: ReferralRow[]; counts: Record<string, number> }> {
  const store = getStore();
  const [referrals, counts] = await Promise.all([store.referrals.list({ limit }), store.referrals.countByStage()]);
  const rows = await Promise.all(
    referrals.map(async (referral) => {
      const [inviter, invited, organization] = await Promise.all([
        store.users.get(referral.inviterUserId),
        store.users.get(referral.invitedUserId),
        store.organizations.get(referral.invitedOrganizationId),
      ]);
      return {
        referral,
        inviterEmail: inviter?.email ?? referral.inviterUserId,
        invitedEmail: invited?.email ?? referral.invitedUserId,
        organizationName: organization?.name ?? referral.invitedOrganizationId,
      };
    }),
  );
  return { rows, counts };
}
