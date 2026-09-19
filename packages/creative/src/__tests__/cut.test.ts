import { describe, it, expect } from 'vitest';
import {
  DURATION_CHOICES,
  FILM_CUTS,
  FilmCut,
  cutAspect,
  cutDurationChoices,
  cutHolds,
  cutSeconds,
  type Concept,
} from '@act-one/core';
import { ScriptedLlmProvider } from '@act-one/providers';
import { CREATIVE_SYSTEMS, archetypesFor, pacedForCut } from '../systems/index.ts';
import { StoryboardEngine, campaignFor } from '../index.ts';
import { brandFixture, briefFixture, conceptFixture, treatmentFixture, understandingFixture } from './fixtures.ts';

/**
 * The film cut for the feed, and the one for the page.
 *
 * The thing these guard is that a short is *planned* as a short rather than
 * produced as a long film and cropped. A crop is easy to write and impossible
 * to watch: the composition's centre lands under a thumb, the safe area lands
 * under the caption bar, and every shot holds for the length somebody chose
 * for a viewer who was paying attention. So what is checked here is that the
 * decision reaches the frame, the runtime, the rhythm and the captions —
 * before anything is rendered.
 */

const context = { organizationId: 'org_1', projectId: 'prj_1' };

describe('what a cut decides', () => {
  it('gives each cut its own frame', () => {
    expect(cutAspect('feature')).toBe('16:9');
    expect(cutAspect('short')).toBe('9:16');
  });

  it('pulls a runtime into the band rather than obeying it outside', () => {
    // Sixty seconds asked for before the cut was chosen is not an instruction
    // to deliver a sixty-second reel.
    expect(cutSeconds('short', 60)).toBeLessThanOrEqual(FILM_CUTS.short.seconds[1]);
    expect(cutSeconds('short', 4)).toBeGreaterThanOrEqual(FILM_CUTS.short.seconds[0]);
    // And inside the band, the customer's own number is obeyed exactly.
    expect(cutSeconds('short', 24)).toBe(24);
    expect(cutSeconds('feature', 90)).toBe(90);
  });

  it('falls back to the cut’s own default rather than to a number', () => {
    for (const cut of FilmCut.options) {
      expect(cutSeconds(cut, null)).toBe(FILM_CUTS[cut].defaultSeconds);
      expect(cutHolds(cut, cutSeconds(cut, null))).toBe(true);
    }
  });

  it('offers only the lengths the cut can carry, and never an empty menu', () => {
    const short = cutDurationChoices('short', DURATION_CHOICES, 120);
    expect(short).not.toContain(90);
    expect(short.length).toBeGreaterThan(0);
    expect(cutDurationChoices('feature', DURATION_CHOICES, 120)).toContain(60);
    // A plan that caps below the ladder's first rung still gets a choice.
    expect(cutDurationChoices('feature', DURATION_CHOICES, 10).length).toBeGreaterThan(0);
  });

  it('wears its captions in the picture where nobody hears it', () => {
    expect(FILM_CUTS.short.captionsBurned).toBe(true);
    expect(FILM_CUTS.feature.captionsBurned).toBe(false);
  });
});

describe('a system cut for the feed', () => {
  it('shortens every shot, and never below what registers as a shot', () => {
    for (const [id, written] of Object.entries(CREATIVE_SYSTEMS)) {
      const vocabulary = archetypesFor(written, 'product_tour');
      const { system, archetypes } = pacedForCut(written, vocabulary, 'short');

      expect(system.pacing.averageSceneSeconds, id).toBeLessThan(written.pacing.averageSceneSeconds);
      for (const [index, archetype] of archetypes.entries()) {
        const original = vocabulary[index]!;
        expect(archetype.durationRange[1], `${id}/${archetype.id}`).toBeLessThanOrEqual(
          original.durationRange[1],
        );
        // Below this a cut is a strobe rather than a cut.
        expect(archetype.durationRange[0], `${id}/${archetype.id}`).toBeGreaterThanOrEqual(0.6);
      }
    }
  });

  it('shortens the end card too, which is a seventh of a reel at full length', () => {
    const written = CREATIVE_SYSTEMS.cinematic_black;
    const { system } = pacedForCut(written, written.archetypes, 'short');
    expect(system.endings[0]!.durationRange[1]).toBeLessThan(written.endings[0]!.durationRange[1]);
  });

  it('leaves a classic film exactly as its system wrote it', () => {
    for (const written of Object.values(CREATIVE_SYSTEMS)) {
      const { system, archetypes } = pacedForCut(written, written.archetypes, 'feature');
      expect(system).toBe(written);
      expect(archetypes).toBe(written.archetypes);
    }
  });
});

