import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  DIRECTION_DIMENSIONS,
  GRADE_MEANING,
  gradePasses,
  weakestDimensions,
  type DirectorsVerdict,
  type Scene,
} from '@act-one/core';
import { ScriptedLlmProvider, type CallContext } from '@act-one/providers';
import { buildContactSheet, redirectFor, reviewCut, verdictIssues } from '../director.ts';

/**
 * The one judgement here with no arithmetic behind it.
 *
 * No test can decide whether a film is good, and none of these pretend to.
 * What they hold is everything around the judgement: that the scale makes
 * "nothing wrong with it" a failure, that an opinion can never withhold a
 * finished film, that a hallucinated shot id cannot reach the repair loop, and
 * that the director is actually shown the whole film rather than one frame.
 */

const call: CallContext = { organizationId: 'org_1', projectId: 'prj_1' };

function verdict(over: Partial<DirectorsVerdict> = {}): DirectorsVerdict {
  return {
    grade: 'competent',
    summary: 'Clean and forgettable.',
    notes: [
      { dimension: 'hook', grade: 'competent', note: 'The opening states a category.', atSeconds: 0, sceneId: 'a' },
      { dimension: 'image', grade: 'weak', note: 'No frame anybody would describe later.', atSeconds: 9, sceneId: 'c' },
      { dimension: 'argument', grade: 'strong', note: 'One idea, held.', atSeconds: null, sceneId: null },
    ],
    weakestSceneId: 'c',
    weakestReason: 'It shows software rather than the product working.',
    oneChange: 'Make the product shot the hero.',
    ...over,
  };
}

function scene(over: Partial<Scene> & Pick<Scene, 'id' | 'visualType'>): Scene {
  return {
    storyboardId: 'sbd_1', index: 0, startTime: 0, duration: 4, purpose: 'A beat',
    narration: '', onScreenText: [], assetRefs: [], momentIds: [],
    motionRecipe: { name: 'kinetic_headline', easing: 'out_quint', delay: 0, stagger: 0.04, intensity: 0.6, params: {} },
    cameraRecipe: { move: 'static', fromScale: 1, toScale: 1, fromX: 0, toX: 0, fromY: 0, toY: 0, motionBlur: 0, depthOfField: 0, easing: 'in_out_quart' },
    soundCues: [], voiceOver: false, generativeNeeds: [], threeDSceneId: null, status: 'ready',
    claimEvidenceIds: [], notes: '', estimatedCostUsd: 0, ...over,
  };
}

describe('where the bar is', () => {
  it('fails a film that has nothing wrong with it', () => {
    // The whole point. A reviewer that passes "competent" is decoration, and
    // competent is the normal outcome of generating a launch film.
    expect(gradePasses('competent')).toBe(false);
    expect(gradePasses('weak')).toBe(false);
    expect(gradePasses('strong')).toBe(true);
    expect(gradePasses('remarkable')).toBe(true);
  });

  it('says out loud, in the grade itself, that competent is a failure', () => {
    // The model is handed these sentences. If this one stops saying it, the
    // scale quietly becomes a four-point rating where three is a pass.
    expect(GRADE_MEANING.competent).toMatch(/failing grade/i);
  });

  it('judges the things that decide whether a launch film works', () => {
    const ids = DIRECTION_DIMENSIONS.map((dimension) => dimension.id);
    expect(ids).toContain('hook');
    expect(ids).toContain('product');
    expect(ids).toContain('rhythm');
    expect(ids).toContain('ending');
    for (const dimension of DIRECTION_DIMENSIONS) expect(dimension.asks).toMatch(/\?$/);
  });
});

describe('what a verdict does', () => {
  it('orders the failing dimensions worst first, and leaves the passing ones alone', () => {
    const weakest = weakestDimensions(verdict());
    expect(weakest.map((note) => note.dimension)).toEqual(['image', 'hook']);
  });

  it('never blocks a film the customer paid for', () => {
    const issues = verdictIssues(verdict());
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.severity).toBe('note');
      expect(issue.check).toBe('direction');
      expect(issue.repair).toBeNull();
    }
  });

  it('carries the timecode, so a note can be found', () => {
    const [first] = verdictIssues(verdict());
    expect(first!.atSeconds).toBe(9);
    expect(first!.sceneId).toBe('c');
  });
});

describe('sending one shot back', () => {
  const scenes = [
    scene({ id: 'a', visualType: 'kinetic_typography' }),
    scene({ id: 'c', visualType: 'generated_broll' }),
  ];

  it('sends back the weakest shot when the cut did not pass', () => {
    expect(redirectFor(verdict(), scenes)).toEqual({
      sceneId: 'c',
      reason: 'It shows software rather than the product working.',
    });
  });

  it('sends nothing back when the cut passed', () => {
    expect(redirectFor(verdict({ grade: 'strong' }), scenes)).toBeNull();
  });

  it('will not re-direct a shot a re-render cannot change', () => {
    // The ending not landing is not a reason to regenerate a logo lockup.
    expect(redirectFor(verdict({ weakestSceneId: 'a' }), scenes)).toBeNull();
  });

  it('ignores a shot the director invented', () => {
    expect(redirectFor(verdict({ weakestSceneId: 'scn_nothing' }), scenes)).toBeNull();
  });
});

