import { z } from 'zod';

/**
 * A reference film in the permanent corpus.
 *
 * WHY THE CORPUS HAS NO TARGET SIZE. The temptation with a reference library is
 * to wait until it is "big enough" and then start inferring rules from it. There
 * is no size at which that becomes correct here. Fifteen films, or a hundred,
 * are not a sample of cinema; they are a set of exemplars somebody chose, and
 * averaging them produces the one thing a launch film must never be — the mean
 * of fifteen good films, which is a worse film than any of them.
 *
 * So the corpus works identically at three films and at a hundred. What changes
 * with size is CONFIDENCE and DIVERSITY, and both are reported rather than
 * assumed: with a small corpus a retrieved mechanism is one film's solution to
 * one problem and is labelled as such; with a large one, several films
 * independently reaching for the same move is itself evidence. Neither case
 * produces a house style.
 *
 * WHY STATUS IS A FIRST-CLASS FIELD. A reference whose analysis failed, or came
 * back empty, is worse than a reference that is absent: it sits in the corpus
 * looking like taste calibration and contributes nothing, and the only symptom
 * is that queries quietly return less than they should. One of the three films
 * in the first corpus was in exactly that state and it went unnoticed until a
 * retrieval was run by hand. The corpus reports its own health.
 */
export const BenchmarkStatus = z.enum([
  /** Uploaded, nothing run yet. */
  'pending',
  /** Analysis in flight. */
  'analysing',
  /** Both readings present and non-empty. The only state that fully counts. */
  'analysed',
  /**
   * Analysed, but one half is missing or empty — measured with no reading, or
   * a reading that described nothing. Usable for what it has, and never
   * silently counted as whole.
   */
  'partial',
  /** Analysis ran and failed. `error` says how. */
  'failed',
  /**
   * Present, complete, and deliberately excluded from retrieval.
   *
   * Distinct from deleted: an operator who finds a film is pulling the corpus
   * toward one look can take it out of play without destroying the analysis,
   * and put it back.
   */
  'disabled',
]);
export type BenchmarkStatus = z.infer<typeof BenchmarkStatus>;

export const BenchmarkFilm = z.object({
  id: z.string(),
  /** What an operator calls it. Not derived from the filename, which is noise. */
  title: z.string().min(1).max(200),
  /** Where the original file lives. The original is never discarded: every
   *  analysis is re-derivable, and a corpus you cannot re-analyse is a corpus
   *  frozen at the capability of the day it was uploaded. */
  storageKey: z.string().min(1).max(400),
  originalFilename: z.string().max(300).default(''),
  byteSize: z.number().int().min(0).default(0),
  durationSeconds: z.number().min(0).default(0),

  status: BenchmarkStatus.default('pending'),
  /** Why it failed or what is partial about it, in one line an operator can act on. */
  note: z.string().max(600).default(''),

  /** Deterministic analysis: shot boundaries, motion, loudness, palette. */
  measured: z.record(z.string(), z.unknown()).nullable().default(null),
  /** Native multimodal reading: thesis, mechanisms, moments, with time ranges. */
  reading: z.record(z.string(), z.unknown()).nullable().default(null),
  /** How many described moments the reading yielded. Zero is why 'partial' exists. */
  mechanismCount: z.number().int().min(0).default(0),

  /** Which analyser produced this, so a re-run after an upgrade is visible. */
  analysisVersion: z.string().max(40).default('v1'),
  analysedAt: z.string().nullable().default(null),
  costUsd: z.number().min(0).default(0),

  uploadedBy: z.string().max(80).default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BenchmarkFilm = z.infer<typeof BenchmarkFilm>;

/**
 * What the corpus can honestly say about itself.
 *
 * `usable` is the number that matters and it is deliberately not `total`: a
 * library reporting "15 films" while four of them failed analysis is lying to
 * the person deciding whether to trust a retrieval.
 */
export type CorpusHealth = {
  total: number;
  analysed: number;
  partial: number;
  failed: number;
  disabled: number;
  pending: number;
  /** analysed + partial, minus disabled: what retrieval can actually draw on. */
  usable: number;
  /** Total described moments available to retrieval across the usable films. */
  mechanisms: number;
};

export function corpusHealth(films: readonly BenchmarkFilm[]): CorpusHealth {
  const count = (status: BenchmarkStatus) => films.filter((f) => f.status === status).length;
  const usableFilms = films.filter((f) => f.status === 'analysed' || f.status === 'partial');
  return {
    total: films.length,
    analysed: count('analysed'),
    partial: count('partial'),
    failed: count('failed'),
    disabled: count('disabled'),
    pending: count('pending') + count('analysing'),
    usable: usableFilms.length,
    mechanisms: usableFilms.reduce((sum, f) => sum + f.mechanismCount, 0),
  };
}

/**
 * How much weight a retrieval from this corpus deserves, stated in words.
 *
 * Not a score. The point is that a Council reading three mechanisms out of a
 * three-film corpus should know it is looking at three films' answers, and one
 * reading twenty out of a hundred-film corpus should know that agreement across
 * several films is now meaningful where before it was coincidence. The same
 * retrieval code serves both; only what can be claimed from it changes.
 */
export function corpusConfidence(health: CorpusHealth): string {
  if (health.usable === 0) return 'No usable reference films. Any claim about what excellent films do is unsupported.';
  if (health.usable < 5) {
    return `${health.usable} usable reference film(s). Treat every mechanism as ONE film's solution to ONE problem, not as evidence of a general practice. Agreement between two of them is a coincidence at this size.`;
  }
  if (health.usable < 12) {
    return `${health.usable} usable reference films. Enough for contrast between approaches; not enough to call anything typical. Where two films differ, that is a genuine fork, not noise.`;
  }
  return `${health.usable} usable reference films. Several films independently reaching for the same mechanism is now worth noticing — but it is still a library of exemplars, not a sample, and the corpus must never be averaged into a style.`;
}
