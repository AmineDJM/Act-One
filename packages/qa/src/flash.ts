import {
  MAX_FLASHES_PER_SECOND,
  MOTION_STANDARDS,
  cite,
  newId,
  type QaIssue,
  COLOR_STANDARDS,
  MIN_REDNESS_CHANGE,
  RED_FLOOR,
  STUDIO_BLACK_8BIT,
  STUDIO_RANGE_TOLERANCE,
  STUDIO_WHITE_8BIT,
} from '@act-one/core';

/**
 * Photosensitivity.
 *
 * This is the only check in Act One that is about harm rather than quality.
 * Content that flashes more than three times a second can trigger seizures in
 * people with photosensitive epilepsy, and unlike every other rule here there
 * is no creative argument on the other side of it: a film that fails this is
 * not a film with a defect, it is a film that can hurt somebody.
 *
 * The standard is WCAG 2.2 SC 2.3.1, which defines a flash as a pair of
 * opposing changes in relative luminance of at least 10% of maximum, where the
 * darker of the two is below 0.80 relative luminance, and sets the limit at
 * three in any one-second window.
 *
 * What this measures is whole-frame average luminance. WCAG's area condition —
 * the flashing region must exceed a quarter of the central visual field —
 * cannot be evaluated from a frame average, so this is the conservative
 * reading: a whole-frame change is by definition large enough to count, and a
 * small bright element flashing in a corner will not register here. For the
 * films this system makes, which cut whole frames rather than animating small
 * regions, whole-frame luminance is the signal that matters.
 */

