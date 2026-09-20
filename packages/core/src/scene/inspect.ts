import {
  objectPresent,
  valueAt,
  parallaxScale,
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
    | 'text_outside_frame'
    | 'outside_safe_area'
    | 'competing_payloads'
    | 'excessive_simultaneous_motion'
    | 'velocity_discontinuity'
    | 'unmotivated_motion'
    | 'repeated_device'
    | 'unsupported_capability'
    | 'generated_product_ui'
    | 'excessive_blur'
    | 'ui_too_small'
    | 'brand_token_violation'
    | 'scene_similarity';
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

/**
 * Below this fraction of the frame, a product capture is a thumbnail.
 *
 * A critic watching an Act One master said the interface was "too much small
 * text presented for too short a duration to actually read" and measured the
 * viewer's load as high for the five seconds it was up. A whole page scaled
 * into a corner is not the product being shown; it is the product being
 * referred to.
 */
const UI_MIN_FRAME_SHARE = 0.34;

/**
 * How alike two scenes may be before the film has stopped developing.
 *
 * Compared on shape rather than content: the same object kinds, in the same
 * roles, at the same places, with the same camera. Two scenes can say entirely
 * different things and still be the same picture, which is the failure this
 * catches — a film that changes its words and never changes its image.
 */
const SIMILARITY_CEILING = 0.86;

/**
 * How far a text box may hang past the frame before it is a defect.
 *
 * Not zero. A box is a wrap width, not an ink bound, and a trailing space or a
 * hair of letter-spacing on the last glyph routinely puts the box a pixel or
 * two over an edge with nothing visibly cut. A hard zero would fail correct
 * scenes; 1% of the frame is about a character, which is the smallest amount
 * of clipping anybody can actually see.
 */
const TEXT_BLEED = 0.01;

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

  // --- text that leaves the frame -------------------------------------------
  /*
   * The check the safe-area one looks like it is doing and is not.
   *
   * Safe area tests an object's anchor POINT. A text object is not a point: it
   * is a box `maxWidth` wide that the renderer wraps inside, placed by its
   * anchor. A headline with `maxWidth: 0.8` anchored at its centre on x = 0.08
   * has an anchor comfortably inside the safe area and a box that starts at
   * -0.32 — a third of a frame off the left edge — so the film renders the
   * word "Six" as "ix" and every check passes.
   *
   * That is not hypothetical. Two of three creative directions clipped their
   * headlines and their body copy on the first render, the QA pass reported no
   * hard failures, and the only way to find it was to look at the frames. A
   * structural check that cannot see the most visible defect in the output is
   * the check that needed writing.
   *
   * Horizontal only, and deliberately. The box width is known exactly; its
   * height depends on how the text wraps, which depends on the font, which
   * this package cannot see without a browser. A guessed vertical bound would
   * produce false failures on every correct scene, and a check people learn to
   * ignore protects nothing.
   */
  for (const object of scene.objects) {
    if (object.kind !== 'text') continue;
    for (const t of [0, 0.5, 1]) {
      /*
       * Measured through the camera, not off the authored transform.
       *
       * The first version of this check read `x` and `scale` alone and passed
       * a direction whose headline the dolly magnified straight off both
       * edges — a near plane under a push is bigger and further from centre
       * than it was authored, and a check blind to that is only correct for a
       * locked camera. Mirrors the renderer exactly: the same magnification
       * applies to the layer's size and to its distance from frame centre.
       */
      const depth = parallaxScale(valueAt(object.transform.z, t, curves), scene.camera, t, curves);
      const camScale = valueAt(scene.camera.scale, t, curves);
      const camX = valueAt(scene.camera.x, t, curves);

      // Two transforms, composed in the renderer's order: the dolly magnifies
      // and displaces each layer by its own depth, then the camera scales and
      // translates the whole frame around its centre.
      const scale = valueAt(object.transform.scale, t, curves) * depth * camScale;
      const width = object.maxWidth * scale;
      const parallaxed = 0.5 + (valueAt(object.transform.x, t, curves) - 0.5) * depth;
      const x = 0.5 + (parallaxed - 0.5) * camScale + camX;
      const left = x - object.transform.anchor.x * width;
      const right = left + width;
      if (left >= -TEXT_BLEED && right <= 1 + TEXT_BLEED) continue;

      const edge = left < -TEXT_BLEED ? 'left' : 'right';
      const over = edge === 'left' ? -left : right - 1;
      say({
        objectId: object.id,
        check: 'text_outside_frame',
        severity: object.role === 'payload' ? 'hard_fail' : 'soft_fail',
        message:
          `"${object.content.slice(0, 40)}" is laid out in a box ${(width * 100).toFixed(0)}% of the ` +
          `frame wide, which puts its ${edge} edge ${(over * 100).toFixed(0)}% past the frame. ` +
          `The words are cut off. Narrow maxWidth, move x, or change the anchor.`,
        atSeconds: null,
      });
      break;
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

  // --- the product, shown too small to be shown -----------------------------
  for (const object of scene.objects) {
    if (object.kind !== 'capture' && object.kind !== 'ui_layer') continue;
    const widest = Math.max(
      valueAt(object.width, 0, curves),
      valueAt(object.width, 0.5, curves),
      valueAt(object.width, 1, curves),
    );
    const scale = Math.max(
      valueAt(object.transform.scale, 0.5, curves),
      valueAt(object.transform.scale, 1, curves),
    );
    if (widest * scale < UI_MIN_FRAME_SHARE) {
      say({
        objectId: object.id,
        check: 'ui_too_small',
        severity: 'soft_fail',
        message:
          `The interface never occupies more than ${(widest * scale * 100).toFixed(0)}% of the frame. ` +
          `Below about ${UI_MIN_FRAME_SHARE * 100}% it is a thumbnail of the product rather than the product.`,
        atSeconds: object.enterAt,
      });
    }
  }

  // --- colours the brand does not have --------------------------------------
  for (const object of scene.objects) {
    for (const literal of literalColors(object)) {
      say({
        objectId: object.id,
        check: 'brand_token_violation',
        severity: 'soft_fail',
        message:
          `Uses the literal colour ${literal} instead of a brand token. A film assembled from hex ` +
          `values is a film that stops being the customer's the moment their palette changes.`,
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

  /*
   * And then the question only the whole film can answer: is it developing?
   *
   * Every scene can pass on its own and the film still be one picture
   * repeated, which is exactly what a template looks like from the outside.
   * Compared pairwise rather than only against the neighbour, because a film
   * that alternates between two compositions is as static as one that holds
   * a single one.
   */
  for (let i = 0; i < scenes.length; i += 1) {
    for (let j = i + 1; j < scenes.length; j += 1) {
      const score = similarity(scenes[i]!, scenes[j]!, curves);
      if (score >= SIMILARITY_CEILING) {
        findings.push({
          sceneId: scenes[j]!.id,
          objectId: null,
          check: 'scene_similarity',
          severity: 'soft_fail',
          message:
            `${(score * 100).toFixed(0)}% the same picture as ${scenes[i]!.id}: same object kinds, ` +
            `same roles, same positions, same camera. The words changed and the image did not.`,
          atSeconds: null,
        });
      }
    }
  }

  return findings;
}

/** Literal hex colours on an object, which should have been brand tokens. */
function literalColors(object: SceneObject): string[] {
  const found: string[] = [];
  const check = (value: unknown) => {
    if (typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value.trim()))
      found.push(value.trim());
    else if (value && typeof value === 'object') {
      const pair = value as { from?: unknown; to?: unknown };
      check(pair.from);
      check(pair.to);
    }
  };
  const record = object as unknown as Record<string, unknown>;
  for (const key of ['color', 'fill', 'stroke', 'from', 'to']) {
    if (key in record) check(record[key]);
  }
  // White light is white, not a brand decision; a light's colour is exempt.
  return object.kind === 'light' ? [] : [...new Set(found)];
}

/**
 * How alike two scenes are, as a fraction.
 *
 * Shape, not content. Three signals, evenly weighted: which kinds of object
 * are present in which roles, where the payloads sit, and what the camera
 * does. Two scenes with the same three signals are the same picture whatever
 * the words say.
 */
function similarity(a: SceneGraph, b: SceneGraph, curves: Record<CurveName, CurveFn>): number {
  const signature = (scene: SceneGraph) =>
    new Set(scene.objects.map((object) => `${object.kind}:${object.role}`));
  const left = signature(a);
  const right = signature(b);
  const shared = [...left].filter((entry) => right.has(entry)).length;
  const union = new Set([...left, ...right]).size;
  const kinds = union === 0 ? 1 : shared / union;

  const anchor = (scene: SceneGraph) => {
    const payload = scene.objects.find((object) => object.role === 'payload');
    if (!payload) return { x: 0.5, y: 0.5 };
    return {
      x: valueAt(payload.transform.x, 0.5, curves),
      y: valueAt(payload.transform.y, 0.5, curves),
    };
  };
  const pa = anchor(a);
  const pb = anchor(b);
  const placement = 1 - Math.min(1, Math.hypot(pa.x - pb.x, pa.y - pb.y) * 2);

  const move = (scene: SceneGraph) => ({
    scale: valueAt(scene.camera.scale, 1, curves) - valueAt(scene.camera.scale, 0, curves),
    x: valueAt(scene.camera.x, 1, curves) - valueAt(scene.camera.x, 0, curves),
  });
  const ma = move(a);
  const mb = move(b);
  const camera = 1 - Math.min(1, (Math.abs(ma.scale - mb.scale) + Math.abs(ma.x - mb.x)) * 4);

  return (kinds + placement + camera) / 3;
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
