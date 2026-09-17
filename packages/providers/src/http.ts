import { ProviderError } from './types.ts';

export type HttpOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** Attempts including the first. Only idempotent verbs are retried by default. */
  attempts?: number;
  signal?: AbortSignal;
  /** Raw bytes instead of JSON. */
  expect?: 'json' | 'buffer' | 'text';
};

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/**
 * One HTTP client for every provider so timeout, retry, backoff and — most
 * importantly — credential redaction behave identically everywhere. A leaked
 * API key in an error message that gets written to the job log is the kind of
 * bug that only shows up in an incident review.
 */
export async function httpRequest<T = unknown>(
  provider: string,
  url: string,
  options: HttpOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const timeoutMs = options.timeoutMs ?? 60_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          ...(options.body !== undefined && !(options.body instanceof Uint8Array)
            ? { 'content-type': 'application/json' }
            : {}),
          ...options.headers,
        },
        body: serializeBody(options.body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = redact(await safeText(response));
        const retryable = RETRYABLE_STATUS.has(response.status);
        const error = new ProviderError(
          provider,
          `HTTP ${response.status} ${response.statusText}: ${detail.slice(0, 600)}`,
          { retryable, status: response.status },
        );
        if (retryable && attempt < attempts) {
          lastError = error;
          await sleep(backoffMs(attempt, response.headers.get('retry-after')));
          continue;
        }
        throw error;
      }

      if (options.expect === 'buffer') {
        return new Uint8Array(await response.arrayBuffer()) as T;
      }
      if (options.expect === 'text') return (await response.text()) as T;
      const text = await response.text();
      return (text ? JSON.parse(text) : null) as T;
    } catch (error) {
      if (error instanceof ProviderError && !error.retryable) throw error;
      lastError = error;
      const aborted = options.signal?.aborted === true;
      if (aborted) {
        throw new ProviderError(provider, 'Request cancelled', { retryable: false });
      }
      if (attempt >= attempts) break;
      await sleep(backoffMs(attempt, null));
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  if (lastError instanceof ProviderError) throw lastError;
  throw new ProviderError(provider, redact(String(lastError)), {
    retryable: true,
    cause: lastError,
  });
}

function serializeBody(body: unknown): BodyInit | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return body as unknown as BodyInit;
  if (body instanceof FormData) return body;
  return JSON.stringify(body);
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '<unreadable body>';
  }
}

export function backoffMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30_000, seconds * 1000);
  }
  const base = Math.min(20_000, 500 * 2 ** (attempt - 1));
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Scrubs anything shaped like a credential before it can reach a log line.
 * Deliberately aggressive: a false positive costs us a slightly less readable
 * error, a false negative costs us a key.
 */
export function redact(input: string): string {
  return input
    .replace(/(sk|rk|pk|bb|hf)[-_][A-Za-z0-9_-]{12,}/g, '$1_[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, '$1[redacted]')
    .replace(
      /("?(?:api[-_]?key|apikey|authorization|token|password|secret)"?\s*[:=]\s*"?)([^"',}\s]{6,})/gi,
      '$1[redacted]',
    )
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted-jwt]');
}
