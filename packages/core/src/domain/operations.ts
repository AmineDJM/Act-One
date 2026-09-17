import { z } from 'zod';

export const LogLevel = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevel>;

export const LogSource = z.enum(['web', 'worker', 'provider', 'billing', 'admin', 'auth']);
export type LogSource = z.infer<typeof LogSource>;

/**
 * One thing the platform did, written down where an operator can read it.
 *
 * A customer is told "Something went wrong on our side." — which is right,
 * because internal failure text leaks implementation detail. That is only an
 * acceptable answer if somebody can find out what actually went wrong, and the
 * place they look is here rather than a worker's stdout on a machine that has
 * since been recycled.
 *
 * Events span tenants on purpose: seeing that four customers failed on the same
 * provider in the same minute is the whole point. They are readable only with
 * platform access.
 */
export const OperationalEvent = z.object({
  id: z.string(),
  at: z.string(),
  level: LogLevel,
  source: LogSource,
  /** Stable machine name — 'job.failed', 'provider.unhealthy', 'staff.granted'. */
  event: z.string().min(1).max(80),
  message: z.string().max(2000).default(''),
  organizationId: z.string().nullable().default(null),
  projectId: z.string().nullable().default(null),
  jobId: z.string().nullable().default(null),
  actorUserId: z.string().nullable().default(null),
  durationMs: z.number().int().min(0).nullable().default(null),
  detail: z.record(z.string(), z.unknown()).default({}),
});
export type OperationalEvent = z.infer<typeof OperationalEvent>;

export type OperationalEventInput = Omit<OperationalEvent, 'id' | 'at'> & {
  id?: string;
  at?: string;
};

export type LogQuery = {
  level?: LogLevel;
  /** Everything at this level or more severe. Narrower than passing `level`. */
  minLevel?: LogLevel;
  source?: LogSource;
  organizationId?: string;
  projectId?: string;
  event?: string;
  /** Substring match against message and event. */
  search?: string;
  since?: string;
  limit?: number;
};

const SEVERITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function atLeastLevel(level: LogLevel, minimum: LogLevel): boolean {
  return SEVERITY[level] >= SEVERITY[minimum];
}

/** Sort key so a log view can rank by severity without a lookup table. */
export function levelSeverity(level: LogLevel): number {
  return SEVERITY[level];
}

const SECRET_KEY = /(key|secret|token|password|authorization|credential|cookie)/i;
/**
 * Long unbroken runs of key-ish characters: an API key that arrived inside a
 * message string rather than as its own field.
 */
const SECRET_SHAPED = /\b(sk|rk|pk|whsec|bb|hf|eyJ)[-_A-Za-z0-9]{12,}\b/g;

/**
 * Nothing written to the log may carry a credential.
 *
 * Provider errors quote the request that failed, and that request had an
 * Authorization header on it. This runs over every event before it is stored,
 * because a log an operator can read is also a log an operator can leak.
 */
export function redactDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (SECRET_KEY.test(key)) {
      clean[key] = '[redacted]';
      continue;
    }
    clean[key] = redactValue(value);
  }
  return clean;
}

export function redactMessage(message: string): string {
  return message.replace(SECRET_SHAPED, '[redacted]');
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactMessage(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    return redactDetail(value as Record<string, unknown>);
  }
  return value;
}

/**
 * Whether an event satisfies a query.
 *
 * Lives here rather than in a store so the in-memory implementation and the
 * Postgres one are filtering by the same definition — a log view that behaves
 * differently in tests than in production is worse than no log view.
 */
export function matchesLogQuery(event: OperationalEvent, query: LogQuery): boolean {
  if (query.level && event.level !== query.level) return false;
  if (query.minLevel && !atLeastLevel(event.level, query.minLevel)) return false;
  if (query.source && event.source !== query.source) return false;
  if (query.organizationId && event.organizationId !== query.organizationId) return false;
  if (query.projectId && event.projectId !== query.projectId) return false;
  if (query.event && event.event !== query.event) return false;
  if (query.since && event.at < query.since) return false;
  if (query.search) {
    const needle = query.search.toLowerCase();
    const haystack = `${event.event} ${event.message}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/**
 * Strips terminal escape sequences and control characters from text we did not
 * write.
 *
 * Library errors are written for a terminal: Playwright's messages carry ANSI
 * colour codes, and they rendered in the customer's audit trail as `[2m` in the
 * middle of a sentence. Anything quoted from a tool has to be flattened before
 * it is shown to somebody.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_SEQUENCES = /\u001b\[[0-9;]*[A-Za-z]|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function plainText(value: string): string {
  return value.replace(CONTROL_SEQUENCES, '').replace(/[ \t]+/g, ' ').trim();
}
