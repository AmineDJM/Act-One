/**
 * How often the doors may be tried.
 *
 * Sign-in and sign-up took unlimited attempts: a password could be guessed at
 * network speed and a mailbox could be turned into a thousand workspaces.
 * The limits below are fixed windows, counted per address and per account,
 * generous enough that a person mistyping never meets them and tight enough
 * that a script does within seconds.
 *
 * Both dimensions matter. Per address alone lets one botnet spread attempts
 * across many addresses against one account; per account alone lets one
 * address hammer every account it can name. Neither key alone locks a real
 * customer out, either: the account window is short, and a person cannot type
 * eight wrong passwords in fifteen minutes without noticing.
 */
export type RateLimitRule = {
  /** Attempts allowed inside one window. */
  limit: number;
  windowSeconds: number;
};

export type RateLimitVerdict = {
  allowed: boolean;
  /** Attempts left in this window, after this one. */
  remaining: number;
  /** Seconds until the window resets. Meaningful when refused. */
  retryAfterSeconds: number;
};

export const AUTH_LIMITS = {
  signIn: {
    perAddress: { limit: 30, windowSeconds: 15 * 60 },
    perAccount: { limit: 8, windowSeconds: 15 * 60 },
  },
  signUp: {
    perAddress: { limit: 6, windowSeconds: 60 * 60 },
  },
} as const satisfies Record<string, Record<string, RateLimitRule>>;

/** The key a window is counted under. Lower-cased so an email is one account whatever its casing. */
export function rateLimitKey(scope: string, subject: string): string {
  return `${scope}:${subject.trim().toLowerCase()}`;
}

/** "Try again in 4 minutes." — never seconds to a person, never "0 minutes". */
export function retryMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

/**
 * Fixed-window arithmetic, shared by every store so a window means the same
 * thing in memory and in Postgres: the window a moment falls in starts at the
 * last multiple of its length.
 */
export function windowStartMs(nowMs: number, rule: RateLimitRule): number {
  const length = rule.windowSeconds * 1000;
  return Math.floor(nowMs / length) * length;
}

export function verdictFor(count: number, nowMs: number, rule: RateLimitRule): RateLimitVerdict {
  const start = windowStartMs(nowMs, rule);
  const resetsAt = start + rule.windowSeconds * 1000;
  return {
    allowed: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    retryAfterSeconds: Math.max(1, Math.ceil((resetsAt - nowMs) / 1000)),
  };
}
