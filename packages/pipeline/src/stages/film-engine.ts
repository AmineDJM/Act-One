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
 * How many browsers HyperFrames captures a film with, when the host says.
 *
 * HyperFrames sizes this itself, and conservatively — two and a half cores a
 * browser, so any film over a thousand frames gets one browser on a four-core
 * host while the other cores idle. Measured on a four-core host rendering one
 * film at a time, two browsers drew a fifteen-second launch film 1.75 times as
 * fast, indistinguishable frame for frame (one frame in 450 differed by a
 * gradient's dither). The right number depends on the host's cores and on how
 * many films it renders at once, which only the deployment knows; unset or
 * unreadable, HyperFrames decides.
 */
export function captureWorkers(env: Record<string, string | undefined> = process.env): number | undefined {
  const raw = env['ACT_ONE_HYPERFRAMES_WORKERS']?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const workers = Number(raw);
  return workers >= 1 && workers <= 8 ? workers : undefined;
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
    const workers = captureWorkers();
    await renderFilmWithHyperFrames({ ...options, ...(workers ? { concurrency: workers } : {}), log: (line) => console.log(`[preview:hyperframes] ${line}`) });
    return;
  }
  await renderFilm(options);
}
