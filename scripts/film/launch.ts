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
 * WHAT IS DELIBERATELY NOT COPIED. The references are narrated, with burned-in
 * captions, and the voice carries their pace. This one has no voice — the
 * ElevenLabs credential is dead and a synthetic read would be worse than
 * silence — so it is cut to hold its lines long enough to be read, and it says
 * less. A film that copies the pacing of a narration it does not have is a
 * film with gaps in it.
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
    transform: Transform.parse({ x: 0.5, y: 0.5, anchor: { x: 0.5, y: 0.5 } }),
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
    transform: Transform.parse({ x: 0.5, y: 0.5, anchor: { x: 0.5, y: 0.5 } }),
  }) as SceneObject;

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
      opacity: { from: 0, to: 1, curve: 'out_cubic' },
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
    x: 0.5, y: 0.42, anchor: { x: 0.5, y: 0.5 },
    scale: { from: 1.9, to: 2.15, curve: 'in_out_cubic' },
    opacity: { from: 0, to: 1, curve: 'out_cubic' },
  });

// ---------------------------------------------------------------------------
// The film: pain, brand, how it works, benefit, call.
// ---------------------------------------------------------------------------

const scenes: Graph[] = [
  // --- 1. THE PAIN ---------------------------------------------------------
  SceneGraph.parse({
    id: 'l1', durationSeconds: 4.2,
    intent: 'PAIN: a real room at the end of a long day, before anything is said.',
    background: INK,
    camera: { scale: { from: 1.08, to: 1.0, curve: 'out_expo' }, focalLengthMm: 40 },
    objects: [
      {
        kind: 'clip', id: 'l1_room', assetId: 'ast_before',
        crop: { x: 0, y: 0, width: 1, height: 1 },
        width: 1.14, sourceInSeconds: 0.15, playbackRate: 0.8, generated: true,
        role: 'payload',
        reason: 'The world the product lives in, shot rather than drawn. No interface appears in it.',
        transform: Transform.parse({ x: 0.5, y: 0.5, anchor: { x: 0.5, y: 0.5 } }),
      } as SceneObject,
    ],
    audio: [{ at: 0.1, kind: 'texture', intensity: 0.45, causedBy: 'l1_room', reason: 'Room tone under the shot.' }],
    handover: { mechanism: 'field_change', carries: [], durationSeconds: 0.3, reason: 'The room gives way to the page.' },
    macro: null,
  }),

  SceneGraph.parse({
    id: 'l2', durationSeconds: 5.0,
    intent: 'PAIN NAMED: the sentence, with the part that matters set apart inside it.',
    background: INK,
    camera: { scale: { from: 1.02, to: 1.0, curve: 'out_expo' }, focalLengthMm: 55 },
    objects: [
      lamp('l2_light', { x: 0.24, y: 0.34 }, { x: 0.34, y: 0.44 }, EMBER, 0.85),
      line('l2_line', 'Your problem is not the film.', {
        maxWidth: 0.5, maxLines: 2, stagger: 0.05,
        spans: [
          { text: 'Your problem is not ' },
          { text: 'the film', color: ACCENT, weight: 700 },
          { text: '.' },
        ],
      }, { x: 0.12, y: 0.42, anchor: { x: 0, y: 0.5 } }),
      line('l2_sub', 'It is the six weeks before it.', {
        token: 'statement', color: 'onCanvas.muted', maxWidth: 0.44, maxLines: 2, enterAt: 1.1,
      }, { x: 0.12, y: 0.56, anchor: { x: 0, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_cubic' } }),
    ],
    audio: [{ at: 0.08, kind: 'impact', intensity: 0.45, causedBy: 'l2_line', reason: 'The line lands.' }],
    handover: { mechanism: 'field_change', carries: [], durationSeconds: 0.25, reason: 'Ink to paper.' },
    macro: null,
  }),

  SceneGraph.parse({
    id: 'l3', durationSeconds: 6.0,
    intent: 'PAIN SHOWN: the work spread across a desk, too much of it, held at angles.',
    background: PAPER,
    camera: {
      focalLengthMm: { from: 34, to: 30, curve: 'in_out_cubic' },
      dollyZ: { from: 0, to: 0.4, curve: 'in_out_cubic' },
      scale: { from: 1.0, to: 1.04, curve: 'in_out_cubic' },
    },
    objects: [
      bloom('l3_bloom', { x: 0.5, y: 0.45 }, '#FFE8D8', 0.9),
      chapterWord('l3_chapter', 'SIX WEEKS', '#E6E0D4'),
      card('l3_c1', 'ast_how_stages', { x: 0, y: 0, width: 1, height: 0.52 }, { x: 0.27, y: 0.4, z: 0.42 }, { rx: 9, ry: 20, rz: -4 }, 0.40, 0.1, 'The brief, as one of too many pages.'),
      card('l3_c2', 'ast_work_films', { x: 0, y: 0, width: 1, height: 0.52 }, { x: 0.63, y: 0.3, z: -0.05 }, { rx: -7, ry: -17, rz: 3 }, 0.40, 0.45, 'The references, as another.'),
      card('l3_c3', 'ast_pricing_terms', { x: 0, y: 0, width: 1, height: 0.52 }, { x: 0.42, y: 0.72, z: 0.2 }, { rx: 13, ry: 7, rz: -2 }, 0.38, 0.8, 'The terms, as a third.'),
      card('l3_c4', 'ast_home_steps', { x: 0, y: 0, width: 1, height: 0.52 }, { x: 0.72, y: 0.68, z: -0.3 }, { rx: -9, ry: -25, rz: 5 }, 0.36, 1.15, 'The schedule, as a fourth.'),
      line('l3_tag', 'Briefs. References. Revisions. Quotes.', {
        token: 'statement', color: 'onCanvas.muted', maxWidth: 0.42, maxLines: 2, enterAt: 2.2,
      }, { x: 0.1, y: 0.9, anchor: { x: 0, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_cubic' } }),
    ],
    audio: [
      { at: 0.15, kind: 'ui_click', intensity: 0.3, causedBy: 'l3_c1', reason: 'Each page sets down.' },
      { at: 3.4, kind: 'riser', intensity: 0.5, causedBy: 'l3_c4', reason: 'Too much of it; something has to give.' },
    ],
    handover: { mechanism: 'field_change', carries: [], durationSeconds: 0.2, reason: 'The page goes to ink for the mark.' },
    macro: null,
  }),

  // --- 2. THE BRAND --------------------------------------------------------
  SceneGraph.parse({
    id: 'l4', durationSeconds: 4.6,
    intent: 'BRAND: the mark arrives lit, in the dark, alone.',
    background: INK,
    camera: { scale: { from: 1.12, to: 1.0, curve: 'out_expo' }, focalLengthMm: 70 },
    objects: [
      lamp('l4_light', { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.46 }, EMBER, 0.7),
      line('l4_mark', 'Act One', {
        align: 'center', maxWidth: 0.5, maxLines: 1,
        color: PAPER,
        treatment: { gradient: null, stroke: null, glow: { color: '#FF6A33', radiusPx: { from: 6, to: 30, curve: 'out_expo' }, strength: 0.75 } },
      }, {
        x: 0.5, y: 0.46, anchor: { x: 0.5, y: 0.5 },
        scale: { from: 0.94, to: 1, curve: 'out_expo' },
        opacity: { from: 0, to: 1, curve: 'out_expo' },
      }),
      line('l4_sub', 'Launch films, directed.', {
        token: 'statement', align: 'center', color: 'onCanvas.muted', maxWidth: 0.4, maxLines: 1, enterAt: 1.1,
      }, { x: 0.5, y: 0.58, anchor: { x: 0.5, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_cubic' } }),
    ],
    audio: [{ at: 0.25, kind: 'logo_sting', intensity: 0.65, causedBy: 'l4_mark', reason: 'The mark.' }],
    handover: { mechanism: 'field_change', carries: [], durationSeconds: 0.25, reason: 'Into the work.' },
    macro: null,
  }),
];

// --- 3. HOW IT WORKS ------------------------------------------------------

/**
 * One step of the process.
 *
 * Built as a function because the references do this too: the how-it-works act
 * is the same composition three or four times with different content, and that
 * is a rhythm rather than a repetition — the viewer learns the shape in the
 * first one and reads the rest faster. The structural similarity check is
 * right that these are the same picture; here that is the intention, and the
 * handover between them says so.
 */
const step = (
  id: string, index: string, title: string, body: string,
  asset: string, crop: Record<string, unknown>, seconds: number,
): Graph =>
  SceneGraph.parse({
    id, durationSeconds: seconds,
    intent: `HOW IT WORKS: ${title.toLowerCase()}, with the real interface beside it.`,
    background: PAPER,
    camera: {
      focalLengthMm: 42,
      scale: { from: 1.02, to: 1.0, curve: 'out_quint' },
      x: { from: 0.008, to: -0.008, curve: 'in_out_cubic' },
    },
    objects: [
      bloom(`${id}_bloom`, { x: 0.72, y: 0.4 }, '#FFEADC', 0.95),
      line(`${id}_index`, index, {
        token: 'mono', color: ACCENT, maxWidth: 0.1, maxLines: 1, role: 'structure',
      }, { x: 0.09, y: 0.26, anchor: { x: 0, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_cubic' } }),
      line(`${id}_title`, title, {
        maxWidth: 0.32, maxLines: 2,
      }, { x: 0.09, y: 0.38, anchor: { x: 0, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_expo' } }),
      line(`${id}_body`, body, {
        token: 'statement', color: 'onCanvas.muted', maxWidth: 0.3, maxLines: 3, enterAt: 0.55,
      }, { x: 0.09, y: 0.54, anchor: { x: 0, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_cubic' } }),
      card(`${id}_card`, asset, crop, { x: 0.68, y: 0.5, z: -0.12 }, { rx: 4, ry: -13, rz: 1.5 }, 0.52, 0.3,
        'The real interface at this step, held where a hand would hold it.'),
    ],
    audio: [{ at: 0.12, kind: 'ui_click', intensity: 0.35, causedBy: `${id}_card`, reason: 'The step lands.' }],
    handover: { mechanism: 'object_handoff', carries: [`${id}_card`], durationSeconds: 0.3, reason: 'The same frame, the next step in it.' },
    macro: null,
  });

scenes.push(
  /*
    * The bodies are one clause each, and that is the reference films' lesson
    * rather than a constraint of this one. All three are narrated: the voice
    * carries the detail and the screen carries a label. Written as prose, the
    * same sentences failed the reading-time check by two to three seconds a
    * shot — a line nobody can finish is a line that was not said.
    */
  step('l5', '01', 'We read your product.',
    'A real capture, never a drawing of one.',
    'ast_home_hero', { x: 0, y: 0, width: 0.86, height: 0.72 }, 6.2),
  step('l6', '02', 'Three directions.',
    'Rendered and watched before one is chosen.',
    'ast_work_films', { x: 0, y: 0, width: 1, height: 0.62 }, 6.2),
  step('l7', '03', 'One afternoon.',
    'The engine checks its own frames, then hands you a master.',
    'ast_how_stages', { x: 0, y: 0, width: 1, height: 0.58 }, 6.2),
);

// --- 4. THE BENEFIT -------------------------------------------------------

scenes.push(
  SceneGraph.parse({
    id: 'l8', durationSeconds: 5.4,
    intent: 'BENEFIT: the number, filled with light, against the dark.',
    background: INK,
    camera: { scale: { from: 1.06, to: 1.0, curve: 'out_expo' }, focalLengthMm: 60 },
    objects: [
      lamp('l8_light', { x: 0.3, y: 0.55 }, { x: 0.42, y: 0.48 }, EMBER, 0.8),
      line('l8_stat', '6 weeks to 1 day', {
        maxWidth: 0.5, maxLines: 2,
        treatment: { gradient: { from: ACCENT, to: AMBER, angleDeg: 105 }, stroke: null, glow: null },
      }, {
        x: 0.1, y: 0.42, anchor: { x: 0, y: 0.5 },
        scale: { from: 1.18, to: 1.28, curve: 'out_expo' },
        opacity: { from: 0, to: 1, curve: 'out_expo' },
      }),
      line('l8_sub', 'Same craft. Same checks. Same master.', {
        token: 'statement', color: 'onCanvas.muted', maxWidth: 0.42, maxLines: 2, enterAt: 1.6,
      }, { x: 0.1, y: 0.66, anchor: { x: 0, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_cubic' } }),
    ],
    audio: [{ at: 0.1, kind: 'sub_drop', intensity: 0.8, causedBy: 'l8_stat', reason: 'The number lands.' }],
    handover: { mechanism: 'field_change', carries: [], durationSeconds: 0.25, reason: 'To the year.' },
    macro: null,
  }),

  SceneGraph.parse({
    id: 'l9', durationSeconds: 4.4,
    intent: 'THE YEAR: a hollow outline that glows, the way the references set a date.',
    background: INK,
    camera: { scale: { from: 1.04, to: 1.0, curve: 'out_expo' }, focalLengthMm: 85 },
    objects: [
      lamp('l9_light', { x: 0.5, y: 0.52 }, { x: 0.5, y: 0.48 }, EMBER, 0.65),
      line('l9_year', '2026', {
        align: 'center', maxWidth: 0.5, maxLines: 1, color: 'transparent',
        treatment: {
          gradient: null,
          stroke: { color: ACCENT, widthPx: 2.5, hollow: true },
          glow: { color: ACCENT, radiusPx: { from: 6, to: 32, curve: 'out_expo' }, strength: 1 },
        },
      }, {
        x: 0.5, y: 0.44, anchor: { x: 0.5, y: 0.5 },
        scale: { from: 1.5, to: 1.62, curve: 'out_expo' },
        opacity: { from: 0, to: 1, curve: 'out_expo' },
      }),
      line('l9_sub', 'Launch films stop taking six weeks.', {
        token: 'statement', align: 'center', color: 'onCanvas.muted', maxWidth: 0.46, maxLines: 2, enterAt: 0.9,
      }, { x: 0.5, y: 0.68, anchor: { x: 0.5, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_cubic' } }),
    ],
    audio: [{ at: 0.08, kind: 'riser', intensity: 0.5, causedBy: 'l9_year', reason: 'The year arrives.' }],
    handover: { mechanism: 'field_change', carries: [], durationSeconds: 0.2, reason: 'To the call.' },
    macro: null,
  }),

  // --- 5. THE CALL ---------------------------------------------------------
  SceneGraph.parse({
    id: 'l10', durationSeconds: 4.2,
    intent: 'CALL: the mark, the invitation, and the one rule the film opened on.',
    background: INK,
    camera: { scale: { from: 1.03, to: 1.0, curve: 'out_expo' }, focalLengthMm: 85 },
    objects: [
      lamp('l10_light', { x: 0.28, y: 0.52 }, { x: 0.3, y: 0.5 }, EMBER, 0.75),
      line('l10_mark', 'Act One', {
        maxWidth: 0.4, maxLines: 1, color: PAPER,
        treatment: { gradient: null, stroke: null, glow: { color: '#FF6A33', radiusPx: 22, strength: 0.6 } },
      }, { x: 0.1, y: 0.44, anchor: { x: 0, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_expo' } }),
      line('l10_call', 'Give us your product.', {
        token: 'statement', color: 'onCanvas.muted', maxWidth: 0.38, maxLines: 1, enterAt: 0.9,
      }, { x: 0.1, y: 0.58, anchor: { x: 0, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_cubic' } }),
      {
        kind: 'shape', id: 'l10_rule', shape: 'rect',
        width: { from: 0, to: 0.16, curve: 'out_expo' }, height: 0.004,
        fill: 'accent', stroke: 'transparent', strokeWidthPx: 0, cornerRadiusPx: 0,
        role: 'structure', enterAt: 1.5,
        reason: 'The rule the film has used throughout, closing it.',
        transform: Transform.parse({ x: 0.1, y: 0.68, anchor: { x: 0, y: 0.5 } }),
      } as SceneObject,
    ],
    audio: [{ at: 0.15, kind: 'logo_sting', intensity: 0.6, causedBy: 'l10_mark', reason: 'The mark, and the end of the sentence.' }],
    macro: null,
  }),
);

// ---------------------------------------------------------------------------

const seconds = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
console.log(`=== the launch film: ${seconds.toFixed(1)}s, ${scenes.length} shots ===`);

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
const out = path.resolve('.renders/launch.mp4');
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
const premix = path.resolve('.renders/launch.premix.wav');
const mixed = await runFfmpeg(mixArgs(plan, premix), { timeoutMs: 8 * 60_000 });
if (!mixed.ok) throw new Error(`mix failed: ${mixed.stderr.slice(-300)}`);

const master = path.resolve('.renders/launch.mix.wav');
await masterLoudness({ source: premix, target: master, lufs: design.targetLufs, outputArgs: ['-c:a', 'pcm_s24le'] });

const muxed = await runFfmpeg(muxArgs(silent, master, out), { timeoutMs: 8 * 60_000 });
if (!muxed.ok) throw new Error(`mux failed: ${muxed.stderr.slice(-300)}`);
console.log(`  ${design.cues.length} cues, ${design.targetLufs} LUFS -> ${out}`);
