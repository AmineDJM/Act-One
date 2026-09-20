import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { neutralRamp } from '@act-one/design';
import {
  BrandSystem as BrandSystemSchema,
  CapabilityRegistry,
  SceneGraph,
  Transform,
  inspectScenes,
  routeScene,
  type BrandSystem,
  type SceneObject,
} from '@act-one/core';
import { EASINGS } from '../easing.ts';
import { renderScenes, resolveBrowserExecutable } from '../render.ts';

/**
 * A scene graph, on the screen.
 *
 * The scene language is only worth having if something draws it, and a schema
 * with a renderer that has never been run against it is a schema. So this
 * renders a composition no macro could express — objects at three different
 * depths, a camera that dollies, an object that leaves before the cut — and
 * then reads the pixels back.
 *
 * The assertion is not "the frame is not blank". A blank check passes on a
 * film with one rectangle in it. It is that the two depths moved by DIFFERENT
 * amounts, which is the thing 2.5D exists to do and the thing that would
 * silently stop working if the parallax term were ever dropped.
 */
const browser =
  resolveBrowserExecutable() ?? (process.env['ACT_ONE_CHROME_HEADLESS_SHELL'] || undefined);

const PRIMARY = '#5B8CFF';
const brand: BrandSystem = BrandSystemSchema.parse({
  id: 'brn_sg',
  organizationId: 'org_sg',
  name: 'Scene Graph',
  primaryColor: PRIMARY,
  secondaryColor: neutralRamp(PRIMARY, 9, 0.05)[6] ?? PRIMARY,
  primaryCandidates: [PRIMARY],
  neutrals: neutralRamp(PRIMARY, 9, 0.05),
  canvasDark: '#07080d',
  confirmedByUser: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

/** A solid mark at a known depth, so its travel can be measured off a frame. */
const marker = (id: string, z: number, y: number, fill: string): SceneObject =>
  ({
    kind: 'shape',
    id,
    shape: 'rect',
    width: 0.16,
    height: 0.16,
    fill,
    stroke: 'transparent',
    strokeWidthPx: 0,
    cornerRadiusPx: 0,
    role: 'structure',
    reason: 'A measurable mark at a known depth.',
    transform: Transform.parse({ x: 0.5, y, z }),
  }) as SceneObject;

/**
 * Where the centre of mass of a colour sits in a frame, 0..1 across.
 *
 * The tolerance is wide on purpose. These are read back through h264 in
 * limited-range BT.709, which is what the delivery format is, and pure green
 * comes out of it at about (0, 224, 0) rather than (0, 255, 0). A tolerance of
 * 26 found the red and missed the green entirely, which looked exactly like
 * the renderer having dropped a layer. Wide enough to survive the encoder,
 * narrow enough that red, green and a near-black canvas stay three different
 * answers.
 */
async function centroidX(
  png: Buffer,
  target: { r: number; g: number; b: number },
): Promise<number | null> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const near =
      Math.abs(data[i]! - target.r) < 60 &&
      Math.abs(data[i + 1]! - target.g) < 60 &&
      Math.abs(data[i + 2]! - target.b) < 60;
    if (!near) continue;
    const pixel = i / info.channels;
    sum += pixel % info.width;
    count += 1;
  }
  return count === 0 ? null : sum / count / info.width;
}

describe('the scene language', () => {
  it('routes and inspects a free-form composition without rendering', () => {
    // The cheap half, which runs everywhere: a scene that no recipe names
    // still has to be routable and inspectable before anybody spends a render.
    const scene = SceneGraph.parse({
      id: 'scn_free',
      durationSeconds: 3,
      intent: 'Three marks at three depths while the camera dollies.',
      camera: { dollyZ: { from: 0, to: 0.6, curve: 'linear' }, focalLengthMm: 28 },
      objects: [marker('near', -0.6, 0.3, '#ff0000'), marker('far', 0.6, 0.7, '#00ff00')],
      macro: null,
    });

    const routing = routeScene(scene, new CapabilityRegistry());
    expect(routing.problems).toEqual([]);
    expect(Object.keys(routing.assignments)).toHaveLength(2);
    expect(routing.executors).toEqual(['remotion']);

    expect(inspectScenes([scene], EASINGS).filter((f) => f.severity === 'hard_fail')).toEqual([]);
  });
});

