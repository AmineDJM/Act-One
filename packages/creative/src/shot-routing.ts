import {
  budgetFor,
  pitchDrift,
  REAL_PRODUCT_VISUAL_TYPES,
  visualMix,
  type CreativeBudget,
  type CreativeMode,
  type FilmFormat,
  type ProductUnderstanding,
  type Scene,
  type Storyboard,
  type VisualType,
} from '@act-one/core';

/**
 * What technique carries each shot.
 *
 * These rules exist because the cheapest way to make an automated film look
 * automated is to reach for the generative model whenever a frame is hard.
 * The routing is therefore biased hard toward deterministic and real material,
 * and generative video has to argue for itself.
 *
 * The one absolute rule: if the product has a real interface, the film shows
 * the real interface. Generated imagery may support, contextualise or
 * metaphorise — it may never stand in for the product.
 */
export type ShotTechnique = 'deterministic' | 'real_product' | 'generative' | 'three_d';

export const TECHNIQUE_FOR_VISUAL: Record<VisualType, ShotTechnique> = {
  kinetic_typography: 'deterministic',
  statistic: 'deterministic',
  quote: 'deterministic',
  logo_reveal: 'deterministic',
  transition: 'deterministic',
  product_ui: 'real_product',
  screenshot_motion: 'real_product',
  real_media: 'real_product',
  product_ui_3d: 'three_d',
  cinematic_3d: 'three_d',
  generated_broll: 'generative',
  mixed_media: 'generative',
};

export type RoutingDecision = {
  visualType: VisualType;
  technique: ShotTechnique;
  reason: string;
};

export type ShotPurpose =
  | 'workflow' | 'result' | 'feature' | 'agent_behaviour'
  | 'metaphor' | 'environment' | 'mood' | 'human_context'
  | 'statement' | 'proof' | 'hero' | 'transition' | 'ending';

export type RoutingParams = {
  purpose: ShotPurpose;
  hasRealProductAsset: boolean;
  allowGenerative: boolean;
  allowThreeD: boolean;
  /**
   * Product tour unless told otherwise, so every caller that predates the
   * choice keeps routing exactly as it did.
   */
  format?: FilmFormat;
};

/**
 * What a scene is *for* decides the technique, not what would look coolest.
 */
export function routeShot(params: RoutingParams): RoutingDecision {
  const { purpose, hasRealProductAsset, allowGenerative, allowThreeD } = params;
  const format = params.format ?? 'product_tour';
  const pitch = format === 'pitch';

  switch (purpose) {
    case 'workflow':
    case 'result':
    case 'feature':
    case 'agent_behaviour':
      /*
       * A pitch may cut to the product; it may not work through it. So a beat
       * about what the product does becomes a held capture rather than a live
       * interface — the picture the film is talking over, not the thing the
       * film is teaching. Whether it stayed a cutaway is decided across the
       * whole storyboard, not here.
       */
      if (hasRealProductAsset && pitch) {
        return {
          visualType: 'screenshot_motion',
          technique: 'real_product',
          reason: 'A pitch cuts to the real thing and holds it; it never drives it.',
        };
      }
      if (hasRealProductAsset) {
        return {
          visualType: purpose === 'result' ? 'screenshot_motion' : 'product_ui',
          technique: 'real_product',
          reason: 'Anything showing what the product does must be the real product.',
        };
      }
      if (pitch) {
        return {
          ...withoutTheProduct(allowGenerative, allowThreeD),
          reason: 'No capture to cut to, so the film says it another way.',
        };
      }
      // No capture: fall back to typography rather than invent an interface.
      return {
        visualType: 'kinetic_typography',
        technique: 'deterministic',
        reason: 'No real capture available, and we never render a fake interface.',
      };

    case 'hero':
      // The hero of a pitch is an image. A capture staged in space is one —
      // the product as an object rather than as an interface — so a pitch with
      // real material gets it, and the ceiling decides how much of that there
      // can be.
      if (hasRealProductAsset && allowThreeD) {
        return {
          visualType: 'product_ui_3d',
          technique: 'three_d',
          reason: 'A hero shot benefits from staging the real UI as an object in space.',
        };
      }
      if (hasRealProductAsset) {
        return {
          visualType: 'screenshot_motion',
          technique: 'real_product',
          reason: 'Real UI, staged flat.',
        };
      }
      if (pitch) {
        return {
          ...withoutTheProduct(allowGenerative, allowThreeD),
          reason: 'No capture to stage, so the image carries the hero.',
        };
      }
      return {
        visualType: 'kinetic_typography',
        technique: 'deterministic',
        reason: 'No real capture; type carries the hero.',
      };

    case 'metaphor':
    case 'environment':
    case 'mood':
    case 'human_context':
      if (allowGenerative) {
        return {
          visualType: 'generated_broll',
          technique: 'generative',
          reason: 'Conceptual and atmospheric shots are where generation genuinely helps.',
        };
      }
      if (pitch && allowThreeD) {
        return {
          visualType: 'cinematic_3d',
          technique: 'three_d',
          reason: 'Generative media is off, so form and light in space carry the image.',
        };
      }
      return {
        visualType: 'kinetic_typography',
        technique: 'deterministic',
        reason: 'Generative media is disabled for this project.',
      };

    case 'transition':
      if (allowThreeD) {
        return {
          visualType: 'cinematic_3d',
          technique: 'three_d',
          reason: 'Spatial transitions read as craft rather than as a preset.',
        };
      }
      return { visualType: 'transition', technique: 'deterministic', reason: 'Deterministic transition.' };

    case 'statement':
      return { visualType: 'kinetic_typography', technique: 'deterministic', reason: 'Type carries a statement.' };
    case 'proof':
      return { visualType: 'statistic', technique: 'deterministic', reason: 'Figures must be set, not generated.' };
    case 'ending':
      return { visualType: 'logo_reveal', technique: 'deterministic', reason: 'The mark is rendered, never generated.' };
  }
}

