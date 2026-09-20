import { z } from 'zod';
import { CONTINUOUS_HANDOVERS, Handover } from '../domain/grammar.ts';

/**
 * The Act One Scene Language.
 *
 * Until now a shot was chosen: the director picked `product_zoom` or
 * `kinetic_headline` from a list, and the renderer had a branch for each name.
 * That list is the ceiling. A motion designer asked to make eighty interface
 * cards collapse into a logo does not look for the template called
 * `cards_collapse_v2`; they compose it out of things that already exist —
 * layers, transforms, curves, masks, a camera, a hit on the bass.
 *
 * This is that vocabulary. A scene stops being a name and becomes a set of
 * OBJECTS with animatable PROPERTIES, a CAMERA, and AUDIO EVENTS on one clock.
 * Nothing here knows what a product tour is, and nothing here is a style: it
 * is the smallest set of primitives that lets a director say precisely what is
 * in the frame, where, at what depth, what changes, at exactly what time, and
 * along what curve.
 *
 * WHAT THIS IS NOT. It is not a clone of a compositing application. There is
 * no expression language, no effect stack, no nested precomps. Every addition
 * has had to earn itself against one test: can a director express a real shot
 * from a real reference film without it. The moment this grows an evaluator,
 * it has become a program the QA cannot read, and being readable BEFORE it
 * renders is half of why it exists.
 *
 * THE OLD RECIPES ARE NOT DELETED. They become macros that compile to this —
 * `product_zoom` is a capture layer with a crop, a scale curve, a camera move
 * and a mask, which is what it always was behind the branch. A storyboard
 * written against the old vocabulary keeps working, and the renderer gains a
 * second door rather than losing its first.
 */

// ---------------------------------------------------------------------------
// Time, curves and animatable values
// ---------------------------------------------------------------------------

/** Seconds from the start of the SCENE, not the film. */
export const SceneTime = z.number().min(0).max(120);

/**
 * The easing families, shared with the motion engine.
 *
 * Deliberately the same list the renderer implements rather than a superset:
 * a curve a director can name and the engine cannot draw is a promise the film
 * breaks silently.
 */
export const CurveName = z.enum([
  'linear',
  'out_quint',
  'out_cubic',
  'in_cubic',
  'in_out_cubic',
  'in_out_quart',
  'out_expo',
  'spring_soft',
  'spring_tight',
  'anticipate',
]);
export type CurveName = z.infer<typeof CurveName>;

/**
 * One point on a property's timeline.
 *
 * `t` is normalised 0..1 across the object's own active span rather than in
 * seconds, so a beat that gets half a second longer in the edit keeps its
 * shape instead of having its curve truncated.
 */
export const Keyframe = z.object({
  t: z.number().min(0).max(1),
  value: z.number(),
  /** The curve INTO this keyframe. The first keyframe's is ignored. */
  curve: CurveName.optional(),
});
export type Keyframe = z.infer<typeof Keyframe>;

/**
 * A number that may be constant, a simple from/to, or a full curve.
 *
 * Three shapes rather than one because most properties are constant and
 * writing `{ keyframes: [{t:0,value:1},{t:1,value:1}] }` for every one of them
 * makes a scene unreadable — and a scene a person cannot read is a scene
 * nobody will notice is wrong.
 */
export const Animatable = z.union([
  z.number(),
  z.object({ from: z.number(), to: z.number(), curve: CurveName.default('out_quint') }),
  z.object({ keyframes: z.array(Keyframe).min(2).max(24), curve: CurveName.default('out_quint') }),
]);
export type Animatable = z.infer<typeof Animatable>;

/** A colour that may change, expressed as brand tokens or literal hex. */
export const AnimatableColor = z.union([
  z.string().max(40),
  z.object({
    from: z.string().max(40),
    to: z.string().max(40),
    curve: CurveName.default('linear'),
  }),
]);

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

