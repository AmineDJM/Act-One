import { describe, expect, it } from 'vitest';
import type { Scene } from '@act-one/core';
import { voiceGapIssues, type SpokenLine } from '../temporal.ts';

/** A narrated film that stops talking in the middle is found, from where its lines were actually spoken. */
const scenes = (specs: { at: number; seconds: number; close?: boolean }[]) =>
  specs.map((spec, index) => ({ id: `scn_${index}`, index, startTime: spec.at, duration: spec.seconds, visualType: spec.close ? 'logo_reveal' : 'kinetic_typography' }) as unknown as Scene);
const line = (startsAt: number, endsAt: number): SpokenLine => ({ sceneId: null, startsAt, endsAt, text: 'words' });

describe('where a narrated film stops talking', () => {
  const film = scenes([{ at: 0, seconds: 6 }, { at: 6, seconds: 6 }, { at: 12, seconds: 6 }, { at: 18, seconds: 6 }, { at: 24, seconds: 3, close: true }]);

  it('finds the rest that runs past four seconds, and places it in the film', () => {
    const issues = voiceGapIssues({ spoken: [line(0.3, 5.5), line(11.9, 17), line(18.2, 23.4)], scenes: film, durationSeconds: 27 });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ check: 'voice_gap', severity: 'soft_fail', timecodeStart: 5.5, timecodeEnd: 11.9, sceneId: 'scn_0' });
  });

  it('leaves the close to the mark, and says nothing of a film nobody speaks in', () => {
    expect(voiceGapIssues({ spoken: [line(0.3, 5.5), line(6, 11.5), line(12, 17.5), line(18, 20.5)], scenes: film, durationSeconds: 27 })).toEqual([]);
    expect(voiceGapIssues({ spoken: [], scenes: film, durationSeconds: 27 })).toEqual([]);
  });

  it('counts a voice that stops long before the close', () => {
    const issues = voiceGapIssues({ spoken: [line(0.3, 5.5), line(6, 11.5)], scenes: film, durationSeconds: 27 });
    expect(issues.map((issue) => [issue.timecodeStart, issue.timecodeEnd])).toEqual([[11.5, 24]]);
  });
});
