import type { VideoAnalysis } from '@act-one/providers';
import {
  MeasurementUnavailable,
  measureFilmGrammar,
  measurementAvailable,
  type FilmMeasurement,
  type MeasureOptions,
} from './film-measure.ts';

/**
 * A film read twice, by two things that cannot do each other's job.
 *
 * An instrument reports that optical flow peaks at 12.42s and that an audio
 * onset follows the nearest element entry by 70ms. It cannot tell you that
 * three cards accelerate into the hero transition, or that the impact resolves
 * the movement rather than anticipating it. A model that watched the film can
 * say both of those and cannot tell you the 70ms — it will produce a number
 * that looks like 70ms and is a guess.
 *
 * So both run, and neither is allowed to stand in for the other. What this
 * module adds on top is the only thing worth adding: where they speak about
 * the same moment, whether they AGREE. A semantic boundary with a measured
 * boundary under it is a different quality of fact from one without, and a
 * reader that cannot see which is which will spend the same confidence on
 * both.
 *
 * The three verdicts, and why there are three:
 *
 *   corroborated   both saw it. The strongest thing this system produces.
 *   unmeasured     the model saw it and the instrument has no opinion — either
 *                  it measures something else entirely (an idea changing is not
 *                  a pixel event) or the film was not measured at all. NOT a
 *                  contradiction, and the commonest honest outcome.
 *   contradicted   the instrument measured something incompatible. Worth
 *                  looking at by hand; usually the model, sometimes the
 *                  threshold.
 *
 * Nothing here averages the two. Averaging a measurement with a guess produces
 * a number with the authority of the first and the accuracy of the second,
 * which is the specific failure this whole arrangement exists to prevent.
 */

/** How close a semantic boundary must be to a measured one to corroborate it. */
const BOUNDARY_TOLERANCE_SECONDS = 0.6;

/** How far a claimed sound offset may sit from the measured one, in ms. */
const SYNC_TOLERANCE_MS = 120;

export type Basis = 'measured' | 'interpreted' | 'corroborated';

export type Corroboration = {
  /** Where on the film's clock. */
  at: number;
  /** What the model said happened. */
  claim: string;
  verdict: 'corroborated' | 'unmeasured' | 'contradicted';
  /** The measurement that settled it, in words, when there was one. */
  measurement: string;
  /** Seconds between the claim and the nearest measured event, when there is one. */
  deltaSeconds: number | null;
};

export type FilmReading = {
  reference: string;

  /**
   * What a program read off the file. Null when this host could not measure —
   * which is a deployment fact, not a fact about the film.
   */
  measured: FilmMeasurement | null;
  /** Why there is no measurement, when there is none. Empty otherwise. */
  measurementGap: string;

  /** What a model that watched the film said about it. Null when not run. */
  interpreted: VideoAnalysis | null;

  /**
   * The model's boundaries against the instrument's, one verdict each.
   * Empty when either half is missing — an un-cross-checked reading says so
   * by having nothing here rather than by asserting agreement.
   */
  boundaries: Corroboration[];
  /** The model's sound-against-picture claims against the measured offsets. */
  sync: Corroboration[];

  /**
   * The headline numbers, each labelled with where it came from.
   *
   * This is what a director or a report should read, because it is the only
   * place the two halves sit together — and every line says whether it is an
   * instrument reading or a reading of one.
   */
  summary: { label: string; value: string; basis: Basis }[];
};

export type ReadFilmOptions = MeasureOptions & {
  /** A reading from the video analyst, when one has been run. */
  interpretation?: VideoAnalysis | null;
  /** Skip measuring: for a caller that already has one, or does not want it. */
  measurement?: FilmMeasurement | null;
};

/**
 * Measures a film, folds in an interpretation if one was made, and cross-checks.
 *
 * Deliberately does not call the analyst itself. The analyst costs money and
 * belongs to the provider registry; this is the arithmetic, and it stays
 * testable without a network.
 */
