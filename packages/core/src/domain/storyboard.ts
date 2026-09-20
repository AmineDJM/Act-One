import { z } from 'zod';
import { nonEmpty, score01 } from '../zod-helpers.ts';
import { VoiceStrategy } from './creative.ts';
import { UiSequence } from './ui-cinema.ts';

export const VisualType = z.enum([
  'kinetic_typography',
  'product_ui',
  'product_ui_3d',
  'screenshot_motion',
  'generated_broll',
  'real_media',
  'statistic',
  'quote',
  'logo_reveal',
  'transition',
  'cinematic_3d',
  'mixed_media',
]);
export type VisualType = z.infer<typeof VisualType>;

/** Visual types that must be backed by genuine product capture — never generated. */
export const REAL_PRODUCT_VISUAL_TYPES: readonly VisualType[] = [
  'product_ui',
  'product_ui_3d',
  'screenshot_motion',
] as const;

/**
 * Showing the product, and being led by it, are two different things.
 *
 * `product_ui` is the live interface being driven: a cursor crossing it, a
 * sequence playing through it, a panel opening. That is what a tour is made
 * of — the film's argument is carried by watching the thing work.
 *
 * The other two are the product *seen*: a capture staged flat and moved
 * through, or staged in space as an object. They are a glimpse, the way a
 * brand film cuts to the thing it has been talking about, and a film can use
 * one without becoming a demonstration.
 *
 * The split exists because "a pitch shows no interface" turned out to be the
 * wrong rule. Plenty of pitch films are better for one shot of the real thing;
 * what ruins them is being *structured* around it.
 */
export const PRODUCT_NAVIGATION_VISUAL_TYPES: readonly VisualType[] = ['product_ui'] as const;

export const PRODUCT_GLIMPSE_VISUAL_TYPES: readonly VisualType[] = [
  'screenshot_motion',
  'product_ui_3d',
] as const;

/** Whether this shot is the interface being driven rather than merely seen. */
export function navigatesTheProduct(visualType: VisualType): boolean {
  return PRODUCT_NAVIGATION_VISUAL_TYPES.includes(visualType);
}

/** Whether this shot puts the product on screen at all, driven or not. */
export function showsTheProduct(visualType: VisualType): boolean {
  return REAL_PRODUCT_VISUAL_TYPES.includes(visualType);
}

/**
 * Visual types that draw themselves and need nothing handed to them.
 *
 * A logo reveal composes the brand lockup, and a transition is a deliberate
 * pause. Every other type is a container for something — words, a capture, a
 * generated shot — and is an empty frame without it.
 */
export const SELF_CONTAINED_VISUAL_TYPES: readonly VisualType[] = [
  'logo_reveal',
  'transition',
  /*
   * And a cinematic 3D shot, which is form and light rather than a container.
   * It is built in Blender from the brand — a surface, a rim, a lens — and
   * needs nothing handed to it. Leaving it out of this list meant every such
   * scene written without a line of copy was dropped from the storyboard
   * before anything had a chance to render it, which made the whole technique
   * unreachable in a film carrying no on-screen text.
   */
  'cinematic_3d',
] as const;

/**
 * Does this scene put anything on screen?
 *
 * The question sounds too obvious to need asking, which is exactly why nothing
 * asked it: three scenes of a twenty-four second film rendered as pure black
 * and the film passed every check it had. A typographic scene with no type is
 * not a minimal scene, it is a hole in the edit.
 *
 * The repair loop makes this worse rather than better — `rewrite_copy` strips
 * a scene's text to remove an unsupported claim, which fixes the claim and
 * leaves a blank frame behind it.
 */
export function sceneShowsSomething(scene: {
  visualType: VisualType;
  onScreenText: readonly string[];
  assetRefs: readonly string[];
  generativeNeeds?: readonly unknown[];
}): boolean {
  if (SELF_CONTAINED_VISUAL_TYPES.includes(scene.visualType)) return true;
  if (scene.onScreenText.some((line) => line.trim().length > 0)) return true;
  if (scene.assetRefs.length > 0) return true;
  return (scene.generativeNeeds?.length ?? 0) > 0;
}

