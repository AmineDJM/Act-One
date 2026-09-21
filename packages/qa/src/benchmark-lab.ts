/**
 * The Benchmark Lab: fifteen exemplars, kept as fifteen, retrieved one at a time.
 *
 * WHAT WAS ALREADY HERE AND IS NOT REBUILT. `reference.ts` measures a film into
 * principles; `film-reading.ts` has a video-capable model watch it and reconciles
 * the two without averaging them; both cache to `.renders/ref`. That work stands.
 * What was missing sits on top of it and is the whole reason this file exists.
 *
 * ONE: the two readings of a film were never joined into one profile, so anybody
 * wanting to know what a reference DOES had to open two files and reconcile them
 * by hand — and the reconciliation is exactly where a measured fact and a model's
 * guess get quietly mixed. A profile keeps them in separate fields, permanently.
 *
 * TWO, and it is the important one: THERE WAS NO RETRIEVAL. The grammar in
 * `creative/reference/grammar.ts` is a hand-written distillation of four films
 * into general rules, and general rules are exactly what a corpus of fifteen
 * must not be reduced to. Fifteen films are not enough data to infer a law of
 * cinema. They are enough to be a library of CONTEXTS in which a decision was
 * made and worked, and a library is useful only if you can ask it a question.
 *
 * So nothing here averages. There is no corpus style, no mean cut rate, no
 * "reference films do X". There are mechanisms, each still attached to the film
 * and the second it happened in, retrieved by relevance to the creative problem
 * actually in front of the Council, and never more than a handful at a time.
 * Dumping fifteen films into a prompt would make every film this system makes
 * more average, which is the precise opposite of what more references are for.
 *
 * THE ANTI-COPY RULE IS STRUCTURAL, not a warning in a prompt. A retrieved
 * mechanism carries `learn` and `doNotCopy` as separate fields, because the
 * difference between "object-driven handovers let a film change place without
 * cutting" and "a card flies left and becomes a phone at 12.4 seconds" is the
 * difference between learning and plagiarism, and a single prose blob makes
 * them indistinguishable to whoever reads it next.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * One thing a reference film does, with the context that made it work.
 *
 * The shape is deliberately CONTEXT -> DECISION -> INTENT -> EFFECT rather than
 * a rule. "Cut every 3.2 seconds" is a recipe and it is wrong even when it is
 * accurate; "when the voice has just named a number, the frame divides on the
 * word so the number becomes a thing you can see" is a decision somebody made
 * for a reason, and the reason travels to a different film where the recipe
 * does not.
 */
export type ReferenceMechanism = {
  /** Which film, and where in it. Never dropped: a mechanism without a source is folklore. */
  film: string;
  atSeconds: number;
  /** picture, camera, type, motion, edit, sound, product, structure. */
  domain: string;
  /** What was happening when the decision was taken. */
  context: string;
  /** What the film did. */
  decision: string;
  /** Why — as far as it can be read from the film itself. */
  intent: string;
  /**
   * Whether an instrument independently saw this too.
   *
   * `unchecked` is a real and distinct answer, and leaving it out was a bug.
   * The cached profiles store a cut COUNT, not cut times, so the corroboration
   * test was comparing against an empty list and labelling every mechanism
   * 'interpreted' — which reads as "we checked and the instrument had no
   * opinion" when the truth was "no check was possible". A confidence label
   * that cannot tell those apart is worse than none.
   */
  basis: 'measured' | 'interpreted' | 'corroborated' | 'unchecked';
  /** The transferable part. */
  learn: string;
  /** The part that belongs to that film and may not be reproduced. */
  doNotCopy: string;
};

/**
 * A reference film, whole, with its two readings kept apart.
 *
 * `measured` is instrument output. `read` is what a model that watched it said.
 * They are never merged into a third thing that has the authority of the first
 * and the accuracy of the second.
 */
export type ReferenceFilmProfile = {
  id: string;
  durationSeconds: number;
  measured: Record<string, unknown>;
  read: Record<string, unknown>;
  mechanisms: ReferenceMechanism[];
  /** The film's own identity, in one line, so retrieval can keep them distinct. */
  character: string;
};

export type BenchmarkLab = {
  films: ReferenceFilmProfile[];
  /** How many films the corpus is SUPPOSED to have, when that is known. */
  expected?: number;
  /**
   * Films present but unusable, and why.
   *
   * A reference whose reading came back empty contributes nothing to retrieval
   * and is indistinguishable, from the outside, from a reference that simply
   * never matches a query. One of the three films in the corpus is in exactly
   * that state, and it went unnoticed until retrieval was run and one film
   * silently returned nothing. A corpus that quietly shrinks is the worst
   * possible failure in a system whose whole purpose is taste calibration.
   */
  empty: { id: string; why: string }[];
};

