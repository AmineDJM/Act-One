/**
 * A launch film built to the shape the reference films actually have.
 *
 * WHAT THE REFERENCES ARE, measured rather than admired. Three films, 71 to 89
 * seconds, read by a model that watched them. All three run the same
 * structure, which a model reading the third one stated as four beats:
 * establish the pain (0–20s), introduce the brand (20–29s), explain how it
 * works (29–53s), benefit and call to action (53–71s). None of them is a
 * twelve-second mood piece. The film this system last made was eighteen
 * seconds and had one idea in it; that is not a shorter version of these, it
 * is a different object.
 *
 * WHAT THEY DO THAT THIS COULD NOT, until the capabilities under this were
 * built:
 *
 *   Nothing sits on a flat field. One is lit from a drifting orange source,
 *   one on a faint grid, one on a warm gradient. Every frame here now stands
 *   on a radial light rather than a solid colour.
 *
 *   Cards float in real space. Perspective, foreshortening, a near edge and a
 *   far edge — not a rectangle scaled down.
 *
 *   Emphasis lives INSIDE a sentence. "Your problem isn't `what you sell`" is
 *   one line in two colours, not two lines.
 *
 *   Type is lit. Gradient fills on the numbers, hollow glowing outlines on the
 *   years, light coming off the words.
 *
 * THE VOICE. The references are narrated and the voice carries their pace: a
 * male read at about 160 words a minute, close, compressed, with the music
 * ducked under it. This film had none, because the ElevenLabs credential is
 * rejected — and it was cut for that absence, holding its lines long enough to
 * be READ rather than heard.
 *
 * It has one now. The same models are reachable through Runway, which does
 * have a working credential, so `narration.ts` reads the script through
 * `eleven_v3` and the mix ducks the bed under it with the sidechain that was
 * already there. The lines are written to counterpoint the screen rather than
 * repeat it: the frame states the claim, the voice supplies the cost and the
 * mechanism. One shot is deliberately left silent.
 *
 *   ACT_ONE_MANAGED_CREDENTIALS=all npm run launch
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
import { NARRATOR, narrate, place, retimeForNarration, wordsPerMinute } from './narration.ts';

type Graph = ReturnType<typeof SceneGraph.parse>;

const STORAGE = process.env['ACT_ONE_STORAGE_DIR'] ?? path.resolve('.act-one-demo/storage');
const BASE = process.env['ACT_ONE_CAPTURE_BASE'] ?? 'http://localhost:3000/capture';
const PUBLIC = path.resolve('apps/web/public/capture');

const INK = '#0B0C10';
const PAPER = '#F4F2EC';
const ACCENT = '#FF4D1F';
const AMBER = '#FFB03A';
const EMBER = '#2A1006';

const ASSETS: Record<string, string> = Object.fromEntries(
  (['home', 'how', 'work', 'pricing', 'home_hero', 'home_steps', 'how_stages', 'work_films', 'pricing_terms'] as const)
    .filter((n) => existsSync(path.join(PUBLIC, `${n}.png`)))
    .map((n) => [`ast_${n}`, `${BASE}/${n}.png`]),
);
if (existsSync(path.join(PUBLIC, 'before.mp4'))) ASSETS['ast_before'] = `${BASE}/before.mp4`;
if (existsSync(path.join(PUBLIC, 'output.mp4'))) ASSETS['ast_output'] = `${BASE}/output.mp4`;
/*
 * The three direction films, which this system actually made.
 *
 * Not stand-ins and not mock-ups: these are three real renders from the
 * direction exploration that produced this film's own look. A model watching
 * the finished film said it was "missing actual examples of output films,
 * which a benchmark film would include" — and the examples existed all along,
 * sitting in .renders as the evidence for a decision nobody was shown.
 */
for (const name of ['dir-a-paper', 'dir-b-depth', 'dir-c-field'] as const) {
  if (existsSync(path.join(PUBLIC, `${name}.mp4`))) ASSETS[`ast_${name.replace(/-/g, '_')}`] = `${BASE}/${name}.mp4`;
}

