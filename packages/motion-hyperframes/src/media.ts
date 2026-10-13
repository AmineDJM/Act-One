import { spawn } from 'node:child_process';
import { copyFile, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { runFfmpeg } from '@act-one/sound';

/**
 * What a video file is, according to ffprobe.
 *
 * Read from the file, never assumed from the options it was made with: the
 * output of a render is checked against the film it was meant to be before
 * anything downstream is allowed to believe it.
 */
export type MediaFacts = {
  width: number | null;
  height: number | null;
  codec: string | null;
  pixelFormat: string | null;
  colorSpace: string | null;
  colorPrimaries: string | null;
  colorTransfer: string | null;
  colorRange: string | null;
  frames: number | null;
  durationSeconds: number | null;
  audioStreams: number;
};

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaError';
  }
}

export function probeMedia(ffprobePath: string, file: string, signal?: AbortSignal): Promise<MediaFacts> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffprobePath,
      [
        '-v', 'error',
        '-show_entries',
        'stream=codec_type,codec_name,width,height,pix_fmt,color_space,color_primaries,color_transfer,color_range,nb_frames:format=duration',
        '-of', 'json',
        file,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      if (out.length < 1_000_000) out += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err = (err + chunk.toString('utf8')).slice(-4000);
    });
    child.on('error', (error) => {
      signal?.removeEventListener('abort', onAbort);
      reject(new MediaError(`ffprobe could not start: ${error.message}`));
    });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) {
        reject(signal.reason ?? new Error('aborted'));
        return;
      }
      if (code !== 0) {
        reject(new MediaError(`ffprobe could not read ${file}: ${err.trim().split('\n').pop() ?? `exit ${code}`}`));
        return;
      }
      try {
        resolve(factsFrom(JSON.parse(out)));
      } catch {
        reject(new MediaError('ffprobe answered with something that is not JSON'));
      }
    });
  });
}

type ProbeJson = {
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    pix_fmt?: string;
    color_space?: string;
    color_primaries?: string;
    color_transfer?: string;
    color_range?: string;
    nb_frames?: string;
  }[];
  format?: { duration?: string };
};

export function factsFrom(probe: ProbeJson): MediaFacts {
  const streams = probe.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const frames = Number(video?.nb_frames);
  const duration = Number(probe.format?.duration);
  return {
    width: video?.width ?? null,
    height: video?.height ?? null,
    codec: video?.codec_name ?? null,
    pixelFormat: video?.pix_fmt ?? null,
    colorSpace: video?.color_space ?? null,
    colorPrimaries: video?.color_primaries ?? null,
    colorTransfer: video?.color_transfer ?? null,
    colorRange: video?.color_range ?? null,
    frames: Number.isFinite(frames) && frames > 0 ? frames : null,
    durationSeconds: Number.isFinite(duration) ? duration : null,
    audioStreams: streams.filter((stream) => stream.codec_type === 'audio').length,
  };
}

export type ColourMatrix = 'bt709' | 'smpte170m';

/**
 * The matrix a clip's colours are read with when the file does not name one.
 *
 * The Remotion engine reads such a clip as BT.709 from 720 lines up and as
 * BT.601 below, whatever its width: measured on its renders of test patterns,
 * 960×720, 1280×720, 540×960 and 720×1280 read as BT.709, 1280×718,
 * 1280×544, 1138×640, 1024×576 and 640×360 as BT.601. HyperFrames reads every
 * such file as BT.601, so an untagged HD clip would come out in other colours
 * than in the other engine. Its proxy is labelled with the matrix the other
 * engine assumes instead; a clip that names its own keeps it.
 */
export function assumedColourMatrix(facts: Pick<MediaFacts, 'colorSpace' | 'height'>): ColourMatrix | null {
  const named = facts.colorSpace !== null && facts.colorSpace !== '' && facts.colorSpace !== 'unknown' && facts.colorSpace !== 'unspecified';
  if (named) return null;
  return (facts.height ?? 0) >= 720 ? 'bt709' : 'smpte170m';
}

/**
 * A clip, re-encoded into the form the renderer seeks reliably.
 *
 * HyperFrames extracts a clip's frames by seeking it, and warns — rightly —
 * that a file with keyframes seconds apart seeks to the wrong frame and
 * freezes. Generated shots and 3D renders arrive with whatever their tools
 * chose, so every clip is made the same thing before a scene can place it:
 * H.264 at the film's rate with a keyframe every second, 4:2:0, and no sound,
 * because a clip's own sound is never part of an Act One mix.
 */