const DOMAIN_OF: Record<string, string> = {
  scene: 'edit', creative_beat: 'structure', transformation: 'motion',
  camera: 'camera', typography: 'type', ui: 'product', audio: 'sound',
};

/**
 * Turns one cached reading into mechanisms.
 *
 * Only entries that carry a TIME and a described mechanism become one. A
 * boundary the model could not describe is not a lesson, and inventing an
 * intent for it would put a guess into the library with the same weight as
 * something that was observed.
 */
function mechanismsFrom(id: string, read: Record<string, unknown>, measuredCuts: readonly number[] | null): ReferenceMechanism[] {
  const out: ReferenceMechanism[] = [];
  const push = (entry: Record<string, unknown>, domain: string) => {
    const at = Number(entry['at'] ?? entry['atSeconds'] ?? NaN);
    const decision = String(entry['mechanism'] ?? entry['what'] ?? entry['description'] ?? '').trim();
    if (!Number.isFinite(at) || decision === '') return;
    const evidence = String(entry['evidence'] ?? '').trim();
    /*
     * Corroborated only when the instrument independently found a boundary at
     * the same moment. This is the one place a measurement and a reading are
     * allowed to touch, and all it produces is a confidence label — neither
     * number is altered by the other.
     */
    const basis: ReferenceMechanism['basis'] = measuredCuts === null
      ? 'unchecked'
      : measuredCuts.some((cut) => Math.abs(cut - at) <= 0.6) ? 'corroborated' : 'interpreted';
    out.push({
      film: id,
      atSeconds: Math.round(at * 100) / 100,
      domain,
      context: evidence || 'Not described by the reading.',
      decision,
      intent: String(entry['intent'] ?? entry['why'] ?? '').trim() || 'Not stated; read the decision against its context.',
      basis,
      learn: `The kind of move: ${decision.replace(/'[^']*'/g, 'the element')}.`,
      doNotCopy: `${id} at ${at.toFixed(2)}s: its exact element, timing, composition and copy.`,
    });
  };

  for (const entry of (read['boundaries'] as Record<string, unknown>[] | undefined) ?? []) {
    push(entry, DOMAIN_OF[String(entry['kind'] ?? '')] ?? 'edit');
  }
  for (const [key, domain] of [['typography', 'type'], ['ui', 'product'], ['camera', 'camera'], ['transitions', 'edit'], ['audio', 'sound'], ['sync', 'sound'], ['heroMoments', 'structure'], ['beats', 'structure']] as const) {
    for (const entry of (read[key] as Record<string, unknown>[] | undefined) ?? []) push(entry, domain);
  }
  return out;
}

/**
 * Loads the corpus from the cache that already exists, and builds it once.
 *
 * Nothing is re-analysed here. The expensive work — measuring a film, having a
 * model watch it — is already cached by the modules that do it, and repeating
 * either of them to assemble a profile would be paying twice for identical
 * work on a file that has not changed.
 */
export function loadBenchmarkLab(directory = '.renders/ref', cacheFile = '.renders/ref/lab.json'): BenchmarkLab {
  const dir = path.resolve(directory);
  const readingsFile = path.join(dir, 'target-readings.json');
  const readings: Record<string, Record<string, unknown>> = existsSync(readingsFile)
    ? JSON.parse(readFileSync(readingsFile, 'utf8'))
    : {};

  const films: ReferenceFilmProfile[] = [];
  const ids = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.profile.json')).map((f) => f.replace('.profile.json', '')).sort()
    : [];

  for (const id of ids) {
    const measured = JSON.parse(readFileSync(path.join(dir, `${id}.profile.json`), 'utf8')) as Record<string, unknown>;
    const read = readings[id] ?? {};
    /*
     * Cut TIMES, or nothing. `cuts` in these profiles is a count, and treating
     * a count as a list of times silently disabled the whole corroboration
     * step. When the times are genuinely absent the mechanisms say so.
     */
    const times = measured['cutTimes'] ?? measured['boundaries'];
    const cuts = Array.isArray(times) ? (times as number[]).filter((t) => typeof t === 'number') : null;
    const mechanisms = mechanismsFrom(id, read, cuts);
    films.push({
      id,
      durationSeconds: Number(measured['durationSeconds'] ?? 0),
      measured,
      read,
      mechanisms,
      character: String((read['narrative'] as Record<string, unknown> | undefined)?.['thesis'] ?? '') || `${id}: ${mechanisms.length} mechanisms read.`,
    });
  }

  const empty = films
    .filter((f) => f.mechanisms.length === 0)
    .map((f) => ({ id: f.id, why: 'Present and measured, but its multimodal reading contains no described moments.' }));
  const lab: BenchmarkLab = { films, empty };
  for (const gap of empty) console.warn(`[benchmark-lab] ${gap.id} contributes nothing to retrieval: ${gap.why}`);
  if (films.length > 0) writeFileSync(path.resolve(cacheFile), JSON.stringify(lab, null, 2));
  return lab;
}