/**
 * When to grab the frame that represents a film.
 *
 * The poster is the first thing a customer sees of their own launch film, and
 * it used to be taken at a fixed 1.5 seconds — which lands inside the opening
 * scene's animation, so the frame showed type still arriving and a counter
 * still counting. It looked like a page that had not finished loading.
 *
 * Instead: the first scene that actually has something composed on it, sixty
 * percent of the way through, where the motion has settled and the frame has
 * not started dissolving out. The same point vision QA inspects, for the same
 * reason.
 */
export function posterMoment(scenes: readonly Scene[]): number {
  const settled = (scene: Scene) => scene.startTime + scene.duration * 0.6;

  const withCopy = scenes.find(
    (scene) => scene.onScreenText.some((line) => line.trim().length > 0) && scene.duration >= 1,
  );
  if (withCopy) return settled(withCopy);

  const shown = scenes.find((scene) => scene.assetRefs.length > 0 && scene.duration >= 1);
  if (shown) return settled(shown);

  const first = scenes[0];
  return first ? settled(first) : 0;
}

export const MotionRecipeName = z.enum([
  'word_reveal',
  'editorial_headline',
  'kinetic_headline',
  'mask_reveal',
  'product_window',
  'product_zoom',
  'floating_ui',
  'spatial_cards',
  'split_screen',
  'statistic_reveal',
  'metric_reveal',
  'quote_hold',
  'product_sequence',
  'cursor_sequence',
  'logo_reveal',
  'cta_end_card',
  'image_wall',
  'depth_transition',
  'feature_stack',
  'window_explosion',
  'command_bar_collapse',
  'photo_hold',
  /* Moving footage: a generated shot or a 3D render, played rather than shown. */
  'footage',
  'hard_cut',
  'hold',
]);
export type MotionRecipeName = z.infer<typeof MotionRecipeName>;

/**
 * Which motion recipes a visual type can actually drive.
 *
 * A recipe is not decoration on top of a scene, it *is* the scene: at render
 * time `cursor_sequence` needs a captured frame to move a cursor across, and
 * `statistic_reveal` needs a figure in the first line of on-screen text. Pair a
 * recipe with a visual type that cannot feed it and the renderer has nothing to
 * draw — which is how a scene ends up as flat brand colour for four seconds.
 *
 * The first entry is the default for that type; the rest are the alternatives a
 * film can rotate through so twenty typographic scenes are not twenty identical
 * typographic scenes.
 */
export const RECIPES_FOR_VISUAL: Record<VisualType, readonly MotionRecipeName[]> = {
  kinetic_typography: ['kinetic_headline', 'editorial_headline', 'word_reveal', 'mask_reveal'],
  statistic: ['statistic_reveal', 'metric_reveal'],
  quote: ['quote_hold'],
  logo_reveal: ['logo_reveal', 'cta_end_card'],
  transition: ['depth_transition', 'hard_cut', 'hold'],
  product_ui: ['product_window', 'product_sequence', 'floating_ui', 'feature_stack', 'cursor_sequence'],
  product_ui_3d: ['footage', 'product_window', 'spatial_cards', 'window_explosion'],
  screenshot_motion: ['product_zoom', 'product_window', 'image_wall'],
  real_media: ['photo_hold', 'image_wall', 'spatial_cards'],
  /*
   * Footage first, for the two types that produce it.
   *
   * These used to route to `image_wall`, which draws its assets in an image
   * tag: a generated shot was commissioned, paid for, stored and then handed
   * to a component that cannot play it, so the scene fell back to type and
   * nobody ever saw the shot. The engine's own techniques for texture are the
   * whole reason a film reads as made rather than assembled.
   */
  cinematic_3d: ['footage', 'depth_transition', 'spatial_cards'],
  generated_broll: ['footage', 'image_wall', 'hold'],
  mixed_media: ['footage', 'window_explosion', 'split_screen', 'spatial_cards'],
};

