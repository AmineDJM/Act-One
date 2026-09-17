import type { CreativeSystem } from './types.ts';

/**
 * Kinetic Product.
 *
 * Fast, typographic, UI-led. Words and interface cut against each other on a
 * tight rhythm so the film feels like the product feels: quick, direct, no
 * ceremony.
 *
 * The failure mode this system is designed around is monotony. A fast cut is
 * exciting for about eight seconds, after which every scene lands the same and
 * the viewer stops reading. So the grammar insists on dynamics: short beats
 * are interrupted by held frames, and the type alternates between full-frame
 * statements and small captions anchored to the UI.
 */
export const kineticProduct: CreativeSystem = {
  id: 'kinetic_product',
  name: 'Kinetic Product',
  essence: 'Type and interface cutting against each other. Fast, literal, confident.',
  suitsWhen: [
    'The product has a clear workflow worth showing end to end',
    'The audience is practitioners who want to see it work',
    'Feature launches and Product Hunt',
    'The brand is direct and energetic',
  ],
  avoidWhen: [
    'The film needs gravity — funding, category creation, enterprise trust',
    'There is no real product capture available',
    'The brand is quiet or luxurious',
  ],
  productionReady: true,

  palette: {
    canvas: 'both',
    // Accent is load-bearing here: it marks the cut points and ties the type
    // to the UI, so it appears constantly but always structurally.
    accentUsage: 'structural',
    allowGradient: false,
    allowGlow: false,
  },

  typeScale: {
    display: {
      displayRatio: 0.135,
      bodyRatio: 0.028,
      maxLineLength: 22,
      maxLines: 2,
      tracking: -0.04,
      lineHeight: 0.98,
      case: 'sentence',
      align: 'left',
    },
    statement: {
      displayRatio: 0.078,
      bodyRatio: 0.025,
      maxLineLength: 34,
      maxLines: 2,
      tracking: -0.028,
      lineHeight: 1.08,
      case: 'sentence',
      align: 'left',
    },
    caption: {
      displayRatio: 0.026,
      bodyRatio: 0.021,
      maxLineLength: 48,
      maxLines: 2,
      tracking: 0,
      lineHeight: 1.32,
      case: 'sentence',
      align: 'left',
    },
  },

  openings: [
    {
      id: 'word_slam',
      name: 'Word slam',
      description: 'Three words, three hard cuts, one per beat. No product yet.',
      visualType: 'kinetic_typography',
      motion: 'kinetic_headline',
      camera: 'static',
      durationRange: [1.6, 2.6],
      soundEntry: 'impact',
      suitsHook: ['statement', 'question'],
    },
    {
      id: 'cursor_cold_open',
      name: 'Cursor cold open',
      description: 'Starts mid-action: a cursor already moving, a command already typing.',
      visualType: 'product_ui',
      motion: 'cursor_sequence',
      camera: 'crop_push',
      durationRange: [2, 3.4],
      soundEntry: 'music_in',
      suitsHook: ['demonstration'],
    },
    {
      id: 'chaos_collapse',
      name: 'Chaos, then one thing',
      description: 'Many windows at once, collapsing into a single interface.',
      visualType: 'mixed_media',
      motion: 'window_explosion',
      camera: 'slow_pull',
      durationRange: [2.4, 4],
      soundEntry: 'riser',
      suitsHook: ['metaphor', 'question'],
    },
  ],

  archetypes: [
    {
      id: 'beat',
      purpose: 'One word or one phrase on the beat',
      visualType: 'kinetic_typography',
      motion: 'kinetic_headline',
      camera: 'static',
      durationRange: [0.6, 1.4],
      maxWords: 4,
      requiresProductAsset: false,
      soundCues: ['impact'],
    },
    {
      id: 'workflow',
      purpose: 'Show a real sequence of actions producing a result',
      visualType: 'product_ui',
      motion: 'product_sequence',
      camera: 'crop_push',
      durationRange: [2.2, 4.5],
      maxWords: 5,
      requiresProductAsset: true,
      soundCues: ['ui_click', 'ui_click'],
    },
    {
      id: 'annotated_ui',
      purpose: 'Point at the part of the screen that matters',
      visualType: 'screenshot_motion',
      motion: 'product_zoom',
      camera: 'crop_push',
      durationRange: [1.6, 3],
      maxWords: 7,
      requiresProductAsset: true,
      soundCues: ['whoosh'],
    },
    {
      id: 'stack',
      purpose: 'Three capabilities in the time most films spend on one',
      visualType: 'product_ui',
      motion: 'feature_stack',
      camera: 'lateral_drift',
      durationRange: [2.4, 4],
      maxWords: 9,
      requiresProductAsset: true,
      soundCues: ['ui_click', 'whoosh'],
    },
    {
      id: 'hold',
      purpose: 'Deliberately stop moving so the next cut lands',
      visualType: 'kinetic_typography',
      motion: 'hold',
      camera: 'static',
      durationRange: [1.2, 2.2],
      maxWords: 8,
      requiresProductAsset: false,
      soundCues: ['silence'],
    },
    {
      id: 'metric',
      purpose: 'A number, fast',
      visualType: 'statistic',
      motion: 'statistic_reveal',
      camera: 'static',
      durationRange: [1.2, 2.2],
      maxWords: 6,
      requiresProductAsset: false,
      soundCues: ['impact'],
    },
  ],

  transitions: [
    {
      from: ['kinetic_typography'],
      to: ['product_ui', 'screenshot_motion'],
      motion: 'hard_cut',
      durationSeconds: 0,
      weight: 4,
    },
    {
      from: ['product_ui', 'screenshot_motion'],
      to: ['kinetic_typography', 'statistic'],
      motion: 'mask_reveal',
      durationSeconds: 0.28,
      weight: 3,
    },
    {
      from: ['product_ui'],
      to: ['product_ui'],
      motion: 'split_screen',
      durationSeconds: 0.32,
      weight: 2,
    },
  ],

  endings: [
    {
      id: 'lockup',
      name: 'Hard lockup',
      motion: 'cta_end_card',
      durationRange: [2, 3],
      logoSeparate: false,
      soundCues: ['impact', 'logo_sting'],
    },
    {
      id: 'stop',
      name: 'Stop dead',
      motion: 'logo_reveal',
      durationRange: [1.6, 2.4],
      logoSeparate: true,
      soundCues: ['silence', 'logo_sting'],
    },
  ],

  pacing: {
    averageSceneSeconds: 2.1,
    sceneRange: [0.6, 4.5],
    // Deliberately high: this system lives or dies on the contrast between
    // rapid beats and held frames.
    longShortRatio: 0.85,
    defaultEasing: 'out_quint',
    silenceBudget: 1.2,
  },

  sound: {
    musicCharacter: 'Percussive, rhythmic, mid-tempo. The cut sits on the beat.',
    openOnMusic: true,
    uiSoundDensity: 'rhythmic',
    impactsOnCuts: true,
    endWithSting: true,
  },

  prohibitions: [
    'Never run more than four rapid beats without a held frame',
    'Never use the same transition twice in a row',
    'Never show a product screen for under 1.4 seconds — it cannot be read',
    'Never set display type in more than two lines',
  ],
};
