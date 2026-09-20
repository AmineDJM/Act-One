/**
 * Three directions for the same fifteen seconds, and no family resemblance.
 *
 * The brief was a film that does not look like Act One's films, and the
 * diagnosis was specific: the recipe renderer composes almost everything at
 * `center_left` — one call site is literally `index === 0 ? 'center_left' :
 * 'center_left'` — and `preferredTheme` returns dark for every visual style
 * except editorial and playful. Three placements and one canvas is not a
 * house style, it is a ceiling, and every film that went through it arrived
 * on a near-black field with a line of type on the left.
 *
 * So none of these go through it. All three are scene graphs, where position
 * is a number, depth is a number and the background is a decision. They are
 * built to disagree with each other on the things that actually make films
 * look different:
 *
 *   PAPER    a light editorial field. Type as the image, at four scales.
 *            The interface arrives as printed plates on a page. Masks wipe.
 *
 *   DEPTH    the product taken apart and flown through. Many layers, real
 *            parallax, a camera that passes between them. Dark, but a lit
 *            dark rather than a black one.
 *
 *   FIELD    full-frame colour as punctuation. Chapters of flat colour, hard
 *            cuts on the beat, one enormous word at a time.
 *
 * They differ in canvas, in spatial logic, in what the UI is for, in how a
 * boundary works, and in pace. If all three still came out dark with a line
 * of type on the left, the constraint would not be the Director and there
 * would be no point polishing any of them.
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import {
  BrandSystem, CapabilityRegistry, SceneGraph, Transform,
  inspectScenes, routeScene, type SceneGraph as Graph, type SceneObject,
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

const STORAGE = process.env['ACT_ONE_STORAGE_DIR'] ?? path.resolve('.act-one-demo/storage');
const CAPTURE_BASE = process.env['ACT_ONE_CAPTURE_BASE'] ?? 'http://localhost:3000/capture';
const CAPTURES = path.resolve('apps/web/public/capture');
const ASSETS: Record<string, string> = Object.fromEntries(
  ['home', 'how', 'work', 'pricing', 'home_hero', 'how_stages', 'work_films', 'pricing_terms']
    .filter((name) => existsSync(path.join(CAPTURES, `${name}.png`)))
    .map((name) => [`ast_${name}`, `${CAPTURE_BASE}/${name}.png`]),
);

const INK = '#12131A';
const PAPER = '#F2F0EA';
const ACCENT = '#FF4D1F';
const DEEP = '#0B1A2E';
const BLUE = '#3D7BFF';

function brandFor(primary: string, canvasDark: string, style: 'minimal' | 'editorial' | 'bold'): BrandSystem {
  return BrandSystem.parse({
    id: `brn_${style}`, organizationId: 'org_dir', name: 'Act One',
    primaryColor: primary,
    secondaryColor: neutralRamp(primary, 9, 0.05)[6] ?? primary,
    primaryCandidates: [primary], neutrals: neutralRamp(primary, 9, 0.05),
    canvasDark, canvasLight: PAPER,
    visualStyle: style,
    motionStyle: style === 'bold' ? 'snappy' : style === 'editorial' ? 'precise' : 'cinematic',
    cornerStyle: style === 'editorial' ? 'sharp' : 'subtle',
    cornerRadiusPx: style === 'editorial' ? 0 : 8,
    confirmedByUser: true,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

const text = (
  id: string, content: string,
  over: Record<string, unknown>, transform: Record<string, unknown>,
): SceneObject =>
  ({
    kind: 'text', id, content, token: 'display', color: 'onCanvas.primary',
    align: 'left', maxWidth: 0.8, maxLines: 3, staggerBy: 'none', staggerSeconds: 0,
    role: 'payload', reason: 'The line of the beat.',
    transform: Transform.parse(transform),
    ...over,
  }) as SceneObject;

const plate = (
  id: string, asset: string, crop: Record<string, unknown>,
  transform: Record<string, unknown>, over: Record<string, unknown> = {},
): SceneObject =>
  ({
    kind: 'ui_layer', id, assetId: asset, crop, semantic: id,
    width: 0.4, cornerRadiusPx: 0, shadow: true,
    role: 'support', reason: 'A real region of the real interface.',
    transform: Transform.parse(transform),
    ...over,
  }) as SceneObject;

const rule = (id: string, transform: Record<string, unknown>, over: Record<string, unknown> = {}): SceneObject =>
  ({
    kind: 'shape', id, shape: 'rect', width: 0.5, height: 0.004,
    fill: 'onCanvas.primary', stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
    role: 'structure', reason: 'The grid, made visible.',
    transform: Transform.parse(transform), ...over,
  }) as SceneObject;

// ---------------------------------------------------------------------------
// A — PAPER. Editorial light, type as the image, plates on a page.
// ---------------------------------------------------------------------------
const paper: Graph[] = [
  SceneGraph.parse({
    id: 'a1', durationSeconds: 2.2,
    intent: 'HOOK: one enormous word arrives on paper, a rule slides under it.',
    background: PAPER,
    camera: { scale: { from: 1.06, to: 1.0, curve: 'out_expo' }, focalLengthMm: 80 },
    objects: [
      text('a1_word', 'Six', { token: 'display', align: 'left', maxWidth: 0.46, maxLines: 1 },
        { x: 0.07, y: 0.44, anchor: { x: 0, y: 0.5 }, scale: { from: 1.5, to: 1.18, curve: 'out_expo' } }),
      rule('a1_rule', { x: 0.07, y: 0.62, anchor: { x: 0, y: 0.5 } },
        { width: { from: 0.0, to: 0.62, curve: 'out_expo' }, height: 0.006, fill: ACCENT,
          enterAt: 0.35, reason: 'The rule draws under the word; the page is being set.' }),
    ],
    audio: [{ at: 0.1, kind: 'impact', intensity: 0.6, causedBy: 'a1_word', reason: 'The word lands.' }],
    handover: { mechanism: 'mask_reveal', carries: ['a1_rule'], durationSeconds: 0.2, reason: 'The rule becomes the edge of the next plate.' },
    macro: null,
  }),
  SceneGraph.parse({
    id: 'a2', durationSeconds: 3.4,
    intent: 'DENSE: two large plates of the real interface set on the page like figures.',
    background: PAPER,
    camera: { scale: { from: 1.0, to: 1.05, curve: 'in_out_cubic' }, x: { from: 0.01, to: -0.01, curve: 'in_out_cubic' }, focalLengthMm: 70 },
    objects: [
      text('a2_line', 'weeks of work', { token: 'statement', maxWidth: 0.4, maxLines: 2 },
        { x: 0.07, y: 0.2, anchor: { x: 0, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_cubic' } }),
      /*
       * Two plates, large, one running off the edge.
       *
       * The first cut of this shot set three at 34%, 30% and 26% of the frame,
       * politely inside the margins with drop shadows — which is precisely the
       * "small floating screenshot" the whole sprint exists to get away from,
       * and which QA had already flagged twice as a thumbnail of the product
       * rather than the product. A figure on a page is big enough to read and
       * is cropped by the page; that is what makes it a figure rather than a
       * card.
       */
      plate('a2_p1', 'ast_how_stages', { x: 0, y: 0, width: 1, height: 0.5 },
        { x: 0.60, y: 0.44, scale: { from: 0.94, to: 1, curve: 'out_quint' }, opacity: { from: 0, to: 1, curve: 'out_cubic' } },
        { width: 0.58, enterAt: 0.12, reason: 'The stages of the process, set as the main figure.' }),
      plate('a2_p2', 'ast_work_films', { x: 0, y: 0, width: 1, height: 0.6 },
        { x: 0.74, y: 0.80, scale: { from: 0.94, to: 1, curve: 'out_quint' }, opacity: { from: 0, to: 1, curve: 'out_cubic' } },
        { width: 0.46, enterAt: 0.40, reason: 'The work, overlapping the first figure.' }),
      rule('a2_rule', { x: 0.07, y: 0.3, anchor: { x: 0, y: 0.5 } }, { width: 0.32, fill: ACCENT, height: 0.004, reason: 'The rule carried from the previous page.' }),
    ],
    audio: [{ at: 0.2, kind: 'ui_click', intensity: 0.4, causedBy: 'a2_p1', reason: 'Each plate sets.' }],
    handover: { mechanism: 'scale_through', carries: ['a2_p1'], durationSeconds: 0.3, reason: 'The frame pushes into one plate.' },
    macro: null,
  }),
  SceneGraph.parse({
    id: 'a3', durationSeconds: 3.0,
    intent: 'MACRO: hard into one plate until it is texture, then the counter-statement.',
    background: PAPER,
    /*
     * A push that stops while the product is still whole.
     *
     * The first cut pushed to 1.9x on a crop that was mostly a paragraph, and
     * the result was the page's own body copy blown up and cut off mid-word at
     * both edges — legible enough to try to read and clipped enough to fail,
     * which reads as a broken render rather than as a macro. "Until it is
     * texture" only works if it arrives at texture; stopping halfway is just
     * a mistake at a larger size. So: a crop that is mostly image, a push that
     * ends while the frame still holds it, and the counter-statement placed in
     * the corner the composition leaves empty.
     */
    camera: { scale: { from: 1.0, to: 1.18, curve: 'in_out_cubic' }, x: { from: 0.02, to: -0.02, curve: 'in_out_cubic' }, focalLengthMm: 110, depthOfField: 0.2 },
    objects: [
      plate('a3_macro', 'ast_work_films', { x: 0, y: 0, width: 1, height: 1 },
        { x: 0.5, y: 0.44, scale: { from: 1.0, to: 1.08, curve: 'in_out_cubic' } },
        { width: 0.94, role: 'payload', cornerRadiusPx: 0, reason: 'The work itself, full-bleed and whole.' }),
      // x is 0.14, not the 0.06 a page margin suggests: the camera scales the
      // whole frame around its centre, so a left-anchored object drifts further
      // left as it pushes. The check caught it at 4% past the edge.
      text('a3_line', 'One afternoon.', { token: 'display', maxWidth: 0.44, maxLines: 1, color: ACCENT },
        { x: 0.14, y: 0.87, anchor: { x: 0, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_expo' } },
      ),
    ],
    audio: [{ at: 2.1, kind: 'sub_drop', intensity: 0.7, causedBy: 'a3_line', reason: 'The counter-statement lands.' }],
    handover: { mechanism: 'field_change', carries: [], durationSeconds: 0.25, reason: 'The page turns to ink.' },
    macro: null,
  }),
  SceneGraph.parse({
    id: 'a4', durationSeconds: 3.4,
    intent: 'INVERT: the page goes to ink, the mark sits in the space the type left.',
    background: INK,
    camera: { scale: { from: 1.1, to: 1.0, curve: 'out_expo' }, focalLengthMm: 60 },
    objects: [
      text('a4_mark', 'Act One', { token: 'display', align: 'center', maxWidth: 0.7, maxLines: 1, color: PAPER },
        { x: 0.5, y: 0.47, anchor: { x: 0.5, y: 0.5 }, scale: { from: 0.94, to: 1, curve: 'out_expo' }, opacity: { from: 0, to: 1, curve: 'out_expo' } }),
      rule('a4_rule', { x: 0.5, y: 0.6, anchor: { x: 0.5, y: 0.5 } },
        { width: { from: 0, to: 0.24, curve: 'out_expo' }, height: 0.005, fill: ACCENT, enterAt: 0.5,
          reason: 'The same rule that opened the film, closing it.' }),
    ],
    audio: [{ at: 0.15, kind: 'logo_sting', intensity: 0.6, causedBy: 'a4_mark', reason: 'The mark, and the end of the sentence.' }],
    macro: null,
  }),
];

// ---------------------------------------------------------------------------
// B — DEPTH. The product taken apart and flown through.
// ---------------------------------------------------------------------------
const region = (
  id: string, crop: Record<string, unknown>, z: number, x: number, y: number,
  enterAt: number, reason: string, width = 0.46,
): SceneObject =>
  plate(id, 'ast_home', crop,
    { x, y, z, scale: { from: 0.7, to: 1.0, curve: 'out_quint' }, rotationY: { from: -16, to: 0, curve: 'out_quint' },
      opacity: { from: 0, to: 1, curve: 'out_cubic' } },
    { width, enterAt, cornerRadiusPx: 6, reason });

const depth: Graph[] = [
  SceneGraph.parse({
    id: 'b1', durationSeconds: 2.4,
    intent: 'HOOK: a single lit detail in the dark, far too close to read.',
    background: DEEP,
    camera: { scale: { from: 1.5, to: 1.12, curve: 'out_expo' }, focalLengthMm: 120, depthOfField: { from: 0.7, to: 0.2, curve: 'out_expo' }, focusZ: 0 },
    objects: [
      plate('b1_detail', 'ast_home_hero', { x: 0.1, y: 0.2, width: 0.35, height: 0.3 },
        { x: 0.5, y: 0.52, z: 0, scale: { from: 1.4, to: 1.0, curve: 'out_expo' } },
        { width: 0.8, role: 'payload', reason: 'A detail of the real interface, before the whole of it.' }),
    ],
    audio: [{ at: 0.05, kind: 'riser', intensity: 0.5, causedBy: 'b1_detail', reason: 'Something is about to open.' }],
    handover: { mechanism: 'scale_through', carries: ['b1_detail'], durationSeconds: 0.3, reason: 'The camera pulls out of the detail into the whole.' },
    macro: null,
  }),
  SceneGraph.parse({
    id: 'b2', durationSeconds: 4.2,
    intent: 'REVEAL: the interface comes apart into four planes and the camera passes between them.',
    background: DEEP,
    camera: {
      scale: { keyframes: [{ t: 0, value: 1.3 }, { t: 0.62, value: 1.0, curve: 'out_quint' }, { t: 1, value: 1.08, curve: 'in_out_cubic' }], curve: 'out_quint' },
      x: { from: 0.05, to: -0.05, curve: 'in_out_cubic' },
      dollyZ: { from: 0, to: 0.72, curve: 'in_out_cubic' },
      focalLengthMm: { from: 26, to: 40, curve: 'in_out_cubic' },
      depthOfField: 0.45, focusZ: { from: -0.3, to: 0.3, curve: 'in_out_cubic' },
    },
    objects: [
      region('b2_head', { x: 0, y: 0, width: 1, height: 0.22 }, -0.75, 0.30, 0.22, 0.10, 'The header, nearest the camera.', 0.5),
      region('b2_hero', { x: 0, y: 0.18, width: 0.68, height: 0.34 }, -0.15, 0.58, 0.46, 0.26, 'The claim the product leads with.', 0.52),
      region('b2_body', { x: 0, y: 0.5, width: 1, height: 0.28 }, 0.35, 0.36, 0.72, 0.42, 'The working area, further back.', 0.46),
      region('b2_foot', { x: 0, y: 0.78, width: 1, height: 0.22 }, 0.8, 0.72, 0.86, 0.58, 'The last band, furthest away.', 0.4),
    ],
    audio: [
      { at: 0.12, kind: 'whoosh', intensity: 0.5, causedBy: 'b2_head', reason: 'The planes separate.' },
      { at: 2.6, kind: 'impact', intensity: 0.7, causedBy: 'b2_body', reason: 'The camera clears the last plane.' },
    ],
    handover: { mechanism: 'camera_carry', carries: ['b2_hero'], durationSeconds: 0.35, reason: 'The move continues into the next shot.' },
    macro: null,
  }),
  SceneGraph.parse({
    id: 'b3', durationSeconds: 3.4,
    intent: 'TENSION: the planes collapse back and the line arrives in the space they leave.',
    background: DEEP,
    camera: { scale: { from: 1.08, to: 1.0, curve: 'out_quint' }, dollyZ: { from: 0.72, to: 0.1, curve: 'in_cubic' }, focalLengthMm: 45, depthOfField: 0.25 },
    objects: [
      region('b3_head', { x: 0, y: 0, width: 1, height: 0.22 }, -0.6, 0.3, 0.24, 0.0, 'Retreating.', 0.44),
      region('b3_body', { x: 0, y: 0.5, width: 1, height: 0.28 }, 0.5, 0.68, 0.74, 0.0, 'Retreating further.', 0.4),
      text('b3_line', 'Directed, not generated.', { token: 'display', maxWidth: 0.52, maxLines: 2, color: '#FFFFFF' },
        { x: 0.5, y: 0.5, anchor: { x: 0.5, y: 0.5 }, z: -0.2, scale: { from: 0.9, to: 1, curve: 'out_expo' }, opacity: { from: 0, to: 1, curve: 'out_expo' } },
      ),
    ],
    audio: [{ at: 1.5, kind: 'sub_drop', intensity: 0.8, causedBy: 'b3_line', reason: 'The planes hit their marks as the line lands.' }],
    handover: { mechanism: 'object_handoff', carries: ['b3_line'], durationSeconds: 0.3, reason: 'The line survives into the mark.' },
    macro: null,
  }),
  SceneGraph.parse({
    id: 'b4', durationSeconds: 2.8,
    intent: 'RESOLVE: everything gone but the mark, lit from one side.',
    background: DEEP,
    camera: { scale: { from: 1.04, to: 1.0, curve: 'out_expo' }, focalLengthMm: 85 },
    objects: [
      text('b4_mark', 'Act One', { token: 'display', align: 'center', maxWidth: 0.6, maxLines: 1, color: BLUE },
        { x: 0.5, y: 0.5, anchor: { x: 0.5, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_expo' }, scale: { from: 0.96, to: 1, curve: 'out_expo' } }),
    ],
    audio: [{ at: 0.2, kind: 'logo_sting', intensity: 0.6, causedBy: 'b4_mark', reason: 'The mark.' }],
    macro: null,
  }),
];

// ---------------------------------------------------------------------------
// C — FIELD. Full-frame colour as chapters, one enormous word at a time.
// ---------------------------------------------------------------------------
/**
 * Where a chapter's word sits, and how big.
 *
 * Added because the structural pass was right about something that reads as a
 * style choice: three chapters that differ only in their background colour
 * scored 100% identical on scene similarity — same kind, same role, same
 * place, same camera. Hard cuts between identical compositions are a colour
 * swap, not an edit. Moving the word means each cut reframes, which is what
 * makes a cut land.
 */
type Place = { x: number; y: number; anchorX: number; align: 'left' | 'center' | 'right'; maxWidth: number; enterScale: number };
const CENTRE: Place = { x: 0.5, y: 0.5, anchorX: 0.5, align: 'center', maxWidth: 0.62, enterScale: 1.22 };
const LOW_LEFT: Place = { x: 0.07, y: 0.72, anchorX: 0, align: 'left', maxWidth: 0.6, enterScale: 1.1 };
const HIGH_RIGHT: Place = { x: 0.93, y: 0.3, anchorX: 1, align: 'right', maxWidth: 0.6, enterScale: 1.1 };

const chapter = (
  id: string, seconds: number, colour: string, word: string, ink: string,
  intent: string, at: number, place: Place = CENTRE, over: Record<string, unknown> = {},
): Graph =>
  SceneGraph.parse({
    id, durationSeconds: seconds, intent, background: colour,
    camera: { scale: { from: 1.12, to: 1.0, curve: 'out_expo' }, focalLengthMm: 55 },
    objects: [
      text(`${id}_word`, word,
        { token: 'display', align: place.align, maxWidth: place.maxWidth, maxLines: 2, color: ink },
        { x: place.x, y: place.y, anchor: { x: place.anchorX, y: 0.5 },
          scale: { from: place.enterScale, to: 1.0, curve: 'out_expo' },
          opacity: { from: 0, to: 1, curve: 'out_cubic' } }),
      ...(over['extra'] ? [over['extra'] as SceneObject] : []),
    ],
    audio: [{ at, kind: 'impact', intensity: 0.75, causedBy: `${id}_word`, reason: 'The chapter changes on the beat.' }],
    handover: { mechanism: 'field_change', carries: [], durationSeconds: 0, reason: 'A hard cut to a new colour field.' },
    macro: null,
  });

const field: Graph[] = [
  chapter('c1', 1.6, ACCENT, 'SIX', PAPER, 'HOOK: the whole frame is one colour and one word.', 0.05),
  chapter('c2', 1.4, INK, 'WEEKS', PAPER, 'Hard cut, new field, new word, reframed low and left.', 0.02, LOW_LEFT),
  chapter('c3', 1.6, '#1F6F4A', 'GONE', PAPER, 'Third field, thrown to the opposite corner. The rhythm is established and then broken.', 0.02, HIGH_RIGHT),
  SceneGraph.parse({
    id: 'c4', durationSeconds: 4.2,
    intent: 'BREAK: the field holds and the real product slides in full-bleed across it.',
    background: PAPER,
    camera: { scale: { from: 1.0, to: 1.06, curve: 'in_out_cubic' }, x: { from: -0.03, to: 0.03, curve: 'in_out_cubic' }, focalLengthMm: 40 },
    objects: [
      plate('c4_wide', 'ast_home_hero', { x: 0, y: 0, width: 1, height: 1 },
        { x: 0.5, y: 0.52, scale: { from: 1.04, to: 1.0, curve: 'out_quint' }, opacity: { from: 0, to: 1, curve: 'out_cubic' } },
        { width: 1.1, role: 'payload', cornerRadiusPx: 0, shadow: false, reason: 'The real product, full-bleed, after three fields of nothing but words. Wider than the frame so the camera drift never uncovers an edge.' }),
      text('c4_tag', 'the real thing', { token: 'statement', maxWidth: 0.4, maxLines: 1, color: INK },
        { x: 0.06, y: 0.9, anchor: { x: 0, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_cubic' } }),
    ],
    audio: [{ at: 0.08, kind: 'whoosh', intensity: 0.6, causedBy: 'c4_wide', reason: 'The product arrives across the field.' }],
    handover: { mechanism: 'field_change', carries: [], durationSeconds: 0, reason: 'Back to colour for the close.' },
    macro: null,
  }),
  chapter('c5', 3.4, BLUE, 'Act One', PAPER, 'RESOLVE: the mark, in the last field.', 0.12),
];

// ---------------------------------------------------------------------------

/**
 * How each direction wants to sound.
 *
 * Not one setting shared between them, because the sound is part of what makes
 * these three different films rather than three colourways. The editorial cut
 * holds its silence and speaks in single marks; the depth cut opens on music
 * because the camera is already moving when the film starts; the field cut is
 * cut to a beat, so its impacts are the rhythm rather than punctuation.
 */
type SoundBehaviour = Parameters<typeof soundForScenes>[1]['behaviour'];

const DIRECTIONS: { slug: string; scenes: Graph[]; theme: 'dark' | 'light'; brand: BrandSystem; note: string; sound: SoundBehaviour }[] = [
  { slug: 'a-paper', scenes: paper, theme: 'light', brand: brandFor(ACCENT, INK, 'editorial'),
    note: 'Editorial light; type as the image; plates on a page; masks and rules.',
    sound: { musicCharacter: 'restrained', openOnMusic: false, uiSoundDensity: 'sparse', impactsOnCuts: true, endWithSting: true } },
  { slug: 'b-depth', scenes: depth, theme: 'dark', brand: brandFor(BLUE, DEEP, 'minimal'),
    note: 'The interface taken apart and flown through; real parallax; camera between planes.',
    sound: { musicCharacter: 'cinematic', openOnMusic: true, uiSoundDensity: 'sparse', impactsOnCuts: true, endWithSting: true } },
  { slug: 'c-field', scenes: field, theme: 'light', brand: brandFor(ACCENT, INK, 'bold'),
    note: 'Full-frame colour chapters; hard cuts on the beat; one enormous word at a time.',
    sound: { musicCharacter: 'driving', openOnMusic: true, uiSoundDensity: 'none', impactsOnCuts: true, endWithSting: true } },
];

const only = process.env['ACT_ONE_DIRECTION'];
const registry = new CapabilityRegistry();

for (const direction of DIRECTIONS) {
  if (only && direction.slug !== only) continue;
  const seconds = direction.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  console.log(`\n=== ${direction.slug}  ${seconds.toFixed(1)}s  ${direction.scenes.length} shots ===`);
  console.log(`    ${direction.note}`);

  let problems = 0;
  for (const scene of direction.scenes) {
    const routing = routeScene(scene, registry);
    problems += routing.problems.length;
    for (const problem of routing.problems) console.log(`    ROUTE ${scene.id}/${problem.objectId}: ${problem.message}`);
  }
  const findings = inspectScenes(direction.scenes, EASINGS, { registry });
  for (const f of findings) console.log(`    ${f.severity.padEnd(9)} ${f.check.padEnd(28)} ${f.sceneId} ${f.message.slice(0, 90)}`);
  if (problems > 0 || findings.some((f) => f.severity === 'hard_fail')) {
    console.log('    refusing to render this direction');
    continue;
  }

  if (process.env['ACT_ONE_INSPECT_ONLY']) continue;

  const out = path.resolve(`.renders/dir-${direction.slug}.mp4`);
  const silent = path.resolve(`.renders/dir-${direction.slug}.silent.mp4`);
  const started = Date.now();
  const result = await renderScenes({
    scenes: direction.scenes, brand: direction.brand, assetUrls: ASSETS,
    aspect: '16:9', quality: 'preview', outputPath: silent, concurrency: 3, theme: direction.theme,
  });
  console.log(`    rendered in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  if (result.undecodable.length) console.log('    undecodable:', result.undecodable);

  /*
   * Sound, because the first three cuts shipped silent and nobody caught it.
   *
   * Every scene above declares its audio — an impact where the word lands, a
   * riser under the push, a sting on the mark — and until now nothing read
   * those events, so three films were rendered, measured, inspected and
   * reviewed frame by frame while being, in fact, twelve seconds of silence.
   * A launch film cannot be compared to a benchmark on picture alone.
   */
  const design = soundForScenes(direction.scenes, { behaviour: direction.sound, channel: 'web' });
  const resolved = Object.fromEntries(
    [...DEFAULT_LIBRARY.music, ...DEFAULT_LIBRARY.sfx]
      .map((item) => [item.storageKey, path.join(STORAGE, item.storageKey)] as const)
      .filter(([, file]) => existsSync(file)),
  );
  const missing = [design.music?.storageKey, ...design.cues.map((cue) => cue.storageKey)]
    .filter((key): key is string => Boolean(key))
    .filter((key) => !resolved[key]);
  if (missing.length > 0) {
    console.log(`    NO SOUND: ${missing.length} library assets missing. Run \`npm run sound-library\`.`);
    await rename(silent, out);
    continue;
  }

  const plan = buildMix({ design, resolvedPaths: resolved, durationSeconds: seconds });
  const premix = path.resolve(`.renders/dir-${direction.slug}.premix.wav`);
  const mixed = await runFfmpeg(mixArgs(plan, premix), { timeoutMs: 5 * 60_000 });
  if (!mixed.ok) throw new Error(`${direction.slug} mix failed: ${mixed.stderr.slice(-300)}`);

  const master = path.resolve(`.renders/dir-${direction.slug}.mix.wav`);
  await masterLoudness({ source: premix, target: master, lufs: design.targetLufs, outputArgs: ['-c:a', 'pcm_s24le'] });

  const muxed = await runFfmpeg(muxArgs(silent, master, out), { timeoutMs: 5 * 60_000 });
  if (!muxed.ok) throw new Error(`${direction.slug} mux failed: ${muxed.stderr.slice(-300)}`);
  console.log(`    ${design.cues.length} cues, music ${design.music?.storageKey ?? 'none'}, ${design.targetLufs} LUFS -> ${out}`);
}