/**
 * The corpus as it lives in the database, rather than on one machine's disk.
 *
 * The file-backed loader above reads `.renders/ref`, which is where the first
 * three references were analysed and where they only ever existed — on whatever
 * machine last ran the script. This takes the same profiles from the permanent
 * corpus, so a film uploaded in the console is retrievable immediately and from
 * anywhere. Both produce the same shape and feed the same retrieval; there is
 * no second code path for "real" references.
 */
export function labFromCorpus(
  rows: readonly { id: string; title: string; durationSeconds: number; measured: Record<string, unknown> | null; reading: Record<string, unknown> | null }[],
): BenchmarkLab {
  const films: ReferenceFilmProfile[] = rows.map((row) => {
    const measured = row.measured ?? {};
    const times = measured['cutTimes'] ?? measured['boundaries'];
    const cuts = Array.isArray(times) ? (times as number[]).filter((t) => typeof t === 'number') : null;
    const mechanisms = mechanismsFrom(row.title || row.id, row.reading ?? {}, cuts);
    return {
      id: row.title || row.id,
      durationSeconds: row.durationSeconds,
      measured,
      read: row.reading ?? {},
      mechanisms,
      character: String((row.reading?.['narrative'] as Record<string, unknown> | undefined)?.['thesis'] ?? '') || `${row.title}: ${mechanisms.length} mechanisms read.`,
    };
  });
  const empty = films
    .filter((f) => f.mechanisms.length === 0)
    .map((f) => ({ id: f.id, why: 'Present in the corpus, but its reading describes no moments.' }));
  return { films, empty };
}

/**
 * The most relevant mechanisms for ONE creative problem.
 *
 * Deliberately narrow. The caller states the problem it actually has — "the
 * opening is generic", "emphasis reads as colour only" — and gets back a few
 * decisions other films took in comparable situations, each still attached to
 * its film and second.
 *
 * `perFilm` exists so that one reference cannot dominate the answer. A film
 * with a dense reading has more mechanisms and would otherwise win every query
 * on volume, and a Council shown six moves from one film is being handed that
 * film's style rather than a set of options.
 */
export function retrieveMechanisms(
  lab: BenchmarkLab,
  problem: { question: string; domains?: readonly string[] },
  options: { limit?: number; perFilm?: number } = {},
): ReferenceMechanism[] {
  const limit = options.limit ?? 6;
  const perFilm = options.perFilm ?? 2;
  const words = problem.question.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  const domains = new Set(problem.domains ?? []);

  const scored = lab.films.flatMap((film) => {
    const ranked = film.mechanisms
      .map((m) => {
        const hay = `${m.domain} ${m.decision} ${m.context} ${m.intent}`.toLowerCase();
        let score = words.reduce((sum, w) => sum + (hay.includes(w) ? 1 : 0), 0);
        if (domains.size > 0 && domains.has(m.domain)) score += 2;
        /*
         * RELEVANCE FIRST, THEN CONFIDENCE. The corroboration bonus used to be
         * added here unconditionally, and the filter below keeps anything
         * scoring above zero — so every corroborated mechanism scored 0.5 on a
         * query it had nothing to do with and came back as a "match". A
         * retrieval that answers an unrelated question with a well-evidenced
         * irrelevance is worse than one that answers nothing, because the
         * evidence makes it convincing. Confidence breaks ties between
         * relevant results; it does not create one.
         */
        if (score > 0 && m.basis === 'corroborated') score += 0.5;
        return { m, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, perFilm);
    return ranked;
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => x.m);
}

/** Retrieved mechanisms as a room should read them: sourced, and not to be copied. */
export function mechanismsBrief(mechanisms: readonly ReferenceMechanism[]): string {
  if (mechanisms.length === 0) return '(no reference mechanism matched this problem closely enough to be worth showing)';
  return [
    'REFERENCE MECHANISMS — what other films did in comparable situations.',
    'These are not a template and not a house style. Learn the MOVE; the execution belongs to',
    'the film it came from and reproducing it is plagiarism, not craft.',
    '',
    ...mechanisms.map((m) => [
      `${m.film} @ ${m.atSeconds}s [${m.domain}, ${m.basis}]`,
      `  context:  ${m.context}`,
      `  decision: ${m.decision}`,
      `  learn:    ${m.learn}`,
      `  not:      ${m.doNotCopy}`,
    ].join('\n')),
  ].join('\n');
}
