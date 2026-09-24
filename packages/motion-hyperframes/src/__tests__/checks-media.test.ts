import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runFfmpeg } from '@act-one/sound';
import { blocking, CheckOutputError, parseCheckOutput, parseLintOutput, scenesNamed } from '../checks.ts';
import { assumedColourMatrix, deliver, deliveryProblems, factsFrom, isDeliveryColour, normaliseClip, probeMedia, type MediaFacts } from '../media.ts';

const projectDir = '/work/project';
const frameIds = new Set(['scene-01', 'scene-02', 'scene-03']);

describe('HyperFrames’ verdict, read', () => {
  it('traces a lint finding to the scene file it names', () => {
    const lint = JSON.stringify({
      ok: false,
      findings: [
        { code: 'gsap_infinite_repeat', severity: 'error', message: 'GSAP tween uses repeat: -1', file: '/work/project/compositions/scene-02.html', line: 8 },
        { code: 'missing_local_asset', severity: 'error', message: '<video> element references local file(s) not found in the project: missing.mp4.' },
      ],
    });
    const report = parseLintOutput(lint, projectDir, frameIds);
    expect(report.ok).toBe(false);
    expect(report.findings.map((finding) => [finding.code, finding.frameIds, finding.file])).toEqual([
      ['gsap_infinite_repeat', ['scene-02'], 'compositions/scene-02.html'],
      ['missing_local_asset', [], null],
    ]);
  });

  it('reads every section of a check, past the log lines printed before it', () => {
    const check = [
      '[BrowserManager] Browser launched',
      JSON.stringify({
        ok: false,
        lint: { ok: true, findings: [] },
        runtime: { ok: false, findings: [{ code: 'console_error', severity: 'error', message: '[act-one] scene-03 failed: x is not defined' }] },
        layout: { ok: true, findings: [{ code: 'content_overlap', severity: 'info', time: 8.75, selector: '#scene-01-title', sourceFile: 'compositions/scene-01.html', message: 'Two text blocks overlap.' }] },
        motion: { ok: true, findings: [] },
        contrast: { ok: true, findings: [{ code: 'contrast_aa_failure', severity: 'warning', selector: 'div.scene-02-caption', message: 'Contrast 3.1:1' }] },
      }, null, 2),
    ].join('\n');
    const report = parseCheckOutput(check, projectDir, frameIds);
    expect(report.findings.map((finding) => `${finding.section}/${finding.code}/${finding.severity}@${finding.frameIds.join('+')}`)).toEqual([
      'runtime/console_error/error@scene-03',
      'layout/content_overlap/info@scene-01',
      'contrast/contrast_aa_failure/warning@scene-02',
    ]);
    expect(report.findings[1]!.atSeconds).toBe(8.75);
    expect(blocking(report.findings).map((finding) => finding.code)).toEqual(['console_error']);
  });

  it('says a scene’s words crossing the watermark or a caption, without blocking the film on it', () => {
    const check = JSON.stringify({
      ok: false,
      layout: {
        ok: false,
        findings: [
          { code: 'content_overlap', severity: 'error', selector: '#scene-02-line-1', containerSelector: '#ao-watermark > svg:nth-of-type(1) > text:nth-of-type(1)', sourceFile: 'compositions/scene-02.html', message: 'Two text blocks overlap and may render unreadable.' },
          { code: 'content_overlap', severity: 'error', selector: '#scene-02-line-1', containerSelector: '#scene-02-caption', sourceFile: 'compositions/scene-02.html', message: 'Two text blocks overlap and may render unreadable.' },
        ],
      },
    });
    const report = parseCheckOutput(check, projectDir, frameIds);
    expect(report.findings.map((finding) => finding.severity)).toEqual(['warning', 'error']);
    expect(report.findings[0]!.message).toMatch(/^Crosses the film's own overlay \(#ao-watermark/);
    expect(report.findings[0]!.against).toContain('#ao-watermark');
  });

  it('never reads the engine’s own host elements as a scene', () => {
    expect(scenesNamed({ selector: '#host-scene-02', message: 'overflows' }, 'index.html', frameIds)).toEqual([]);
    expect(scenesNamed({ selector: '#scene-02-title' }, 'index.html', frameIds)).toEqual(['scene-02']);
    expect(scenesNamed({ message: 'between #scene-01-a and #scene-03-b' }, null, frameIds)).toEqual(['scene-01', 'scene-03']);
    expect(scenesNamed({ selector: '#scene-09-x' }, null, frameIds)).toEqual([]);
  });

  it('says so when HyperFrames printed no report', () => {
    expect(() => parseCheckOutput('Error: browser not found', projectDir, frameIds)).toThrow(CheckOutputError);
  });
});

describe('the delivery', () => {
  const good: MediaFacts = {
    width: 1920, height: 1080, codec: 'h264', pixelFormat: 'yuv420p', colorSpace: 'bt709', colorPrimaries: 'bt709',
    colorTransfer: 'bt709', colorRange: 'tv', frames: 570, durationSeconds: 19, audioStreams: 0,
  };

  it('is exactly what the Remotion engine delivers', () => {
    expect(isDeliveryColour(good)).toBe(true);
    expect(deliveryProblems(good, { width: 1920, height: 1080, frames: 570 })).toEqual([]);
  });

  it('lists everything wrong with a file, not just the first thing', () => {
    const problems = deliveryProblems(
      { ...good, width: 1280, height: 720, frames: 571, pixelFormat: 'yuvj420p', colorRange: 'pc', audioStreams: 1 },
      { width: 1920, height: 1080, frames: 570 },
    );
    expect(problems).toHaveLength(4);
    expect(problems.join(' ')).toMatch(/1280×720.*571 frames.*yuvj420p.*sound/);
  });

  it('is read from ffprobe’s own report', () => {
    expect(factsFrom({
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, pix_fmt: 'yuv420p', color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'bt709', color_range: 'tv', nb_frames: '570' },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
      format: { duration: '19.000000' },
    })).toEqual({ ...good, audioStreams: 1 });
  });
});

