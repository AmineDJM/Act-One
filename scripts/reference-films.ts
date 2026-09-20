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
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { neutralRamp } from '@act-one/design';
import { resequence, type BrandSystem, type Scene, type Storyboard } from '@act-one/core';
import { renderFilm, type FilmProps } from '@act-one/motion';
import { runDeterministicChecks, verifyMaster } from '@act-one/qa';
import { getSystem } from '@act-one/creative';
import {
  DEFAULT_LIBRARY,
  buildMix,
  directSound,
  masterLoudness,
  mixArgs,
  muxArgs,
  runFfmpeg,
} from '@act-one/sound';

const OUT = path.resolve(process.cwd(), 'apps/web/public/work');
const STORAGE = process.env['ACT_ONE_STORAGE_DIR'] ?? path.resolve('.act-one-demo/storage');

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
    handovers: {},
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
      parentStoryboardId: null, revisionReason: '',
      claimEvidenceIds: [],
      notes: '',
      estimatedCostUsd: 0,
      motionRecipe: { name: 'word_reveal', easing: 'out_quint', delay: 0, stagger: 0.06, intensity: 0.6, params: {} },
      ...spec,
    })) as Scene[],
    voiceStrategy: 'none',
    language: null,
    heroShot: null,
    musicDirection,
    status: 'draft',
    parentStoryboardId: null, revisionReason: '',
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
      { duration: 2.2, visualType: 'kinetic_typography', purpose: 'Name the cost', onScreenText: ['Every Monday.'], motionRecipe: recipe('word_reveal', 'in_out_quart', 0.45, 0.08) },
      { duration: 4.0, visualType: 'transition', purpose: 'Turn', onScreenText: ['Then stop doing it.'], motionRecipe: recipe('mask_reveal', 'in_out_quart', 0.5, 0) },
      { duration: 1.9, visualType: 'kinetic_typography', purpose: 'State the shift', onScreenText: ['One run.'], motionRecipe: recipe('editorial_headline', 'in_out_quart', 0.5, 0) },
      { duration: 4.4, visualType: 'statistic', purpose: 'Land the proof', onScreenText: ['0', 'unmatched rows remaining'], claimEvidenceIds: ['evd_northwind_close'], motionRecipe: recipe('metric_reveal', 'out_quint', 0.5, 0) },
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
      { duration: 2.1, visualType: 'kinetic_typography', purpose: 'Hook', onScreenText: ['You have a question.'], motionRecipe: recipe('kinetic_headline', 'out_expo', 0.85, 0.03) },
      { duration: 2.4, visualType: 'kinetic_typography', purpose: 'Escalate', onScreenText: ['The data team has forty.'], motionRecipe: recipe('word_reveal', 'out_expo', 0.85, 0.03) },
      { duration: 1.7, visualType: 'kinetic_typography', purpose: 'The wait', onScreenText: ['Yours is forty-one.'], motionRecipe: recipe('editorial_headline', 'out_expo', 0.8, 0) },
      { duration: 2.1, visualType: 'transition', purpose: 'Break', onScreenText: ['Ask it here instead.'], motionRecipe: recipe('mask_reveal', 'out_expo', 0.8, 0) },
      { duration: 2.5, visualType: 'statistic', purpose: 'Proof', onScreenText: ['1.4s', 'from question to answer'], claimEvidenceIds: ['evd_meridian_latency'], motionRecipe: recipe('metric_reveal', 'out_expo', 0.8, 0) },
      { duration: 2.1, visualType: 'kinetic_typography', purpose: 'Reframe', onScreenText: ['No ticket. No queue.'], motionRecipe: recipe('kinetic_headline', 'out_expo', 0.85, 0.03) },
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
      { duration: 2.4, visualType: 'kinetic_typography', purpose: 'Or the night before', onScreenText: ['Or the night before that.'], motionRecipe: recipe('word_reveal', 'out_quint', 0.4, 0.05) },
      { duration: 5.2, visualType: 'quote', purpose: 'The turn', onScreenText: ['We have not been paged in eleven months.', 'Infrastructure lead, 200-person team'], claimEvidenceIds: ['evd_halyard_pages'], motionRecipe: recipe('quote_hold', 'out_quint', 0.4, 0) },
      { duration: 3.0, visualType: 'statistic', purpose: 'Proof', onScreenText: ['11', 'months since the last page'], claimEvidenceIds: ['evd_halyard_pages'], motionRecipe: recipe('metric_reveal', 'out_quint', 0.4, 0) },
      { duration: 2.0, visualType: 'kinetic_typography', purpose: 'The argument', onScreenText: ['Boring on purpose.'], motionRecipe: recipe('kinetic_headline', 'out_quint', 0.45, 0.04) },
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

export const FILMS = [
  { slug: 'northwind', props: northwind, posterAt: 1.2, system: 'cinematic_black' },
  { slug: 'meridian', props: meridian, posterAt: 0.9, system: 'kinetic_product' },
  { slug: 'halyard', props: halyard, posterAt: 1.4, system: 'editorial_tech' },
] as const;

