import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { isolateLayers, operateLayers, UiRegion, UiSequence, volumeLayers, type FramingRect, type UiFraming, type UiLayer } from '@act-one/core';
import { EASINGS, progress } from '@act-one/motion';
import { layerProgress, plateGeometry } from '../../../motion/src/components/UiLayers.tsx';
import { validationContextFor } from '../author.ts';
import { fallbackScene } from '../fallback.ts';
import { motionRuntimeSource } from '../motion-runtime.ts';
import type { ScenePacket } from '../types.ts';
import { validateScene } from '../validate.ts';
import { design, image, packetsFor, scene, storyboard } from './helpers.ts';

/**
 * The interface taken apart, drawn by the engine as the Remotion engine draws it.
 *
 * The scene's own script is run against a stand-in for the page at the frames
 * a render seeks to, and what it sets is held to what the Remotion
 * `LayeredShot` and `VolumeShot` compute for the same frame — through their
 * own geometry and progress functions, not copies of them.
 */
const FPS = 30;
const { width: W, height: H } = design().frame;
const SOURCE = { sourceWidth: 1600, sourceHeight: 1000 };
const panel = (index: number) =>
  UiRegion.parse({ x: (40 + (index % 3) * 500) / 1600, y: (160 + Math.floor(index / 3) * 380) / 1000, width: 460 / 1600, height: 340 / 1000, weight: 0.2, density: 0.4 });
const bar = UiRegion.parse({ x: 70 / 1600, y: 580 / 1000, width: 290 / 1600, height: 18 / 1000, weight: 0.02, density: 0.9 });

function filmed(framings: unknown[], staged = [image('ast_img')], text = ['Every signal in one place.']): { packet: ScenePacket; sequence: UiSequence } {
  const sequence = UiSequence.parse({ ...SOURCE, background: { r: 16, g: 20, b: 29 }, framings });
  const seconds = sequence.framings.reduce((sum, framing) => sum + framing.seconds, 0);
  const board = storyboard([scene(0, { recipe: 'product_sequence', text, assets: ['ast_img'], duration: seconds })]);
  board.scenes[0]!.uiSequence = sequence;
  return { packet: packetsFor(board, { staged })[0]!, sequence };
}

function errorsOf(html: string, target: ScenePacket): string[] {
  return validateScene(html, validationContextFor(target))
    .filter((finding) => finding.severity === 'error')
    .map((finding) => `${finding.code}: ${finding.message}`);
}

type Style = Record<string, string | number | undefined>;

/** The scene's script, run against a stand-in for the page; `at` seeks it as HyperFrames does and reads back what it set. */
function run(html: string): (seconds: number) => (id: string) => Style {
  const script = /<script>\n([\s\S]*?)\n<\/script>/.exec(html)![1]!;
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]!));
  const styles = new Map<string, Style>();
  const document = {
    getElementById: (id: string) => {
      if (!ids.has(id)) return null;
      if (!styles.has(id)) styles.set(id, {});
      return { style: styles.get(id)! };
    },
  };
  const drivers: { state: { s: number }; vars: { duration: number; onUpdate: () => void }; position: number }[] = [];
  const timeline = {
    fromTo(target: unknown, _from: unknown, vars: { duration: number; onUpdate: () => void }, position: number) {
      if (target && typeof target === 'object' && 's' in target) drivers.push({ state: target as { s: number }, vars, position });
      return timeline;
    },
    set: () => timeline,
  };
  const window: { ActOne?: unknown } = {};
  vm.runInNewContext(motionRuntimeSource(), { window });
  vm.runInNewContext(script, { gsap: { timeline: () => timeline }, document, window, ActOne: window.ActOne });
  return (seconds) => {
    for (const driver of drivers) {
      driver.state.s = Math.min(driver.vars.duration, Math.max(0, seconds - driver.position));
      driver.vars.onUpdate();
    }
    return (id) => styles.get(id) ?? {};
  };
}

/** A style value's numbers, and its shape with the numbers taken out, so float formatting cannot fail a test. */
function shape(value: unknown): { form: string; numbers: number[] } {
  const text = String(value ?? '');
  const pattern = /-?\d+(?:\.\d+)?(?:e-?\d+)?/g;
  return { form: text.replace(pattern, '#'), numbers: [...text.matchAll(pattern)].map((match) => Number(match[0])) };
}

function expectStyle(actual: unknown, expected: string, label: string): void {
  const got = shape(actual);
  const want = shape(expected);
  expect(got.form, label).toBe(want.form);
  got.numbers.forEach((number, index) => expect(number, `${label}: ${String(actual)} against ${expected}`).toBeCloseTo(want.numbers[index]!, 6));
}

