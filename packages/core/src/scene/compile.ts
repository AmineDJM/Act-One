import { z } from 'zod';
import { CameraSpec, SceneGraph, SceneHandover, Transform, type SceneObject } from './language.ts';
import type { Scene } from '../domain/storyboard.ts';

/**
 * The old vocabulary, compiled into the new one.
 *
 * Every existing storyboard names a `motionRecipe` and a `cameraRecipe`, and
 * the renderer has a branch for each name. Those branches are good work and
 * they are not going anywhere — but a name is a ceiling, and the point of the
 * scene language is that a director can compose a shot nobody wrote a branch
 * for.
 *
 * So a recipe becomes a MACRO: a function from a scene to a graph of
 * primitives. `product_zoom` stops being a thing the renderer knows a special
 * case for and becomes what it always was underneath — a capture, a crop, a
 * scale curve and a camera move. The film that used it renders the same; the
 * director who wanted it slightly different can now say so.
 *
 * MIGRATION, NOT REPLACEMENT. Everything here is one-way and additive: an old
 * `Scene` compiles to a `SceneGraph`, and nothing requires a storyboard to be
 * rewritten. A recipe with no macro yet compiles to its type and its camera,
 * which is a legible, renderable shot rather than a failure — and it records
 * which macro was missing so the gap is visible rather than silent.
 */

/** Objects laid out on the brand's own reading block, matching `Framed`. */
const READING_ZONE = { x: 0.04, y: 0.3, width: 0.66, height: 0.42 };

/**
 * The camera, carried across unchanged.
 *
 * The old `cameraRecipe` is already a from/to on scale and translation, which
 * is exactly an `Animatable` — so this is a rename rather than a
 * reinterpretation, and a film's camera behaves identically before and after.
 */
function cameraOf(scene: Scene): CameraSpec {
  const camera = scene.cameraRecipe;
  return CameraSpec.parse({
    x: { from: camera.fromX, to: camera.toX, curve: camera.easing },
    y: { from: camera.fromY, to: camera.toY, curve: camera.easing },
    scale: { from: camera.fromScale, to: camera.toScale, curve: camera.easing },
    depthOfField: camera.depthOfField,
    motionBlur: camera.motionBlur,
  });
}

/** The scene's copy as one payload text object, which most macros open with. */
function headline(scene: Scene, token: 'display' | 'statement'): SceneObject | null {
  const content = scene.onScreenText.join(' ').trim();
  if (!content) return null;
  return {
    kind: 'text',
    id: `${scene.id}_copy`,
    content,
    token,
    color: 'onCanvas.primary',
    align: 'left',
    maxWidth: 0.82,
    maxLines: 3,
    staggerSeconds: scene.motionRecipe.stagger,
    staggerBy: scene.motionRecipe.stagger > 0 ? 'word' : 'none',
    enterAt: scene.motionRecipe.delay,
    role: 'payload',
    reason: 'The line this beat was written around.',
    transform: Transform.parse({ x: 0.06, y: 0.5, anchor: { x: 0, y: 0.5 } }),
  } as SceneObject;
}

/** The scene's first capture as a product object. */
function capture(scene: Scene, over: Partial<Record<string, unknown>> = {}): SceneObject | null {
  const assetId = scene.assetRefs[0];
  if (!assetId) return null;
  return {
    kind: 'capture',
    id: `${scene.id}_product`,
    assetId,
    width: 0.78,
    chrome: false,
    shadow: true,
    cornerRadiusPx: 10,
    enterAt: scene.motionRecipe.delay,
    role: 'payload',
    reason: 'The real interface, which is what this beat is about.',
    transform: Transform.parse({
      x: 0.5,
      y: 0.5,
      scale: { from: 0.96, to: 1.0, curve: scene.motionRecipe.easing },
    }),
    ...over,
  } as SceneObject;
}

type Macro = (scene: Scene) => { objects: SceneObject[]; camera?: Partial<CameraSpec> };

/**
 * The macros, by the recipe name they replace.
 *
 * Deliberately a small set rather than all twenty-three. These are the ones
 * that carry real films today; the rest fall through to a legible default and
 * report themselves as unmigrated, which is a more honest position than a
 * hasty macro that renders something subtly different from what the branch
 * did.
 */
