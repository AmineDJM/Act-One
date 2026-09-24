import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { sceneWindows, type CaptionCue } from '@act-one/core';
import type { StorageProvider } from '@act-one/providers';
import { boundarySeconds, CONTENT_SECURITY_POLICY, windowFrames, withPreamble, writeProject } from '../assemble.ts';
import { captionsMarkup } from '../captions.ts';
import { fallbackScene } from '../fallback.ts';
import { joinStatements, type HostTiming } from '../joins.ts';
import { frameIdFor, referencedAssetIds } from '../packets.ts';
import { studioCss } from '../studio.ts';
import { DirectorySceneStore, sceneKey, StorageSceneStore, stableJson } from '../scene-store.ts';
import { filmTokens, tokenCss } from '../tokens.ts';
import { clip, design, image, packet, packetsFor, scene, sceneTokens, storyboard } from './helpers.ts';

describe('the briefs', () => {
  it('name scenes in film order, safely', () => {
    expect([0, 8, 99].map(frameIdFor)).toEqual(['scene-01', 'scene-09', 'scene-100']);
  });

  it('time a scene from its mount, with the joins it arrives and leaves through', () => {
    const board = storyboard([scene(0, { duration: 3 }), scene(1, { duration: 4 }), scene(2, { duration: 3 })], {
      scn_0: { kind: 'scale_through', seconds: 0.8, anchor: null, reason: 'test' },
    });
    const [first, second, third] = packetsFor(board);
    expect(first!.timing).toEqual({ mountedSeconds: 3.8, beatStart: 0, beatDuration: 3, arrives: null, leaves: { through: 'scale_through', seconds: 0.8 } });
    expect(second!.timing).toEqual({ mountedSeconds: 4.8, beatStart: 0.8, beatDuration: 4, arrives: { through: 'scale_through', seconds: 0.8 }, leaves: null });
    expect(third!.timing).toMatchObject({ beatStart: 0, arrives: null, leaves: null });
    expect(third!.isFinalScene).toBe(true);
  });

  it('carry only the files that were staged, and the first clip among them', () => {
    const target = packet({ recipe: 'footage', assets: ['ast_missing', 'ast_img', 'ast_clip'] }, { staged: [image('ast_img'), clip('ast_clip')] });
    expect(target.assets.map((asset) => asset.id)).toEqual(['ast_img', 'ast_clip']);
    expect(target.clip?.id).toBe('ast_clip');
  });

  it('resolve a layer cut from another capture to its path, and say when it is not there', () => {
    const board = storyboard([scene(0, { recipe: 'product_sequence', assets: ['ast_main'] })]);
    const withSequence = {
      ...board,
      scenes: [{
        ...board.scenes[0]!,
        uiSequence: {
          background: '#000000',
          framings: [{
            from: { x: 0, y: 0, width: 1, height: 1 }, to: { x: 0, y: 0, width: 0.5, height: 0.5 }, seconds: 3, cut: false, lift: null, words: null,
            layers: [
              { rect: { x: 0, y: 0, width: 0.2, height: 0.2 }, assetId: 'ast_other', edge: 'left', delaySeconds: 0, durationSeconds: 1 },
              { rect: { x: 0, y: 0, width: 0.2, height: 0.2 }, assetId: 'ast_gone', edge: 'left', delaySeconds: 0, durationSeconds: 1 },
            ],
          }],
        },
      }],
    } as unknown as typeof board;
    expect(referencedAssetIds(withSequence).sort()).toEqual(['ast_gone', 'ast_main', 'ast_other']);
    const [target] = packetsFor(withSequence, { staged: [image('ast_main'), image('ast_other')] });
    const layers = (target!.uiSequence as { framings: { layers: { source: string }[] }[] }).framings[0]!.layers;
    expect(layers.map((layer) => layer.source)).toEqual(['assets/ast_other.png', 'unavailable: leave this layer out']);
  });
});

