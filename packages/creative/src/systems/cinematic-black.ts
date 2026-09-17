import type { CreativeSystem } from './types.ts';

/**
 * Cinematic Black.
 *
 * The product as a physical object, photographed. Deep field, slow moves, long
 * holds, very little text and a lot of space around it. The restraint is the
 * point: the film says "this is serious" by refusing to oversell.
 *
 * What makes this work and not look like every dark SaaS video:
 *  - The canvas is a brand-tinted near-black, never #000. Pure black kills the
 *    sense of a lit space and makes the UI look pasted on.
 *  - Type is sparse and large, and never shares a frame with a busy UI.
 *  - Moves are slow and single-axis. Two simultaneous moves read as a template.
 *  - Sound carries the film; the opening is silent so the first impact lands.
 */
export const cinematicBlack: CreativeSystem = {
  id: 'cinematic_black',
  name: 'Cinematic Black',
  essence: 'The product as a lit object. Restraint, depth and silence doing the persuading.',
  suitsWhen: [
    'The product is visually strong enough to hold a frame on its own',
    'The brand is confident and understated',
    'Launch, funding or category-definition moments',
    'The audience is senior and allergic to hype',
  ],
  avoidWhen: [
    'The product is mostly forms and tables with nothing to look at',
    'The brand is bright, playful or high-energy',
    'The film must explain a complex workflow step by step',
  ],
  productionReady: true,

  palette: {
    canvas: 'dark',
    // The accent appears three or four times in a minute. That scarcity is
    // what makes it read as intent rather than decoration.
    accentUsage: 'sparing',
    allowGradient: false,
    allowGlow: false,
  },

  typeScale: {
    display: {
      displayRatio: 0.11,
      bodyRatio: 0.026,
      maxLineLength: 28,
      maxLines: 2,
      tracking: -0.032,
      lineHeight: 1.04,
      case: 'sentence',
      align: 'left',
    },
    statement: {
      displayRatio: 0.068,
      bodyRatio: 0.024,
      maxLineLength: 42,
      maxLines: 3,
      tracking: -0.022,
      lineHeight: 1.16,
      case: 'sentence',
      align: 'left',
    },
    caption: {
      displayRatio: 0.022,
      bodyRatio: 0.019,
      maxLineLength: 64,
      maxLines: 2,
      tracking: 0.01,
      lineHeight: 1.4,
      case: 'sentence',
      align: 'left',
    },
  },

  openings: [
    {
      id: 'black_hold',
      name: 'Hold on black',
      description: 'Two seconds of near-black and silence, then one line fades up.',
      visualType: 'kinetic_typography',
      motion: 'word_reveal',
      camera: 'static',
      durationRange: [2.4, 4],
      soundEntry: 'silence',
      suitsHook: ['statement', 'question'],
    },
    {
      id: 'object_reveal',
      name: 'Object out of darkness',
      description: 'The product emerges from black on a slow push, no text at all.',
      visualType: 'product_ui_3d',
      motion: 'floating_ui',
      camera: 'slow_push',
      durationRange: [3, 5],
      soundEntry: 'riser',
      suitsHook: ['demonstration', 'metaphor'],
    },
    {
      id: 'single_detail',
      name: 'One detail, then the whole',
      description: 'Opens hard on a single UI detail, then pulls to reveal context.',
      visualType: 'screenshot_motion',
      motion: 'product_zoom',
      camera: 'slow_pull',
      durationRange: [2.6, 4.2],
      soundEntry: 'impact',
      suitsHook: ['demonstration', 'statement'],
    },
  ],

  archetypes: [
    {
      id: 'statement',
      purpose: 'Land one idea with nothing else on screen',
      visualType: 'kinetic_typography',
      motion: 'editorial_headline',
      camera: 'static',
      durationRange: [2, 3.6],
      maxWords: 9,
      requiresProductAsset: false,
      soundCues: ['impact'],
    },
    {
      id: 'product_hero',
      purpose: 'Present the product as an object worth looking at',
      visualType: 'product_ui_3d',
      motion: 'floating_ui',
      camera: 'slow_push',
      durationRange: [3, 5.5],
      maxWords: 0,
      requiresProductAsset: true,
      soundCues: ['texture'],
    },
    {
      id: 'moment',
      purpose: 'Show the thing the product actually does, in one gesture',
      visualType: 'product_ui',
      motion: 'product_sequence',
      camera: 'crop_push',
      durationRange: [2.4, 5],
      maxWords: 6,
      requiresProductAsset: true,
      soundCues: ['ui_click', 'impact'],
    },
    {
      id: 'proof',
      purpose: 'One number or one name, given room',
      visualType: 'statistic',
      motion: 'metric_reveal',
      camera: 'static',
      durationRange: [2, 3.2],
      maxWords: 8,
      requiresProductAsset: false,
      soundCues: ['sub_drop'],
    },
    {
      id: 'atmosphere',
      purpose: 'A breath between ideas; texture, not information',
      visualType: 'generated_broll',
      motion: 'depth_transition',
      camera: 'lateral_drift',
      durationRange: [1.4, 2.6],
      maxWords: 0,
      requiresProductAsset: false,
      soundCues: ['texture', 'whoosh'],
    },
  ],

  transitions: [
    {
      from: ['kinetic_typography'],
      to: ['product_ui', 'product_ui_3d', 'screenshot_motion'],
      motion: 'mask_reveal',
      durationSeconds: 0.5,
      weight: 3,
    },
    {
      from: ['product_ui', 'product_ui_3d'],
      to: ['kinetic_typography', 'statistic'],
      motion: 'depth_transition',
      durationSeconds: 0.45,
      weight: 2,
    },
    {
      from: ['generated_broll'],
      to: ['product_ui', 'kinetic_typography'],
      motion: 'hard_cut',
      durationSeconds: 0,
      weight: 2,
    },
  ],

  endings: [
    {
      id: 'mark_in_dark',
      name: 'Mark in the dark',
      motion: 'logo_reveal',
      durationRange: [2.4, 3.6],
      logoSeparate: true,
      soundCues: ['logo_sting', 'silence'],
    },
    {
      id: 'line_and_mark',
      name: 'One line, then the mark',
      motion: 'cta_end_card',
      durationRange: [2.8, 4],
      logoSeparate: false,
      soundCues: ['impact', 'logo_sting'],
    },
  ],

  pacing: {
    averageSceneSeconds: 3.4,
    sceneRange: [1.4, 5.5],
    longShortRatio: 0.55,
    defaultEasing: 'in_out_quart',
    silenceBudget: 2.5,
  },

  sound: {
    musicCharacter: 'Sub-heavy, sparse, tonal. Nothing melodic enough to hum.',
    openOnMusic: false,
    uiSoundDensity: 'sparse',
    impactsOnCuts: true,
    endWithSting: true,
  },

  prohibitions: [
    'Never place body copy over a busy product screen',
    'Never run two camera moves at once',
    'Never use pure #000000 as the canvas',
    'Never exceed two lines of display type',
    'Never cut faster than 1.4 seconds',
  ],
};