export async function normaliseClip(
  input: string,
  output: string,
  fps: number,
  options: { describeMatrixAs?: ColourMatrix | null; signal?: AbortSignal } = {},
): Promise<void> {
  const gop = String(Math.max(1, Math.round(fps)));
  const { describeMatrixAs, signal } = options;
  const result = await runFfmpeg(
    [
      '-y', '-v', 'error',
      '-i', input,
      '-map', '0:v:0',
      '-an', '-sn', '-dn',
      '-vf', `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      // Near-lossless: this is an intermediate the film is drawn from, not a delivery.
      '-crf', '12',
      '-g', gop,
      '-keyint_min', gop,
      '-sc_threshold', '0',
      // A description only: the pixels are the source's, now labelled with the matrix they will be read with.
      ...(describeMatrixAs ? ['-colorspace', describeMatrixAs] : []),
      '-movflags', '+faststart',
      output,
    ],
    { timeoutMs: 10 * 60_000, ...(signal ? { signal } : {}) },
  );
  if (!result.ok) {
    throw new MediaError(`the clip could not be prepared for rendering: ${lastLine(result.stderr)}`);
  }
}

export type FrameEncodeSpec = {
  fps: number;
  /** The film's length in frames: the renderer must have written exactly these. */
  frames: number;
  /** The delivery size; frames drawn at another size are scaled in the same pass. */
  width: number;
  height: number;
  /** x264 quality, the same the Remotion engine renders with. */
  crf: number;
  /**
   * Stills laid under every frame, changing at set times: the launch look's
   * backdrop, when its frames were captured without it. The frames are then
   * composited over it, alpha over the plate, before the one encode.
   */
  underlay?: Underlay;
};

export type Underlay = {
  /** One still per act, drawn at the authoring canvas. */
  stills: string[];
  /** Index into `stills` of the one the film opens on. */
  first: number;
  /** Film time, seconds; each change eases in and out over `seconds`, as power2.inOut does. */
  changes: { to: number; at: number; seconds: number; transition: 'iris' | 'fade' }[];
};

/** GSAP's power2.inOut — a cubic, GSAP counting its powers from linear — the easing the page's backdrop changes run on. */
export function power2InOut(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (2 - 2 * x) ** 3 / 2;
}

/** A stretch of the backdrop: one still held for some frames, or frames of a change written out. */
export type PlateRun = { kind: 'still'; file: string; frames: number } | { kind: 'sequence'; pattern: string; start: number; frames: number };

/**
 * The backdrop as runs of frames, at the frames' size.
 *
 * Frame n shows what the page would at n / fps: the act on screen, or a
 * change part-way through — progress (t − at) / seconds, eased — drawn here
 * from the two stills: a dissolve, or the incoming act inside a circle from
 * the centre whose radius is that share of 75% of the CSS reference length
 * (√(w² + h²) / √2), with a pixel and a half of soft edge. Only the frames
 * of a change are written; a held act is one still the encoder repeats.
 */
export async function plateRuns(underlay: Underlay, size: { width: number; height: number }, fps: number, frames: number, dir: string): Promise<PlateRun[]> {
  await mkdir(dir, { recursive: true });
  const { width: W, height: H } = size;
  const stills = await Promise.all(
    underlay.stills.map(async (file, index) => {
      const sized = path.join(dir, `act-${index}.png`);
      const { data } = await sharp(file).resize({ width: W, height: H, fit: 'fill', kernel: 'lanczos3' }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
      await sharp(data, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 1 }).toFile(sized);
      return { file: sized, pixels: data };
    }),
  );
  const changes = [...underlay.changes].sort((a, b) => a.at - b.at);
  type State = { act: number } | { from: number; to: number; progress: number; transition: Underlay['changes'][number]['transition']; change: number };
  const stateAt = (t: number): State => {
    let act = underlay.first;
    for (const [index, change] of changes.entries()) {
      if (t >= change.at + change.seconds) act = change.to;
      else if (t > change.at) return { from: act, to: change.to, progress: (t - change.at) / change.seconds, transition: change.transition, change: index };
      else break;
    }
    return { act };
  };

  const runs: PlateRun[] = [];
  const reference = (0.75 * Math.hypot(W, H)) / Math.SQRT2;
  for (let n = 0; n < frames; n += 1) {
    const state = stateAt(n / fps);
    if ('act' in state) {
      const last = runs[runs.length - 1];
      if (last?.kind === 'still' && last.file === stills[state.act]!.file) last.frames += 1;
      else runs.push({ kind: 'still', file: stills[state.act]!.file, frames: 1 });
      continue;
    }
    const pattern = path.join(dir, `change-${state.change}-%05d.png`);
    const last = runs[runs.length - 1];
    const run = last?.kind === 'sequence' && last.pattern === pattern ? last : { kind: 'sequence' as const, pattern, start: n, frames: 0 };
    if (run !== last) runs.push(run);
    run.frames += 1;
    const a = stills[state.from]!.pixels;
    const b = stills[state.to]!.pixels;
    const eased = power2InOut(state.progress);
    const out = Buffer.allocUnsafe(W * H * 3);
    if (state.transition === 'fade') {
      for (let i = 0; i < out.length; i += 1) out[i] = Math.round(a[i]! + (b[i]! - a[i]!) * eased);
    } else {
      const radius = eased * reference;
      for (let y = 0; y < H; y += 1) {
        const dy = y + 0.5 - H / 2;
        for (let x = 0; x < W; x += 1) {
          const cover = Math.min(1, Math.max(0, (radius - Math.hypot(x + 0.5 - W / 2, dy)) / 1.5 + 0.5));
          const at = (y * W + x) * 3;
          for (let c = 0; c < 3; c += 1) out[at + c] = Math.round(a[at + c]! + (b[at + c]! - a[at + c]!) * cover);
        }
      }
    }
    await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 1 }).toFile(pattern.replace('%05d', String(n).padStart(5, '0')));
  }
  return runs;
}

/**
 * The filter graph that lays the frames over the backdrop: each run an input —
 * a still decoded once and repeated, or a change's frames — joined end to end,
 * then the frames over it with their alpha, in planar RGB. Labelled [composited].
 */
export function underlayGraph(runs: readonly PlateRun[], fps: number, framesInput: number): { inputs: string[]; graph: string } {
  const inputs: string[] = [];
  const parts: string[] = [];
  runs.forEach((run, index) => {
    if (run.kind === 'still') {
      inputs.push('-i', run.file);
      parts.push(`[${index}:v]format=gbrp,loop=loop=${run.frames - 1}:size=1:start=0,setpts=N/(${fps}*TB)[r${index}]`);
    } else {
      inputs.push('-framerate', String(fps), '-start_number', String(run.start), '-i', run.pattern);
      parts.push(`[${index}:v]format=gbrp,setpts=N/(${fps}*TB)[r${index}]`);
    }
  });
  parts.push(`${runs.map((_, index) => `[r${index}]`).join('')}concat=n=${runs.length}:v=1:a=0,fps=${fps}[plate]`);
  parts.push(`[${framesInput}:v]format=rgba[frames]`);
  parts.push(`[plate][frames]overlay=format=rgb:shortest=1:eof_action=pass[composited]`);
  return { inputs, graph: parts.join(';') };
}

export async function encodeFrames(framesDir: string, outputPath: string, spec: FrameEncodeSpec, signal?: AbortSignal): Promise<{ scaledFrom: { width: number; height: number } | null }> {
  const numbered = (await readdir(framesDir))
    .map((name) => ({ name, match: FRAME_FILE.exec(name) }))
    .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
    .map(({ name, match }) => ({ name, index: Number(match[1]), digits: match[1]!.length }))
    .sort((a, b) => a.index - b.index);
  if (numbered.length !== spec.frames) {
    throw new MediaError(`the renderer wrote ${numbered.length} frames of the film's ${spec.frames}`);
  }
  const first = numbered[0]!;
  const last = numbered[numbered.length - 1]!;
  if (last.index - first.index + 1 !== spec.frames || numbered.some((entry) => entry.digits !== first.digits)) {
    throw new MediaError(`the frames are not one numbered sequence (${first.name} to ${last.name} for ${spec.frames} frames)`);
  }

  const drawn = await pngSize(path.join(framesDir, first.name));
  const scaled = drawn.width !== spec.width || drawn.height !== spec.height;
  const filters = [
    ...(scaled ? [`scale=${spec.width}:${spec.height}:flags=lanczos`] : []),
    'zscale=matrix=709:matrixin=709:range=limited',
  ];
  const framesInput = ['-framerate', String(spec.fps), '-start_number', String(first.index), '-i', path.join(framesDir, `frame_%0${first.digits}d.png`)];
  const runs = spec.underlay ? await plateRuns(spec.underlay, drawn, spec.fps, spec.frames, path.join(path.dirname(framesDir), 'plate-runs')) : null;
  const under = runs ? underlayGraph(runs, spec.fps, runs.length) : null;
  const picture = under
    ? [...under.inputs, ...framesInput, '-filter_complex', `${under.graph};[composited]${filters.join(',')}[out]`, '-map', '[out]']
    : [...framesInput, '-vf', filters.join(',')];
  await ffmpegOrThrow(
    [
      '-y', '-v', 'error',
      ...picture,
      '-an',
      '-c:v', 'libx264',
      '-colorspace:v', 'bt709',
      '-color_primaries:v', 'bt709',
      '-color_trc:v', 'bt709',
      '-color_range', 'tv',
      '-pix_fmt', 'yuv420p',
      '-video_track_timescale', '90000',
      '-crf', String(spec.crf),
      '-movflags', '+faststart',
      outputPath,
    ],
    signal,
    'encode the frames',
  );
  return { scaledFrom: scaled ? drawn : null };
}

const FRAME_FILE = /^frame_(\d+)\.png$/;

/** A PNG's size, from its header: the width and height of the IHDR chunk. */
export async function pngSize(file: string): Promise<{ width: number; height: number }> {
  const handle = await open(file, 'r');
  try {
    const header = Buffer.alloc(24);
    const { bytesRead } = await handle.read(header, 0, 24, 0);
    const signature = header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (bytesRead < 24 || !signature || header.toString('ascii', 12, 16) !== 'IHDR') {
      throw new MediaError(`${path.basename(file)} is not a PNG frame`);
    }
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    await handle.close();
  }
}

export type DeliveryTarget = {
  width: number;
  height: number;
  /** x264 quality, the same the Remotion engine renders with. */
  crf: number;
};

/**
 * The encoded file, checked into the delivery the Remotion engine produces.
 *
 * Silent H.264, 4:2:0, limited-range BT.709, at the requested size. The frames
 * are encoded to exactly that (see encodeFrames), so a film is moved into place
 * untouched; a file that somehow is not is remuxed, or re-encoded, rather than
 * delivered as it is.
 */
export async function deliver(
  ffprobePath: string,
  rawPath: string,
  outputPath: string,
  target: DeliveryTarget,
  signal?: AbortSignal,
): Promise<{ facts: MediaFacts; treatment: 'moved' | 'remuxed' | 'scaled' | 'reencoded' }> {
  const raw = await probeMedia(ffprobePath, rawPath, signal);
  const sized = raw.width === target.width && raw.height === target.height;
  const described = isDeliveryColour(raw);

  let treatment: 'moved' | 'remuxed' | 'scaled' | 'reencoded';
  if (sized && described && raw.audioStreams === 0) {
    await moveFile(rawPath, outputPath);
    treatment = 'moved';
  } else if (sized && described) {
    await ffmpegOrThrow(['-y', '-v', 'error', '-i', rawPath, '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart', outputPath], signal, 'strip the sound');
    treatment = 'remuxed';
  } else {
    await ffmpegOrThrow(
      [
        '-y', '-v', 'error',
        '-i', rawPath,
        '-map', '0:v:0',
        '-an',
        '-vf', `scale=${target.width}:${target.height}:flags=lanczos,format=yuv420p`,
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', String(target.crf),
        '-colorspace', 'bt709',
        '-color_primaries', 'bt709',
        '-color_trc', 'bt709',
        '-color_range', 'tv',
        '-movflags', '+faststart',
        outputPath,
      ],
      signal,
      sized ? 'describe the colour' : `scale to ${target.width}×${target.height}`,
    );
    treatment = sized ? 'reencoded' : 'scaled';
  }
  return { facts: await probeMedia(ffprobePath, outputPath, signal), treatment };
}

export function isDeliveryColour(facts: MediaFacts): boolean {
  return (
    facts.codec === 'h264' &&
    facts.pixelFormat === 'yuv420p' &&
    facts.colorRange === 'tv' &&
    facts.colorSpace === 'bt709' &&
    facts.colorPrimaries === 'bt709' &&
    facts.colorTransfer === 'bt709'
  );
}

/**
 * Everything that must be true of a delivered film, listed rather than thrown
 * one at a time, so a render that is wrong in two ways says both.
 */
export function deliveryProblems(facts: MediaFacts, expected: { width: number; height: number; frames: number }): string[] {
  const problems: string[] = [];
  if (facts.width !== expected.width || facts.height !== expected.height) {
    problems.push(`the file is ${facts.width}×${facts.height}, not ${expected.width}×${expected.height}`);
  }
  if (facts.frames === null) problems.push('the file does not say how many frames it has');
  else if (facts.frames !== expected.frames) problems.push(`the file has ${facts.frames} frames, not ${expected.frames}`);
  if (!isDeliveryColour(facts)) {
    problems.push(
      `the picture is ${facts.codec}/${facts.pixelFormat}/${facts.colorRange}/${facts.colorSpace}, not h264/yuv420p/tv/bt709`,
    );
  }
  if (facts.audioStreams > 0) problems.push('the file carries sound; the film is mixed by Act One');
  return problems;
}

async function ffmpegOrThrow(args: string[], signal: AbortSignal | undefined, what: string): Promise<void> {
  const result = await runFfmpeg(args, { timeoutMs: 30 * 60_000, ...(signal ? { signal } : {}) });
  if (!result.ok) {
    if (signal?.aborted) throw signal.reason ?? new Error('aborted');
    throw new MediaError(`FFmpeg could not ${what}: ${lastLine(result.stderr)}`);
  }
}

/** A rename, or a copy when the two paths are on different filesystems. */
export async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await copyFile(from, to);
    await rm(from, { force: true });
  }
}

function lastLine(text: string): string {
  return text.trim().split('\n').filter(Boolean).pop()?.slice(0, 300) ?? 'no detail';
}
