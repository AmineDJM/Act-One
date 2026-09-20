import { describe, it, expect } from 'vitest';
import { BrandSystem as BrandSystemSchema, resequence, type BrandSystem, type Scene, type Storyboard } from '@act-one/core';
import { neutralRamp } from '@act-one/design';
import { ScriptedLlmProvider, type CallContext } from '@act-one/providers';
import { localiseFilm } from '../localizer.ts';

/**
 * The localiser, and the checks that stand behind it.
 *
 * No test can tell whether a French line is good French. What a test can tell,
 * and what actually costs a customer something, is whether a figure changed, a
 * product name was translated away, or a line came back too long to say in the
 * shot it belongs to.
 */

const call: CallContext = { organizationId: 'org_1', projectId: 'prj_1' };

const brand: BrandSystem = BrandSystemSchema.parse({
  id: 'brd_1', organizationId: 'org_1', name: 'Northwind', logo: null, logoVariants: [],
  primaryColor: '#3d7bfd', secondaryColor: '#9ab8ff', accentColors: [], primaryCandidates: ['#3d7bfd'],
  neutrals: neutralRamp('#3d7bfd', 9, 0.05), canvasDark: '#07080d', canvasLight: '#ffffff',
  typography: [], visualStyle: 'minimal', imageTreatment: 'none', layoutDensity: 'balanced',
  cornerStyle: 'subtle', cornerRadiusPx: 10, motionStyle: 'precise', tone: 'Plain and direct.',
  allowsGlow: false, allowsGradient: false, confirmedByUser: true, sources: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

function scene(over: Partial<Scene> & Pick<Scene, 'id'>): Scene {
  return {
    storyboardId: 'sbd_1', index: 0, startTime: 0, duration: 4, purpose: 'A beat',
    visualType: 'kinetic_typography', narration: '', onScreenText: [], assetRefs: [], momentIds: [],
    motionRecipe: { name: 'kinetic_headline', easing: 'out_quint', delay: 0, stagger: 0.04, intensity: 0.6, params: {} },
    cameraRecipe: { move: 'slow_push', fromScale: 1, toScale: 1.02, fromX: 0, toX: 0, fromY: 0, toY: 0, motionBlur: 0, depthOfField: 0, easing: 'in_out_quart' },
    uiSequence: null,
    soundCues: [], voiceOver: true, generativeNeeds: [], threeDSceneId: null, status: 'ready',
    claimEvidenceIds: [], notes: '', estimatedCostUsd: 0, ...over,
  };
}

const storyboard: Storyboard = resequence({
  id: 'sbd_1', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1', handovers: {}, version: 1,
  scenes: [
    scene({ id: 'a', narration: 'Northwind closes 40 hours of reconciliation.', onScreenText: ['40 hours a month'] }),
    scene({ id: 'b', narration: 'One run, every month.', onScreenText: ['One run'] }),
  ],
  voiceStrategy: 'narrator', heroShot: null, musicDirection: '', parentStoryboardId: null, revisionReason: '', status: 'approved', language: 'en',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

function input(over: Partial<Parameters<typeof localiseFilm>[1]> = {}) {
  return {
    storyboard,
    brand,
    understanding: null,
    from: 'en',
    to: 'fr',
    tagline: 'Close the books while you sleep',
    companyName: 'Northwind',
    websiteUrl: 'northwind.example',
    ...over,
  };
}

describe('writing the film in another language', () => {
  it('passes a translation that fits, keeps its figures and keeps the name', async () => {
    const llm = new ScriptedLlmProvider([
      {
        respond: {
          scenes: [
            { sceneId: storyboard.scenes[0]!.id, narration: 'Northwind clôture 40 heures de rapprochement.', onScreenText: ['40 heures par mois'] },
            { sceneId: storyboard.scenes[1]!.id, narration: 'Un seul traitement, chaque mois.', onScreenText: ['Un traitement'] },
          ],
          tagline: 'Clôturez pendant que vous dormez',
          notes: 'Vouvoiement, as the brand is plain rather than familiar.',
        },
      },
    ]);

    const result = await localiseFilm(llm, input(), call);
    expect(result.problems).toEqual([]);
    expect(result.localisation.language).toBe('fr');
    expect(result.localisation.scenes).toHaveLength(2);
    expect(result.localisation.tagline).toBe('Clôturez pendant que vous dormez');
  });

  it('tells the writer the seconds each shot runs and the room each line has', async () => {
    const llm = new ScriptedLlmProvider([{ respond: { scenes: [], tagline: '', notes: '' } }]);
    await localiseFilm(llm, input(), call);
    const prompt = llm.calls[0]!.messages.map((message) => message.content).join('\n');
    expect(prompt).toContain('"seconds": 4');
    // 16 characters of English, 20 of French room.
    expect(prompt).toContain('"textRoom"');
    expect(prompt).toContain('Write this film in French. It is currently in English.');
    // The rules it is held to travel with the brief.
    expect(prompt).toMatch(/Pellegrino|cross-language perspective/);
  });

  it('reports a figure that changed value rather than shipping it', async () => {
    const llm = new ScriptedLlmProvider([
      {
        respond: {
          scenes: [
            { sceneId: storyboard.scenes[0]!.id, narration: 'Northwind clôture 14 heures de rapprochement.', onScreenText: ['40 heures par mois'] },
          ],
          tagline: '',
          notes: '',
        },
      },
    ]);
    const result = await localiseFilm(llm, input(), call);
    expect(result.problems.some((problem) => problem.problem.includes('figures changed'))).toBe(true);
    expect(result.problems[0]!.problem).toMatch(/lost 40/);
    expect(result.problems[0]!.problem).toMatch(/invented 14/);
  });

  it('does not call a spelled-out number invented when the translation used digits', async () => {
    // "Four hundred finance teams" has no digits; "400 équipes financières"
    // has one. That is a writer's choice about how to write a number, not a
    // number that appeared from nowhere, and a live model does it constantly.
    const board = {
      ...storyboard,
      scenes: [scene({ id: 'a', duration: 5, narration: 'Four hundred finance teams close this way already.', onScreenText: [] })],
    };
    const llm = new ScriptedLlmProvider([
      {
        respond: {
          scenes: [{ sceneId: 'a', narration: 'Déjà, 400 équipes financières clôturent ainsi.', onScreenText: [] }],
          tagline: '',
          notes: '',
        },
      },
    ]);
    const result = await localiseFilm(llm, input({ storyboard: board }), call);
    expect(result.problems).toEqual([]);
  });

  it('still reports a figure that changed, even where the source spelled one out', async () => {
    const board = {
      ...storyboard,
      scenes: [scene({ id: 'a', duration: 6, narration: 'Four systems, 40 hours, every month.', onScreenText: [] })],
    };
    const llm = new ScriptedLlmProvider([
      {
        respond: {
          scenes: [{ sceneId: 'a', narration: 'Quatre systèmes, 14 heures, chaque mois.', onScreenText: [] }],
          tagline: '',
          notes: '',
        },
      },
    ]);
    const result = await localiseFilm(llm, input({ storyboard: board }), call);
    expect(result.problems[0]!.problem).toMatch(/lost 40.*invented 14/);
  });

  it('reports a product name that was translated away', async () => {
    const llm = new ScriptedLlmProvider([
      {
        respond: {
          scenes: [
            { sceneId: storyboard.scenes[0]!.id, narration: 'Vent du Nord clôture 40 heures de rapprochement.', onScreenText: ['40 heures par mois'] },
          ],
          tagline: '',
          notes: '',
        },
      },
    ]);
    const result = await localiseFilm(llm, input(), call);
    expect(result.problems.some((problem) => problem.problem.includes('Northwind'))).toBe(true);
  });

  it('reports a line that will not fit in the shot it belongs to', async () => {
    const llm = new ScriptedLlmProvider([
      {
        respond: {
          scenes: [
            {
              sceneId: storyboard.scenes[1]!.id,
              narration:
                'Un seul traitement chaque mois, pour toutes vos entités, dans toutes vos devises, ' +
                'sans jamais rouvrir une feuille de calcul ni relancer qui que ce soit.',
              onScreenText: ['Un traitement'],
            },
          ],
          tagline: '',
          notes: '',
        },
      },
    ]);
    const result = await localiseFilm(llm, input(), call);
    expect(result.problems.some((problem) => /in a shot that runs/.test(problem.problem))).toBe(true);
  });

  it('reports an on-screen line with no room left to put it', async () => {
    const llm = new ScriptedLlmProvider([
      {
        respond: {
          scenes: [
            {
              sceneId: storyboard.scenes[1]!.id,
              narration: 'Un seul traitement.',
              onScreenText: ['Un seul traitement mensuel pour toutes vos entités'],
            },
          ],
          tagline: '',
          notes: '',
        },
      },
    ]);
    const result = await localiseFilm(llm, input(), call);
    expect(result.problems.some((problem) => /characters against \d+ of room/.test(problem.problem))).toBe(true);
  });

  it('reports a shot that came back with nothing to say', async () => {
    const llm = new ScriptedLlmProvider([
      {
        respond: {
          scenes: [{ sceneId: storyboard.scenes[0]!.id, narration: '   ', onScreenText: [] }],
          tagline: '',
          notes: '',
        },
      },
    ]);
    const result = await localiseFilm(llm, input(), call);
    expect(result.problems.some((problem) => problem.problem === 'came back with no narration')).toBe(true);
  });

  it('ignores a shot the model invented, so a hallucinated id cannot enter the film', async () => {
    const llm = new ScriptedLlmProvider([
      {
        respond: {
          scenes: [{ sceneId: 'scn_nothing', narration: 'Une ligne pour un plan qui n’existe pas.', onScreenText: [] }],
          tagline: '',
          notes: '',
        },
      },
    ]);
    const result = await localiseFilm(llm, input(), call);
    expect(result.localisation.scenes).toEqual([]);
  });
});
