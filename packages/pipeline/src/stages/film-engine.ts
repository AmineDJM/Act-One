import { renderFilm, type RenderFilmOptions } from '@act-one/motion';
import { renderFilmWithHyperFrames } from '@act-one/motion-hyperframes';
import type { StageContext } from '../context.ts';

/**
 * The engine that draws this film.
 *
 * The operator's setting, unless the environment pins one — a worker set up
 * to compare engines, or one without the other engine's tooling installed.
 */
export function filmEngine(context: StageContext): 'remotion' | 'hyperframes' {
  const pinned = process.env['ACT_ONE_FILM_ENGINE'];
  if (pinned === 'remotion' || pinned === 'hyperframes') return pinned;
  return context.registry.config.render.engine;
}

/**
 * A picture that is not the film — the hero shot's shortlist — drawn by the
 * engine that will draw the film, so what is judged is what will be shown.
 *
 * HyperFrames draws it with its own port of the Remotion components and no
 * agent: what is judged is a framing, which both engines take from the same
 * plan, and a look at candidates is no reason to pay for written scenes.
 */
export async function drawPreview(context: StageContext, options: RenderFilmOptions): Promise<void> {
  if (filmEngine(context) === 'hyperframes') {
    await renderFilmWithHyperFrames({ ...options, log: (line) => console.log(`[preview:hyperframes] ${line}`) });
    return;
  }
  await renderFilm(options);
}