/** True when a recipe can be rendered by the visual type carrying it. */
export function recipeSuitsVisual(recipe: MotionRecipeName, visualType: VisualType): boolean {
  return RECIPES_FOR_VISUAL[visualType].includes(recipe);
}

/**
 * A recipe the visual type can render, keeping the preferred one when it is
 * already valid and otherwise stepping away from `avoid` so consecutive scenes
 * do not share a treatment.
 */
export function coherentRecipe(
  visualType: VisualType,
  preferred: MotionRecipeName,
  avoid: MotionRecipeName | null = null,
): MotionRecipeName {
  const options = RECIPES_FOR_VISUAL[visualType];
  if (options.includes(preferred) && preferred !== avoid) return preferred;
  return options.find((option) => option !== avoid) ?? options[0]!;
}

/**
 * Recipes whose composition is driven by the camera.
 *
 * The renderer hands `cameraRecipe` to these and to nothing else: a push on a
 * `hold` or a `word_reveal` is stored, and ignored. Which matters to QA rather
 * than to the picture — a repair that gives recovered seconds to a shot it
 * believes is moving, on the strength of a field the renderer never reads,
 * manufactures the held frame it was trying to remove. The real render caught
 * exactly that; `film-motion.test.ts` keeps this list honest against it.
 */
export const CAMERA_DRIVEN_RECIPES: readonly MotionRecipeName[] = [
  'product_window',
  'product_sequence',
  'floating_ui',
  'feature_stack',
  'footage',
  'photo_hold',
  'depth_transition',
];

/**
 * Recipes that need material handed to them, and draw type when it is missing.
 *
 * The renderer is built to degrade rather than fail: a shot whose capture or
 * footage does not resolve falls back to the scene's line of copy on the brand
 * canvas, which is the right call — four seconds of brand-coloured nothing is
 * worse than four seconds of the sentence the beat was written around.
 *
 * What was wrong is that it happened in silence. `assetUrls` was resolved,
 * handed to the composition, and nobody compared it to what the plan asked
 * for; so a film whose every capture had gone missing rendered as a deck of
 * title cards and reported a clean pass, because the storyboard it was checked
 * against still said "product_ui" for every one of them.
 *
 * `film-motion.test.ts` reads the renderer's own switch for `typeFallback()`
 * and checks this list still matches it, because a list copied from a switch
 * is a list that drifts from it.
 */
export const MATERIAL_BACKED_RECIPES: readonly MotionRecipeName[] = [
  'product_window',
  'product_sequence',
  'floating_ui',
  'feature_stack',
  'product_zoom',
  'footage',
  'photo_hold',
  'spatial_cards',
  'image_wall',
  'cursor_sequence',
  'depth_transition',
];

/**
 * Shots that will render as type because their material is not there.
 *
 * Takes what the renderer will actually be given rather than what the
 * storyboard hoped for: `available` is the set of asset ids that resolved to a
 * url. A scene with several references needs only one to survive, because a
 * shot plays one thing.
 */
export function degradedShots(
  storyboard: Storyboard,
  available: ReadonlySet<string>,
): { scene: Scene; wanted: number }[] {
  return storyboard.scenes
    .filter((scene) => MATERIAL_BACKED_RECIPES.includes(scene.motionRecipe.name))
    .filter((scene) => !scene.assetRefs.some((id) => available.has(id)))
    .map((scene) => ({ scene, wanted: scene.assetRefs.length }));
}

/**
 * Whether a shot is in motion for its whole length.
 *
 * True of real footage, which plays; and of a camera-driven composition whose
 * camera is actually travelling. Everything else arrives, settles and holds —
 * which is not a fault, and is the reason those shots cannot be given more
 * time than their own content earns.
 */
