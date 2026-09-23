import { estimated, measured, unknown, type Evidenced } from '../evidence.ts';
import type { ForensicGeometry } from '../forensics/report.ts';
import type { Ref } from '../schema/primitives.ts';

/**
 * Where type sits and how big and heavy it is, from the analyzer's geometry
 * of each line on its reference frame.
 *
 * Baseline, cap height, x-height and stem width are measured in the pixels.
 * Size and weight are not there to measure: they are what a face's own
 * proportions make of those, and faces differ. The proportions below were
 * measured through the analyzer's own measurement on 30 faces at 48 and
 * 96 px — Inter, Roboto, Montserrat, Poppins, Open Sans and Lato at every
 * weight from 100 to 900; DejaVu Sans and Serif, Liberation Sans and Serif,
 * FreeSans, FreeSerif and Loma at 400 and 700 — and every estimate carries
 * the range those faces span, not just their middle.
 */

/** Cap height over the em: 0.646 (Liberation Serif) to 0.750, median 0.708. */
const CAP_PER_EM = { low: 0.646, typical: 0.708, high: 0.75 };
/** x-height over the em: 0.458 (Liberation Serif) to 0.583, median 0.542. */
const X_PER_EM = { low: 0.458, typical: 0.542, high: 0.583 };

/**
 * Stem width over cap height, and over x-height, by weight class: the lowest,
 * median and highest of the faces measured, lines of mixed case and of
 * capitals together (the medians are mixed case). Neighbouring weights overlap — a 700 runs from 0.147
 * (Loma Bold) to 0.258 (DejaVu Sans Bold) — and 800 and 900 are not told
 * apart at all (medians 0.235 and 0.232).
 */
const STEM_PER_CAP: [weight: number, low: number, median: number, high: number][] = [
  [100, 0.017, 0.03, 0.037],
  [200, 0.047, 0.058, 0.063],
  [300, 0.068, 0.078, 0.102],
  [400, 0.102, 0.124, 0.153],
  [500, 0.137, 0.148, 0.166],
  [600, 0.162, 0.179, 0.208],
  [700, 0.147, 0.207, 0.258],
  [800, 0.214, 0.235, 0.281],
  [900, 0.216, 0.232, 0.338],
];
const STEM_PER_X: [weight: number, low: number, median: number, high: number][] = [
  [100, 0.025, 0.04, 0.049],
  [200, 0.063, 0.077, 0.082],
  [300, 0.092, 0.103, 0.129],
  [400, 0.133, 0.164, 0.183],
  [500, 0.179, 0.197, 0.218],
  [600, 0.207, 0.236, 0.254],
  [700, 0.198, 0.271, 0.319],
  [800, 0.282, 0.313, 0.348],
  [900, 0.292, 0.304, 0.324],
];

/**
 * Below this, a stroke is narrower than the pixels that draw it, and its
 * edges blur into its neighbours'. Measured against the truth on the same
 * 30 faces: edges on lines whose stems are 1.5 px or wider were within 0.09 px;
 * on lines with thinner stems, within 1.4 px.
 */
const HAIRLINE_PX = 1.5;
/**
 * Under this cap height, blur and compression thicken the one- and two-pixel
 * stems of interface type by a quarter or more: Plasma 5.25's Noto Sans
 * reads 0.15 stem/cap at 7–13 px against the 0.12 of its regular weight.
 */
const WEIGHT_MIN_CAP_PX = 16;
const WEIGHT_MIN_X_PX = 12;

export type LineGeometry = {
  baselineY: Evidenced<number>;
  capHeightPx: Evidenced<number>;
  xHeightPx: Evidenced<number>;
};

/** How far a measured edge can be from the true one: the agreeing glyphs' own spread, and never under half a pixel; hairlines a pixel and a half. */
function tolerance(geometry: ForensicGeometry, spread: number | undefined): number {
  if (geometry.stemPx !== null && geometry.stemPx < HAIRLINE_PX) return 1.5;
  return Math.max(0.5, spread ?? 0);
}