describe('the joins', () => {
  const recorded: { selector: string; from: Record<string, unknown>; to: Record<string, unknown>; at: number }[] = [];
  const tl = { fromTo: (selector: string, from: Record<string, unknown>, to: Record<string, unknown>, at: number) => recorded.push({ selector, from, to, at }) };
  const ActOne = { ease: (name: string) => (name === 'in_cubic' ? (t: number) => t * t * t : (t: number) => 1 - (1 - t) ** 5) };

  function run(kind: 'scale_through' | 'camera_carry' | 'cut') {
    recorded.length = 0;
    const board = storyboard([scene(0), scene(1)], { scn_0: { kind, seconds: 0.8, anchor: null, reason: 'test' } });
    const packets = packetsFor(board);
    const windows = sceneWindows(board);
    const hosts = new Map<string, HostTiming>(packets.map((target, index) => [target.frameId, { hostId: `host-${target.frameId}`, fromSeconds: windows[index]!.fromSeconds, toSeconds: windows[index]!.toSeconds }]));
    new Function('tl', 'ActOne', joinStatements(packets, hosts).join('\n'))(tl, ActOne);
    return recorded;
  }

  it('push the leaving beat past the lens and settle the arriving one, with the Remotion numbers', () => {
    const tweens = run('scale_through');
    const leaving = tweens.filter((tween) => tween.selector === '#host-scene-01');
    const arriving = tweens.filter((tween) => tween.selector === '#host-scene-02');
    expect(leaving.map((tween) => tween.to)).toEqual([
      expect.objectContaining({ scale: 1.9, duration: 0.8, immediateRender: false }),
      expect.objectContaining({ opacity: 0, duration: 0.8 }),
      expect.objectContaining({ filter: 'blur(9px)' }),
    ]);
    // The beat ends at 3 s; it leaves over the next 0.8 s, while the next arrives over the 0.8 s before.
    expect(leaving.every((tween) => tween.at === 3)).toBe(true);
    expect(arriving).toEqual([expect.objectContaining({ from: { scale: 0.82, opacity: 0 }, at: 2.2 })]);
    expect(arriving[0]!.to).toMatchObject({ scale: 1, opacity: 1, immediateRender: true });
    // The opacity of a scale-through falls with the square of the curve.
    const opacityEase = leaving[1]!.to.ease as (t: number) => number;
    expect(opacityEase(0.5)).toBeCloseTo((0.5 ** 3) ** 2, 10);
  });

  it('carry a beat out sideways by 34% while the next comes in from 26%', () => {
    const tweens = run('camera_carry');
    expect(tweens.find((tween) => tween.selector === '#host-scene-01')!.to).toMatchObject({ xPercent: -34, scale: 0.94, opacity: 0.15 });
    expect(tweens.find((tween) => tween.selector === '#host-scene-02')!.from).toEqual({ xPercent: 26, opacity: 0 });
  });

  it('do nothing for a cut', () => {
    expect(run('cut')).toEqual([]);
  });
});

describe('the captions', () => {
  const tokens = filmTokens(design());
  const cues: CaptionCue[] = [
    { start: 1.2345678, end: 2.5, text: 'Close the books <tonight>', lines: ['Close the books', '<tonight>'], emphasis: 'books' },
    { start: 3, end: 3, text: 'empty', lines: [], emphasis: null },
  ] as unknown as CaptionCue[];

  it('are timed to the microsecond, escaped, and mark one word', () => {
    const html = captionsMarkup(cues, tokens, '16:9', 3);
    expect(html).toContain('data-start="1.234568" data-duration="1.265432" data-track-index="3"');
    expect(html).toContain('Close the <span class="ao-caption-emphasis">books</span>');
    expect(html).toContain('&lt;tonight&gt;');
    expect(html).not.toContain('empty');
  });

  it('are larger on a vertical cut, as the Remotion engine sets them', () => {
    const vertical = captionsMarkup(cues.slice(0, 1), filmTokens(design()), '9:16', 3);
    expect(vertical).toContain(`font-size:${Math.round(tokens.frame.height * 0.038)}px`);
  });
});