/**
 * Where a thing is and how it is oriented.
 *
 * Positions are FRACTIONS of the frame, never pixels: the same scene has to
 * render at 960x540 for a preview and 3840x2160 for a master, and a shot
 * composed in pixels is a shot that only works at one size. `z` is depth in
 * arbitrary units where positive is further away, used for parallax and for
 * ordering — it is 2.5D, and it is honest about that.
 */
export const Transform = z.object({
  x: Animatable.default(0.5),
  y: Animatable.default(0.5),
  z: Animatable.default(0),
  scale: Animatable.default(1),
  rotationX: Animatable.default(0),
  rotationY: Animatable.default(0),
  rotationZ: Animatable.default(0),
  opacity: Animatable.default(1),
  blurPx: Animatable.default(0),
  /** Where the transform is applied from, as fractions of the object. */
  anchor: z
    .object({ x: z.number().default(0.5), y: z.number().default(0.5) })
    .default({ x: 0.5, y: 0.5 }),
});
export type Transform = z.infer<typeof Transform>;

/** A rectangular region of a source, as fractions of it. */
export const Crop = z.object({
  x: z.number().min(0).max(1).default(0),
  y: z.number().min(0).max(1).default(0),
  width: z.number().min(0.01).max(1).default(1),
  height: z.number().min(0.01).max(1).default(1),
});

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

/**
 * Everything an object has in common.
 *
 * `enterAt` and `exitAt` are the object's own span; its curves are normalised
 * across that span. `role` is the one piece of creative metadata kept on the
 * object itself, because QA needs to know which thing in the frame is supposed
 * to be read and which is atmosphere — a check that cannot tell the headline
 * from the background cannot enforce a reading time.
 */
const objectBase = {
  id: z.string().min(1).max(64),
  enterAt: SceneTime.default(0),
  exitAt: SceneTime.optional(),
  transform: Transform.default(() => Transform.parse({})),
  /**
   * What this object is FOR, which is what makes a check possible.
   *
   * `payload` is what the beat is about and must be readable. `support`
   * qualifies it. `atmosphere` is the world it sits in and may be freely
   * moved. `structure` is rules, grids and frames.
   */
  role: z.enum(['payload', 'support', 'atmosphere', 'structure']).default('support'),
  /**
   * Why this object is on screen, in the director's words.
   *
   * Required for anything that moves and is not atmosphere. This is the
   * guard-rail against decoration: a critic watching an early cut of a film
   * made with this system said its moving shapes "read as a generic template"
   * and were "entirely disconnected from the narrative", and every one of them
   * would have failed to answer this field honestly.
   */
  reason: z.string().max(240).default(''),
};

export const TextObject = z.object({
  ...objectBase,
  kind: z.literal('text'),
  content: z.string().max(400),
  /** A brand type token, resolved by the renderer against the design system. */
  token: z.enum(['display', 'statement', 'body', 'caption', 'mono']).default('statement'),
  color: AnimatableColor.default('onCanvas.primary'),
  align: z.enum(['left', 'center', 'right']).default('left'),
  maxWidth: z.number().min(0.1).max(1).default(0.8),
  maxLines: z.number().int().min(1).max(8).default(3),
  /** Per-word or per-line entrance, in seconds. Zero is one block. */
  staggerSeconds: z.number().min(0).max(1).default(0),
  staggerBy: z.enum(['word', 'line', 'none']).default('none'),
  tracking: Animatable.optional(),
});

export const ShapeObject = z.object({
  ...objectBase,
  kind: z.literal('shape'),
  shape: z.enum(['rect', 'ellipse', 'line', 'path']),
  /** SVG path data, only for `path`. */
  d: z.string().max(4000).optional(),
  width: Animatable.default(0.1),
  height: Animatable.default(0.1),
  fill: AnimatableColor.default('transparent'),
  stroke: AnimatableColor.default('onCanvas.muted'),
  strokeWidthPx: Animatable.default(2),
  cornerRadiusPx: Animatable.default(0),
});

