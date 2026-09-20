import {
  objectPresent,
  valueAt,
  type Animatable,
  type CurveFn,
  type CurveName,
  type SceneGraph,
  type SceneObject,
} from './language.ts';
import { routeScene, CapabilityRegistry, type Routing } from './capabilities.ts';
import { readingSecondsFor } from '../standards/typography.ts';

/**
 * What is wrong with a shot, before anybody renders it.
 *
 * Act One's QA is good and it is all downstream: it opens the finished file
 * and measures freezes, silences, loudness and caption sync. That is the right
 * place for those questions and the wrong place for these ones. "This headline
 * is on screen for 0.9 seconds and takes 2.1 seconds to read" is knowable from
 * the plan, and finding it out from the master costs a three-minute render and
 * a repair cycle to learn something the storyboard already said.
 *
 * So these are structural checks over the scene language: legibility, safe
 * areas, competing payloads, motion the eye cannot follow, devices the film
 * has already used, and capabilities nobody can execute. They do not replace
 * the visual and audio QA — a frame can satisfy every check here and still be
 * ugly — they run first, cost nothing, and catch the class of defect that is a
 * planning mistake rather than a rendering one.
 */

export type SceneFinding = {
  sceneId: string;
  objectId: string | null;
  check:
    | 'unreadable_duration'
    | 'outside_safe_area'
    | 'competing_payloads'
    | 'excessive_simultaneous_motion'
    | 'velocity_discontinuity'
    | 'unmotivated_motion'
    | 'repeated_device'
    | 'unsupported_capability'
    | 'generated_product_ui'
    | 'excessive_blur';
  severity: 'hard_fail' | 'soft_fail' | 'note';
  message: string;
  atSeconds: number | null;
};

/** Frame-safe margins, matching the delivery standard. */
const SAFE = { x: 0.055, y: 0.06 };

/** Above this many objects moving at once, nobody can tell what to watch. */
const SIMULTANEOUS_MOTION_CEILING = 8;

/** A jump in normalised position per second that reads as a glitch, not a move. */
const VELOCITY_JUMP_CEILING = 6;

/** Blur past this and a payload is decoration. */
const PAYLOAD_BLUR_CEILING_PX = 6;

/** The sample rate for walking a timeline. Fine enough to catch a one-frame jump. */
const SAMPLE_HZ = 30;

/**
 * Inspects one scene.
 *
 * `curves` is injected so this stays free of the motion package: core must not
 * depend on the renderer, and a check that needs a browser is a check that
 * cannot run at plan time.
 */
