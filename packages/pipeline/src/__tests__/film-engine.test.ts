import { afterEach, describe, expect, it } from 'vitest';
import { ProviderConfig, ProviderRegistry } from '@act-one/providers';
import type { StageContext } from '../context.ts';
import { RenderEngine, Scene, Storyboard } from '@act-one/core';
import { SCENE_CONTRACT_VERSION, type HyperFramesRenderResult } from '@act-one/motion-hyperframes';
import { agentWritesScenes, deliveryIssues, filmEngine, hyperframesEngineRecord, remotionEngineRecord, withMotionCues } from '../stages/render.ts';
import { captureWorkers } from '../stages/film-engine.ts';

/**
 * Which engine draws the film.
 *
 * The operator's setting decides, with Remotion as the default so nothing
 * changes for a platform that never touched it; the environment can pin a
 * worker to one engine, and a value it does not recognise pins nothing.
 */
function contextWith(engine?: 'remotion' | 'hyperframes'): StageContext {
  const config = ProviderConfig.parse(engine ? { render: { engine } } : {});
  return { registry: new ProviderRegistry({ config }) } as unknown as StageContext;
}

afterEach(() => {
  delete process.env['ACT_ONE_FILM_ENGINE'];
});

describe('the film engine', () => {
  it('is HyperFrames in the launch look unless the operator chose otherwise', () => {
    expect(filmEngine(contextWith())).toBe('hyperframes');
    expect(ProviderConfig.parse({}).render).toEqual({ engine: 'hyperframes', sceneAuthor: 'engine', look: 'launch', signatureScenes: 0, signatureBudgetUsd: 0.25, interfaceDrawings: 2, interfaceDrawingBudgetUsd: 0.05, soundBudgetUsd: 3, sceneAuthorTier: 'deep', maxSceneAttempts: 3 });
    expect(ProviderConfig.parse({ render: { look: 'launch' } }).render.look).toBe('launch');
    expect(ProviderConfig.safeParse({ render: { look: 'loud' } }).success).toBe(false);
    expect(filmEngine(contextWith('hyperframes'))).toBe('hyperframes');
  });

  it('can be pinned by the worker’s environment', () => {
    process.env['ACT_ONE_FILM_ENGINE'] = 'hyperframes';
    expect(filmEngine(contextWith('remotion'))).toBe('hyperframes');
    process.env['ACT_ONE_FILM_ENGINE'] = 'remotion';
    expect(filmEngine(contextWith('hyperframes'))).toBe('remotion');
  });

  it('ignores a pin it does not recognise', () => {
    process.env['ACT_ONE_FILM_ENGINE'] = 'blender';
    expect(filmEngine(contextWith('hyperframes'))).toBe('hyperframes');
  });

  it('refuses an engine the platform does not have', () => {
    expect(ProviderConfig.safeParse({ render: { engine: 'after-effects' } }).success).toBe(false);
    expect(ProviderConfig.safeParse({ render: { maxSceneAttempts: 9 } }).success).toBe(false);
    expect(ProviderConfig.safeParse({ render: { sceneAuthor: 'intern' } }).success).toBe(false);
  });
});

/**
 * Who is paid to write HyperFrames scenes.
 *
 * Nobody, unless the operator asks: the engine's port of the Remotion
 * components came out closer to the Remotion render than any model did, for
 * nothing. And never for an animatic, which a review may send back.
 */