describe('the storyboard a cut actually gets', () => {
  function build(cut: FilmCut, durationSeconds: number | null = null) {
    const llm = new ScriptedLlmProvider([
      {
        respond: () => ({
          scenes: ['statement', 'proof', 'atmosphere', 'statement', 'proof', 'atmosphere'].map(
            (archetypeId, index) => ({
              archetypeId,
              purpose: `Beat ${index + 1}`,
              onScreenText: [`Line ${index + 1}`],
              narration: '',
              momentId: null,
              generativeBrief: '',
              claimText: '',
              libraryAssetId: null,
            }),
          ),
        }),
      },
    ]);
    return new StoryboardEngine(llm).build(
      {
        projectId: 'prj_1',
        concept: conceptFixture({
          creativeSystem: 'cinematic_black' as Concept['creativeSystem'],
          // A concept estimated for a long film, which is the case that used
          // to produce a reel with two thirds of it missing.
          estimatedDurationSeconds: 60,
        }),
        treatment: treatmentFixture(),
        understanding: understandingFixture({ productMoments: [] }),
        brand: brandFixture(),
        brief: briefFixture({ filmCut: cut, durationSeconds }),
        version: 1,
      },
      context,
    ).then((result) => ({ ...result, llm }));
  }

  it('cuts a short to a short, whatever the concept estimated', async () => {
    const { storyboard } = await build('short');
    const seconds = storyboard.scenes.reduce((sum, scene) => sum + scene.duration, 0);
    expect(cutHolds('short', Math.round(seconds))).toBe(true);
  });

  it('holds each shot for less time than the same film would as a feature', async () => {
    const [short, feature] = await Promise.all([build('short'), build('feature')]);
    const longest = (scenes: { duration: number }[]) => Math.max(...scenes.map((s) => s.duration));
    expect(longest(short.storyboard.scenes)).toBeLessThan(longest(feature.storyboard.scenes));
  });

  it('tells the planner it will be watched muted, and where the hook goes', async () => {
    const { llm } = await build('short');
    const prompt = llm.calls[0]!.messages.map((message) => message.content).join('\n');
    expect(prompt).toMatch(/sound off/i);
    expect(prompt).toMatch(/Scene 1 is the strongest thing in this film/);
    expect(prompt).toContain('9:16');
  });

  it('does not tell a classic film to open on its ending', async () => {
    const { llm } = await build('feature');
    const prompt = llm.calls[0]!.messages.map((message) => message.content).join('\n');
    expect(prompt).not.toMatch(/Scene 1 is the strongest thing in this film/);
    expect(prompt).toContain('16:9');
  });

  it('still honours a length the cut can carry', async () => {
    const { storyboard } = await build('short', 15);
    const seconds = storyboard.scenes.reduce((sum, scene) => sum + scene.duration, 0);
    expect(Math.abs(seconds - 15)).toBeLessThan(4);
  });
});

describe('what a campaign cuts from it', () => {
  it('does not re-crop a vertical master four more ways', () => {
    const shorts = campaignFor('short');
    expect(shorts).not.toContain('vertical_30');
    expect(shorts).toContain('reel');
    expect(campaignFor('feature')).toContain('vertical_30');
  });
});