function lerp(from: FramingRect, to: FramingRect, t: number): FramingRect {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, width: from.width + (to.width - from.width) * t, height: from.height + (to.height - from.height) * t };
}

function camera(framing: UiFraming, frame: number, easing: keyof typeof EASINGS): FramingRect {
  const arriving =
    framing.layers.find((layer) => layer.role === 'overlay' && layer.motion !== 'hold') ??
    framing.layers.find((layer) => layer.role === 'control' && layer.motion !== 'hold');
  const t = arriving
    ? EASINGS.out_expo(progress(frame, FPS, { delaySeconds: arriving.delaySeconds, durationSeconds: arriving.durationSeconds }))
    : EASINGS[framing.move === 'lateral' || framing.move === 'hold' ? 'linear' : easing](progress(frame, FPS, { durationSeconds: framing.seconds }));
  return lerp(framing.from, framing.to, t);
}

describe('a framing whose interface was taken apart', () => {
  const establish = { role: 'establish', move: 'settle', from: { x: 0, y: 0, width: 1, height: 0.9 }, to: { x: 0.03, y: 0.04, width: 0.94, height: 0.846 }, seconds: 1.4 };
  const isolate = { role: 'subject', move: 'push', from: { x: 0.2, y: 0.05, width: 0.6, height: 0.54 }, to: { x: 0.25, y: 0.08, width: 0.5, height: 0.45 }, seconds: 2.8, words: 'bottom_left', layers: isolateLayers(panel(1), 2.8) };

  it('passes the engine’s own checks, and keeps the plate framing before it', () => {
    const { packet } = filmed([establish, isolate]);
    const html = fallbackScene(packet, design());
    expect(errorsOf(html, packet)).toEqual([]);
    expect(html).toContain('id="scene-01-f1-move"');
    expect(html).toContain('id="scene-01-f2-shell"');
    expect(html).toContain('id="scene-01-f2-layer-1" class="scene-01-layer"');
    expect(html).toContain('id="scene-01-f2-words"');
    // A cut lands on the whole taken-apart shot, as the Remotion wrapper scales everything it holds.
    expect(html).toContain('tl.fromTo("#scene-01-f2-ground", { scale: 1.02 }, { scale: 1, duration: 0.22, ease: ActOne.ease("out_quint") }, 1.4);');
  });

  it('moves the camera, the shell and the panel on the Remotion component’s numbers, frame by frame', () => {
    const { packet, sequence } = filmed([establish, isolate]);
    const easing = packet.recipe.easing;
    const framing = sequence.framings[1]!;
    const [shell, subject] = framing.layers as [UiLayer, UiLayer];
    const seek = run(fallbackScene(packet, design()));
    for (const frame of [0, 3, 12, 30, 51, 83]) {
      const styles = seek(1.4 + frame / FPS);
      const crop = camera(framing, frame, easing);
      const geometry = plateGeometry(sequence, crop, W, H);
      const plate = styles('scene-01-f2-plate');
      expectStyle(plate['left'], `${geometry.left}px`, `plate left at ${frame}`);
      expectStyle(plate['top'], `${geometry.top}px`, `plate top at ${frame}`);
      expectStyle(plate['width'], `${geometry.imageWidth}px`, `plate width at ${frame}`);

      const st = layerProgress(shell, frame, FPS, easing);
      expectStyle(styles('scene-01-f2-shell')['transform'], `translate3d(0, ${st * H * 0.012}px, ${-st * H * 0.42}px) scale(${1 - st * 0.06})`, `shell at ${frame}`);
      expectStyle(styles('scene-01-f2-shell')['filter'], `blur(${st * 7}px) brightness(${1 - st * 0.45}) saturate(${1 - st * 0.3})`, `shell grade at ${frame}`);

      const t = layerProgress(subject, frame, FPS, easing);
      const box = geometry.onScreen(subject.rect);
      const layer = styles('scene-01-f2-layer-1');
      expectStyle(layer['left'], `${box.x}px`, `panel left at ${frame}`);
      expectStyle(layer['height'], `${box.height}px`, `panel height at ${frame}`);
      expectStyle(layer['transform'], `translate3d(0px, 0px, 0px) scale(${1 + t * 0.06})`, `panel at ${frame}`);
      expectStyle(layer['boxShadow'], `0 ${H * (0.012 + 0.014 * t)}px ${H * 0.05}px rgba(0,0,0,${0.36 * t})`, `panel shadow at ${frame}`);
      // The shell is cut away under the panel, in frame space.
      expectStyle(
        styles('scene-01-f2-cutter')['clipPath'],
        `path(evenodd, "M0 0H${W}V${H}H0Z M${box.x} ${box.y}H${box.x + box.width}V${box.y + box.height}H${box.x}Z")`,
        `holes at ${frame}`,
      );
    }
  });

  it('presses the control and lifts the result, the camera opening on the result’s own timing', () => {
    const operate = { role: 'action', move: 'push', from: { x: 0, y: 0.3, width: 0.6, height: 0.54 }, to: { x: 0, y: 0.36, width: 0.66, height: 0.594 }, seconds: 3.6, layers: operateLayers(bar, panel(4), 3.6) };
    const { packet, sequence } = filmed([operate]);
    const html = fallbackScene(packet, design());
    expect(errorsOf(html, packet)).toEqual([]);
    const easing = packet.recipe.easing;
    const framing = sequence.framings[0]!;
    const control = framing.layers.find((layer) => layer.motion === 'press')!;
    const result = framing.layers.find((layer) => layer.role === 'overlay')!;
    // Both are filled rectangles of the product's own, so both are drawn with its corners; the ring is the only added mark.
    expect(html).toContain('id="scene-01-f1-layer-1" class="scene-01-layer scene-01-rounded"');
    expect(html).toContain('id="scene-01-f1-ring-1" class="scene-01-ring"');
    expect(html).not.toContain('id="scene-01-f1-ring-2"');

    const seek = run(html);
    const mid = Math.round((control.delaySeconds + control.durationSeconds / 2) * FPS);
    const after = Math.ceil((control.delaySeconds + control.durationSeconds) * FPS) + 1;
    for (const frame of [0, mid, after, Math.round((result.delaySeconds + 0.2) * FPS), 107]) {
      const styles = seek(frame / FPS);
      const geometry = plateGeometry(sequence, camera(framing, frame, easing), W, H);
      expectStyle(styles('scene-01-f1-plate')['left'], `${geometry.left}px`, `plate at ${frame}`);
      const t = layerProgress(control, frame, FPS, easing);
      const press = Math.sin(Math.min(1, t) * Math.PI);
      expectStyle(styles('scene-01-f1-layer-1')['transform'], `translate3d(0px, 0px, 0px) scale(${1 - press * 0.05})`, `control at ${frame}`);
      const ring = styles('scene-01-f1-ring-1');
      if (press > 0.02) {
        expect(ring['display'], `ring at ${frame}`).toBe('block');
        expect(Number(ring['opacity'])).toBeCloseTo((1 - Math.min(1, t)) * 0.75, 9);
        expectStyle(ring['transform'], `scale(${1 + Math.min(1, t) * 0.35})`, `ring at ${frame}`);
      } else {
        expect(ring['display'], `ring at ${frame}`).toBe('none');
      }
      const lifted = layerProgress(result, frame, FPS, easing);
      expectStyle(styles('scene-01-f1-layer-2')['transform'], `translate3d(0px, 0px, 0px) scale(${1 + lifted * 0.06})`, `result at ${frame}`);
    }
    expect(Number(seek(mid / FPS)('scene-01-f1-ring-1')['opacity'])).toBeGreaterThan(0.3);
  });

  it('writes no name into its script that the storyboard schema does not define', () => {
    const { packet } = filmed([establish, isolate]);
    const hostile = '</script><script>window.stolen = 1</script>';
    const sequence = packet.uiSequence as { framings: { layers: Record<string, unknown>[] }[] };
    for (const layer of sequence.framings[1]!.layers) Object.assign(layer, { role: hostile, motion: hostile, from: hostile, source: `assets/x.png" onerror="alert(1)` });
    const html = fallbackScene(packet, design());
    expect(html).not.toContain('stolen');
    expect(html).not.toContain('onerror');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });

  it('writes a crop into its script exactly: a thousandth of a wide capture is pixels', () => {
    const precise = { ...establish, from: { x: 0.0123456789, y: 0.0234567891, width: 0.9123456789, height: 0.8211111110 } };
    const { packet } = filmed([precise, isolate]);
    const html = fallbackScene(packet, design());
    expect(html).toContain('0.0123456789');
    expect(html).toContain('0.9123456789');
  });
});

