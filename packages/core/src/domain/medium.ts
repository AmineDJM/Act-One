import { z } from 'zod';
import { REAL_PRODUCT_VISUAL_TYPES, type Scene, type Storyboard } from './storyboard.ts';

/**
 * What a shot is made of.
 *
 * A film is not one medium. A screenshot is evidence, a generated clip is
 * material, typography is material, a 3D render is material — and none of
 * them is the film. The failure this exists to stop is the one that keeps
 * happening: everything routed through whichever medium was cheapest to
 * obtain, which is screenshots, so a film about a product becomes a sequence
 * of pictures of a product with words between them.
 *
 * Recording the medium per shot does two things. It makes the mix a decision
 * somebody took rather than a consequence of what was lying around. And it
 * makes a medium that was chosen but could not be produced VISIBLE: a shot
 * directed as moving footage on a system with no video provider configured is
 * a production shortfall, and the one thing it must never be is a title card
 * that nobody remembers asking for.
 */
export const ShotMedium = z.enum([
  /** The customer's real interface, filmed. */
  'real_product',
  /** A moving shot that does not exist until a model makes it. */
  'generative_video',
  /** Geometry, lighting and a camera. */
  'three_d',
  /** Type, shape and colour as the picture. Legitimate, and not a default. */
  'motion_graphics',
  /** Real product inside something constructed: the combination nothing else can do. */
  'hybrid',
]);
export type ShotMedium = z.infer<typeof ShotMedium>;

/** Which media need something this installation may not have. */
export const NEEDS_PROVIDER: Record<ShotMedium, 'video' | 'three_d' | null> = {
  real_product: null,
  motion_graphics: null,
  generative_video: 'video',
  hybrid: 'video',
  three_d: 'three_d',
};

export const MediumPlan = z.object({
  medium: ShotMedium,
  /** Why this medium and not another, in the director's words. */
  reason: z.string().max(400).default(''),
  /**
   * The medium this shot is actually being made in, when the first choice
   * could not be produced. Equal to `medium` when nothing went wrong.
   */
  produced: ShotMedium,
  /** What stopped it, when something did. Empty otherwise. */
  shortfall: z.string().max(400).default(''),
});
export type MediumPlan = z.infer<typeof MediumPlan>;

/**
 * What each shot is made of, and what it fell back to.
 *
 * Derived rather than stored, so it cannot drift from the scene it describes.
 * The fallback is the honest part: when a beat was written for moving footage
 * and there is no provider to make it, the plan says so and the shot plays as
 * whatever it could be — and that sentence travels with the film instead of
 * evaporating into a picture nobody can account for.
 */
export function mediumOf(scene: Scene, available: { video: boolean; threeD: boolean }): MediumPlan {
  const wants = intendedMedium(scene);
  const needs = NEEDS_PROVIDER[wants];
  const missing =
    (needs === 'video' && !available.video) || (needs === 'three_d' && !available.threeD);

  if (!missing) {
    return { medium: wants, reason: reasonFor(wants, scene), produced: wants, shortfall: '' };
  }

  /*
   * What it becomes. Real material if the shot has any, type if it does not —
   * and either way the sentence below is the point, because both of those
   * look, in the finished film, exactly like a shot that was always meant to
   * be that.
   */
  const produced: ShotMedium = scene.assetRefs.length > 0 ? 'real_product' : 'motion_graphics';
  return {
    medium: wants,
    reason: reasonFor(wants, scene),
    produced,
    shortfall:
      needs === 'video'
        ? `This shot was directed as moving footage. No video provider is configured, so it plays as ` +
          `${produced.replace(/_/g, ' ')}. Configure Higgsfield credentials to produce it as written.`
        : `This shot was directed as a 3D render. Blender is not available on this worker, so it plays ` +
          `as ${produced.replace(/_/g, ' ')}.`,
  };
}

function intendedMedium(scene: Scene): ShotMedium {
  if (scene.visualType === 'generated_broll') return 'generative_video';
  if (scene.visualType === 'mixed_media') return 'hybrid';
  if (scene.visualType === 'cinematic_3d') return 'three_d';
  if (scene.visualType === 'product_ui_3d') return scene.generativeNeeds.length > 0 ? 'hybrid' : 'three_d';
  if (REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType)) {
    return scene.uiSequence?.framings.some((framing) => framing.space === 'volume') ? 'hybrid' : 'real_product';
  }
  return 'motion_graphics';
}

function reasonFor(medium: ShotMedium, scene: Scene): string {
  switch (medium) {
    case 'real_product':
      return 'The beat is about what the product does, so it is the product.';
    case 'generative_video':
      return 'The beat is a place, a person or a feeling, and none of those are in a screenshot.';
    case 'three_d':
      return 'The beat wants an object with a camera around it.';
    case 'hybrid':
      return 'Real interface inside something built: accuracy where it matters, freedom everywhere else.';
    case 'motion_graphics':
      return scene.onScreenText.length > 0
        ? 'The beat is a line, and the line is the picture.'
        : 'Nothing else was available for this beat.';
  }
}

/**
 * The film's mix of media, and everything it could not make.
 *
 * "Optimise for a great film, not for arbitrary percentages" — so this counts
 * rather than judges. What it is for is the sentence a person reads when a
 * film comes out looking like a deck: here is what it was made of, and here
 * is what it was supposed to be made of.
 */
export function mediumMix(
  storyboard: Storyboard,
  available: { video: boolean; threeD: boolean },
): {
  plans: { sceneId: string; index: number; plan: MediumPlan }[];
  bySeconds: Record<ShotMedium, number>;
  shortfalls: { sceneId: string; index: number; startTime: number; message: string }[];
  /** How many genuinely different media the finished film uses. */
  distinct: number;
} {
  const plans = storyboard.scenes.map((scene) => ({
    sceneId: scene.id,
    index: scene.index,
    plan: mediumOf(scene, available),
  }));

  const bySeconds: Record<ShotMedium, number> = {
    real_product: 0,
    generative_video: 0,
    three_d: 0,
    motion_graphics: 0,
    hybrid: 0,
  };
  const shortfalls: { sceneId: string; index: number; startTime: number; message: string }[] = [];
  for (const [index, entry] of plans.entries()) {
    const scene = storyboard.scenes[index]!;
    bySeconds[entry.plan.produced] += scene.duration;
    if (entry.plan.shortfall) {
      shortfalls.push({
        sceneId: scene.id,
        index: scene.index,
        startTime: scene.startTime,
        message: entry.plan.shortfall,
      });
    }
  }

  return {
    plans,
    bySeconds,
    shortfalls,
    distinct: Object.values(bySeconds).filter((seconds) => seconds > 0).length,
  };
}