/**
 * A real capture of the customer's real interface.
 *
 * Kept as its own kind rather than folded into `image` because the product
 * rule depends on telling them apart: a generated picture may be anything, and
 * a picture claiming to be the customer's software may only ever be a real
 * capture. QA reads `kind` to enforce that, so collapsing the two would
 * quietly delete the rule.
 */
export const CaptureObject = z.object({
  ...objectBase,
  kind: z.literal('capture'),
  assetId: z.string().min(1).max(120),
  crop: Crop.default(() => Crop.parse({})),
  width: Animatable.default(0.6),
  /** Whether the capture is shown with its own browser/window chrome. */
  chrome: z.boolean().default(false),
  cornerRadiusPx: Animatable.default(0),
  shadow: z.boolean().default(true),
});

/**
 * One semantic region of a capture, placed independently.
 *
 * This is what makes a screenshot stop being a picture and start being a set
 * of objects: a header, a row, a panel, each cropped from the real capture at
 * real resolution and given its own depth and trajectory. The pixels are still
 * the customer's real interface — nothing is redrawn — but the film can move
 * through it rather than across it.
 */
export const UiLayerObject = z.object({
  ...objectBase,
  kind: z.literal('ui_layer'),
  assetId: z.string().min(1).max(120),
  crop: Crop,
  /** What this region is, from the capture's scene graph. */
  semantic: z.string().max(80).default(''),
  width: Animatable.default(0.4),
  cornerRadiusPx: Animatable.default(0),
  shadow: z.boolean().default(true),
});

export const ImageObject = z.object({
  ...objectBase,
  kind: z.literal('image'),
  assetId: z.string().min(1).max(120),
  crop: Crop.default(() => Crop.parse({})),
  width: Animatable.default(0.6),
  /** True when a model made this. Never true for anything claiming to be the product. */
  generated: z.boolean().default(false),
});

export const ClipObject = z.object({
  ...objectBase,
  kind: z.literal('clip'),
  assetId: z.string().min(1).max(120),
  crop: Crop.default(() => Crop.parse({})),
  width: Animatable.default(1),
  /** Where in the source the clip starts, in seconds. */
  sourceInSeconds: z.number().min(0).max(600).default(0),
  playbackRate: z.number().min(0.1).max(4).default(1),
  generated: z.boolean().default(false),
});

export const GradientObject = z.object({
  ...objectBase,
  kind: z.literal('gradient'),
  from: AnimatableColor,
  to: AnimatableColor,
  angleDeg: Animatable.default(180),
});

/**
 * A mask applied to other objects by id.
 *
 * Referential rather than nested. A mask that owns its children forces the
 * whole graph into a tree, and the shots that need masking most — a reveal
 * that wipes across two layers at different depths — are exactly the ones that
 * do not nest cleanly.
 */
export const MaskObject = z.object({
  ...objectBase,
  kind: z.literal('mask'),
  masks: z.array(z.string().max(64)).min(1).max(40),
  shape: z.enum(['rect', 'ellipse', 'path']).default('rect'),
  d: z.string().max(4000).optional(),
  width: Animatable.default(0.5),
  height: Animatable.default(0.5),
  /** Invert to cut a hole rather than to reveal through one. */
  invert: z.boolean().default(false),
  featherPx: Animatable.default(0),
});

/**
 * A field of many like objects, generated rather than listed.
 *
 * Eighty cards written out as eighty objects is a scene nobody can read and a
 * diff nobody can review. The figure says what the group DOES — which is also
 * what makes it legitimate, because a field whose figure is not the sentence
 * of the beat is decoration.
 */
export const FieldObject = z.object({
  ...objectBase,
  kind: z.literal('field'),
  figure: z.enum(['converge', 'disperse', 'settle', 'stream', 'orbit']),
  count: z.number().int().min(2).max(120),
  /** What each member is. Only the simple kinds, deliberately. */
  member: z.enum(['card', 'disc', 'rule']).default('card'),
  memberSizePx: z.number().min(2).max(600).default(60),
  color: AnimatableColor.default('onCanvas.muted'),
  staggerSeconds: z.number().min(0).max(1).default(0.07),
  /** The region the field must stay out of, so the payload stays readable. */
  clearZone: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .optional(),
  seed: z.number().int().min(0).max(1_000_000).default(1),
});

