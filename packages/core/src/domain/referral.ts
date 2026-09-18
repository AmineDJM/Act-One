import { z } from 'zod';

/**
 * The referral programme.
 *
 * A customer who brings another founder is worth more than an ad, and the
 * programme says so in credits. It is deliberately hard to game: an account
 * that only exists is worth nothing. A referral earns when the person it
 * brought does real work — a film produced, or a bill paid — and each
 * invited person earns for their inviter exactly once, within a cap the
 * operator sets. Nothing here is a coupon: the reward is production credits,
 * granted to the workspace, and every grant is written down.
 */
export const ReferralStage = z.enum(['signed_up', 'qualified', 'paid', 'refused']);
export type ReferralStage = z.infer<typeof ReferralStage>;

export const REFERRAL_STAGE_LABELS: Record<ReferralStage, string> = {
  signed_up: 'Signed up',
  qualified: 'Produced a film',
  paid: 'Paying',
  refused: 'Not counted',
};

/** What an invited account must do before their inviter is rewarded. */
export const ReferralQualification = z.enum(['film_ready', 'paid']);
export type ReferralQualification = z.infer<typeof ReferralQualification>;

/**
 * A tier: at this many qualified referrals, this many extra credits, once.
 *
 * Ordered by `at`; a tier is paid the first time the count reaches it.
 */
export const ReferralTier = z.object({
  at: z.number().int().min(1).max(1000),
  bonusCredits: z.number().int().min(0).max(100_000),
  label: z.string().max(80).default(''),
});
export type ReferralTier = z.infer<typeof ReferralTier>;

export const ReferralProgram = z.object({
  enabled: z.boolean().default(false),
  /** What the invited account must do before anybody is paid. */
  qualifyOn: ReferralQualification.default('film_ready'),
  /** Credits to the inviter, once, when their invited account qualifies. */
  inviterCredits: z.number().int().min(0).max(100_000).default(200),
  /** Credits to the invited account when they qualify — the reason to use a link rather than sign up cold. */
  invitedCredits: z.number().int().min(0).max(100_000).default(100),
  /** Credits to the inviter, once, the first time an invited account pays. */
  paidBonusCredits: z.number().int().min(0).max(100_000).default(400),
  /** The most referrals one person may ever be rewarded for. Null means no ceiling. */
  maxRewardedPerInviter: z.number().int().min(1).max(10_000).nullable().default(25),
  tiers: z.array(ReferralTier).max(10).default([]),
  /** What the customer's referral page says above their link. */
  headline: z.string().max(120).default('Bring a founder. Both of you get credits.'),
  terms: z.string().max(600).default('Credits land when the person you invited produces their first film. One reward per person invited.'),
});
export type ReferralProgram = z.infer<typeof ReferralProgram>;
export const DEFAULT_REFERRAL_PROGRAM: ReferralProgram = ReferralProgram.parse({});

export const Referral = z.object({
  id: z.string(),
  /** The code that was used, kept for the record even if the code is later withdrawn. */
  code: z.string().max(40),
  inviteCodeId: z.string(),
  inviterUserId: z.string(),
  invitedUserId: z.string(),
  /** The workspace the invited person created; where their credits go. */
  invitedOrganizationId: z.string(),
  stage: ReferralStage.default('signed_up'),
  /** Why this referral will never be rewarded, when it will not. */
  refusedReason: z.string().max(200).default(''),
  /** Credits actually granted, to each side. */
  inviterCreditsGranted: z.number().int().min(0).default(0),
  invitedCreditsGranted: z.number().int().min(0).default(0),
  signedUpAt: z.string(),
  qualifiedAt: z.string().nullable().default(null),
  paidAt: z.string().nullable().default(null),
  rewardedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Referral = z.infer<typeof Referral>;

/** The public address a customer shares. */
export function referralLink(siteUrl: string, code: string): string {
  return `${siteUrl.replace(/\/$/, '')}/invite/${encodeURIComponent(code)}`;
}

/**
 * A referral code from a person's name: readable, shareable, theirs.
 *
 * "Amine Djouamaii" becomes AMINE; a clash takes AMINE2. Falls back to a
 * generated code when there is nothing usable in the name.
 */
export function referralCodeFor(name: string, taken: (candidate: string) => boolean, fallback: () => string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
  if (base.length < 3) return fallback();
  if (!taken(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}${suffix}`;
    if (!taken(candidate)) return candidate;
  }
  return fallback();
}

export type ReferralRefusal = { reason: string } | null;

/**
 * Why this referral can never pay, at the moment it is created.
 *
 * Self-referral and same-workspace referral are the two obvious ways to mint
 * credits from nothing; both are refused outright rather than silently
 * ignored, so the console can show what happened.
 */
export function referralRefusal(input: {
  inviterUserId: string;
  invitedUserId: string;
  inviterOrganizationIds: readonly string[];
  invitedOrganizationId: string;
  alreadyReferredInvited: boolean;
  rewardedForInviter: number;
  program: ReferralProgram;
}): ReferralRefusal {
  if (input.inviterUserId === input.invitedUserId) return { reason: 'A person cannot invite themselves.' };
  if (input.inviterOrganizationIds.includes(input.invitedOrganizationId)) {
    return { reason: 'The account joined a workspace the inviter is already in.' };
  }
  if (input.alreadyReferredInvited) return { reason: 'This person was already referred.' };
  const cap = input.program.maxRewardedPerInviter;
  if (cap !== null && input.rewardedForInviter >= cap) return { reason: `The inviter has reached the limit of ${cap} rewarded referrals.` };
  return null;
}

export type ReferralReward = {
  /** Credits for the inviter's workspace. */
  inviter: number;
  /** Credits for the invited workspace. */
  invited: number;
  /** A tier's one-off bonus, if this referral crossed one. */
  tierBonus: number;
  tierLabel: string;
};

/**
 * What this qualification pays, given how many the inviter already has.
 *
 * Pure, so the worker, the webhook and the console cannot disagree about a
 * person's balance.
 */
export function referralReward(program: ReferralProgram, qualifiedCountAfter: number): ReferralReward {
  const tier = program.tiers.find((candidate) => candidate.at === qualifiedCountAfter);
  return {
    inviter: program.inviterCredits,
    invited: program.invitedCredits,
    tierBonus: tier?.bonusCredits ?? 0,
    tierLabel: tier?.label ?? '',
  };
}

/** Has this referral done what the programme asks? */
export function referralQualifies(program: ReferralProgram, signals: { filmReady: boolean; paid: boolean }): boolean {
  return program.qualifyOn === 'paid' ? signals.paid : signals.filmReady || signals.paid;
}

export type ReferralTotals = { signedUp: number; qualified: number; paid: number; refused: number; creditsEarned: number };

export function referralTotals(referrals: readonly Referral[]): ReferralTotals {
  return {
    signedUp: referrals.length,
    qualified: referrals.filter((referral) => referral.stage === 'qualified' || referral.stage === 'paid').length,
    paid: referrals.filter((referral) => referral.stage === 'paid').length,
    refused: referrals.filter((referral) => referral.stage === 'refused').length,
    creditsEarned: referrals.reduce((sum, referral) => sum + referral.inviterCreditsGranted, 0),
  };
}
