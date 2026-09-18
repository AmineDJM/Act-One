import { jobIsTerminal, type Job } from '@act-one/core';

/**
 * How a job reads in the console.
 *
 * Its own module rather than the page's, because a Next page may export only
 * a page and its route settings: a helper exported beside it fails the
 * build, and the detail page needs the same words as the list.
 */
export function badgeFor(state: Job['state']): string {
  return state === 'completed' ? 'badge--ok' : state === 'failed' || state === 'canceled' ? 'badge--bad' : state === 'queued' ? '' : 'badge--warn';
}

/** How long it ran, in the largest unit that is still honest. */
export function took(job: Pick<Job, 'startedAt' | 'updatedAt' | 'state'>): string {
  if (!job.startedAt) return '—';
  const end = !jobIsTerminal(job.state) && job.state !== 'queued' ? Date.now() : Date.parse(job.updatedAt);
  const ms = Math.max(0, end - Date.parse(job.startedAt));
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}
