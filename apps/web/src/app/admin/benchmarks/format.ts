import type { Benchmark, BenchmarkStageStatus } from '@act-one/core';

/**
 * How the library reads in the console.
 *
 * Its own module rather than a page's: a Next page may export only a page and
 * its route settings, and the list, the detail page and the inspector all
 * need the same words.
 */
export type TimeLike = { ticks: string; timescale: number };

export function seconds(time: TimeLike | null | undefined): number | null {
  return time ? Number(time.ticks) / time.timescale : null;
}

/** A film time as the console shows it: to the millisecond, which is finer than any frame. */
export function clock(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const minutes = Math.floor(value / 60);
  const rest = value - minutes * 60;
  return `${minutes}:${rest.toFixed(3).padStart(6, '0')}`;
}

export function duration(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 60) return `${value.toFixed(2)} s`;
  return `${Math.floor(value / 60)} min ${Math.round(value % 60)} s`;
}

export function bytes(count: number | null | undefined): string {
  if (!count) return '—';
  if (count >= 1024 ** 3) return `${(count / 1024 ** 3).toFixed(2)} GB`;
  if (count >= 1024 ** 2) return `${(count / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(count / 1024)} KB`;
}

export function frameRate(rate: string | null): string {
  if (!rate) return '—';
  const [num, den] = rate.split('/').map(Number);
  if (!num || !den) return rate;
  const value = num / den;
  return Number.isInteger(value) ? `${value} fps` : `${value.toFixed(3)} fps (${rate})`;
}

export function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
}

export function when(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString('en-GB', { hour12: false, dateStyle: 'short', timeStyle: 'short' }) : '—';
}

export function statusBadge(status: Benchmark['status'] | BenchmarkStageStatus | string): string {
  switch (status) {
    case 'ready':
    case 'completed':
      return 'badge--ok';
    case 'failed':
      return 'badge--bad';
    case 'partial':
    case 'analyzing':
    case 'running':
    case 'queued':
      return 'badge--warn';
    default:
      return '';
  }
}

/** Evidence types, strongest first, each with the tone it is shown in. */
export const EVIDENCE_ORDER = ['SOURCE_EXACT', 'MEASURED', 'ESTIMATED', 'INFERRED', 'RECOMMENDED_RECONSTRUCTION', 'SPECIFIED', 'UNKNOWN'] as const;

export const EVIDENCE_LABEL: Record<string, string> = {
  SOURCE_EXACT: 'exact',
  MEASURED: 'measured',
  ESTIMATED: 'estimated',
  INFERRED: 'inferred',
  RECOMMENDED_RECONSTRUCTION: 'reconstruction',
  SPECIFIED: 'specified',
  UNKNOWN: 'unknown',
};
