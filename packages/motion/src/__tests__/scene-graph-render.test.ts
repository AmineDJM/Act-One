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
import { handoverOverlap } from '../components/Handover.tsx';
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

  /**
   * The check has to see the frame the renderer draws, not the one authored.
   *
   * Three creative directions clipped their headlines on the first render —
   * "Six" came out as "ix" — and the structural pass reported no hard
   * failures, because it tested an object's anchor POINT against the safe area
   * while a text object is a box `maxWidth` wide that the camera then
   * magnifies. The pair below is the whole lesson: identical text, identical
   * placement, and the only difference is whether the camera pushes in. One is
   * clipped and one is not, so a check that reads only the authored transform
   * cannot tell them apart — which is exactly the state it shipped in.
   */
  it('catches a headline the camera pushes off the frame, and clears the same one when the camera is locked', () => {
    const headline = (cameraScale: number) =>
      SceneGraph.parse({
        id: 'scn_bounds',
        durationSeconds: 2,
        intent: 'One wide headline, with and without a push.',
        camera: { scale: cameraScale, focalLengthMm: 50 },
        objects: [
          {
            kind: 'text',
            id: 'line',
            content: 'Six',
            token: 'display',
            color: 'onCanvas.primary',
            align: 'left',
            maxWidth: 0.8,
            maxLines: 1,
            staggerBy: 'none',
            staggerSeconds: 0,
            role: 'payload',
            reason: 'The word the film opens on.',
            transform: Transform.parse({ x: 0.5, y: 0.5, anchor: { x: 0.5, y: 0.5 } }),
          } as SceneObject,
        ],
        macro: null,
      });

    const clipped = inspectScenes([headline(1.6)], EASINGS).filter(
      (f) => f.check === 'object_outside_frame',
    );
    expect(clipped).toHaveLength(1);
    expect(clipped[0]?.severity).toBe('hard_fail');

    expect(
      inspectScenes([headline(1)], EASINGS).filter((f) => f.check === 'object_outside_frame'),
    ).toEqual([]);
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

describe('type as the reference films set it', () => {
  /**
   * The three capabilities the reference readings named, together.
   *
   * A model watching the films this system is asked to match described, in its
   * own words, "2026 — glowing red outline", "3-5x more replies — massive
   * scale, orange gradient", and lines like "Your problem isn't `what you
   * sell`" set in two colours. None of those was expressible: a text object
   * had one colour and no treatment, so every line came out as a slide.
   *
   * Asserted on the parsed scene rather than on pixels, because what broke
   * before was the SCHEMA refusing to carry the intent, and a render test
   * costs a browser to tell you the same thing.
   */
  it('carries spans, gradients, outlines and glow through the schema', () => {
    const scene = SceneGraph.parse({
      id: 'scn_type',
      // Four seconds, not two: the reading-time check is right that nobody
      // finishes a seven-word headline in two, and a fixture that trips a
      // correct check teaches the wrong lesson about the check.
      durationSeconds: 4,
      intent: 'A line with emphasis inside it, and a number that is lit.',
      objects: [
        {
          kind: 'text',
          id: 'line',
          content: "Your problem isn't what you sell",
          token: 'display',
          color: 'onCanvas.primary',
          align: 'left',
          maxWidth: 0.5,
          maxLines: 2,
          staggerBy: 'word',
          staggerSeconds: 0.05,
          role: 'payload',
          reason: 'Emphasis inside a sentence, which is how every reference film writes.',
          spans: [
            { text: "Your problem isn't " },
            { text: 'what you sell', color: '#FF4D1F', weight: 700 },
          ],
          transform: Transform.parse({ x: 0.3, y: 0.4, anchor: { x: 0, y: 0.5 } }),
        },
        {
          kind: 'text',
          id: 'year',
          content: '2026',
          token: 'display',
          color: 'transparent',
          align: 'left',
          maxWidth: 0.3,
          maxLines: 1,
          staggerBy: 'none',
          staggerSeconds: 0,
          role: 'payload',
          reason: 'A hollow outline that glows.',
          treatment: {
            gradient: null,
            stroke: { color: '#FF4D1F', widthPx: 2, hollow: true },
            glow: { color: '#FF4D1F', radiusPx: { from: 8, to: 30, curve: 'out_expo' }, strength: 1 },
          },
          transform: Transform.parse({ x: 0.3, y: 0.7, anchor: { x: 0, y: 0.5 } }),
        },
      ],
      macro: null,
    });

    const [line, year] = scene.objects as [
      Extract<SceneObject, { kind: 'text' }>,
      Extract<SceneObject, { kind: 'text' }>,
    ];

    expect(line.spans).toHaveLength(2);
    expect(line.spans[1]?.color).toBe('#FF4D1F');
    expect(line.spans[1]?.weight).toBe(700);
    expect(year.treatment.stroke?.hollow).toBe(true);
    expect(year.treatment.glow).not.toBeNull();

    expect(inspectScenes([scene], EASINGS).filter((f) => f.severity === 'hard_fail')).toEqual([]);
  });

  /**
   * Spans decorate the line; they never replace it.
   *
   * `content` is what reading time, similarity and every other check reason
   * about. A film that displays one sentence while the checks reason about
   * another is worse than a film with no emphasis in it, so the two are not
   * allowed to disagree.
   */
  it('refuses spans that do not join back to the line', () => {
    const build = (spans: { text: string }[]) =>
      SceneGraph.parse({
        id: 'scn_bad',
        durationSeconds: 2,
        intent: 'Spans that say something else.',
        objects: [
          {
            kind: 'text',
            id: 'line',
            content: 'Six weeks',
            token: 'display',
            color: 'onCanvas.primary',
            align: 'left',
            maxWidth: 0.5,
            maxLines: 1,
            staggerBy: 'none',
            staggerSeconds: 0,
            role: 'payload',
            reason: 'The line.',
            spans,
            transform: Transform.parse({ x: 0.3, y: 0.4 }),
          },
        ],
        macro: null,
      });

    expect(() => build([{ text: 'Six ' }, { text: 'months' }])).toThrow();
    expect(() => build([{ text: 'Six ' }, { text: 'weeks' }])).not.toThrow();
  });
});

describe('the boundary between two scenes', () => {
  /**
   * A handover that was declared and ignored.
   *
   * Every scene carries a `handover` — mechanism, duration, the ids that
   * survive — and the film assembly laid scenes end to end in butt-joined
   * sequences, so ten declared transitions rendered as ten hard cuts. A model
   * reading the reference films found their boundaries were mostly not cuts at
   * all: "camera pans down to new UI layout", "camera zooms into white space
   * of a message". Those films are one space travelled through.
   *
   * What this pins is the thing that would break silently: a cut must stay a
   * cut, and a transition must not move the timeline. The sound is placed
   * against cumulative scene durations, so an overlap implemented by pulling
   * the incoming scene EARLIER would slide every cue in the film against the
   * picture by a growing amount — inaudible on the first boundary, unfixable
   * by the tenth.
   */
  it('overlaps only where a mechanism asks for it, and never on a cut', () => {
    const handover = (over: Record<string, unknown>) =>
      SceneGraph.parse({
        id: 'scn_h',
        durationSeconds: 2,
        intent: 'A scene that hands over.',
        objects: [marker('m', 0, 0.5, '#ff0000')],
        handover: over,
        macro: null,
      }).handover;

    // A cut is a cut, and asking for one with a duration is still asking for a
    // cut: quietly giving a dissolve would be the renderer overruling the
    // director.
    expect(handoverOverlap(handover({ mechanism: 'cut', durationSeconds: 0.5 }))).toBe(0);
    expect(handoverOverlap(handover({ mechanism: 'field_change', durationSeconds: 0.5 }))).toBe(0);

    // A mechanism with no duration has not asked for anything either.
    expect(handoverOverlap(handover({ mechanism: 'scale_through', durationSeconds: 0 }))).toBe(0);

    expect(handoverOverlap(handover({ mechanism: 'scale_through', durationSeconds: 0.55 }))).toBeCloseTo(0.55, 3);
    expect(handoverOverlap(handover({ mechanism: 'camera_carry', durationSeconds: 0.45 }))).toBeCloseTo(0.45, 3);

    // Clamped, because a two-second scene handing over for three seconds is a
    // scene that never plays.
    expect(handoverOverlap(handover({ mechanism: 'mask_reveal', durationSeconds: 3 }))).toBe(1.5);
  });
});