const browserExecutable = process.env['ACT_ONE_CHROME_HEADLESS_SHELL'];

/*
 * Our own shop window is held to our own standards.
 *
 * These are hand-written rather than generated, which makes it easy for them
 * to quietly fall behind the rules every customer's film is checked against —
 * and a reference film that would fail QA is an advertisement for work we
 * would refuse to deliver. So they are checked before they are rendered, and a
 * failure stops the build rather than shipping to the marketing page.
 */
for (const film of FILMS) {
  const issues = runDeterministicChecks({
    storyboard: film.props.storyboard,
    brand: film.props.brand,
    aspect: '16:9',
    cta: film.props.cta,
    /*
     * The figures in these films cite evidence the way a real project's would.
     * The evidence is invented, because the companies are — and they are
     * labelled as fictional everywhere they appear, which is the difference
     * between a demonstration and a fabrication. Stripping the numbers instead
     * would make the shop window less like the product, and passing them
     * uncited would mean exempting ourselves from the rule we hold every
     * customer's film to.
     */
    knownEvidenceIds: new Set([
      'evd_northwind_close',
      'evd_meridian_latency',
      'evd_halyard_pages',
    ]),
  }).filter((issue) => issue.severity === 'hard_fail' || issue.severity === 'soft_fail');

  if (issues.length > 0) {
    console.error(`\n${film.slug} would not pass our own QA:`);
    for (const issue of issues) console.error(`  ${issue.severity} ${issue.check}: ${issue.message}`);
    process.exit(1);
  }
}
console.log(`${FILMS.length} reference films pass deterministic QA`);

await mkdir(OUT, { recursive: true });

for (const film of FILMS) {
  const started = Date.now();

  /*
   * Picture first, then the real sound chain.
   *
   * These used to ship with no audio stream at all — three silent films as the
   * shop window for a product whose sound design is half of what it makes. The
   * chain below is the pipeline's, not an approximation of it: the same Sound
   * Director reading the same creative system, the same mix graph with its
   * sidechain, and the same two-pass master. If the sound here is wrong, a
   * customer's film is wrong too, which is the whole point of these existing.
   */
  const silentPath = path.join(OUT, `${film.slug}.silent.mp4`);
  await renderFilm({
    props: film.props,
    aspect: '16:9',
    quality: 'hd',
    outputPath: silentPath,
    ...(browserExecutable ? { browserExecutable } : {}),
  });

  const design = directSound({
    storyboard: film.props.storyboard,
    behaviour: getSystem(film.system).sound,
    channel: 'web',
    hasVoiceOver: false,
  });

  const resolvedPaths = Object.fromEntries(
    [...DEFAULT_LIBRARY.music, ...DEFAULT_LIBRARY.sfx]
      .map((item) => [item.storageKey, path.join(STORAGE, item.storageKey)] as const)
      .filter(([, file]) => existsSync(file)),
  );

  const missing = [design.music?.storageKey, ...design.cues.map((cue) => cue.storageKey)]
    .filter((key): key is string => Boolean(key))
    .filter((key) => !resolvedPaths[key]);
  if (missing.length > 0) {
    console.error(`\n${film.slug} has no sound library to score with. Run \`npm run sound-library\`.`);
    process.exit(1);
  }

  const plan = buildMix({
    design,
    resolvedPaths,
    durationSeconds: film.props.storyboard.scenes.reduce((sum, scene) => sum + scene.duration, 0),
  });

  const premaster = path.join(OUT, `${film.slug}.premix.wav`);
  const mixed = await runFfmpeg(mixArgs(plan, premaster), { timeoutMs: 5 * 60_000 });
  if (!mixed.ok) throw new Error(`${film.slug} mix failed: ${mixed.stderr.slice(-400)}`);

  const mastered = path.join(OUT, `${film.slug}.mix.wav`);
  await masterLoudness({
    source: premaster,
    target: mastered,
    lufs: design.targetLufs,
    outputArgs: ['-c:a', 'pcm_s24le'],
  });

  const muxed = await runFfmpeg(
    muxArgs(silentPath, mastered, path.join(OUT, `${film.slug}.mp4`)),
    { timeoutMs: 5 * 60_000 },
  );
  if (!muxed.ok) throw new Error(`${film.slug} mux failed: ${muxed.stderr.slice(-400)}`);

  // The same gate every customer's master passes: the file has to say the
  // right things and decode end to end, or the shop window shows a film that
  // some visitors' browsers would refuse.
  const playable = await verifyMaster(path.join(OUT, `${film.slug}.mp4`), { width: 1920, height: 1080 });
  if (playable.issues.length > 0) {
    console.error(`\n${film.slug} would not play everywhere:`);
    for (const issue of playable.issues) console.error(`  ${issue}`);
    process.exit(1);
  }

  await Promise.all([rm(silentPath, { force: true }), rm(premaster, { force: true }), rm(mastered, { force: true })]);

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
