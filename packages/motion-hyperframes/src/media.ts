import { spawn } from 'node:child_process';
import { copyFile, rename, rm } from 'node:fs/promises';
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
export async function normaliseClip(input: string, output: string, fps: number, signal?: AbortSignal): Promise<void> {
  const gop = String(Math.max(1, Math.round(fps)));
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
      '-movflags', '+faststart',
      output,
    ],
    { timeoutMs: 10 * 60_000, ...(signal ? { signal } : {}) },
  );
  if (!result.ok) {
    throw new MediaError(`the clip could not be prepared for rendering: ${lastLine(result.stderr)}`);
  }
}

export type DeliveryTarget = {
  width: number;
  height: number;
  /** x264 quality, the same the Remotion engine renders with. */
  crf: number;
};

/**
 * The rendered file, made into the delivery the Remotion engine produces.
 *
 * Silent H.264, 4:2:0, limited-range BT.709, at the requested size. HyperFrames
 * already writes exactly that at the size it drew, so most films are moved into
 * place untouched; only a size it could not draw (a preview, 4K at 4:5) is
 * scaled, and only a file that somehow carries sound or another colour
 * description is re-encoded to the delivery.
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
