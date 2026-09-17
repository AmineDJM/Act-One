import {
  VARIANT_SPECS,
  newId,
  resequence,
  round3,
  type AspectRatio,
  type Scene,
  type Storyboard,
  type Variant,
  type VariantPurpose,
} from '@act-one/core';

/**
 * Campaign cuts.
 *
 * A vertical 15-second ad is not the 60-second film cropped and trimmed. It is
 * a different edit: fewer beats, a harder hook, bigger type, and a composition
 * that assumes a thumb hovering over it. Cropping the master is the single most
 * recognisable sign that a "campaign" was generated rather than cut.
 *
 * So variants are planned as re-edits over the same approved material: choose
 * the scenes that carry the argument at that length, re-time them for that
 * channel, and recompose for that frame.
 */
export type ScenePriority = {
  sceneId: string;
  /** How essential this scene is to the argument, 0..1. */
  weight: number;
  reason: string;
};

/**
 * Scores scenes by how much of the film's argument they carry.
 *
 * The opening and the ending always survive: without a hook the cut has no
 * entry, and without a CTA it has no exit.
 */
export function prioritiseScenes(storyboard: Storyboard): ScenePriority[] {
  const total = storyboard.scenes.length;
  return storyboard.scenes.map((scene, index) => {
    let weight = 0.4;
    const reasons: string[] = [];

    if (index === 0) {
      weight = 1;
      reasons.push('hook');
    } else if (index === total - 1) {
      weight = 0.95;
      reasons.push('ending');
    }

    if (scene.visualType === 'product_ui' || scene.visualType === 'screenshot_motion') {
      weight += 0.3;
      reasons.push('shows the product working');
    }
    if (scene.visualType === 'statistic' && scene.claimEvidenceIds.length > 0) {
      weight += 0.22;
      reasons.push('carries supported proof');
    }
    if (scene.visualType === 'logo_reveal') {
      weight += 0.25;
      reasons.push('brand lockup');
    }
    // Atmosphere is the first thing an editor loses when cutting to fifteen
    // seconds; it is texture, and texture is a luxury at that length.
    if (scene.visualType === 'generated_broll' || scene.visualType === 'transition') {
      weight -= 0.25;
      reasons.push('atmosphere, first to go');
    }
    if (scene.onScreenText.length > 0) {
      weight += 0.08;
      reasons.push('carries copy');
    }

    return {
      sceneId: scene.id,
      weight: Math.max(0, Math.min(1, weight)),
      reason: reasons.join(', ') || 'supporting beat',
    };
  });
}

export type VariantPlan = {
  purpose: VariantPurpose;
  aspect: AspectRatio;
  targetSeconds: number;
  sceneIds: string[];
  /** Per-scene durations for this cut, which differ from the master. */
  durations: Record<string, number>;
  captionsBurned: boolean;
  notes: string;
};

/**
 * Chooses which scenes make a given cut, and how long each runs in it.
 */
