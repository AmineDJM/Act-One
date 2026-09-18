import type { Standard } from './standard.ts';

/**
 * Editing and motion law.
 *
 * Two different things live here. Photosensitivity is a genuine safety standard
 * with a number attached and no room to argue. Everything else is editing
 * craft: rules that have been taught for a century because films that break
 * them feel wrong to audiences who have never heard of them.
 */
export const MOTION_STANDARDS = {
  flashRate: {
    id: 'motion.flash_rate',
    rule: 'Nothing flashes more than three times in any one second.',
    source: 'WCAG 2.2',
    clause: 'SC 2.3.1 (Three Flashes or Below Threshold)',
    authority: 'normative',
    enforcement: 'checked',
    because:
      'Above it, content can trigger seizures in people with photosensitive epilepsy. ' +
      'This is the one rule in the system that is about harm rather than quality, ' +
      'and the only one that is never waived.',
  },
  redFlash: {
    id: 'motion.red_flash',
    rule: 'Saturated red does not flash at all.',
    source: 'WCAG 2.2 SC 2.3.1, and ITU-R BT.1702',
    clause: 'guidance on harmful flashing',
    authority: 'normative',
    enforcement: 'checked',
    because: 'Saturated red transitions are more provocative than luminance flashes of the same rate.',
  },
  minimumShot: {
    id: 'motion.minimum_shot',
    rule: 'No shot is shorter than half a second.',
    source: 'Act One house rule, after standard commercial practice',
    authority: 'house',
    enforcement: 'checked',
    because:
      'Below roughly 12 frames the viewer registers a disturbance rather than an image. ' +
      'It is a glitch, not a cut — and it is what an automated editor produces when it ' +
      'divides a runtime by a scene count.',
  },
  rhythm: {
    id: 'motion.rhythm',
    rule: 'Shot lengths vary. A film of equal shots is a slideshow.',
    source: 'Act One house rule, after Murch, In the Blink of an Eye',
    authority: 'house',
    enforcement: 'checked',
    because:
      'Rhythm is the difference between an edit and an assembly. Equal shots are the single ' +
      'clearest sign that no one decided where the cuts go.',
  },
  thirtyDegree: {
    id: 'motion.thirty_degree',
    rule: 'Successive shots of the same subject change angle by at least thirty degrees.',
    source: 'Classical continuity editing',
    authority: 'convention',
    // Checked on the storyboard, where "the same subject" is decidable: two
    // consecutive scenes on one capture with the same treatment and the same
    // camera move are the same framing twice.
    enforcement: 'checked',
    because: 'A smaller change reads as a jump cut — the image twitches instead of moving on.',
  },
  axisOfAction: {
    id: 'motion.axis_of_action',
    rule: 'Screen direction is kept: elements do not cross the line between shots.',
    source: 'Classical continuity editing — the 180-degree rule',
    authority: 'convention',
    enforcement: 'checked',
    because:
      'Reversing direction across a cut disorients the viewer even in abstract motion graphics, ' +
      'where there is no subject to be confused about.',
  },
  easing: {
    id: 'motion.easing',
    rule: 'Nothing starts or stops at constant velocity.',
    source: 'Thomas & Johnston, The Illusion of Life — slow in and slow out',
    authority: 'convention',
    enforcement: 'designed_in',
    because:
      'Linear motion is the most recognisable signature of animation done by a computer ' +
      'rather than by an animator. Physical things accelerate.',
  },
  duration: {
    id: 'motion.duration',
    rule: 'Transitions run roughly 200 to 500ms, scaled to the distance travelled.',
    source: 'Material Design motion guidance',
    authority: 'guidance',
    enforcement: 'designed_in',
    because:
      'Faster reads as a glitch, slower reads as a wait. Larger movements need longer ' +
      'or they appear to teleport.',
  },
  staging: {
    id: 'motion.staging',
    rule: 'One idea moves at a time.',
    source: 'Thomas & Johnston, The Illusion of Life — staging',
    authority: 'convention',
    enforcement: 'designed_in',
    because:
      'Two simultaneous animations compete and the viewer resolves neither. ' +
      'It is the most common way an otherwise good frame becomes unreadable.',
  },
  shutter: {
    id: 'motion.shutter',
    rule: 'Synthesised motion blur matches a 180-degree shutter: exposure of half a frame.',
    source: 'Cinematographic convention, from the rotary shutter',
    authority: 'convention',
    enforcement: 'designed_in',
    because:
      'It is the blur every filmed image has had for a century, so its absence reads as ' +
      'video-game footage and its excess reads as a smear.',
  },
  variety: {
    id: 'motion.variety',
    rule: 'The same treatment does not run for three consecutive scenes.',
    source: 'Act One house rule',
    authority: 'house',
    enforcement: 'checked',
    because:
      'A template repeats. An edit varies. Since our recipes are finite, this is the ' +
      'rule that stops a finite set from looking like a small one.',
  },
} as const satisfies Record<string, Standard>;

/** WCAG 2.3.1: the general flash threshold. */
export const MAX_FLASHES_PER_SECOND = 3;

/** Seconds. Below this a cut is a disturbance rather than a shot. */
export const MIN_SHOT_SECONDS = 0.5;

/**
 * Minimum coefficient of variation in shot length.
 *
 * The standard deviation of the shot lengths over their mean. Below this the
 * edit has no rhythm — every shot is the same length, whatever that length is.
 */
export const MIN_RHYTHM_VARIATION = 0.12;

/** How many scenes may share a motion treatment in a row. */
export const MAX_CONSECUTIVE_SAME_TREATMENT = 2;

/** Transition duration bounds, in seconds. */
export const MIN_TRANSITION_SECONDS = 0.2;
export const MAX_TRANSITION_SECONDS = 0.5;

/** Degrees. Below this an angle change is a jump cut. */
export const MIN_ANGLE_CHANGE_DEGREES = 30;

/** Shutter angle, in degrees. 180 is one half of a frame's duration. */
export const SHUTTER_ANGLE = 180;

export function exposureSecondsFor(fps: number, shutterAngle = SHUTTER_ANGLE): number {
  return shutterAngle / 360 / fps;
}

/**
 * Coefficient of variation of a set of shot lengths.
 *
 * Returns 0 for fewer than two shots: a single shot has no rhythm to assess,
 * and reporting it as rhythmless would fail every bumper.
 */
export function rhythmVariation(durations: number[]): number {
  if (durations.length < 2) return 0;
  const mean = durations.reduce((sum, d) => sum + d, 0) / durations.length;
  if (mean <= 0) return 0;
  const variance =
    durations.reduce((sum, d) => sum + (d - mean) ** 2, 0) / durations.length;
  return Math.sqrt(variance) / mean;
}

/** The longest run of identical values in a sequence. */
export function longestRun<T>(values: readonly T[]): number {
  let best = 0;
  let run = 0;
  let previous: T | undefined;
  for (const value of values) {
    run = value === previous ? run + 1 : 1;
    previous = value;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Red flash thresholds, on the chroma of a frame.
 *
 * Redness is the frame's mean Cr, centred: 0 is neutral, 1 is as red as a
 * frame can be. A saturated-red transition is a change in redness at least
 * this large, in which the redder frame is at least this red. Paired and
 * counted exactly as luminance flashes are.
 */
export const MIN_REDNESS_CHANGE = 0.2;
export const RED_FLOOR = 0.25;
