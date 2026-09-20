import { describe, it, expect } from 'vitest';
import {
  comprehension,
  readingSeconds,
  resequence,
  shotDemand,
  viewerTimeline,
  type Scene,
  type Storyboard,
} from '../index.ts';

/**
 * Directing for somebody who has never seen the product.
 *
 * Everything here is arithmetic about what a film demands of a viewer, so
 * every test is a fact about a cut rather than an opinion about it: a line
 * nobody can finish, a screen nobody can take in, an opening with nothing in
 * it, an orientation that never arrives.
 */
function scene(over: Partial<Scene> & Pick<Scene, 'id' | 'duration'>): Scene {
  return {
    storyboardId: 'sbd_1', index: 0, startTime: 0, purpose: 'Beat', narration: '',
    onScreenText: [], visualType: 'kinetic_typography', assetRefs: [], momentIds: [],
    motionRecipe: { name: 'word_reveal', easing: 'out_quint', delay: 0, stagger: 0, intensity: 0.6, params: {} },
    cameraRecipe: { move: 'static', fromScale: 1, toScale: 1, fromX: 0, toX: 0, fromY: 0, toY: 0, motionBlur: 0.1, depthOfField: 0, easing: 'in_out_quart' },
    uiSequence: null, soundCues: [], voiceOver: false, generativeNeeds: [], threeDSceneId: null,
    status: 'draft', claimEvidenceIds: [], notes: '', estimatedCostUsd: 0, ...over,
  };
}

function board(scenes: Scene[]): Storyboard {
  return resequence({
    id: 'sbd_1', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1', version: 1,
    scenes, voiceStrategy: 'none', language: null, heroShot: null, musicDirection: '',
    status: 'draft', parentStoryboardId: null, revisionReason: '',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

describe('what a film asks of a viewer', () => {
  it('costs a fixation plus the words', () => {
    expect(readingSeconds([])).toBe(0);
    // Eight words at 160 a minute is three seconds, plus the beat it takes to
    // find the line at all.
    expect(readingSeconds(['One record carrying every step of the hire'])).toBeGreaterThan(2.5);
    expect(readingSeconds(['Scheduling'])).toBeLessThan(0.8);
  });

  it('charges more for a screen with nothing directing the eye', () => {
    const guided = scene({
      id: 'a', duration: 3, visualType: 'product_ui', assetRefs: ['ast_1'],
      uiSequence: {
        sourceWidth: 2324, sourceHeight: 1224, background: { r: 1, g: 1, b: 1 },
        framings: [
          { role: 'establish', move: 'hold', from: { x: 0, y: 0, width: 1, height: 0.5 }, to: { x: 0, y: 0, width: 1, height: 0.5 }, seconds: 1, cut: true, lift: null, words: 'none', around: null, layers: [], space: 'flat', wordsBehind: false },
          { role: 'subject', move: 'push', from: { x: 0, y: 0, width: 0.6, height: 0.3 }, to: { x: 0, y: 0, width: 0.5, height: 0.28 }, seconds: 2, cut: true, lift: null, words: 'none', around: null, layers: [], space: 'flat', wordsBehind: false },
        ],
        notes: [],
      },
    });
    const unguided = scene({ id: 'b', duration: 3, visualType: 'product_ui', assetRefs: ['ast_1'] });
    // A shot that points somewhere costs LESS than one that points nowhere:
    // guiding attention buys time rather than spending it.
    expect(shotDemand(guided).lookingSeconds).toBeLessThan(shotDemand(unguided).lookingSeconds);
  });

  it('notices a line that is gone before it has been read', () => {
    const notes = comprehension(
      board([
        scene({ id: 'a', duration: 1.0, onScreenText: ['All-in-one recruiting built for hiring complexity'] }),
      ]),
    ).notes;
    expect(notes.map((note) => note.problem)).toContain('unreadable_text');
  });

  it('notices an opening with nothing in it', () => {
    const notes = comprehension(board([
      scene({ id: 'a', duration: 1.4 }),
      scene({ id: 'b', duration: 3, onScreenText: ['All-in-one recruiting for serious teams'] }),
    ])).notes;
    expect(notes.map((note) => note.problem)).toContain('no_hook');
  });

  it('counts a category label as a label, not as an orientation', () => {
    /*
     * "Scheduling" tells somebody who already knows the category which part
     * of it this is. It tells a first-time viewer nothing at all, and a film
     * that opens on four of them has spent five seconds saying nothing.
     */
    const labels = board([
      scene({ id: 'a', duration: 1.4, onScreenText: ['ATS'] }),
      scene({ id: 'b', duration: 1.2, onScreenText: ['CRM'] }),
      scene({ id: 'c', duration: 1.2, onScreenText: ['Scheduling'] }),
      scene({ id: 'd', duration: 1.2, onScreenText: ['Reporting'] }),
      scene({ id: 'e', duration: 2.7, onScreenText: ['Context disappears at every cut.'] }),
      scene({ id: 'f', duration: 3, visualType: 'product_ui', assetRefs: ['ast_1'] }),
    ]);
    const result = comprehension(labels);
    expect(result.orientedAtSeconds).toBeGreaterThan(4);
    expect(result.notes.some((note) => note.problem === 'unguided_screen')).toBe(true);
  });

  it('notices words and an interface competing for the same seconds', () => {
    const notes = comprehension(board([
      scene({
        id: 'a', duration: 2.0, visualType: 'product_ui', assetRefs: ['ast_1'],
        onScreenText: ['Source, schedule and decide from one record'],
      }),
    ])).notes;
    expect(notes.map((note) => note.problem)).toContain('competing_channels');
  });

  it('says nothing about a film that gives its viewer time', () => {
    const notes = comprehension(board([
      scene({ id: 'a', duration: 3, onScreenText: ['All-in-one recruiting, built deep'] }),
      scene({
        id: 'b', duration: 4, visualType: 'product_ui', assetRefs: ['ast_1'],
        uiSequence: {
          sourceWidth: 2324, sourceHeight: 1224, background: { r: 1, g: 1, b: 1 },
          framings: [
            { role: 'establish', move: 'hold', from: { x: 0, y: 0, width: 1, height: 0.5 }, to: { x: 0, y: 0, width: 1, height: 0.5 }, seconds: 1.3, cut: true, lift: null, words: 'none', around: null, layers: [], space: 'flat', wordsBehind: false },
            { role: 'subject', move: 'push', from: { x: 0, y: 0, width: 0.6, height: 0.3 }, to: { x: 0, y: 0, width: 0.5, height: 0.28 }, seconds: 2.7, cut: true, lift: null, words: 'none', around: null, layers: [], space: 'flat', wordsBehind: false },
          ],
          notes: [],
        },
      }),
    ])).notes;
    expect(notes).toEqual([]);
  });
});

describe('what a first-time viewer has been given, by the second', () => {
  it('reports the product as not yet shown, until it is', () => {
    const lines = viewerTimeline(
      board([
        scene({ id: 'a', duration: 2, onScreenText: ['ATS'] }),
        scene({ id: 'b', duration: 2, onScreenText: ['CRM'] }),
        scene({ id: 'c', duration: 4, visualType: 'product_ui', assetRefs: ['ast_1'] }),
      ]),
      [2, 5],
    );
    expect(lines[0]).toMatch(/the product has not been shown/);
    expect(lines[1]).toMatch(/1 showing the product/);
  });
});