export function planVariant(
  storyboard: Storyboard,
  purpose: VariantPurpose,
  options: { emphasise?: 'problem' | 'product' | 'proof' } = {},
): VariantPlan {
  const spec = VARIANT_SPECS[purpose];
  const priorities = new Map(prioritiseScenes(storyboard).map((p) => [p.sceneId, p]));

  /**
   * Emphasis has to suppress as well as promote.
   *
   * A boost-only weighting reorders the ranking but changes nothing about which
   * scenes fit, because at fifteen seconds only four or five scenes fit and the
   * same four or five always top the list. The result was three "different" ads
   * that were the same ad three times. Pushing the off-theme material down is
   * what actually makes room for the on-theme material.
   */
  const emphasised = (scene: Scene): number => {
    const base = priorities.get(scene.id)?.weight ?? 0.4;
    const isProduct =
      scene.visualType === 'product_ui' || scene.visualType === 'screenshot_motion';
    const isProof = scene.visualType === 'statistic' || scene.visualType === 'quote';
    const isEarly = scene.index < storyboard.scenes.length / 3;
    // The hook and the ending are never suppressed: without them the cut has no
    // entry and no exit, whatever it is arguing.
    const structural = scene.index === 0 || scene.index === storyboard.scenes.length - 1;

    switch (options.emphasise) {
      case 'problem':
        return base + (isEarly ? 0.4 : 0) - (structural ? 0 : isProduct || isProof ? 0.22 : 0);
      case 'product':
        return base + (isProduct ? 0.4 : 0) - (structural ? 0 : isProof || isEarly ? 0.22 : 0);
      case 'proof':
        return base + (isProof ? 0.4 : 0) - (structural ? 0 : isProduct || isEarly ? 0.22 : 0);
      default:
        return base;
    }
  };

  // Take scenes in order of importance until the cut is full, then restore
  // narrative order. Selecting in time order instead would just truncate the
  // film, which is how "variants" end up being the first 15 seconds.
  const ranked = [...storyboard.scenes].sort((a, b) => emphasised(b) - emphasised(a));
  const chosen: Scene[] = [];
  let budget = spec.targetSeconds;

  for (const scene of ranked) {
    const compressed = compressedDuration(scene, purpose);
    if (budget - compressed < -0.75 && chosen.length >= 2) continue;
    chosen.push(scene);
    budget -= compressed;
    if (budget <= 0.5) break;
  }

  const ordered = chosen.sort((a, b) => a.index - b.index);
  const durations: Record<string, number> = {};
  for (const scene of ordered) durations[scene.id] = compressedDuration(scene, purpose);

  // Distribute whatever is left (or over) across the chosen scenes so the cut
  // lands on its target rather than approximately near it.
  const actual = Object.values(durations).reduce((sum, d) => sum + d, 0);
  const scale = actual > 0 ? spec.targetSeconds / actual : 1;
  for (const scene of ordered) {
    const floor = minimumLegible(scene);
    durations[scene.id] = round3(Math.max(floor, durations[scene.id]! * scale));
  }

  return {
    purpose,
    aspect: spec.aspect,
    targetSeconds: spec.targetSeconds,
    sceneIds: ordered.map((s) => s.id),
    durations,
    captionsBurned: spec.captions,
    notes: `${spec.label}: ${ordered.length} of ${storyboard.scenes.length} scenes, recomposed for ${spec.aspect}.`,
  };
}

/** Shorter formats hold each frame for less time, but never below legibility. */
function compressedDuration(scene: Scene, purpose: VariantPurpose): number {
  const spec = VARIANT_SPECS[purpose];
  const aggression = spec.targetSeconds <= 15 ? 0.62 : spec.targetSeconds <= 30 ? 0.78 : 1;
  return round3(Math.max(minimumLegible(scene), scene.duration * aggression));
}

function minimumLegible(scene: Scene): number {
  const words = scene.onScreenText.join(' ').split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0.7;
  return round3(0.35 + words / 2.6 + 0.3);
}

/** Materialises a plan as a storyboard the render pipeline can execute. */
export function variantStoryboard(master: Storyboard, plan: VariantPlan): Storyboard {
  const byId = new Map(master.scenes.map((s) => [s.id, s]));
  const scenes = plan.sceneIds
    .map((id) => byId.get(id))
    .filter((scene): scene is Scene => Boolean(scene))
    .map((scene) => ({
      ...scene,
      duration: plan.durations[scene.id] ?? scene.duration,
      status: 'draft' as const,
    }));

  return resequence({ ...master, scenes, updatedAt: new Date().toISOString() });
}

export function toVariant(params: {
  renderId: string;
  projectId: string;
  plan: VariantPlan;
}): Variant {
  return {
    id: newId('var'),
    renderId: params.renderId,
    projectId: params.projectId,
    purpose: params.plan.purpose,
    aspect: params.plan.aspect,
    durationSeconds: round3(
      Object.values(params.plan.durations).reduce((sum, d) => sum + d, 0),
    ),
    sceneIds: params.plan.sceneIds,
    audioStem: 'full',
    captionsBurned: params.plan.captionsBurned,
    assetId: null,
    status: 'queued',
    costUsd: 0,
    createdAt: new Date().toISOString(),
  };
}

/** The default campaign: the cuts most launches actually need. */
export const DEFAULT_CAMPAIGN: VariantPurpose[] = [
  'vertical_30',
  'ad_15_a',
  'ad_15_b',
  'bumper_6',
  'homepage_loop',
];

export function planCampaign(
  storyboard: Storyboard,
  purposes: VariantPurpose[] = DEFAULT_CAMPAIGN,
): VariantPlan[] {
  return purposes.map((purpose, index) =>
    planVariant(storyboard, purpose, {
      // The three 15s ads must argue differently or they are one ad shown
      // three times, which is how campaign generation usually fails.
      emphasise:
        purpose === 'ad_15_a'
          ? 'problem'
          : purpose === 'ad_15_b'
            ? 'product'
            : purpose === 'ad_15_c'
              ? 'proof'
              : index % 2 === 0
                ? 'product'
                : undefined,
    }),
  );
}