const MACROS: Partial<Record<Scene['motionRecipe']['name'], Macro>> = {
  kinetic_headline: (scene) => ({
    objects: [headline(scene, 'display')].filter(Boolean) as SceneObject[],
  }),
  editorial_headline: (scene) => ({
    objects: [headline(scene, 'display')].filter(Boolean) as SceneObject[],
  }),
  word_reveal: (scene) => ({
    objects: [headline(scene, 'statement')].filter(Boolean) as SceneObject[],
  }),
  hold: (scene) => ({ objects: [headline(scene, 'statement')].filter(Boolean) as SceneObject[] }),

  /*
   * A capture, pushed into.
   *
   * The whole of what the branch did, said in primitives: the product at the
   * centre, a scale curve on the object, and the camera doing the rest. A
   * director who wants the push to end on the left-hand third can now write
   * that, which the branch could never express.
   */
  product_zoom: (scene) => {
    const product = capture(scene, {
      transform: Transform.parse({
        x: 0.5,
        y: 0.5,
        scale: { from: 1.0, to: 1.08, curve: scene.motionRecipe.easing },
      }),
    });
    return {
      objects: product
        ? [product]
        : ([headline(scene, 'statement')].filter(Boolean) as SceneObject[]),
    };
  },

  product_window: (scene) => {
    const product = capture(scene, { chrome: true });
    return {
      objects: product
        ? [product]
        : ([headline(scene, 'statement')].filter(Boolean) as SceneObject[]),
    };
  },

  /** A figure and its line: the field is the sentence, the copy names it. */
  logo_reveal: (scene) => ({
    objects: [
      {
        kind: 'text',
        id: `${scene.id}_mark`,
        content: scene.onScreenText.join(' ').trim() || 'Act One',
        token: 'display',
        color: 'onCanvas.primary',
        align: 'center',
        maxWidth: 0.7,
        maxLines: 2,
        staggerBy: 'none',
        staggerSeconds: 0,
        enterAt: scene.motionRecipe.delay,
        role: 'payload',
        reason: 'The mark the film resolves onto.',
        transform: Transform.parse({
          x: 0.5,
          y: 0.5,
          opacity: { from: 0, to: 1, curve: 'out_quint' },
        }),
      } as SceneObject,
    ],
  }),
};

export type CompileResult = {
  scene: SceneGraph;
  /** Empty when a macro existed. Otherwise says what fell through and why. */
  warnings: string[];
};

/**
 * One old scene, as a scene graph.
 *
 * Total: every scene compiles to something renderable. A recipe with no macro
 * still gets its copy and its camera, because a beat that renders as its own
 * sentence is a beat, and a beat that renders as nothing is a hole.
 */
export function compileScene(scene: Scene): CompileResult {
  const warnings: string[] = [];
  const macro = MACROS[scene.motionRecipe.name];

  let objects: SceneObject[];
  if (macro) {
    objects = macro(scene).objects;
  } else {
    warnings.push(
      `No macro for "${scene.motionRecipe.name}" yet; compiled to its copy and camera. ` +
        `The original renderer branch still produces this scene — this graph is for inspection.`,
    );
    objects = [headline(scene, 'statement')].filter(Boolean) as SceneObject[];
  }

  /*
   * A field the old schema could only express as an opaque parameter.
   *
   * `motionRecipe.params.field` was a string the renderer read and nothing
   * else understood. As an object it has a count, a figure, a reason and a
   * clear zone, which means QA can finally ask whether it is competing with
   * the thing it is supposed to be supporting.
   */
  const figure = scene.motionRecipe.params['field'];
  if (typeof figure === 'string' && ['converge', 'disperse', 'settle', 'stream'].includes(figure)) {
    objects.push({
      kind: 'field',
      id: `${scene.id}_field`,
      figure: figure as 'converge' | 'disperse' | 'settle' | 'stream',
      count: Number(scene.motionRecipe.params['fieldCount'] ?? 12),
      member: 'card',
      memberSizePx: 60,
      color: 'onCanvas.muted',
      staggerSeconds: scene.motionRecipe.stagger || 0.07,
      clearZone: READING_ZONE,
      seed: scene.index + 1,
      enterAt: scene.motionRecipe.delay,
      role: 'atmosphere',
      reason: 'Carried over from the storyboard; the figure is the beat’s own sentence.',
      transform: Transform.parse({}),
    } as SceneObject);
  }

  const graph = SceneGraph.parse({
    id: scene.id,
    durationSeconds: scene.duration,
    intent: scene.purpose,
    camera: cameraOf(scene),
    objects,
    audio: scene.soundCues.map((cue) => ({
      // Storyboard cues are on the film's clock; a graph is on its own.
      at: Math.max(0, Number((cue.time - scene.startTime).toFixed(3))),
      kind:
        cue.type === 'music_in' || cue.type === 'music_out' || cue.type === 'silence'
          ? 'texture'
          : cue.type === 'music_duck'
            ? 'music_duck'
            : (cue.type as 'impact' | 'whoosh' | 'riser' | 'sub_drop' | 'ui_click' | 'logo_sting'),
      intensity: cue.intensity,
      reason: 'Carried over from the storyboard.',
    })),
    macro: scene.motionRecipe.name,
  });

  return { scene: graph, warnings };
}

