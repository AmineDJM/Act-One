import type { EasingName } from '@act-one/core';

/**
 * Easing.
 *
 * The single most consequential file in the motion engine, and the one most
 * often left on defaults. Linear motion reads as machine-generated; a
 * symmetric ease reads as a template preset. Good UI motion is asymmetric —
 * it leaves quickly and arrives slowly, because that is what physical objects
 * with momentum do.
 *
 * Every curve here is a real cubic-bezier or spring, evaluated per frame.
 */
export type EasingFn = (t: number) => number;

function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  // Newton–Raphson against the x polynomial, which converges in a handful of
  // iterations across the whole domain and is exact enough at frame precision.
  const ax = 3 * x1 - 3 * x2 + 1;
  const bx = 3 * x2 - 6 * x1;
  const cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1;
  const by = 3 * y2 - 6 * y1;
  const cy = 3 * y1;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDerivativeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i += 1) {
      const dx = sampleX(t) - x;
      if (Math.abs(dx) < 1e-6) break;
      const d = sampleDerivativeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= dx / d;
    }
    return sampleY(t);
  };
}

/** Critically-ish damped spring, sampled as a normalised 0..1 curve. */
function spring(stiffness: number, damping: number, mass = 1): EasingFn {
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const omega = Math.sqrt(stiffness / mass);
    const zeta = damping / (2 * Math.sqrt(stiffness * mass));
    // Time is scaled so the visible settle occupies the scene's duration
    // rather than trailing past the cut.
    const time = t * 4;
    if (zeta < 1) {
      const omegaD = omega * Math.sqrt(1 - zeta * zeta);
      return (
        1 -
        Math.exp(-zeta * omega * time) *
          (Math.cos(omegaD * time) + ((zeta * omega) / omegaD) * Math.sin(omegaD * time))
      );
    }
    return 1 - Math.exp(-omega * time) * (1 + omega * time);
  };
}

export const EASINGS: Record<EasingName, EasingFn> = {
  linear: (t) => t,
  // The workhorse. Fast departure, long settle — confident without being showy.
  out_quint: cubicBezier(0.22, 1, 0.36, 1),
  // A softer arrival than the workhorse, for a thing that should settle rather
  // than snap into place.
  out_cubic: cubicBezier(0.215, 0.61, 0.355, 1),
  /*
   * The exit.
   *
   * Starts slowly and is moving fastest as it goes, which is what makes an
   * element look like it LEFT rather than like it faded. Measured as the most
   * common family in three of the four reference films, and absent from this
   * engine entirely until now — every curve here arrived, none of them
   * departed, so the only way to be rid of something was to cut.
   */
  in_cubic: cubicBezier(0.55, 0.055, 0.675, 0.19),
  // Travel: leaves one place and arrives at another, with the speed in the middle.
  in_out_cubic: cubicBezier(0.645, 0.045, 0.355, 1),
  in_out_quart: cubicBezier(0.77, 0, 0.175, 1),
  out_expo: cubicBezier(0.16, 1, 0.3, 1),
  spring_soft: spring(90, 17),
  spring_tight: spring(220, 26),
  // Pulls back a touch before moving. Used sparingly: on more than one element
  // at a time it reads as a cartoon.
  anticipate: cubicBezier(0.68, -0.35, 0.265, 1),
};

export function ease(name: EasingName, t: number): number {
  return (EASINGS[name] ?? EASINGS.out_quint)(clamp01(t));
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Normalised progress through a window of a scene, with an optional delay. */
export function progress(
  frame: number,
  fps: number,
  options: { delaySeconds?: number; durationSeconds: number },
): number {
  const start = (options.delaySeconds ?? 0) * fps;
  const length = Math.max(1, options.durationSeconds * fps);
  return clamp01((frame - start) / length);
}

/**
 * Staggered progress for a list of elements.
 *
 * Stagger is what makes a group of words feel typeset rather than pasted. Too
 * much and the line stops reading as a line; the brand's own motion language
 * sets the amount.
 */
export function staggered(
  index: number,
  frame: number,
  fps: number,
  options: { delaySeconds?: number; durationSeconds: number; staggerSeconds: number },
): number {
  return progress(frame, fps, {
    delaySeconds: (options.delaySeconds ?? 0) + index * options.staggerSeconds,
    durationSeconds: options.durationSeconds,
  });
}

export function interpolate(t: number, from: number, to: number): number {
  return from + (to - from) * t;
}

/**
 * Exit progress.
 *
 * Scenes that only animate in and then cut hard feel unfinished when the cut is
 * a dissolve. This returns 0 until the tail of the scene, then ramps to 1.
 */
export function exitProgress(
  frame: number,
  fps: number,
  sceneDurationSeconds: number,
  tailSeconds = 0.35,
): number {
  const totalFrames = sceneDurationSeconds * fps;
  const tailFrames = tailSeconds * fps;
  return clamp01((frame - (totalFrames - tailFrames)) / Math.max(1, tailFrames));
}
