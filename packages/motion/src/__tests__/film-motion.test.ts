import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CAMERA_DRIVEN_RECIPES, movesThroughout, type MotionRecipeName } from '@act-one/core';

/**
 * Which recipes the camera actually reaches.
 *
 * `cameraRecipe` is on every scene and the renderer hands it to seven of the
 * twenty-odd recipes; on the rest it is stored and ignored. QA has to know
 * which, because a repair that gives recovered seconds to a shot it believes
 * is moving — on the strength of a field nothing reads for that shot —
 * manufactures the held frame it was trying to remove.
 *
 * A real render found that, with a `slow_push` on a typographic card that
 * never moved a pixel. The list lives in core because both sides need it;
 * this reads the renderer's own switch and checks they still agree, because
 * a list copied from a switch is a list that drifts from it.
 */
const FILM = path.resolve(import.meta.dirname, '../Film.tsx');

/** The recipes whose body is handed `camera={scene.cameraRecipe}`, read off the switch. */
async function cameraDrivenInRenderer(): Promise<Set<string>> {
  const source = await readFile(FILM, 'utf8');
  const body = source.slice(source.indexOf('const SceneRenderer'));
  const cases = [...body.matchAll(/case '([a-z_0-9]+)':/g)].map((match) => ({
    name: match[1]!,
    start: match.index!,
    end: match.index! + match[0].length,
  }));

  const driven = new Set<string>();
  let pending: string[] = [];
  for (const [index, entry] of cases.entries()) {
    const stop = cases[index + 1]?.start ?? body.length;
    const chunk = body.slice(entry.end, stop);
    pending.push(entry.name);
    // An empty body means this label falls through to the next one, so the
    // labels accumulate until a body actually appears.
    if (chunk.trim().length > 0) {
      if (chunk.includes('camera={scene.cameraRecipe}')) for (const name of pending) driven.add(name);
      pending = [];
    }
  }
  return driven;
}

describe('the camera reaches exactly the recipes core says it does', () => {
  it('reads the renderer and finds recipes at all', async () => {
    const driven = await cameraDrivenInRenderer();
    expect(driven.size).toBeGreaterThan(3);
  });

  it('agrees with CAMERA_DRIVEN_RECIPES, in both directions', async () => {
    const driven = await cameraDrivenInRenderer();
    expect([...driven].sort()).toEqual([...CAMERA_DRIVEN_RECIPES].sort());
  });
});

describe('what counts as moving for a whole shot', () => {
  const scene = (name: MotionRecipeName, move: 'static' | 'slow_push' = 'static') => ({
    motionRecipe: {
      name, easing: 'out_quint' as const, delay: 0, stagger: 0.06, intensity: 0.6, params: {},
    },
    cameraRecipe: {
      move, fromScale: 1, toScale: move === 'static' ? 1 : 1.12, fromX: 0, toX: 0, fromY: 0, toY: 0,
      motionBlur: 0.1, depthOfField: 0, easing: 'in_out_quart' as const,
    },
  });

  it('counts real footage, which plays whatever the camera does', () => {
    expect(movesThroughout(scene('footage'))).toBe(true);
  });

  it('counts a camera-driven composition whose camera is travelling', () => {
    expect(movesThroughout(scene('photo_hold', 'slow_push'))).toBe(true);
    expect(movesThroughout(scene('photo_hold'))).toBe(false);
  });

  it('does not count a push on a typographic card, because nothing reads it', () => {
    // The exact case from the render: a slow push stored on a held card,
    // ignored by the renderer, and a still frame on screen for eight seconds.
    expect(movesThroughout(scene('hold', 'slow_push'))).toBe(false);
    expect(movesThroughout(scene('word_reveal', 'slow_push'))).toBe(false);
    expect(movesThroughout(scene('quote_hold', 'slow_push'))).toBe(false);
  });
});