export async function readFilm(
  filePath: string,
  options: ReadFilmOptions = {},
): Promise<FilmReading> {
  let measured = options.measurement ?? null;
  let measurementGap = '';

  if (!measured) {
    try {
      measured = await measureFilmGrammar(filePath, options);
    } catch (error) {
      measured = null;
      measurementGap =
        error instanceof MeasurementUnavailable
          ? error.message
          : `The film could not be measured: ${(error as Error).message}`;
    }
  }

  const interpreted = options.interpretation ?? null;
  return fuse(filePath, measured, measurementGap, interpreted);
}

/** The pure half: two readings in, one cross-checked reading out. */
export function fuse(
  reference: string,
  measured: FilmMeasurement | null,
  measurementGap: string,
  interpreted: VideoAnalysis | null,
): FilmReading {
  return {
    reference,
    measured,
    measurementGap,
    interpreted,
    boundaries: measured && interpreted ? checkBoundaries(measured, interpreted) : [],
    sync: measured && interpreted ? checkSync(measured, interpreted) : [],
    summary: summarise(measured, interpreted),
  };
}

/**
 * Each interpreted boundary against the measured ones of its own kind.
 *
 * Matched within kind first and then against any kind, because the two halves
 * genuinely disagree about naming — an instrument calls a thing a
 * transformation from the continuity of its optical flow, a model calls the
 * same thing a creative beat from what it means. That is a disagreement about
 * vocabulary, not about whether something happened there, and collapsing it
 * into "contradicted" would bury the far more interesting case where nothing
 * happened there at all.
 */
function checkBoundaries(measured: FilmMeasurement, interpreted: VideoAnalysis): Corroboration[] {
  const at = (entries: { at: number }[]) => entries.map((entry) => entry.at);
  const byKind: Record<string, number[]> = {
    shot: at(measured.boundaries.shot),
    scene: at(measured.boundaries.scene),
    creative_beat: at(measured.boundaries.creativeBeat),
    transformation: at(measured.boundaries.transformation),
  };
  const all = Object.values(byKind)
    .flat()
    .sort((a, b) => a - b);

  return interpreted.boundaries.map((boundary): Corroboration => {
    const sameKind = nearest(byKind[boundary.kind] ?? [], boundary.at);
    const anyKind = nearest(all, boundary.at);

    if (sameKind && Math.abs(sameKind - boundary.at) <= BOUNDARY_TOLERANCE_SECONDS) {
      return {
        at: boundary.at,
        claim: `${boundary.kind}: ${boundary.mechanism}`,
        verdict: 'corroborated',
        measurement: `a measured ${boundary.kind} boundary at ${sameKind.toFixed(2)}s`,
        deltaSeconds: round3(sameKind - boundary.at),
      };
    }
    if (anyKind && Math.abs(anyKind - boundary.at) <= BOUNDARY_TOLERANCE_SECONDS) {
      return {
        at: boundary.at,
        claim: `${boundary.kind}: ${boundary.mechanism}`,
        verdict: 'corroborated',
        measurement:
          `a measured boundary at ${anyKind.toFixed(2)}s, of a different kind — ` +
          `the instrument and the analyst name this one differently`,
        deltaSeconds: round3(anyKind - boundary.at),
      };
    }
    return {
      at: boundary.at,
      claim: `${boundary.kind}: ${boundary.mechanism}`,
      verdict: 'unmeasured',
      measurement:
        all.length === 0
          ? 'the instrument found no boundaries at all in this film'
          : `the nearest measured boundary is ${anyKind === null ? 'none' : `${Math.abs(anyKind - boundary.at).toFixed(2)}s away`}`,
      deltaSeconds: anyKind === null ? null : round3(anyKind - boundary.at),
    };
  });
}

/**
 * Claimed sound-against-picture offsets against measured ones.
 *
 * This is the one place a model routinely produces a number it cannot have
 * observed. A 70ms offset is under two frames; nothing that watched the film
 * at two frames a second saw it. So a claim with a measurement near it is
 * corroborated or contradicted on the number, and a claim with no measurement
 * near it keeps its timecode and loses its number's authority.
 */
