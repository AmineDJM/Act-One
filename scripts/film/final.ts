/**
 * The film.
 *
 * WHAT THE EVIDENCE SAID, BEFORE ANY OF THIS WAS WRITTEN. Three creative
 * directions and the existing baseline went to a video model that watched the
 * real files and, separately, to a vision model from another vendor that read
 * stills and never saw the first model's answer. All four films came back the
 * same way from the second: generic SaaS, would not ship. The reasons were
 * identical across all four and none of them was about colour or placement:
 *
 *   "no memorable visual device"
 *   "no bespoke illustration"
 *   "typography is safe rather than exquisite"
 *   "frames that work as posters" — absent
 *   "no sophisticated transitions"
 *
 * That is one finding stated five ways. Every film this system made was type
 * over a screenshot, because type and screenshots were the only things it
 * could actually put on screen. Polishing a fourth variant of that would have
 * been answering a different criticism than the one received.
 *
 * SO THIS FILM CONTAINS THREE THINGS NO PREVIOUS CUT COULD.
 *
 * A real shot. Four seconds commissioned from a video model against a sealed
 * brief — hands leaving a desk at dusk, one practical lamp, cold coffee,
 * scattered paper — carrying no interface, no text and no logo, because a
 * model may build the world the product lives in and may never build the
 * product. It is the "before" the rest of the film is measured against, and
 * it is the only thing here with texture in it.
 *
 * A graphic system. The measure: a run of ticks over a rule, dense at the
 * left, that COLLAPSES rather than cutting. Built from the scene language's
 * own primitives rather than drawn by a model, and that was a decision made
 * after trying the other way twice — an illustration model asked for flat
 * orthographic geometry returned a tablet in perspective, then two rulers in
 * perspective. It illustrates; it does not draft. Forty rectangles the film
 * can recolour, place on the grid and animate individually are exactly right
 * and a generated approximation of them is not.
 *
 * A transformation instead of a cut. The measure does not dissolve into the
 * next shot: the ticks that spanned six weeks slide together into the space
 * of one afternoon while the rule stays put. That is the one moment in the
 * film that is neither type nor screenshot, and it is the argument.
 *
 *   ACT_ONE_MANAGED_CREDENTIALS=all npm run final
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  BrandSystem,
  CapabilityRegistry,
  SceneGraph,
  Transform,
  inspectScenes,
  routeScene,
  type SceneObject,
} from '@act-one/core';
import { neutralRamp } from '@act-one/design';
import { EASINGS, renderScenes } from '@act-one/motion';
import {
  DEFAULT_LIBRARY,
  buildMix,
  masterLoudness,
  mixArgs,
  muxArgs,
  runFfmpeg,
  soundForScenes,
} from '@act-one/sound';

type Graph = ReturnType<typeof SceneGraph.parse>;

const STORAGE = process.env['ACT_ONE_STORAGE_DIR'] ?? path.resolve('.act-one-demo/storage');
const BASE = process.env['ACT_ONE_CAPTURE_BASE'] ?? 'http://localhost:3000/capture';
const PUBLIC = path.resolve('apps/web/public/capture');

const INK = '#12131A';
const PAPER = '#F2F0EA';
const ACCENT = '#FF4D1F';

const ASSETS: Record<string, string> = Object.fromEntries(
  (['home', 'how', 'work', 'pricing', 'home_hero', 'how_stages', 'work_films', 'pricing_terms'] as const)
    .filter((name) => existsSync(path.join(PUBLIC, `${name}.png`)))
    .map((name) => [`ast_${name}`, `${BASE}/${name}.png`]),
);
if (existsSync(path.join(PUBLIC, 'before.mp4'))) ASSETS['ast_before'] = `${BASE}/before.mp4`;

const brand = BrandSystem.parse({
  id: 'brn_final', organizationId: 'org_final', name: 'Act One',
  primaryColor: ACCENT,
  secondaryColor: neutralRamp(ACCENT, 9, 0.05)[6] ?? ACCENT,
  primaryCandidates: [ACCENT], neutrals: neutralRamp(ACCENT, 9, 0.05),
  canvasDark: INK, canvasLight: PAPER,
  visualStyle: 'editorial', motionStyle: 'precise',
  cornerStyle: 'sharp', cornerRadiusPx: 0,
  confirmedByUser: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

// ---------------------------------------------------------------------------
// The measure
// ---------------------------------------------------------------------------

/**
 * Where the nth tick of the measure stands, at rest and collapsed.
 *
 * Six weeks reads as thirty working days, so thirty ticks. At rest they span
 * most of the frame; collapsed they occupy the width of one afternoon, which
 * is a thirtieth of that and is why the collapse is legible as an argument
 * rather than as an animation.
 */
