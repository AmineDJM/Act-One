import type { BrandSystem, CreativeSystemId, ProductUnderstanding } from '@act-one/core';
import { cinematicBlack } from './cinematic-black.ts';
import { kineticProduct } from './kinetic-product.ts';
import { editorialTech } from './editorial-tech.ts';
import { supportingSystems } from './supporting.ts';
import type { CreativeSystem } from './types.ts';

export * from './types.ts';
export { cinematicBlack, kineticProduct, editorialTech };

/**
 * The creative languages available to the director.
 *
 * Three are production ready and deeply specified. The rest are declared with
 * real grammar but are not yet offered by default — breadth before depth is how
 * you end up with fifteen mediocre templates, which is the outcome this whole
 * system exists to avoid.
 */
export const CREATIVE_SYSTEMS: Record<CreativeSystemId, CreativeSystem> = {
  cinematic_black: cinematicBlack,
  kinetic_product: kineticProduct,
  editorial_tech: editorialTech,
  ...supportingSystems,
};

export function getSystem(id: CreativeSystemId): CreativeSystem {
  return CREATIVE_SYSTEMS[id] ?? cinematicBlack;
}

export function productionReadySystems(): CreativeSystem[] {
  return Object.values(CREATIVE_SYSTEMS).filter((system) => system.productionReady);
}

/**
 * Scores how well a system fits a given brand and product.
 *
 * This is what stops every film being Cinematic Black. The signals are the ones
 * a creative director would actually weigh: does the brand's own visual
 * language point this way, is there real product footage to carry a UI-led
 * system, and does the launch context want gravity or energy.
 */
export function scoreSystemFit(
  system: CreativeSystem,
  brand: BrandSystem,
  understanding: ProductUnderstanding,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0.5;

  const hasRealFootage = understanding.productMoments.some((m) => m.screenshots.length > 0);
  // Proportional, not a threshold. A system where half the archetypes need real
  // capture is half as compromised without it as one where all of them do —
  // a binary cutoff let exactly-half systems (Kinetic Product) escape entirely.
  const footageDependence =
    system.archetypes.filter((a) => a.requiresProductAsset).length / system.archetypes.length;

  if (footageDependence > 0.2) {
    if (hasRealFootage) {
      score += 0.36 * footageDependence;
      reasons.push('Real product capture available');
    } else {
      // A UI-led system with no real UI has to fake it, and we never fake it.
      score -= 0.7 * footageDependence;
      reasons.push('No real product capture to carry a UI-led system');
    }
  }

  const styleAffinity: Record<string, CreativeSystemId[]> = {
    minimal: ['cinematic_black', 'editorial_tech', 'luxury_minimal'],
    editorial: ['editorial_tech', 'swiss_product', 'luxury_minimal'],
    technical: ['kinetic_product', 'editorial_tech', 'data_driven'],
    bold: ['kinetic_product', 'high_energy_launch', 'bold_gradient'],
    luxury: ['luxury_minimal', 'cinematic_black'],
    playful: ['high_energy_launch', 'human_product'],
    brutalist: ['swiss_product', 'kinetic_product'],
    corporate: ['product_hero', 'data_driven'],
  };
  if (styleAffinity[brand.visualStyle]?.includes(system.id)) {
    score += 0.22;
    reasons.push(`Matches the brand's ${brand.visualStyle} visual language`);
  }

  if (brand.motionStyle === 'cinematic' && system.pacing.averageSceneSeconds >= 3.2) {
    score += 0.1;
    reasons.push('Pacing matches the brand’s motion language');
  }
  if (brand.motionStyle === 'snappy' && system.pacing.averageSceneSeconds <= 2.6) {
    score += 0.1;
    reasons.push('Pacing matches the brand’s motion language');
  }

  if (system.palette.canvas === 'dark' && brand.visualStyle === 'playful') {
    score -= 0.12;
    reasons.push('A dark canvas fights a playful brand');
  }
  if (system.palette.allowGlow && !brand.allowsGlow) {
    score -= 0.1;
    reasons.push('System leans on glow the brand does not use');
  }

  const context = understanding.launchContext;
  if ((context === 'fundraise' || context === 'investor_demo') && system.pacing.averageSceneSeconds >= 3) {
    score += 0.12;
    reasons.push('Gravity suits a funding or investor moment');
  }
  if ((context === 'paid_social' || context === 'product_hunt') && system.pacing.averageSceneSeconds <= 2.6) {
    score += 0.12;
    reasons.push('Energy suits a social or Product Hunt launch');
  }

  if (!system.productionReady) {
    // Available to the director, but never the default recommendation.
    score -= 0.4;
    reasons.push('Not yet production ready');
  }

  return { score: Math.max(0, Math.min(1, score)), reasons };
}

/** Ranks systems for a project, best first. */
export function rankSystems(
  brand: BrandSystem,
  understanding: ProductUnderstanding,
): { system: CreativeSystem; score: number; reasons: string[] }[] {
  return Object.values(CREATIVE_SYSTEMS)
    .map((system) => ({ system, ...scoreSystemFit(system, brand, understanding) }))
    .sort((a, b) => b.score - a.score);
}