describe('a clip that does not name its colour matrix', () => {
  it('is read the way the Remotion engine reads it: BT.709 from 720 lines up, BT.601 below', () => {
    for (const colorSpace of [null, '', 'unknown', 'unspecified']) {
      expect(assumedColourMatrix({ colorSpace, height: 720 }), String(colorSpace)).toBe('bt709');
      expect(assumedColourMatrix({ colorSpace, height: 718 }), String(colorSpace)).toBe('smpte170m');
    }
    expect(assumedColourMatrix({ colorSpace: null, height: 2160 })).toBe('bt709');
    // A vertical clip goes by its height too: 540×960 is read as BT.709.
    expect(assumedColourMatrix({ colorSpace: null, height: 960 })).toBe('bt709');
    expect(assumedColourMatrix({ colorSpace: null, height: 360 })).toBe('smpte170m');
    expect(assumedColourMatrix({ colorSpace: null, height: null })).toBe('smpte170m');
  });

  it('keeps its own when it names one', () => {
    expect(assumedColourMatrix({ colorSpace: 'bt709', height: 360 })).toBeNull();
    expect(assumedColourMatrix({ colorSpace: 'bt470bg', height: 1080 })).toBeNull();
    expect(assumedColourMatrix({ colorSpace: 'bt2020nc', height: 2160 })).toBeNull();
  });
});

const ffprobe = [path.resolve('node_modules/@remotion/compositor-linux-x64-gnu/ffprobe'), process.env.ACT_ONE_FFPROBE_PATH]
  .find((candidate): candidate is string => Boolean(candidate) && existsSync(candidate!));

describe.skipIf(!ffprobe)('a clip, made seekable', () => {
  it('has a keyframe every second, the film’s rate, even dimensions and no sound', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-hf-media-'));
    const source = path.join(dir, 'source.mp4');
    // Odd size, 25 fps, a long keyframe interval and a sound track: everything the renderer should not have to handle.
    const made = await runFfmpeg([
      '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=321x241:rate=25:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:v', 'libx264', '-g', '250', '-pix_fmt', 'yuv420p', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:a', 'aac', '-shortest', source,
    ], { timeoutMs: 60_000 });
    expect(made.ok).toBe(true);
    const output = path.join(dir, 'seekable.mp4');
    await normaliseClip(source, output, 30);
    const facts = await probeMedia(ffprobe!, output);
    expect(facts).toMatchObject({ codec: 'h264', pixelFormat: 'yuv420p', audioStreams: 0, width: 322, height: 242, frames: 90 });
    const keyframes = spawnSync(ffprobe!, ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', output], { encoding: 'utf8' })
      .stdout.trim().split('\n').map((line) => Number.parseFloat(line));
    expect(keyframes).toEqual([0, 1, 2]);
  });

  it('is labelled with the matrix it will be read with, and a clip that names its own keeps it', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-hf-matrix-'));
    const clip = async (name: string, size: string, tags: string[]) => {
      const file = path.join(dir, name);
      const made = await runFfmpeg(['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=30:duration=1`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ...tags, file], { timeoutMs: 60_000 });
      expect(made.ok).toBe(true);
      return file;
    };
    const untaggedHd = await clip('hd.mp4', '1280x720', []);
    const untaggedSd = await clip('sd.mp4', '640x360', []);
    const taggedPal = await clip('pal.mp4', '1280x720', ['-colorspace', 'bt470bg']);

    for (const [source, expected] of [[untaggedHd, 'bt709'], [untaggedSd, 'smpte170m'], [taggedPal, 'bt470bg']] as const) {
      const facts = await probeMedia(ffprobe!, source);
      const output = `${source}.seekable.mp4`;
      await normaliseClip(source, output, 30, { describeMatrixAs: assumedColourMatrix(facts) });
      expect((await probeMedia(ffprobe!, output)).colorSpace, path.basename(source)).toBe(expected);
    }
  });

  it('is moved into place untouched when it is already the delivery, and scaled when it is not', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'act-one-hf-deliver-'));
    const raw = path.join(dir, 'raw.mp4');
    await runFfmpeg([
      '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=#07080d:size=640x360:rate=30:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', raw,
    ], { timeoutMs: 60_000 });
    const moved = await deliver(ffprobe!, raw, path.join(dir, 'moved.mp4'), { width: 640, height: 360, crf: 18 });
    expect(moved.treatment).toBe('moved');
    expect(existsSync(raw)).toBe(false);
    const scaled = await deliver(ffprobe!, path.join(dir, 'moved.mp4'), path.join(dir, 'preview.mp4'), { width: 320, height: 180, crf: 18 });
    expect(scaled.treatment).toBe('scaled');
    expect(deliveryProblems(scaled.facts, { width: 320, height: 180, frames: 30 })).toEqual([]);
  });
});
