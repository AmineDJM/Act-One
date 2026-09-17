import { describe, it, expect } from 'vitest';
import { newId, resequence, type BrandSystem, type Scene, type Storyboard, type QaReport } from '@act-one/core';
import { neutralRamp } from '@act-one/design';
import { runDeterministicChecks, factCheck, planRepairs, applyRepairs, selectFramesToInspect, extractProperNouns } from '../index.ts';

const brand: BrandSystem = {
  id: 'brd_1', organizationId: 'org_1', name: 'Northwind', logo: null, logoVariants: [],
  primaryColor: '#2f6fed', secondaryColor: '#8fb2f7', accentColors: [], primaryCandidates: ['#2f6fed'],
  neutrals: neutralRamp('#2f6fed', 9, 0.05), canvasDark: '#08080c', canvasLight: '#ffffff',
  typography: [], visualStyle: 'minimal', imageTreatment: 'none', layoutDensity: 'balanced',
  cornerStyle: 'subtle', cornerRadiusPx: 8, motionStyle: 'precise', tone: '',
  allowsGlow: false, allowsGradient: false, confirmedByUser: true, sources: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

function scene(over: Partial<Scene> & Pick<Scene, 'id' | 'duration' | 'visualType'>): Scene {
  return {
    storyboardId: 'sbd_1', index: 0, startTime: 0, purpose: 'x', narration: '', onScreenText: [],
    assetRefs: [], momentIds: [],
    motionRecipe: { name: 'word_reveal', easing: 'out_quint', delay: 0, stagger: 0.06, intensity: 0.6, params: {} },
    cameraRecipe: { move: 'static', fromScale: 1, toScale: 1, fromX: 0, toX: 0, fromY: 0, toY: 0, motionBlur: 0.1, depthOfField: 0, easing: 'in_out_quart' },
    soundCues: [], voiceOver: false, generativeNeeds: [], threeDSceneId: null, status: 'draft',
    claimEvidenceIds: [], notes: '', estimatedCostUsd: 0,
    ...over,
  };
}

function board(scenes: Scene[]): Storyboard {
  return resequence({
    id: 'sbd_1', projectId: 'prj_1', conceptId: 'cpt_1', treatmentId: 'trt_1', version: 1,
    scenes, voiceStrategy: 'none', musicDirection: '', status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

describe('deterministic QA', () => {
  it('blocks text nobody can read in the time it is on screen', () => {
    const issues = runDeterministicChecks({
      storyboard: board([
        scene({
          id: 'a', duration: 1, visualType: 'kinetic_typography',
          onScreenText: ['Close the books without a week of manual reconciliation work every month'],
        }),
      ]),
      brand,
      aspect: '16:9',
    });
    const issue = issues.find((i) => i.check === 'text_overflow' && i.severity === 'blocker');
    expect(issue).toBeDefined();
    expect(issue!.message).toMatch(/to read/);
  });

  it('blocks a product scene with no captured asset behind it', () => {
    const issues = runDeterministicChecks({
      storyboard: board([scene({ id: 'a', duration: 4, visualType: 'product_ui', assetRefs: [] })]),
      brand,
      aspect: '16:9',
    });
    const issue = issues.find((i) => i.check === 'fake_product_ui');
    expect(issue?.severity).toBe('blocker');
    expect(issue?.repair).toBe('recapture_product');
  });

  it('blocks a generated shot that was allowed to contain text', () => {
    const issues = runDeterministicChecks({
      storyboard: board([
        scene({
          id: 'a', duration: 4, visualType: 'generated_broll',
          generativeNeeds: [{
            kind: 'video', brief: 'a city', mustNotContainText: false, referenceAssetIds: [],
            durationSeconds: 4, aspect: '16:9', resolvedProvider: null, resolvedModel: null, estimatedCostUsd: 0,
          }],
        }),
      ]),
      brand,
      aspect: '16:9',
    });
    expect(issues.some((i) => i.check === 'legible_generated_text' && i.severity === 'blocker')).toBe(true);
  });

  it('flags an edit where every scene is the same length', () => {
    const issues = runDeterministicChecks({
      storyboard: board(
        Array.from({ length: 6 }, (_, i) => scene({ id: `s${i}`, duration: 3, visualType: 'kinetic_typography' })),
      ),
      brand,
      aspect: '16:9',
    });
    expect(issues.some((i) => i.message.includes('no rhythm'))).toBe(true);
  });

  it('flags the same motion treatment running scene after scene', () => {
    const issues = runDeterministicChecks({
      storyboard: board(
        Array.from({ length: 6 }, (_, i) =>
          scene({ id: `s${i}`, duration: 2 + i * 0.4, visualType: 'kinetic_typography' }),
        ),
      ),
      brand,
      aspect: '16:9',
    });
    expect(issues.some((i) => i.check === 'transition_quality')).toBe(true);
  });

  it('rejects a scene citing evidence the project does not hold', () => {
    const issues = runDeterministicChecks({
      storyboard: board([
        scene({ id: 'a', duration: 3, visualType: 'statistic', claimEvidenceIds: ['evt_ghost'] }),
      ]),
      brand,
      aspect: '16:9',
      knownEvidenceIds: new Set(['evt_real']),
    });
    expect(issues.some((i) => i.check === 'unsupported_claim' && i.severity === 'blocker')).toBe(true);
  });

  it('passes a well-formed film', () => {
    const issues = runDeterministicChecks({
      storyboard: board([
        scene({ id: 'a', duration: 3.2, visualType: 'kinetic_typography', onScreenText: ['Forty rows.'] }),
        scene({ id: 'b', duration: 5, visualType: 'product_ui', assetRefs: ['ast_1'], motionRecipe: { name: 'product_window', easing: 'out_quint', delay: 0, stagger: 0.06, intensity: 0.6, params: {} } }),
        scene({ id: 'c', duration: 2.1, visualType: 'statistic', onScreenText: ['0'], motionRecipe: { name: 'metric_reveal', easing: 'out_quint', delay: 0, stagger: 0, intensity: 0.6, params: {} } }),
        scene({ id: 'd', duration: 3, visualType: 'logo_reveal', motionRecipe: { name: 'logo_reveal', easing: 'out_quint', delay: 0, stagger: 0, intensity: 0.5, params: {} } }),
      ]),
      brand,
      aspect: '16:9',
    });
    expect(issues.filter((i) => i.severity === 'blocker')).toEqual([]);
  });
});

describe('fact check', () => {
  const understanding = {
    id: 'pun_1', projectId: 'prj_1', name: 'Northwind', oneLiner: 'x', category: 'y',
    targetAudience: [], painPoints: [], keyBenefits: [], differentiators: [], coreFeatures: [],
    proofPoints: [], productMoments: [], strongestVisualMoments: [], tone: '', brandTraits: [],
    competitorCategory: '', productMaturity: 'growth' as const, launchContext: 'product_launch' as const,
    evidence: [
      {
        id: newId('evt'), kind: 'page_text' as const, sourceUrl: 'https://northwind.example/',
        excerpt: 'Teams close their books 3x faster. Trusted by 400 finance teams including Globex.',
        capturedAt: '2026-01-01T00:00:00.000Z', confidence: 1,
      },
    ],
    sources: [], gaps: [], createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('blocks a figure that appears nowhere in the customer’s material', () => {
    const issues = factCheck({
      storyboard: board([scene({ id: 'a', duration: 3, visualType: 'statistic', onScreenText: ['87% faster'] })]),
      understanding,
    });
    expect(issues.some((i) => i.severity === 'blocker' && i.message.includes('87%'))).toBe(true);
  });

  it('allows a figure the customer actually published', () => {
    const issues = factCheck({
      storyboard: board([scene({ id: 'a', duration: 3, visualType: 'statistic', onScreenText: ['3x faster'] })]),
      understanding,
    });
    expect(issues.filter((i) => i.severity === 'blocker')).toEqual([]);
  });

  it('blocks a claim the customer explicitly excluded', () => {
    const issues = factCheck({
      storyboard: board([scene({ id: 'a', duration: 3, visualType: 'kinetic_typography', onScreenText: ['The fastest close on the market'] })]),
      understanding,
      excludedClaims: ['fastest close'],
    });
    expect(issues.some((i) => i.severity === 'blocker')).toBe(true);
  });

  it('flags a company named on screen that we never read about', () => {
    const issues = factCheck({
      storyboard: board([scene({ id: 'a', duration: 3, visualType: 'quote', onScreenText: ['Used every day at Initech'] })]),
      understanding,
    });
    expect(issues.some((i) => i.message.includes('Initech'))).toBe(true);
  });

  it('does not flag a customer we did read about', () => {
    const issues = factCheck({
      storyboard: board([scene({ id: 'a', duration: 3, visualType: 'quote', onScreenText: ['Used every day at Globex'] })]),
      understanding,
    });
    expect(issues.some((i) => i.message.includes('Globex'))).toBe(false);
  });

  it('does not treat a sentence-initial capital as a company name', () => {
    expect(extractProperNouns('Close the books. Every night.')).toEqual([]);
  });
});

describe('repair planning', () => {
  function report(issues: QaReport['issues']): QaReport {
    return {
      id: 'qa_1', renderId: 'rnd_1', projectId: 'prj_1',
      passed: !issues.some((i) => i.severity === 'blocker'),
      issues, repairActions: [], framesInspected: 4, createdAt: '2026-01-01T00:00:00.000Z',
    };
  }

  const issue = (over: Partial<QaReport['issues'][number]>) => ({
    id: newId('evt'), check: 'image_artifact' as const, severity: 'blocker' as const,
    sceneId: 's1', atSeconds: 1, message: 'artifact', evidenceAssetId: null,
    confidence: 0.9, repair: 'regenerate_shot' as const, detectedBy: 'vision' as const,
    ...over,
  });

  it('ships a clean film', () => {
    const plan = planRepairs(report([]), 0);
    expect(plan.shippable).toBe(true);
    expect(plan.scenes).toEqual([]);
  });

  it('repairs only the scene that broke', () => {
    const plan = planRepairs(report([issue({ sceneId: 's2' })]), 0);
    expect(plan.scenes).toHaveLength(1);
    expect(plan.scenes[0]!.sceneId).toBe('s2');
  });

  it('takes the most severe instruction when one scene has two problems', () => {
    const plan = planRepairs(
      report([
        issue({ sceneId: 's1', severity: 'major', repair: 'recrop' }),
        issue({ sceneId: 's1', severity: 'blocker', repair: 'regenerate_shot' }),
      ]),
      0,
    );
    expect(plan.scenes).toHaveLength(1);
    expect(plan.scenes[0]!.action).toBe('regenerate_shot');
  });

  it('stops rather than looping once the attempt budget is spent', () => {
    const plan = planRepairs(report([issue({})]), 2, 2);
    expect(plan.deadEnd).toBe(true);
    expect(plan.scenes).toEqual([]);
    expect(plan.manual.length).toBeGreaterThan(0);
  });

  it('routes what a model cannot fix to a person', () => {
    const plan = planRepairs(report([issue({ repair: 'manual_review', check: 'composition' })]), 0);
    expect(plan.manual).toHaveLength(1);
  });
});

describe('applyRepairs', () => {
  it('clears assets and marks the scene pending so new material is fetched', () => {
    const original = board([
      scene({ id: 's1', duration: 3, visualType: 'generated_broll', assetRefs: ['ast_bad'] }),
      scene({ id: 's2', duration: 4, visualType: 'product_ui', assetRefs: ['ast_ok'] }),
    ]);
    const { storyboard, needsProvider } = applyRepairs(original, {
      scenes: [{ sceneId: 's1', action: 'regenerate_shot', reason: 'artifact' }],
      manual: [], shippable: false, deadEnd: false,
    });

    expect(needsProvider).toEqual([{ sceneId: 's1', action: 'regenerate_shot' }]);
    expect(storyboard.scenes[0]!.assetRefs).toEqual([]);
    expect(storyboard.scenes[0]!.status).toBe('assets_pending');
    // Untouched scenes must be byte-identical, or the customer's approved work changes.
    expect(storyboard.scenes[1]).toEqual(original.scenes[1]);
  });

  it('grows a scene rather than cutting approved copy', () => {
    const original = board([
      scene({ id: 's1', duration: 2, visualType: 'kinetic_typography', onScreenText: ['Some words'] }),
    ]);
    const { storyboard } = applyRepairs(original, {
      scenes: [{ sceneId: 's1', action: 'reduce_duration', reason: 'too short to read' }],
      manual: [], shippable: false, deadEnd: false,
    });
    expect(storyboard.scenes[0]!.duration).toBeGreaterThan(2);
    expect(storyboard.scenes[0]!.onScreenText).toEqual(['Some words']);
  });

  it('re-times the film after removing a scene', () => {
    const original = board([
      scene({ id: 's1', duration: 3, visualType: 'kinetic_typography' }),
      scene({ id: 's2', duration: 4, visualType: 'generated_broll' }),
      scene({ id: 's3', duration: 2, visualType: 'logo_reveal' }),
    ]);
    const { storyboard } = applyRepairs(original, {
      scenes: [{ sceneId: 's2', action: 'remove_scene', reason: 'unfixable' }],
      manual: [], shippable: false, deadEnd: false,
    });
    expect(storyboard.scenes.map((s) => s.id)).toEqual(['s1', 's3']);
    expect(storyboard.scenes.map((s) => s.startTime)).toEqual([0, 3]);
  });
});

describe('frame selection', () => {
  it('prioritises generated and 3D scenes, where defects actually live', () => {
    const scenes = board([
      scene({ id: 'type', duration: 3, visualType: 'kinetic_typography' }),
      scene({ id: 'gen', duration: 3, visualType: 'generated_broll' }),
      scene({ id: 'threed', duration: 3, visualType: 'product_ui_3d' }),
    ]).scenes;

    const frames = selectFramesToInspect(scenes, { maxFrames: 2 });
    expect(frames.map((f) => f.scene.id).sort()).toEqual(['gen', 'threed']);
  });

  it('samples after motion has settled, not on the cut', () => {
    const scenes = board([scene({ id: 'a', duration: 4, visualType: 'generated_broll' })]).scenes;
    const [frame] = selectFramesToInspect(scenes);
    expect(frame!.atSeconds).toBeCloseTo(2.4);
  });

  it('returns frames in playback order', () => {
    const scenes = board([
      scene({ id: 'a', duration: 3, visualType: 'kinetic_typography' }),
      scene({ id: 'b', duration: 3, visualType: 'generated_broll' }),
      scene({ id: 'c', duration: 3, visualType: 'logo_reveal' }),
    ]).scenes;
    const frames = selectFramesToInspect(scenes);
    const times = frames.map((f) => f.atSeconds);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

/**
 * Standards enforcement.
 *
 * Each of these is a rule the platform was taught rather than a number
 * somebody picked, so each finding names the standard it comes from — a
 * customer or an operator can check whether we are right rather than having to
 * take our word for it.
 */
describe('professional standards', () => {
  it('blocks a figure on screen with nothing behind it, and says which rule', () => {
    const issues = runDeterministicChecks({
      storyboard: board([
        scene({
          id: 'a',
          duration: 4,
          visualType: 'statistic',
          onScreenText: ['3x faster'],
          claimEvidenceIds: [],
        }),
      ]),
      brand,
      aspect: '16:9',
    });

    const issue = issues.find((i) => i.check === 'unsupported_claim' && i.severity === 'blocker');
    expect(issue).toBeDefined();
    expect(issue!.message).toMatch(/Reuters/);
  });

  it('lets the same figure through once it cites its evidence', () => {
    const issues = runDeterministicChecks({
      storyboard: board([
        scene({
          id: 'a',
          duration: 4,
          visualType: 'statistic',
          onScreenText: ['3x faster'],
          claimEvidenceIds: ['evd_1'],
        }),
      ]),
      brand,
      aspect: '16:9',
      knownEvidenceIds: new Set(['evd_1']),
    });

    expect(issues.some((i) => i.check === 'unsupported_claim')).toBe(false);
  });

  it('catches the phrases that assert evidence without carrying any', () => {
    const issues = runDeterministicChecks({
      storyboard: board([
        scene({
          id: 'a',
          duration: 5,
          visualType: 'kinetic_typography',
          onScreenText: ['Industry-leading reconciliation'],
        }),
      ]),
      brand,
      aspect: '16:9',
    });

    const issue = issues.find((i) => i.message.includes('industry-leading'));
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('major');
  });

  it('catches a superlative that would need substantiating in law', () => {
    const issues = runDeterministicChecks({
      storyboard: board([
        scene({
          id: 'a',
          duration: 5,
          visualType: 'kinetic_typography',
          onScreenText: ['The only ledger that closes itself'],
        }),
      ]),
      brand,
      aspect: '16:9',
    });

    expect(issues.some((i) => /advertising law/.test(i.message))).toBe(true);
  });

  it('refuses a cut too short to register as a shot', () => {
    const issues = runDeterministicChecks({
      storyboard: board([scene({ id: 'a', duration: 0.3, visualType: 'transition' })]),
      brand,
      aspect: '16:9',
    });

    const issue = issues.find((i) => i.check === 'transition_quality');
    expect(issue).toBeDefined();
    expect(issue!.message).toMatch(/0\.5s floor/);
  });

  it('calls out an edit with no rhythm', () => {
    // Six scenes of exactly the same length. Every frame could be beautiful.
    const issues = runDeterministicChecks({
      storyboard: board(
        Array.from({ length: 6 }, (_, i) =>
          scene({ id: `s${i}`, duration: 3, visualType: 'kinetic_typography' }),
        ),
      ),
      brand,
      aspect: '16:9',
    });

    const issue = issues.find((i) => i.check === 'composition' && /rhythm/.test(i.message));
    expect(issue).toBeDefined();
  });

  it('calls out a film that opens on its own logo', () => {
    const issues = runDeterministicChecks({
      storyboard: board([
        scene({ id: 'a', duration: 4, visualType: 'logo_reveal' }),
        scene({ id: 'b', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Then the point'] }),
      ]),
      brand,
      aspect: '16:9',
    });

    expect(issues.some((i) => /opens on branding/.test(i.message))).toBe(true);
  });

  it('accepts a logo that is out of the way inside the hook', () => {
    const issues = runDeterministicChecks({
      storyboard: board([
        scene({ id: 'a', duration: 1.2, visualType: 'logo_reveal' }),
        scene({ id: 'b', duration: 3, visualType: 'kinetic_typography', onScreenText: ['The point'] }),
      ]),
      brand,
      aspect: '16:9',
    });

    expect(issues.some((i) => /opens on branding/.test(i.message))).toBe(false);
  });

  it('calls out a film whose meaning is only in the narration', () => {
    const issues = runDeterministicChecks({
      storyboard: board([
        scene({ id: 'a', duration: 4, visualType: 'kinetic_typography', narration: 'Everything is spoken.' }),
        scene({ id: 'b', duration: 4, visualType: 'transition', narration: 'Nothing is written.' }),
      ]),
      brand,
      aspect: '16:9',
    });

    expect(issues.some((i) => /muted playback/.test(i.message))).toBe(true);
  });
});
