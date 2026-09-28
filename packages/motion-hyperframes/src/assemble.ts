import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { captionCss, type CaptionStyle } from './captions.ts';
import { joinStatements, type HostTiming } from './joins.ts';
import type { Backdrop } from './launch.ts';
import { motionRuntimeSource } from './motion-runtime.ts';
import type { ScenePacket } from './types.ts';

/**
 * The render project, written to disk.
 *
 * Everything here is the engine's own code; only the scene files come from
 * the agent, and they arrive already checked. The index is the film: the
 * field, each scene mounted for its window on alternating tracks so two scenes
 * can share a join, the joins themselves, the captions and the watermark.
 * Every page the renderer opens carries a content policy that forbids the
 * network, so a scene that slipped something past the checks still cannot
 * reach anything but the project's own files.
 */
export const FILM_COMPOSITION_ID = 'film';

/** The launch look's field under every scene, mounted as a composition of its own on the lowest track. */
export const BACKDROP_COMPOSITION_ID = 'ao-backdrop';

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

export type ProjectInput = {
  projectDir: string;
  canvas: { width: number; height: number };
  fps: number;
  /** The film's length in frames, as the Remotion engine counts it. */
  filmFrames: number;
  language: string;
  packets: readonly ScenePacket[];
  /** Checked scene fragments, by frame id. */
  scenes: ReadonlyMap<string, string>;
  /** Window of each scene on the film timeline, by frame id, in seconds as the storyboard gives them. */
  windows: ReadonlyMap<string, { fromSeconds: number; toSeconds: number }>;
  tokenCss: string;
  /** The studio's layout primitives: the frames type is placed in. */
  studioCss: string;
  fontCss: string;
  captionsHtml: string;
  /** How the captions are set: the classic plate, or the launch look's pill. */
  captionStyle?: CaptionStyle;
  watermarkSvg: string | null;
  /**
   * The field under every scene, in place of the canvas colour: the launch
   * look's backdrop, given where each beat starts on the film's clock.
   * Absent, the field is the canvas colour.
   */
  backdrop?: (beatStarts: ReadonlyMap<string, number>) => Backdrop;
};

const require = createRequire(import.meta.url);

export async function writeProject(input: ProjectInput): Promise<{ indexPath: string }> {
  const { projectDir } = input;
  await mkdir(path.join(projectDir, 'compositions'), { recursive: true });
  await mkdir(path.join(projectDir, 'vendor'), { recursive: true });
  await copyFile(require.resolve('gsap/dist/gsap.min.js'), path.join(projectDir, 'vendor', 'gsap.min.js'));
  await writeFile(path.join(projectDir, 'vendor', 'act-one-motion.js'), motionRuntimeSource(), 'utf8');

  const hosts = new Map<string, HostTiming>();
  input.packets.forEach((packet, position) => {
    const window = input.windows.get(packet.frameId);
    if (!window) throw new Error(`No window for ${packet.frameId}.`);
    const frames = windowFrames(window, input.fps, position === input.packets.length - 1 ? input.filmFrames : null);
    hosts.set(packet.frameId, { hostId: `host-${packet.frameId}`, fromSeconds: frames.from / input.fps, toSeconds: frames.to / input.fps });
  });
  for (const packet of input.packets) {
    const scene = input.scenes.get(packet.frameId);
    if (!scene) throw new Error(`No scene written for ${packet.frameId}.`);
    await writeFile(path.join(projectDir, 'compositions', `${packet.frameId}.html`), withPreamble(scene, input.fontCss), 'utf8');
  }

  const duration = filmSeconds(input.filmFrames, input.fps);
  const beatStarts = new Map(input.packets.map((packet) => [packet.frameId, hosts.get(packet.frameId)!.fromSeconds + packet.timing.beatStart]));
  const backdrop = input.backdrop ? input.backdrop(beatStarts) : null;
  if (backdrop) {
    await writeFile(
      path.join(projectDir, 'compositions', `${BACKDROP_COMPOSITION_ID}.html`),
      withPreamble(backdropComposition(backdrop, input.canvas, duration), ''),
      'utf8',
    );
  }

  const indexPath = path.join(projectDir, 'index.html');
  await writeFile(indexPath, indexHtml(input, hosts, backdrop !== null), 'utf8');
  await writeFile(
    path.join(projectDir, 'hyperframes.json'),
    JSON.stringify({ media: { autoProxy: false } }, null, 2),
    'utf8',
  );
  return { indexPath };
}

/**
 * A scene file as the renderer loads it: the engine's faces and scripts first,
 * then the agent's composition, with its comments removed.
 */
export function withPreamble(scene: string, fontCss: string): string {
  const cleaned = scene.replace(/<!--[\s\S]*?-->/g, '');
  const opening = /^<template\b[^>]*>/i.exec(cleaned);
  if (!opening) throw new Error('A scene must start with <template>.');
  const preamble = [
    `<style>\n${fontCss}\n</style>`,
    '<script src="vendor/gsap.min.js"></script>',
    '<script src="vendor/act-one-motion.js"></script>',
  ].join('\n');
  return `${opening[0]}\n${preamble}\n${cleaned.slice(opening[0].length)}`;
}

/**
 * A scene's window in whole frames, the way a Remotion `Sequence` places it:
 * the start rounded to a frame, the length rounded to a frame. The last scene
 * is held to the film's own last frame, so the film never ends on an empty one.
 */
