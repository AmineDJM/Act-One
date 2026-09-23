import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProviderError, type GeminiFile, type GeminiGenerateResult, type GeminiVideoProvider, type SpeechRecognizer } from '@act-one/providers';
import { analyzeFilm, EXPECTED_PASSES, type AnalyzeOptions, type AnalyzeStage, type Checkpoints } from '../analyze.ts';
import { blankAnswers, syntheticReport } from './helpers.ts';

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

async function analyze(checkpoints: Checkpoints, filmSha256: string | undefined, over: Partial<AnalyzeOptions> = {}) {
  const stages: [AnalyzeStage, string, string | undefined][] = [];
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
    onStage: (stage, state, detail) => {
      stages.push([stage, state, detail]);
    },
    ...over,
  });
  return { run, stages };
}

/** A video model that answers every pass blank, and fails the integration while `integratorDown` says so. */
function scriptedGemini(state: { integratorDown: boolean; calls: string[] }): GeminiVideoProvider {
  const file: GeminiFile = { name: 'files/synthetic', uri: 'https://example.invalid/files/synthetic', mimeType: 'video/mp4', expiresAt: null };
  const answers = blankAnswers() as Record<string, unknown>;
  return {
    fileStatus: async () => file,
    uploadVideo: async () => file,
    generate: async (request: { label: string }): Promise<GeminiGenerateResult> => {
      const id = request.label.replace(/^film-ir\./, '');
      state.calls.push(id);
      if (id === 'integrator' && state.integratorDown) throw new ProviderError('gemini', 'HTTP 502 Bad Gateway: upstream request failed', { status: 502, retryable: false });
      return { json: answers[id], text: '', model: 'scripted', usage: { promptTokens: 1, outputTokens: 1, videoTokens: 0, totalTokens: 2 }, costUsd: 0.001, finishReason: 'STOP' };
    },
  } as unknown as GeminiVideoProvider;
}

/** A video model whose account has run dry: the upload is refused, for good. */
function brokeGemini(): GeminiVideoProvider {
  return {
    fileStatus: async () => null,
    uploadVideo: async () => {
      throw new ProviderError('gemini', 'HTTP 402 Payment Required: Your prepayment credits are depleted.', { status: 402, retryable: false });
    },
  } as unknown as GeminiVideoProvider;
}

describe('analyzeFilm checkpoints', () => {
  const report = syntheticReport();

  it('resumes from the measurements of these same bytes', async () => {
    const checkpoints = memoryCheckpoints({ forensics: report });
    const { run, stages } = await analyze(checkpoints, report.input.sha256);
    const result = await run;
    expect(stages[0]!.slice(0, 2)).toEqual(['forensics', 'skipped']);
    expect(result.validation.status).toBe('READY');
    expect(result.document.source?.sha256).toBe(report.input.sha256);
    expect(checkpoints.saved.get('filmir')).toMatchObject({ schema: 'actone.film-ir' });
  });

  it('measures again rather than describe another film under this one\'s name', async () => {
    const checkpoints = memoryCheckpoints({ forensics: report, transcript: { text: 'another film', words: [] } });
    const { run, stages } = await analyze(checkpoints, 'f'.repeat(64));
    // The analyzer is asked to read the film itself, which here does not exist.
    await expect(run).rejects.toThrow();
    expect(stages[0]!.slice(0, 2)).toEqual(['forensics', 'started']);
    expect(stages.some(([stage, state]) => stage === 'forensics' && state === 'skipped')).toBe(false);
  });

  it('trusts its own checkpoints when the caller does not know the bytes', async () => {
    const { run, stages } = await analyze(memoryCheckpoints({ forensics: report }), undefined);
    await run;
    expect(stages[0]!.slice(0, 2)).toEqual(['forensics', 'skipped']);
  });
});

describe('analyzeFilm when a listener or the model is unavailable', () => {
  const report = syntheticReport();

  it('keeps the measurements, and calls the document partial, when the model cannot be reached', async () => {
    const { run, stages } = await analyze(memoryCheckpoints({ forensics: report }), report.input.sha256, { gemini: brokeGemini() });
    const result = await run;
    expect(stages).toContainEqual(['upload', 'failed', expect.stringMatching(/402/)]);
    expect(stages).toContainEqual(['passes', 'failed', 'Not run: the film could not be uploaded to the video model.']);
    expect(result.validation.status).toBe('PARTIAL');
    const byId = Object.fromEntries(result.validation.checks.map((check) => [check.id, check]));
    expect(byId['stages']).toMatchObject({ status: 'warn', count: 1, examples: [expect.stringMatching(/^upload: .*402/)] });
    expect(byId['passes']).toMatchObject({ status: 'warn', count: EXPECTED_PASSES.length });
    // Everything measured is still there.
    expect(result.document.structure.shots.length).toBeGreaterThan(0);
    expect(result.passes).toEqual({});
  });

  it('calls the document partial when the recogniser did not run, rather than silent', async () => {
    const recognizer = { transcribe: async () => { throw new Error('vendor down'); } } as unknown as SpeechRecognizer;
    const { run, stages } = await analyze(memoryCheckpoints({ forensics: report }), report.input.sha256, { recognizer });
    const result = await run;
    expect(stages.some(([stage, state]) => stage === 'transcription' && state === 'failed')).toBe(true);
    expect(result.validation.status).toBe('PARTIAL');
    expect(result.validation.checks.find((check) => check.id === 'stages')!.examples[0]).toMatch(/^transcription: /);
    // What was said is unknown, never "nothing"; whether anything was is only the voice detector's estimate.
    expect(result.document.narration.transcript.evidenceType).toBe('UNKNOWN');
    expect(result.document.narration.words).toEqual([]);
    expect(result.document.narration.present).toMatchObject({ evidenceType: 'ESTIMATED', method: 'audio.voice' });
  });

  it('reports the passes failed when one did, and a retry asks only for that one', async () => {
    const checkpoints = memoryCheckpoints({ forensics: report });
    const state = { integratorDown: true, calls: [] as string[] };
    const first = await analyze(checkpoints, report.input.sha256, { gemini: scriptedGemini(state) });
    const partial = await first.run;
    expect(first.stages).toContainEqual(['passes', 'failed', expect.stringMatching(/^1 of 11 passes failed; retrying runs only these: integrator \(\[gemini\] HTTP 502/)]);
    expect(partial.validation.status).toBe('PARTIAL');
    expect(state.calls).toHaveLength(EXPECTED_PASSES.length);

    // The operator's retry: the same run, its checkpoints, the model back.
    state.integratorDown = false;
    state.calls = [];
    const retry = await analyze(checkpoints, report.input.sha256, { gemini: scriptedGemini(state) });
    const complete = await retry.run;
    expect(state.calls).toEqual(['integrator']);
    expect(retry.stages).toContainEqual(['passes', 'completed', undefined]);
    expect(Object.values(complete.passes).every((record) => record.status === 'completed')).toBe(true);
  });

  it('stops altogether when it is cancelled, rather than compile what it has', async () => {
    const controller = new AbortController();
    controller.abort();
    const { run } = await analyze(memoryCheckpoints({ forensics: report }), report.input.sha256, {
      gemini: brokeGemini(),
      context: { organizationId: 'org_platform', projectId: null, signal: controller.signal },
    });
    await expect(run).rejects.toThrow(/402/);
  });
});
