import { describe, it, expect } from 'vitest';
import {
  ATTENTION_RESET_SECONDS,
  PAYOFF_BY,
  SHORT_SILENCE_BUDGET,
  SHORT_STRUCTURE,
  emphasisIn,
  shortBeatAt,
  standardsFor,
  type Concept,
  type Scene,
} from '@act-one/core';
import { ScriptedLlmProvider } from '@act-one/providers';
import { CREATIVE_SYSTEMS, pacedForCut } from '../systems/index.ts';
import {
  StoryboardEngine,
  canOpenAShort,
  heldTooLong,
  needsAttention,
  openingProblem,
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
    uiSequence: null,
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
  /** A still frame with nothing in it: no move, no subject, no arrival, no sound. */
  const inert = (over: Partial<Scene> = {}) =>
    scene({
      id: 'a',
      duration: ATTENTION_RESET_SECONDS + 1,
      visualType: 'quote',
      motionRecipe: { ...scene({ id: 'x' }).motionRecipe, name: 'quote_hold', stagger: 0 },
      uiSequence: null,
      soundCues: [],
      ...over,
    });

  it('finds a frame where nothing at all is happening', () => {
    expect(resets(inert())).toBe(false);
    expect(heldTooLong([inert()]).map((s) => s.id)).toEqual(['a']);
  });

  it('counts every source of a reset, not just the camera', () => {
    const base = scene({ id: 'x' });
    const sources: [string, Scene][] = [
      ['camera', inert({ id: 'camera', cameraRecipe: { ...base.cameraRecipe, move: 'slow_push' } })],
      ['scale', inert({ id: 'scale', cameraRecipe: { ...base.cameraRecipe, toScale: 1.1 } })],
      ['subject', inert({ id: 'subject', visualType: 'generated_broll' })],
      ['action', inert({ id: 'action', motionRecipe: { ...base.motionRecipe, name: 'product_sequence' } })],
      ['type', inert({ id: 'type', onScreenText: ['One'], motionRecipe: { ...base.motionRecipe, stagger: 0.06 } })],
      ['sound', inert({
        id: 'sound',
        uiSequence: null,
        soundCues: [{ time: 0.4, type: 'impact', assetId: null, intensity: 0.6, durationSeconds: null }],
      })],
    ];
    for (const [label, candidate] of sources) {
      expect(resets(candidate), label).toBe(true);
      expect(heldTooLong([candidate]), label).toEqual([]);
    }
  });

  it('counts a cut to something else as a reset, which is relational', () => {
    const previous = inert({ id: 'before', visualType: 'kinetic_typography' });
    expect(resets(inert({ id: 'after' }), previous)).toBe(true);
    expect(heldTooLong([previous, inert({ id: 'after' })]).map((s) => s.id)).toEqual(['before']);
  });

  it('leaves a short shot alone, because it resets by ending', () => {
    expect(heldTooLong([inert({ duration: ATTENTION_RESET_SECONDS - 0.1 })])).toEqual([]);
  });

  it('does not want a move added to a shot that is already doing something', () => {
    // The refinement that matters: a zoom on every beat is what this format
    // looks like when somebody confuses retention with noise.
    const busy = inert({ visualType: 'generated_broll', duration: 6 });
    expect(needsAttention(busy)).toBe(false);
  });

  it('wants one only where the frame is genuinely empty and long', () => {
    expect(needsAttention(inert({ duration: 6 }))).toBe(true);
    expect(needsAttention(inert({ duration: 1 }))).toBe(false);
  });

  it('gives an empty shot the gentlest move rather than a zoom', () => {
    const reset = withAttentionReset(scene({ id: 'a' }).cameraRecipe);
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
    expect(canOpenAShort(scene({ id: 'a', visualType: 'logo_reveal', onScreenText: ['Acme'] }))).toBe(false);
    expect(canOpenAShort(scene({ id: 'b', visualType: 'transition', onScreenText: [] }))).toBe(false);
    expect(canOpenAShort(scene({ id: 'c', onScreenText: ['  '] }))).toBe(false);
  });

  it('accepts a commissioned image with no words on it', () => {
    // A striking frame is a pattern interrupt, often the best one there is,
    // and no storyboard tells it apart from a shot of weather. The director
    // is the one who can see it, so the system asks rather than overrules.
    expect(canOpenAShort(scene({ id: 'a', onScreenText: ['A week.'] }))).toBe(true);
    expect(
      canOpenAShort(
        scene({
          id: 'b',
          visualType: 'generated_broll',
          onScreenText: [],
          generativeNeeds: [
            {
              kind: 'video', brief: 'A cold morning over a city', mustNotContainText: true,
              referenceAssetIds: [], durationSeconds: 4, aspect: '9:16',
              resolvedProvider: null, resolvedModel: null, estimatedCostUsd: 0,
            },
          ],
        }),
      ),
    ).toBe(true);
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

describe('stillness and quiet, which are tools rather than faults', () => {
  it('leaves a short a beat of quiet, and not a film of them', () => {
    for (const [id, written] of Object.entries(CREATIVE_SYSTEMS)) {
      const { system } = pacedForCut(written, written.archetypes, 'short');
      // Zero was the first version and it was wrong: a micro-pause before a
      // payoff is one of the few ways this format creates tension at all.
      expect(system.pacing.silenceBudget, id).toBeLessThanOrEqual(SHORT_SILENCE_BUDGET);
      // And a classic film's two to four seconds is a fifth of a reel.
      expect(system.pacing.silenceBudget, id).toBeLessThan(written.pacing.silenceBudget);
    }
  });

  it('leaves a held frame alone when the stillness is doing work', async () => {
    // A quote held against a dense cut, with the sound landing on it. Nothing
    // moves and everything is happening, and the engine must not zoom it.
    const still = scene({
      id: 'held',
      duration: 4,
      visualType: 'quote',
      motionRecipe: { ...scene({ id: 'x' }).motionRecipe, name: 'quote_hold', stagger: 0 },
      uiSequence: null,
      soundCues: [{ time: 0.3, type: 'impact', assetId: null, intensity: 0.7, durationSeconds: null }],
    });
    expect(needsAttention(still)).toBe(false);
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

  it('never reorders a short to patch its opening', async () => {
    /*
     * The order of a film is an argument. Promoting a beat out of the middle
     * to fix the top breaks what was either side of it and lands the viewer
     * mid-thought, which is a worse film than one that opens slowly. So the
     * plan's order survives exactly, and a bad opening is written again
     * instead — see `openingProblem`, and the check that holds the storyboard
     * for review when the rewrite does no better.
     */
    const { storyboard } = await build(beats, 'short');
    const copy = storyboard.scenes
      .filter((entry) => entry.visualType !== 'logo_reveal')
      .map((entry) => entry.onScreenText[0]);
    expect(copy).toEqual(beats.map((_, index) => `Line ${index + 1}`));
  });

  it('asks the planner for a new opening when the first one is setup', async () => {
    /*
     * Built as a unit, because no creative system has an archetype that opens
     * on a mark or a transition — a freshly planned short cannot reach this
     * state, and the guard is for material that arrives another way: a
     * revision, a repair, or a campaign recut re-planning against an approved
     * board. Testing it through `build` would mean inventing a system that
     * does not exist, which tests the invention rather than the guard.
     */
    const setup = [
      scene({ id: 'a', index: 0, startTime: 0, duration: 2.2, visualType: 'logo_reveal', onScreenText: ['Acme'] }),
      scene({ id: 'b', index: 1, startTime: 2.2, duration: 2, onScreenText: ['A week, gone.'] }),
    ];
    expect(opensOnAPatternInterrupt(setup)).toBe(false);
    // And what comes back is specific enough to write against: a model told
    // "open on the strongest thing" returns what it just returned.
    expect(openingProblem(setup)).toMatch(/brand mark, held for 2\.2s/);

    // A mark that clears the screen inside the window is not the same fault:
    // the idea still lands while the viewer is deciding.
    const brief = [
      scene({ id: 'a', index: 0, startTime: 0, duration: 1.1, visualType: 'logo_reveal', onScreenText: ['Acme'] }),
      scene({ id: 'b', index: 1, startTime: 1.1, duration: 2, onScreenText: ['A week, gone.'] }),
    ];
    expect(opensOnAPatternInterrupt(brief)).toBe(true);
  });

  it('describes each kind of weak opening in its own words', () => {
    expect(openingProblem([scene({ id: 'a', visualType: 'transition', duration: 0.8 })])).toMatch(/transition/i);
    expect(openingProblem([scene({ id: 'b', onScreenText: [], duration: 2 })])).toMatch(/nothing on screen/i);
    expect(openingProblem([])).toMatch(/no opening shot/i);
  });

  it('does not brief a classic film on any of it', async () => {
    const { llm } = await build(beats, 'feature');
    const prompt = llm.calls[0]!.messages.map((message) => message.content).join('\n');
    expect(prompt).not.toMatch(/different medium/i);
    expect(prompt).not.toMatch(/Hook \(/);
  });
});
