import { z } from 'zod';
import { againstGrammar, REFERENCE_BANDS, type BandName, type GrammarFinding } from '@act-one/core';

/**
 * A finished film, placed on the reference bands.
 *
 * The bands in `@act-one/core` were measured off four reference films with
 * `scripts/analysis/film_grammar.py`. Until now nothing mapped that
 * analyser's output back onto them, so a change to the engine could only be
 * judged by what it was meant to do. This is that mapping: the same analyser
 * over one of our masters, read the same way, so a before and an after are
 * two readings of one instrument.
 *
 * The bands describe what good work happened to do; they are not targets.
 * The gap reported here says how far outside the references a film sits and
 * in which direction, which is a reason to go and watch that part of the
 * film, never a number to be steered toward.
 */

/** The analyser's report, as far as the bands need it. Parsed, because it comes from another process. */
export const FilmGrammarReport = z.object({
  durationSeconds: z.number().nonnegative(),
  counts: z.object({
    shot: z.number().int().nonnegative(),
    scene: z.number().int().nonnegative(),
    creativeBeat: z.number().int().nonnegative(),
    transformation: z.number().int().nonnegative(),
  }),
  staticShare: z.number().min(0).max(1),
  cameraVsObject: z.object({
    cameraShare: z.number().min(0).max(1),
    parallaxShare: z.number().min(0).max(1),
  }),
  elements: z.array(
    z.object({
      kind: z.string(),
      enterAt: z.number(),
      seconds: z.number().nonnegative(),
      easing: z.string().nullable().optional(),
    }),
  ),
  audio: z
    .object({
      voiceShareOfRuntime: z.number().min(0).max(1),
      longestSilence: z.number().nonnegative(),
      bpm: z.number().nullable(),
      onsets: z.array(z.number()),
      impacts: z.array(z.number()),
    })
    .nullable(),
  soundToElement: z.array(z.object({ kind: z.string(), enterAt: z.number(), soundOffsetMs: z.number() })),
});
export type FilmGrammarReport = z.infer<typeof FilmGrammarReport>;

/** Within this, a sound and an element's entry read as one event. The references' own lock window. */
export const SOUND_LOCK_MS = 80;
/** Moves shorter than this are tracking noise rather than an element entering; the analyser skips them too. */
const MIN_ELEMENT_SECONDS = 0.2;

export type BandPosition = 'below' | 'inside' | 'above';

export type BandReading = {
  band: BandName;
  measured: number;
  low: number;
  high: number;
  position: BandPosition;
  /**
   * How far outside the band, in band widths; zero inside it.
   *
   * In band widths so that a runtime six seconds short and a static share six
   * points high are comparable at all.
   */
  gap: number;
};

export type GrammarBenchmark = {
  readings: BandReading[];
  /** Only the sides that are defects, in the words of the edit suite. */
  findings: GrammarFinding[];
  /** Summed band-width gap over the bands whose outside is a defect. Lower is closer to the references. */
  defectGap: number;
};

/** The analyser's report, read as the band measures. A measure that cannot be read is left out, not zeroed. */
export function bandMeasures(report: FilmGrammarReport): Partial<Record<BandName, number>> {
  const seconds = report.durationSeconds;
  if (seconds <= 0) return {};
  const minutes = seconds / 60;
  const elements = report.elements.filter((element) => element.seconds >= MIN_ELEMENT_SECONDS);
  const measures: Partial<Record<BandName, number>> = {
    runtimeSeconds: seconds,
    creativeBeatsPerMinute: report.counts.creativeBeat / minutes,
    shotsPerMinute: report.counts.shot / minutes,
    transformationsPerMinute: report.counts.transformation / minutes,
    // Per hard cut; a film that never cuts is measured against one.
    transformationsPerShot: report.counts.transformation / Math.max(1, report.counts.shot),
    staticShare: report.staticShare,
    movingElementsPerMinute: report.elements.length / minutes,
    easingFamilies: new Set(report.elements.map((element) => element.easing).filter(Boolean)).size,
    cameraShare: report.cameraVsObject.cameraShare,
    parallaxShare: report.cameraVsObject.parallaxShare,
  };
  if (report.elements.length > 0) {
    measures.typeShareOfElements = report.elements.filter((element) => element.kind === 'type').length / report.elements.length;
  }
  if (report.audio) {
    measures.impactsPerSecond = report.audio.impacts.length / seconds;
    measures.longestSilenceSeconds = report.audio.longestSilence;
    if (elements.length > 0) {
      const locked = report.soundToElement.filter((sync) => Math.abs(sync.soundOffsetMs) <= SOUND_LOCK_MS).length;
      measures.soundLockShare = Math.min(1, locked / elements.length);
    }
  }
  return measures;
}

export function benchmarkGrammar(report: FilmGrammarReport): GrammarBenchmark {
  const measures = bandMeasures(report);
  const findings = againstGrammar(measures);
  const defects = new Set(findings.map((finding) => `${finding.band}:${finding.side}`));
  const readings: BandReading[] = [];
  let defectGap = 0;
  for (const [band, value] of Object.entries(measures) as [BandName, number][]) {
    const { low, high } = REFERENCE_BANDS[band];
    const width = Math.max(1e-9, high - low);
    const position: BandPosition = value < low ? 'below' : value > high ? 'above' : 'inside';
    const gap = position === 'below' ? (low - value) / width : position === 'above' ? (value - high) / width : 0;
    readings.push({ band, measured: round(value), low, high, position, gap: round(gap) });
    if (defects.has(`${band}:${position}`)) defectGap += gap;
  }
  return { readings, findings, defectGap: round(defectGap) };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
