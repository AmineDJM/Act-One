/**
 * What actually happened when we changed something.
 *
 * THE GAP THIS FILLS. This system has three kinds of memory and only had two.
 * The Benchmark Lab is REFERENCE memory: what excellent films demonstrate. The
 * Creative Journal is CREATIVE memory: what this production explored and
 * rejected. Neither can answer the question that decides whether the next loop
 * is worth running — did the last change make the film better?
 *
 * It sounds like a question the critics already answer. They do not. A critic
 * scores the film it is shown; nobody was holding the score from before beside
 * the score from after and writing down what was done in between. Over one
 * convergence run this cost real work: three changes went into one render, the
 * scores moved, and there was no way to say which change moved them — so a
 * shot that had been briefed and bought was reverted on a whole-film reading
 * that four other changes also contributed to.
 *
 * WHY IT IS NOT A REWARD MODEL, and must not become one yet. Two records, or
 * twenty, cannot support P(improvement | intervention, context); fitting
 * anything to them would produce a confident model of noise, and this project
 * has already learned what a plausible wrong answer costs. The one thing worth
 * doing now is collecting the data honestly, including the part everybody
 * skips: `regressed`. A dataset that records only the wins teaches a system
 * that every change is an improvement.
 *
 * THE NOISE PROBLEM IS RECORDED, NOT HIDDEN. These critics are stochastic and
 * a one-point move between two readings of the SAME film is well within their
 * spread. So an outcome carries the raw before and after scores rather than a
 * verdict, `result` is allowed to be 'unclear', and `confounded` marks the
 * records where more than one thing changed at once. Those records are still
 * worth keeping — they are most of real production — but a later reader must
 * be able to tell them from a clean A/B, or the dataset will confidently
 * attribute an improvement to whichever change happened to be listed first.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const InterventionOutcome = z.object({
  at: z.string(),
  /** The film, the loop, the state of the world. Enough to group by later. */
  context: z.string().max(300),
  observedProblem: z.string().min(1).max(400),
  intervention: z.string().min(1).max(500),
  /** Where the change was made, so cost and blast radius are comparable. */
  scope: z.enum(['round_1', 'round_2', 'round_3']).default('round_3'),

  beforeArtifact: z.string().max(200).default(''),
  afterArtifact: z.string().max(200).default(''),

  /**
   * Raw scores, not deltas.
   *
   * Deltas throw away the thing that decides how much a delta is worth: where
   * it started. A criterion moving 3 to 4 and one moving 8 to 9 are not the
   * same event, and a stored delta of +1 cannot tell them apart.
   */
  before: z.record(z.string(), z.number()).default({}),
  after: z.record(z.string(), z.number()).default({}),

  /** What the critics said changed, in their words. Worth more than the numbers. */
  criticChanges: z.array(z.string().max(300)).max(8).default([]),
  /** Where the film sits against the references, if that was measured. */
  benchmarkGapChange: z.string().max(300).default(''),
  /** A person's judgement, when there is one. Outranks every score here. */
  humanPreference: z.string().max(300).default(''),

  costUsd: z.number().min(0).default(0),
  latencySeconds: z.number().min(0).default(0),

  /**
   * 'unclear' is the honest answer more often than it is comfortable.
   * 'regressed' is the field that makes the dataset worth having.
   */
  result: z.enum(['improved', 'regressed', 'unclear', 'reverted']).default('unclear'),
  /** True when other changes shipped in the same render. */
  confounded: z.boolean().default(false),
  /*
   * Room for the lesson, not just the label.
   *
   * This was 400 and the first genuinely clean A/B in the dataset would not
   * fit in it. The note is where the transferable part lives — why the result
   * was what it was, what the experiment accidentally measured about the
   * instrument, what a later reader must not conclude — and truncating that
   * leaves a row that records an event without recording what was learned
   * from it, which is the only reason the row exists.
   */
  note: z.string().max(1200).default(''),
});
export type InterventionOutcome = z.infer<typeof InterventionOutcome>;

/** Per-criterion movement, for a reader — never stored, always recomputed. */
export function movement(outcome: InterventionOutcome): { criterion: string; from: number; to: number }[] {
  return Object.keys(outcome.after)
    .filter((k) => k in outcome.before)
    .map((k) => ({ criterion: k, from: outcome.before[k]!, to: outcome.after[k]! }))
    .filter((m) => m.from !== m.to);
}

export class OutcomeMemory {
  private readonly file: string;
  private records: InterventionOutcome[];

  constructor(file = '.renders/intervention-outcomes.json') {
    this.file = path.resolve(file);
    this.records = existsSync(this.file)
      ? z.array(InterventionOutcome).parse(JSON.parse(readFileSync(this.file, 'utf8')))
      : [];
  }

  all(): readonly InterventionOutcome[] {
    return this.records;
  }

  /*
   * Takes the INPUT type, not the parsed one. Typed against the output, every
   * field with a default became mandatory at the call site — so recording an
   * outcome meant writing out nine zeroes and empty strings, and the runtime
   * happily accepted the short form the tests used. A recorder that is
   * annoying to call is a recorder that does not get called.
   */
  record(outcome: Omit<z.input<typeof InterventionOutcome>, 'at'> & { at?: string }): InterventionOutcome {
    const full = InterventionOutcome.parse({ ...outcome, at: outcome.at ?? new Date().toISOString() });
    this.records.push(full);
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.records, null, 2));
    return full;
  }

  /**
   * What has already been tried on a problem like this one.
   *
   * Given to a Revision Room before it proposes anything, so it can see that
   * an intervention it is about to suggest was tried two loops ago and made
   * the film worse. This is the entire practical payoff of the dataset until
   * there is enough of it to model, and it is available from the second
   * record onward.
   */
  priors(problem: string, limit = 5): InterventionOutcome[] {
    const words = problem.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    return this.records
      .map((r) => {
        const hay = `${r.observedProblem} ${r.intervention} ${r.context}`.toLowerCase();
        return { r, score: words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.r);
  }

  /** The priors as a room should read them: what was tried, and how it went. */
  priorsBrief(problem: string, limit = 5): string {
    const hits = this.priors(problem, limit);
    if (hits.length === 0) return '(nothing comparable has been tried and measured yet)';
    return [
      'ALREADY TRIED — on a problem like this one, in this project.',
      'A change that made the film worse once is not forbidden, but proposing it again without',
      'saying what is different this time is repeating an experiment whose answer is on file.',
      '',
      ...hits.map((r) => {
        const moved = movement(r).map((m) => `${m.criterion} ${m.from}->${m.to}`).join(', ');
        return [
          `[${r.result}${r.confounded ? ', CONFOUNDED' : ''}] ${r.observedProblem}`,
          `  did: ${r.intervention}`,
          moved ? `  moved: ${moved}` : '  moved: nothing measurable',
          r.note ? `  note: ${r.note}` : '',
        ].filter(Boolean).join('\n');
      }),
    ].join('\n');
  }
}