/** A 3D scene, executed by the geometry renderer rather than the browser. */
export const ThreeDObject = z.object({
  ...objectBase,
  kind: z.literal('three_d'),
  sceneId: z.string().min(1).max(120),
  width: Animatable.default(1),
});

export const SceneObject = z.discriminatedUnion('kind', [
  TextObject,
  ShapeObject,
  CaptureObject,
  UiLayerObject,
  ImageObject,
  ClipObject,
  GradientObject,
  MaskObject,
  FieldObject,
  ThreeDObject,
]);
export type SceneObject = z.infer<typeof SceneObject>;
export type SceneObjectKind = SceneObject['kind'];

// ---------------------------------------------------------------------------
// Camera, audio, and the graph itself
// ---------------------------------------------------------------------------

/**
 * The camera over the whole frame.
 *
 * Kept separate from the objects because it is the one thing that moves
 * everything at once, and because the distinction between the frame moving and
 * the contents moving is the distinction a film is read by. `focalLength` and
 * `dollyZ` are honest 2.5D approximations rather than a physical camera: a
 * longer lens flattens the parallax between depths and a dolly changes it,
 * which is the part that reads on screen.
 */
export const CameraSpec = z.object({
  x: Animatable.default(0),
  y: Animatable.default(0),
  scale: Animatable.default(1),
  rotationZ: Animatable.default(0),
  /** Millimetres, 18 to 200. Drives how strongly `z` separates layers. */
  focalLengthMm: z.number().min(18).max(200).default(50),
  dollyZ: Animatable.default(0),
  /** 0 is everything sharp; 1 throws everything off the focal plane away. */
  depthOfField: z.number().min(0).max(1).default(0),
  focusZ: Animatable.default(0),
  motionBlur: z.number().min(0).max(1).default(0.2),
});
export type CameraSpec = z.infer<typeof CameraSpec>;

/**
 * A sound, on the scene's clock, tied to what causes it.
 *
 * `causedBy` is the object id whose arrival or departure the sound belongs to.
 * It is what lets a check ask whether a mark lands on something happening, and
 * what lets the edit move a beat without orphaning its sound.
 */
export const SceneAudioEvent = z.object({
  at: SceneTime,
  kind: z.enum([
    'impact',
    'whoosh',
    'riser',
    'sub_drop',
    'ui_click',
    'ui_confirm',
    'logo_sting',
    'texture',
    'music_duck',
  ]),
  intensity: z.number().min(0).max(1).default(0.6),
  causedBy: z.string().max(64).optional(),
  reason: z.string().max(240).default(''),
});
export type SceneAudioEvent = z.infer<typeof SceneAudioEvent>;

/**
 * How this scene hands over to the next.
 *
 * A boundary is an editorial decision, and the question it answers is why B
 * follows A rather than which effect to apply. `carries` names the objects
 * that survive the cut, which is what makes a transformation a transformation
 * rather than a dissolve.
 */
export const SceneHandover = z.object({
  /**
   * The mechanism, from the vocabulary measured in the reference films.
   *
   * Reusing `Handover` from the grammar module rather than declaring a second
   * list, because there already was one and it had no consumers: the four
   * films were measured, the six continuous mechanisms were written down, and
   * nothing in the system could express them. A boundary in a scene graph is
   * the first place that vocabulary has somewhere to live.
   *
   * `fade` and `sound_bridge` are additions the grammar does not name — the
   * first because it is what a film does when it has nothing better, the
   * second because sound can carry a cut the picture does not.
   */
  mechanism: z.union([Handover, z.enum(['fade', 'sound_bridge', 'match_move'])]).default('cut'),
  /** Object ids that continue into the next scene. */
  carries: z.array(z.string().max(64)).max(12).default([]),
  durationSeconds: z.number().min(0).max(3).default(0),
  reason: z.string().max(240).default(''),
});
export type SceneHandover = z.infer<typeof SceneHandover>;

