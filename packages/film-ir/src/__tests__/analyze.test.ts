import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeFilm, type AnalyzeStage, type Checkpoints } from '../analyze.ts';
import { syntheticReport } from './helpers.ts';

/**
 * Resuming from checkpoints, and refusing checkpoints of another film.
 *
 * The synthetic film's real report stands in as the forensics checkpoint, so
 * the stages after it run for real without the analyzer; no model and no
 * recogniser, so nothing leaves the machine.
 */
function memoryCheckpoints(initial: Record<string, unknown>): Checkpoints & { saved: Map<string, unknown> } {
  const saved = new Map(Object.entries(initial));
  return {
    saved,
    get: async <T>(name: string) => (saved.get(name) as T | undefined) ?? null,
    put: async (name, value) => {
      saved.set(name, value);
    },
  };
}

async function analyze(checkpoints: Checkpoints, filmSha256: string | undefined) {
  const stages: [AnalyzeStage, string][] = [];
  const workDir = await mkdtemp(path.join(tmpdir(), 'act-one-analyze-'));
  const run = analyzeFilm({
    id: 'bench_synthetic',
    title: 'synthetic',
    // Never opened when the checkpoint is used; opened, and missing, when it is not.
    filmPath: path.join(workDir, 'no-such-film.mp4'),
    workDir,
    ffmpeg: 'ffmpeg',
    checkpoints,
    gemini: null,
    recognizer: null,
    context: { organizationId: 'org_platform', projectId: null },
    ...(filmSha256 ? { filmSha256 } : {}),
    onStage: (stage, state) => {
      stages.push([stage, state]);
    },
  });
  return { run, stages };
}

describe('analyzeFilm checkpoints', () => {
  const report = syntheticReport();

  it('resumes from the measurements of these same bytes', async () => {
    const checkpoints = memoryCheckpoints({ forensics: report });
    const { run, stages } = await analyze(checkpoints, report.input.sha256);
    const result = await run;
    expect(stages[0]).toEqual(['forensics', 'skipped']);
    expect(result.validation.status).toBe('READY');
    expect(result.document.source?.sha256).toBe(report.input.sha256);
    expect(checkpoints.saved.get('filmir')).toMatchObject({ schema: 'actone.film-ir' });
  });

  it('measures again rather than describe another film under this one\'s name', async () => {
    const checkpoints = memoryCheckpoints({ forensics: report, transcript: { text: 'another film', words: [] } });
    const { run, stages } = await analyze(checkpoints, 'f'.repeat(64));
    // The analyzer is asked to read the film itself, which here does not exist.
    await expect(run).rejects.toThrow();
    expect(stages[0]).toEqual(['forensics', 'started']);
    expect(stages).not.toContainEqual(['forensics', 'skipped']);
  });

  it('trusts its own checkpoints when the caller does not know the bytes', async () => {
    const { run, stages } = await analyze(memoryCheckpoints({ forensics: report }), undefined);
    await run;
    expect(stages[0]).toEqual(['forensics', 'skipped']);
  });
});
