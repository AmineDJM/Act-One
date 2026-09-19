import { describe, it, expect } from 'vitest';
import {
  ATTENTION_RESET_SECONDS,
  PAYOFF_BY,
  SHORT_STRUCTURE,
  emphasisIn,
  shortBeatAt,
  standardsFor,
  type Concept,
  type Scene,
} from '@act-one/core';
import { ScriptedLlmProvider } from '@act-one/providers';
import {
  StoryboardEngine,
  canOpenAShort,
  heldTooLong,
  opensOnAPatternInterrupt,
  payoffAt,
  resets,
  retentionCurve,
  shortRhythm,
  withAttentionReset,
  type TimingConstraint,
} from '../index.ts';
import { brandFixture, briefFixture, conceptFixture, treatmentFixture, understandingFixture } from './fixtures.ts';

/**
 * Short form as its own medium.
 *
 * The thing these guard is the correction itself: a reel is not the classic
 * film with its numbers scaled. Scaling produces a film that is uniformly
 * quick, opens on a hold, holds a still frame in the middle and lands its
 * point on the last shot — which is every mistake the format punishes, made
 * faster.
 *
 * The other half matters as much and is harder to test: not chaotic. A cut on
 * a metronome and a zoom on every beat are what this looks like when somebody
 * confuses retention with noise, so the resets here are deliberately small and
 * the floor under a shot is the length below which a cut stops being a cut.
 */

const context = { organizationId: 'org_1', projectId: 'prj_1' };

function scene(over: Partial<Scene> & Pick<Scene, 'id'>): Scene {
  return {
    storyboardId: 'sbd_1', index: 0, startTime: 0, duration: 3, purpose: 'A beat',
    narration: '', onScreenText: ['A line'], visualType: 'kinetic_typography', assetRefs: [],
    momentIds: [],
    motionRecipe: { name: 'kinetic_headline', easing: 'out_quint', delay: 0, stagger: 0, intensity: 0.6, params: {} },
    cameraRecipe: { move: 'static', fromScale: 1, toScale: 1, fromX: 0, toX: 0, fromY: 0, toY: 0, motionBlur: 0, depthOfField: 0, easing: 'in_out_quart' },
    soundCues: [], voiceOver: false, generativeNeeds: [], threeDSceneId: null, status: 'ready',
    claimEvidenceIds: [], notes: '', estimatedCostUsd: 0, ...over,
  };
}

describe('the shape a short takes', () => {
  it('covers the whole runtime, in order, with no gap between beats', () => {
    let previous = 0;
    for (const beat of SHORT_STRUCTURE) {
      expect(beat.at[0], beat.id).toBeCloseTo(previous, 5);
      expect(beat.at[1]).toBeGreaterThan(beat.at[0]);
      previous = beat.at[1];
    }
    expect(previous).toBe(1);
  });

  it('puts the hook first and the close last', () => {
    expect(shortBeatAt(0)).toBe('hook');
    expect(shortBeatAt(0.02)).toBe('hook');
    expect(shortBeatAt(0.5)).toBe('escalation');
    expect(shortBeatAt(0.99)).toBe('close');
    // Out of range rather than crashing: the close is the honest answer.
    expect(shortBeatAt(4)).toBe('close');
    expect(shortBeatAt(-1)).toBe('hook');
  });

  it('is briefed as its own craft, with its own standards', () => {
    const ids = standardsFor('short_form').map((standard) => standard.id);
    expect(ids).toContain('short.pattern_interrupt');
    expect(ids).toContain('short.attention_reset');
    expect(ids).toContain('short.early_payoff');
    // And the one from elsewhere that decides most of it: a feed is muted.
    expect(ids).toContain('conversion.sound_off');
  });
});