describe('a model writing HyperFrames scenes', () => {
  it('is not paid for unless the operator asked for it', () => {
    const settings = ProviderConfig.parse({ render: { engine: 'hyperframes' } }).render;
    for (const kind of ['film', 'cut', 'animatic', 'localised'] as const) expect(agentWritesScenes(settings, kind), kind).toBe(false);
  });

  it('is never paid for an animatic', () => {
    const settings = ProviderConfig.parse({ render: { engine: 'hyperframes', sceneAuthor: 'agent' } }).render;
    expect(agentWritesScenes(settings, 'film')).toBe(true);
    expect(agentWritesScenes(settings, 'animatic')).toBe(false);
  });

  it('is asked, in the launch look, for its signature moments only while they have a budget', () => {
    expect(ProviderConfig.parse({ render: { engine: 'hyperframes', look: 'launch' } }).render).toMatchObject({ signatureScenes: 0, signatureBudgetUsd: 0.25 });
    expect(agentWritesScenes(ProviderConfig.parse({ render: { engine: 'hyperframes', look: 'launch' } }).render, 'film')).toBe(false);
    const launch = ProviderConfig.parse({ render: { engine: 'hyperframes', look: 'launch', signatureScenes: 2 } }).render;
    expect(agentWritesScenes(launch, 'film')).toBe(true);
    expect(agentWritesScenes(launch, 'animatic')).toBe(false);
    expect(agentWritesScenes({ ...launch, signatureBudgetUsd: 0 }, 'film')).toBe(false);
    expect(agentWritesScenes({ ...launch, signatureScenes: 0 }, 'film')).toBe(false);
  });
});

describe('what a render records about its engine', () => {
  it('names the Remotion release for a film Remotion drew', () => {
    const record = remotionEngineRecord();
    expect(RenderEngine.parse(record)).toEqual(record);
    expect(record).toMatchObject({ name: 'remotion', sceneContract: null, scenes: [], costUsd: 0 });
    expect(record.version).toMatch(/^Remotion \d+\.\d+\.\d+/);
  });

  it('says who drew each scene of a HyperFrames film, and what was noted without being refused', () => {
    const finding = (severity: 'error' | 'warning' | 'info', message: string) => ({
      section: 'contrast' as const, code: 'contrast_aa_failure', severity, message, frameIds: ['scene-02'],
      file: null, selector: null, against: null, atSeconds: null, fixHint: null,
    });
    const record = hyperframesEngineRecord({
      engineVersion: '1.2.0',
      cliVersion: '0.8.70',
      costUsd: 0.123456,
      scenes: [
        { frameId: 'scene-01', sceneId: 'scn_0', source: 'agent', attempts: 1, costUsd: 0.05, findings: [], fallbackReason: null },
        { frameId: 'scene-02', sceneId: 'scn_1', source: 'fallback', attempts: 3, costUsd: 0.07, findings: [], fallbackReason: 'x'.repeat(900) },
      ],
      checks: { passes: 2, rewritten: ['scene-02'], findings: [finding('warning', 'Drawn as the Remotion engine draws it: 4.3:1'), finding('info', 'noted')] },
    } as unknown as HyperFramesRenderResult);
    expect(RenderEngine.parse(record)).toEqual(record);
    expect(record).toMatchObject({ name: 'hyperframes', version: '1.2.0 (HyperFrames 0.8.70)', sceneContract: SCENE_CONTRACT_VERSION, costUsd: 0.1235 });
    expect(record.scenes.map((scene) => scene.source)).toEqual(['agent', 'fallback']);
    expect(record.scenes[1]!.fallbackReason).toHaveLength(400);
    expect(record.warnings).toEqual(['contrast/contrast_aa_failure (scene-02): Drawn as the Remotion engine draws it: 4.3:1']);
  });

  it('names the launch look in the engine’s version, and nothing for the classic one', () => {
    const result = { engineVersion: '1.4.0', cliVersion: '0.8.70', costUsd: 0, scenes: [], checks: { passes: 1, rewritten: [], findings: [] } };
    expect(hyperframesEngineRecord({ ...result, look: 'launch' } as unknown as HyperFramesRenderResult).version).toBe('1.4.0 launch (HyperFrames 0.8.70)');
    expect(hyperframesEngineRecord({ ...result, look: 'classic' } as unknown as HyperFramesRenderResult).version).toBe('1.4.0 (HyperFrames 0.8.70)');
  });
});