/**
 * What carries a beat in a pitch, best first.
 *
 * The order is the argument of the whole format. Commissioned footage before
 * three dimensions before type — because falling back to typography every time
 * is how a film becomes a stack of title cards at a fixed interval, which is
 * what a product tour with no capture already does and what nobody should have
 * to watch for thirty seconds.
 */
function withoutTheProduct(
  allowGenerative: boolean,
  allowThreeD: boolean,
): Omit<RoutingDecision, 'reason'> {
  if (allowGenerative) return { visualType: 'generated_broll', technique: 'generative' };
  if (allowThreeD) return { visualType: 'cinematic_3d', technique: 'three_d' };
  return { visualType: 'kinetic_typography', technique: 'deterministic' };
}

export type BudgetViolation = {
  kind:
    | 'too_much_generative'
    | 'too_little_deterministic'
    | 'too_little_real'
    | 'fake_product'
    /** A pitch drifting into a product tour. See `pitchDrift`. */
    | 'pitch_drift'
    | 'over_cost';
  message: string;
  /** Scenes that should change to fix it, worst first. */
  sceneIds: string[];
};

/**
 * Checks a storyboard against the creative budget.
 *
 * This is the guard-rail that keeps "generative is supplementary" true in
 * practice rather than in a design document. It runs before anything expensive
 * happens, so an over-generated storyboard is corrected on paper rather than
 * discovered after a render.
 */
export function checkBudget(
  storyboard: Storyboard,
  understanding: ProductUnderstanding,
  mode: CreativeMode,
  overrides: Partial<CreativeBudget> = {},
  format: FilmFormat = 'product_tour',
): BudgetViolation[] {
  const budget: CreativeBudget = { ...budgetFor(mode, format), ...overrides };
  const mix = visualMix(storyboard);
  const violations: BudgetViolation[] = [];

  const generativeScenes = storyboard.scenes
    .filter((s) => s.visualType === 'generated_broll' || s.visualType === 'mixed_media')
    .sort((a, b) => b.duration - a.duration);

  if (mix.generative > budget.maxGenerativeRatio) {
    violations.push({
      kind: 'too_much_generative',
      message:
        `Generated footage is ${(mix.generative * 100).toFixed(0)}% of the film; ` +
        `the ceiling for ${mode} is ${(budget.maxGenerativeRatio * 100).toFixed(0)}%.`,
      sceneIds: generativeScenes.map((s) => s.id),
    });
  }

  if (mix.deterministic < budget.minDeterministicRatio) {
    violations.push({
      kind: 'too_little_deterministic',
      message:
        `Only ${(mix.deterministic * 100).toFixed(0)}% of the film is rendered by our own engine; ` +
        `at least ${(budget.minDeterministicRatio * 100).toFixed(0)}% keeps typography and brand under our control.`,
      sceneIds: generativeScenes.map((s) => s.id),
    });
  }

  /*
   * Only a film that is supposed to show the product can be accused of not
   * showing it. Research still captures pages for a pitch — it reads the site
   * either way — and without this the check fires on every pitch to complain
   * that footage nobody asked for went unused.
   */
  const hasRealFootage =
    format !== 'pitch' && understanding.productMoments.some((m) => m.screenshots.length > 0);
  if (hasRealFootage && mix.realMedia < budget.minRealMediaRatio) {
    violations.push({
      kind: 'too_little_real',
      message:
        `We captured real product footage but it is only ${(mix.realMedia * 100).toFixed(0)}% of the film. ` +
        `A launch film that barely shows the product is not doing its job.`,
      sceneIds: [],
    });
  }

  // The rule that matters most: a generated shot may never be presented as the
  // product. This catches a storyboard that routed a product purpose to
  // generation, which is exactly how "fake UI" ships.
  const fakeProduct = storyboard.scenes.filter(
    (scene) =>
      (scene.visualType === 'generated_broll' || scene.visualType === 'mixed_media') &&
      mentionsProductSurface(scene),
  );
  /*
   * And a pitch is checked for drift rather than for purity.
   *
   * The customer did not ask for a film with no interface in it; they asked
   * for a film that is not *about* the interface. So one glimpse passes, and
   * the four ways a pitch turns into a tour — driving it, opening on it,
   * cutting two of them together, or spending a fifth of the film on it —
   * each come back as their own violation.
   */
  if (format === 'pitch') {
    for (const drift of pitchDrift(storyboard.scenes)) {
      violations.push({ kind: 'pitch_drift', message: drift.message, sceneIds: drift.sceneIds });
    }
  }
  if (fakeProduct.length > 0) {
    violations.push({
      kind: 'fake_product',
      message:
        'A generated scene is describing the product interface. Generated imagery may support the ' +
        'story but must never stand in for the real product.',
      sceneIds: fakeProduct.map((s) => s.id),
    });
  }

  return violations;
}