function agreementConfidence(agreeing: number, hairline: boolean): number {
  const base = agreeing >= 3 ? 0.95 : agreeing === 2 ? 0.85 : 0.7;
  return hairline ? base * 0.7 : base;
}

function describe(agreeing: number, what: string, geometry: ForensicGeometry): string {
  const glyphs = agreeing === 1 ? `one ${what} glyph` : `${agreeing} ${what} glyphs agreeing`;
  const letters = `${geometry.lettersFromInk} of ${geometry.letters} letters read from their own ink`;
  const hairline = geometry.stemPx !== null && geometry.stemPx < HAIRLINE_PX ? `; strokes of ${round(geometry.stemPx, 2)} px, under ${HAIRLINE_PX} px, blur their edges` : '';
  return `${glyphs} on the reference frame; ${letters}${hairline}`;
}

/** A line's baseline, cap height and x-height as measured, or why not. */
export function lineGeometry(geometry: ForensicGeometry | null | undefined, refs: Ref[]): LineGeometry {
  const method = 'text.geometry';
  if (!geometry) {
    const reason = 'The line\'s type could not be measured on its reference frame: too little contrast, too few glyphs agreeing on an edge, or type cut by the frame.';
    return { baselineY: unknown(method, reason, refs), capHeightPx: unknown(method, reason, refs), xHeightPx: unknown(method, reason, refs) };
  }
  const hairline = geometry.stemPx !== null && geometry.stemPx < HAIRLINE_PX;
  const edge = (value: number, agreeing: number, spread: number | undefined, what: string, note: string) => {
    const within = tolerance(geometry, spread);
    return measured(round(value, 2), method, refs, agreementConfidence(agreeing, hairline), {
      lowerBound: round(value - within, 2),
      upperBound: round(value + within, 2),
      unit: 'px',
      note: `${note}: ${describe(agreeing, what, geometry)}`,
    });
  };
  return {
    baselineY: edge(geometry.baselineY, geometry.agreeing.baseline, geometry.spread['baseline'], 'baseline', 'where the glyphs that stand on the baseline end, in frame pixels'),
    capHeightPx:
      geometry.capHeightPx === null
        ? unknown(method, 'No flat-topped capitals (E, H, I, T…) agreed on a cap line, or the line has none.', refs)
        : edge(geometry.capHeightPx, geometry.agreeing.cap, geometry.spread['cap'], 'capital', 'baseline to the top of the flat-topped capitals'),
    xHeightPx:
      geometry.xHeightPx === null
        ? unknown(method, 'No flat-topped lowercase (m, n, u, v, w, x, z…) agreed on an x-height, or the line has none.', refs)
        : edge(geometry.xHeightPx, geometry.agreeing.x, geometry.spread['x'], 'lowercase', 'baseline to the top of the flat-topped lowercase, arches\' overshoot included'),
  };
}

type Measured = { value: number; confidence: number; lower: number; upper: number };

function known(value: Evidenced<number>): Measured | null {
  return value.evidenceType === 'MEASURED' && value.value !== null
    ? { value: value.value, confidence: value.confidence, lower: value.lowerBound ?? value.value, upper: value.upperBound ?? value.value }
    : null;
}

/**
 * One value for a block from its lines' own: the median, and a note when the
 * lines differ by more than their measurement does — a block can hold a
 * heading and its subheading.
 */
function blockValue(lines: Evidenced<number>[], what: string, refs: Ref[], absent: string): Evidenced<number> {
  const values = lines.map(known).filter((line): line is Measured => line !== null);
  if (values.length === 0) return unknown('text.geometry', absent, refs);
  const sorted = [...values].sort((a, b) => a.value - b.value);
  const middle = sorted[Math.floor(sorted.length / 2)]!;
  const spread = sorted[sorted.length - 1]!.value - sorted[0]!.value;
  const slack = Math.max(...values.map((v) => v.upper - v.lower));
  const differ = values.length > 1 && spread > slack;
  return measured(middle.value, 'text.geometry', refs, differ ? middle.confidence * 0.7 : middle.confidence, {
    lowerBound: differ ? sorted[0]!.lower : middle.lower,
    upperBound: differ ? sorted[sorted.length - 1]!.upper : middle.upper,
    unit: 'px',
    note: differ
      ? `the block's lines differ: ${values.map((v) => v.value).join(', ')} px; the median is given`
      : values.length > 1
        ? `${values.length} lines agree`
        : `${what}, from its one measured line`,
  });
}

