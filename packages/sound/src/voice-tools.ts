import { runFfmpeg } from './ffmpeg.ts';
import { measureLoudness } from './master.ts';

/**
 * The voice, measured and assembled.
 *
 * Every recording is listened to by a meter before it is listened to by a
 * person: how long it runs, where it peaks, where it falls silent. The same
 * numbers decide whether a take is kept, how much to trim off its ends, and
 * how far to level it against the passages around it.
 */
export type VoiceAnalysis = {
  durationSeconds: number;
  /** Sample peak, dBFS. */
  peakDb: number;
  meanDb: number;
  integratedLufs: number | null;
  headSilenceSeconds: number;
  tailSilenceSeconds: number;
  /** Silences inside the read. */
  silences: { start: number; end: number }[];
};

export type AnalyseOptions = {
  /** Below this the signal counts as silence. */
  silenceDb?: number;
  /** A silence shorter than this is a breath, not a pause. */
  minSilenceSeconds?: number;
  /** Also meter integrated loudness: a second pass, for levelling. */
  loudness?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function analyseVoice(source: string, options: AnalyseOptions = {}): Promise<VoiceAnalysis | null> {
  const silenceDb = options.silenceDb ?? -45;
  const minSilence = options.minSilenceSeconds ?? 0.6;
  const run = { ...(options.signal ? { signal: options.signal } : {}), timeoutMs: options.timeoutMs ?? 120_000 };
  // Detected fine, so the dead air at either end is measured to the tenth;
  // inside the read, anything shorter than a pause is a breath and is kept.
  const result = await runFfmpeg(
    ['-hide_banner', '-nostats', '-i', source, '-af', `volumedetect,silencedetect=n=${silenceDb}dB:d=0.1`, '-f', 'null', '-'],
    run,
  );
  if (!result.ok) return null;

  const duration = parseDuration(result.stderr);
  const peak = Number(result.stderr.match(/max_volume:\s*(-?[\d.]+|-inf)\s*dB/)?.[1] ?? NaN);
  const mean = Number(result.stderr.match(/mean_volume:\s*(-?[\d.]+|-inf)\s*dB/)?.[1] ?? NaN);
  if (!Number.isFinite(duration)) return null;

  const starts = [...result.stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...result.stderr.matchAll(/silence_end:\s*(-?[\d.]+)/g)].map((m) => Number(m[1]));
  const spans = starts.map((start, i) => ({ start: Math.max(0, start), end: ends[i] ?? duration }));

  let head = 0;
  let tail = 0;
  const inner: { start: number; end: number }[] = [];
  for (const span of spans) {
    if (span.start <= 0.05) head = Math.max(head, span.end);
    else if (span.end >= duration - 0.05) tail = Math.max(tail, duration - span.start);
    else if (span.end - span.start >= minSilence) inner.push(span);
  }
  // A recording that is all silence is head silence, not a read.
  if (spans.length === 1 && spans[0]!.start <= 0.05 && spans[0]!.end >= duration - 0.05) {
    head = duration;
    tail = 0;
  }

  const integrated = options.loudness ? await measureLoudness(source, { timeoutMs: run.timeoutMs }) : null;
  return {
    durationSeconds: duration,
    peakDb: Number.isFinite(peak) ? peak : -Infinity,
    meanDb: Number.isFinite(mean) ? mean : -Infinity,
    integratedLufs: integrated && Number.isFinite(integrated.integratedLufs) ? integrated.integratedLufs : null,
    headSilenceSeconds: round(head),
    tailSilenceSeconds: round(tail),
    silences: inner.map((span) => ({ start: round(span.start), end: round(span.end) })),
  };
}

function parseDuration(stderr: string): number {
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return NaN;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** A linear gain, so the passages of one piece sit at one level before the master. */
export async function levelVoice(
  source: string,
  target: string,
  gainDb: number,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<void> {
  const result = await runFfmpeg(
    ['-y', '-hide_banner', '-loglevel', 'error', '-i', source, '-af', `volume=${gainDb.toFixed(2)}dB`, '-c:a', 'pcm_s16le', target],
    { ...(options.signal ? { signal: options.signal } : {}), timeoutMs: options.timeoutMs ?? 120_000 },
  );
  if (!result.ok) throw new Error(`Levelling ${source} failed: ${result.stderr.slice(-400)}`);
}

export type StitchSegment = {
  path: string;
  /** Silence to leave after this segment. */
  gapAfterSeconds: number;
  gainDb?: number;
  /** Trim these many seconds off the head and the tail: dead air the engine left. */
  trimHeadSeconds?: number;
  trimTailSeconds?: number;
  durationSeconds: number;
};

/**
 * Joins the passages of one piece into one recording: each trimmed of its
 * dead air, levelled, and followed by the pause the script asks for. Mono,
 * at the mix rate; the master makes it a deliverable.
 */
export async function stitchVoice(params: {
  segments: StitchSegment[];
  target: string;
  /** Silence before the first word and after the last. */
  leadInSeconds?: number;
  leadOutSeconds?: number;
  sampleRate?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ durationSeconds: number }> {
  if (params.segments.length === 0) throw new Error('Nothing to stitch.');
  const rate = params.sampleRate ?? 48_000;
  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error'];
  const parts: string[] = [];
  const labels: string[] = [];
  let total = params.leadInSeconds ?? 0;

  params.segments.forEach((segment, i) => {
    args.push('-i', segment.path);
    const head = Math.max(0, segment.trimHeadSeconds ?? 0);
    const tail = Math.max(0, segment.trimTailSeconds ?? 0);
    const end = Math.max(head + 0.05, segment.durationSeconds - tail);
    const gap = Math.max(0, segment.gapAfterSeconds);
    const chain = [
      `atrim=start=${head.toFixed(3)}:end=${end.toFixed(3)}`,
      'asetpts=PTS-STARTPTS',
      `aresample=${rate}`,
      'aformat=channel_layouts=mono',
      ...(segment.gainDb ? [`volume=${segment.gainDb.toFixed(2)}dB`] : []),
      ...(i === 0 && (params.leadInSeconds ?? 0) > 0 ? [`adelay=${Math.round((params.leadInSeconds ?? 0) * 1000)}:all=1`] : []),
      ...(gap > 0 ? [`apad=pad_dur=${gap.toFixed(3)}`] : []),
    ];
    parts.push(`[${i}:a]${chain.join(',')}[s${i}]`);
    labels.push(`[s${i}]`);
    total += end - head + gap;
  });
  const leadOut = params.leadOutSeconds ?? 0;
  parts.push(
    `${labels.join('')}concat=n=${params.segments.length}:v=0:a=1` +
      (leadOut > 0 ? `,apad=pad_dur=${leadOut.toFixed(3)}` : '') +
      '[out]',
  );
  total += leadOut;
  args.push('-filter_complex', parts.join(';'), '-map', '[out]', '-ar', String(rate), '-ac', '1', '-c:a', 'pcm_s16le', params.target);

  const result = await runFfmpeg(args, {
    ...(params.signal ? { signal: params.signal } : {}),
    timeoutMs: params.timeoutMs ?? 10 * 60_000,
  });
  if (!result.ok) throw new Error(`Stitching failed: ${result.stderr.slice(-400)}`);
  return { durationSeconds: round(total) };
}

/** A WAV's playing time, from its header, without spawning anything. */
export function wavDurationSeconds(wav: Uint8Array): number | null {
  if (wav.byteLength < 44) return null;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  if (String.fromCharCode(wav[0]!, wav[1]!, wav[2]!, wav[3]!) !== 'RIFF') return null;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= wav.byteLength) {
    const id = String.fromCharCode(wav[offset]!, wav[offset + 1]!, wav[offset + 2]!, wav[offset + 3]!);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') byteRate = view.getUint32(offset + 16, true);
    if (id === 'data') return byteRate > 0 ? Math.round((size / byteRate) * 1000) / 1000 : null;
    offset += 8 + size + (size % 2);
  }
  return null;
}