describe('a framing set in a volume', () => {
  const other = image('ast_other', { width: 1440, height: 900 });
  const panels = [{ rect: panel(0) }, { rect: panel(4) }, { rect: { x: 0.05, y: 0.1, width: 0.5, height: 0.5 }, assetId: 'ast_other', sourceWidth: 1440, sourceHeight: 900 }];
  const whole = { x: 0, y: 0, width: 1, height: 0.9 };
  const volume = (overrides: Partial<Record<string, unknown>> = {}) => ({ role: 'context', move: 'settle', from: whole, to: whole, seconds: 4, space: 'volume', wordsBehind: true, layers: volumeLayers(panels, 4), ...overrides });

  it('hangs the panels, one from another capture at that capture’s proportions, with the line behind them', () => {
    const { packet } = filmed([volume()], [image('ast_img'), other], ['Three views, one truth.']);
    const html = fallbackScene(packet, design());
    expect(errorsOf(html, packet)).toEqual([]);
    expect(html).toContain('id="scene-01-f1-behind" class="scene-01-behind">Three views, one truth.<');
    expect(html).not.toContain('id="scene-01-f1-words"');
    expect(html).toContain('id="scene-01-f1-panel-3-image" class="scene-01-plate" src="assets/ast_other.png"');
    const panelWidth = W * 0.46;
    const panelHeight = (panelWidth * (0.5 * 900)) / (0.5 * 1440);
    expect(html).toContain(`#scene-01-f1-panel-3 { left: `);
    expect(html).toMatch(new RegExp(`#scene-01-f1-panel-3 \\{[^}]*height: ${Math.round(panelHeight * 1000) / 1000}px`));
    // Only the planes behind the subject are defocused.
    expect(html).not.toContain('#scene-01-f1-panel-1-surface');
    expect(html).toContain(`#scene-01-f1-panel-2-surface { filter: blur(${Math.round(0.3 * 3.2 * 1000) / 1000}px) brightness(0.94); }`);
  });

  it('dollies past the panels and brings them in on the Remotion component’s numbers', () => {
    const { packet, sequence } = filmed([volume()], [image('ast_img'), other], ['Three views, one truth.']);
    const easing = packet.recipe.easing;
    const layers = sequence.framings[0]!.layers;
    const seek = run(fallbackScene(packet, design()));
    for (const frame of [0, 9, 30, 60, 119]) {
      const styles = seek(frame / FPS);
      const t = EASINGS[easing](progress(frame, FPS, { durationSeconds: 4 }));
      expectStyle(styles('scene-01-f1-camera')['transform'], `translate3d(${(0.5 - t) * W * 0.08}px, ${(t - 0.5) * H * 0.02}px, ${t * H * 0.34}px) rotateY(${(0.5 - t) * 5}deg)`, `camera at ${frame}`);
      expectStyle(styles('scene-01-f1-bands')['transform'], `rotate(-18deg) translateX(${(t - 0.5) * W * 0.06}px)`, `light at ${frame}`);
      expect(Number(styles('scene-01-f1-behind')['opacity'])).toBeCloseTo(0.2 + t * 0.06, 9);
      layers.forEach((layer, index) => {
        const arrive = EASINGS.out_expo(progress(frame, FPS, { delaySeconds: layer.delaySeconds, durationSeconds: Math.max(0.5, layer.durationSeconds) }));
        const spread = index - (layers.length - 1) / 2;
        const plane = styles(`scene-01-f1-panel-${index + 1}`);
        expect(Number(plane['opacity']), `panel ${index + 1} at ${frame}`).toBeCloseTo(arrive, 9);
        expectStyle(plane['transform'], `translate3d(0, ${(1 - arrive) * H * 0.05}px, ${layer.depth * H * 0.55}px) rotateY(${-spread * 13}deg)`, `panel ${index + 1} at ${frame}`);
      });
    }
  });

  it('sets the line in the corner when it is not behind the panels', () => {
    const { packet } = filmed([volume({ wordsBehind: false, words: 'top_left' })], [image('ast_img'), other]);
    const html = fallbackScene(packet, design());
    expect(errorsOf(html, packet)).toEqual([]);
    expect(html).not.toContain('class="scene-01-behind"');
    expect(html).toContain('id="scene-01-f1-words"');
  });

  it('hangs the shot’s own capture where a panel’s capture could not be staged, as the Remotion engine does', () => {
    const { packet } = filmed([volume()], [image('ast_img')]);
    const html = fallbackScene(packet, design());
    expect(errorsOf(html, packet)).toEqual([]);
    expect(html).toContain('id="scene-01-f1-panel-3-image" class="scene-01-plate" src="assets/ast_img.png"');
    expect(html).not.toContain('ast_other');
  });
});
