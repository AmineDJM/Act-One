import type { Page, Response } from 'playwright-core';
import { redirectChainReason } from './request-guard.ts';

export type RecordedKind = 'stylesheet' | 'font' | 'svg';

export type RecordedResponse = {
  url: string;
  kind: RecordedKind;
  contentType: string;
  body: Buffer;
};

export type RecorderLimits = {
  perResponse: Record<RecordedKind, number>;
  total: number;
  responses: number;
};

export const DEFAULT_RECORDER_LIMITS: RecorderLimits = {
  perResponse: { stylesheet: 4 * 1024 * 1024, font: 6 * 1024 * 1024, svg: 1024 * 1024 },
  total: 96 * 1024 * 1024,
  responses: 400,
};

const FONT_TYPES = /^(font\/|application\/(x-)?font|application\/vnd\.ms-fontobject)/i;
const FONT_EXTENSION = /\.(woff2?|ttf|otf)(\?|#|$)/i;

/**
 * Keeps the bytes the page actually used.
 *
 * Fonts and stylesheets are read from the browser's own responses rather than
 * fetched again: the file that drew the headline is the one kept, byte for
 * byte, and nothing is requested that the page did not request itself — which
 * keeps the run inside what the site served to a visitor, and inside the
 * request guard. Every limit is enforced before a body is held in memory
 * where the size is declared, and after reading where it is not.
 */
export class NetworkRecorder {
  readonly warnings: string[] = [];
  private readonly page: Page;
  private readonly limits: RecorderLimits;
  private readonly recorded = new Map<string, RecordedResponse>();
  private readonly pending = new Set<Promise<void>>();
  private readonly seen = new Set<string>();
  private total = 0;
  private stopped = false;
  private readonly listener: (response: Response) => void;

  constructor(page: Page, limits: RecorderLimits = DEFAULT_RECORDER_LIMITS) {
    this.page = page;
    this.limits = limits;
    this.listener = (response) => this.onResponse(response);
    page.on('response', this.listener);
  }

  byKind(kind: RecordedKind): RecordedResponse[] {
    return [...this.recorded.values()].filter((entry) => entry.kind === kind);
  }

  byUrl(url: string): RecordedResponse | undefined {
    return this.recorded.get(url);
  }

  /** Waits for bodies still being read, up to `timeoutMs`. */
  async flush(timeoutMs: number): Promise<void> {
    if (this.pending.size === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([Promise.allSettled([...this.pending]).then(() => undefined), waited]);
    if (timer) clearTimeout(timer);
    if (this.pending.size > 0) this.warn(`${this.pending.size} response bodies were still arriving and were not kept.`);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.page.off('response', this.listener);
  }

  private onResponse(response: Response): void {
    if (this.stopped) return;
    const kind = classify(response);
    if (!kind) return;
    const url = response.url();
    if (this.seen.has(url)) return;
    this.seen.add(url);

    const status = response.status();
    if (status < 200 || status >= 300) return;
    if (this.recorded.size + this.pending.size >= this.limits.responses) {
      this.warn(`Response limit reached; ${shorten(url)} was not kept.`);
      return;
    }
    const unsafe = redirectChainReason(response.request());
    if (unsafe) {
      this.warn(`Not keeping ${shorten(url)}: ${unsafe}.`);
      return;
    }
    const cap = this.limits.perResponse[kind];
    const declared = Number(response.headers()['content-length']);
    if (Number.isFinite(declared) && declared > cap) {
      this.warn(`${shorten(url)} declares ${declared} bytes, over the ${cap}-byte limit for a ${kind}.`);
      return;
    }

    const task: Promise<void> = response
      .body()
      .then((body) => {
        if (body.byteLength === 0) return;
        if (body.byteLength > cap) {
          this.warn(`${shorten(url)} is ${body.byteLength} bytes, over the ${cap}-byte limit for a ${kind}.`);
          return;
        }
        if (this.total + body.byteLength > this.limits.total) {
          this.warn(`The recording budget is spent; ${shorten(url)} was not kept.`);
          return;
        }
        this.total += body.byteLength;
        this.recorded.set(url, {
          url,
          kind,
          contentType: response.headers()['content-type'] ?? '',
          body,
        });
      })
      .catch((error: unknown) => {
        // Bodies can be evicted or unavailable (a service worker, a navigation
        // away); losing one is a warning, not a failure of the run.
        this.warn(`Could not read ${shorten(url)}: ${String((error as Error)?.message ?? error).slice(0, 120)}`);
      })
      .finally(() => {
        this.pending.delete(task);
      });
    this.pending.add(task);
  }

  private warn(message: string): void {
    if (this.warnings.length < 60) this.warnings.push(message);
  }
}

function classify(response: Response): RecordedKind | null {
  const type = response.request().resourceType();
  const contentType = (response.headers()['content-type'] ?? '').toLowerCase();
  const url = response.url();
  if (type === 'stylesheet' || contentType.startsWith('text/css')) return 'stylesheet';
  if (type === 'font' || FONT_TYPES.test(contentType) || FONT_EXTENSION.test(url)) return 'font';
  if (contentType.startsWith('image/svg+xml') || /\.svg(\?|#|$)/i.test(url)) return 'svg';
  return null;
}

function shorten(url: string): string {
  return url.length > 140 ? `${url.slice(0, 137)}...` : url;
}
