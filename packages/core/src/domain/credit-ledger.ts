import { z } from 'zod';

/**
 * Why credits moved.
 *
 * An allowance is the plan's promise arriving. A purchase is money. A grant is
 * an operator's decision. A referral is the programme paying out. A spend is
 * the product consuming what it was given. An adjustment is everything else,
 * and is expected to be rare enough that a description is worth reading.
 */
export const CreditEntryKind = z.enum([
  'allowance',
  'purchase',
  'grant',
  'referral',
  'spend',
  'adjustment',
]);
export type CreditEntryKind = z.infer<typeof CreditEntryKind>;

/**
 * One movement of credits, written down and never edited.
 *
 * The balance on the organisation row used to be the whole story: a number
 * that went up and down with nothing saying why, so "where did my credits go"
 * and "were they given this month's allowance twice" were both unanswerable.
 *
 * `sourceKey` is what makes an allocation idempotent. Every movement that
 * could arrive more than once — a Stripe webhook retried, an hourly accrual
 * racing the invoice that triggers it, two workers claiming the same job —
 * carries a key derived from what it is rather than from when it ran, and the
 * store refuses the second one. A movement that is genuinely repeatable, such
 * as an operator adding credits twice on purpose, carries a unique key.
 */
export const CreditLedgerEntry = z.object({
  id: z.string(),
  organizationId: z.string(),
  kind: CreditEntryKind,
  /** Signed. Positive gives credits, negative consumes them. */
  delta: z.number().int(),
  /** The balance after this entry was applied. */
  balanceAfter: z.number().int().min(0),
  /**
   * The idempotency key. Unique across the table; null only for movements
   * that cannot repeat and have nothing to key on.
   */
  sourceKey: z.string().max(200).nullable().default(null),
  description: z.string().max(400).default(''),
  planId: z.string().nullable().default(null),
  subscriptionId: z.string().nullable().default(null),
  /** For an allowance: the period it covers, as the date that period opened. */
  periodKey: z.string().max(40).nullable().default(null),
  paymentId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  renderId: z.string().nullable().default(null),
  /** The operator who decided, where a person decided. */
  actorUserId: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type CreditLedgerEntry = z.infer<typeof CreditLedgerEntry>;

/**
 * What a caller has to say to move credits: whose, why, how much.
 *
 * Everything else is context the store writes down if it is offered. A caller
 * that has a render id should pass it; one that does not should not have to
 * pass a null for every field it has nothing to say about.
 */
export type CreditMovement = Pick<CreditLedgerEntry, 'organizationId' | 'kind' | 'delta'> &
  Partial<Omit<CreditLedgerEntry, 'organizationId' | 'kind' | 'delta' | 'balanceAfter'>>;

/**
 * The outcome of trying to move credits.
 *
 * `applied: false` with a reason of 'duplicate' is the happy path for a retry:
 * the movement already happened, the balance is right, and the caller should
 * carry on. 'insufficient' is a real refusal.
 */
export type CreditPosting = {
  applied: boolean;
  reason: 'applied' | 'duplicate' | 'insufficient';
  balance: number;
  entry: CreditLedgerEntry | null;
};

/** The key an allowance for one period is written under. */
export function allowanceKey(subscriptionId: string, periodKey: string): string {
  return `allowance:${subscriptionId}:${periodKey}`;
}

/**
 * The key for the top-up a mid-period upgrade earns.
 *
 * Separate from the period's own key so both can exist: the customer was given
 * Launch's allowance on the 3rd and moved to Pro on the 11th, and what they
 * are owed is the difference, once, for this period and this plan.
 */
export function upgradeKey(subscriptionId: string, periodKey: string, planId: string): string {
  return `allowance:${subscriptionId}:${periodKey}:upgrade:${planId}`;
}
