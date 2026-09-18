import 'server-only';
import { headers } from 'next/headers';
import {
  AppError,
  AUTH_LIMITS,
  rateLimitKey,
  retryMessage,
  type RateLimitRule,
} from '@act-one/core';
import { getStore } from './store.ts';

/**
 * The address a request came from, as the deployment sees it.
 *
 * Behind Render's proxy the first entry of x-forwarded-for is the client and
 * the rest are hops; a request that reaches the app with no such header is
 * local. Never trusted for anything but this counter — an address is a
 * bucket, not an identity.
 */
export async function clientAddress(): Promise<string> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || h.get('x-real-ip')?.trim() || 'local';
}

/**
 * Counts an attempt at a door and refuses it when the door has been tried
 * too often — by this address, or against this account, whichever trips.
 *
 * Refused attempts are still counted: a script that keeps going after the
 * first refusal keeps the window closed.
 */
export async function enforceAttempt(
  door: 'sign_in' | 'sign_up',
  subjects: { address: string; account?: string | null },
): Promise<void> {
  const store = getStore();
  const checks: { key: string; rule: RateLimitRule }[] = [];

  if (door === 'sign_in') {
    checks.push({ key: rateLimitKey('sign_in:address', subjects.address), rule: AUTH_LIMITS.signIn.perAddress });
    if (subjects.account) {
      checks.push({ key: rateLimitKey('sign_in:account', subjects.account), rule: AUTH_LIMITS.signIn.perAccount });
    }
  } else {
    checks.push({ key: rateLimitKey('sign_up:address', subjects.address), rule: AUTH_LIMITS.signUp.perAddress });
  }

  let refusedFor = 0;
  for (const check of checks) {
    const verdict = await store.rateLimits.hit(check.key, check.rule);
    if (!verdict.allowed) refusedFor = Math.max(refusedFor, verdict.retryAfterSeconds);
  }

  if (refusedFor > 0) {
    store.log.recordSafely({
      level: 'warn',
      source: 'auth',
      event: `${door}.rate_limited`,
      message: `${door} refused: too many attempts.`,
      organizationId: null,
      projectId: null,
      jobId: null,
      actorUserId: null,
      durationMs: null,
      // The address is what an operator needs to see a pattern; the account
      // is not logged, so the log is not a list of who somebody targeted.
      detail: { address: subjects.address, retryAfterSeconds: refusedFor },
    });
    throw new AppError('rate_limited', retryMessage(refusedFor));
  }
}
