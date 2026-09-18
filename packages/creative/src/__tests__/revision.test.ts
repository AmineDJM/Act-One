import { describe, it, expect } from 'vitest';
import { resequence, storyboardDuration } from '@act-one/core';
import { RevisionCompiler, applyRevision } from '../index.ts';
import { brandFixture, sceneFixture, storyboardFixture } from './fixtures.ts';

const context = { organizationId: 'org_1', projectId: 'prj_1' };
const brand = brandFixture();

function board() {
  return resequence(
    storyboardFixture(
      [
        sceneFixture({
          id: 's1',
          duration: 3,
          visualType: 'kinetic_typography',
          onScreenText: ['Forty rows.'],
        }),
        sceneFixture({
          id: 's2',
          duration: 6,
          visualType: 'product_ui',
          onScreenText: ['One run', 'clears the ledger', 'every single night'],
          narration: 'One run clears the ledger.',
          voiceOver: true,
          soundCues: [
            { time: 3, type: 'music_duck', assetId: null, intensity: 0.4, durationSeconds: 6 },
          ],
        }),
        sceneFixture({
          id: 's3',
          duration: 5,
          visualType: 'generated_broll',
          purpose: 'A city at dawn',
        }),
        sceneFixture({ id: 's4', duration: 2, visualType: 'logo_reveal' }),
      ],
      { voiceStrategy: 'narrator' },
    ),
  );
}

describe('RevisionCompiler local resolution', () => {
  const compiler = new RevisionCompiler(null);

  it('handles the instructions people actually send, without a model call', () => {
    const cases: [string, string][] = [
      ['The opening is too slow', 'retime_scene'],
      ['Remove the voice-over', 'remove_voiceover'],
      ['Use less text', 'reduce_text'],
      ['Use only real product assets', 'restrict_to_real_media'],
      ['Make it more cinematic', 'change_tone'],
      ['Remove scene 3', 'remove_scene'],
      ['The music is too much', 'adjust_sound'],
    ];
    for (const [instruction, expected] of cases) {
      const resolved = compiler.resolveLocally(instruction, board());
      expect(resolved?.intent, instruction).toBe(expected);
    }
  });

  it('scopes "the opening is too slow" to the opening, whichever scenes are longest', () => {
    const storyboard = board();
    const resolved = compiler.resolveLocally('The opening is too slow', storyboard)!;
    expect(resolved.intent).toBe('retime_scene');
    expect(resolved.affectedSceneIds).toEqual(
      storyboard.scenes.slice(0, 2).map((scene) => scene.id),
    );
    const ending = compiler.resolveLocally('Tighten the ending', storyboard)!;
    expect(ending.affectedSceneIds).toEqual(storyboard.scenes.slice(-2).map((scene) => scene.id));
  });

  it('scopes "too slow" to the longest scenes, not the first one', () => {
    const resolved = compiler.resolveLocally('This feels too slow', board())!;
    // s2 (6s) and s3 (5s) are what actually make it drag.
    expect(resolved.affectedSceneIds).toContain('s2');
    expect(resolved.direction).toBe('faster');
  });

  it('scopes "too much text" to the wordiest scenes', () => {
    const resolved = compiler.resolveLocally('There is too much text', board())!;
    expect(resolved.affectedSceneIds).toContain('s2');
    expect(resolved.affectedSceneIds).not.toContain('s4');
  });

  it('honours an explicit scene number', () => {
    const resolved = compiler.resolveLocally('Scene 3 is too slow', board())!;
    expect(resolved.affectedSceneIds).toEqual(['s3']);
  });

  it('defers to the model when the request needs a subject it cannot supply', () => {
    expect(compiler.resolveLocally('Show our analytics feature instead', board())).toBeNull();
  });

  it('falls back safely, changing nothing, when there is no model available', async () => {
    const resolved = await compiler.resolve('something ineffable', board(), context);
    expect(resolved.intent).toBe('unknown');
    expect(resolved.summary).toMatch(/nothing was changed/i);
  });
});

