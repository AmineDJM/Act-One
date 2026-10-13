import { describe, expect, it } from 'vitest';
import type { Scene } from '@act-one/core';
import { ScriptedLlmProvider } from '@act-one/providers';
import { StoryboardEngine } from '../index.ts';
import { narrationWordsFor, voiceCoverage } from '../voice-density.ts';
import { brandFixture, briefFixture, conceptFixture, treatmentFixture, understandingFixture } from './fixtures.ts';

/**
 * A narrated film is heard as its director decided, and never stops talking
 * in the middle by accident.
 */
const LINE = 'Every invoice matched the moment it lands, before anyone asks.'; // about 4.3 s read

function scenes(specs: { seconds: number; line?: string; close?: boolean }[]): Scene[] {
  let at = 0;
  return specs.map((spec, index) => {
    const scene = {
      id: `scn_${index}`, index, startTime: at, duration: spec.seconds, narration: spec.line ?? '',
      visualType: spec.close ? 'logo_reveal' : 'kinetic_typography',
    } as unknown as Scene;
    at += spec.seconds;
    return scene;
  });
}

describe('where the voice is, and where it is missing', () => {
  it('finds the stretch where the voice simply stopped, and names the beats it runs across', () => {
    const film = scenes([{ seconds: 4.5, line: LINE }, { seconds: 3 }, { seconds: 3 }, { seconds: 3 }, { seconds: 4.5, line: LINE }, { seconds: 2.5, close: true }]);
    const heard = voiceCoverage(film, 'key_moments');
    expect(heard.holes).toHaveLength(1);
    expect(heard.holes[0]!.scenes).toEqual([1, 2, 3]);
    expect(heard.holes[0]!.seconds).toBeGreaterThan(8);
    expect(heard.problem).toMatch(/silent for 9\.\d+s .* scenes 2, 3, 4/);
  });

  it('lets a continuous read hold two short rests for the picture, and not a third', () => {
    const two = scenes([{ seconds: 4.5, line: LINE }, { seconds: 2.5 }, { seconds: 4.5, line: LINE }, { seconds: 2.5 }, { seconds: 4.5, line: LINE }, { seconds: 2.5, close: true }]);
    expect(voiceCoverage(two, 'continuous').holes).toEqual([]);
    const three = scenes([{ seconds: 4.5, line: LINE }, { seconds: 2.5 }, { seconds: 4.5, line: LINE }, { seconds: 2.5 }, { seconds: 4.5, line: LINE }, { seconds: 2.5 }, { seconds: 4.5, line: LINE }, { seconds: 2.5, close: true }]);
    expect(voiceCoverage(three, 'continuous').holes).toHaveLength(1);
    // The same rests are a film on its key moments.
    expect(voiceCoverage(three, 'key_moments').holes).toEqual([]);
  });

  it('leaves the close to the mark and the music', () => {
    const film = scenes([{ seconds: 4.5, line: LINE }, { seconds: 4.5, line: LINE }, { seconds: 5, close: true }]);
    const heard = voiceCoverage(film, 'continuous');
    expect(heard.holes).toEqual([]);
    expect(heard.spokenSpanSeconds).toBe(9);
  });

  it('holds a film to the share of it the voice carries', () => {
    const thin = scenes([{ seconds: 4.5, line: 'Matched.' }, { seconds: 1.4 }, { seconds: 4.5, line: 'Done.' }, { seconds: 2.5, close: true }]);
    expect(voiceCoverage(thin, 'continuous').problem).toMatch(/heard in \d+% of the film/);
  });

  it('asks for more words when the voice carries the whole film', () => {
    expect(narrationWordsFor(30, 'continuous', 2.35)).toBeGreaterThan(narrationWordsFor(30, 'key_moments', 2.35));
    expect(narrationWordsFor(30, 'continuous', 2.35)).toBe(56);
  });
});

describe('a narrated storyboard', () => {
  const plan = (lines: string[]) => ({
    scenes: lines.map((narration, index) => ({
      archetypeId: index === 0 ? 'word_slam' : 'metric',
      purpose: `Beat ${index + 1}`,
      onScreenText: [`Line ${index + 1}`],
      narration,
      momentId: null,
      generativeBrief: '',
      claimText: '',
    })),
  });
  const build = (llm: ScriptedLlmProvider) =>
    new StoryboardEngine(llm).build(
      {
        projectId: 'prj_1',
        concept: conceptFixture({ creativeSystem: 'kinetic_product' }),
        treatment: treatmentFixture({ voiceStrategy: 'narrator', voiceDensity: 'continuous' }),
        understanding: understandingFixture({ productMoments: [] }),
        brand: brandFixture(),
        brief: briefFixture({ durationSeconds: 30 }),
        version: 1,
        targetDurationSeconds: 30,
      },
      { organizationId: 'org_1', projectId: 'prj_1' },
    );

  it('is written again, told where its voice stopped, and the fuller read is kept', async () => {
    const sparse = plan([LINE, '', '', '', '', '', LINE]);
    const full = plan([LINE, LINE, LINE, LINE, LINE, LINE, LINE]);
    const llm = new ScriptedLlmProvider([
      { when: /The voice has to be written again/, respond: () => full },
      { respond: () => sparse },
    ]);
    const { storyboard } = await build(llm);

    expect(llm.calls).toHaveLength(2);
    const first = llm.calls[0]!.messages.map((m) => m.content).join('\n');
    expect(first).toMatch(/Voice: continuous/);
    expect(first).toMatch(/Write about \d+ words of narration in all/);
    expect(llm.calls[1]!.messages.map((m) => m.content).join('\n')).toMatch(/The voice is silent for/);
    expect(storyboard.scenes.filter((scene) => scene.narration.length > 0).length).toBeGreaterThan(5);
  });

  it('is written once when its voice already carries the film', async () => {
    const llm = new ScriptedLlmProvider([{ respond: () => plan([LINE, LINE, LINE, LINE, LINE, LINE, LINE]) }]);
    await build(llm);
    expect(llm.calls).toHaveLength(1);
  });
});