export function movesThroughout(scene: Pick<Scene, 'motionRecipe' | 'cameraRecipe'>): boolean {
  if (scene.motionRecipe.name === 'footage') return true;
  return (
    CAMERA_DRIVEN_RECIPES.includes(scene.motionRecipe.name) && scene.cameraRecipe.move !== 'static'
  );
}

export const EasingName = z.enum([
  'linear',
  'out_quint',        // the workhorse for confident UI motion
  'in_out_quart',
  'out_expo',
  'spring_soft',
  'spring_tight',
  'anticipate',
]);
export type EasingName = z.infer<typeof EasingName>;

export const MotionRecipe = z.object({
  name: MotionRecipeName,
  easing: EasingName.default('out_quint'),
  /** Seconds before motion starts, relative to scene start. */
  delay: z.number().min(0).max(10).default(0),
  /** Stagger between child elements, seconds. */
  stagger: z.number().min(0).max(1).default(0.06),
  intensity: score01.default(0.6),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type MotionRecipe = z.infer<typeof MotionRecipe>;

export const CameraMove = z.enum([
  'static',
  'slow_push',
  'slow_pull',
  'lateral_drift',
  'orbit',
  'rack_focus',
  'handheld_micro',
  'crop_push',
]);
export type CameraMove = z.infer<typeof CameraMove>;

export const CameraRecipe = z.object({
  move: CameraMove.default('static'),
  /** Start and end scale. 1 = frame-filling. */
  fromScale: z.number().min(0.4).max(3).default(1),
  toScale: z.number().min(0.4).max(3).default(1),
  fromX: z.number().min(-1).max(1).default(0),
  toX: z.number().min(-1).max(1).default(0),
  fromY: z.number().min(-1).max(1).default(0),
  toY: z.number().min(-1).max(1).default(0),
  /** Subtle blur sells motion; too much reads as a cheap filter. Capped low. */
  motionBlur: z.number().min(0).max(0.5).default(0.12),
  depthOfField: z.number().min(0).max(1).default(0),
  easing: EasingName.default('in_out_quart'),
});
export type CameraRecipe = z.infer<typeof CameraRecipe>;

export const SoundCueType = z.enum([
  'music_in',
  'music_out',
  'music_duck',
  'impact',
  'riser',
  'sub_drop',
  'ui_click',
  'whoosh',
  'texture',
  'silence',
  'logo_sting',
]);
export type SoundCueType = z.infer<typeof SoundCueType>;

export const SoundCue = z.object({
  /** Seconds from the start of the film. */
  time: z.number().min(0),
  type: SoundCueType,
  assetId: z.string().nullable().default(null),
  intensity: score01.default(0.6),
  durationSeconds: z.number().min(0).max(120).nullable().default(null),
});
export type SoundCue = z.infer<typeof SoundCue>;

export const GenerativeNeed = z.object({
  kind: z.enum(['image', 'video', 'image_to_video', 'edit']),
  /** Written as a shot brief, not a prompt-stuffing incantation. */
  brief: nonEmpty(1200),
  /** Absolutely no readable text: generative models cannot set type. */
  mustNotContainText: z.boolean().default(true),
  referenceAssetIds: z.array(z.string()).default([]),
  durationSeconds: z.number().min(0.5).max(20).default(4),
  aspect: z.enum(['16:9', '9:16', '1:1', '4:5']).default('16:9'),
  /** Filled by the routing layer; never chosen by the LLM. */
  resolvedProvider: z.string().nullable().default(null),
  resolvedModel: z.string().nullable().default(null),
  estimatedCostUsd: z.number().min(0).default(0),
});
export type GenerativeNeed = z.infer<typeof GenerativeNeed>;

export const SceneStatus = z.enum([
  'draft',
  'ready',
  'assets_pending',
  'rendering',
  'rendered',
  'failed',
  'needs_repair',
]);
export type SceneStatus = z.infer<typeof SceneStatus>;

export const Scene = z.object({
  id: z.string(),
  storyboardId: z.string(),
  index: z.number().int().min(0),
  /** Seconds from film start. Derived; kept denormalised for the timeline UI. */
  startTime: z.number().min(0),
  duration: z.number().min(0.3).max(30),
  /** Why this scene exists. If you cannot write this, cut the scene. */
  purpose: nonEmpty(300),
  narration: z.string().max(600).default(''),
  onScreenText: z.array(z.string().max(160)).default([]),
  visualType: VisualType,
  /** Asset ids: product captures, logos, generated shots, 3D renders. */
  assetRefs: z.array(z.string()).default([]),
  /** Moment ids this scene films, if any. */
  momentIds: z.array(z.string()).default([]),
  motionRecipe: MotionRecipe,
  cameraRecipe: CameraRecipe,
  /*
   * How this scene's capture is filmed.
   *
   * Written by production, not by the director: the framings depend on what
   * is actually in the pixels and on how many of them there are, neither of
   * which anyone writing a storyboard can know. Null means the scene has not
   * been filmed — either it shows no product capture, or production has not
   * reached it yet. It never means the scene chose to be a flat screenshot,
   * and the notes on the sequence say where the plan fell short so that an
   * absence is never read back as a decision.
   */
  uiSequence: UiSequence.nullable().default(null),
  soundCues: z.array(SoundCue).default([]),
  voiceOver: z.boolean().default(false),
  generativeNeeds: z.array(GenerativeNeed).default([]),
  threeDSceneId: z.string().nullable().default(null),
  status: SceneStatus.default('draft'),
  /** Set when a claim in this scene is traceable. Used by the fact checker. */
  claimEvidenceIds: z.array(z.string()).default([]),
  notes: z.string().max(1000).default(''),
  estimatedCostUsd: z.number().min(0).default(0),
});
export type Scene = z.infer<typeof Scene>;

export const StoryboardStatus = z.enum([
  'draft',
  'awaiting_approval',
  'approved',
  'superseded',
]);
export type StoryboardStatus = z.infer<typeof StoryboardStatus>;

export const Storyboard = z.object({
  id: z.string(),
  projectId: z.string(),
  conceptId: z.string(),
  treatmentId: z.string(),
  version: z.number().int().min(1).default(1),
  scenes: z.array(Scene).default([]),
  voiceStrategy: VoiceStrategy.default('none'),
  /** ISO 639-1 code the copy and narration were written in; the voice follows it. */
  language: z.string().min(2).max(12).nullable().default(null),
  musicDirection: z.string().max(600).default(''),
  status: StoryboardStatus.default('draft'),
  /*
   * Lineage.
   *
   * A creative replan writes a new storyboard rather than editing the one the
   * customer approved, so the previous accepted creative state survives and an
   * operator can see what changed and why. Null on a storyboard that was
   * written rather than revised.
   */
  parentStoryboardId: z.string().nullable().default(null),
  revisionReason: z.string().max(600).default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Storyboard = z.infer<typeof Storyboard>;

export function storyboardDuration(storyboard: Storyboard): number {
  return round3(storyboard.scenes.reduce((total, scene) => total + scene.duration, 0));
}

/**
 * Recomputes scene indices and start times after any structural edit.
 * Every mutation path (reorder, delete, duplicate, retime) funnels through here
 * so the timeline can never drift out of sync with the render.
 */
export function resequence(storyboard: Storyboard): Storyboard {
  let cursor = 0;
  const scenes = storyboard.scenes.map((scene, index) => {
    const next = { ...scene, index, startTime: round3(cursor) };
    cursor += scene.duration;
    return next;
  });
  return { ...storyboard, scenes };
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Total estimated spend for a storyboard, used for the pre-render cost gate. */
export function storyboardEstimatedCost(storyboard: Storyboard): number {
  return storyboard.scenes.reduce(
    (total, scene) =>
      total +
      scene.estimatedCostUsd +
      scene.generativeNeeds.reduce((sum, need) => sum + need.estimatedCostUsd, 0),
    0,
  );
}

export function sceneAt(storyboard: Storyboard, seconds: number): Scene | undefined {
  return storyboard.scenes.find(
    (scene) => seconds >= scene.startTime && seconds < scene.startTime + scene.duration,
  );
}

/**
 * Visual types that put a picture on the screen.
 *
 * Everything else composes words, a lockup or a pause — all of which are real
 * shots and none of which is a picture. A logo reveal is not picture: it is
 * the mark, drawn. A transition is not picture: it is the gap between two.
 *
 * `mixed_media` is here because half of it is a picture and a scene is either
 * counted or not; `pictureShare` below weighs it at a half, which is where the
 * arithmetic belongs.
 */
export const PICTURE_VISUAL_TYPES: readonly VisualType[] = [
  'product_ui',
  'product_ui_3d',
  'screenshot_motion',
  'generated_broll',
  'real_media',
  'cinematic_3d',
  'mixed_media',
] as const;

/** Whether this shot shows something rather than saying something. */
export function carriesPicture(visualType: VisualType): boolean {
  return PICTURE_VISUAL_TYPES.includes(visualType);
}

/**
 * How much of the film is picture, as a share of runtime.
 *
 * The counterpart to the generative ceiling in `visualMix` below, and the one
 * that was missing: there was a rule against too much generated footage and no
 * rule at all against none of anything. A film of pure typography scored a
 * perfect zero here and nothing read the number.
 */
export function pictureShare(storyboard: Storyboard): number {
  const total = storyboardDuration(storyboard) || 1;
  const picture = storyboard.scenes.reduce(
    (sum, scene) =>
      sum + (carriesPicture(scene.visualType) ? scene.duration * (scene.visualType === 'mixed_media' ? 0.5 : 1) : 0),
    0,
  );
  return picture / total;
}

/**
 * The longest stretch of the film with no picture in it.
 *
 * Measured across scene boundaries rather than per scene, because four
 * three-second title cards in a row is twelve seconds of reading however the
 * storyboard chose to divide it up.
 */
export function longestTypeOnlyRun(storyboard: Storyboard): {
  seconds: number;
  start: number;
  end: number;
  sceneIds: string[];
} {
  let best = { seconds: 0, start: 0, end: 0, sceneIds: [] as string[] };
  let run = { seconds: 0, start: 0, end: 0, sceneIds: [] as string[] };
  for (const scene of storyboard.scenes) {
    if (carriesPicture(scene.visualType)) {
      run = { seconds: 0, start: 0, end: 0, sceneIds: [] };
      continue;
    }
    run = {
      seconds: run.seconds + scene.duration,
      start: run.sceneIds.length === 0 ? scene.startTime : run.start,
      end: scene.startTime + scene.duration,
      sceneIds: [...run.sceneIds, scene.id],
    };
    if (run.seconds > best.seconds) best = { ...run, sceneIds: [...run.sceneIds] };
  }
  return best;
}

/** Proportion of runtime by visual family — the guard-rail for generative overuse. */
export function visualMix(storyboard: Storyboard): {
  deterministic: number;
  realMedia: number;
  generative: number;
} {
  const total = storyboardDuration(storyboard) || 1;
  let deterministic = 0;
  let realMedia = 0;
  let generative = 0;
  for (const scene of storyboard.scenes) {
    switch (scene.visualType) {
      case 'generated_broll':
        generative += scene.duration;
        break;
      case 'real_media':
        realMedia += scene.duration;
        break;
      case 'product_ui':
      case 'product_ui_3d':
      case 'screenshot_motion':
        realMedia += scene.duration;
        break;
      case 'mixed_media':
        // Mixed scenes are counted half generative, which is intentionally
        // pessimistic: it keeps the budget honest.
        generative += scene.duration / 2;
        realMedia += scene.duration / 2;
        break;
      default:
        deterministic += scene.duration;
    }
  }
  return {
    deterministic: deterministic / total,
    realMedia: realMedia / total,
    generative: generative / total,
  };
}
