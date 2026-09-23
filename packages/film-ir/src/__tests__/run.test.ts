import { describe, expect, it } from 'vitest';
import type { GeminiFile, GeminiGenerateResult, GeminiVideoProvider } from '@act-one/providers';
import { PASSES } from '../gemini/passes.ts';
import { runGeminiPasses, type PassRecord } from '../gemini/run.ts';
import { blankAnswers, syntheticDocument } from './helpers.ts';

/**
 * The passes, run against a scripted model: what is asked, what happens when
 * an answer does not validate or a call fails, and that nothing finished is
 * ever asked for twice.
 */
type Request = Parameters<GeminiVideoProvider['generate']>[0];

const FILE: GeminiFile = { name: 'files/test', uri: 'https://example.invalid/files/test', mimeType: 'video/mp4', expiresAt: null };
const { document } = syntheticDocument();
const context = { organizationId: 'org_platform', projectId: null };

function scripted(answer: (request: Request, calls: Request[]) => unknown | Error) {
  const calls: Request[] = [];
  const provider = {
    async generate(request: Request): Promise<GeminiGenerateResult> {
      calls.push(request);
      const result = answer(request, calls);
      if (result instanceof Error) throw result;
      return { json: result, text: JSON.stringify(result), model: 'scripted', usage: { promptTokens: 100, outputTokens: 10, videoTokens: 50, totalTokens: 110 }, costUsd: 0.001, finishReason: 'STOP' };
    },
  };
  return { provider: provider as unknown as GeminiVideoProvider, calls };
}

const passOf = (request: Request) => request.label.replace(/^film-ir\./, '').replace(/\.inspect$/, '');

describe('runGeminiPasses', () => {
  it('asks each pass once, at its own sampling, then integrates without the film', async () => {
    const answers = blankAnswers();
    const { provider, calls } = scripted((request) => answers[passOf(request) as keyof typeof answers]);
    const recorded: string[] = [];
    const records = await runGeminiPasses({ provider, file: FILE, document, context, onRecord: async (record) => void recorded.push(record.id) });

    expect(recorded).toEqual([...PASSES.map((pass) => pass.id), 'integrator']);
    expect(Object.values(records).every((record) => record.status === 'completed')).toBe(true);
    const camera = calls.find((call) => call.label === 'film-ir.p04_camera_motion')!;
    expect(camera.parts[0]).toMatchObject({ kind: 'video', fps: 4 });
    expect(camera.mediaResolution).toBe('low');
    // The measurements travel with every question, by id.
    expect((camera.parts[1] as { text: string }).text).toContain('text.0002');
    const integrator = calls.find((call) => call.label === 'film-ir.integrator')!;
    expect(integrator.parts.every((part) => part.kind === 'text')).toBe(true);
    // No array bound reaches the service: it refuses schemas whose bounds multiply.
    expect(JSON.stringify(integrator.schema)).not.toContain('maxItems');
    expect(JSON.stringify(integrator.schema)).toContain('At most 20 items.');
  });

  it('resumes: a completed pass is never asked again, a failed one is', async () => {
    const answers = blankAnswers();
    const done = (id: PassRecord['id'], status: PassRecord['status']): PassRecord => ({
      id, title: id, status, model: 'scripted', output: status === 'completed' ? answers[id] : null, error: status === 'failed' ? 'HTTP 502' : null,
      costUsd: 0, tokens: 0, startedAt: '', finishedAt: '', inspections: [], fps: 1,
    });
    const { provider, calls } = scripted((request) => answers[passOf(request) as keyof typeof answers]);
    await runGeminiPasses({ provider, file: FILE, document, context, existing: { p01_holistic: done('p01_holistic', 'completed'), p02_narrative: done('p02_narrative', 'failed') } });
    const asked = calls.map(passOf);
    expect(asked).not.toContain('p01_holistic');
    expect(asked).toContain('p02_narrative');
  });

  it('sends an answer that does not validate back once, with the reason', async () => {
    const answers = blankAnswers();
    const { provider, calls } = scripted((request, all) => {
      const pass = passOf(request);
      if (pass === 'p02_narrative' && all.filter((call) => passOf(call) === 'p02_narrative').length === 1) {
        return { ...answers.p02_narrative, beats: [{ startSeconds: -1 }] };
      }
      return answers[pass as keyof typeof answers];
    });
    const records = await runGeminiPasses({ provider, file: FILE, document, context, only: ['p02_narrative'] });
    const narrative = calls.filter((call) => passOf(call) === 'p02_narrative');
    expect(narrative).toHaveLength(2);
    expect((narrative[1]!.parts[1] as { text: string }).text).toMatch(/YOUR PREVIOUS ANSWER WAS REJECTED: beats\.0\./);
    expect(records['p02_narrative']).toMatchObject({ status: 'completed', costUsd: 0.002 });
  });

  it('fails a pass that cannot answer, keeps what it cost, and carries on with the rest', async () => {
    const answers = blankAnswers();
    const { provider } = scripted((request) => {
      const pass = passOf(request);
      if (pass === 'p03_composition') return { nonsense: true };
      if (pass === 'p05_audio') return new Error('[gemini] HTTP 400 Bad Request: invalid argument');
      return answers[pass as keyof typeof answers];
    });
    const records = await runGeminiPasses({ provider, file: FILE, document, context });
    expect(records['p03_composition']).toMatchObject({ status: 'failed', output: null, costUsd: 0.002, error: expect.stringMatching(/did not validate twice/) });
    expect(records['p05_audio']).toMatchObject({ status: 'failed', error: expect.stringMatching(/HTTP 400/) });
    expect(records['p06_sync']!.status).toBe('completed');
    expect(records['integrator']!.status).toBe('completed');
  });

  it('looks at a window the pass asks for, at the film\'s own frames, and no more than a second and a half of it', async () => {
    const answers = blankAnswers();
    const extracted: [number, number][] = [];
    const { provider, calls } = scripted((request) => {
      const pass = passOf(request);
      if (request.label.endsWith('.inspect')) return { answer: 'the headline fades up linearly', observations: [{ frame: 50, observation: 'first faint trace' }], confidence: 0.6 };
      if (pass === 'p04_camera_motion') return { ...answers.p04_camera_motion, inspect: [{ startSeconds: 2.0, endSeconds: 5.0, question: 'how does the headline arrive?' }] };
      return answers[pass as keyof typeof answers];
    });
    const records = await runGeminiPasses({
      provider,
      file: FILE,
      document,
      context,
      only: ['p04_camera_motion'],
      extractFrames: async (first, last) => {
        extracted.push([first, last]);
        return Array.from({ length: last - first + 1 }, (_, i) => ({ frame: first + i, seconds: (first + i) / 25, jpeg: new Uint8Array([0xff, 0xd8, 0xff]) }));
      },
    });
    // 2.0 s is frame 50; the window is cut to 1.5 s, which ends on frame 88.
    expect(extracted).toEqual([[50, 88]]);
    const inspection = calls.find((call) => call.label === 'film-ir.p04_camera_motion.inspect')!;
    const images = inspection.parts.filter((part) => part.kind === 'image');
    expect(images.length).toBeLessThanOrEqual(36);
    expect(inspection.parts[0]).toEqual({ kind: 'text', text: 'frame 50 at 2.0000 s' });
    expect(records['p04_camera_motion']!.inspections[0]).toMatchObject({ firstFrame: 50, lastFrame: 88, output: { answer: 'the headline fades up linearly' } });
  });
});
