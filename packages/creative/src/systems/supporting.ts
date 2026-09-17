import type { CreativeSystemId } from '@act-one/core';
import { cinematicBlack } from './cinematic-black.ts';
import { editorialTech } from './editorial-tech.ts';
import { kineticProduct } from './kinetic-product.ts';
import type { CreativeSystem } from './types.ts';

/**
 * The rest of the library.
 *
 * Each of these is a genuine creative language with its own grammar, but they
 * inherit structure from whichever of the three finished systems is closest and
 * then override what actually differs. Two reasons for that:
 *
 *  1. It is honest about the current state — these are not yet held to the same
 *     bar, and `productionReady: false` keeps them out of default recommendations
 *     until they are.
 *  2. Where they do differ, the diff is the entire definition, so what makes
 *     "Luxury Minimal" not "Cinematic Black" is legible in ten lines rather than
 *     buried in a 200-line copy.
 */
function derive(
  base: CreativeSystem,
  overrides: Partial<CreativeSystem> & { id: CreativeSystemId; name: string; essence: string },
): CreativeSystem {
  return {
    ...base,
    ...overrides,
    productionReady: overrides.productionReady ?? false,
    palette: { ...base.palette, ...overrides.palette },
    pacing: { ...base.pacing, ...overrides.pacing },
    sound: { ...base.sound, ...overrides.sound },
    typeScale: { ...base.typeScale, ...overrides.typeScale },
  };
}

export const supportingSystems: Record<
  Exclude<CreativeSystemId, 'cinematic_black' | 'kinetic_product' | 'editorial_tech'>,
  CreativeSystem
> = {
  spatial_ui: derive(cinematicBlack, {
    id: 'spatial_ui',
    name: 'Spatial UI',
    essence: 'Interface panes arranged in depth, moving as a single coordinated space.',
    suitsWhen: ['The product has several surfaces that relate to each other', 'Platform positioning'],
    avoidWhen: ['A single-screen product', 'No real UI to arrange'],
    palette: { canvas: 'dark', accentUsage: 'structural', allowGradient: false, allowGlow: false },
    pacing: { ...cinematicBlack.pacing, averageSceneSeconds: 3.8, defaultEasing: 'out_expo' },
    prohibitions: [
      ...cinematicBlack.prohibitions,
      'Never arrange panes on more than three depth planes — beyond that it reads as clutter',
    ],
  }),

  swiss_product: derive(editorialTech, {
    id: 'swiss_product',
    name: 'Swiss Product',
    essence: 'A strict grid, flush-left type, and absolutely no decoration.',
    suitsWhen: ['Design-led brands', 'Products whose value is precision'],
    avoidWhen: ['Warm, human or consumer-facing positioning'],
    palette: { canvas: 'light', accentUsage: 'sparing', allowGradient: false, allowGlow: false },
    pacing: { ...editorialTech.pacing, averageSceneSeconds: 3.2, defaultEasing: 'linear' },
  }),

  luxury_minimal: derive(cinematicBlack, {
    id: 'luxury_minimal',
    name: 'Luxury Minimal',
    essence: 'Very little happens, very slowly, and it is beautiful.',
    suitsWhen: ['Premium positioning', 'Brands with almost no chroma'],
    avoidWhen: ['Anything that needs to explain itself', 'Short-form social'],
    pacing: { ...cinematicBlack.pacing, averageSceneSeconds: 4.6, sceneRange: [2.5, 7], silenceBudget: 4 },
    sound: { ...cinematicBlack.sound, musicCharacter: 'Single sustained tone. Almost ambient.' },
  }),

  human_product: derive(editorialTech, {
    id: 'human_product',
    name: 'Human + Product',
    essence: 'Real people and real context around the software, not instead of it.',
    suitsWhen: ['The product changes how someone’s day goes', 'Vertical SaaS'],
    avoidWhen: ['No licensed or authentic human footage is available'],
    palette: { canvas: 'light', accentUsage: 'sparing', allowGradient: false, allowGlow: false },
    prohibitions: [
      ...editorialTech.prohibitions,
      'Never use generated people as if they were customers',
    ],
  }),

  data_driven: derive(editorialTech, {
    id: 'data_driven',
    name: 'Data Driven',
    essence: 'Charts and figures as the visual language, rendered properly rather than decoratively.',
    suitsWhen: ['Analytics, fintech and reporting products', 'Proof-led stories'],
    avoidWhen: ['There are no real numbers we are allowed to show'],
    prohibitions: [
      ...editorialTech.prohibitions,
      'Never render a chart whose data we did not receive from the customer',
      'Never animate an axis to exaggerate a trend',
    ],
  }),

  conceptual_ai: derive(cinematicBlack, {
    id: 'conceptual_ai',
    name: 'Conceptual AI',
    essence: 'Abstract systems imagery earning its place against real product, never replacing it.',
    suitsWhen: ['Agent and model products where the work is invisible'],
    avoidWhen: ['A brand that has earned the right to be literal'],
    palette: { canvas: 'dark', accentUsage: 'structural', allowGradient: true, allowGlow: false },
    prohibitions: [
      ...cinematicBlack.prohibitions,
      'Never use neural-network filigree, glowing brains, or humanoid robots',
      'Never let generative imagery exceed a third of the runtime',
    ],
  }),

  high_energy_launch: derive(kineticProduct, {
    id: 'high_energy_launch',
    name: 'High Energy Launch',
    essence: 'Everything at once, cut hard, over in fifteen seconds.',
    suitsWhen: ['Paid social', 'Product Hunt day', 'Short vertical formats'],
    avoidWhen: ['Enterprise trust', 'Anything over 45 seconds'],
    pacing: { ...kineticProduct.pacing, averageSceneSeconds: 1.5, sceneRange: [0.5, 3], silenceBudget: 0.4 },
    sound: { ...kineticProduct.sound, musicCharacter: 'Driving, loud, immediate.' },
  }),

  product_hero: derive(kineticProduct, {
    id: 'product_hero',
    name: 'Product Hero',
    essence: 'One screen, one workflow, shown properly from start to finish.',
    suitsWhen: ['Feature launches', 'Homepage explainers'],
    avoidWhen: ['The product is not visually legible at a glance'],
    palette: { canvas: 'both', accentUsage: 'structural', allowGradient: false, allowGlow: false },
    pacing: { ...kineticProduct.pacing, averageSceneSeconds: 3, longShortRatio: 0.35 },
  }),

  bold_gradient: derive(kineticProduct, {
    id: 'bold_gradient',
    name: 'Bold Gradient',
    essence: 'Saturated colour fields as structure — only for brands that genuinely live there.',
    suitsWhen: ['Brands whose own site is gradient-led'],
    avoidWhen: ['Any brand that does not already use gradients — this is the fastest route to generic'],
    palette: { canvas: 'dark', accentUsage: 'dominant', allowGradient: true, allowGlow: true },
    prohibitions: [
      ...kineticProduct.prohibitions,
      'Never use a purple-to-blue gradient unless it is literally the brand’s own',
    ],
  }),
};
