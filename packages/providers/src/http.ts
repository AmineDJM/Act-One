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
  /** Sees the successful response before its body is read: for a header a caller needs. */
  onResponse?: (response: Response) => void;
};

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/**
 * Egress through a proxy.
 *
 * Node's `fetch` ignores `HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set at
 * startup (Node 22.21 and later). Without it a deployment behind an egress
 * proxy reaches its database and its own health check and cannot reach a
 * single provider — curl works, the app does not, and from inside the app the
 * only evidence is a 401 or a timeout.
 *
 * The flag rather than a dispatcher of our own, and that is a decision made
 * twice. Building a `ProxyAgent` from the installed undici and handing it to
 * the global `fetch` fails deep inside with `invalid onRequestStart method`,
 * because Node bundles its own separate copy of undici. Routing through the
 * installed undici's `fetch` instead fixes that and breaks every multipart
 * upload — its `FormData` is a different class again, so a voice clone and a
 * transcription both arrive as the string "[object FormData]". The platform's
 * own switch has neither problem.
 *
 * This only reports the mismatch: an app that needs a proxy and was not told
 * to use one should say so at startup rather than at the first provider call,
 * two minutes into a customer's film.
 */
export function proxyConfigured(): boolean {
  return Boolean(
    process.env['HTTPS_PROXY'] ??
      process.env['https_proxy'] ??
      process.env['HTTP_PROXY'] ??
      process.env['http_proxy'],
  );
}

export function proxyEnabledInNode(): boolean {
  const flag = process.env['NODE_USE_ENV_PROXY'];
  return flag === '1' || flag === 'true';
}

/**
 * The warning to print at startup, or nothing.
 *
 * Returned rather than logged so the caller decides where it goes and so it
 * can be tested without capturing console output.
 */
export function proxyMisconfiguration(): string | null {
  if (!proxyConfigured() || proxyEnabledInNode()) return null;
  return (
    'A proxy is configured (HTTPS_PROXY) but Node was not started with ' +
    'NODE_USE_ENV_PROXY=1, so outbound provider calls will bypass it and fail. ' +
    'Set NODE_USE_ENV_PROXY=1 on the process.'
  );
}

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
          // Multipart bodies carry their own boundary; setting the type here would break it.
          ...(options.body !== undefined &&
          !(options.body instanceof Uint8Array) &&
          !(options.body instanceof FormData)
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

      options.onResponse?.(response);
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

/**
 * The same request, streamed, with an idle timeout instead of a total one.
 *
 * A long generation sent without streaming is one silent request that takes a
 * minute and a half, and every intermediary between here and the model treats
 * silence as death. This sandbox's egress proxy cuts at 92.2s, measured;
 * Render's router, Cloudflare and any corporate proxy have their own numbers,
 * and none of them is documented where the person debugging it will look. The
 * research synthesis died at exactly that wall on every single attempt,
 * including all three retries, because a deterministic timeout is not a
 * transient failure however retryable the status code says it is.
 *
 * Streamed, bytes arrive continuously and no intermediary has a reason to
 * intervene. So the timeout that matters is not "how long may this take" — a
 * good answer is allowed to take four minutes — but "how long may nothing at
 * all happen", which is what a hung connection actually looks like.
 *
 * Retried only before the first byte. After that a retry would mean discarding
 * a partial answer we are paying for and asking for another, and the failure
 * modes that happen mid-stream are not the ones a retry fixes.
 */
export async function httpStream(
  provider: string,
  url: string,
  options: HttpOptions & {
    /** Longest gap between chunks before the connection is treated as dead. */
    idleTimeoutMs?: number;
    /** Called with each decoded chunk as it arrives. */
    onChunk: (text: string) => void;
  },
): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const idleTimeoutMs = options.idleTimeoutMs ?? 45_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    let idle: ReturnType<typeof setTimeout> | null = null;
    const resetIdle = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => controller.abort(), idleTimeoutMs);
    };

    try {
      resetIdle();
      const response = await fetch(url, {
        method: options.method ?? 'POST',
        headers: {
          ...(options.body !== undefined &&
          !(options.body instanceof Uint8Array) &&
          !(options.body instanceof FormData)
            ? { 'content-type': 'application/json' }
            : {}),
          accept: 'text/event-stream',
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
      if (!response.body) {
        throw new ProviderError(provider, 'The response carried no body to stream.', { retryable: true });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let received = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdle();
        received = true;
        options.onChunk(decoder.decode(value, { stream: true }));
      }
      options.onChunk(decoder.decode());
      if (!received) {
        throw new ProviderError(provider, 'The stream closed without sending anything.', { retryable: true });
      }
      return;
    } catch (error) {
      if (options.signal?.aborted === true) {
        throw new ProviderError(provider, 'Request cancelled', { retryable: false });
      }
      if (error instanceof ProviderError && !error.retryable) throw error;
      lastError = error;
      if (attempt >= attempts) break;
      await sleep(backoffMs(attempt, null));
    } finally {
      if (idle) clearTimeout(idle);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  if (lastError instanceof ProviderError) throw lastError;
  throw new ProviderError(provider, redact(String(lastError)), { retryable: true, cause: lastError });
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