export function windowFrames(window: { fromSeconds: number; toSeconds: number }, fps: number, filmFrames: number | null): { from: number; to: number } {
  const from = Math.round(window.fromSeconds * fps);
  const to = filmFrames ?? from + Math.max(1, Math.round((window.toSeconds - window.fromSeconds) * fps));
  return { from, to: Math.max(from + 1, to) };
}

/**
 * A frame boundary as the renderer should read it.
 *
 * HyperFrames samples frame n at exactly n / fps and shows an element while
 * start ≤ t < start + duration. Written exactly, a boundary sits on the sample,
 * and the decimal it is written as can land a hair after it and lose a frame.
 * A tenth of a millisecond earlier is still after the previous frame by a
 * whole frame less that, and before this one without doubt.
 */
const BOUNDARY_GUARD_SECONDS = 1e-4;

export function boundarySeconds(frame: number, fps: number): number {
  return Math.max(0, frame / fps - (frame === 0 ? 0 : BOUNDARY_GUARD_SECONDS));
}

/** The film's length as it is written: a hair short of the last frame's end, so the frame count rounds to exactly filmFrames in every reading of it. */
function filmSeconds(filmFrames: number, fps: number): number {
  return Math.floor((filmFrames / fps) * 1e6) / 1e6;
}

/**
 * The backdrop as a composition: its layers, its styles and its own timeline,
 * on the film's clock from the film's first frame. A composition rather than
 * layers in the film's page, because HyperFrames builds a film only from
 * compositions and reads a clip that holds other elements as a mistake.
 */
export function backdropComposition(backdrop: Backdrop, canvas: { width: number; height: number }, durationSeconds: number): string {
  return [
    '<template>',
    `<style>\n#root { position: absolute; inset: 0; overflow: hidden; }\n${backdrop.css}\n</style>`,
    `<div id="root" data-composition-id="${BACKDROP_COMPOSITION_ID}" data-width="${canvas.width}" data-height="${canvas.height}">`,
    backdrop.markup,
    '</div>',
    '<script>',
    'const tl = gsap.timeline({ paused: true });',
    ...backdrop.statements,
    `tl.set({}, {}, ${durationSeconds});`,
    'window.__timelines = window.__timelines || {};',
    `window.__timelines[${JSON.stringify(BACKDROP_COMPOSITION_ID)}] = tl;`,
    '</script>',
    '</template>',
  ].join('\n');
}

function indexHtml(input: ProjectInput, hosts: ReadonlyMap<string, HostTiming>, hasBackdrop: boolean): string {
  const { width, height } = input.canvas;
  const duration = filmSeconds(input.filmFrames, input.fps);
  const language = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(input.language) ? input.language : 'en';

  const sceneHosts = input.packets.map((packet, position) => {
    const host = hosts.get(packet.frameId)!;
    const start = boundarySeconds(Math.round(host.fromSeconds * input.fps), input.fps);
    const end = boundarySeconds(Math.round(host.toSeconds * input.fps), input.fps);
    return [
      `  <div id="${host.hostId}" class="ao-scene"`,
      ` data-composition-id="${packet.frameId}"`,
      ` data-composition-src="compositions/${packet.frameId}.html"`,
      ` data-start="${micro(start)}" data-duration="${micro(end - start)}"`,
      // Alternating tracks: two scenes overlap only across a join, and never on one track.
      ` data-track-index="${1 + (position % 2)}"`,
      ` data-width="${width}" data-height="${height}"></div>`,
    ].join('');
  });

  const field = hasBackdrop
    ? `  <div id="host-${BACKDROP_COMPOSITION_ID}" class="ao-scene" data-composition-id="${BACKDROP_COMPOSITION_ID}" data-composition-src="compositions/${BACKDROP_COMPOSITION_ID}.html" data-start="0" data-duration="${duration}" data-track-index="0" data-width="${width}" data-height="${height}"></div>`
    : `  <div id="ao-field" class="clip ao-overlay" data-start="0" data-duration="${duration}" data-track-index="0" style="background: var(--ao-canvas);"></div>`;

  const timeline = [
    'window.__timelines = window.__timelines || {};',
    'const tl = gsap.timeline({ paused: true });',
    ...joinStatements(input.packets, hosts),
    `tl.set({}, {}, ${duration});`,
    `window.__timelines[${JSON.stringify(FILM_COMPOSITION_ID)}] = tl;`,
  ];

  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
<meta name="viewport" content="width=${width}, height=${height}">
<script src="vendor/gsap.min.js"></script>
<script src="vendor/act-one-motion.js"></script>
<style>
${input.fontCss}
${input.tokenCss}
/* The Remotion engine's render page sets every element border-box; a padded or bordered box here keeps the size it has there. */
* { box-sizing: border-box; }
${input.studioCss}
html, body { margin: 0; padding: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #000; }
#root { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: var(--ao-canvas); }
.ao-scene { position: absolute; inset: 0; width: 100%; height: 100%; transform-origin: 50% 50%; }
.ao-overlay { position: absolute; inset: 0; pointer-events: none; }
${captionCss(input.captionStyle ?? 'plate')}
</style>
</head>
<body>
<div id="root" data-composition-id="${FILM_COMPOSITION_ID}" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}" data-fps="${input.fps}">
${field}
${sceneHosts.join('\n')}
${input.captionsHtml}
${input.watermarkSvg ? `  <div id="ao-watermark" class="clip ao-overlay" data-start="0" data-duration="${duration}" data-track-index="5"><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${input.watermarkSvg}</svg></div>` : ''}
</div>
<script>
${timeline.join('\n')}
</script>
</body>
</html>
`;
}

function micro(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