describe.skipIf(browser === undefined)('a scene graph, rendered', () => {
  it('pushes a near layer out of frame centre and pulls a far one toward it', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'act-one-sg-'));
    const output = path.join(directory, 'depth.mp4');

    /*
     * Two marks, same starting position, opposite depths, one dolly.
     *
     * The assertion is directional rather than about distance, and that took
     * two wrong attempts to arrive at. Comparing how FAR each travelled fails
     * for a symmetric pair — they move by the same amount in opposite
     * directions — and fails again if either leaves the frame, because a
     * centroid of the visible pixels then clamps at the edge and reports a
     * travel that never happened.
     *
     * What parallax actually means is the direction: under a dolly, near
     * things sweep away from the centre of frame and far things drift toward
     * it. That is true of any lens, any depth pair, and any amount of travel,
     * and it is false the moment the depth term stops being applied.
     */
    const scene = SceneGraph.parse({
      id: 'scn_depth',
      durationSeconds: 2,
      intent: 'Two marks at opposite depths, one camera dolly.',
      camera: {
        focalLengthMm: 35,
        dollyZ: { from: 0, to: 0.5, curve: 'linear' },
        scale: 1,
      },
      objects: [
        {
          ...marker('near', -0.5, 0.32, '#ff0000'),
          transform: Transform.parse({ x: 0.34, y: 0.32, z: -0.5 }),
        } as SceneObject,
        {
          ...marker('far', 0.5, 0.68, '#00ff00'),
          transform: Transform.parse({ x: 0.34, y: 0.68, z: 0.5 }),
        } as SceneObject,
      ],
      macro: null,
    });

    try {
      const result = await renderScenes({
        scenes: [scene],
        brand,
        assetUrls: {},
        aspect: '16:9',
        quality: 'preview',
        outputPath: output,
        concurrency: 1,
        ...(browser ? { browserExecutable: browser } : {}),
      });
      expect(result.durationSeconds).toBeCloseTo(2, 1);
      expect(result.undecodable).toEqual([]);

      const first = await frameAt(output, 0.05);
      const last = await frameAt(output, 1.9);

      const nearStart = await centroidX(first, { r: 255, g: 0, b: 0 });
      const nearEnd = await centroidX(last, { r: 255, g: 0, b: 0 });
      const farStart = await centroidX(first, { r: 0, g: 255, b: 0 });
      const farEnd = await centroidX(last, { r: 0, g: 255, b: 0 });

      // Both layers have to still be on screen for the reading to mean anything.
      expect(nearStart).not.toBeNull();
      expect(nearEnd).not.toBeNull();
      expect(farStart).not.toBeNull();
      expect(farEnd).not.toBeNull();

      const from = (value: number | null) => Math.abs((value ?? 0.5) - 0.5);

      // Near sweeps out; far drifts in. Equal readings would mean the depth
      // term had stopped being applied — the silent regression a "frame is not
      // blank" assertion never catches.
      expect(from(nearEnd)).toBeGreaterThan(from(nearStart) + 0.01);
      expect(from(farEnd)).toBeLessThan(from(farStart) - 0.01);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 240_000);
});

/** One frame of a rendered file, as PNG bytes. */
async function frameAt(video: string, seconds: number): Promise<Buffer> {
  const { runFfmpeg } = await import('@act-one/sound');
  const still = `${video}.${seconds}.png`;
  const result = await runFfmpeg(
    ['-y', '-ss', String(seconds), '-i', video, '-frames:v', '1', still],
    { timeoutMs: 60_000 },
  );
  if (!result.ok) throw new Error(`Could not extract a frame: ${result.stderr.slice(-300)}`);
  const { readFile } = await import('node:fs/promises');
  return readFile(still);
}