const TICKS = 30;
const SPREAD_FROM = 0.14;
const SPREAD_TO = 0.86;
const GATHERED_AT = 0.16;
const GATHERED_WIDTH = 0.05;

const tick = (index: number, ruleY: number): SceneObject => {
  const t = index / (TICKS - 1);
  const spread = SPREAD_FROM + t * (SPREAD_TO - SPREAD_FROM);
  const gathered = GATHERED_AT + t * GATHERED_WIDTH;
  // Taller every fifth, the way a real scale marks its weeks.
  const height = index % 5 === 0 ? 0.075 : 0.042;
  return {
    kind: 'shape', id: `tick_${index}`, shape: 'rect',
    width: 0.0022, height,
    // Brand tokens rather than hex, so the film recolours with the brand
    // instead of carrying a palette nobody can change.
    fill: index % 5 === 0 ? 'accent' : 'onCanvas.primary',
    stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
    role: 'structure',
    reason: 'One day of the six weeks, as a mark on the measure.',
    /*
     * Staggered, so the measure gathers from the far end rather than sliding
     * as one block. A block moving is a graphic; ticks arriving one after
     * another is time being compressed, which is the thing the film is about.
     */
    enterAt: 0.06 + index * 0.012,
    transform: Transform.parse({
      x: { keyframes: [{ t: 0, value: spread }, { t: 0.52, value: spread }, { t: 1, value: gathered, curve: 'in_out_quart' }], curve: 'in_out_quart' },
      y: ruleY - height / 2 - 0.006,
      anchor: { x: 0.5, y: 1 },
      opacity: { from: 0, to: 1, curve: 'out_cubic' },
    }),
  } as SceneObject;
};

const measure = (ruleY: number): SceneObject[] => [
  ...Array.from({ length: TICKS }, (_, i) => tick(i, ruleY)),
  {
    kind: 'shape', id: 'measure_rule', shape: 'rect',
    width: { from: 0, to: SPREAD_TO - SPREAD_FROM + 0.02, curve: 'out_expo' },
    height: 0.0022,
    fill: 'onCanvas.primary', stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
    role: 'structure',
    reason: 'The rule the measure is drawn on. It never moves, so the collapse is visible against it.',
    transform: Transform.parse({ x: SPREAD_FROM - 0.01, y: ruleY, anchor: { x: 0, y: 0.5 } }),
  } as SceneObject,
];

const line = (
  id: string, content: string, over: Record<string, unknown>, transform: Record<string, unknown>,
): SceneObject =>
  ({
    kind: 'text', id, content, token: 'display', color: 'onCanvas.primary',
    align: 'left', maxWidth: 0.42, maxLines: 2, staggerBy: 'none', staggerSeconds: 0,
    role: 'payload', reason: 'The line of the beat.',
    transform: Transform.parse(transform),
    ...over,
  }) as SceneObject;

// ---------------------------------------------------------------------------
// The film
// ---------------------------------------------------------------------------

const RULE_Y = 0.62;

