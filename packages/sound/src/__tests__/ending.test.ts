import { describe, it, expect } from 'vitest';
import { Scene, Storyboard } from '@act-one/core';
import { directSound, genericEnding, planEnding } from '../index.ts';

/**
 * The ending, which this system had exactly one of.
 *
 * Every film it made stopped the same way: the logo arrived, a large warm
 * note played under it, the music faded. That ending belongs to no film in
 * particular, which is the opposite of what an ending is for. These are the
 * checks that the choice is read out of the cut and then actually enforced on
 * the mix — not recorded as an intention while the sting plays anyway.
 */
const RECT = { x: 0.1, y: 0.1, width: 0.6, height: 0.5 };
const sequence = (framings: unknown[]) => ({
  sourceWidth: 2400, sourceHeight: 1500, background: { r: 255, g: 255, b: 255 }, framings,
});
const framing = (over: Record<string, unknown> = {}) => ({
  role: 'action', move: 'push', from: RECT, to: RECT, seconds: 2, ...over,
});
const pressed = sequence([
  framing({
    layers: [{ role: 'control', motion: 'press', rect: { x: 0.2, y: 0.2, width: 0.1, height: 0.05 } }],
  }),
]);

function scene(index: number, over: Record<string, unknown> = {}): Scene {
  return Scene.parse({
    id: `scn_${index}`, storyboardId: 'sbd_1', index, startTime: index * 3, duration: 3,
    purpose: 'a beat', visualType: 'kinetic_typography', motionRecipe: { name: 'word_reveal' },
    cameraRecipe: {}, onScreenText: ['Something'], narration: '', assetRefs: [],
    generativeNeeds: [], status: 'ready', notes: '', ...over,
  });
}

function board(scenes: Scene[]): Storyboard {
  return Storyboard.parse({
    id: 'sbd_1', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1',
    version: 1, scenes, language: 'en',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

const operated = (index: number) =>
  scene(index, { visualType: 'product_ui', assetRefs: ['ast_1'], onScreenText: [], uiSequence: pressed });

describe('how a film stops', () => {
  it('ends on the product when the film has been operating one', () => {
    const plan = planEnding(board([scene(0), operated(1), operated(2), scene(3)]), {
      loud: false, hasVoiceOver: false,
    });
    expect(plan.strategy).toBe('product_sound_last');
    expect(plan.sting).toBe(false);
    expect(plan.musicOutSeconds).toBeGreaterThan(0);
  });

  it('leaves a held wordless last frame alone', () => {
    const plan = planEnding(
      board([scene(0), scene(1), scene(2, { visualType: 'product_ui', assetRefs: ['ast_1'], onScreenText: [] })]),
      { loud: false, hasVoiceOver: false },
    );
    expect(plan.strategy).toBe('let_it_go_quiet');
  });

  it('stops with the picture when the last thing is a line to read', () => {
    const plan = planEnding(board([scene(0), scene(1), scene(2)]), { loud: false, hasVoiceOver: false });
    expect(plan.strategy).toBe('hard_stop');
    expect(plan.musicOutSeconds).toBe(0);
  });

  it('subtracts rather than adds when the film has been dense', () => {
    const plan = planEnding(board([scene(0), scene(1), scene(2)]), { loud: true, hasVoiceOver: false });
    expect(plan.strategy).toBe('subtract_to_one');
  });

  it('never proposes a sting, whichever ending it picks', () => {
    for (const loud of [true, false]) {
      for (const hasVoiceOver of [true, false]) {
        expect(planEnding(board([scene(0), operated(1), scene(2)]), { loud, hasVoiceOver }).sting).toBe(false);
      }
    }
  });
});

describe('the ending, enforced', () => {
  const behaviour = {
    musicCharacter: 'confident',
    openOnMusic: true,
    uiSoundDensity: 'sparse' as const,
    impactsOnCuts: true,
    /* The creative system asked for one. The cut says it does not belong. */
    endWithSting: true,
  };

  it('drops the requested sting when the plan is to end on the product', () => {
    const storyboard = board([
      scene(0),
      operated(1),
      operated(2),
      scene(3, {
        visualType: 'product_ui', assetRefs: ['ast_1'], onScreenText: [], uiSequence: pressed,
        soundCues: [
          { time: 10.5, type: 'ui_click', intensity: 0.5, durationSeconds: null },
          { time: 11.2, type: 'logo_sting', intensity: 0.8, durationSeconds: null },
          { time: 11.4, type: 'impact', intensity: 0.9, durationSeconds: null },
        ],
      }),
    ]);
    const design = directSound({ storyboard, behaviour });
    expect(design.ending.strategy).toBe('product_sound_last');
    expect(design.cues.map((cue) => cue.type)).toContain('ui_click');
    expect(design.cues.map((cue) => cue.type)).not.toContain('logo_sting');
    expect(design.cues.map((cue) => cue.type)).not.toContain('impact');
    expect(design.notes.join(' ')).toMatch(/logo_sting|product sound last/);
  });

  it('takes the music out before the end when the ending needs the air', () => {
    const storyboard = board([scene(0), operated(1), operated(2), operated(3)]);
    const design = directSound({ storyboard, behaviour });
    expect(design.music).not.toBeNull();
    expect(design.music!.exitAtSeconds).toBeLessThan(12);
    expect(design.music!.exitAtSeconds).toBeGreaterThan(design.music!.enterAtSeconds);
  });

  it('cuts the music rather than fading it on a hard stop', () => {
    const design = directSound({ storyboard: board([scene(0), scene(1), scene(2)]), behaviour });
    expect(design.ending.strategy).toBe('hard_stop');
    expect(design.music?.fadeOutSeconds).toBeLessThan(0.3);
  });

  it('records why the film ends the way it does', () => {
    const design = directSound({ storyboard: board([scene(0), scene(1), scene(2)]), behaviour });
    expect(design.ending.reason.length).toBeGreaterThan(20);
    expect(design.notes.some((note) => note.includes(design.ending.reason))).toBe(true);
  });
});

describe('the ending every automated film has', () => {
  it('names a logo sting under an impact', () => {
    const said = genericEnding(
      [{ type: 'logo_sting', atSeconds: 28 }, { type: 'impact', atSeconds: 28.2 }],
      30,
    );
    expect(said).toMatch(/every automated product film has/);
  });

  it('says nothing about an ending that is not that', () => {
    expect(genericEnding([{ type: 'ui_click', atSeconds: 29 }], 30)).toBeNull();
    // Early in the film, a sting is a different gesture entirely.
    expect(genericEnding([{ type: 'logo_sting', atSeconds: 2 }], 30)).toBeNull();
  });
});