describe('the film as one image', () => {
  async function frame(colour: number): Promise<Uint8Array> {
    const png = await sharp({ create: { width: 320, height: 180, channels: 3, background: { r: colour, g: 40, b: 60 } } })
      .png()
      .toBuffer();
    return new Uint8Array(png);
  }

  it('tiles every shot in order, labelled with its number and time', async () => {
    const frames = await Promise.all(
      [10, 90, 170, 250, 200].map(async (colour, index) => ({
        sceneId: `s${index}`,
        atSeconds: index * 3.5,
        data: await frame(colour),
      })),
    );
    const sheet = await buildContactSheet(frames, { tileWidth: 200, columns: 3 });
    const meta = await sharp(Buffer.from(sheet.png)).metadata();

    // Three across, two down, with a gap around each tile.
    expect(meta.width).toBe(3 * 200 + 4 * 8);
    expect(meta.height).toBe(2 * Math.round(200 * (180 / 320)) + 3 * 8);
    expect(sheet.shots.map((shot) => shot.sceneId)).toEqual(['s0', 's1', 's2', 's3', 's4']);
    expect(sheet.shots[2]!.atSeconds).toBeCloseTo(7, 5);
  });

  it('refuses to review a film it has no frames of', async () => {
    await expect(buildContactSheet([])).rejects.toThrow(/at least one frame/i);
  });
});

describe('what comes back from the director', () => {
  const storyboard = {
    id: 'sbd_1',
    scenes: [scene({ id: 'a', visualType: 'kinetic_typography' }), scene({ id: 'b', visualType: 'generated_broll', startTime: 4 })],
  } as unknown as Parameters<typeof reviewCut>[1]['storyboard'];

  const input = {
    storyboard,
    contactSheet: { url: 'data:image/png;base64,AA==', shots: [{ sceneId: 'a', atSeconds: 2.4 }] },
    brief: 'Northwind: closes the books in one run.',
    tone: 'Plain and exact.',
  };

  it('drops a shot id the director invented, rather than sending a repair at nothing', async () => {
    const llm = new ScriptedLlmProvider([
      {
        respond: {
          ...verdict({ weakestSceneId: 'scn_hallucinated' }),
          notes: [{ dimension: 'hook', grade: 'weak', note: 'Flat.', atSeconds: 0, sceneId: 'scn_also_invented' }],
        },
      },
    ]);
    const result = await reviewCut(llm, input, call);
    expect(result.weakestSceneId).toBeNull();
    expect(result.notes[0]!.sceneId).toBeNull();
  });

  it('is shown the whole film: every shot, its length, its words and what is said over it', async () => {
    const llm = new ScriptedLlmProvider([{ respond: verdict({ weakestSceneId: 'a' }) }]);
    await reviewCut(llm, input, call);
    const prompt = llm.calls[0]!.messages.map((message) => message.content).join('\n');

    expect(prompt).toContain('"sceneId": "a"');
    expect(prompt).toContain('"runs"');
    expect(prompt).toContain('"said"');
    // And the rubric travels with it, including the sentence that sets the bar.
    // Tolerant of where the prompt wraps: the sentence matters, not the line.
    expect(prompt).toMatch(/competent is a\s+fail/i);
    expect(prompt).toMatch(/weakest shot/i);
    // It is handed the contact sheet, not one frame.
    expect(llm.calls[0]!.options.images?.[0]?.url).toBe('data:image/png;base64,AA==');
  });

  it('asks the deep tier, because this is the judgement everything else cannot make', async () => {
    const llm = new ScriptedLlmProvider([{ respond: verdict({ weakestSceneId: 'a' }) }]);
    await reviewCut(llm, input, call);
    expect(llm.calls[0]!.options.tier).toBe('deep');
  });

  it('asks a pitch the question a pitch can answer, and tells it not to relitigate the format', async () => {
    // "Is the product seen working?" has one answer in a film that was asked
    // not to show it, and a director allowed to give that answer grades the
    // customer's own decision as the film's weakness.
    const llm = new ScriptedLlmProvider([{ respond: verdict({ weakestSceneId: 'a' }) }]);
    await reviewCut(llm, { ...input, format: 'pitch' }, call);
    const prompt = llm.calls[0]!.messages.map((message) => message.content).join('\n');

    expect(prompt).not.toMatch(/Is the product seen doing the thing/i);
    // A pitch may cut to the product; what it may not do is become a tour.
    expect(prompt).toMatch(/argues rather than demonstrates/i);
    expect(prompt).toMatch(/walkthrough/i);
    expect(prompt).toMatch(/never grade it down for being that film/i);
    // And the bar has not moved.
    expect(prompt).toMatch(/competent is a\s+fail/i);
  });

  it('asks a short the questions a feed asks, not the ones a page does', async () => {
    const llm = new ScriptedLlmProvider([{ respond: verdict({ weakestSceneId: 'a' }) }]);
    await reviewCut(llm, { ...input, cut: 'short' }, call);
    const prompt = llm.calls[0]!.messages.map((message) => message.content).join('\n');

    // The hook question changes: in a feed it is not whether the opening earns
    // the film, it is whether there is anything there in the first second.
    expect(prompt).toMatch(/first second/i);
    expect(prompt).toMatch(/scrolls away/i);
    // And the one dimension a landscape film never has to answer.
    expect(prompt).toMatch(/sound is off/i);
    expect(prompt).toContain('9:16');
  });

  it('asks a product tour whether the product is actually seen working', async () => {
    const llm = new ScriptedLlmProvider([{ respond: verdict({ weakestSceneId: 'a' }) }]);
    await reviewCut(llm, input, call);
    const prompt = llm.calls[0]!.messages.map((message) => message.content).join('\n');
    expect(prompt).toMatch(/Is the product seen doing the thing/i);
  });
});