describe('the sounds a film’s motion asks for', () => {
  const scene = (index: number, soundCues: unknown[] = []) =>
    Scene.parse({
      id: `scn_${index}`, storyboardId: 'sbd_test', index, startTime: index * 2, duration: 2, purpose: 'beat', visualType: 'kinetic_typography',
      motionRecipe: { name: 'kinetic_headline' }, cameraRecipe: {}, onScreenText: ['Apps.'], narration: '', assetRefs: [], generativeNeeds: [],
      status: 'ready', notes: '', soundCues,
    });
  const board = Storyboard.parse({
    id: 'sbd_test', projectId: 'prj_test', conceptId: 'cpt_test', treatmentId: 'trt_test', version: 1, handovers: {}, language: 'en',
    scenes: [scene(0), scene(1, [{ time: 2.5, type: 'riser' }])],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });

  it('are offered to the beats that asked for no sound, and never replace a beat’s own', () => {
    const sounded = withMotionCues(board, [
      { sceneId: 'scn_0', time: 0.06, type: 'whoosh', intensity: 0.45 },
      { sceneId: 'scn_1', time: 2.2, type: 'impact', intensity: 0.35 },
    ]);
    expect(sounded.scenes[0]!.soundCues).toEqual([{ time: 0.06, type: 'whoosh', assetId: null, intensity: 0.45, durationSeconds: null }]);
    expect(sounded.scenes[1]!.soundCues).toEqual(board.scenes[1]!.soundCues);
    // The storyboard the rest of the stage reads is untouched.
    expect(board.scenes[0]!.soundCues).toEqual([]);
    expect(withMotionCues(board, [])).toBe(board);
  });

  it('still reach a narrated beat, whose only cue is the music ducking under its voice, and keep how long a sound lasts', () => {
    const narrated = { ...board, scenes: [scene(0, [{ time: 0, type: 'music_duck', intensity: 0.4, durationSeconds: 2 }]), board.scenes[1]!] };
    const sounded = withMotionCues(narrated, [{ sceneId: 'scn_0', time: 1.1, type: 'typing', intensity: 0.45, durationSeconds: 0.35 }]);
    expect(sounded.scenes[0]!.soundCues.map((cue) => [cue.type, cue.durationSeconds])).toEqual([
      ['music_duck', 2],
      ['typing', 0.35],
    ]);
  });
});

describe('how many browsers capture a HyperFrames film', () => {
  it('is the host’s to say, and HyperFrames’ own sizing when it says nothing readable', () => {
    expect(captureWorkers({ ACT_ONE_HYPERFRAMES_WORKERS: '2' })).toBe(2);
    expect(captureWorkers({ ACT_ONE_HYPERFRAMES_WORKERS: ' 4 ' })).toBe(4);
    for (const unreadable of [undefined, '', '0', '9', '1.5', '-2', 'two', '2; rm -rf /']) {
      expect(captureWorkers({ ACT_ONE_HYPERFRAMES_WORKERS: unreadable }), String(unreadable)).toBeUndefined();
    }
  });
});

describe('what the delivered film measures', () => {
  it('is a finding when the shipped file is over the true-peak ceiling or out of loudness tolerance', () => {
    const issues = deliveryIssues({ integratedLufs: -14.2, truePeakDb: -0.3, lra: 4 }, -16);
    expect(issues.map((issue) => [issue.check, issue.severity])).toEqual([['audio_clipping', 'soft_fail'], ['audio_loudness', 'soft_fail']]);
    expect(issues[0]!.message).toContain('-0.3 dBTP');
    expect(issues[1]!.message).toContain('-14.2 LUFS');
  });

  it('is nothing when it lands where it was mastered to, or when nothing could be measured', () => {
    expect(deliveryIssues({ integratedLufs: -16.2, truePeakDb: -1.4, lra: 4 }, -16)).toEqual([]);
    // Silence measures -70 and is the silent-master check's to judge, not this one's.
    expect(deliveryIssues({ integratedLufs: -70, truePeakDb: Number.NEGATIVE_INFINITY, lra: 0 }, -16)).toEqual([]);
    expect(deliveryIssues(null, -16)).toEqual([]);
  });
});