function stems(geometries: (ForensicGeometry | null | undefined)[]): number[] {
  return geometries.flatMap((geometry) => (geometry && geometry.stemPx !== null ? [geometry.stemPx] : []));
}

/** Where a stem ratio falls among the weights measured: the median line through them, and every weight whose range holds it. */
function weightFor(ratio: number, table: typeof STEM_PER_CAP): { weight: number; low: number; high: number } {
  const medians = table.slice(0, 8);
  let weight: number;
  if (ratio <= medians[0]![2]) weight = medians[0]![0];
  else if (ratio >= medians[medians.length - 1]![2]) weight = medians[medians.length - 1]![0];
  else {
    const upper = medians.findIndex(([, , median]) => median >= ratio);
    const [w0, , m0] = medians[upper - 1]!;
    const [w1, , m1] = medians[upper]!;
    weight = w0 + ((ratio - m0) / (m1 - m0)) * (w1 - w0);
  }
  const holding = table.filter(([, low, , high]) => ratio >= low * 0.95 && ratio <= high * 1.05).map(([w]) => w);
  const rounded = Math.round(weight / 10) * 10;
  return {
    weight: rounded,
    low: holding.length ? Math.min(...holding, rounded) : Math.max(100, rounded - 100),
    high: holding.length ? Math.max(...holding, rounded) : Math.min(900, rounded + 100),
  };
}

export type BlockTypeMetrics = {
  capHeightPx: Evidenced<number>;
  xHeightPx: Evidenced<number>;
  stemPx: Evidenced<number>;
  approxSizePx: Evidenced<number>;
  approxWeight: Evidenced<number>;
  lineSpacingPx: Evidenced<number>;
};

/**
 * A block's type: its cap height, x-height and stem as its lines measured
 * them; its size and weight as the faces measured make of those; and the
 * spacing of its baselines.
 */