/** Relative luminance, 0..1, from a frame's average luma. */
export function relativeLuminance(yAvg: number, fullRange = false): number {
  // FFmpeg reports YAVG on the 0..255 scale of the coded values. Video is
  // normally limited range, where 16 is black and 235 is white; treating it as
  // full range would report black frames as slightly grey and compress the
  // whole scale, which matters when the threshold is a fixed 0.8.
  const normalized = fullRange
    ? yAvg / 255
    : Math.max(0, Math.min(1, (yAvg - 16) / (235 - 16)));

  // The sRGB transfer function, as WCAG defines relative luminance.
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

export type FlashEvent = {
  /** Seconds into the film. */
  atSeconds: number;
  /** How many flashes fell in the one-second window starting here. */
  count: number;
};

/** A qualifying luminance change: big enough, and not between two bright images. */
export const MIN_LUMINANCE_CHANGE = 0.1;
export const DARKER_MUST_BE_BELOW = 0.8;

/**
 * Counts flashes per WCAG's general flash threshold.
 *
 * A flash is a *pair* of opposing changes, not a single one — so a light going
 * on and off again is one flash, and six alternations are three. Counting
 * individual changes, which is the obvious mistake, doubles every result and
 * fails ordinary cutting.
 *
 * A run of changes in the same direction is not flashing at all, however steep:
 * that is a fade, and a check that counted those would reject every dissolve in
 * every film we make.
 */
export function findFlashes(
  luminance: readonly number[],
  fps: number,
  limit = MAX_FLASHES_PER_SECOND,
): FlashEvent[] {
  if (luminance.length < 2 || fps <= 0) return [];

  // Frame indices at which a pair of opposing changes completed.
  const flashes: number[] = [];
  let anchorIndex = 0;
  let pendingDirection = 0;

  for (let i = 1; i < luminance.length; i += 1) {
    const from = luminance[anchorIndex]!;
    const to = luminance[i]!;
    const change = to - from;
    if (Math.abs(change) < MIN_LUMINANCE_CHANGE) continue;

    // The darker of the pair must be below the threshold, or this is a change
    // between two bright images and does not count.
    if (Math.min(from, to) >= DARKER_MUST_BE_BELOW) {
      anchorIndex = i;
      continue;
    }

    const direction = change > 0 ? 1 : -1;
    anchorIndex = i;

    if (pendingDirection === 0) {
      pendingDirection = direction;
    } else if (direction !== pendingDirection) {
      flashes.push(i);
      pendingDirection = 0;
    } else {
      // Same direction again: still the first half of a pair, just further on.
      pendingDirection = direction;
    }
  }

  const window = Math.max(1, Math.round(fps));
  const events: FlashEvent[] = [];
  let reportedUntil = -1;

  for (let start = 0; start < flashes.length; start += 1) {
    const from = flashes[start]!;
    let count = 0;
    for (let i = start; i < flashes.length && flashes[i]! < from + window; i += 1) {
      count += 1;
    }
    // One report per offending stretch rather than one per frame of it.
    if (count > limit && from > reportedUntil) {
      events.push({ atSeconds: from / fps, count });
      reportedUntil = from + window;
    }
  }

  return events;
}

/** Turns flash events into QA findings. Always blocking. */
export function flashIssues(luminance: readonly number[], fps: number): QaIssue[] {
  return findFlashes(luminance, fps).map((event) => ({
    id: newId('evt'),
    sceneId: null,
    atSeconds: Number(event.atSeconds.toFixed(2)),
    detectedBy: 'deterministic' as const,
    evidenceAssetId: null,
    check: 'flicker' as const,
    severity: 'blocker' as const,
    message:
      `${event.count} flashes in one second at ${event.atSeconds.toFixed(1)}s; ` +
      `${MAX_FLASHES_PER_SECOND} is the limit (${cite(MOTION_STANDARDS.flashRate)}). ` +
      'This can trigger seizures and is never shipped.',
    confidence: 1,
    repair: 'manual_review' as const,
  }));
}

/**
 * Everything the frame-statistics pass reads per frame.
 *
 * `signalstats` reports luma and chroma statistics per frame; `metadata=print`
 * writes them as `lavfi.signalstats.KEY=value` lines. One pass over the film
 * feeds three checks: luminance flashes, red flashes and the studio range.
 */
export type FrameStats = {
  yavg: number[];
  ymin: number[];
  ymax: number[];
  /** Mean Cr per frame, 0..255. Red content pushes it above 128. */
  vavg: number[];
};

export function parseFrameStats(output: string): FrameStats {
  const stats: FrameStats = { yavg: [], ymin: [], ymax: [], vavg: [] };
  const keys: [RegExp, keyof FrameStats][] = [
    [/signalstats\.YAVG=([\d.]+)/, 'yavg'],
    [/signalstats\.YMIN=([\d.]+)/, 'ymin'],
    [/signalstats\.YMAX=([\d.]+)/, 'ymax'],
    [/signalstats\.VAVG=([\d.]+)/, 'vavg'],
  ];
  for (const line of output.split('\n')) {
    for (const [pattern, key] of keys) {
      const match = pattern.exec(line);
      if (!match) continue;
      const value = Number(match[1]);
      if (Number.isFinite(value)) stats[key].push(value);
    }
  }
  return stats;
}

/** Mean Cr as redness: 0 neutral, 1 fully red, negative towards cyan. */
export function redness(vavg: number, fullRange = false): number {
  const centre = 128;
  const span = fullRange ? 127 : 112;
  return Math.max(-1, Math.min(1, (vavg - centre) / span));
}

/**
 * Counts saturated-red flashes, paired the way luminance flashes are.
 *
 * WCAG's general threshold has a companion for red: a transition to or from
 * a saturated red counts even when the luminance barely moves, because red
 * provokes the visual cortex more than an equal-luminance change of another
 * colour. The chroma of a whole frame is a coarse proxy for "saturated red
 * covering enough of the picture" — coarse in the safe direction, because a
 * small red element cannot move a frame's mean Cr by a fifth of its range.
 */
export function findRedFlashes(
  rednessSeries: readonly number[],
  fps: number,
  limit = MAX_FLASHES_PER_SECOND,
): FlashEvent[] {
  if (rednessSeries.length < 2 || fps <= 0) return [];
  const flashes: number[] = [];
  let anchorIndex = 0;
  let pendingDirection = 0;

  for (let i = 1; i < rednessSeries.length; i += 1) {
    const from = rednessSeries[anchorIndex]!;
    const to = rednessSeries[i]!;
    const change = to - from;
    if (Math.abs(change) < MIN_REDNESS_CHANGE) continue;
    // One side of the transition has to actually be red.
    if (Math.max(from, to) < RED_FLOOR) {
      anchorIndex = i;
      continue;
    }
    const direction = change > 0 ? 1 : -1;
    anchorIndex = i;
    if (pendingDirection === 0) {
      pendingDirection = direction;
    } else if (direction !== pendingDirection) {
      flashes.push(i);
      pendingDirection = 0;
    } else {
      pendingDirection = direction;
    }
  }

  const window = Math.max(1, Math.round(fps));
  const events: FlashEvent[] = [];
  let reportedUntil = -1;
  for (let start = 0; start < flashes.length; start += 1) {
    const from = flashes[start]!;
    let count = 0;
    for (let i = start; i < flashes.length && flashes[i]! < from + window; i += 1) count += 1;
    if (count > limit && from > reportedUntil) {
      events.push({ atSeconds: from / fps, count });
      reportedUntil = from + window;
    }
  }
  return events;
}

export function redFlashIssues(rednessSeries: readonly number[], fps: number): QaIssue[] {
  return findRedFlashes(rednessSeries, fps).map((event) => ({
    id: newId('evt'),
    sceneId: null,
    atSeconds: Number(event.atSeconds.toFixed(2)),
    detectedBy: 'deterministic' as const,
    evidenceAssetId: null,
    check: 'flicker' as const,
    severity: 'blocker' as const,
    message:
      `${event.count} saturated-red flashes in one second at ${event.atSeconds.toFixed(1)}s ` +
      `(${cite(MOTION_STANDARDS.redFlash)}). Red transitions are more provocative than ` +
      'luminance flashes of the same rate, and this is never shipped.',
    confidence: 0.9,
    repair: 'manual_review' as const,
  }));
}

/**
 * Frames outside the studio range, on a limited-range file.
 *
 * Luma below 16 or above 235 is clipped by whatever plays the film outside a
 * browser, and where it clips is not ours to choose. A full-range file is a
 * different failure and is caught by the container check.
 */
export function rangeIssues(stats: Pick<FrameStats, 'ymin' | 'ymax'>, fullRange: boolean, fps: number): QaIssue[] {
  if (fullRange) return [];
  const low = STUDIO_BLACK_8BIT - STUDIO_RANGE_TOLERANCE;
  const high = STUDIO_WHITE_8BIT + STUDIO_RANGE_TOLERANCE;
  let firstBad = -1;
  let count = 0;
  const frames = Math.max(stats.ymin.length, stats.ymax.length);
  for (let i = 0; i < frames; i += 1) {
    const min = stats.ymin[i] ?? STUDIO_BLACK_8BIT;
    const max = stats.ymax[i] ?? STUDIO_WHITE_8BIT;
    if (min < low || max > high) {
      count += 1;
      if (firstBad < 0) firstBad = i;
    }
  }
  if (count === 0) return [];
  return [
    {
      id: newId('evt'),
      sceneId: null,
      atSeconds: fps > 0 ? Number((firstBad / fps).toFixed(2)) : null,
      detectedBy: 'deterministic' as const,
      evidenceAssetId: null,
      check: 'composition' as const,
      severity: 'major' as const,
      message:
        `${count} frame${count === 1 ? '' : 's'} carry luma outside the studio range ` +
        `(${STUDIO_BLACK_8BIT}–${STUDIO_WHITE_8BIT}), first at ${(firstBad / fps).toFixed(1)}s ` +
        `(${cite(COLOR_STANDARDS.broadcastRange)}). They will clip on anything but a browser.`,
      confidence: 0.95,
      repair: 'manual_review' as const,
    },
  ];
}

/**
 * Parses per-frame average luma out of FFmpeg's signalstats metadata.
 *
 * `-vf signalstats -show_entries frame_tags=lavfi.signalstats.YAVG` prints one
 * `TAG:lavfi.signalstats.YAVG=...` line per frame in ffprobe's flat format.
 */
export function parseYAvg(output: string): number[] {
  const values: number[] = [];
  for (const line of output.split('\n')) {
    const match = /YAVG=([\d.]+)/.exec(line);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

/**
 * Whether a video is full-range, from FFmpeg's own stream description.
 *
 * It matters more than it sounds. Limited range puts black at 16 and white at
 * 235; full range uses the whole 0..255. Reading one as the other shifts every
 * luminance in the film, and the flash threshold is a fixed 0.8 — so the wrong
 * assumption is the difference between catching a dangerous sequence and
 * missing it.
 *
 * FFmpeg prints the range in the pixel-format parentheses: `yuv420p(tv, ...)`
 * or `yuvj420p(pc, ...)`. The `yuvj` prefix means full range on its own, and is
 * what our own encoder produces. Defaults to limited when nothing says,
 * because that is the broadcast norm.
 */
export function isFullRange(ffmpegStderr: string): boolean {
  const stream = /Stream #\d+:\d+.*?: Video: .*/.exec(ffmpegStderr);
  if (!stream) return false;
  const line = stream[0];
  if (/\byuvj\d/.test(line)) return true;
  if (/\((?:pc|full)[,)]/.test(line)) return true;
  return false;
}
