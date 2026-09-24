import { afterEach, describe, expect, it } from 'vitest';
import { ProviderConfig, ProviderRegistry } from '@act-one/providers';
import type { StageContext } from '../context.ts';
import { RenderEngine } from '@act-one/core';
import { SCENE_CONTRACT_VERSION, type HyperFramesRenderResult } from '@act-one/motion-hyperframes';
import { filmEngine, hyperframesEngineRecord, remotionEngineRecord } from '../stages/render.ts';

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
  it('is Remotion unless the operator chose otherwise', () => {
    expect(filmEngine(contextWith())).toBe('remotion');
    expect(ProviderConfig.parse({}).render).toEqual({ engine: 'remotion', sceneAuthorTier: 'deep', maxSceneAttempts: 3 });
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
});
