/**
 * A bench for one capability at a time.
 *
 * Every renderer defect in this sprint was found by looking at output, and
 * every one of them was invisible in the code. So a new capability gets a shot
 * built to show it and nothing else: if perspective is not working, a frame
 * with four tilted cards in it says so immediately, and a frame with a film
 * around it does not.
 *
 *   ACT_ONE_MANAGED_CREDENTIALS=all npm run probe
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

const BASE = process.env['ACT_ONE_CAPTURE_BASE'] ?? 'http://localhost:3000/capture';
const PUBLIC = path.resolve('apps/web/public/capture');
const ASSETS: Record<string, string> = Object.fromEntries(
  ['home', 'how', 'work', 'pricing', 'home_hero', 'how_stages', 'work_films', 'pricing_terms']
    .filter((n) => existsSync(path.join(PUBLIC, `${n}.png`)))
    .map((n) => [`ast_${n}`, `${BASE}/${n}.png`]),
);

const INK = '#12131A';
const PAPER = '#F2F0EA';
const ACCENT = '#FF4D1F';

const brand = BrandSystem.parse({
  id: 'brn_probe', organizationId: 'org_probe', name: 'Probe',
  primaryColor: ACCENT,
  secondaryColor: neutralRamp(ACCENT, 9, 0.05)[6] ?? ACCENT,
  primaryCandidates: [ACCENT], neutrals: neutralRamp(ACCENT, 9, 0.05),
  canvasDark: INK, canvasLight: PAPER,
  visualStyle: 'editorial', motionStyle: 'precise', cornerStyle: 'subtle', cornerRadiusPx: 10,
  confirmedByUser: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

/** A capture card tilted in space, which is the thing being tested. */
const card = (
  id: string, asset: string, at: { x: number; y: number; z: number },
  tilt: { rx: number; ry: number; rz: number }, width: number, enterAt: number,
): SceneObject =>
  ({
    kind: 'ui_layer', id, assetId: asset, semantic: id,
    crop: { x: 0, y: 0, width: 1, height: 0.62 },
    width, cornerRadiusPx: 10, shadow: true,
    role: 'support', enterAt,
    reason: 'A card held at an angle, to prove the frame has a vanishing point.',
    transform: Transform.parse({
      x: at.x, y: at.y, z: at.z,
      anchor: { x: 0.5, y: 0.5 },
      rotationX: tilt.rx, rotationY: { from: tilt.ry - 8, to: tilt.ry, curve: 'out_expo' },
      rotationZ: tilt.rz,
      opacity: { from: 0, to: 1, curve: 'out_cubic' },
    }),
  }) as SceneObject;

const scenes = [
  SceneGraph.parse({
    id: 'p1', durationSeconds: 4,
    intent: 'PERSPECTIVE: four captures held at angles in one space, under one lens.',
    background: PAPER,
    camera: { focalLengthMm: { from: 34, to: 30, curve: 'in_out_cubic' }, dollyZ: { from: 0, to: 0.35, curve: 'in_out_cubic' }, scale: 1 },
    objects: [
      card('c1', 'ast_how_stages', { x: 0.28, y: 0.42, z: 0.4 }, { rx: 8, ry: 22, rz: -4 }, 0.40, 0.0),
      card('c2', 'ast_work_films', { x: 0.62, y: 0.34, z: -0.1 }, { rx: -6, ry: -18, rz: 3 }, 0.44, 0.18),
      card('c3', 'ast_pricing_terms', { x: 0.46, y: 0.72, z: 0.15 }, { rx: 14, ry: 6, rz: -2 }, 0.36, 0.36),
      card('c4', 'ast_home_hero', { x: 0.84, y: 0.68, z: -0.35 }, { rx: -10, ry: -28, rz: 5 }, 0.34, 0.54),
    ],
    audio: [],
    macro: null,
  }),
  SceneGraph.parse({
    id: 'p2', durationSeconds: 4,
    intent: 'SPANS: one line, three settings, the way every reference film writes.',
    background: PAPER,
    camera: { focalLengthMm: 60, scale: { from: 1.02, to: 1, curve: 'out_expo' } },
    objects: [
      {
        kind: 'text', id: 'p2_line',
        content: "Your problem isn't what you sell.",
        token: 'display', color: 'onCanvas.primary',
        align: 'left', maxWidth: 0.52, maxLines: 3,
        staggerBy: 'none', staggerSeconds: 0,
        role: 'payload', reason: 'One sentence, emphasis inside it.',
        spans: [
          { text: "Your problem isn't " },
          { text: 'what you sell', color: ACCENT, weight: 700 },
          { text: '.' },
        ],
        transform: Transform.parse({ x: 0.1, y: 0.34, anchor: { x: 0, y: 0.5 }, opacity: { from: 0, to: 1, curve: 'out_expo' } }),
      } as SceneObject,
      {
        kind: 'text', id: 'p2_stagger',
        content: 'and clearly defines who you should target',
        token: 'statement', color: 'onCanvas.secondary',
        align: 'left', maxWidth: 0.5, maxLines: 3,
        staggerBy: 'word', staggerSeconds: 0.055,
        role: 'payload', reason: 'Emphasis surviving a word stagger, which cuts the line somewhere else.',
        spans: [
          { text: 'and clearly defines who you should ' },
          { text: 'target', color: ACCENT, weight: 700, italic: true },
        ],
        transform: Transform.parse({ x: 0.1, y: 0.6, anchor: { x: 0, y: 0.5 } }),
      } as SceneObject,
    ],
    audio: [],
    macro: null,
  }),
];

