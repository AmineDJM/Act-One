/**
 * Renders the reference films shown on /work.
 *
 * These are our own demonstration projects for fictional companies, and they
 * are labelled as such everywhere they appear — presenting invented work as a
 * real client's launch is the exact dishonesty this product refuses to commit
 * on a customer's behalf, and it would be strange to do it on our own site.
 *
 * Written out by hand rather than generated on each run, for two reasons. The
 * copy on a marketing page should be something a person chose, and a reference
 * film that changes every time somebody runs a script is not a reference. What
 * this does exercise is the real thing: the real brand system, the real
 * creative systems, the real type and colour engines, the real renderer. If a
 * scene here looks wrong, a customer's film is wrong too.
 *
 *   npm run reference-films
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { neutralRamp } from '@act-one/design';
import { resequence, type BrandSystem, type Scene, type Storyboard } from '@act-one/core';
import { renderFilm, type FilmProps } from '@act-one/motion';

const OUT = path.resolve(process.cwd(), 'apps/web/public/work');

function brand(over: Partial<BrandSystem> & Pick<BrandSystem, 'id' | 'name' | 'primaryColor'>): BrandSystem {
  return {
    organizationId: 'org_reference',
    logo: null,
    logoVariants: [],
    secondaryColor: null,
    accentColors: [],
    primaryCandidates: [over.primaryColor],
    neutrals: neutralRamp(over.primaryColor, 9, 0.05),
    canvasDark: '#07080d',
    canvasLight: '#ffffff',
    typography: [],
    visualStyle: 'minimal',
    imageTreatment: 'none',
    layoutDensity: 'balanced',
    cornerStyle: 'subtle',
    cornerRadiusPx: 10,
    motionStyle: 'precise',
    tone: '',
    allowsGlow: false,
    allowsGradient: false,
    confirmedByUser: true,
    sources: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as BrandSystem;
}

type SceneSpec = Partial<Scene> & Pick<Scene, 'duration' | 'visualType' | 'purpose'>;

function storyboard(id: string, specs: SceneSpec[], musicDirection: string): Storyboard {
  return resequence({
    id: `sbd_${id}`,
    projectId: `prj_${id}`,
    conceptId: `cpt_${id}`,
    treatmentId: `trt_${id}`,
    version: 1,
    scenes: specs.map((spec, index) => ({
      id: `scn_${id}_${index}`,
      storyboardId: `sbd_${id}`,
      index,
      startTime: 0,
      narration: '',
      onScreenText: [],
      assetRefs: [],
      momentIds: [],
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
      motionRecipe: { name: 'word_reveal', easing: 'out_quint', delay: 0, stagger: 0.06, intensity: 0.6, params: {} },
      ...spec,
    })) as Scene[],
    voiceStrategy: 'none',
    musicDirection,
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

const recipe = (
  name: Scene['motionRecipe']['name'],
  easing: Scene['motionRecipe']['easing'],
  intensity = 0.6,
  stagger = 0.05,
): Scene['motionRecipe'] => ({ name, easing, delay: 0, stagger, intensity, params: {} });

/*
 * Cinematic Black: long holds, one idea per frame, nothing moves that does not
 * have to. The argument is made by what is withheld.
 */
const northwind: FilmProps = {
  brand: brand({
    id: 'brd_northwind',
    name: 'Northwind',
    primaryColor: '#3d7bfd',
    canvasDark: '#07080d',
    motionStyle: 'cinematic',
    tone: 'Plain-spoken and confident.',
  }),
  storyboard: storyboard(
    'northwind',
    [
      { duration: 3.4, visualType: 'kinetic_typography', purpose: 'Open on the problem', onScreenText: ['Forty unmatched rows.'], motionRecipe: recipe('kinetic_headline', 'in_out_quart', 0.45, 0.06) },
      { duration: 3.0, visualType: 'kinetic_typography', purpose: 'Name the cost', onScreenText: ['Every Monday.'], motionRecipe: recipe('word_reveal', 'in_out_quart', 0.45, 0.08) },
      { duration: 2.8, visualType: 'transition', purpose: 'Turn', onScreenText: ['Then stop doing it.'], motionRecipe: recipe('mask_reveal', 'in_out_quart', 0.5, 0) },
      { duration: 3.2, visualType: 'kinetic_typography', purpose: 'State the shift', onScreenText: ['One run.'], motionRecipe: recipe('editorial_headline', 'in_out_quart', 0.5, 0) },
      { duration: 3.4, visualType: 'statistic', purpose: 'Land the proof', onScreenText: ['0', 'unmatched rows remaining'], motionRecipe: recipe('metric_reveal', 'out_quint', 0.5, 0) },
      { duration: 3.6, visualType: 'logo_reveal', purpose: 'Sign off', onScreenText: ['Close the books while you sleep.'], motionRecipe: recipe('cta_end_card', 'out_quint', 0.45, 0) },
    ],
    'Sparse, sub-heavy, one impact on the turn.',
  ),
  assetUrls: {},
  watermarkLabel: null,
  cta: 'northwind.example',
  tagline: 'Close the books while you sleep.',
  theme: 'dark',
};

/*
 * Kinetic Product: fast, stacked, impatient. Cuts land on the beat and the
 * film is over before it outstays the idea.
 */