export function inspectScene(
  scene: SceneGraph,
  curves: Record<CurveName, CurveFn>,
  options: { registry?: CapabilityRegistry; previousMacros?: string[] } = {},
): SceneFinding[] {
  const findings: SceneFinding[] = [];
  const say = (finding: Omit<SceneFinding, 'sceneId'>) =>
    findings.push({ sceneId: scene.id, ...finding });

  // --- capability -----------------------------------------------------------
  const routing: Routing = routeScene(scene, options.registry ?? new CapabilityRegistry());
  for (const problem of routing.problems) {
    say({
      objectId: problem.objectId === '*' ? null : problem.objectId,
      check: 'unsupported_capability',
      severity: 'hard_fail',
      message: problem.message,
      atSeconds: null,
    });
  }

  // --- the product rule -----------------------------------------------------
  for (const object of scene.objects) {
    if ((object.kind === 'image' || object.kind === 'clip') && object.generated) {
      const describes = `${object.reason} ${scene.intent}`.toLowerCase();
      if (
        /\b(dashboard|interface|ui|screen|app|console|editor|inbox|panel|sidebar|settings)\b/.test(
          describes,
        )
      ) {
        say({
          objectId: object.id,
          check: 'generated_product_ui',
          severity: 'hard_fail',
          message:
            'A generated object is describing the product interface. Generated imagery may surround the ' +
            'product; it may never stand in for it. Use a capture.',
          atSeconds: object.enterAt,
        });
      }
    }
  }

  // --- legibility -----------------------------------------------------------
  for (const object of scene.objects) {
    if (object.kind !== 'text' || object.role !== 'payload') continue;
    const exit = object.exitAt ?? scene.durationSeconds;
    const onScreen = exit - object.enterAt;
    const needed = readingSecondsFor(object.content);
    if (onScreen + 0.001 < needed) {
      say({
        objectId: object.id,
        check: 'unreadable_duration',
        severity: 'hard_fail',
        message:
          `"${object.content.slice(0, 48)}" is on screen for ${onScreen.toFixed(2)}s and takes about ` +
          `${needed.toFixed(2)}s to read. A line the viewer cannot finish is a line that was not said.`,
        atSeconds: object.enterAt,
      });
    }
  }

  // --- safe area ------------------------------------------------------------
  for (const object of scene.objects) {
    if (object.role === 'atmosphere' || object.kind === 'field' || object.kind === 'gradient')
      continue;
    for (const t of [0, 0.5, 1]) {
      const x = valueAt(object.transform.x, t, curves);
      const y = valueAt(object.transform.y, t, curves);
      if (x < SAFE.x || x > 1 - SAFE.x || y < SAFE.y || y > 1 - SAFE.y) {
        say({
          objectId: object.id,
          check: 'outside_safe_area',
          severity: object.role === 'payload' ? 'hard_fail' : 'note',
          message:
            `Sits at (${x.toFixed(2)}, ${y.toFixed(2)}), outside the title-safe area. ` +
            `A player's chrome can cover it.`,
          atSeconds: null,
        });
        break;
      }
    }
  }

  // --- competing payloads ---------------------------------------------------
  const samples = Math.max(2, Math.round(scene.durationSeconds * SAMPLE_HZ));
  let worstPayloads = 0;
  let worstAt = 0;
  let worstMoving = 0;
  let worstMovingAt = 0;

  for (let i = 0; i < samples; i += 1) {
    const seconds = (i / (samples - 1)) * scene.durationSeconds;
    let payloads = 0;
    let moving = 0;

    for (const object of scene.objects) {
      if (!objectPresent(object, seconds, scene.durationSeconds)) continue;
      if (object.role === 'payload') payloads += 1;
      if (isMoving(object, seconds, scene, curves)) moving += 1;
    }
    if (payloads > worstPayloads) {
      worstPayloads = payloads;
      worstAt = seconds;
    }
    if (moving > worstMoving) {
      worstMoving = moving;
      worstMovingAt = seconds;
    }
  }

  if (worstPayloads > 2) {
    say({
      objectId: null,
      check: 'competing_payloads',
      severity: 'soft_fail',
      message:
        `${worstPayloads} things are asking to be read at once at ${worstAt.toFixed(1)}s. ` +
        `The eye goes to one of them and the film chooses which.`,
      atSeconds: worstAt,
    });
  }

  if (worstMoving > SIMULTANEOUS_MOTION_CEILING) {
    say({
      objectId: null,
      check: 'excessive_simultaneous_motion',
      severity: 'soft_fail',
      message:
        `${worstMoving} objects move independently at ${worstMovingAt.toFixed(1)}s. ` +
        `Past about ${SIMULTANEOUS_MOTION_CEILING} the frame reads as activity rather than as anything in particular.`,
      atSeconds: worstMovingAt,
    });
  }

  // --- motion that means nothing -------------------------------------------
  for (const object of scene.objects) {
    if (object.role === 'atmosphere') continue;
    if (!movesAtAll(object, scene, curves)) continue;
    if (object.reason.trim().length === 0) {
      say({
        objectId: object.id,
        check: 'unmotivated_motion',
        severity: 'soft_fail',
        message:
          `A ${object.kind} moves and gives no reason. Motion that cannot say what it is communicating ` +
          `is decoration, and decoration is what makes a film read as a template.`,
        atSeconds: object.enterAt,
      });
    }
  }

  // --- velocity ------------------------------------------------------------
  for (const object of scene.objects) {
    const jump = worstVelocityJump(object, scene, curves);
    if (jump.value > VELOCITY_JUMP_CEILING) {
      say({
        objectId: object.id,
        check: 'velocity_discontinuity',
        severity: 'note',
        message:
          `Position changes by ${jump.value.toFixed(1)} frame-widths per second around ${jump.at.toFixed(2)}s. ` +
          `That reads as a jump rather than as a move.`,
        atSeconds: jump.at,
      });
    }
  }

  // --- blur on something meant to be read ----------------------------------
  for (const object of scene.objects) {
    if (object.role !== 'payload') continue;
    const blur = Math.max(
      valueAt(object.transform.blurPx, 0.5, curves),
      valueAt(object.transform.blurPx, 1, curves),
    );
    if (blur > PAYLOAD_BLUR_CEILING_PX) {
      say({
        objectId: object.id,
        check: 'excessive_blur',
        severity: 'soft_fail',
        message: `Blurred to ${blur.toFixed(1)}px while carrying the beat. It cannot be read through that.`,
        atSeconds: null,
      });
    }
  }

  // --- the same device twice ------------------------------------------------
  const previous = options.previousMacros ?? [];
  if (scene.macro && previous.length >= 2) {
    const [a, b] = [previous[previous.length - 1], previous[previous.length - 2]];
    if (a === scene.macro && b === scene.macro) {
      say({
        objectId: null,
        check: 'repeated_device',
        severity: 'soft_fail',
        message: `The third "${scene.macro}" in a row. A signature move stops being one when it is the house style.`,
        atSeconds: null,
      });
    }
  }

  return findings;
}

