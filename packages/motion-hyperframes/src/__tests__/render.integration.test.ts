import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ScriptedLlmProvider } from '@act-one/providers';
import { runFfmpeg } from '@act-one/sound';
import { probeMedia, deliveryProblems } from '../media.ts';
import { HyperFramesRenderError, renderFilmWithHyperFrames } from '../render.ts';
import { browserCandidates, resolveTools } from '../tools.ts';
import { brand, design, image, packet, scene, storyboard } from './helpers.ts';

/**
 * Real renders, through the pinned HyperFrames CLI, in a real browser.
 *
 * Small films on purpose — a few seconds each — because what is being proved
 * is the path, not the picture: the delivery the render stage expects, a
 * scene HyperFrames refuses being sent back and then replaced, and a still.
 * The picture itself is measured against the Remotion engine by
 * `npm run engine-parity`.
 */
const browser = browserCandidates().find((candidate) => existsSync(candidate));

describe('a render that cannot start', () => {
  it('says why, before touching a browser', async () => {
    const error = await renderFilmWithHyperFrames({
      props: { storyboard: storyboard([scene(0)]), brand, assetUrls: {} },
      aspect: '16:9',
      fps: 0,
      outputPath: '',
      stillAtSeconds: 99,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HyperFramesRenderError);
    expect((error as HyperFramesRenderError).code).toBe('invalid_input');
    expect((error as HyperFramesRenderError).details).toEqual([
      'a still was asked for at 99 s, outside the film',
      '0 is not a frame rate this engine renders (1 to 120, whole)',
      'no output path',
    ]);
  });
});

describe.skipIf(!browser)('a film rendered by HyperFrames', () => {
  it('is the silent master the render stage expects, at the size it asked for', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-hf-render-'));
    const picture = path.join(dir, 'shot.png');
    await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#2d3a4f' } }).png().toFile(picture);
    const outputPath = path.join(dir, 'film.mp4');
    const result = await renderFilmWithHyperFrames({
      props: {
        storyboard: storyboard(
          [scene(0, { recipe: 'kinetic_headline', text: ['Forty unmatched rows.'], duration: 1.5 }), scene(1, { recipe: 'photo_hold', text: ['Then none.'], assets: ['ast_shot'], duration: 1.5 })],
          { scn_0: { kind: 'scale_through', seconds: 0.5, anchor: null, reason: 'test' } },
        ),
        brand,
        assetUrls: { ast_shot: pathToFileURL(picture).href },
        watermarkLabel: 'Act One',
        cta: 'northwind.example',
      },
      aspect: '16:9',
      quality: 'preview',
      outputPath,
      ...(browser ? { browserExecutable: browser } : {}),
      log: () => undefined,
    });

    expect(result).toMatchObject({ engine: 'hyperframes', width: 960, height: 540, fps: 30, durationSeconds: 3, undecodable: [] });
    expect(result.scenes.map((report) => report.source)).toEqual(['fallback', 'fallback']);
    expect(result.checks.passes).toBe(1);
    expect(result.checks.findings.filter((finding) => finding.severity === 'error')).toEqual([]);
    const tools = await resolveTools({ browserPath: browser! });
    expect(deliveryProblems(await probeMedia(tools.ffprobePath, outputPath), { width: 960, height: 540, frames: 90 })).toEqual([]);
  }, 180_000);

  it('shows a flat brand colour as that colour, read as the file describes it', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-hf-colour-'));
    const picture = path.join(dir, 'green.png');
    await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#39d98a' } }).png().toFile(picture);
    const outputPath = path.join(dir, 'green.mp4');
    const result = await renderFilmWithHyperFrames({
      props: { storyboard: storyboard([scene(0, { recipe: 'photo_hold', text: ['Every desk, one view.'], assets: ['ast_green'], duration: 2 })]), brand, assetUrls: { ast_green: pathToFileURL(picture).href } },
      aspect: '16:9',
      quality: 'preview',
      outputPath,
      ...(browser ? { browserExecutable: browser } : {}),
      log: () => undefined,
    });
    const raw = path.join(dir, 'frame.rgb');
    const read = await runFfmpeg(
      ['-y', '-v', 'error', '-ss', '1.5', '-i', outputPath, '-frames:v', '1', '-vf', 'scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24', '-f', 'rawvideo', raw],
      { timeoutMs: 60_000 },
    );
    expect(read.ok, read.stderr).toBe(true);
    const pixels = await readFile(raw);
    const at = (270 * 960 + 480) * 3;
    const [r, g, b] = [pixels[at]!, pixels[at + 1]!, pixels[at + 2]!];
    // Not the (41, 194, 134) that JPEG frames labelled BT.709 came back as.
    expect([Math.abs(r - 57), Math.abs(g - 217), Math.abs(b - 138)].every((delta) => delta <= 4), `(${r}, ${g}, ${b})`).toBe(true);
    // White words over a bright field fall short of WCAG AA; the engine draws them as the Remotion engine does, and says so.
    const contrast = result.checks.findings.filter((finding) => finding.section === 'contrast');
    expect(contrast.length).toBeGreaterThan(0);
    expect(contrast.every((finding) => finding.severity === 'warning' && finding.message.startsWith('Drawn as the Remotion engine draws it'))).toBe(true);
  }, 180_000);

  it('sends a scene HyperFrames refuses back to its author, then draws it itself', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-hf-refused-'));
    // Passes every check this engine makes, and throws the moment a browser runs it.
    const broken = `<template>
<style>#root { position: absolute; inset: 0; overflow: hidden; } #scene-01-title { font-family: var(--ao-display-family); font-size: 80px; color: var(--ao-primary); }</style>
<div id="root" data-composition-id="scene-01" data-width="1920" data-height="1080"><div id="scene-01-title">Forty unmatched rows.</div></div>
<script>
const tl = gsap.timeline({ paused: true });
const scene01Missing = undefined;
scene01Missing.explode();
window.__timelines = window.__timelines || {};
window.__timelines["scene-01"] = tl;
</script>
</template>`;
    const llm = new ScriptedLlmProvider([{ respond: { html: broken, notes: '' } }]);
    const result = await renderFilmWithHyperFrames({
      props: { storyboard: storyboard([scene(0, { text: ['Forty unmatched rows.'], duration: 1.5 })]), brand, assetUrls: {} },
      aspect: '16:9',
      quality: 'preview',
      outputPath: path.join(dir, 'film.mp4'),
      author: { llm, call: { organizationId: 'org_test' }, maxAttempts: 1 },
      maxRepairPasses: 1,
      ...(browser ? { browserExecutable: browser } : {}),
      log: () => undefined,
    });

    // Written once, rewritten once with HyperFrames' reasons, then drawn by the engine.
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]!.messages.at(-1)!.content).toContain('hyperframes_runtime_console_error');
    expect(result.checks).toMatchObject({ passes: 3, rewritten: ['scene-01'] });
    expect(result.scenes[0]).toMatchObject({ source: 'fallback', attempts: 2 });
    expect(result.scenes[0]!.fallbackReason).toContain('console_error');
  }, 240_000);

  it('draws a still at the frame the Remotion engine would', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-hf-still-'));
    const outputPath = path.join(dir, 'poster.png');
    const result = await renderFilmWithHyperFrames({
      props: { storyboard: storyboard([scene(0, { recipe: 'editorial_headline', text: ['Close the books.'], duration: 2 })]), brand, assetUrls: {} },
      aspect: '16:9',
      quality: 'hd',
      outputPath,
      stillAtSeconds: 1.2,
      ...(browser ? { browserExecutable: browser } : {}),
      log: () => undefined,
    });
    expect(result.durationSeconds).toBe(0);
    const meta = await sharp(outputPath).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 1920, 1080]);
    // By 1.2 s the headline has arrived: the frame is not the empty canvas.
    const stats = await sharp(outputPath).stats();
    expect(Math.max(...stats.channels.map((channel) => channel.max))).toBeGreaterThan(200);
  }, 180_000);

  it('sets a lower third where the Remotion engine does, lifted inside the safe area', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-hf-lower-third-'));
    const picture = path.join(dir, 'shot.png');
    await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#101010' } }).png().toFile(picture);
    const outputPath = path.join(dir, 'poster.png');
    const spec = { recipe: 'photo_hold' as const, text: ['Then none.'], assets: ['ast_shot'], duration: 2 };
    await renderFilmWithHyperFrames({
      props: { storyboard: storyboard([scene(0, spec)]), brand, assetUrls: { ast_shot: pathToFileURL(picture).href } },
      aspect: '16:9',
      quality: 'hd',
      outputPath,
      stillAtSeconds: 1.5,
      ...(browser ? { browserExecutable: browser } : {}),
      log: () => undefined,
    });

    const { data, info } = await sharp(outputPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let lowestWhiteRow = -1;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const at = (y * info.width + x) * 3;
        if (data[at]! > 200 && data[at + 1]! > 200 && data[at + 2]! > 200) lowestWhiteRow = y;
      }
    }
    // The Remotion `Framed` lower third is the safe area with 8% of its height as padding at the foot, inside the box.
    const { safe } = design().grid;
    const foot = safe.y + safe.height * 0.92;
    const fontSizePx = packet(spec, { staged: [image('ast_shot')] }).typeset!.blocks[0]!.fontSizePx;
    expect(lowestWhiteRow).toBeLessThanOrEqual(Math.ceil(foot));
    expect(lowestWhiteRow).toBeGreaterThan(foot - fontSizePx);
  }, 180_000);
});
