import { afterEach, describe, expect, it } from 'vitest';
import { ProviderConfig, ProviderRegistry } from '@act-one/providers';
import type { StageContext } from '../context.ts';
import { filmEngine } from '../stages/render.ts';

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