/** A whole film's worth, with the device history threaded through. */
export function inspectScenes(
  scenes: readonly SceneGraph[],
  curves: Record<CurveName, CurveFn>,
  options: { registry?: CapabilityRegistry } = {},
): SceneFinding[] {
  const macros: string[] = [];
  const findings: SceneFinding[] = [];
  for (const scene of scenes) {
    findings.push(...inspectScene(scene, curves, { ...options, previousMacros: [...macros] }));
    macros.push(scene.macro ?? scene.id);
  }
  return findings;
}

// ---------------------------------------------------------------------------

function animatedAtAll(property: Animatable): boolean {
  if (typeof property === 'number') return false;
  if ('from' in property) return Math.abs(property.to - property.from) > 1e-6;
  return property.keyframes.some(
    (frame) => Math.abs(frame.value - property.keyframes[0]!.value) > 1e-6,
  );
}

function movesAtAll(
  object: SceneObject,
  _scene: SceneGraph,
  _curves: Record<CurveName, CurveFn>,
): boolean {
  const t = object.transform;
  return (
    animatedAtAll(t.x) ||
    animatedAtAll(t.y) ||
    animatedAtAll(t.z) ||
    animatedAtAll(t.scale) ||
    animatedAtAll(t.rotationZ) ||
    animatedAtAll(t.rotationX) ||
    animatedAtAll(t.rotationY)
  );
}

function isMoving(
  object: SceneObject,
  seconds: number,
  scene: SceneGraph,
  curves: Record<CurveName, CurveFn>,
): boolean {
  if (!movesAtAll(object, scene, curves)) return false;
  const enter = object.enterAt;
  const exit = object.exitAt ?? scene.durationSeconds;
  const span = Math.max(0.0001, exit - enter);
  const t = (seconds - enter) / span;
  const step = 1 / (span * SAMPLE_HZ);
  const dx = valueAt(object.transform.x, t + step, curves) - valueAt(object.transform.x, t, curves);
  const dy = valueAt(object.transform.y, t + step, curves) - valueAt(object.transform.y, t, curves);
  const ds =
    valueAt(object.transform.scale, t + step, curves) - valueAt(object.transform.scale, t, curves);
  return Math.hypot(dx, dy) > 1e-4 || Math.abs(ds) > 1e-4;
}

function worstVelocityJump(
  object: SceneObject,
  scene: SceneGraph,
  curves: Record<CurveName, CurveFn>,
): { value: number; at: number } {
  const enter = object.enterAt;
  const exit = object.exitAt ?? scene.durationSeconds;
  const span = Math.max(0.0001, exit - enter);
  const steps = Math.max(3, Math.round(span * SAMPLE_HZ));
  let worst = 0;
  let at = enter;
  let previous = 0;

  for (let i = 1; i < steps; i += 1) {
    const t0 = (i - 1) / (steps - 1);
    const t1 = i / (steps - 1);
    const dx = valueAt(object.transform.x, t1, curves) - valueAt(object.transform.x, t0, curves);
    const dy = valueAt(object.transform.y, t1, curves) - valueAt(object.transform.y, t0, curves);
    const velocity = Math.hypot(dx, dy) * SAMPLE_HZ;
    const change = Math.abs(velocity - previous);
    if (change > worst) {
      worst = change;
      at = enter + t1 * span;
    }
    previous = velocity;
  }
  return { value: worst, at };
}