/** Whether this boundary is one the picture flows through. */
export function isContinuous(handover: SceneHandover): boolean {
  return (CONTINUOUS_HANDOVERS as readonly string[]).includes(handover.mechanism);
}

/**
 * One shot, fully specified.
 *
 * This is what the Creative Director compiles to and what the renderer and QA
 * both read. Prose survives in `intent` as metadata, deliberately: it is how a
 * person understands what was meant, and it is never what the renderer
 * depends on.
 */
export const SceneGraph = z.object({
  id: z.string().min(1).max(64),
  durationSeconds: z.number().min(0.3).max(120),
  /** The director's sentence. Metadata for people and critics; never executed. */
  intent: z.string().max(600).default(''),
  background: z.union([AnimatableColor, z.literal('canvas')]).default('canvas'),
  camera: CameraSpec.default(() => CameraSpec.parse({})),
  objects: z.array(SceneObject).max(200).default([]),
  audio: z.array(SceneAudioEvent).max(40).default([]),
  handover: SceneHandover.default(() => SceneHandover.parse({})),
  /**
   * The macro this was compiled from, when it was compiled from one.
   *
   * Kept so a scene that came out of `product_zoom` can still be recognised as
   * one — by a person reading it, by a check counting how often a film reaches
   * for the same device, and by anything that needs to migrate it again later.
   */
  macro: z.string().max(64).nullable().default(null),
});
export type SceneGraph = z.infer<typeof SceneGraph>;

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** The easing implementations live in the motion package; this is the shape. */
export type CurveFn = (t: number) => number;

/**
 * A property's value at a moment, given the object's own span.
 *
 * Pure and dependency-free so QA can walk a scene's whole timeline without a
 * browser: every structural check that matters — is anything readable, does
 * anything move faster than the eye can follow, do two payloads compete — is a
 * question about values over time, and being able to ask it before rendering
 * is the point of having a representation at all.
 */
export function valueAt(
  property: Animatable,
  t: number,
  curves: Record<CurveName, CurveFn>,
): number {
  if (typeof property === 'number') return property;
  const clamped = Math.max(0, Math.min(1, t));

  if ('from' in property) {
    const eased = curves[property.curve]?.(clamped) ?? clamped;
    return property.from + (property.to - property.from) * eased;
  }

  const frames = [...property.keyframes].sort((a, b) => a.t - b.t);
  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  if (clamped <= first.t) return first.value;
  if (clamped >= last.t) return last.value;

  for (let i = 0; i < frames.length - 1; i += 1) {
    const a = frames[i]!;
    const b = frames[i + 1]!;
    if (clamped >= a.t && clamped <= b.t) {
      const span = b.t - a.t;
      const local = span <= 0 ? 1 : (clamped - a.t) / span;
      const curve = b.curve ?? property.curve;
      const eased = curves[curve]?.(local) ?? local;
      return a.value + (b.value - a.value) * eased;
    }
  }
  return last.value;
}

/** The fraction of an object's own life elapsed at a scene time. */
export function objectProgress(
  object: SceneObject,
  sceneSeconds: number,
  sceneDuration: number,
): number {
  const enter = object.enterAt;
  const exit = object.exitAt ?? sceneDuration;
  const span = Math.max(0.0001, exit - enter);
  return Math.max(0, Math.min(1, (sceneSeconds - enter) / span));
}

/** Whether an object is on screen at a scene time. */
export function objectPresent(
  object: SceneObject,
  sceneSeconds: number,
  sceneDuration: number,
): boolean {
  const exit = object.exitAt ?? sceneDuration;
  return sceneSeconds >= object.enterAt && sceneSeconds <= exit;
}
