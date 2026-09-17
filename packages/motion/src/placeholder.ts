import { neutralRamp } from '@act-one/design';
import { resequence, type BrandSystem, type Scene, type Storyboard } from '@act-one/core';
import type { FilmProps } from './Film.tsx';

/**
 * A film used only by Remotion Studio so compositions have something to show.
 *
 * Explicitly fictional. It exists so a developer opening the studio sees the
 * motion system working, and it is never rendered for a customer — the render
 * worker always supplies real input props.
 */
const brand: BrandSystem = {
  id: 'brd_placeholder',
  organizationId: 'org_placeholder',
  name: 'Northwind',
  logo: null,
  logoVariants: [],
  primaryColor: '#3d7bfd',
  secondaryColor: '#9ab8ff',
  accentColors: [],
  primaryCandidates: ['#3d7bfd'],
  neutrals: neutralRamp('#3d7bfd', 9, 0.05),
  canvasDark: '#07080d',
  canvasLight: '#ffffff',
  typography: [],
  visualStyle: 'minimal',
  imageTreatment: 'none',
  layoutDensity: 'balanced',
  cornerStyle: 'subtle',
  cornerRadiusPx: 10,
  motionStyle: 'precise',
  tone: 'Plain-spoken and confident.',
  allowsGlow: false,
  allowsGradient: false,
  confirmedByUser: true,
  sources: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function scene(over: Partial<Scene> & Pick<Scene, 'id' | 'duration' | 'visualType' | 'purpose'>): Scene {
  return {
    storyboardId: 'sbd_placeholder',
    index: 0,
    startTime: 0,
    narration: '',
    onScreenText: [],
    assetRefs: [],
    momentIds: [],
    motionRecipe: { name: 'word_reveal', easing: 'out_quint', delay: 0, stagger: 0.06, intensity: 0.6, params: {} },
    cameraRecipe: {
      move: 'static', fromScale: 1, toScale: 1, fromX: 0, toX: 0, fromY: 0, toY: 0,
      motionBlur: 0.1, depthOfField: 0, easing: 'in_out_quart',
    },
    soundCues: [],
    voiceOver: false,
    generativeNeeds: [],
    threeDSceneId: null,
    status: 'draft',
    claimEvidenceIds: [],
    notes: '',
    estimatedCostUsd: 0,
    ...over,
  };
}

const storyboard: Storyboard = resequence({
  id: 'sbd_placeholder',
  projectId: 'prj_placeholder',
  conceptId: 'cpt_placeholder',
  treatmentId: 'trt_placeholder',
  version: 1,
  scenes: [
    scene({
      id: 'scn_1',
      duration: 3.2,
      visualType: 'kinetic_typography',
      purpose: 'Open on the problem',
      onScreenText: ['Forty unmatched rows.'],
      motionRecipe: { name: 'kinetic_headline', easing: 'out_expo', delay: 0, stagger: 0.045, intensity: 0.8, params: {} },
    }),
    scene({
      id: 'scn_2',
      duration: 2.6,
      visualType: 'kinetic_typography',
      purpose: 'State the shift',
      onScreenText: ['One run.'],
      motionRecipe: { name: 'editorial_headline', easing: 'out_expo', delay: 0, stagger: 0, intensity: 0.6, params: {} },
    }),
    scene({
      id: 'scn_3',
      duration: 3,
      visualType: 'statistic',
      purpose: 'Land the proof',
      onScreenText: ['0', 'unmatched rows remaining'],
      motionRecipe: { name: 'metric_reveal', easing: 'out_quint', delay: 0, stagger: 0, intensity: 0.6, params: {} },
    }),
    scene({
      id: 'scn_4',
      duration: 3,
      visualType: 'logo_reveal',
      purpose: 'Sign off',
      motionRecipe: { name: 'cta_end_card', easing: 'out_quint', delay: 0, stagger: 0, intensity: 0.5, params: {} },
      onScreenText: ['Close the books while you sleep.'],
    }),
  ],
  voiceStrategy: 'none',
  musicDirection: 'Sparse, sub-heavy.',
  status: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

export const PLACEHOLDER_FILM_PROPS: FilmProps = {
  storyboard,
  brand,
  assetUrls: {},
  watermarkLabel: null,
  cta: 'northwind.example',
  tagline: 'Close the books while you sleep.',
};
