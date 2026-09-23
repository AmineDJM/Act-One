import { IngestionError } from './errors.ts';

/**
 * One clock for the whole run, and a bound on every step inside it.
 *
 * A step inside a customer's page can hang in ways no timeout of Playwright's
 * covers — `page.evaluate` against a main thread stuck in the site's own
 * script never returns — so each step races the clock rather than trusting the
 * library to give up. When the run's time is spent, whatever is still in
 * flight is abandoned, and closing the browser afterwards ends it.
 */
export class Deadline {
  readonly signal: AbortSignal;
  private readonly controller: AbortController;
  private readonly endsAt: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly parent: AbortSignal | undefined;
  private readonly onParentAbort: () => void;

  constructor(totalMs: number, parent?: AbortSignal) {
    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this.endsAt = Date.now() + totalMs;
    this.parent = parent;
    this.onParentAbort = () => this.controller.abort(new Error('cancelled'));
    this.timer = setTimeout(() => this.controller.abort(new Error('timeout')), totalMs);
    this.timer.unref?.();
    if (parent?.aborted) this.onParentAbort();
    else parent?.addEventListener('abort', this.onParentAbort, { once: true });
  }

  remaining(): number {
    return Math.max(0, this.endsAt - Date.now());
  }

  /** Throws the right failure for why the clock stopped, if it has. */
  check(stage: string): void {
    if (!this.signal.aborted) return;
    if (this.parent?.aborted) {
      throw new IngestionError('cancelled', `Cancelled during ${stage}.`, { stage });
    }
    throw new IngestionError('timeout', `The run's time was spent by ${stage}.`, { stage });
  }

  /**
   * `work`, or a failure once `stepMs` or the run's remaining time runs out,
   * whichever comes first. The losing promise is left to settle on its own;
   * a rejection from it after the race is over is swallowed rather than
   * surfacing as an unhandled rejection that kills the worker.
   */
  async within<T>(work: Promise<T>, stepMs: number, stage: string): Promise<T> {
    this.check(stage);
    const budget = Math.max(1, Math.min(stepMs, this.remaining()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const stop = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new IngestionError('timeout', `${stage} took longer than ${budget} ms.`, { stage })),
        budget,
      );
      onAbort = () => {
        try {
          this.check(stage);
        } catch (error) {
          reject(error);
        }
      };
      this.signal.addEventListener('abort', onAbort, { once: true });
    });
    work.catch(() => undefined);
    try {
      return await Promise.race([work, stop]);
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) this.signal.removeEventListener('abort', onAbort);
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.parent?.removeEventListener('abort', this.onParentAbort);
  }
}