describe('the retention curve', () => {
  it('opens at its fastest and gives the middle the room', () => {
    expect(retentionCurve(0.02)).toBeLessThan(retentionCurve(0.45));
    expect(retentionCurve(0.95)).toBeLessThan(retentionCurve(0.45));
  });

  it('is a shape rather than a swing', () => {
    // A curve that swings hard reads as a film that cannot decide. Every
    // multiplier stays inside a third of one.
    for (const beat of SHORT_STRUCTURE) {
      const at = (beat.at[0] + beat.at[1]) / 2;
      expect(retentionCurve(at)).toBeGreaterThan(0.66);
      expect(retentionCurve(at)).toBeLessThan(1.34);
    }
  });

  it('keeps the film the length it was, while changing its shape', () => {
    const constraints: TimingConstraint[] = Array.from({ length: 8 }, (_, index) => ({
      id: `s${index}`,
      preferred: 3,
      min: 1,
      max: 5,
      rigid: false,
    }));
    const flat = new Map(constraints.map((constraint) => [constraint.id, 3]));
    const shaped = shortRhythm(flat, constraints);

    const before = [...flat.values()].reduce((sum, seconds) => sum + seconds, 0);
    const after = [...shaped.values()].reduce((sum, seconds) => sum + seconds, 0);
    expect(after).toBeCloseTo(before, 1);

    // And the opening is genuinely shorter than the middle now.
    expect(shaped.get('s0')!).toBeLessThan(shaped.get('s4')!);
  });

  it('never cuts below the length at which a cut stops being a cut', () => {
    const constraints: TimingConstraint[] = Array.from({ length: 6 }, (_, index) => ({
      id: `s${index}`,
      preferred: 0.7,
      min: 0.5,
      max: 1.2,
      rigid: false,
    }));
    const shaped = shortRhythm(new Map(constraints.map((c) => [c.id, 0.7])), constraints);
    for (const [id, seconds] of shaped) expect(seconds, id).toBeGreaterThanOrEqual(0.5);
  });
});

describe('the attention reset', () => {
  it('finds a frame that holds with nothing changing in it', () => {
    const still = scene({ id: 'a', duration: ATTENTION_RESET_SECONDS + 1 });
    expect(resets(still)).toBe(false);
    expect(heldTooLong([still]).map((s) => s.id)).toEqual(['a']);
  });

  it('counts a move, a scale change, type arriving or footage as a reset', () => {
    const moving = scene({ id: 'b', duration: 4, cameraRecipe: { ...scene({ id: 'x' }).cameraRecipe, move: 'slow_push' } });
    const scaling = scene({ id: 'c', duration: 4, cameraRecipe: { ...scene({ id: 'x' }).cameraRecipe, toScale: 1.1 } });
    const arriving = scene({
      id: 'd', duration: 4, onScreenText: ['One', 'Two'],
      motionRecipe: { ...scene({ id: 'x' }).motionRecipe, stagger: 0.06 },
    });
    const footage = scene({ id: 'e', duration: 4, visualType: 'generated_broll' });
    for (const candidate of [moving, scaling, arriving, footage]) {
      expect(resets(candidate), candidate.id).toBe(true);
    }
    expect(heldTooLong([moving, scaling, arriving, footage])).toEqual([]);
  });

  it('leaves a short shot alone, because it resets by ending', () => {
    expect(heldTooLong([scene({ id: 'a', duration: ATTENTION_RESET_SECONDS - 0.1 })])).toEqual([]);
  });

  it('gives a still shot the gentlest move rather than a zoom', () => {
    const base = scene({ id: 'a' }).cameraRecipe;
    const reset = withAttentionReset(base);
    expect(reset.move).toBe('slow_push');
    // Six percent over a shot is a frame that is alive, not one that shouts.
    expect(reset.toScale - reset.fromScale).toBeLessThanOrEqual(0.08);
  });

  it('does not run the same move twice, which resets nothing', () => {
    const base = scene({ id: 'a' }).cameraRecipe;
    expect(withAttentionReset(base, { previousMove: 'slow_push' }).move).toBe('lateral_drift');
  });

  it('leaves a shot that already moves exactly as the system composed it', () => {
    const moving = { ...scene({ id: 'a' }).cameraRecipe, move: 'orbit' as const };
    expect(withAttentionReset(moving)).toBe(moving);
  });
});

describe('the opening', () => {
  it('refuses a mark, a bare transition or an empty frame', () => {
    expect(canOpenAShort({ visualType: 'logo_reveal', onScreenText: ['Acme'], assetRefs: [] })).toBe(false);
    expect(canOpenAShort({ visualType: 'transition', onScreenText: [], assetRefs: [] })).toBe(false);
    expect(canOpenAShort({ visualType: 'kinetic_typography', onScreenText: ['  '], assetRefs: [] })).toBe(false);
  });

  it('accepts anything that actually says something', () => {
    expect(canOpenAShort({ visualType: 'kinetic_typography', onScreenText: ['A week.'], assetRefs: [] })).toBe(true);
    expect(canOpenAShort({ visualType: 'generated_broll', onScreenText: [], assetRefs: [] })).toBe(true);
  });

  it('fails a film whose first words arrive after the decision was made', () => {
    const late = [
      scene({ id: 'a', index: 0, visualType: 'logo_reveal', duration: 2, startTime: 0 }),
      scene({ id: 'b', index: 1, duration: 2, startTime: 2 }),
    ];
    expect(opensOnAPatternInterrupt(late)).toBe(false);
  });

  it('passes a film that says something immediately', () => {
    expect(opensOnAPatternInterrupt([scene({ id: 'a', duration: 2 })])).toBe(true);
  });
});

