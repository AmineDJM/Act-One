import { describe, it, expect } from 'vitest';
import { conceptSetIsDiverse, type Concept } from '@act-one/core';
import { ScriptedLlmProvider } from '@act-one/providers';
import { CreativeStrategyEngine, minimumPairwiseDivergence, rankSystems, scoreSystemFit, getSystem } from '../index.ts';
import { brandFixture, briefFixture, understandingFixture } from './fixtures.ts';

const context = { organizationId: 'org_1', projectId: 'prj_1' };

/** Returns whatever the caller asked for, so we can script divergence. */
function concept(name: string, keyIdea: string, hook: string, emotion = 'relief') {
  return {
    name,
    keyIdea,
    hook,
    targetEmotion: emotion,
    productAngle: 'angle',
    visualDirection: 'visual',
    motionDirection: 'motion',
    soundDirection: 'sound',
    productUiUsage: 'ui',
    generativeUsage: 'none',
    estimatedDurationSeconds: 60,
    recommendedChannels: ['homepage_hero'],
    keyScenes: ['one', 'two', 'three'],
    momentIds: ['mom_1'],
  };
}

describe('CreativeStrategyEngine', () => {
  it('assigns a different structure and system to each concept before writing', async () => {
    let call = 0;
    const llm = new ScriptedLlmProvider([
      {
        respond: () => {
          call += 1;
          return concept(`Concept ${call}`, `Distinct idea number ${call} about reconciliation`, `Hook ${call}`);
        },
      },
    ]);

    const result = await new CreativeStrategyEngine(llm).generate(
      {
        projectId: 'prj_1',
        understanding: understandingFixture(),
        brand: brandFixture(),
        brief: briefFixture(),
      },
      context,
    );

    expect(result.concepts).toHaveLength(3);
    const structures = new Set(result.concepts.map((c) => c.narrativeStructure));
    const systems = new Set(result.concepts.map((c) => c.creativeSystem));
    expect(structures.size).toBe(3);
    expect(systems.size).toBe(3);
  });

  it('regenerates the least distinct concept when three come back too similar', async () => {
    const ideas = [
      'Collapse a week of manual reconciliation into one run',
      'Collapse a week of manual reconciliation into one single run',
      'Collapse a week of manual reconciliation into one automated run',
      // The regeneration attempt returns something genuinely different.
      'Finance teams get their evenings back once the ledger closes itself',
    ];
    let call = 0;
    const llm = new ScriptedLlmProvider([
      {
        respond: () => {
          const idea = ideas[Math.min(call, ideas.length - 1)]!;
          call += 1;
          return concept(`C${call}`, idea, `Hook ${call}`);
        },
      },
    ]);

    const result = await new CreativeStrategyEngine(llm).generate(
      {
        projectId: 'prj_1',
        understanding: understandingFixture(),
        brand: brandFixture(),
        brief: briefFixture(),
      },
      context,
    );

    expect(call).toBe(4);
    expect(result.regenerated).toBe(1);
    expect(result.concepts).toHaveLength(3);
  });

  it('drops moment ids the model invented', async () => {
    const llm = new ScriptedLlmProvider([
      {
        respond: () => ({
          ...concept('X', 'An idea about something', 'A hook'),
          momentIds: ['mom_1', 'mom_does_not_exist'],
        }),
      },
    ]);

    const result = await new CreativeStrategyEngine(llm).generate(
      {
        projectId: 'prj_1',
        understanding: understandingFixture(),
        brand: brandFixture(),
        brief: briefFixture(),
      },
      context,
    );

    for (const c of result.concepts) {
      expect(c.momentIds).toEqual(['mom_1']);
    }
  });

  it('reports the divergence it achieved', async () => {
    const distinctIdeas = [
      'A week of manual matching disappears into a single automated run',
      'Finance stops being the department that waits for everyone else',
      'The ledger reconciles itself overnight while nobody is watching',
    ];
    let index = 0;
    const llm = new ScriptedLlmProvider([
      {
        respond: () => {
          const idea = distinctIdeas[Math.min(index, distinctIdeas.length - 1)]!;
          index += 1;
          return concept(`C${index}`, idea, `Hook ${index}`, ['relief', 'confidence', 'ambition'][index - 1] ?? 'relief');
        },
      },
    ]);
    const result = await new CreativeStrategyEngine(llm).generate(
      { projectId: 'prj_1', understanding: understandingFixture(), brand: brandFixture(), brief: briefFixture() },
      context,
    );
    expect(result.divergence).toBe(minimumPairwiseDivergence(result.concepts));
    expect(conceptSetIsDiverse(result.concepts)).toBe(true);
  });
});

describe('system fit scoring', () => {
  it('penalises a UI-led system when there is no real footage', () => {
    const withFootage = understandingFixture();
    const withoutFootage = understandingFixture({
      productMoments: understandingFixture().productMoments.map((m) => ({ ...m, screenshots: [] })),
    });
    const kinetic = getSystem('kinetic_product');

    const good = scoreSystemFit(kinetic, brandFixture(), withFootage);
    const bad = scoreSystemFit(kinetic, brandFixture(), withoutFootage);

    expect(bad.score).toBeLessThan(good.score);
    expect(bad.reasons.join(' ')).toMatch(/no real product capture/i);
  });

  it('matches systems to the brand’s own visual language', () => {
    const editorialBrand = brandFixture({ visualStyle: 'editorial', motionStyle: 'cinematic' });
    const ranked = rankSystems(editorialBrand, understandingFixture());
    expect(ranked[0]!.system.id).toBe('editorial_tech');
  });

  it('never recommends a system that is not production ready', () => {
    const ranked = rankSystems(brandFixture(), understandingFixture());
    expect(ranked[0]!.system.productionReady).toBe(true);
  });

  it('penalises a glow-heavy system for a brand that does not use glow', () => {
    const plainBrand = brandFixture({ allowsGlow: false, visualStyle: 'bold' });
    const gradientSystem = getSystem('bold_gradient');
    const { reasons } = scoreSystemFit(gradientSystem, plainBrand, understandingFixture());
    expect(reasons.join(' ')).toMatch(/glow the brand does not use/i);
  });

  it('prefers energy for a Product Hunt launch and gravity for a fundraise', () => {
    const ph = understandingFixture({ launchContext: 'product_hunt' });
    const fundraise = understandingFixture({ launchContext: 'fundraise' });
    const brand = brandFixture({ visualStyle: 'technical' });

    const kineticForPh = scoreSystemFit(getSystem('kinetic_product'), brand, ph);
    const kineticForFund = scoreSystemFit(getSystem('kinetic_product'), brand, fundraise);
    expect(kineticForPh.score).toBeGreaterThan(kineticForFund.score);
  });
});
