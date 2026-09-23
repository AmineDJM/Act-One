import type { Page } from 'playwright-core';
import { CLEAN_CAPTURE_CSS } from '@act-one/providers';
import type { Deadline } from '../deadline.ts';

/**
 * Brings a page to the state a visitor sees once it has finished arriving.
 *
 * Marketing pages are built to animate in: sections fade up as they scroll
 * into view, counters count, images load lazily. Measured on arrival, half the
 * page is at opacity zero and the other half is mid-transition. So the page is
 * walked top to bottom to trigger every reveal, every running animation is
 * taken to its end (or paused when it has none), the fonts are awaited, and
 * the furniture nobody wants in a film is hidden.
 */
export async function settlePage(page: Page, deadline: Deadline): Promise<string[]> {
  const warnings: string[] = [];
  const attempt = async (label: string, work: () => Promise<unknown>, stepMs: number): Promise<void> => {
    try {
      await deadline.within(work(), stepMs, `settle:${label}`);
    } catch (error) {
      if (deadline.signal.aborted) throw error;
      warnings.push(`Settling the page (${label}) did not finish: ${(error as Error).message.slice(0, 160)}`);
    }
  };

  await attempt('network', () => page.waitForLoadState('networkidle', { timeout: 6_000 }), 7_000);
  await attempt('scroll', () => page.evaluate(walkThePage, { stepRatio: 0.8, maxSteps: 14, pauseMs: 140 }), 12_000);
  await attempt('fonts', () => page.evaluate(awaitFonts, 5_000), 6_000);
  await attempt('images', () => page.evaluate(awaitImages, 5_000), 6_000);
  await attempt('animations', () => page.evaluate(finishAnimations), 3_000);
  await attempt('furniture', () => page.addStyleTag({ content: CLEAN_CAPTURE_CSS }), 3_000);
  await attempt('rest', () => page.waitForTimeout(250), 1_000);
  return warnings;
}

/* In-page functions below: serialised by Playwright, so self-contained. */

export async function walkThePage(options: { stepRatio: number; maxSteps: number; pauseMs: number }): Promise<void> {
  const step = Math.max(200, Math.round(window.innerHeight * options.stepRatio));
  const height = Math.max(document.body?.scrollHeight ?? 0, document.documentElement.scrollHeight);
  const steps = Math.min(options.maxSteps, Math.ceil(height / step));
  for (let index = 1; index <= steps; index += 1) {
    window.scrollTo(0, index * step);
    await new Promise((resolve) => setTimeout(resolve, options.pauseMs));
  }
  window.scrollTo(0, 0);
  await new Promise((resolve) => setTimeout(resolve, options.pauseMs));
}

export async function awaitFonts(timeoutMs: number): Promise<boolean> {
  if (!document.fonts) return true;
  return Promise.race([
    document.fonts.ready.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

export async function awaitImages(timeoutMs: number): Promise<number> {
  const pending = Array.from(document.images)
    .filter((image) => !image.complete && image.getBoundingClientRect().top < window.innerHeight * 2)
    .slice(0, 80)
    .map((image) => image.decode().catch(() => undefined));
  await Promise.race([Promise.all(pending), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  return pending.length;
}

/**
 * Takes every finite animation and transition to its end state, and pauses
 * the infinite ones where they are. A reveal frozen halfway is the most
 * common reason a capture shows a section at forty percent opacity.
 */
export function finishAnimations(): { finished: number; paused: number } {
  let finished = 0;
  let paused = 0;
  if (typeof document.getAnimations !== 'function') return { finished, paused };
  for (const animation of document.getAnimations()) {
    try {
      const end = animation.effect?.getComputedTiming().endTime;
      if (typeof end === 'number' && Number.isFinite(end)) {
        animation.finish();
        finished += 1;
      } else {
        animation.pause();
        paused += 1;
      }
    } catch {
      try {
        animation.pause();
        paused += 1;
      } catch {
        // An animation that refuses both is left alone.
      }
    }
  }
  return { finished, paused };
}