describe('where the payoff lands', () => {
  it('reads the last thing said, not the end card', () => {
    const scenes = [
      scene({ id: 'a', index: 0, startTime: 0, duration: 4 }),
      scene({ id: 'b', index: 1, startTime: 4, duration: 4 }),
      scene({ id: 'c', index: 2, startTime: 8, duration: 2, visualType: 'logo_reveal' }),
    ];
    expect(payoffAt(scenes)).toBeCloseTo(0.8, 5);
    expect(payoffAt(scenes)).toBeLessThanOrEqual(PAYOFF_BY);
  });
});

describe('captions as composition', () => {
  it('marks the figure, which is what a viewer repeats', () => {
    expect(emphasisIn('Closes the books in 1 run')).toBe('1');
    expect(emphasisIn('Trusted by 400 finance teams')).toBe('400');
  });

  it('falls back to a name, and never marks the first word', () => {
    expect(emphasisIn('Built on Northwind, end to end')).toBe('Northwind');
    expect(emphasisIn('Northwind closes the books')).toBeNull();
  });

  it('marks nothing where a sentence has no hinge', () => {
    // Emphasis in every cue is emphasis in none.
    expect(emphasisIn('It just works')).toBeNull();
  });
});

describe('the storyboard a short actually gets', () => {
  function build(archetypeIds: string[], cut: 'short' | 'feature') {
    const llm = new ScriptedLlmProvider([
      {
        respond: () => ({
          scenes: archetypeIds.map((archetypeId, index) => ({
            archetypeId,
            purpose: `Beat ${index + 1}`,
            onScreenText: [`Line ${index + 1}`],
            narration: '',
            momentId: null,
            generativeBrief: '',
            claimText: '',
            libraryAssetId: null,
          })),
        }),
      },
    ]);
    return new StoryboardEngine(llm).build(
      {
        projectId: 'prj_1',
        concept: conceptFixture({ creativeSystem: 'cinematic_black' as Concept['creativeSystem'] }),
        treatment: treatmentFixture(),
        understanding: understandingFixture({ productMoments: [] }),
        brand: brandFixture(),
        brief: briefFixture({ filmCut: cut }),
        version: 1,
      },
      context,
    ).then((result) => ({ ...result, llm }));
  }

  const beats = ['statement', 'proof', 'statement', 'proof', 'statement', 'proof'];

  it('leaves no frame holding with nothing in it', async () => {
    const { storyboard } = await build(beats, 'short');
    expect(heldTooLong(storyboard.scenes)).toEqual([]);
  });

  it('opens on something rather than on setup', async () => {
    const { storyboard } = await build(beats, 'short');
    expect(opensOnAPatternInterrupt(storyboard.scenes)).toBe(true);
  });

  it('opens faster than it runs in the middle', async () => {
    const { storyboard } = await build(beats, 'short');
    const [first] = storyboard.scenes;
    const middle = storyboard.scenes[Math.floor(storyboard.scenes.length / 2)]!;
    expect(first!.duration).toBeLessThanOrEqual(middle.duration);
  });

  it('spends no time on deliberate silence', async () => {
    const { llm } = await build(beats, 'short');
    const prompt = llm.calls[0]!.messages.map((message) => message.content).join('\n');
    expect(prompt).toMatch(/different medium/i);
    expect(prompt).toMatch(/Hook \(/);
    expect(prompt).toMatch(/every shot earns its place/i);
    // And the warning against the other failure, which is the one that makes
    // a film look cheap rather than slow.
    expect(prompt).toMatch(/retention with noise/i);
  });

  it('does not brief a classic film on any of it', async () => {
    const { llm } = await build(beats, 'feature');
    const prompt = llm.calls[0]!.messages.map((message) => message.content).join('\n');
    expect(prompt).not.toMatch(/different medium/i);
    expect(prompt).not.toMatch(/Hook \(/);
  });
});
