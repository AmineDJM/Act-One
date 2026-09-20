/**
 * The shot that proves the point.
 *
 * Nothing in Act One's recipe list can express this: a real dashboard arriving
 * from deep Z-space while three semantic regions detach from the capture and
 * travel at separate depths, the camera passing between them, a headline
 * holding BEHIND the product, the panels collapsing on a bass hit, and the
 * negative space they leave revealing the mark.
 *
 * There is no `dashboard_flying_scene_v2`, and after this there does not need
 * to be. Every object below is a primitive the renderer already draws; what is
 * new is that a director can arrange them.
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

const PRIMARY = '#5B8CFF';
const brand = BrandSystem.parse({
  id: 'brn_demo',
  organizationId: 'org_demo',
  name: 'Act One',
  primaryColor: PRIMARY,
  secondaryColor: neutralRamp(PRIMARY, 9, 0.05)[6] ?? PRIMARY,
  primaryCandidates: [PRIMARY],
  neutrals: neutralRamp(PRIMARY, 9, 0.05),
  canvasDark: '#07080d',
  confirmedByUser: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const CAPTURE = 'ast_home';

/** One semantic region of the real capture, on its own depth and trajectory. */
const region = (
  id: string,
  crop: { x: number; y: number; width: number; height: number },
  z: number,
  restX: number,
  restY: number,
  enterAt: number,
  reason: string,
): SceneObject =>
  ({
    kind: 'ui_layer',
    id,
    assetId: CAPTURE,
    crop,
    semantic: id,
    width: 0.3,
    cornerRadiusPx: 8,
    shadow: true,
    enterAt,
    role: 'support',
    reason,
    transform: Transform.parse({
      x: { from: 0.5, to: restX, curve: 'out_quint' },
      y: { from: 0.5, to: restY, curve: 'out_quint' },
      z,
      // Arriving from deep space, then collapsing on the hit at t=0.72.
      scale: {
        keyframes: [
          { t: 0, value: 0.2 },
          { t: 0.55, value: 1.0, curve: 'out_quint' },
          { t: 0.72, value: 1.04 },
          { t: 1, value: 0.06, curve: 'in_cubic' },
        ],
        curve: 'out_quint',
      },
      opacity: {
        keyframes: [
          { t: 0, value: 0 },
          { t: 0.18, value: 1, curve: 'out_cubic' },
          { t: 0.88, value: 1 },
          { t: 1, value: 0, curve: 'in_cubic' },
        ],
        curve: 'linear',
      },
      rotationY: { from: -14, to: 0, curve: 'out_quint' },
    }),
  }) as SceneObject;

