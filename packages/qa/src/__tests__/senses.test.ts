import { describe, it, expect } from 'vitest';
import { Scene, Storyboard } from '@act-one/core';
import { listenBlind, senseIssues, watchBoth, watchMuted } from '../senses.ts';

/**
 * The three viewings, checked against films that fail each one.
 *
 * The point of the exercise is that the two channels cover for each other. A
 * film whose argument is entirely in a voiceover looks finished with the sound
 * on and says nothing to the majority of the internet, which watches muted.
 * A film with a music bed at one level sounds finished and is not part of the
 * work. Neither shows up with everything switched on, which is the only way
 * this system has ever looked at a film.
 */
function scene(index: number, over: Record<string, unknown> = {}): Scene {
  return Scene.parse({
    id: `scn_${index}`, storyboardId: 'sbd_1', index, startTime: index * 3, duration: 3,
    purpose: 'a beat', visualType: 'kinetic_typography', motionRecipe: { name: 'word_reveal' },
    cameraRecipe: {}, onScreenText: [], narration: '', assetRefs: [],
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

/** A loudness trace that moves. Bumps at each cut, which is what a mix does. */
function livelyTrace(cuts: number[], seconds: number): { at: number; lufs: number }[] {
  const windows: { at: number; lufs: number }[] = [];
  for (let at = 0; at < seconds; at += 0.1) {
    const near = cuts.some((cut) => Math.abs(at - cut) <= 0.25);
    windows.push({ at: Number(at.toFixed(1)), lufs: near ? -9 : -20 });
  }
  return windows;
}

/** One level, for ever. */
function bedTrace(seconds: number): { at: number; lufs: number }[] {
  return Array.from({ length: Math.round(seconds * 10) }, (_, i) => ({ at: i / 10, lufs: -16 }));
}

describe('listening to it blind', () => {
  const cuts = [3, 6, 9];

  it('passes a mix that has somewhere to go and marks the cuts', () => {
    const blind = listenBlind({
      facts: { audibleShare: 0.98, durationSeconds: 12 },
      windows: livelyTrace(cuts, 12),
      cuts,
      hasNarration: true,
    });
    expect(blind.problems).toEqual([]);
    expect(blind.loudnessRangeLu).toBeGreaterThan(3);
    expect(blind.cutsMarked).toBe(1);
  });

  it('names a bed at one level for the whole film', () => {
    const blind = listenBlind({
      facts: { audibleShare: 1, durationSeconds: 12 },
      windows: bedTrace(12),
      cuts,
      hasNarration: false,
    });
    expect(blind.problems).toContain('one_level_throughout');
    expect(blind.problems).toContain('sound_ignores_the_cut');
    expect(blind.cutsMarked).toBe(0);
  });

  it('calls a master with nothing audible silent, and says nothing else about it', () => {
    const blind = listenBlind({
      facts: { audibleShare: 0, durationSeconds: 12 },
      windows: [],
      cuts,
      hasNarration: false,
    });
    expect(blind.problems).toEqual(['silent']);
  });

  it('reads the trace, not the cue sheet — a cue lost in the mix is a cue nobody hears', () => {
    // Cues were placed on every cut. The mix buried them; the film did not change.
    const blind = listenBlind({
      facts: { audibleShare: 1, durationSeconds: 12 },
      windows: bedTrace(12),
      cuts,
      hasNarration: true,
    });
    expect(blind.cutsMarked).toBe(0);
  });
});

const SEEN = { flatFrames: 2, distinctFrames: 9, sampled: 12 };

describe('watching it muted', () => {
  it('finds the argument that only exists in the voiceover', () => {
    const muted = watchMuted({
      facts: SEEN,
      storyboard: board([
        scene(0, { narration: 'Recruiting teams lose candidates to slow scheduling.' }),
        scene(1, { narration: 'Ashby closes the loop in a single pass.' }),
        scene(2, { onScreenText: ['Ashby'] }),
      ]),
    });
    expect(muted.spokenOnly).toHaveLength(2);
    expect(muted.problems).toContain('meaning_only_in_the_voice');
  });

  it('does not accuse a film that shows what it says', () => {
    const muted = watchMuted({
      facts: SEEN,
      storyboard: board([
        scene(0, {
          narration: 'Recruiting teams lose candidates to slow scheduling.',
          onScreenText: ['Recruiting teams lose candidates to slow scheduling'],
        }),
        scene(1, {
          narration: 'Ashby closes the loop in a single pass.',
          onScreenText: ['Ashby closes the loop in one pass'],
        }),
      ]),
    });
    expect(muted.spokenOnly).toEqual([]);
    expect(muted.problems).not.toContain('meaning_only_in_the_voice');
  });

  it('says when the picture is one picture, whatever the shot list claims', () => {
    const muted = watchMuted({
      facts: { flatFrames: 0, distinctFrames: 2, sampled: 12 },
      storyboard: board([scene(0), scene(1), scene(2), scene(3)]),
    });
    expect(muted.problems).toContain('one_picture_held');
  });

  it('says when watching the film is reading it', () => {
    const muted = watchMuted({
      facts: { flatFrames: 11, distinctFrames: 9, sampled: 12 },
      storyboard: board([scene(0, { onScreenText: ['ATS'] }), scene(1, { onScreenText: ['CRM'] })]),
    });
    expect(muted.problems).toContain('words_are_the_picture');
  });

  it('does not call a film of its product a film of type', () => {
    const product = (i: number) => scene(i, { visualType: 'product_ui', assetRefs: ['ast_1'] });
    const muted = watchMuted({
      facts: { flatFrames: 8, distinctFrames: 9, sampled: 12 },
      storyboard: board([scene(0, { onScreenText: ['Hello'] }), product(1), product(2)]),
    });
    expect(muted.problems).not.toContain('words_are_the_picture');
  });
});

describe('watching it with everything on', () => {
  const product = (i: number, over: Record<string, unknown> = {}) =>
    scene(i, { visualType: 'product_ui', assetRefs: ['ast_1'], ...over });

  it('finds the beat that asks for three things at once', () => {
    const storyboard = board([
      product(0, {
        onScreenText: ['Every candidate, one place, every time'],
        narration: 'Everything about a candidate lives on one screen.',
      }),
      product(1),
    ]);
    const muted = watchMuted({ facts: SEEN, storyboard });
    const blind = listenBlind({
      facts: { audibleShare: 1, durationSeconds: 6 },
      windows: livelyTrace([3], 6),
      cuts: [3],
      hasNarration: true,
    });
    const both = watchBoth(storyboard, muted, blind);
    expect(both.problems).toContain('channels_compete');
    expect(both.competing).toEqual([{ sceneId: 'scn_0', startTime: 0 }]);
  });

  it('lets a beat speak over a screen with nothing written on it', () => {
    const storyboard = board([product(0, { narration: 'Everything on one screen.' }), product(1)]);
    const muted = watchMuted({ facts: SEEN, storyboard });
    const blind = listenBlind({
      facts: { audibleShare: 1, durationSeconds: 6 },
      windows: livelyTrace([3], 6),
      cuts: [3],
      hasNarration: true,
    });
    expect(watchBoth(storyboard, muted, blind).problems).not.toContain('channels_compete');
  });

  it('turns each viewing into a finding with a timecode and a targeted repair', () => {
    const storyboard = board([
      product(0, { onScreenText: ['Every candidate, one place, every time'], narration: 'One screen.' }),
      product(1),
    ]);
    const muted = watchMuted({ facts: SEEN, storyboard });
    const blind = listenBlind({
      facts: { audibleShare: 1, durationSeconds: 6 },
      windows: bedTrace(6),
      cuts: [3],
      hasNarration: true,
    });
    const both = watchBoth(storyboard, muted, blind);
    const findings = senseIssues({ storyboard, muted, blind, both });

    expect(findings.length).toBe(both.problems.length);
    for (const finding of findings) {
      expect(finding.severity).toBe('soft_fail');
      expect(finding.timecodeStart).not.toBeNull();
      expect(finding.repair).toBeTruthy();
      expect(finding.message.length).toBeGreaterThan(20);
    }
    const audio = findings.find((f) => f.message.includes('one level'));
    expect(audio?.repair).toBe('remix_audio');
    const competing = findings.find((f) => f.message.includes('at the same time'));
    expect(competing?.repair).toBe('retime_scene');
  });
});