/** A whole storyboard, for inspection, QA and eventual execution. */
export function compileStoryboard(scenes: readonly Scene[]): {
  scenes: SceneGraph[];
  warnings: string[];
} {
  const compiled = scenes.map((scene) => compileScene(scene));
  return {
    scenes: compiled.map((result) => result.scene),
    warnings: compiled.flatMap((result) => result.warnings),
  };
}

/** Recipes that have a macro, for anything that needs to know the migration's edge. */
export function migratedRecipes(): string[] {
  return Object.keys(MACROS).sort();
}

// ---------------------------------------------------------------------------
// Creative intent → scene graph
// ---------------------------------------------------------------------------

/**
 * What the Director decides, in the form the compiler can execute.
 *
 * The separation the architecture turns on. A Director reasons in prose and
 * should go on doing so — "the product should arrive like something landing"
 * is a real thought and a useful one. What it must not be is the last
 * representation before the renderer, because prose cannot be checked, cannot
 * be diffed, and cannot be asked where the headline is at 1.4 seconds.
 *
 * So intent carries BOTH. `note` is the sentence, kept as metadata and read by
 * people and by critics. Everything else is a decision with a value. A field
 * here that could only be satisfied by interpreting `note` would be a field in
 * the wrong place.
 */
export const CreativeIntent = z.object({
  id: z.string().min(1).max(64),
  /** The director's sentence. Metadata; never executed. */
  note: z.string().max(600).default(''),
  durationSeconds: z.number().min(0.3).max(120),

  /** What the beat is about, which decides what gets the payload role. */
  says: z.string().max(300).default(''),

  /**
   * The shape of the shot, as a decision rather than an adjective.
   *
   * `arrival` brings the subject in; `departure` takes it out and leaves the
   * space for the next idea; `hold` lets something be read; `travel` moves
   * through; `reveal` uncovers. Five, because a sixth would be a synonym.
   */
  gesture: z.enum(['arrival', 'departure', 'hold', 'travel', 'reveal']),

  /** How hard, 0 to 1. Drives camera amplitude and stagger, not a look. */
  energy: z.number().min(0).max(1).default(0.5),

  /** The line, when there is one. */
  copy: z.array(z.string().max(160)).max(4).default([]),
  /** The capture this beat is about, when it is about one. */
  captureAssetId: z.string().max(120).nullable().default(null),
  /** Regions of that capture to separate into depth, when the beat wants them. */
  regions: z
    .array(
      z.object({
        id: z.string().max(64),
        crop: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
        depth: z.number().min(-1).max(1).default(0),
        semantic: z.string().max(80).default(''),
      }),
    )
    .max(8)
    .default([]),

  /** How this beat hands over. */
  handover: SceneHandover.default(() => SceneHandover.parse({})),
});
export type CreativeIntent = z.infer<typeof CreativeIntent>;

/** Camera amplitudes by gesture and energy, calibrated rather than chosen. */
function cameraFor(intent: CreativeIntent): CameraSpec {
  /*
   * The floor is what a move has to exceed to be a move at all.
   *
   * Measured: a 1.06 scale over four seconds reads as a still frame, and Act
   * One's films sat at a mean optical flow of 0.037 against 0.80 to 1.08 in
   * the reference films largely because of it. 0.10 is the smallest amplitude
   * that was felt in a render; energy scales from there.
   */
  const amplitude = 0.1 + intent.energy * 0.12;
  const travel = 0.02 + intent.energy * 0.05;

  switch (intent.gesture) {
    case 'arrival':
      return CameraSpec.parse({
        scale: { from: 1 + amplitude, to: 1, curve: 'out_quint' },
        x: { from: travel, to: 0, curve: 'out_quint' },
        dollyZ: { from: 0, to: intent.energy * 0.4, curve: 'out_quint' },
        focalLengthMm: 34,
        depthOfField: intent.regions.length > 0 ? 0.3 : 0,
      });
    case 'departure':
      return CameraSpec.parse({
        scale: { from: 1, to: 1 + amplitude, curve: 'in_cubic' },
        x: { from: 0, to: -travel, curve: 'in_cubic' },
        focalLengthMm: 50,
      });
    case 'travel':
      return CameraSpec.parse({
        scale: { from: 1, to: 1 + amplitude * 0.6, curve: 'in_out_cubic' },
        x: { from: -travel, to: travel, curve: 'in_out_cubic' },
        dollyZ: { from: 0, to: intent.energy * 0.6, curve: 'in_out_cubic' },
        focalLengthMm: 28,
        depthOfField: 0.35,
      });
    case 'reveal':
      return CameraSpec.parse({
        scale: { from: 1 + amplitude * 1.4, to: 1, curve: 'out_expo' },
        dollyZ: { from: intent.energy * 0.5, to: 0, curve: 'out_expo' },
        focalLengthMm: { from: 24, to: 55, curve: 'out_expo' },
        depthOfField: { from: 0.5, to: 0.1, curve: 'out_expo' },
      });
    case 'hold':
    default:
      return CameraSpec.parse({
        scale: { from: 1, to: 1 + amplitude * 0.55, curve: 'in_out_quart' },
        focalLengthMm: 70,
      });
  }
}