describe('applyRevision', () => {
  it('shortens the slow scenes without dropping below legibility', () => {
    const original = board();
    const compiler = new RevisionCompiler(null);
    const resolved = compiler.resolveLocally('too slow', original)!;
    const { storyboard, changedSceneIds } = applyRevision(original, resolved, brand);

    expect(changedSceneIds.length).toBeGreaterThan(0);
    expect(storyboardDuration(storyboard)).toBeLessThan(storyboardDuration(original));

    const s2 = storyboard.scenes.find((s) => s.id === 's2')!;
    // Three lines of copy still have to be readable afterwards.
    const words = s2.onScreenText.join(' ').split(/\s+/).length;
    expect(s2.duration).toBeGreaterThanOrEqual(0.45 + words / 2.6 + 0.35 - 0.01);
  });

  it('removes narration, the duck cue, and the storyboard voice strategy together', () => {
    const original = board();
    const compiler = new RevisionCompiler(null);
    const resolved = compiler.resolveLocally('remove the voiceover', original)!;
    const { storyboard } = applyRevision(original, resolved, brand);

    expect(storyboard.voiceStrategy).toBe('none');
    for (const scene of storyboard.scenes) {
      expect(scene.narration).toBe('');
      expect(scene.voiceOver).toBe(false);
      expect(scene.soundCues.some((c) => c.type === 'music_duck')).toBe(false);
    }
  });

  it('replaces generated footage with typography when asked for real media only', () => {
    const original = board();
    const compiler = new RevisionCompiler(null);
    const resolved = compiler.resolveLocally('use only real product assets', original)!;
    const { storyboard, changedSceneIds } = applyRevision(original, resolved, brand);

    expect(changedSceneIds).toEqual(['s3']);
    const s3 = storyboard.scenes.find((s) => s.id === 's3')!;
    expect(s3.visualType).toBe('kinetic_typography');
    expect(s3.generativeNeeds).toEqual([]);
  });

  it('re-times the film after removing a scene', () => {
    const original = board();
    const compiler = new RevisionCompiler(null);
    const resolved = compiler.resolveLocally('remove scene 3', original)!;
    const { storyboard } = applyRevision(original, resolved, brand);

    expect(storyboard.scenes.map((s) => s.id)).toEqual(['s1', 's2', 's4']);
    expect(storyboard.scenes.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(storyboard.scenes.map((s) => s.startTime)).toEqual([0, 3, 9]);
  });

  it('clears assets on a recapture so the pipeline goes back for new footage', () => {
    const original = board();
    const { storyboard, changedSceneIds } = applyRevision(
      original,
      {
        intent: 'recapture_product',
        affectedSceneIds: ['s2'],
        requestedSubject: 'the analytics view',
        direction: 'none',
        needsRecapture: true,
        summary: '',
      },
      brand,
    );

    const s2 = storyboard.scenes.find((s) => s.id === 's2')!;
    expect(changedSceneIds).toEqual(['s2']);
    expect(s2.assetRefs).toEqual([]);
    expect(s2.status).toBe('assets_pending');
    expect(s2.notes).toMatch(/analytics view/);
  });

  it('only marks the scenes it actually changed, so re-renders stay cheap', () => {
    const original = board();
    const { storyboard, changedSceneIds } = applyRevision(
      original,
      {
        intent: 'reduce_text',
        // s4 has no text, so asking to reduce it must be a no-op.
        affectedSceneIds: ['s2', 's4'],
        requestedSubject: '',
        direction: 'less',
        needsRecapture: false,
        summary: '',
      },
      brand,
    );

    expect(changedSceneIds).toEqual(['s2']);
    expect(storyboard.scenes.find((s) => s.id === 's4')!.status).toBe('draft');
  });

  it('keeps the brand’s motion language when the tone changes', () => {
    const cinematicBrand = brandFixture({ motionStyle: 'cinematic' });
    const { storyboard } = applyRevision(
      board(),
      {
        intent: 'change_tone',
        affectedSceneIds: ['s1'],
        requestedSubject: '',
        direction: 'faster',
        needsRecapture: false,
        summary: '',
      },
      cinematicBrand,
    );
    // A global easing swap would make every revised film converge on one feel.
    expect(storyboard.scenes[0]!.motionRecipe.easing).toBe('out_quint');
  });
});
