import type { CreativeSystem } from './types.ts';

/**
 * Editorial Tech.
 *
 * Swiss editorial discipline applied to software: a visible grid, generous
 * white space, one excellent typeface doing almost all of the work, and the
 * product presented as a specimen rather than a hero.
 *
 * This is the system that flatters a well-designed brand and punishes a
 * careless one, because there is nowhere for weak typography to hide. Two
 * things make it work:
 *  - The grid is real and consistent. Elements land on column boundaries, and
 *    the same margin holds from the first frame to the last.
 *  - Motion is almost absent. Things enter, settle, and stay. A drifting
 *    editorial layout looks like a template with an animation preset applied.
 */
export const editorialTech: CreativeSystem = {
  id: 'editorial_tech',
  name: 'Editorial Tech',
  essence: 'A visible grid, one great typeface, and enough space to look expensive.',
  suitsWhen: [
    'The brand has real typographic discipline',
    'The message is a point of view, not a feature list',
    'Homepage hero loops and category-defining launches',
    'Developer tools and infrastructure with a design-led brand',
  ],
  avoidWhen: [
    'The film needs energy or urgency',
    'The copy is long and cannot be cut',
    'The brand is loud, gradient-heavy or playful',
  ],
  productionReady: true,

  palette: {
    canvas: 'light',
    accentUsage: 'sparing',
    allowGradient: false,
    allowGlow: false,
  },

  typeScale: {
    display: {
      displayRatio: 0.094,
      bodyRatio: 0.023,
      maxLineLength: 34,
      maxLines: 3,
      tracking: -0.026,
      lineHeight: 1.08,
      case: 'sentence',
      align: 'left',
    },
    statement: {
      displayRatio: 0.054,
      bodyRatio: 0.021,
      maxLineLength: 52,
      maxLines: 4,
      tracking: -0.016,
      lineHeight: 1.26,
      case: 'sentence',
      align: 'left',
    },
    caption: {
      // Small, set in mono, used as a running label. This is the detail that
      // makes the system read as editorial rather than merely minimal.
      displayRatio: 0.0155,
      bodyRatio: 0.0145,
      maxLineLength: 72,
      maxLines: 2,
      tracking: 0.06,
      lineHeight: 1.45,
      case: 'upper',
      align: 'left',
    },
  },

  openings: [
    {
      id: 'masthead',
      name: 'Masthead',
      description: 'The grid draws itself, then one line sets into it.',
      visualType: 'kinetic_typography',
      motion: 'editorial_headline',
      camera: 'static',
      durationRange: [2.6, 4.2],
      soundEntry: 'music_in',
      suitsHook: ['statement', 'question'],
    },
    {
      id: 'specimen',
      name: 'Specimen',
      description: 'The product sits in the grid like a plate in a magazine, captioned.',
      visualType: 'screenshot_motion',
      motion: 'product_window',
      camera: 'static',
      durationRange: [3, 4.6],
      soundEntry: 'music_in',
      suitsHook: ['demonstration', 'statement'],
    },
    {
      id: 'index',
      name: 'Index',
      description: 'A numbered list of what follows, set small, then cut.',
      visualType: 'kinetic_typography',
      motion: 'word_reveal',
      camera: 'static',
      durationRange: [2, 3.2],
      soundEntry: 'silence',
      suitsHook: ['metaphor', 'statement'],
    },
  ],

  archetypes: [
    {
      id: 'thesis',
      purpose: 'State the point of view the film exists to make',
      visualType: 'kinetic_typography',
      motion: 'editorial_headline',
      camera: 'static',
      durationRange: [2.6, 4.4],
      maxWords: 16,
      requiresProductAsset: false,
      soundCues: ['texture'],
    },
    {
      id: 'plate',
      purpose: 'Present one product screen as a captioned specimen',
      visualType: 'screenshot_motion',
      motion: 'product_window',
      camera: 'static',
      durationRange: [2.6, 4.4],
      maxWords: 12,
      requiresProductAsset: true,
      soundCues: ['ui_click'],
    },
    {
      id: 'comparison',
      purpose: 'Before and after, side by side, honestly labelled',
      visualType: 'product_ui',
      motion: 'split_screen',
      camera: 'static',
      durationRange: [3, 5],
      maxWords: 14,
      requiresProductAsset: true,
      soundCues: ['whoosh'],
    },
    {
      id: 'figure',
      purpose: 'A number set as a figure with a caption, not a bragging card',
      visualType: 'statistic',
      motion: 'metric_reveal',
      camera: 'static',
      durationRange: [2.2, 3.4],
      maxWords: 12,
      requiresProductAsset: false,
      soundCues: ['impact'],
    },
    {
      id: 'pull_quote',
      purpose: 'A customer in their own words, attributed',
      visualType: 'quote',
      motion: 'quote_hold',
      camera: 'static',
      durationRange: [3, 4.8],
      maxWords: 28,
      requiresProductAsset: false,
      soundCues: ['texture'],
    },
  ],

  transitions: [
    {
      from: ['kinetic_typography'],
      to: ['screenshot_motion', 'product_ui'],
      motion: 'mask_reveal',
      durationSeconds: 0.42,
      weight: 3,
    },
    {
      from: ['screenshot_motion', 'product_ui', 'statistic'],
      to: ['kinetic_typography', 'quote'],
      motion: 'hard_cut',
      durationSeconds: 0,
      weight: 3,
    },
  ],

  endings: [
    {
      id: 'colophon',
      name: 'Colophon',
      motion: 'cta_end_card',
      durationRange: [2.6, 3.8],
      logoSeparate: false,
      soundCues: ['music_out', 'logo_sting'],
    },
    {
      id: 'mark_on_white',
      name: 'Mark on white',
      motion: 'logo_reveal',
      durationRange: [2, 3],
      logoSeparate: true,
      soundCues: ['logo_sting'],
    },
  ],

  pacing: {
    averageSceneSeconds: 3.6,
    sceneRange: [2, 5],
    longShortRatio: 0.4,
    defaultEasing: 'out_expo',
    silenceBudget: 1.8,
  },

  sound: {
    musicCharacter: 'Sparse, acoustic or tonal, unhurried. Present but never driving.',
    openOnMusic: true,
    uiSoundDensity: 'sparse',
    impactsOnCuts: false,
    endWithSting: true,
  },

  prohibitions: [
    'Never break the grid — every element lands on a column boundary',
    'Never animate two properties at once',
    'Never centre display type',
    'Never use more than two type sizes in one frame',
    'Never let a product screen bleed to the frame edge',
  ],
};