const brand = BrandSystem.parse({
  id: 'brn_launch', organizationId: 'org_launch', name: 'Act One',
  primaryColor: ACCENT,
  secondaryColor: neutralRamp(ACCENT, 9, 0.05)[6] ?? ACCENT,
  primaryCandidates: [ACCENT], neutrals: neutralRamp(ACCENT, 9, 0.05),
  canvasDark: INK, canvasLight: PAPER,
  visualStyle: 'editorial', motionStyle: 'precise', cornerStyle: 'subtle', cornerRadiusPx: 10,
  confirmedByUser: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/**
 * The light every dark scene stands on.
 *
 * Drifting rather than fixed, and slowly: a source that holds perfectly still
 * for eight seconds stops reading as a light and starts reading as a
 * background, which is the whole thing this exists to avoid.
 */
const lamp = (
  id: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  colour: string,
  radius: number,
): SceneObject =>
  ({
    kind: 'gradient', id,
    shape: 'radial',
    from: colour, to: INK,
    centre: {
      x: { from: from.x, to: to.x, curve: 'in_out_cubic' },
      y: { from: from.y, to: to.y, curve: 'in_out_cubic' },
    },
    radius,
    role: 'atmosphere',
    reason: 'The source the scene is lit by. Nothing here sits on a flat field.',
    // z = 1 puts the light at the back of the painter's sort. At the default
    // of 0 it landed in the middle of the cards and painted over the ones
    // behind it.
    transform: Transform.parse({ x: 0.5, y: 0.5, z: 1, anchor: { x: 0.5, y: 0.5 } }),
  }) as SceneObject;

/** The same, on paper: a warm bloom rather than a lamp in the dark. */
const bloom = (id: string, at: { x: number; y: number }, colour: string, radius: number): SceneObject =>
  ({
    kind: 'gradient', id,
    shape: 'radial',
    from: colour, to: PAPER,
    centre: { x: at.x, y: at.y },
    radius,
    role: 'atmosphere',
    reason: 'Warmth in the paper, so the page is lit rather than printed.',
    transform: Transform.parse({ x: 0.5, y: 0.5, z: 1, anchor: { x: 0.5, y: 0.5 } }),
  }) as SceneObject;

/*
 * CARDS ARE CROPPED OUT OF THE FULL PAGES, not out of the strips.
 *
 * Two things went wrong before this and they compounded. A crop is a fraction
 * of its SOURCE, so the resulting card is `(crop.width x sourceAspect) /
 * crop.height` — and these sources are not the same shape. The stage strip is
 * 3.00:1, the films and terms strips are 3.68:1, the steps panel is 1.21:1.
 * One crop applied to all four produced two letterboxes and a tall column.
 *
 * Choosing the crop per source fixed the shapes and exposed the real problem:
 * a card-shaped region of a 3.68:1 strip is a third of a strip, and it cuts
 * every sentence in it in half. The strips were never card material.
 *
 * So the cards come out of the full page captures, which are 1.60:1 and
 * contain whole panels with their own margins. A region of a page is a piece
 * of the product; a slice of a strip is a mistake.
 */
const CARD_CROP: Record<string, { x: number; y: number; width: number; height: number }> = {
  ast_home: { x: 0.04, y: 0.08, width: 0.5, height: 0.52 },
  ast_how: { x: 0.08, y: 0.36, width: 0.5, height: 0.52 },
  ast_work: { x: 0.04, y: 0.28, width: 0.5, height: 0.52 },
  ast_pricing: { x: 0.04, y: 0.23, width: 0.5, height: 0.52 },
};

/** A capture held at an angle in real space. */
const card = (
  id: string, asset: string, crop: Record<string, unknown>,
  at: { x: number; y: number; z: number },
  tilt: { rx: number; ry: number; rz: number },
  width: number, enterAt: number, reason: string,
): SceneObject =>
  ({
    kind: 'ui_layer', id, assetId: asset, semantic: id,
    crop, width, cornerRadiusPx: 10, shadow: true,
    role: 'support', enterAt, reason,
    transform: Transform.parse({
      x: at.x, y: at.y, z: at.z,
      anchor: { x: 0.5, y: 0.5 },
      rotationX: tilt.rx,
      rotationY: { from: tilt.ry - 7, to: tilt.ry, curve: 'out_expo' },
      rotationZ: tilt.rz,
      scale: { from: 0.94, to: 1, curve: 'out_expo' },
      opacity: ARRIVES,
    }),
  }) as SceneObject;

type LineOpts = {
  token?: 'display' | 'statement' | 'body' | 'caption' | 'mono';
  color?: string;
  maxWidth?: number;
  maxLines?: number;
  align?: 'left' | 'center' | 'right';
  spans?: { text: string; color?: string; weight?: number; italic?: boolean }[];
  treatment?: Record<string, unknown>;
  stagger?: number;
  enterAt?: number;
  role?: 'payload' | 'support' | 'atmosphere' | 'structure';
};

const line = (
  id: string, content: string, opts: LineOpts, transform: Record<string, unknown>,
): SceneObject =>
  ({
    kind: 'text', id, content,
    token: opts.token ?? 'display',
    color: opts.color ?? 'onCanvas.primary',
    align: opts.align ?? 'left',
    maxWidth: opts.maxWidth ?? 0.46,
    maxLines: opts.maxLines ?? 3,
    staggerBy: opts.stagger ? 'word' : 'none',
    staggerSeconds: opts.stagger ?? 0,
    ...(opts.spans ? { spans: opts.spans } : {}),
    ...(opts.treatment ? { treatment: opts.treatment } : {}),
    role: opts.role ?? 'payload',
    enterAt: opts.enterAt ?? 0,
    reason: 'The line of the beat.',
    transform: Transform.parse(transform),
  }) as SceneObject;

/**
 * The oversized word behind the work.
 *
 * Read off the references directly: "words scale up to fill background behind
 * UI", and the same device again as pale section titles under a crisp label.
 * It is the cheapest way a film says what chapter it is in without stopping to
 * announce it.
 */
const chapterWord = (id: string, content: string, colour: string): SceneObject =>
  line(id, content, {
    token: 'display', color: colour, maxWidth: 0.42, maxLines: 1, align: 'center',
    role: 'atmosphere',
  }, {
    x: 0.5, y: 0.42, z: 0.95, anchor: { x: 0.5, y: 0.5 },
    scale: { from: 1.9, to: 2.15, curve: 'in_out_cubic' },
    opacity: ARRIVES,
  });

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

/*
 * THE MEASUREMENT THAT FORCED THIS REWRITE.
 *
 * The same instrument run over this film and the three references:
 *
 *                       ref 1     ref 2     ref 3    ours
 *   motion p90          1.71      2.66      2.25     0.61
 *   static share        0.25      0.13      0.15     0.51
 *   shot median s       3.2       5.4       1.25     9.3
 *   audio accents       44        168       126      3
 *
 * Half the film was a still picture, it moved three to four times less than
 * any reference at its liveliest, and its shots held roughly twice as long as
 * the slowest of them. That is not a matter of taste. A camera that travels
 * 1.04x over six seconds moves a fifth of a percent per frame, which is below
 * what anybody can see — it is a static shot with a note in the graph saying
 * it is not.
 *
 * None of this needed a new primitive. `camera.x`, `camera.y`, `camera.scale`
 * and every object transform were already animatable; the film simply never
 * asked them for anything. So the fix is authored, not engineered: real camera
 * travel, objects that arrive from outside the frame and leave before the cut,
 * and shots cut to lengths that vary instead of all lasting six seconds.
 *
 * WHAT THIS IS NOT. Not motion for the instrument's sake. We have already seen
 * a cut that beat its replacement on every measurement and was called "a
 * generic template, entirely disconnected from the narrative". Every move
 * below is a camera following something, an object arriving because it is its
 * turn, or a frame leaving because the next one is more interesting.
 */

/**
 * An entrance that finishes, rather than one that lasts the whole shot.
 *
 * THE FOOTGUN THIS EXISTS FOR. A property's `t` is normalised across the
 * OBJECT'S OWN SPAN — from when it enters to when the scene ends — which is
 * documented, predictable, and exactly what you want for a move that should
 * take the whole shot. Written as `opacity: { from: 0, to: 1 }` it means
 * something quite different from what it looks like: a card entering at half a
 * second into a five-second scene fades up over four and a half seconds.
 *
 * The film had nineteen of these, and the visible consequence was a stack of
 * pages you could see THROUGH to the pages underneath — a pile of glass
 * rather than of paper, because nothing in the film was ever fully opaque.
 *
 * WHAT THIS DID NOT FIX, recorded because the guess was wrong and the wrong
 * guess is the useful part. I expected it to explain two other things: a
 * static share stuck outside the reference band, on the theory that a frame
 * full of slowly arriving objects produces little optical flow, and a
 * critic's note about "subtle zooms". Measured after the change, static share
 * did not move by a thousandth — 0.3033 before and after — and scale
 * variation got WORSE, from 0.656 to 0.536, because opaque cards make edge
 * density more uniform frame to frame. One correct prediction out of three.
 *
 * The change stands on what it actually does: paper is opaque. Those other
 * two numbers have a different cause and still need one.
 *
 * Keyframes say what a from/to cannot: arrive, then stop arriving.
 */
const ARRIVES = {
  keyframes: [
    { t: 0, value: 0 },
    { t: 0.14, value: 1, curve: 'out_cubic' as const },
    { t: 1, value: 1 },
  ],
  curve: 'out_cubic' as const,
};

type Travel = {
  /** Fractions of the frame the camera crosses. */
  x?: [number, number];
  y?: [number, number];
  /** Start and end magnification. 1.0 -> 1.25 is a real push, 1.04 is not. */
  scale?: [number, number];
  focal?: number | [number, number];
  dolly?: [number, number];
  curve?: 'in_out_cubic' | 'out_quint' | 'out_expo' | 'linear' | 'in_out_quart';
};

const camera = (t: Travel): Record<string, unknown> => {
  const curve = t.curve ?? 'in_out_cubic';
  const out: Record<string, unknown> = {
    focalLengthMm: Array.isArray(t.focal)
      ? { from: t.focal[0], to: t.focal[1], curve }
      : (t.focal ?? 60),
  };
  if (t.x) out['x'] = { from: t.x[0], to: t.x[1], curve };
  if (t.y) out['y'] = { from: t.y[0], to: t.y[1], curve };
  if (t.scale) out['scale'] = { from: t.scale[0], to: t.scale[1], curve };
  if (t.dolly) out['dollyZ'] = { from: t.dolly[0], to: t.dolly[1], curve };
  return out;
};

/** An object that flies in from outside the frame and settles. */
const arrive = (
  from: { x?: number; y?: number },
  to: { x: number; y: number },
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  x: { from: from.x ?? to.x, to: to.x, curve: 'out_expo' },
  y: { from: from.y ?? to.y, to: to.y, curve: 'out_expo' },
  ...over,
});

/** An object that settles, holds, then leaves — so the frame is never a still. */
const passThrough = (
  from: { x: number; y: number },
  hold: { x: number; y: number },
  to: { x: number; y: number },
): Record<string, unknown> => ({
  x: { keyframes: [{ t: 0, value: from.x }, { t: 0.32, value: hold.x, curve: 'out_expo' }, { t: 0.72, value: hold.x }, { t: 1, value: to.x, curve: 'in_cubic' }], curve: 'out_expo' },
  y: { keyframes: [{ t: 0, value: from.y }, { t: 0.32, value: hold.y, curve: 'out_expo' }, { t: 0.72, value: hold.y }, { t: 1, value: to.y, curve: 'in_cubic' }], curve: 'out_expo' },
});

// ---------------------------------------------------------------------------
// The film
// ---------------------------------------------------------------------------

/*
 * SHOT LENGTHS VARY ON PURPOSE. The references run medians of 1.25s, 3.2s and
 * 5.4s and none of them holds every shot for the same time; this one held all
 * of them for six seconds, which is why it read as a sequence of slides even
 * once the slides were good. Beats of 1.6s sit next to beats of 5.2s below,
 * and the short ones are where the film is most certain of itself.
 */

const scenes: Graph[] = [
  // ---- ACT 1: the pain -----------------------------------------------------
  SceneGraph.parse({
    id: 'l1', durationSeconds: 3.6,
    intent: 'HOOK: a real room at the end of a long day. The camera is already moving when the film starts.',
    background: INK,
    camera: camera({ scale: [0.92, 1.12], x: [0.05, -0.05], focal: 40, curve: 'linear' }),
    objects: [
      {
        kind: 'clip', id: 'l1_room', assetId: 'ast_before',
        crop: { x: 0, y: 0, width: 1, height: 1 },
        width: 1.2, sourceInSeconds: 0.15, playbackRate: 0.8, generated: true,
        role: 'payload',
        reason: 'The world the product lives in, shot rather than drawn. No interface appears in it.',
        transform: Transform.parse({ x: 0.5, y: 0.5, anchor: { x: 0.5, y: 0.5 } }),
      } as SceneObject,
    ],
    audio: [
      { at: 0.05, kind: 'texture', intensity: 0.5, causedBy: 'l1_room', reason: 'Room tone under the shot.' },
      { at: 2.4, kind: 'riser', intensity: 0.4, causedBy: 'l1_room', reason: 'The room is about to give way.' },
    ],
    handover: { mechanism: 'scale_through', carries: [], durationSeconds: 0.5, reason: 'The camera pushes through the dark of the room into the line.' },
    macro: null,
  }),

  SceneGraph.parse({
    id: 'l2', durationSeconds: 4.8,
    intent: 'PAIN NAMED: the sentence arrives word by word while the camera drifts across it.',
    background: INK,
    camera: camera({ x: [0.06, -0.06], scale: [1.00, 1.16], focal: 55, curve: 'linear' }),
    objects: [
      lamp('l2_light', { x: 0.18, y: 0.3 }, { x: 0.42, y: 0.5 }, EMBER, 0.85),
      line('l2_line', 'Your problem is not the film.', {
        maxWidth: 0.5, maxLines: 2, stagger: 0.07,
        spans: [
          { text: 'Your problem is not ' },
          { text: 'the film', color: ACCENT, weight: 700 },
          { text: '.' },
        ],
      }, arrive({ x: 0.2 }, { x: 0.12, y: 0.42 }, { anchor: { x: 0, y: 0.5 } })),
      line('l2_sub', 'It is the six weeks before it.', {
        token: 'statement', color: 'onCanvas.muted', maxWidth: 0.44, maxLines: 2, enterAt: 1.2,
      }, { x: 0.12, y: 0.56, anchor: { x: 0, y: 0.5 }, opacity: ARRIVES }),
    ],
    audio: [
      { at: 0.05, kind: 'impact', intensity: 0.5, causedBy: 'l2_line', reason: 'The first word lands.' },
      { at: 0.42, kind: 'ui_click', intensity: 0.22, causedBy: 'l2_line', reason: 'A word.' },
      { at: 0.72, kind: 'ui_click', intensity: 0.22, causedBy: 'l2_line', reason: 'A word.' },
      { at: 1.25, kind: 'whoosh', intensity: 0.3, causedBy: 'l2_sub', reason: 'The counter-line slides under it.' },
      { at: 3.5, kind: 'riser', intensity: 0.45, causedBy: 'l2_line', reason: 'Into the work.' },
    ],
    handover: { mechanism: 'mask_reveal', carries: [], durationSeconds: 0.45, reason: 'The page wipes in over the ink; the edge is the event.' },
    macro: null,
  }),

  SceneGraph.parse({
    id: 'l3', durationSeconds: 5.2,
    intent: 'PAIN SHOWN: four pages fly in from off-frame while the camera cranes across the desk.',
    background: PAPER,
    camera: camera({ x: [0.09, -0.08], y: [-0.05, 0.05], scale: [1.26, 0.98], focal: [95, 82], dolly: [0, 0.3] }),
    objects: [
      bloom('l3_bloom', { x: 0.5, y: 0.45 }, '#FFE8D8', 0.9),
      chapterWord('l3_chapter', 'SIX WEEKS', '#DCD3C4'),
      /*
       * A PILE, NOT A CONSTELLATION.
       *
       * These four sat spread across the frame at even intervals, each one
       * turned a different way — and a model watching the cut called exactly
       * this moment "generic SaaS tropes (floating UI)... a template". It was
       * right. Four screenshots hovering in tidy isolation is the single most
       * recognisable gesture in automated software video, and it is also
       * nothing like what the shot is about: pages accumulating on the desk
       * the film just opened on.
       *
       * So they overlap, they land heavily on top of one another, and they
       * share a shallow angle the way a real stack does instead of each
       * pointing somewhere different. The physical world of the first shot
       * carries into the second rather than being abandoned for a grid.
       */
      card('l3_c1', 'ast_how', CARD_CROP['ast_how']!, { x: 0.40, y: 0.46, z: 0.30 }, { rx: 4, ry: 7, rz: -7 }, 0.46, 0.05, 'The brief, first onto the pile.'),
      card('l3_c2', 'ast_work', CARD_CROP['ast_work']!, { x: 0.52, y: 0.42, z: 0.10 }, { rx: 3, ry: 5, rz: 4 }, 0.46, 0.32, 'The references, dropped on top of it.'),
      card('l3_c3', 'ast_pricing', CARD_CROP['ast_pricing']!, { x: 0.46, y: 0.56, z: -0.08 }, { rx: 5, ry: 8, rz: -2 }, 0.46, 0.62, 'The terms, on top of those.'),
      card('l3_c4', 'ast_home', CARD_CROP['ast_home']!, { x: 0.58, y: 0.52, z: -0.26 }, { rx: 3, ry: 4, rz: 8 }, 0.46, 0.92, 'The schedule, last onto the heap.'),
      line('l3_tag', 'Briefs. References. Revisions. Quotes.', {
        token: 'statement', color: 'onCanvas.secondary', maxWidth: 0.42, maxLines: 2, enterAt: 1.8,
      }, { x: 0.18, y: 0.93, anchor: { x: 0, y: 0.5 }, opacity: ARRIVES }),
    ],
    audio: [
      { at: 0.1, kind: 'whoosh', intensity: 0.4, causedBy: 'l3_c1', reason: 'A page arrives.' },
      { at: 0.42, kind: 'ui_click', intensity: 0.3, causedBy: 'l3_c1', reason: 'It sets down.' },
      { at: 0.75, kind: 'ui_click', intensity: 0.3, causedBy: 'l3_c2', reason: 'And another.' },
      { at: 1.1, kind: 'ui_click', intensity: 0.3, causedBy: 'l3_c3', reason: 'And another.' },
      { at: 1.45, kind: 'ui_click', intensity: 0.32, causedBy: 'l3_c4', reason: 'And another.' },
      { at: 4.3, kind: 'riser', intensity: 0.46, causedBy: 'l3_c4', reason: 'Too much of it; something has to give.' },
    ],
    handover: { mechanism: 'scale_through', carries: [], durationSeconds: 0.5, reason: 'The camera pushes into the paper until only the mark is left.' },
    macro: null,
  }),

  // ---- ACT 2: the mark -----------------------------------------------------
  SceneGraph.parse({
    id: 'l4', durationSeconds: 3.4,
    intent: 'BRAND: the mark arrives lit, in the dark, alone. The shortest shot so far, because it is the most certain.',
    background: INK,
    camera: camera({ scale: [1.46, 1.12], y: [0.03, -0.03], focal: 70, curve: 'linear' }),
    objects: [
      lamp('l4_light', { x: 0.5, y: 0.56 }, { x: 0.5, y: 0.46 }, EMBER, 0.72),
      line('l4_mark', 'Act One', {
        align: 'center', maxWidth: 0.5, maxLines: 1, color: PAPER,
        treatment: { gradient: null, stroke: null, glow: { color: '#FF6A33', radiusPx: { from: 4, to: 34, curve: 'out_expo' }, strength: 0.75 } },
      }, {
        x: 0.5, y: 0.46, anchor: { x: 0.5, y: 0.5 },
        scale: { from: 0.9, to: 1, curve: 'out_expo' },
        opacity: ARRIVES,
      }),
      line('l4_sub', 'Launch films, directed.', {
        token: 'statement', align: 'center', color: 'onCanvas.muted', maxWidth: 0.4, maxLines: 1, enterAt: 0.8,
      }, { x: 0.5, y: 0.58, anchor: { x: 0.5, y: 0.5 }, opacity: ARRIVES }),
    ],
    audio: [
      { at: 0.12, kind: 'sub_drop', intensity: 0.66, causedBy: 'l4_mark', reason: 'The mark lands in the silence the riser left.' },
      { at: 0.9, kind: 'ui_confirm', intensity: 0.28, causedBy: 'l4_sub', reason: 'The line under it.' },
    ],
    handover: { mechanism: 'camera_carry', carries: [], durationSeconds: 0.45, reason: 'The move continues out of the mark and into the work.' },
    macro: null,
  }),
];

// ---- ACT 3: how it works ---------------------------------------------------

/*
 * Each step is TWO shots, not one.
 *
 * Held as a single six-second composition, a step is a slide: the title and
 * the product sit side by side and neither of them does anything. Split, the
 * title gets a short beat of its own and the product gets a travelling shot,
 * which is both how the references stage this act and why their shot medians
 * are a third of what ours was.
 */
const stepTitle = (
  id: string, index: string, title: string, seconds: number, at: number,
  /** The page the next shot lands in, already sliding into this one. */
  incoming: string,
): Graph =>
  SceneGraph.parse({
    id, durationSeconds: seconds,
    intent: `STEP TITLE: ${title.toLowerCase()}, with the interface it describes already arriving.`,
    background: PAPER,
    camera: camera({ x: [0.1, -0.04], scale: [1.12, 1.0], focal: 60, curve: 'out_expo' }),
    objects: [
      bloom(`${id}_bloom`, { x: 0.3, y: 0.44 }, '#FFEADC', 0.9),
      /*
       * THE FRAME WAS THREE-QUARTERS EMPTY, which is what a title beat looks
       * like when it contains nothing but a title. A model watching the cut
       * pointed at these shots and called them the weakest moments; looking at
       * the frames, they are not clipped or badly composed, they are BLANK —
       * one short line on the left and two-thirds of a cream field doing
       * nothing.
       *
       * So the page the next shot lands inside is already entering this one,
       * from the edge, at an angle, still on its way. That fills the right of
       * the frame, it gives the camera something to travel towards, and it
       * makes the cut into the product shot a continuation rather than a
       * surprise — the thing you were watching arrive is the thing you are
       * now inside.
       */
      {
        kind: 'ui_layer', id: `${id}_incoming`, assetId: incoming, semantic: 'incoming',
        crop: { x: 0.04, y: 0.06, width: 0.5, height: 0.52 },
        width: 0.62, cornerRadiusPx: 10, shadow: true,
        role: 'support', enterAt: 0.12,
        reason: 'The interface the next shot is inside, still arriving.',
        transform: Transform.parse({
          x: { from: 1.25, to: 0.86, curve: 'out_expo' },
          y: 0.52,
          z: -0.2,
          anchor: { x: 0.5, y: 0.5 },
          rotationX: 3,
          rotationY: { from: -22, to: -14, curve: 'out_expo' },
          rotationZ: 1.5,
          opacity: ARRIVES,
        }),
      } as SceneObject,
      line(`${id}_index`, index, {
        token: 'mono', color: ACCENT, maxWidth: 0.1, maxLines: 1, role: 'structure',
      }, arrive({ x: 0.02 }, { x: 0.09, y: 0.36 }, { anchor: { x: 0, y: 0.5 }, opacity: ARRIVES })),
      line(`${id}_title`, title, {
        maxWidth: 0.4, maxLines: 2, stagger: 0.06,
      }, arrive({ x: 0.15 }, { x: 0.09, y: 0.5 }, { anchor: { x: 0, y: 0.5 } })),
    ],
    audio: [
      { at: 0.04, kind: 'impact', intensity: 0.45, causedBy: `${id}_title`, reason: 'The step is announced.' },
      { at: 0.3, kind: 'ui_click', intensity: 0.2, causedBy: `${id}_title`, reason: 'A word.' },
      { at: at, kind: 'whoosh', intensity: 0.38, causedBy: `${id}_index`, reason: 'Into the product.' },
    ],
    handover: { mechanism: 'camera_carry', carries: [`${id}_incoming`], durationSeconds: 0.4, reason: 'The camera keeps travelling into the interface that has just arrived.' },
    macro: null,
  });


/**
 * A caption that stays legible over anything.
 *
 * THE PROBLEM IT SOLVES. A caption placed at a fixed point over a full-bleed
 * product lands on whatever the product happens to have there — and once the
 * camera travels, what it lands on changes every frame. Three shots had white
 * type sitting directly on the interface's own white type. The references
 * solve this the way films have always solved it: the caption sits on a band,
 * and the band is part of the design rather than an apology for it.
 *
 * A shape and a text object, both of which already existed. The band is drawn
 * from the object list rather than added to the text primitive, because a
 * scrim is a composition decision — how dark, how tall, whether it is there at
 * all — and burying it inside `text` would make every caption in every film
 * wear one.
 */
const caption = (
  id: string, content: string, at: { y: number }, colour: string, band: string,
): SceneObject[] => [
  /*
   * OPAQUE, because a translucent scrim over a dark interface is nothing.
   *
   * The first version used 78% black, which is a sensible scrim over a
   * photograph and completely invisible over a near-black product page — the
   * band was rendering, and the interface's own white type was reading
   * straight through the remaining 22% and colliding with the caption. A
   * lower third is not a veil over the picture; it is a piece of the layout
   * that the picture stops at.
   */
  {
    kind: 'shape', id: `${id}_band`, shape: 'rect',
    width: 1.3, height: 0.26,
    fill: band, stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
    role: 'structure', enterAt: 0.3,
    reason: 'The band the caption is read on, so it never fights the interface underneath it.',
    transform: Transform.parse({
      x: 0.5, y: at.y, z: -0.9, anchor: { x: 0.5, y: 0.5 },
      opacity: ARRIVES,
    }),
  } as SceneObject,
  line(id, content, {
    token: 'statement', color: colour, maxWidth: 0.38, maxLines: 2, enterAt: 0.42,
  }, {
    // Further in than a page margin would suggest, because the camera moves
    // during these shots and a caption pinned to the margin travels with it.
    x: 0.16, y: at.y, anchor: { x: 0, y: 0.5 },
    z: -0.95,
    opacity: ARRIVES,
  }),
];

/**
 * A shot INSIDE the interface, rather than of a card with an interface on it.
 *
 * THE NOTE THAT FORCED THIS. A model watching the previous cut said it
 * "relies heavily on generic SaaS motion graphics (dark backgrounds, floating
 * UI, subtle zooms)" — which is the exact failure this whole sprint exists to
 * escape, and it was right. Every appearance of the product was a rectangle
 * with a screenshot on it, tilted slightly, floating on a field.
 *
 * The references do something else entirely. Their boundaries read "camera
 * pans down to new UI layout", "camera zooms into white space of a message",
 * "camera pans right to form UI" — the interface is a PLACE and the camera
 * moves through it. The scene language has been able to express that since it
 * was written: `crop` is animatable, and a crop that moves is a camera inside
 * the capture rather than a picture of it sliding about.
 *
 * It had never been used. So the crop travels here, the plate is full-bleed,
 * and the product stops being an object in the frame and becomes the frame.
 *
 * The aspect is arithmetic, not taste: a region of a 1.60:1 page fills a 16:9
 * frame when `cropWidth / cropHeight` is 1.11, so a 0.5 x 0.45 window travels
 * down the page without ever showing an edge.
 */
const stepTravel = (
  id: string, body: string, asset: string,
  window: { x: number; width: number; fromY: number; toY: number },
  seconds: number, travel: Travel,
): Graph =>
  SceneGraph.parse({
    id, durationSeconds: seconds,
    intent: 'STEP PRODUCT: the camera travels down the real interface, full-bleed.',
    background: PAPER,
    camera: camera(travel),
    objects: [
      {
        kind: 'ui_layer', id: `${id}_page`, assetId: asset, semantic: 'page',
        /*
         * The window is the page's own left column, and it was chosen by
         * rendering candidates and looking at them.
         *
         * A 16:9 window on a 1.60:1 page needs `cropWidth / cropHeight` of
         * 1.111 — that part is arithmetic. Where to put it is not. The first
         * attempt centred a half-page window and every frame of the move cut
         * the content column at both edges: "Fo..." and "Non..." hanging off
         * the sides, a headline sliced down the middle. A page has a layout
         * and a camera inside it has to respect that layout, the same way a
         * camera in a room does not frame half a doorway.
         */
        crop: {
          x: window.x, width: window.width, height: window.width / 1.111,
          y: { from: window.fromY, to: window.toY, curve: 'in_out_cubic' },
        },
        width: 1.08, cornerRadiusPx: 0, shadow: false,
        role: 'payload',
        reason: 'The real interface as a place the camera moves through, not a card it sits on.',
        transform: Transform.parse({ x: 0.5, y: 0.5, anchor: { x: 0.5, y: 0.5 } }),
      } as SceneObject,
      ...caption(`${id}_body`, body, { y: 0.87 }, PAPER, INK),
    ],
    audio: [
      { at: 0.04, kind: 'whoosh', intensity: 0.42, causedBy: `${id}_page`, reason: 'The camera enters the interface.' },
      { at: 0.45, kind: 'ui_click', intensity: 0.24, causedBy: `${id}_body`, reason: 'The caption.' },
      { at: seconds * 0.55, kind: 'ui_confirm', intensity: 0.3, causedBy: `${id}_page`, reason: 'Passing a control.' },
      { at: seconds - 0.4, kind: 'whoosh', intensity: 0.38, causedBy: `${id}_page`, reason: 'And out again.' },
    ],
    handover: { mechanism: 'camera_carry', carries: [`${id}_page`], durationSeconds: 0.42, reason: 'The move continues into the next step.' },
    macro: null,
  });

const stepProduct = (
  id: string, body: string, asset: string, crop: Record<string, unknown>,
  seconds: number, travel: Travel, place: { x: number; y: number; z: number },
  tilt: { rx: number; ry: number; rz: number }, width: number,
): Graph =>
  SceneGraph.parse({
    id, durationSeconds: seconds,
    intent: 'STEP PRODUCT: the real interface, large, with the camera travelling across it.',
    background: PAPER,
    camera: camera(travel),
    objects: [
      bloom(`${id}_bloom`, { x: 0.62, y: 0.44 }, '#FFEADC', 0.95),
      card(`${id}_card`, asset, crop, place, tilt, width, 0.0,
        'The real interface at this step, big enough to be the product rather than a picture of it.'),
      ...caption(`${id}_body`, body, { y: 0.87 }, INK, PAPER),
    ],
    audio: [
      { at: 0.05, kind: 'ui_confirm', intensity: 0.34, causedBy: `${id}_card`, reason: 'The interface arrives.' },
      { at: 0.55, kind: 'ui_click', intensity: 0.22, causedBy: `${id}_body`, reason: 'The caption under it.' },
      { at: seconds - 0.5, kind: 'whoosh', intensity: 0.36, causedBy: `${id}_card`, reason: 'The camera leaves for the next step.' },
    ],
    handover: { mechanism: 'camera_carry', carries: [`${id}_card`], durationSeconds: 0.42, reason: 'The camera travels sideways to the next step.' },
    macro: null,
  });

scenes.push(
  stepTitle('l5', '01', 'We read your product.', 2.6, 2.0, 'ast_home'),
  // Travelling down the homepage: the camera is inside it.
  stepTravel('l6', 'A real capture, never a drawing of one.', 'ast_home',
    { x: 0.04, width: 0.44, fromY: 0.02, toY: 0.30 }, 4.6, { scale: [1.06, 1.0], focal: 70 }),

  /*
   * THE PALETTE GAP, ANSWERED BY THE SCRIPT RATHER THAN BY DECORATION.
   *
   * The references use six to eight distinct hues; this film used three —
   * ink, paper and one orange — and read as monochrome beside them. The wrong
   * fix is to tint things. The right one was already in the copy: this beat
   * says "three directions", and until now it said it over an empty cream
   * field. So it SHOWS three, as three colour fields arriving one after
   * another and standing side by side.
   *
   * It is the only place in the film where colour is the subject, which is
   * also why it can afford to be loud: everywhere else the palette stays ink,
   * paper and the one accent, and this beat is the exception that makes the
   * restraint elsewhere read as a choice.
   */
  SceneGraph.parse({
    id: 'l7', durationSeconds: 2.6,
    intent: 'THREE DIRECTIONS: three colour fields arrive side by side, and the line names them.',
    background: PAPER,
    camera: camera({ scale: [1.00, 1.08], x: [0.03, 0], focal: 60, curve: 'linear' }),
    objects: [
      ...([
        ['#1F6F4A', 0.1667, 0.0],
        ['#2B4B9B', 0.5, 0.16],
        [ACCENT, 0.8333, 0.32],
      ] as const).map(([fill, x, enterAt], i) => ({
        kind: 'shape', id: `l7_field_${i}`, shape: 'rect',
        /*
         * Each field arrives fast and then HOLDS at full height.
         *
         * Growing them on a long stagger meant they were never all standing
         * at once: at any given frame one was half-built and another had not
         * started, so a beat whose whole point is three things side by side
         * never showed three things side by side. They snap up in a fifth of
         * a second each, a beat apart, and then the frame is what it says.
         */
        width: 0.35,
        height: { keyframes: [{ t: 0, value: 0 }, { t: 0.14, value: 1.02, curve: 'out_expo' }, { t: 1, value: 1.02 }], curve: 'out_expo' },
        fill, stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
        role: 'support', enterAt,
        reason: 'One of the three directions, as a field of its own colour.',
        transform: Transform.parse({ x, y: 0.5, z: 0.4, anchor: { x: 0.5, y: 0.5 } }),
      }) as SceneObject),
      /*
       * THE THREE DIRECTIONS, PLAYING.
       *
       * The fields were bare colour, and a model watching the film reported
       * exactly one confusion: "colour blocks feel disconnected from UI". It
       * was right, and the fault was not decorative — this beat's claim is that
       * the system directs THREE of them, and three rectangles of paint do not
       * carry that. They read as a palette, which is a statement about the
       * brand rather than about the work.
       *
       * These are the three real direction renders this system made while
       * choosing the look of this very film. Putting them here makes the claim
       * literally true rather than illustrated, and answers the same model's
       * other note — that the film was "missing actual examples of output
       * films" — with films instead of with a picture of films.
       *
       * They are NOT interface cards, which is why they are clips. Three
       * readable interfaces cannot sit side by side: at a third of the frame
       * each, every one of them is a thumbnail, and the inspector says so.
       * Footage does not have that problem, because footage at a third of the
       * frame is still footage.
       */
      ...([
        // Inset within their fields rather than filling them: a film sitting
        // ON a coloured panel reads as deliberate, where a film bleeding off
        // the frame edge reads as a crop nobody chose. The outer two are
        // pulled in to 0.20 and 0.80 so both edges clear at the widest the
        // camera goes.
        ['ast_dir_a_paper', 0.2, 0.06],
        ['ast_dir_b_depth', 0.5, 0.22],
        ['ast_dir_c_field', 0.8, 0.38],
      ] as const)
        .filter(([asset]) => ASSETS[asset])
        .map(([asset, x, enterAt], i) => ({
          kind: 'clip', id: `l7_film_${i}`, assetId: asset,
          crop: { x: 0, y: 0, width: 1, height: 1 },
          width: 0.26,
          // Each starts at a different second, so three films playing at once
          // do not cut in step and read as one image in three panels.
          sourceInSeconds: 1.2 + i * 2.6, playbackRate: 1, generated: true,
          /*
           * Support, not payload, and the inspector is what settled it: four
           * payloads at 0.8s means "the eye goes to one of them and the film
           * chooses which by accident". The LINE is what this beat asks you to
           * read. The three films are the evidence for it, and evidence does
           * not compete with the claim it supports.
           */
          role: 'support',
          reason: 'One of the three directions, as the film it actually is.',
          transform: Transform.parse({ x, y: 0.6, z: 0.2, anchor: { x: 0.5, y: 0.5 }, opacity: ARRIVES }),
        }) as SceneObject),
      line('l7_index', '02', {
        token: 'mono', color: PAPER, maxWidth: 0.1, maxLines: 1, role: 'structure', enterAt: 0.7,
      }, { x: 0.09, y: 0.13, anchor: { x: 0, y: 0.5 }, opacity: ARRIVES }),
      /*
       * The line sits ABOVE the films, not across them.
       *
       * At y 0.44 with the films centred at 0.5 it was drawn straight over the
       * first one — the title illegible, the film illegible, and the frame
       * reading as a mistake rather than as a layout. The films are in the
       * lower half now and the line has the top of the fields to itself.
       */
      line('l7_title', 'Three directions.', {
        maxWidth: 0.46, maxLines: 2, color: PAPER, stagger: 0.07, enterAt: 0.75,
      }, { x: 0.09, y: 0.26, anchor: { x: 0, y: 0.5 } }),
    ],
    audio: [
      { at: 0.02, kind: 'impact', intensity: 0.5, causedBy: 'l7_field_0', reason: 'The first field lands.' },
      { at: 0.14, kind: 'impact', intensity: 0.45, causedBy: 'l7_field_1', reason: 'The second.' },
      { at: 0.26, kind: 'impact', intensity: 0.5, causedBy: 'l7_field_2', reason: 'The third.' },
      { at: 0.55, kind: 'ui_click', intensity: 0.22, causedBy: 'l7_title', reason: 'The line over them.' },
      { at: 2.1, kind: 'whoosh', intensity: 0.4, causedBy: 'l7_field_2', reason: 'Into the work.' },
    ],
    handover: { mechanism: 'mask_reveal', carries: [], durationSeconds: 0.4, reason: 'The middle field opens onto the work itself.' },
    macro: null,
  }),
  // Travelling across the work: the same idea on the other axis.
  stepTravel('l8', 'Watched before one is chosen.', 'ast_work',
    { x: 0.04, width: 0.52, fromY: 0.36, toY: 0.12 }, 4.6, { scale: [1.0, 1.07], x: [-0.03, 0.03], focal: 70 }),

  stepTitle('l9', '03', 'One afternoon.', 2.0, 1.5, 'ast_pricing'),
  /*
   * The one held card in the film, and it is here on purpose.
   *
   * Three travelling shots in a row is the same shot three times, which is the
   * repetition this act was split up to avoid in the first place. The last
   * step pulls back out of the page and shows the thing as an object again,
   * which also lets the act end wider than it began.
   */
  stepProduct('l10', 'It checks its own frames.', 'ast_pricing', CARD_CROP['ast_pricing']!, 4.6,
    { x: [0.09, -0.09], scale: [1.24, 1.0], focal: [105, 88], dolly: [0, 0.4] }, { x: 0.6, y: 0.45, z: -0.16 }, { rx: 4, ry: -10, rz: 2 }, 0.64),
);

// ---- ACT 4: the argument ---------------------------------------------------

/*
 * THE MEASURE, which is the one thing in this film that is neither type nor
 * screenshot.
 *
 * Thirty marks across a rule, dense at the left, that gather into the width of
 * an afternoon while the rule stays exactly where it was. It was built for an
 * earlier cut and a model watching that film called it the strongest moment in
 * it — but only once the marks were given time to arrive and SIT there,
 * gathered, under a line that still said six weeks. Landing the collapse on
 * the same frame the words changed made the model read the moment as "text
 * changes" and record no transformation at all. Words win when they move at
 * the same time.
 */
const TICKS = 30;
const SPREAD_FROM = 0.12;
const SPREAD_TO = 0.88;
const GATHERED_AT = 0.14;
const GATHERED_WIDTH = 0.07;
const RULE_Y = 0.68;

const tick = (index: number, gathered: boolean): SceneObject => {
  const t = index / (TICKS - 1);
  const spread = SPREAD_FROM + t * (SPREAD_TO - SPREAD_FROM);
  const gather = GATHERED_AT + t * GATHERED_WIDTH;
  /*
   * Big enough to be the thing the film is about.
   *
   * The measure is the one image here that is neither type nor screenshot,
   * a model watching an earlier cut called it the strongest moment in the
   * film, and it was drawn at two thousandths of a frame wide and four
   * hundredths tall — a row of hairlines occupying about two per cent of the
   * picture. A hero device has to be able to carry a frame on its own.
   */
  const height = index % 5 === 0 ? 0.17 : 0.1;
  return {
    kind: 'shape', id: `tick_${index}`, shape: 'rect',
    width: 0.0045, height,
    fill: index % 5 === 0 ? 'accent' : 'onCanvas.primary',
    stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
    role: 'structure',
    reason: 'One day of the six weeks, as a mark on the measure.',
    enterAt: gathered ? 0 : 0.04 + index * 0.011,
    transform: Transform.parse({
      x: gathered
        ? gather
        : { keyframes: [{ t: 0, value: spread }, { t: 0.4, value: spread }, { t: 0.76, value: gather, curve: 'in_out_quart' }, { t: 1, value: gather }], curve: 'in_out_quart' },
      y: RULE_Y - height / 2 - 0.006,
      anchor: { x: 0.5, y: 1 },
      opacity: gathered ? 1 : { from: 0, to: 1, curve: 'out_cubic' },
    }),
  } as SceneObject;
};

const measureRule = (drawn: boolean): SceneObject =>
  ({
    kind: 'shape', id: 'measure_rule', shape: 'rect',
    width: drawn ? SPREAD_TO - SPREAD_FROM + 0.02 : { from: 0, to: SPREAD_TO - SPREAD_FROM + 0.02, curve: 'out_expo' },
    height: 0.0045,
    fill: 'onCanvas.primary', stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
    role: 'structure',
    reason: 'The rule the measure is drawn on. It never moves, so the collapse is visible against it.',
    transform: Transform.parse({ x: SPREAD_FROM - 0.01, y: RULE_Y, anchor: { x: 0, y: 0.5 } }),
  }) as SceneObject;

scenes.push(
  SceneGraph.parse({
    id: 'l11', durationSeconds: 5.2,
    intent: 'THE MEASURE: thirty days drawn across the page, then gathered into one afternoon.',
    background: PAPER,
    camera: camera({ x: [-0.11, 0.11], scale: [0.88, 1.08], focal: 70, curve: 'linear' }),
    objects: [
      bloom('l11_bloom', { x: 0.4, y: 0.5 }, '#FFEADC', 0.95),
      ...Array.from({ length: TICKS }, (_, i) => tick(i, false)),
      measureRule(false),
      line('l11_line', 'Six weeks', {
        maxWidth: 0.4, maxLines: 1,
      }, arrive({ x: 0.18 }, { x: 0.14, y: 0.28 }, { anchor: { x: 0, y: 0.5 } })),
      line('l11_sub', 'to make one launch film.', {
        token: 'statement', color: 'onCanvas.secondary', maxWidth: 0.44, maxLines: 1, enterAt: 0.7,
      }, { x: 0.14, y: 0.375, anchor: { x: 0, y: 0.5 }, opacity: ARRIVES }),
    ],
    audio: [
      { at: 0.06, kind: 'ui_click', intensity: 0.3, causedBy: 'measure_rule', reason: 'The rule is drawn.' },
      { at: 0.5, kind: 'ui_click', intensity: 0.18, causedBy: 'tick_0', reason: 'A day.' },
      { at: 0.85, kind: 'ui_click', intensity: 0.18, causedBy: 'tick_10', reason: 'A day.' },
      { at: 1.2, kind: 'ui_click', intensity: 0.18, causedBy: 'tick_20', reason: 'A day.' },
      { at: 2.1, kind: 'riser', intensity: 0.5, causedBy: 'tick_29', reason: 'The measure fills; something is about to give.' },
      { at: 4.15, kind: 'impact', intensity: 0.62, causedBy: 'tick_0', reason: 'The thirty marks arrive together.' },
    ],
    handover: {
      mechanism: 'object_handoff',
      carries: ['measure_rule', 'tick_0', 'tick_29'],
      durationSeconds: 0.4,
      reason: 'The measure is the same measure; only its spacing has changed.',
    },
    macro: null,
  }),

  SceneGraph.parse({
    id: 'l12', durationSeconds: 3.2,
    intent: 'THE TURN: the same marks, gathered, and the line finally agrees with the picture.',
    background: PAPER,
    camera: camera({ scale: [0.94, 1.14], x: [0.10, -0.04], focal: 70, curve: 'linear' }),
    objects: [
      bloom('l12_bloom', { x: 0.26, y: 0.52 }, '#FFE2CE', 0.85),
      measureRule(true),
      ...Array.from({ length: TICKS }, (_, i) => tick(i, true)),
      line('l12_line', 'One afternoon.', {
        color: 'accent', maxWidth: 0.46, maxLines: 1,
      }, {
        x: 0.14, y: 0.28, anchor: { x: 0, y: 0.5 },
        opacity: ARRIVES,
        scale: { from: 0.96, to: 1, curve: 'out_expo' },
      }),
    ],
    audio: [{ at: 0.02, kind: 'sub_drop', intensity: 0.7, causedBy: 'l12_line', reason: 'The counter-statement lands on the gathered marks.' }],
    handover: { mechanism: 'scale_through', carries: [], durationSeconds: 0.5, reason: 'The camera pushes through the page into the dark.' },
    macro: null,
  }),
);

// ---- ACT 5: benefit and call ----------------------------------------------

scenes.push(
  SceneGraph.parse({
    id: 'l13', durationSeconds: 4.4,
    intent: 'BENEFIT: the number, filled with light, arriving from the left as the camera pulls back.',
    background: INK,
    camera: camera({ x: [-0.10, 0.06], scale: [1.10, 0.88], focal: 60, curve: 'linear' }),
    objects: [
      lamp('l13_light', { x: 0.24, y: 0.6 }, { x: 0.44, y: 0.46 }, EMBER, 0.82),
      line('l13_stat', '6 weeks to 1 day', {
        maxWidth: 0.42, maxLines: 2,
        treatment: { gradient: { from: ACCENT, to: AMBER, angleDeg: { from: 70, to: 115, curve: 'in_out_cubic' } }, stroke: null, glow: null },
      }, {
        ...arrive({ x: 0.16 }, { x: 0.28, y: 0.42 }, { anchor: { x: 0, y: 0.5 } }),
        scale: { from: 1.0, to: 1.08, curve: 'out_expo' },
        opacity: ARRIVES,
      }),
      line('l13_sub', 'Same craft. Same checks.', {
        token: 'statement', color: 'onCanvas.muted', maxWidth: 0.36, maxLines: 2, enterAt: 0.9,
      }, { x: 0.28, y: 0.7, anchor: { x: 0, y: 0.5 }, opacity: ARRIVES }),
    ],
    audio: [
      { at: 0.06, kind: 'sub_drop', intensity: 0.68, causedBy: 'l13_stat', reason: 'The number lands.' },
      { at: 1.15, kind: 'ui_confirm', intensity: 0.3, causedBy: 'l13_sub', reason: 'The qualifier under it.' },
    ],
    handover: { mechanism: 'camera_carry', carries: [], durationSeconds: 0.4, reason: 'The move carries on into the year.' },
    macro: null,
  }),

  /*
   * THE OUTPUT. The one note a model watching this film put above every other:
   * "the viewer never sees the actual output (the generated film), only the
   * ordering interface", with hero moments scored at zero. A film about making
   * films that only ever showed the order form.
   *
   * It is the opening shot twelve hours later. That rhyme is the whole idea —
   * the film began on this desk at dusk, cluttered, somebody pushing back from
   * it after too long; this is the same desk at dawn, cleared, the light rising
   * across it. The opening is the six weeks and this is the afternoon.
   *
   * WORDLESS, and full-bleed, on purpose. Everything around it is composed —
   * type on a field, captures on a plane — and this is the only thing in the
   * film that looks photographed. That difference is what says "this is the
   * thing you get" more clearly than a caption naming it would, and a hero
   * moment that has to be labelled is not one.
   */
  SceneGraph.parse({
    id: 'l13b', durationSeconds: 3.6,
    intent: 'THE OUTPUT: the film that came back, full-bleed and wordless. The opening desk at dawn.',
    background: INK,
    camera: camera({ scale: [1.08, 0.96], x: [-0.03, 0.03], focal: 50, curve: 'linear' }),
    objects: [
      {
        kind: 'clip', id: 'l13b_film', assetId: 'ast_output',
        crop: { x: 0, y: 0, width: 1, height: 1 },
        /*
         * 1.12, and no wider, because the footage came back at 1280x720 against
         * a 1920x1080 film. Every extra tenth of width is more upscale on the
         * one shot in the picture that is supposed to look photographed. The
         * camera on this shot reaches 0.96, which shows 1.04 of content, so
         * 1.12 already has travel room to spare — 1.25 was buying margin nobody
         * needed at the cost of the thing the shot is for.
         *
         * Played straight from 0.3s: the light crossing the desk IS the shot,
         * and the earlier window ended before the wood was fully lit, which
         * threw away the resolution the whole four seconds builds to.
         */
        width: 1.12, sourceInSeconds: 0.3, playbackRate: 1, generated: true,
        role: 'payload',
        reason: 'The delivered film. Photographed rather than composed, which is what marks it as the output.',
        transform: Transform.parse({ x: 0.5, y: 0.5, anchor: { x: 0.5, y: 0.5 } }),
      } as SceneObject,
    ],
    audio: [
      { at: 0.02, kind: 'sub_drop', intensity: 0.55, causedBy: 'l13b_film', reason: 'The film lands, and the bed opens under it.' },
      { at: 0.12, kind: 'texture', intensity: 0.45, causedBy: 'l13b_film', reason: 'Room tone: the same room as the opening.' },
      { at: 2.9, kind: 'riser', intensity: 0.38, causedBy: 'l13b_film', reason: 'Into the year.' },
    ],
    handover: { mechanism: 'scale_through', carries: [], durationSeconds: 0.45, reason: 'The dawn light carries through into the field of colour.' },
    macro: null,
  }),

  SceneGraph.parse({
    id: 'l14', durationSeconds: 3.2,
    intent: 'THE YEAR: a hollow outline that blooms. Short, because it is a punctuation mark.',
    background: INK,
    camera: camera({ scale: [1.06, 0.86], focal: 85, curve: 'linear' }),
    objects: [
      lamp('l14_light', { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.46 }, EMBER, 0.6),
      /*
       * THE COLOUR TAKES THE FRAME. This is the film's turn, and it was three
       * consecutive still pictures of white type on near-black — the exact
       * grammar a model watching this film called "generic dark-background SaaS
       * tropes". The references punctuate with saturation: the strongest of them
       * hard-cuts to a full orange field to land two words.
       *
       * It floods up rather than fades: a wipe is an EVENT, and this shot had no
       * event in it. The year is knocked out of the field rather than drawn on
       * it, which is why the outline and glow below are gone — an accent stroke
       * on an accent field is invisible, and a hollow year was always the timid
       * version of this idea.
       */
      ({
        kind: 'shape', id: 'l14_field', shape: 'rect',
        /*
         * Big enough to survive the camera.
         *
         * At 1.04 this had visible dark margins down both sides and across the
         * top. Sizing it to 1.4 fixed those and left the FOURTH edge, which is
         * the one this note exists for: the field is anchored to the bottom of
         * the content, and a pull-back lifts that edge into frame. Measured on
         * the render, the bottom strip went from 122 to 44 brightness across
         * the shot — the dark creeping up underneath it.
         *
         * So size is not enough; the edges have to be OFF-FRAME. This camera
         * reaches 0.86, at which the visible content runs from -0.081 to 1.081
         * on both axes. A field 1.4 wide centred at 0.5 spans -0.2 to 1.2, and
         * one 1.5 tall hung from y = 1.2 spans -0.3 to 1.2. Every edge clears,
         * with room, at the widest the camera ever goes.
         */
        width: 1.4,
        height: { keyframes: [{ t: 0, value: 0 }, { t: 0.18, value: 1.5, curve: 'out_expo' }, { t: 1, value: 1.5 }], curve: 'out_expo' },
        fill: ACCENT, stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
        role: 'support', enterAt: 0,
        reason: 'The brand colour arrives and takes the whole frame.',
        // Anchored at the bottom so growing height reads as rising, not as
        // opening out from the middle.
        transform: Transform.parse({ x: 0.5, y: 1.2, z: 0.6, anchor: { x: 0.5, y: 1 } }),
      } as SceneObject),
      line('l14_year', '2026', {
        align: 'center', maxWidth: 0.5, maxLines: 1, color: INK,
        treatment: { gradient: null, stroke: null, glow: null },
      }, {
        x: 0.5, y: 0.46, anchor: { x: 0.5, y: 0.5 },
        scale: { from: 1.42, to: 1.62, curve: 'out_expo' },
        opacity: ARRIVES,
      }),
      line('l14_sub', 'It stops taking weeks.', {
        // Ink on the field, not the muted token: 'onCanvas.muted' is resolved
        // against the scene's BACKGROUND, which is still ink, so it would be
        // picked for legibility against a field this shot no longer shows.
        token: 'statement', align: 'center', color: EMBER, maxWidth: 0.44, maxLines: 2, enterAt: 0.55,
      }, { x: 0.5, y: 0.68, anchor: { x: 0.5, y: 0.5 }, opacity: ARRIVES }),
    ],
    audio: [
      { at: 0.04, kind: 'impact', intensity: 0.6, causedBy: 'l14_year', reason: 'The year arrives.' },
      { at: 0.75, kind: 'ui_click', intensity: 0.22, causedBy: 'l14_sub', reason: 'The line under it.' },
    ],
    handover: { mechanism: 'mask_reveal', carries: [], durationSeconds: 0.42, reason: 'The call wipes in under the year.' },
    macro: null,
  }),

  SceneGraph.parse({
    id: 'l15', durationSeconds: 3.8,
    intent: 'CALL: the mark, the invitation, and the rule the film has used throughout, closing it.',
    background: INK,
    camera: camera({ x: [0.07, -0.05], scale: [0.90, 1.06], focal: 85, curve: 'linear' }),
    objects: [
      lamp('l15_light', { x: 0.24, y: 0.52 }, { x: 0.3, y: 0.5 }, EMBER, 0.75),
      line('l15_mark', 'Act One', {
        maxWidth: 0.4, maxLines: 1, color: PAPER,
        treatment: { gradient: null, stroke: null, glow: { color: '#FF6A33', radiusPx: { from: 8, to: 24, curve: 'out_expo' }, strength: 0.6 } },
      }, arrive({ x: 0.16 }, { x: 0.1, y: 0.44 }, { anchor: { x: 0, y: 0.5 }, opacity: ARRIVES })),
      line('l15_call', 'Give us your product.', {
        token: 'statement', color: 'onCanvas.muted', maxWidth: 0.38, maxLines: 1, enterAt: 0.7,
      }, { x: 0.1, y: 0.58, anchor: { x: 0, y: 0.5 }, opacity: ARRIVES }),
      {
        kind: 'shape', id: 'l15_rule', shape: 'rect',
        width: { from: 0, to: 0.16, curve: 'out_expo' }, height: 0.004,
        fill: 'accent', stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
        role: 'structure', enterAt: 1.4,
        reason: 'The rule the film has used throughout, closing it.',
        transform: Transform.parse({ x: 0.1, y: 0.68, anchor: { x: 0, y: 0.5 } }),
      } as SceneObject,
    ],
    audio: [
      { at: 0.1, kind: 'logo_sting', intensity: 0.58, causedBy: 'l15_mark', reason: 'The mark, and the end of the sentence.' },
      { at: 1.45, kind: 'ui_click', intensity: 0.25, causedBy: 'l15_rule', reason: 'The rule draws.' },
    ],
    macro: null,
  }),
);

// ---------------------------------------------------------------------------

/*
 * THE READ COMES FIRST, AND THE CUT IS MADE AROUND IT.
 *
 * This used to run after the picture was rendered, which quietly settled an
 * argument nobody had: if a line did not fit its shot, the line was wrong. That
 * is backwards for a narrated film. The voice carries the meaning and the
 * picture is what it is carried over, so where the two disagree about three
 * tenths of a second it is cheaper to hold the picture.
 *
 * Reading before rendering is what makes that possible at all — a shot cannot be
 * held longer once its frames exist.
 */
const castVoice = process.env['ACT_ONE_VOICE'] ?? NARRATOR;
const takes = await narrate({ directory: path.resolve('.renders/vo'), voiceId: castVoice });
const firstPass = place(takes, scenes);
const retimed = retimeForNarration(scenes, firstPass);
for (const scene of scenes) {
  const held = retimed.durations.get(scene.id);
  if (held !== undefined) scene.durationSeconds = held;
}
const placed = place(takes, scenes);

const seconds = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
console.log(`=== the launch film: ${seconds.toFixed(1)}s, ${scenes.length} shots ===`);
console.log(`  VOICE ${castVoice} via eleven_v3: ${placed.length} lines, ${wordsPerMinute(takes).toFixed(0)} wpm`);
if (retimed.held.length) {
  console.log(`  HELD for the read (+${retimed.addedSeconds.toFixed(2)}s total): ${retimed.held.join(', ')}`);
}
for (const take of placed.filter((t) => t.overrunSeconds > 0.12)) {
  console.log(`  OVERRUN ${take.sceneId} still runs ${take.overrunSeconds.toFixed(2)}s past its shot`);
}

/* The shot table, on demand: what each shot is, when it starts, and what it
 * says on screen. Narration is written against this — a voice that reads the
 * words already on the frame adds nothing, so the writing needs to see them. */
if (process.env['ACT_ONE_SHOT_TABLE']) {
  let at = 0;
  for (const scene of scenes) {
    const words = scene.objects
      .filter((o) => o.kind === 'text')
      .map((o) => (o as { content?: string }).content ?? '')
      .filter(Boolean);
    console.log(`${scene.id}\t${at.toFixed(1)}\t${scene.durationSeconds}\t${scene.intent}`);
    for (const w of words) console.log(`\t\tTEXT ${JSON.stringify(w)}`);
    at += scene.durationSeconds;
  }
  process.exit(0);
}

const registry = new CapabilityRegistry();
let problems = 0;
for (const scene of scenes) {
  const routing = routeScene(scene, registry);
  problems += routing.problems.length;
  for (const p of routing.problems) console.log(`  ROUTE ${scene.id}/${p.objectId}: ${p.message}`);
}
const findings = inspectScenes(scenes, EASINGS, { registry });
const shown = findings.filter((f) => f.check !== 'brand_token_violation');
for (const f of shown) console.log(`  ${f.severity.padEnd(9)} ${f.check.padEnd(28)} ${f.sceneId} ${f.message.slice(0, 92)}`);
console.log(`  (${findings.length - shown.length} brand-token notes suppressed: this film's palette is its brand)`);

if (problems > 0 || findings.some((f) => f.severity === 'hard_fail')) {
  console.log('  refusing to render');
  process.exit(1);
}
if (process.env['ACT_ONE_INSPECT_ONLY']) process.exit(0);

const silent = path.resolve('.renders/launch.silent.mp4');
/*
 * An audition changes the READ, not the picture.
 *
 * Casting is decided by watching several voices against the same cut, and
 * re-rendering 1734 identical frames for each candidate would cost four
 * minutes apiece to produce four byte-identical pictures. So a named audition
 * writes beside the master and reuses the silent render — which also means
 * every candidate is judged against exactly the same frames, rather than
 * against four renders that might differ.
 */
const audition = process.env['ACT_ONE_AUDITION'] ?? '';
const out = path.resolve(audition ? `.renders/audition-${audition}.mp4` : '.renders/launch.mp4');
const reusePicture = audition !== '' && existsSync(silent);
const started = Date.now();
const result = reusePicture ? { undecodable: [] as string[] } : await renderScenes({
  scenes, brand, assetUrls: ASSETS,
  aspect: '16:9',
  quality: (process.env['ACT_ONE_QUALITY'] as 'preview' | 'hd' | undefined) ?? 'hd',
  outputPath: silent, concurrency: 3, theme: 'light',
});
console.log(reusePicture ? '  reusing the rendered picture; only the read changes' : `  rendered in ${((Date.now() - started) / 1000).toFixed(0)}s`);
if (result.undecodable.length) console.log('  undecodable:', result.undecodable);

const design = soundForScenes(scenes, {
  /*
   * 'percussive', not 'restrained'.
   *
   * The references register 44, 126 and 168 audio accents; this film
   * registered 11. The cues were not the problem — there are thirty of them.
   * The bed was: `musicCharacter` is matched against a word list, 'restrained'
   * matches nothing, and the fallback is `sub_tonal`, which selected a 72bpm
   * ambient pad. A pad has no accents in it, so the only things the meter
   * could hear were the impacts.
   *
   * A pulse under an editorial film is not the same as making it loud. It is
   * what gives the cuts something to land on, and it is most of the difference
   * between a film that feels edited and one that feels assembled.
   */
  behaviour: { musicCharacter: 'percussive', openOnMusic: false, uiSoundDensity: 'rhythmic', impactsOnCuts: true, endWithSting: true },
  channel: 'web',
  hasVoiceOver: true,
});
const resolved = Object.fromEntries(
  [...DEFAULT_LIBRARY.music, ...DEFAULT_LIBRARY.sfx]
    .map((item) => [item.storageKey, path.join(STORAGE, item.storageKey)] as const)
    .filter(([, file]) => existsSync(file)),
);
console.log(`  MUSIC ${design.music?.trackId} enter ${design.music?.enterAtSeconds}s exit ${design.music?.exitAtSeconds}s gain ${design.music?.baseGainDb}dB`);
console.log(`  ENDING ${design.ending.strategy}; silence ${design.silenceSeconds}s`);
for (const note of design.notes) console.log(`  NOTE ${note}`);
const byGain = [...design.cues].sort((a, b) => b.gainDb - a.gainDb).slice(0, 6);
console.log('  LOUDEST CUES', byGain.map((c) => `${c.type}@${c.atSeconds}s ${c.gainDb}dB`).join(' | '));
const plan = buildMix({
  design,
  resolvedPaths: resolved,
  durationSeconds: seconds,
  voiceTracks: placed.map(({ path: file, atSeconds, durationSeconds }) => ({ path: file, atSeconds, durationSeconds })),
});
const premix = path.resolve('.renders/launch.premix.wav');
const mixed = await runFfmpeg(mixArgs(plan, premix), { timeoutMs: 8 * 60_000 });
if (!mixed.ok) throw new Error(`mix failed: ${mixed.stderr.slice(-300)}`);

const master = path.resolve('.renders/launch.mix.wav');
await masterLoudness({ source: premix, target: master, lufs: design.targetLufs, outputArgs: ['-c:a', 'pcm_s24le'] });

const muxed = await runFfmpeg(muxArgs(silent, master, out), { timeoutMs: 8 * 60_000 });
if (!muxed.ok) throw new Error(`mux failed: ${muxed.stderr.slice(-300)}`);
console.log(`  ${design.cues.length} cues, ${design.targetLufs} LUFS -> ${out}`);
