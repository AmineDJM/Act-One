import { spawn } from 'node:child_process';
import { copyFile, open, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
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
};

/**
 * The film, encoded from its frames the way the Remotion engine encodes its own.
 *
 * The renderer writes every frame as a lossless PNG, and this passes FFmpeg the
 * arguments the Remotion engine's renderer passes it: x264 at the same rate
 * factor, 4:2:0, and zscale turning the RGB into limited-range BT.709. The two
 * engines' pictures take one road from the browser to the file, and the colours
 * are the colours the file says they are. The CLI's own MP4 path pipes JPEG
 * frames, whose YCbCr is BT.601, changes only their range and labels them
 * BT.709, so every colour came out shifted: the brand green #39d98a as
 * (41, 194, 134).
 */
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
  await ffmpegOrThrow(
    [
      '-y', '-v', 'error',
      '-framerate', String(spec.fps),
      '-start_number', String(first.index),
      '-i', path.join(framesDir, `frame_%0${first.digits}d.png`),
      '-an',
      '-c:v', 'libx264',
      '-colorspace:v', 'bt709',
      '-color_primaries:v', 'bt709',
      '-color_trc:v', 'bt709',
      '-color_range', 'tv',
      '-vf', filters.join(','),
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