/**
 * Compiles a Director's decisions into an executable shot.
 *
 * The only place prose is allowed to end and parameters have to begin. What
 * comes out can be routed, inspected, diffed and rendered; what went in can be
 * read by a person. Both matter, and keeping them in one object is what stops
 * the second quietly becoming the first.
 */
export function compileIntent(intent: CreativeIntent): CompileResult {
  const warnings: string[] = [];
  const objects: SceneObject[] = [];
  const copy = intent.copy.join(' ').trim();

  if (copy) {
    objects.push({
      kind: 'text',
      id: `${intent.id}_copy`,
      content: copy,
      token: intent.copy.length === 1 && copy.length < 40 ? 'display' : 'statement',
      color: 'onCanvas.primary',
      align: 'left',
      maxWidth: 0.62,
      maxLines: 3,
      // The stagger band measured across all four reference films.
      staggerSeconds: 0.04 + intent.energy * 0.08,
      staggerBy: 'word',
      enterAt: intent.gesture === 'reveal' ? intent.durationSeconds * 0.45 : 0.15,
      role: 'payload',
      reason: intent.says || 'The line this beat was written around.',
      transform: Transform.parse({ x: 0.08, y: 0.5, anchor: { x: 0, y: 0.5 } }),
    } as SceneObject);
  }

  /*
   * Regions before the whole, when the director asked for regions.
   *
   * A capture shown entire and a capture taken apart are different shots, and
   * only the second is cinematography. Where regions are named they replace
   * the whole capture rather than sitting on top of it — two of the same
   * pixels at two depths is a double exposure nobody asked for.
   */
  if (intent.captureAssetId && intent.regions.length > 0) {
    for (const [index, region] of intent.regions.entries()) {
      objects.push({
        kind: 'ui_layer',
        id: `${intent.id}_${region.id}`,
        assetId: intent.captureAssetId,
        crop: region.crop,
        semantic: region.semantic,
        width: 0.42,
        cornerRadiusPx: 8,
        shadow: true,
        enterAt: 0.2 + index * (0.06 + intent.energy * 0.06),
        role: 'support',
        reason: region.semantic
          ? `The ${region.semantic} of the real interface.`
          : 'A region of the real interface.',
        transform: Transform.parse({
          x: 0.62 + (index % 2 === 0 ? -0.08 : 0.08),
          y: 0.3 + index * 0.22,
          z: region.depth,
          scale: { from: 0.86, to: 1, curve: 'out_quint' },
          opacity: { from: 0, to: 1, curve: 'out_cubic' },
        }),
      } as SceneObject);
    }
  } else if (intent.captureAssetId) {
    objects.push({
      kind: 'capture',
      id: `${intent.id}_product`,
      assetId: intent.captureAssetId,
      width: 0.72,
      chrome: false,
      shadow: true,
      cornerRadiusPx: 10,
      enterAt: 0.1,
      role: 'payload',
      reason: intent.says || 'The real interface, which is what this beat is about.',
      transform: Transform.parse({
        x: 0.5,
        y: 0.5,
        scale: { from: 0.94, to: 1, curve: 'out_quint' },
      }),
    } as SceneObject);
  }

  if (objects.length === 0) {
    warnings.push(
      `Intent "${intent.id}" names neither copy nor a capture, so the beat has nothing in it. ` +
        `A gesture is how something happens, not a something.`,
    );
  }

  const scene = SceneGraph.parse({
    id: intent.id,
    durationSeconds: intent.durationSeconds,
    intent: intent.note,
    camera: cameraFor(intent),
    objects,
    handover: intent.handover,
    macro: null,
  });

  return { scene, warnings };
}