const scenes: Graph[] = [
  SceneGraph.parse({
    id: 'f1', durationSeconds: 3.4,
    intent: 'BEFORE: a real room, somebody leaving a desk they have been at too long.',
    background: INK,
    camera: { scale: { from: 1.06, to: 1.0, curve: 'out_expo' }, focalLengthMm: 40 },
    objects: [
      {
        kind: 'clip', id: 'f1_room', assetId: 'ast_before',
        crop: { x: 0, y: 0, width: 1, height: 1 },
        width: 1.14, sourceInSeconds: 0.2, playbackRate: 0.85, generated: true,
        role: 'payload',
        reason: 'The world the product lives in, shot rather than drawn. No interface appears in it.',
        transform: Transform.parse({ x: 0.5, y: 0.5, anchor: { x: 0.5, y: 0.5 } }),
      } as SceneObject,
    ],
    audio: [{ at: 0.1, kind: 'texture', intensity: 0.4, causedBy: 'f1_room', reason: 'Room tone under the shot.' }],
    handover: { mechanism: 'field_change', carries: [], durationSeconds: 0.3, reason: 'The room gives way to the page.' },
    macro: null,
  }),

  SceneGraph.parse({
    id: 'f2', durationSeconds: 4.6,
    intent: 'THE MEASURE: thirty days drawn across the page, and the claim against them.',
    background: PAPER,
    camera: { scale: { from: 1.03, to: 1.0, curve: 'out_expo' }, focalLengthMm: 70 },
    objects: [
      ...measure(RULE_Y),
      /*
        * Set high and given room to sit on one line.
        *
        * At y = 0.46 with a 0.34 wrap width the sub-line broke to two lines and
        * the second one landed directly on the ticks — type and measure sharing
        * the same band of the frame, which reads as a collision rather than as
        * a caption.
        */
      line('f2_line', 'Six weeks', { color: 'onCanvas.primary', maxWidth: 0.4 },
        { x: 0.14, y: 0.3, anchor: { x: 0, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_expo' } }),
      line('f2_sub', 'to make one launch film.', { token: 'statement', color: 'onCanvas.secondary', maxWidth: 0.44 },
        { x: 0.14, y: 0.395, anchor: { x: 0, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_cubic' } }),
    ],
    audio: [
      { at: 0.1, kind: 'ui_click', intensity: 0.35, causedBy: 'measure_rule', reason: 'The rule is drawn.' },
      { at: 2.6, kind: 'riser', intensity: 0.55, causedBy: 'tick_29', reason: 'The measure fills; something is about to give.' },
    ],
    /*
     * The ticks are named as carried, so the handover is a fact in the graph
     * rather than a claim in a comment: these objects survive the boundary,
     * which is what makes the next shot a transformation and not a cut.
     */
    handover: {
      mechanism: 'object_handoff',
      carries: ['measure_rule', 'tick_0', 'tick_29'],
      durationSeconds: 0.35,
      reason: 'The measure is the same measure; only its spacing changes.',
    },
    macro: null,
  }),

  SceneGraph.parse({
    id: 'f3', durationSeconds: 3.6,
    intent: 'THE HERO MOMENT: the same thirty marks gather into the width of an afternoon.',
    background: PAPER,
    camera: { scale: { from: 1.0, to: 1.05, curve: 'in_out_cubic' }, focalLengthMm: 70 },
    objects: [
      /*
       * The same objects, entering already gathered and holding.
       *
       * Carried by id from the previous scene rather than redrawn, so the two
       * shots are one continuous measure. The rule keeps its full width while
       * the ticks sit inside a twentieth of it, and that gap between what the
       * scale measures and what the work now takes is the whole film in one
       * frame.
       */
      {
        kind: 'shape', id: 'measure_rule', shape: 'rect',
        width: SPREAD_TO - SPREAD_FROM + 0.02, height: 0.0022,
        fill: 'onCanvas.primary', stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
        role: 'structure', reason: 'The same rule, unchanged, so the collapse has something to be measured against.',
        transform: Transform.parse({ x: SPREAD_FROM - 0.01, y: RULE_Y, anchor: { x: 0, y: 0.5 } }),
      } as SceneObject,
      ...Array.from({ length: TICKS }, (_, index) => {
        const t = index / (TICKS - 1);
        const height = index % 5 === 0 ? 0.075 : 0.042;
        return {
          kind: 'shape', id: `tick_${index}`, shape: 'rect',
          width: 0.0022, height,
          fill: index % 5 === 0 ? 'accent' : 'onCanvas.primary',
          stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
          role: 'structure', reason: 'The same day, now inside one afternoon.',
          transform: Transform.parse({
            x: GATHERED_AT + t * GATHERED_WIDTH,
            y: RULE_Y - height / 2 - 0.006,
            anchor: { x: 0.5, y: 1 },
          }),
        } as SceneObject;
      }),
      line('f3_line', 'One afternoon.', { color: 'accent', maxWidth: 0.44 },
        { x: 0.14, y: 0.3, anchor: { x: 0, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_expo' }, scale: { from: 0.97, to: 1, curve: 'out_expo' } }),
    ],
    audio: [{ at: 0.02, kind: 'sub_drop', intensity: 0.8, causedBy: 'f3_line', reason: 'The marks land together.' }],
    handover: { mechanism: 'mask_reveal', carries: [], durationSeconds: 0.3, reason: 'The page opens onto the product.' },
    macro: null,
  }),

  SceneGraph.parse({
    id: 'f4', durationSeconds: 4.4,
    intent: 'THE PRODUCT: the real thing, full-bleed and legible, after a film of abstractions.',
    background: PAPER,
    camera: { scale: { from: 1.04, to: 1.0, curve: 'out_quint' }, x: { from: 0.012, to: -0.012, curve: 'in_out_cubic' }, focalLengthMm: 55 },
    objects: [
      {
        kind: 'ui_layer', id: 'f4_product', assetId: 'ast_home_hero',
        /*
         * Cropped in from the capture's own edges.
         *
         * An independent reviewer found two things in this shot before it
         * found anything else: "product mockup is cut off on the right, with a
         * partial white letter visible" and "bottom paragraph is clipped, line
         * ends mid-thought". Both were in the capture itself — a sliver of the
         * next card at the right edge, and a paragraph the crop cut through.
         * A plate is a framing decision, and framing through the middle of a
         * word is the thing that reads as a mistake rather than as a choice.
         */
        crop: { x: 0, y: 0, width: 0.86, height: 0.88 },
        /*
         * Sized so the page still shows under it.
         *
         * At 1.1 frames wide this capture is 0.84 of the frame tall, which put
         * its bottom edge at 0.88 and left the caption sitting ON the product's
         * own body copy — dark type on a dark interface, two paragraphs deep in
         * each other. A plate on a page has a page around it; that margin is
         * where the caption lives.
         */
        width: 0.92, cornerRadiusPx: 0, shadow: false, semantic: 'hero',
        role: 'payload',
        reason: 'A real capture of the real interface, set as the one full plate in the film.',
        transform: Transform.parse({ x: 0.5, y: 0.42, anchor: { x: 0.5, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_cubic' } }),
      } as SceneObject,
      line('f4_tag', 'The real thing, rendered.', { token: 'statement', color: 'onCanvas.primary', maxWidth: 0.4 },
        { x: 0.14, y: 0.88, anchor: { x: 0, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_cubic' } }),
    ],
    audio: [{ at: 0.06, kind: 'whoosh', intensity: 0.55, causedBy: 'f4_product', reason: 'The product arrives.' }],
    handover: { mechanism: 'field_change', carries: [], durationSeconds: 0.25, reason: 'The page turns to ink for the mark.' },
    macro: null,
  }),

  SceneGraph.parse({
    id: 'f5', durationSeconds: 2.8,
    intent: 'THE MARK: ink, the name, and the measure reduced to the one tick that is left.',
    background: INK,
    camera: { scale: { from: 1.05, to: 1.0, curve: 'out_expo' }, focalLengthMm: 85 },
    objects: [
      line('f5_mark', 'Act One', { color: 'onCanvas.primary', maxWidth: 0.34 },
        { x: 0.14, y: 0.48, anchor: { x: 0, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_expo' }, scale: { from: 0.97, to: 1, curve: 'out_expo' } }),
      /*
       * One tick, the last survivor of the measure, set where the collapsed
       * run stood. The film's own punctuation rather than a logo lockup: the
       * mark is asymmetric and low-left, which is the composition the whole
       * film has used, and not the centred wordmark every one of these ends on.
       */
      {
        kind: 'shape', id: 'f5_tick', shape: 'rect',
        width: 0.004, height: { from: 0, to: 0.1, curve: 'out_expo' },
        fill: 'accent', stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
        role: 'structure', enterAt: 0.45,
        reason: 'The one mark left of the six weeks.',
        transform: Transform.parse({ x: 0.14, y: 0.57, anchor: { x: 0, y: 0 } }),
      } as SceneObject,
    ],
    audio: [{ at: 0.2, kind: 'logo_sting', intensity: 0.6, causedBy: 'f5_mark', reason: 'The mark.' }],
    macro: null,
  }),
];

// ---------------------------------------------------------------------------

const seconds = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
console.log(`=== the film: ${seconds.toFixed(1)}s, ${scenes.length} shots ===`);

const registry = new CapabilityRegistry();
let problems = 0;
for (const scene of scenes) {
  const routing = routeScene(scene, registry);
  problems += routing.problems.length;
  for (const problem of routing.problems) console.log(`  ROUTE ${scene.id}/${problem.objectId}: ${problem.message}`);
}
const findings = inspectScenes(scenes, EASINGS, { registry });
for (const f of findings) console.log(`  ${f.severity.padEnd(9)} ${f.check.padEnd(24)} ${f.sceneId} ${f.message.slice(0, 96)}`);
if (problems > 0 || findings.some((f) => f.severity === 'hard_fail')) {
  console.log('  refusing to render');
  process.exit(1);
}

const silent = path.resolve('.renders/final.silent.mp4');
const out = path.resolve('.renders/final.mp4');
const started = Date.now();
const result = await renderScenes({
  scenes, brand, assetUrls: ASSETS,
  aspect: '16:9',
  quality: (process.env['ACT_ONE_QUALITY'] as 'preview' | 'hd' | undefined) ?? 'hd',
  outputPath: silent, concurrency: 3, theme: 'light',
});
console.log(`  rendered in ${((Date.now() - started) / 1000).toFixed(0)}s`);
if (result.undecodable.length) console.log('  undecodable:', result.undecodable);

const design = soundForScenes(scenes, {
  behaviour: { musicCharacter: 'restrained', openOnMusic: false, uiSoundDensity: 'sparse', impactsOnCuts: true, endWithSting: true },
  channel: 'web',
});
const resolved = Object.fromEntries(
  [...DEFAULT_LIBRARY.music, ...DEFAULT_LIBRARY.sfx]
    .map((item) => [item.storageKey, path.join(STORAGE, item.storageKey)] as const)
    .filter(([, file]) => existsSync(file)),
);
const plan = buildMix({ design, resolvedPaths: resolved, durationSeconds: seconds });
const premix = path.resolve('.renders/final.premix.wav');
const mixed = await runFfmpeg(mixArgs(plan, premix), { timeoutMs: 5 * 60_000 });
if (!mixed.ok) throw new Error(`mix failed: ${mixed.stderr.slice(-300)}`);

const master = path.resolve('.renders/final.mix.wav');
await masterLoudness({ source: premix, target: master, lufs: design.targetLufs, outputArgs: ['-c:a', 'pcm_s24le'] });

const muxed = await runFfmpeg(muxArgs(silent, master, out), { timeoutMs: 5 * 60_000 });
if (!muxed.ok) throw new Error(`mux failed: ${muxed.stderr.slice(-300)}`);
console.log(`  ${design.cues.length} cues, ${design.targetLufs} LUFS -> ${out}`);
