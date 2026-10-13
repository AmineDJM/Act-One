import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resequence, type Scene, type Storyboard } from '@act-one/core';
import { ScriptedLlmProvider, type EffectRequest } from '@act-one/providers';
import type { PlacedCue, SoundDesign } from '@act-one/sound';
import type { StageContext } from '../context.ts';
import { SoundBudget, scoreFilm } from '../stages/score.ts';

/**
 * A film's sound spends no more than its budget.
 *
 * Every price is asked before the call it prices: a score the film cannot
 * afford is never written, let alone composed, and the sounds built for its
 * cues stop where the money does — the closing sting first.
 */
function board(seconds: number[]): Storyboard {
  const scenes = seconds.map((duration, index) => ({
    id: `scn_${index}`, storyboardId: 'sbd_1', index, startTime: 0, duration, purpose: `beat ${index}`,
    narration: '', onScreenText: [], visualType: 'kinetic_typography', assetRefs: [], momentIds: [],
    motionRecipe: { name: 'product_zoom', easing: 'out_quint', delay: 0, stagger: 0.05, intensity: 0.6, params: {} },
    cameraRecipe: { move: 'none', fromScale: 1, toScale: 1, fromX: 0, toX: 0, fromY: 0, toY: 0, motionBlur: 0, depthOfField: 0, easing: 'linear' },
    uiSequence: null, soundCues: [], voiceOver: false, generativeNeeds: [], threeDSceneId: null, status: 'draft', claimEvidenceIds: [], notes: '', estimatedCostUsd: 0,
  })) as unknown as Scene[];
  return resequence({ id: 'sbd_1', projectId: 'prj_1', scenes, handovers: {} } as unknown as Storyboard);
}

const cue = (id: string, type: PlacedCue['type'], atSeconds: number): PlacedCue => ({
  id, type, atSeconds, sfxKind: null, storageKey: null, gainDb: -12, durationSeconds: 1,
});

const design = {
  id: 'snd_1',
  storyboardId: 'sbd_1',
  music: null,
  cues: [cue('cue_a', 'whoosh', 1), cue('cue_b', 'ui_click', 10), cue('cue_c', 'whoosh', 20), cue('cue_sting', 'logo_sting', 43)],
} as unknown as SoundDesign;

/** One brief per cue asked for, a second long each. */
function effectsWriter(): ScriptedLlmProvider {
  return new ScriptedLlmProvider([
    {
      when: /One brief per cue/,
      respond: (messages: { content: string }[]) => ({
        effects: [...messages.map((m) => m.content).join('\n').matchAll(/- (cue_\w+):/g)].map((match) => ({
          cueId: match[1],
          brief: `The sound of ${match[1]}, short and clean.`,
          seconds: 1,
          influence: 0.5,
          loop: false,
        })),
      }),
    },
  ]);
}

async function setup(options: { musicPerMinuteUsd: number; effectUsd: number }) {
  const llm = effectsWriter();
  const composed: unknown[] = [];
  const built: EffectRequest[] = [];
  const composer = {
    name: 'composer', kind: 'speech',
    compose: async (plan: unknown) => {
      composed.push(plan);
      throw new Error('a test that composes has gone wrong');
    },
    musicPriceUsd: (seconds: number) => (seconds / 60) * options.musicPerMinuteUsd,
  };
  const effects = {
    name: 'effects', kind: 'speech',
    effect: async (request: EffectRequest) => {
      built.push(request);
      return { audio: new Uint8Array([1, 2, 3]), contentType: 'audio/mpeg', seconds: 1, costUsd: options.effectUsd, model: 'test' };
    },
    effectPriceUsd: () => options.effectUsd,
  };
  const context = {
    organizationId: 'org_test',
    project: { id: 'prj_1' },
    registry: { composerOrNull: () => composer, soundEffectsOrNull: () => effects, llm: () => llm },
    activity: async () => undefined,
  } as unknown as StageContext;
  const workDir = await mkdtemp(path.join(tmpdir(), 'act-one-sound-budget-'));
  return { context, llm, composed, built, workDir };
}

const params = (workDir: string, budgetUsd: number) => ({
  storyboard: board([15, 15, 15]),
  design: structuredClone(design),
  brand: null,
  understanding: null,
  creativeSystem: 'kinetic_product' as const,
  workDir,
  aspect: '16:9',
  hasVoiceOver: true,
  budgetUsd,
});

describe('SoundBudget', () => {
  it('allows what still fits and nothing past it', () => {
    const budget = new SoundBudget(1);
    expect(budget.allows(1)).toBe(true);
    budget.spend(0.75);
    expect(budget.left).toBeCloseTo(0.25, 9);
    expect(budget.allows(0.25)).toBe(true);
    expect(budget.allows(0.26)).toBe(false);
    expect(budget.spent).toBeCloseTo(0.75, 9);
  });

  it('never allows a price that is not a price', () => {
    const budget = new SoundBudget(5);
    expect(budget.allows(Number.NaN)).toBe(false);
    expect(budget.allows(-1)).toBe(false);
    expect(budget.allows(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('scoreFilm within the film’s sound budget', () => {
  it('neither writes nor composes a score the film cannot afford, and builds sounds until the money runs out, the sting first', async () => {
    // A 45-second score at $2.50 a minute is $1.875; $0.30 is left after the voice.
    const { context, llm, composed, built, workDir } = await setup({ musicPerMinuteUsd: 2.5, effectUsd: 0.12 });
    const scored = await scoreFilm(context, params(workDir, 0.3));

    expect(composed).toHaveLength(0);
    // The only model call is the one that writes the sounds: no score was written to be thrown away.
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.options).toMatchObject({ schemaName: 'sound_effects' });
    expect(scored.musicPath).toBeNull();
    expect(built).toHaveLength(2);
    expect(Object.keys(scored.effectPaths)).toEqual(['cue_sting', 'cue_a']);
    expect(scored.costUsd).toBeCloseTo(0.24, 9);
    expect(scored.notes.join(' ')).toMatch(/library was played/);
    expect(scored.notes.join(' ')).toMatch(/2 sounds were left to the library/);
  });

  it('asks for nothing at all when nothing is left', async () => {
    const { context, llm, composed, built, workDir } = await setup({ musicPerMinuteUsd: 2.5, effectUsd: 0.02 });
    const scored = await scoreFilm(context, params(workDir, 0));

    expect(composed).toHaveLength(0);
    expect(built).toHaveLength(0);
    expect(llm.calls).toHaveLength(0);
    expect(scored.costUsd).toBe(0);
    expect(scored.effectPaths).toEqual({});
  });
});