const scene = SceneGraph.parse({
  id: 'scn_graph_demo',
  durationSeconds: 6,
  intent:
    'The product arrives from depth, comes apart into its own regions, and collapses to reveal the mark.',
  camera: {
    // The camera passes between the layers: it pushes while they separate.
    scale: {
      keyframes: [
        { t: 0, value: 1.0 },
        { t: 0.7, value: 1.12, curve: 'in_out_cubic' },
        { t: 1, value: 1.0, curve: 'out_cubic' },
      ],
      curve: 'in_out_cubic',
    },
    x: { from: 0.02, to: -0.02, curve: 'in_out_cubic' },
    focalLengthMm: 34,
    dollyZ: { from: 0, to: 0.5, curve: 'in_out_cubic' },
    depthOfField: 0.35,
    focusZ: 0,
    motionBlur: 0.3,
  },
  objects: [
    // The headline holds BEHIND the product, which no recipe could express.
    {
      kind: 'text',
      id: 'headline',
      content: 'Know before it happens.',
      token: 'display',
      color: 'onCanvas.primary',
      align: 'left',
      maxWidth: 0.58,
      maxLines: 2,
      staggerBy: 'word',
      staggerSeconds: 0.06,
      enterAt: 0.2,
      role: 'payload',
      reason: 'The line of the beat. It sits behind the product so the product reads as nearer.',
      transform: Transform.parse({
        x: 0.08,
        y: 0.34,
        z: 0.9,
        anchor: { x: 0, y: 0.5 },
        opacity: {
          keyframes: [
            { t: 0, value: 0 },
            { t: 0.14, value: 1, curve: 'out_cubic' },
            { t: 0.9, value: 1 },
            { t: 1, value: 0, curve: 'in_cubic' },
          ],
          curve: 'linear',
        },
      }),
    } as SceneObject,

    region(
      'region_header',
      { x: 0.0, y: 0.0, width: 1.0, height: 0.26 },
      -0.35,
      0.62,
      0.3,
      0.3,
      'The product’s own header, nearest the camera.',
    ),
    region(
      'region_body',
      { x: 0.0, y: 0.26, width: 0.62, height: 0.42 },
      0.0,
      0.5,
      0.56,
      0.44,
      'The working area, on the focal plane.',
    ),
    region(
      'region_footer',
      { x: 0.0, y: 0.68, width: 1.0, height: 0.32 },
      0.42,
      0.38,
      0.78,
      0.58,
      'The lower band, furthest back.',
    ),

    // The negative space the collapse leaves is where the mark appears.
    {
      kind: 'text',
      id: 'mark',
      content: 'Act One',
      token: 'display',
      color: 'accent',
      align: 'center',
      maxWidth: 0.5,
      maxLines: 1,
      staggerBy: 'none',
      staggerSeconds: 0,
      enterAt: 4.5,
      role: 'payload',
      reason: 'The mark, revealed by the space the panels vacate.',
      transform: Transform.parse({
        x: 0.5,
        y: 0.5,
        scale: { from: 0.92, to: 1, curve: 'out_quint' },
        opacity: { from: 0, to: 1, curve: 'out_quint' },
      }),
    } as SceneObject,
  ],
  audio: [
    {
      at: 4.32,
      kind: 'sub_drop',
      intensity: 0.8,
      causedBy: 'region_body',
      reason: 'The panels collapse on the hit.',
    },
    {
      at: 4.6,
      kind: 'logo_sting',
      intensity: 0.55,
      causedBy: 'mark',
      reason: 'The mark lands in the space they left.',
    },
  ],
  handover: {
    mechanism: 'mask_reveal',
    carries: ['mark'],
    durationSeconds: 0.4,
    reason: 'The collapse opens onto the next idea.',
  },
  macro: null,
});

// --- what the studio says about it, before anything renders -----------------
const registry = new CapabilityRegistry();
const routing = routeScene(scene, registry);
console.log('ROUTING');
for (const [id, capability] of Object.entries(routing.assignments))
  console.log(`  ${id.padEnd(16)} -> ${capability}`);
console.log(`  executors: ${routing.executors.join(', ')}`);
console.log(
  `  estimate: $${routing.estimatedCostUsd.toFixed(3)}, ~${routing.estimatedRenderSeconds}s`,
);
if (routing.problems.length)
  for (const p of routing.problems) console.log(`  PROBLEM ${p.objectId}: ${p.message}`);

const findings = inspectScenes([scene], EASINGS, { registry });
console.log(`STRUCTURAL QA: ${findings.length} finding(s)`);
for (const f of findings)
  console.log(`  ${f.severity} ${f.check} ${f.objectId ?? ''} :: ${f.message.slice(0, 120)}`);
if (findings.some((f) => f.severity === 'hard_fail')) {
  console.error('Refusing to render a scene with a hard failure.');
  process.exit(1);
}

// --- and then it renders ----------------------------------------------------
const CAPTURES = path.resolve('apps/web/public/capture');
const assetUrls = existsSync(path.join(CAPTURES, 'home.png'))
  ? {
      [CAPTURE]: `${process.env['ACT_ONE_CAPTURE_BASE'] ?? 'http://localhost:3000/capture'}/home.png`,
    }
  : {};
if (!assetUrls[CAPTURE]) {
  console.error(
    'No product capture available; run scripts/film/capture-product.mjs with the app running.',
  );
  process.exit(1);
}

const out = process.env['ACT_ONE_FILM_OUT'] ?? path.resolve('.renders/scene-graph-demo.mp4');
const started = Date.now();
const result = await renderScenes({
  scenes: [scene],
  brand,
  assetUrls,
  aspect: '16:9',
  quality: (process.env['ACT_ONE_FILM_QUALITY'] ?? 'preview') as 'preview' | 'hd' | 'uhd',
  outputPath: out,
  concurrency: 3,
  onProgress: (p) => {
    if (p.renderedFrames % 60 === 0) process.stdout.write(`\r  ${p.renderedFrames} frames`);
  },
});
console.log(
  `\nrendered in ${((Date.now() - started) / 1000).toFixed(0)}s -> ${result.outputPath} ${result.width}x${result.height} ${result.durationSeconds}s`,
);
if (result.undecodable.length) console.log('undecodable:', result.undecodable);
