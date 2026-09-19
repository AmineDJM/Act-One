import { z } from 'zod';

/**
 * What a plan gives, and how often — which is not how often it is paid for.
 *
 * These were the same thing by accident. The monthly allowance was granted on
 * the Stripe invoice that collected money, so a customer on an annual
 * subscription paid once and was given one month of credits for the year. The
 * promise on the pricing page is "2,000 credits a month"; the invoice
 * frequency is a billing arrangement, and the two are now modelled apart.
 *
 * `interval` is the product definition. A plan that genuinely pools a year's
 * credits into one lump says so here, rather than having it fall out of how
 * the customer chose to pay.
 */
export const AllowanceInterval = z.enum(['monthly', 'annual']);
export type AllowanceInterval = z.infer<typeof AllowanceInterval>;

export const PlanAllowance = z.object({
  interval: AllowanceInterval.default('monthly'),
  /** Credits granted once per interval. */
  amount: z.number().int().min(0).default(0),
});
export type PlanAllowance = z.infer<typeof PlanAllowance>;

/** How a subscription is collected. Says nothing about how often it is used. */
export const BillingInterval = z.enum(['monthly', 'annual']);
export type BillingInterval = z.infer<typeof BillingInterval>;

/**
 * The periods a subscription is owed an allowance for, oldest first.
 *
 * Each is the ISO date the period opened, which is also its key in the ledger:
 * an anniversary rather than a calendar month, so a subscription that started
 * on the 15th is topped up on the 15th and a key can never be ambiguous.
 *
 * Two rules keep this from being expensive to be wrong about:
 *
 * A subscription with nothing granted yet is owed only the period it is in.
 * Otherwise the first run after this shipped would have handed every annual
 * customer a year of back-credits in one go — correct by the arithmetic and
 * indefensible as a decision.
 *
 * And the number of periods is capped. The tick runs hourly, so one period is
 * ever due in practice; the cap is what stops a clock bug from minting a
 * decade of credits.
 */
export function allowancePeriodsDue(params: {
  /** When the subscription began. Periods are anniversaries of this. */
  startedAt: string;
  interval: AllowanceInterval;
  now: string;
  /** The period start already granted, if any. */
  since?: string | null;
  maxPeriods?: number;
}): string[] {
  const start = new Date(params.startedAt);
  const now = new Date(params.now);
  if (Number.isNaN(start.getTime()) || Number.isNaN(now.getTime())) return [];
  if (now < start) return [];

  const max = params.maxPeriods ?? 12;
  const periods: string[] = [];
  for (let index = 0; index < 1000; index += 1) {
    const opens = addIntervals(start, params.interval, index);
    if (opens > now) break;
    periods.push(dayKey(opens));
  }
  if (periods.length === 0) return [];

  const current = periods[periods.length - 1]!;
  if (!params.since) return [current];

  const due = periods.filter((period) => period > params.since!);
  return due.slice(-max);
}

/** The period a moment falls in, for a subscription that started when it did. */
export function allowancePeriodAt(params: {
  startedAt: string;
  interval: AllowanceInterval;
  at: string;
}): string | null {
  const periods = allowancePeriodsDue({ ...params, now: params.at, since: null });
  return periods[0] ?? null;
}

/**
 * Adds whole months or years, keeping the day of the month where it exists.
 *
 * The 31st of January plus one month is the 28th of February, not the 3rd of
 * March — a naive `setMonth` rolls over and every subsequent anniversary
 * drifts, which would give one customer thirteen top-ups in a year.
 */
function addIntervals(from: Date, interval: AllowanceInterval, count: number): Date {
  const year = from.getUTCFullYear() + (interval === 'annual' ? count : 0);
  const month = from.getUTCMonth() + (interval === 'monthly' ? count : 0);
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(from.getUTCDate(), lastDay);
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