function checkSync(measured: FilmMeasurement, interpreted: VideoAnalysis): Corroboration[] {
  return interpreted.sync.map((claim): Corroboration => {
    const near = measured.soundToElement
      .filter((entry) => Math.abs(entry.enterAt - claim.at) <= BOUNDARY_TOLERANCE_SECONDS)
      .sort((a, b) => Math.abs(a.enterAt - claim.at) - Math.abs(b.enterAt - claim.at))[0];

    const described = `${claim.visualEvent} / ${claim.audioEvent} (${claim.relationship})`;
    if (!near) {
      return {
        at: claim.at,
        claim: described,
        verdict: 'unmeasured',
        measurement: 'no measured sound-to-element offset near this moment',
        deltaSeconds: null,
      };
    }
    if (claim.offsetMs === null) {
      return {
        at: claim.at,
        claim: described,
        verdict: 'corroborated',
        measurement: `measured offset ${near.soundOffsetMs}ms against a ${near.kind} entering at ${near.enterAt.toFixed(2)}s`,
        deltaSeconds: round3(near.enterAt - claim.at),
      };
    }
    const agrees = Math.abs(near.soundOffsetMs - claim.offsetMs) <= SYNC_TOLERANCE_MS;
    return {
      at: claim.at,
      claim: described,
      verdict: agrees ? 'corroborated' : 'contradicted',
      measurement:
        `the analyst said ${claim.offsetMs}ms; the instrument measured ${near.soundOffsetMs}ms ` +
        `against a ${near.kind} entering at ${near.enterAt.toFixed(2)}s`,
      deltaSeconds: round3(near.enterAt - claim.at),
    };
  });
}

/** The headline numbers, each labelled with where it came from. */
function summarise(
  measured: FilmMeasurement | null,
  interpreted: VideoAnalysis | null,
): FilmReading['summary'] {
  const lines: FilmReading['summary'] = [];

  if (measured) {
    const c = measured.counts;
    lines.push(
      { label: 'duration', value: `${measured.durationSeconds.toFixed(2)}s`, basis: 'measured' },
      {
        label: 'boundaries',
        value: `${c.shot} shot, ${c.scene} scene, ${c.creativeBeat} beat, ${c.transformation} transformation`,
        basis: 'measured',
      },
      {
        label: 'static share',
        value: `${(measured.staticShare * 100).toFixed(1)}%`,
        basis: 'measured',
      },
      {
        label: 'camera vs objects',
        value: `${(measured.cameraVsObject.cameraShare * 100).toFixed(0)}% of moving frames explained by the camera`,
        basis: 'measured',
      },
      {
        label: 'parallax share',
        value: `${(measured.cameraVsObject.parallaxShare * 100).toFixed(0)}% of frames carry two depths`,
        basis: 'measured',
      },
      { label: 'tracked elements', value: String(measured.elements.length), basis: 'measured' },
      { label: 'stagger groups', value: String(measured.staggerGroups.length), basis: 'measured' },
    );
  }

  if (interpreted) {
    lines.push(
      {
        label: 'read by',
        value: `${interpreted.model} (${interpreted.depth} pass)`,
        basis: 'interpreted',
      },
      { label: 'creative beats', value: String(interpreted.beats.length), basis: 'interpreted' },
      {
        label: 'hero moments',
        value: String(interpreted.heroMoments.length),
        basis: 'interpreted',
      },
    );
    if (interpreted.comprehension?.understoodProposition) {
      lines.push({
        label: 'what a first-time viewer takes away',
        value: interpreted.comprehension.understoodProposition,
        basis: 'interpreted',
      });
    }
  }

  if (measured && interpreted) {
    const checks = checkBoundaries(measured, interpreted);
    const agreed = checks.filter((check) => check.verdict === 'corroborated').length;
    lines.push({
      label: 'boundaries seen by both',
      value: `${agreed} of ${checks.length}`,
      basis: 'corroborated',
    });
  }

  return lines;
}

function nearest(values: readonly number[], at: number): number | null {
  if (values.length === 0) return null;
  return values.reduce((best, value) =>
    Math.abs(value - at) < Math.abs(best - at) ? value : best,
  );
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export { measurementAvailable, measureFilmGrammar, MeasurementUnavailable };
export type { FilmMeasurement };