const meridian: FilmProps = {
  brand: brand({
    id: 'brd_meridian',
    name: 'Meridian',
    primaryColor: '#5b7cfa',
    canvasDark: '#0a0b14',
    motionStyle: 'snappy',
    layoutDensity: 'dense',
    tone: 'Direct. Leads with the claim.',
  }),
  storyboard: storyboard(
    'meridian',
    [
      { duration: 1.6, visualType: 'kinetic_typography', purpose: 'Hook', onScreenText: ['You have a question.'], motionRecipe: recipe('kinetic_headline', 'out_expo', 0.85, 0.03) },
      { duration: 1.5, visualType: 'kinetic_typography', purpose: 'Escalate', onScreenText: ['The data team has forty.'], motionRecipe: recipe('word_reveal', 'out_expo', 0.85, 0.03) },
      { duration: 1.4, visualType: 'kinetic_typography', purpose: 'The wait', onScreenText: ['Yours is number forty-one.'], motionRecipe: recipe('editorial_headline', 'out_expo', 0.8, 0) },
      { duration: 2.0, visualType: 'transition', purpose: 'Break', onScreenText: ['Ask it here instead.'], motionRecipe: recipe('mask_reveal', 'out_expo', 0.8, 0) },
      { duration: 2.2, visualType: 'statistic', purpose: 'Proof', onScreenText: ['1.4s', 'from question to answer'], motionRecipe: recipe('metric_reveal', 'out_expo', 0.8, 0) },
      { duration: 1.8, visualType: 'kinetic_typography', purpose: 'Reframe', onScreenText: ['No ticket. No queue.'], motionRecipe: recipe('kinetic_headline', 'out_expo', 0.85, 0.03) },
      { duration: 3.0, visualType: 'logo_reveal', purpose: 'Sign off', onScreenText: ['Stop asking the data team.'], motionRecipe: recipe('cta_end_card', 'out_expo', 0.7, 0) },
    ],
    'Driving pulse, hard cut on every line.',
  ),
  assetUrls: {},
  watermarkLabel: null,
  cta: 'meridian.example',
  tagline: 'Stop asking the data team.',
  theme: 'dark',
};

/*
 * Editorial Tech: set like a page rather than a slide. The joke is that the
 * product is dull, so the film refuses to oversell it.
 */
const halyard: FilmProps = {
  brand: brand({
    id: 'brd_halyard',
    name: 'Halyard',
    primaryColor: '#1d1d20',
    canvasDark: '#f4f5f8',
    canvasLight: '#f4f5f8',
    motionStyle: 'precise',
    layoutDensity: 'airy',
    cornerStyle: 'sharp',
    cornerRadiusPx: 2,
    tone: 'Dry. Understated on purpose.',
  }),
  storyboard: storyboard(
    'halyard',
    [
      { duration: 3.0, visualType: 'kinetic_typography', purpose: 'Open flat', onScreenText: ['Nothing happened last night.'], motionRecipe: recipe('editorial_headline', 'out_quint', 0.4, 0) },
      { duration: 2.8, visualType: 'kinetic_typography', purpose: 'Or the night before', onScreenText: ['Or the night before that.'], motionRecipe: recipe('word_reveal', 'out_quint', 0.4, 0.05) },
      { duration: 3.2, visualType: 'quote', purpose: 'The turn', onScreenText: ['We have not been paged in eleven months.', 'Infrastructure lead, 200-person team'], motionRecipe: recipe('quote_hold', 'out_quint', 0.4, 0) },
      { duration: 3.0, visualType: 'statistic', purpose: 'Proof', onScreenText: ['11', 'months since the last page'], motionRecipe: recipe('metric_reveal', 'out_quint', 0.4, 0) },
      { duration: 2.8, visualType: 'kinetic_typography', purpose: 'The argument', onScreenText: ['Boring on purpose.'], motionRecipe: recipe('kinetic_headline', 'out_quint', 0.45, 0.04) },
      { duration: 3.4, visualType: 'logo_reveal', purpose: 'Sign off', onScreenText: ['Infrastructure that stays quiet.'], motionRecipe: recipe('cta_end_card', 'out_quint', 0.4, 0) },
    ],
    'Almost none. Room tone and one soft mark.',
  ),
  assetUrls: {},
  watermarkLabel: null,
  cta: 'halyard.example',
  tagline: 'Infrastructure that stays quiet.',
  theme: 'light',
};

const FILMS = [
  { slug: 'northwind', props: northwind, posterAt: 1.2 },
  { slug: 'meridian', props: meridian, posterAt: 0.9 },
  { slug: 'halyard', props: halyard, posterAt: 1.4 },
] as const;

const browserExecutable = process.env['ACT_ONE_CHROME_HEADLESS_SHELL'];

await mkdir(OUT, { recursive: true });

for (const film of FILMS) {
  const started = Date.now();

  await renderFilm({
    props: film.props,
    aspect: '16:9',
    quality: 'hd',
    outputPath: path.join(OUT, `${film.slug}.mp4`),
    ...(browserExecutable ? { browserExecutable } : {}),
  });

  // A poster held a beat after the first cut, so the card shows the film
  // composed rather than the frame before anything has moved.
  await renderFilm({
    props: film.props,
    aspect: '16:9',
    quality: 'hd',
    outputPath: path.join(OUT, `${film.slug}.png`),
    stillAtSeconds: film.posterAt,
    ...(browserExecutable ? { browserExecutable } : {}),
  });

  const seconds = film.props.storyboard.scenes.reduce((sum, scene) => sum + scene.duration, 0);
  console.log(`${film.slug.padEnd(10)} ${seconds.toFixed(1)}s film + poster in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

console.log(`\nWritten to ${OUT}`);