scenes.push(
  SceneGraph.parse({
    id: 'p3', durationSeconds: 4,
    intent: 'TREATMENT: a gradient fill, a hollow glowing outline, and a lit word.',
    background: INK,
    camera: { focalLengthMm: 50 },
    objects: [
      {
        kind: 'text', id: 'p3_stat', content: '3-5x',
        token: 'display', color: ACCENT, align: 'left', maxWidth: 0.4, maxLines: 1,
        staggerBy: 'none', staggerSeconds: 0,
        role: 'payload', reason: 'A number filled with a gradient, as the references set their statistics.',
        treatment: { gradient: { from: '#FF4D1F', to: '#FFC24D', angleDeg: 110 }, stroke: null, glow: null },
        transform: Transform.parse({ x: 0.08, y: 0.3, anchor: { x: 0, y: 0.5 }, scale: { from: 1.4, to: 1.7, curve: 'out_expo' } }),
      } as SceneObject,
      {
        kind: 'text', id: 'p3_year', content: '2026',
        token: 'display', color: 'transparent', align: 'left', maxWidth: 0.4, maxLines: 1,
        staggerBy: 'none', staggerSeconds: 0,
        role: 'payload', reason: 'A hollow outline that glows, which is how a reference film sets its year.',
        treatment: {
          gradient: null,
          stroke: { color: ACCENT, widthPx: 2, hollow: true },
          glow: { color: ACCENT, radiusPx: { from: 8, to: 34, curve: 'out_expo' }, strength: 1 },
        },
        transform: Transform.parse({ x: 0.08, y: 0.62, anchor: { x: 0, y: 0.5 }, scale: 1.5 }),
      } as SceneObject,
      {
        kind: 'text', id: 'p3_lit', content: 'enfin compris',
        token: 'statement', color: PAPER, align: 'right', maxWidth: 0.4, maxLines: 1,
        staggerBy: 'none', staggerSeconds: 0,
        role: 'support', reason: 'White type with light coming off it.',
        treatment: { gradient: null, stroke: null, glow: { color: '#FF8A4D', radiusPx: 26, strength: 0.7 } },
        transform: Transform.parse({ x: 0.92, y: 0.86, anchor: { x: 1, y: 0.5 } }),
      } as SceneObject,
    ],
    audio: [],
    macro: null,
  }),
);

const registry = new CapabilityRegistry();
for (const scene of scenes) {
  for (const p of routeScene(scene, registry).problems) console.log(`  ROUTE ${scene.id}/${p.objectId}: ${p.message}`);
}
for (const f of inspectScenes(scenes, EASINGS, { registry })) {
  console.log(`  ${f.severity.padEnd(9)} ${f.check.padEnd(24)} ${f.sceneId} ${f.message.slice(0, 90)}`);
}

const out = path.resolve('.renders/probe.mp4');
await renderScenes({
  scenes, brand, assetUrls: ASSETS,
  aspect: '16:9', quality: 'preview', outputPath: out, concurrency: 3, theme: 'light',
});
console.log(`-> ${out}`);
