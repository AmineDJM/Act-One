import { z } from 'zod';
import { nonEmpty, score01 } from '../zod-helpers.ts';
import { VoiceStrategy } from './creative.ts';

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
  product_ui_3d: ['product_window', 'spatial_cards', 'window_explosion'],
  screenshot_motion: ['product_zoom', 'product_window', 'image_wall'],
  real_media: ['image_wall', 'spatial_cards'],
  cinematic_3d: ['depth_transition', 'spatial_cards'],
  generated_broll: ['image_wall', 'depth_transition', 'hold'],
  mixed_media: ['window_explosion', 'split_screen', 'spatial_cards'],
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
  musicDirection: z.string().max(600).default(''),
  status: StoryboardStatus.default('draft'),
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
