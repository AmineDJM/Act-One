import { describe, it, expect } from 'vitest';
import { AUTH_LIMITS, rateLimitKey, retryMessage, verdictFor, windowStartMs } from '../index.ts';

describe('rate limit arithmetic', () => {
  const rule = { limit: 3, windowSeconds: 60 };

  it('allows up to the limit and refuses the attempt after it', () => {
    const now = 90_000;
    expect(verdictFor(1, now, rule)).toMatchObject({ allowed: true, remaining: 2 });
    expect(verdictFor(3, now, rule)).toMatchObject({ allowed: true, remaining: 0 });
    expect(verdictFor(4, now, rule)).toMatchObject({ allowed: false, remaining: 0 });
  });

  it('says how long until the window opens again', () => {
    // 90s into the day sits 30s into the second minute-long window.
    const verdict = verdictFor(4, 90_000, rule);
    expect(verdict.retryAfterSeconds).toBe(30);
    expect(windowStartMs(90_000, rule)).toBe(60_000);
  });

  it('counts an account the same whatever the casing', () => {
    expect(rateLimitKey('sign_in', ' Founder@Acme.com ')).toBe(rateLimitKey('sign_in', 'founder@acme.com'));
  });

  it('never tells a person to wait zero minutes', () => {
    expect(retryMessage(1)).toBe('Too many attempts. Try again in 1 minute.');
    expect(retryMessage(61)).toBe('Too many attempts. Try again in 2 minutes.');
  });

  it('keeps the account window tighter than the address window', () => {
    // The account limit is what stops a spread-out guess; the address limit
    // is what stops a single script. If the first were looser than the
    // second, the spread-out attacker would be the one with the easier job.
    expect(AUTH_LIMITS.signIn.perAccount.limit).toBeLessThan(AUTH_LIMITS.signIn.perAddress.limit);
  });
});
