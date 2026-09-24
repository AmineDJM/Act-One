import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderConfig, ProviderRegistry } from '@act-one/providers';
import type { StageContext } from '../context.ts';

const drawn: string[] = [];
vi.mock('@act-one/motion', () => ({ renderFilm: vi.fn(async () => { drawn.push('remotion'); }) }));
vi.mock('@act-one/motion-hyperframes', () => ({
  renderFilmWithHyperFrames: vi.fn(async (options: { author?: unknown }) => {
    drawn.push(options.author === undefined ? 'hyperframes, no agent' : 'hyperframes, with an agent');
  }),
}));

const { drawPreview } = await import('../stages/film-engine.ts');

/**
 * The hero shot's shortlist is drawn by the engine that will draw the film.
 *
 * It used to be drawn by Remotion whatever the platform was set to, so a film
 * made with HyperFrames had its hero chosen from frames another renderer drew.
 * HyperFrames draws it without an agent: a look at candidates is no reason to
 * pay for written scenes.
 */
function contextWith(engine: 'remotion' | 'hyperframes'): StageContext {
  return { registry: new ProviderRegistry({ config: ProviderConfig.parse({ render: { engine } }) }) } as unknown as StageContext;
}

afterEach(() => {
  drawn.length = 0;
});

describe('a preview of the film', () => {
  it('is drawn by the engine the platform draws films with', async () => {
    const options = { props: {}, aspect: '16:9', quality: 'preview', fps: 15, outputPath: '/tmp/x.mp4' } as never;
    await drawPreview(contextWith('remotion'), options);
    await drawPreview(contextWith('hyperframes'), options);
    expect(drawn).toEqual(['remotion', 'hyperframes, no agent']);
  });
});
