/**
 * The Creative Journal: what was decided, and what was already tried.
 *
 * WHY THIS EXISTS, concretely. Over the course of one convergence run this
 * project cut a shot that a later reader re-commissioned, replaced an opening
 * with a different stock image three separate times, and twice "fixed" a
 * caption by undoing a fix that was there for a reason nobody had written
 * down. Every one of those was a decision being re-litigated by somebody — a
 * critic, a later loop, a fresh context — who could not see that it had been
 * taken on purpose.
 *
 * A critic that does not know an oddity is intentional will report it as a
 * fault, and a loop that treats every report as a fault will spend itself
 * undoing its own decisions. So the journal records the REJECTED ideas and the
 * reasons, not just the accepted ones: the rejections are what stop the same
 * argument being had every loop.
 *
 * It is deliberately small. A journal that accumulates every message is a
 * transcript, and nobody reads a transcript — including the model it would be
 * fed to, at cost, forever.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const JournalKind = z.enum([
  'intent',
  'direction_explored',
  'rejected',
  'thesis',
  'av_strategy',
  'design_decision',
  'continuity_decision',
  'render',
  'criticism',
  'intervention',
  'improvement',
  'regression',
]);
export type JournalKind = z.infer<typeof JournalKind>;

export const JournalEntry = z.object({
  at: z.string(),
  kind: JournalKind,
  /** One line. If it needs a paragraph it belongs in the artifact, not here. */
  what: z.string().min(1).max(400),
  /** The reason, which is the part that stops it being undone by accident. */
  why: z.string().max(400).default(''),
  /** Where to look: a beat id, a render, a commit, a judgement file. */
  refs: z.array(z.string().max(160)).max(6).default([]),
});
export type JournalEntry = z.infer<typeof JournalEntry>;

export class CreativeJournal {
  private readonly file: string;
  private entries: JournalEntry[];

  constructor(file = '.renders/creative-journal.json') {
    this.file = path.resolve(file);
    this.entries = existsSync(this.file)
      ? z.array(JournalEntry).parse(JSON.parse(readFileSync(this.file, 'utf8')))
      : [];
  }

  all(): readonly JournalEntry[] {
    return this.entries;
  }

  record(kind: JournalKind, what: string, why = '', refs: readonly string[] = []): void {
    this.entries.push(JournalEntry.parse({ at: new Date().toISOString(), kind, what, why, refs: [...refs] }));
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.entries, null, 2));
  }

  /**
   * The journal as a room should read it: decisions and their reasons, newest
   * last, with the rejections kept in full.
   *
   * `limit` trims the routine entries — renders, criticisms — because those are
   * recoverable from the artifacts. It never trims a rejection or a decision,
   * since losing those is the exact failure this class exists to prevent.
   */
  brief(limit = 30): string {
    const load: JournalKind[] = ['rejected', 'thesis', 'design_decision', 'continuity_decision', 'av_strategy', 'intent'];
    const kept = this.entries.filter((e) => load.includes(e.kind));
    const rest = this.entries.filter((e) => !load.includes(e.kind)).slice(-limit);
    const lines = [...kept, ...rest]
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((e) => `[${e.kind}] ${e.what}${e.why ? ` — ${e.why}` : ''}`);
    return lines.length > 0 ? lines.join('\n') : '(nothing recorded yet)';
  }
}
