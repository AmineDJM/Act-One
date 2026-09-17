import { AppError } from '@act-one/core';
import type { StageContext } from '../context.ts';
import { runRender } from './render.ts';

/**
 * Animatic stage.
 *
 * The storyboard as a moving thing, before anybody pays for the film. Reading a
 * list of scene durations and feeling a cut are different activities, and the
 * second one is the whole reason films are storyboarded on paper and then shot
 * on a schedule rather than shot once and argued about afterwards.
 *
 * Deliberately the same renderer at preview quality rather than a separate
 * cheap path. An animatic drawn by different code would be reassuring about a
 * film it is not actually describing, which is worse than no animatic: the
 * point is to see this cut, at this pace, with this type on this canvas.
 *
 * It does not touch the project's stage or its latest render — a preview is not
 * a deliverable, and a customer who previews twice has not made two films.
 */
export async function runAnimatic(
  context: StageContext,
  options: { storyboardId?: string } = {},
): Promise<{ renderId: string; assetId: string; issues: number }> {
  const storyboardId = options.storyboardId ?? context.project.activeStoryboardId;
  if (!storyboardId) throw new AppError('conflict', 'There is no storyboard to preview yet.');

  const result = await runRender(context, {
    storyboardId,
    quality: 'preview',
    // No vision QA and no repair loop: this is for timing, and a preview that
    // takes as long as the film defeats the purpose of having one.
    skipVisionQa: true,
    maxRepairAttempts: 0,
    kind: 'animatic',
  });

  // The issue count travels with the result so the operational log records a
  // preview of a storyboard that still has problems in it, rather than a clean
  // line that says a preview was made.
  return { renderId: result.renderId, assetId: result.assetId, issues: result.issues.length };
}