const PRODUCT_SURFACE_WORDS =
  /\b(dashboard|interface|ui|screen|app|console|editor|workspace|inbox|panel|sidebar|chart|table|settings)\b/i;

function mentionsProductSurface(scene: Scene): boolean {
  const surface = [scene.purpose, scene.notes, ...scene.generativeNeeds.map((n) => n.brief)].join(' ');
  return PRODUCT_SURFACE_WORDS.test(surface);
}

/** Scenes that must be backed by genuine capture before they can render. */
export function scenesNeedingRealAssets(storyboard: Storyboard): Scene[] {
  return storyboard.scenes.filter(
    (scene) =>
      REAL_PRODUCT_VISUAL_TYPES.includes(scene.visualType) && scene.assetRefs.length === 0,
  );
}

/**
 * Trims generative scenes until the film is inside budget.
 *
 * Shortening beats deleting: the edit keeps its shape and the scene keeps doing
 * its job, just for less time. Only when a scene has been cut to its floor and
 * the film is still over does it get dropped.
 */
export function enforceBudget(
  storyboard: Storyboard,
  budget: CreativeBudget,
  minSceneSeconds = 1.2,
): Storyboard {
  const ratio = budget.maxGenerativeRatio;
  if (ratio >= 1) return storyboard;

  let scenes = [...storyboard.scenes];

  // Trimming a generated scene shrinks the film as well as the generated
  // portion, so a single pass against the original runtime never converges —
  // the first version of this trimmed 10s down to 5s and left the ratio at
  // 0.33 against a 0.25 ceiling. Recompute and repeat instead.
  for (let pass = 0; pass < 12; pass += 1) {
    const generativeTime = scenes.reduce((sum, s) => sum + s.duration * generativeWeight(s), 0);
    const nonGenerativeTime = scenes.reduce(
      (sum, s) => sum + s.duration * (1 - generativeWeight(s)),
      0,
    );

    // Solve g / (g + nonGen) <= ratio for g.
    const allowance = ratio === 0 ? 0 : (ratio * nonGenerativeTime) / (1 - ratio);
    let excess = generativeTime - allowance;
    if (excess <= 0.05) break;

    const generative = scenes
      .filter((s) => generativeWeight(s) > 0)
      .sort((a, b) => b.duration - a.duration);
    if (generative.length === 0) break;

    // Shortening beats deleting: the edit keeps its shape and the scene keeps
    // doing its job, just for less time.
    let trimmedAnything = false;
    for (const scene of generative) {
      if (excess <= 0.05) break;
      const index = scenes.findIndex((s) => s.id === scene.id);
      if (index < 0) continue;
      const weight = generativeWeight(scene);
      const trimmable = Math.max(0, scene.duration - minSceneSeconds);
      const trim = Math.min(trimmable, excess / weight);
      if (trim > 0.01) {
        scenes[index] = { ...scenes[index]!, duration: round3(scene.duration - trim) };
        excess -= trim * weight;
        trimmedAnything = true;
      }
    }

    if (excess > 0.05 && !trimmedAnything) {
      // Everything is already at its floor: drop the least valuable generated
      // scene and re-evaluate.
      const weakest = [...generative].sort((a, b) => a.duration - b.duration)[0];
      if (!weakest) break;
      scenes = scenes.filter((s) => s.id !== weakest.id);
    }
  }

  return { ...storyboard, scenes };
}

/** How much of a scene's runtime counts as generated. */
function generativeWeight(scene: Scene): number {
  if (scene.visualType === 'generated_broll') return 1;
  // Mixed scenes are counted half, matching visualMix — deliberately
  // pessimistic so the budget stays honest.
  if (scene.visualType === 'mixed_media') return 0.5;
  return 0;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