describe('the assembled project', () => {
  it('holds each scene to whole frames, as a Remotion Sequence does, and the last to the film’s end', () => {
    expect(windowFrames({ fromSeconds: 2.21, toSeconds: 5.4 }, 30, null)).toEqual({ from: 66, to: 162 });
    expect(windowFrames({ fromSeconds: 10, toSeconds: 12.99 }, 30, 391)).toEqual({ from: 300, to: 391 });
    // A boundary is written a tenth of a millisecond early, never before the frame it belongs to.
    expect(boundarySeconds(0, 30)).toBe(0);
    expect(boundarySeconds(90, 30)).toBeCloseTo(2.9999, 6);
    expect(boundarySeconds(90, 30)).toBeGreaterThan(89 / 30);
  });

  it('is written with the policy, the faces, the joins, the captions and the watermark', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-hf-assemble-'));
    const board = storyboard([scene(0, { recipe: 'kinetic_headline' }), scene(1, { recipe: 'cta_end_card' })], {
      scn_0: { kind: 'morph', seconds: 0.6, anchor: null, reason: 'test' },
    });
    const packets = packetsFor(board);
    const tokens = sceneTokens();
    await writeProject({
      projectDir: dir,
      canvas: { width: 1920, height: 1080 },
      fps: 30,
      filmFrames: 180,
      language: 'fr',
      packets,
      scenes: new Map(packets.map((target) => [target.frameId, fallbackScene(target, tokens.design)])),
      windows: new Map(sceneWindows(board).map((window, index) => [packets[index]!.frameId, window])),
      tokenCss: tokenCss(tokens.film),
      studioCss: studioCss(tokens.design),
      fontCss: '@font-face { font-family: "Inter"; src: url(fonts/inter.woff2); }',
      captionsHtml: '<div id="ao-caption-1" class="clip ao-caption" data-start="0" data-duration="1" data-track-index="3">x</div>',
      watermarkSvg: '<text>Act One</text>',
    });
    const index = await readFile(path.join(dir, 'index.html'), 'utf8');
    expect(index).toContain(`<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">`);
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'self'");
    expect(index).toContain('<html lang="fr">');
    // The box model of the Remotion engine's render page, so a lower third's padding stays inside the safe area.
    expect(index).toContain('* { box-sizing: border-box; }');
    expect(index).toContain(`.ao-frame { position: absolute; box-sizing: border-box; left: ${tokens.design.grid.safe.x}px;`);
    expect(index).toContain('data-composition-id="film" data-start="0" data-duration="6"');
    expect(index).toContain('id="host-scene-01" class="ao-scene" data-composition-id="scene-01" data-composition-src="compositions/scene-01.html" data-start="0" data-duration="3.5999"');
    expect(index).toContain('data-track-index="1"');
    expect(index).toContain('id="host-scene-02"');
    expect(index).toContain('data-track-index="2"');
    expect(index).toContain('ao-caption-1');
    expect(index).toContain('<text>Act One</text>');
    expect(index).toContain('window.__timelines["film"] = tl;');
    expect(await readdir(path.join(dir, 'vendor'))).toEqual(['act-one-motion.js', 'gsap.min.js']);
    const sceneFile = await readFile(path.join(dir, 'compositions', 'scene-01.html'), 'utf8');
    expect(sceneFile.startsWith('<template>\n<style>\n@font-face')).toBe(true);
    expect(JSON.parse(await readFile(path.join(dir, 'hyperframes.json'), 'utf8'))).toEqual({ media: { autoProxy: false } });
  });

  it('prefixes a scene with the engine’s faces and scripts, inside its template, without its comments', () => {
    const html = withPreamble('<template id="t"><!-- a note --><div id="root"></div></template>', '@font-face {}');
    expect(html).toBe('<template id="t">\n<style>\n@font-face {}\n</style>\n<script src="vendor/gsap.min.js"></script>\n<script src="vendor/act-one-motion.js"></script>\n<div id="root"></div></template>');
    expect(() => withPreamble('<div></div>', '')).toThrow(/template/);
  });
});

describe('the scene store', () => {
  const tokens = sceneTokens();

  it('keys a scene by everything its author was told, and nothing else', () => {
    const target = packet({ text: ['Forty unmatched rows.'] });
    const key = sceneKey(target, tokens.film, 'deep');
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(sceneKey(structuredClone(target), tokens.film, 'deep')).toBe(key);
    expect(sceneKey(packet({ text: ['Forty unmatched rows!'] }), tokens.film, 'deep')).not.toBe(key);
    expect(sceneKey(target, tokens.film, 'balanced')).not.toBe(key);
    expect(sceneKey(target, { ...tokens.film, accent: '#ff0000' }, 'deep')).not.toBe(key);
  });

  it('sees a new capture under the same path as a new brief', () => {
    const one = packet({ recipe: 'photo_hold', assets: ['ast_img'] }, { staged: [image('ast_img', { bytes: 100 })] });
    const two = packet({ recipe: 'photo_hold', assets: ['ast_img'] }, { staged: [image('ast_img', { bytes: 101 })] });
    expect(sceneKey(one, tokens.film, 'deep')).not.toBe(sceneKey(two, tokens.film, 'deep'));
  });

  it('writes JSON with its keys in order', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe('{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}');
  });

  it('keeps scenes in a directory, and only under a real key', async () => {
    const store = new DirectorySceneStore(await mkdtemp(path.join(tmpdir(), 'act-one-hf-store-')));
    const key = 'a'.repeat(64);
    expect(await store.get(key)).toBeNull();
    await store.put(key, '<template></template>');
    expect(await store.get(key)).toBe('<template></template>');
    await expect(store.put('../../etc/passwd', 'x')).rejects.toThrow(/sha-256/);
    await expect(store.get('b'.repeat(63))).rejects.toThrow(/sha-256/);
  });

  it('keeps scenes in the platform’s storage, private, under a plain prefix', async () => {
    const objects = new Map<string, { data: Uint8Array; visibility: string }>();
    const storage = {
      exists: async (key: string) => objects.has(key),
      get: async (key: string) => objects.get(key)!.data,
      put: async (key: string, data: Uint8Array, options: { visibility: string }) => {
        objects.set(key, { data, visibility: options.visibility });
        return { key, checksum: 'x', bytes: data.byteLength };
      },
    } as unknown as StorageProvider;
    const store = new StorageSceneStore(storage, 'org/org_1/project/prj_1/hyperframes-scenes/');
    const key = 'c'.repeat(64);
    await store.put(key, '<template>é</template>');
    expect([...objects.keys()]).toEqual([`org/org_1/project/prj_1/hyperframes-scenes/${key}.html`]);
    expect(objects.get(`org/org_1/project/prj_1/hyperframes-scenes/${key}.html`)!.visibility).toBe('private');
    expect(await store.get(key)).toBe('<template>é</template>');
    expect(() => new StorageSceneStore(storage, '../elsewhere')).toThrow(/plain storage path/);
  });
});
