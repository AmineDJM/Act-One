import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveFfmpeg } from '@act-one/sound';
import { compileFilmIR } from '../compile/index.ts';
import { checkForensicsRuntime, extractExactFrames, FORENSICS_DIR, pythonBinary, runForensics } from '../forensics/run.ts';
import { toSeconds } from '../time.ts';
import { validateFilmIR } from '../validate.ts';

/**
 * The real analyzer, on a film made for the purpose, against what is known
 * to be in it. Needs Python with the analyzer's requirements; where they are
 * missing the suite says so and is skipped rather than failing somewhere a
 * contributor never meant to run it.
 */
const runtime = await checkForensicsRuntime();
if (!runtime.ok) console.warn(`forensics integration skipped: ${runtime.reason}`);

describe.skipIf(!runtime.ok)('the forensic analyzer on the synthetic film', () => {
  it('measures what was put there, to the frame and the millisecond', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'act-one-forensics-'));
    const film = path.join(dir, 'synthetic.mp4');
    const made = spawnSync(pythonBinary(), ['-m', 'actone_forensics.synthetic', film], { cwd: FORENSICS_DIR, env: { ...process.env, PYTHONPATH: FORENSICS_DIR }, encoding: 'utf8' });
    expect(made.status, made.stderr).toBe(0);
    const truth = JSON.parse(made.stdout) as { cut: { lastOutgoing: number; firstIncoming: number }; fadeOut: { first: number; black: number } };

    const stages: string[] = [];
    const report = await runForensics(film, {
      ffmpeg: await resolveFfmpeg(),
      outputPath: path.join(dir, 'report.json'),
      onProgress: (progress) => stages.push(progress.stage),
    });
    expect(stages).toContain('audio');

    expect(report.frames.count).toBe(100);
    expect(report.boundaries.map((b) => [b.kind, b.lastOutgoing, b.firstIncoming])).toEqual([
      ['hard_cut', truth.cut.lastOutgoing, truth.cut.firstIncoming],
      ['fade_out', truth.fadeOut.first - 1, truth.fadeOut.black],
    ]);
    expect(report.text.lines.map((line) => line.text)).toEqual(['LAUNCH DAY', 'NEW FEATURE']);
    const feature = report.text.lines[1]!.refinement;
    expect(feature && feature.measured ? feature.milestones : null).toMatchObject({ firstVisible: 50, settled: 60, exitStart: 80, lastVisible: 89 });

    const { document } = compileFilmIR({ id: 'bench_synthetic_live', title: null, report });
    const onsets = document.audio.events.filter((event) => event.kind === 'onset' || event.kind === 'transient').map((event) => toSeconds(event.at));
    expect(onsets.map((t) => Math.round(t * 100) / 100)).toEqual([0, 1.6, 2]);
    expect(validateFilmIR(document).report.status).toBe('READY');

    // The frames a model is shown are the frames the measurements name.
    const frames = await extractExactFrames(film, 39, 40, { workDir: dir, width: 160 });
    expect(frames.map((frame) => [frame.frame, frame.seconds])).toEqual([[39, 1.56], [40, 1.6]]);
    expect(frames.every((frame) => frame.jpeg[0] === 0xff && frame.jpeg[1] === 0xd8)).toBe(true);
  }, 240_000);
});