export function blockTypeMetrics(
  lines: { geometry: ForensicGeometry | null | undefined; measured: LineGeometry; box: [number, number, number, number] }[],
  refs: Ref[],
): BlockTypeMetrics {
  const cap = blockValue(lines.map((line) => line.measured.capHeightPx), 'cap height', refs, 'No line of the block has flat-topped capitals that agreed on a cap line.');
  const xHeight = blockValue(lines.map((line) => line.measured.xHeightPx), 'x-height', refs, 'No line of the block has flat-topped lowercase that agreed on an x-height.');
  const strokes = stems(lines.map((line) => line.geometry));
  const stem = strokes.length === 0 ? null : median(strokes);
  const stemPx =
    stem === null
      ? unknown<number>('text.geometry', 'Fewer than three straight vertical strokes were found in the middle of the type.', refs)
      : measured(round(stem, 2), 'text.geometry', refs, stem < HAIRLINE_PX ? 0.5 : 0.85, {
          unit: 'px',
          note: stem < HAIRLINE_PX
            ? 'ink across the straight vertical strokes, as area; under 1.5 px a stroke is narrower than the pixels that draw it and reads wider than it is'
            : 'ink across the straight vertical strokes in the middle of the type, as area rather than a threshold, so blur does not widen it',
        });
  const capValue = cap.evidenceType === 'MEASURED' ? cap.value : null;
  const xValue = xHeight.evidenceType === 'MEASURED' ? xHeight.value : null;

  let approxSizePx: Evidenced<number>;
  if (capValue !== null) {
    approxSizePx = estimated(round(capValue / CAP_PER_EM.typical, 1), 'type.proportions', refs, 0.6, {
      lowerBound: round(capValue / CAP_PER_EM.high, 1),
      upperBound: round(capValue / CAP_PER_EM.low, 1),
      unit: 'px',
      note: `cap height ${capValue} px over the median cap-to-em ratio of the faces measured (${CAP_PER_EM.typical}); the bounds span theirs, ${CAP_PER_EM.low} to ${CAP_PER_EM.high}`,
    });
  } else if (xValue !== null) {
    approxSizePx = estimated(round(xValue / X_PER_EM.typical, 1), 'type.proportions', refs, 0.5, {
      lowerBound: round(xValue / X_PER_EM.high, 1),
      upperBound: round(xValue / X_PER_EM.low, 1),
      unit: 'px',
      note: `x-height ${xValue} px over the median x-to-em ratio of the faces measured (${X_PER_EM.typical}); the bounds span theirs, ${X_PER_EM.low} to ${X_PER_EM.high}`,
    });
  } else {
    const height = median(lines.map((line) => line.box[3]));
    approxSizePx = estimated(round(height / 1.3, 1), 'compiler.derivation', refs, 0.3, {
      lowerBound: round(height / 1.6, 1),
      upperBound: round(height / 1.0, 1),
      unit: 'px',
      note: 'no cap height or x-height was measured: the line box height over a typical 1.3 ratio of box to size; the bounds cover 1.0 to 1.6',
    });
  }

  let approxWeight: Evidenced<number>;
  const reference = capValue !== null ? { value: capValue, table: STEM_PER_CAP, name: 'cap height', minimum: WEIGHT_MIN_CAP_PX } : xValue !== null ? { value: xValue, table: STEM_PER_X, name: 'x-height', minimum: WEIGHT_MIN_X_PX } : null;
  if (stem === null || reference === null) {
    approxWeight = unknown('type.proportions', stem === null ? 'No stem was measured, so weight is not estimated.' : 'Neither cap height nor x-height was measured to set the stem against.', refs);
  } else if (reference.value < reference.minimum) {
    approxWeight = unknown('type.proportions', `A ${reference.name} of ${reference.value} px is under ${reference.minimum} px: blur and compression thicken stems of a pixel or two by a quarter or more, so weight is not estimated.`, refs);
  } else {
    const ratio = stem / reference.value;
    const found = weightFor(ratio, reference.table);
    const hairline = stem < HAIRLINE_PX;
    approxWeight = estimated(found.weight, 'type.proportions', refs, hairline ? 0.3 : 0.5, {
      lowerBound: hairline ? 100 : found.low,
      upperBound: found.high,
      note: `stem ${round(stem, 2)} px over ${reference.name} ${reference.value} px is ${round(ratio, 3)}; among the faces measured, weights ${found.low}–${found.high} stand in that ratio${hairline ? ', and strokes under 1.5 px read wider than they are' : ''}. A weight's name is its designer's: this orders the type, it does not identify it`,
    });
  }

  const baselines = lines.map((line) => known(line.measured.baselineY));
  let lineSpacingPx: Evidenced<number>;
  if (lines.length < 2) {
    lineSpacingPx = unknown('text.blocks', 'A single line has no line spacing.', refs);
  } else if (baselines.every((baseline) => baseline !== null)) {
    const gaps = baselines.slice(1).map((baseline, i) => baseline!.value - baselines[i]!.value);
    lineSpacingPx = measured(round(median(gaps), 2), 'text.geometry', refs, 0.9, { unit: 'px', note: 'baseline to baseline, the median over the block\'s consecutive lines' });
  } else {
    const gaps = lines.slice(1).map((line, i) => line.box[1] - lines[i]!.box[1]);
    lineSpacingPx = measured(round(median(gaps), 1), 'text.blocks', refs, 0.6, { unit: 'px', note: 'distance between consecutive line box tops: not every line\'s baseline was measured' });
  }
  return { capHeightPx: cap, xHeightPx: xHeight, stemPx, approxSizePx, approxWeight, lineSpacingPx };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
