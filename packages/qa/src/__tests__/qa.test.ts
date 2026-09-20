import { describe, it, expect } from 'vitest';
import {
  BrandSystem as BrandSystemSchema,
  QaIssue,
  QaReport,
  type RepairRecord,
  HELD_FRAME_CEILING,
  newId,
  readingSecondsFor,
  resequence,
  type BrandSystem,
  type Scene,
  type Storyboard,
} from '@act-one/core';
import { neutralRamp } from '@act-one/design';
import {
  runDeterministicChecks,
  factCheck,
  planRepairs,
  applyRepairs,
  selectFramesToInspect,
  extractProperNouns,
  settleRepairs,
  type SceneRepair,
} from '../index.ts';

const brand: BrandSystem = BrandSystemSchema.parse({
  id: 'brd_1', organizationId: 'org_1', name: 'Northwind', logo: null, logoVariants: [],
  primaryColor: '#2f6fed', secondaryColor: '#8fb2f7', accentColors: [], primaryCandidates: ['#2f6fed'],
  neutrals: neutralRamp('#2f6fed', 9, 0.05), canvasDark: '#08080c', canvasLight: '#ffffff',
  typography: [], visualStyle: 'minimal', imageTreatment: 'none', layoutDensity: 'balanced',
  cornerStyle: 'subtle', cornerRadiusPx: 8, motionStyle: 'precise', tone: 'Plain.',
  allowsGlow: false, allowsGradient: false, confirmedByUser: true, sources: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

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
    scenes, voiceStrategy: 'none', language: null, musicDirection: '', parentStoryboardId: null, revisionReason: '', status: 'draft',
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
    const issue = issues.find((i) => i.check === 'text_overflow' && i.severity === 'hard_fail');
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
    expect(issue?.severity).toBe('hard_fail');
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
    expect(issues.some((i) => i.check === 'legible_generated_text' && i.severity === 'hard_fail')).toBe(true);
  });

  /*
   * The film a customer opened and said "on dirait que c'est juste des
   * écritures sur un fond noir". Thirty seconds, eight shots, not one picture
   * in any of them — and it passed type, layout, colour, motion, pacing, sync
   * and delivery, because every one of those checks was true of it.
   */
  describe('a film with no picture in it', () => {
    const typeOnly = (count: number, each = 4) =>
      board(
        Array.from({ length: count }, (_, i) =>
          scene({
            id: `s${i}`,
            duration: each,
            visualType: 'kinetic_typography',
            onScreenText: ['Code.'],
          }),
        ),
      );

    it('does not ship as a product tour', () => {
      const issues = runDeterministicChecks({
        storyboard: typeOnly(8), brand, aspect: '16:9', format: 'product_tour',
      });
      const issue = issues.find((i) => i.message.includes('is a picture'));
      expect(issue?.severity).toBe('hard_fail');
      // No timeline edit puts a picture in it, so it goes to a person.
      expect(issue?.repair).toBe('manual_review');
    });

    /*
     * And is a note rather than a blocker as a pitch. A pitch carried in type
     * is a real film and sometimes the best one; a product tour that never
     * shows the product has not been made. The severity follows the format,
     * not the pixel count — a rule like "mostly black means failure" would
     * ban a whole legitimate register of film-making.
     */
    it('is a note when a director chose type for a pitch', () => {
      const issues = runDeterministicChecks({
        storyboard: typeOnly(8), brand, aspect: '16:9', format: 'pitch',
      });
      const issue = issues.find((i) => i.message.includes('is a picture'));
      expect(issue?.severity).toBe('soft_fail');
      expect(issue?.message).toContain('Intended, if the director chose it');
    });

    it('is a note, not a blocker, when the picture is merely thin', () => {
      const board_ = board([
        scene({ id: 'a', duration: 3, visualType: 'kinetic_typography', onScreenText: ['One.'] }),
        scene({ id: 'b', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Two.'] }),
        scene({ id: 'c', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Three.'] }),
        scene({ id: 'd', duration: 1.2, visualType: 'real_media', assetRefs: ['ast_1'] }),
      ]);
      const issues = runDeterministicChecks({ storyboard: board_, brand, aspect: '16:9' });
      const issue = issues.find((i) => i.message.includes('carries a picture'));
      expect(issue?.severity).toBe('soft_fail');
    });

    it('says nothing about a film that shows plenty', () => {
      const board_ = board([
        scene({ id: 'a', duration: 3, visualType: 'kinetic_typography', onScreenText: ['One.'] }),
        scene({ id: 'b', duration: 4, visualType: 'real_media', assetRefs: ['ast_1'] }),
        scene({ id: 'c', duration: 3, visualType: 'generated_broll' }),
      ]);
      const issues = runDeterministicChecks({ storyboard: board_, brand, aspect: '16:9' });
      expect(issues.some((i) => i.message.includes('carries a picture'))).toBe(false);
      expect(issues.some((i) => i.message.includes('Nothing in this film is a picture'))).toBe(false);
    });

    it('flags a long run of title cards even in a film that does show something', () => {
      const board_ = board([
        scene({ id: 'a', duration: 4, visualType: 'real_media', assetRefs: ['ast_1'] }),
        scene({ id: 'b', duration: 3.5, visualType: 'kinetic_typography', onScreenText: ['One.'] }),
        scene({ id: 'c', duration: 3.2, visualType: 'statistic', onScreenText: ['1700', 'questions'] }),
        scene({ id: 'd', duration: 3.4, visualType: 'quote', onScreenText: ['Good.', 'Someone'] }),
        scene({ id: 'e', duration: 4, visualType: 'real_media', assetRefs: ['ast_2'] }),
      ]);
      const issues = runDeterministicChecks({ storyboard: board_, brand, aspect: '16:9' });
      const issue = issues.find((i) => i.message.includes('with nothing on screen'));
      expect(issue?.severity).toBe('soft_fail');
      // Anchored where the run begins, not at the top of the film.
      expect(issue?.sceneId).toBe('b');
      expect(issue?.timecodeStart).toBeCloseTo(4, 3);
    });

    it('holds a short to a tighter run than a film', () => {
      const runOf = (cut: 'feature' | 'short') =>
        runDeterministicChecks({
          storyboard: board([
            scene({ id: 'a', duration: 2, visualType: 'real_media', assetRefs: ['ast_1'] }),
            scene({ id: 'b', duration: 3, visualType: 'kinetic_typography', onScreenText: ['One.'] }),
            scene({ id: 'c', duration: 2.5, visualType: 'kinetic_typography', onScreenText: ['Two.'] }),
            scene({ id: 'd', duration: 2, visualType: 'real_media', assetRefs: ['ast_2'] }),
          ]),
          brand,
          aspect: '16:9',
          cut,
        }).some((i) => i.message.includes('with nothing on screen'));
      expect(runOf('short')).toBe(true);
      expect(runOf('feature')).toBe(false);
    });
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
    expect(issues.some((i) => i.check === 'unsupported_claim' && i.severity === 'hard_fail')).toBe(true);
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
    expect(issues.filter((i) => i.severity === 'hard_fail')).toEqual([]);
  });
});

describe('fact check', () => {
  const understanding = {
    id: 'pun_1', projectId: 'prj_1', name: 'Northwind', oneLiner: 'x', category: 'y',
    targetAudience: [], painPoints: [], keyBenefits: [], differentiators: [], coreFeatures: [],
    proofPoints: [], productMoments: [], strongestVisualMoments: [], tone: 'Plain.', brandTraits: [],
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
    expect(issues.some((i) => i.severity === 'hard_fail' && i.message.includes('87%'))).toBe(true);
  });

  it('allows a figure the customer actually published', () => {
    const issues = factCheck({
      storyboard: board([scene({ id: 'a', duration: 3, visualType: 'statistic', onScreenText: ['3x faster'] })]),
      understanding,
    });
    expect(issues.filter((i) => i.severity === 'hard_fail')).toEqual([]);
  });

  it('blocks a claim the customer explicitly excluded', () => {
    const issues = factCheck({
      storyboard: board([scene({ id: 'a', duration: 3, visualType: 'kinetic_typography', onScreenText: ['The fastest close on the market'] })]),
      understanding,
      excludedClaims: ['fastest close'],
    });
    expect(issues.some((i) => i.severity === 'hard_fail')).toBe(true);
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
  function report(issues: QaIssue[]): QaReport {
    return QaReport.parse({
      id: 'qa_1', renderId: 'rnd_1', projectId: 'prj_1',
      passed: !issues.some((i) => i.severity === 'hard_fail'),
      issues, framesInspected: 4, createdAt: '2026-01-01T00:00:00.000Z',
    });
  }

  const issue = (over: Partial<QaIssue>): QaIssue =>
    QaIssue.parse({
      id: newId('evt'), check: 'image_artifact', severity: 'hard_fail',
      sceneId: 's1', timecodeStart: 1, message: 'artifact',
      confidence: 0.9, repair: 'regenerate_shot', detectedBy: 'vision',
      ...over,
    });

  const failed = (over: Partial<RepairRecord>): RepairRecord => ({
    id: newId('evt'), issueId: 'evt_old', check: 'image_artifact', sceneId: 's1',
    action: 'regenerate_shot', attempt: 0, outcome: 'unchanged', level: 4,
    providerCostUsd: 0, computeMs: 0, estimatedComputeCostUsd: 0, wallClockMs: 0, note: '',
    ...over,
  });

  it('ships a clean film', () => {
    const plan = planRepairs({ report: report([]), attempt: 0 });
    expect(plan).toMatchObject({ shippable: true, state: 'ready' });
    expect(plan.scenes).toEqual([]);
  });

  it('repairs only the scene that broke', () => {
    const plan = planRepairs({ report: report([issue({ sceneId: 's2' })]), attempt: 0 });
    expect(plan.scenes).toHaveLength(1);
    expect(plan.scenes[0]).toMatchObject({ sceneId: 's2', escalated: false });
    expect(plan.state).toBe('repairing');
  });

  it('takes the most severe instruction when one scene has two problems', () => {
    const plan = planRepairs({
      report: report([
        issue({ sceneId: 's1', severity: 'soft_fail', repair: 'recrop' }),
        issue({ sceneId: 's1', severity: 'hard_fail', repair: 'regenerate_shot' }),
      ]),
      attempt: 0,
    });
    expect(plan.scenes).toHaveLength(1);
    expect(plan.scenes[0]!.action).toBe('regenerate_shot');
  });

  it('repairs a soft fail too, which is the whole reason the level exists', () => {
    const plan = planRepairs({
      report: report([issue({ severity: 'soft_fail', check: 'still_frame_hold', repair: 'trim_hold' })]),
      attempt: 0,
    });
    expect(plan.scenes[0]!.action).toBe('trim_hold');
  });

  it('sends a caption or an audio finding to the film, not to a scene', () => {
    const plan = planRepairs({
      report: report([
        issue({ check: 'caption_onset', severity: 'soft_fail', repair: 'retime_captions', sceneId: 's1' }),
        issue({ check: 'abrupt_music_end', severity: 'soft_fail', repair: 'refade_audio', sceneId: null }),
      ]),
      attempt: 0,
    });
    // Captions and the tail are properties of the track; before this they had
    // nowhere to go, because a plan could only name shots.
    expect(plan.film.map((repair) => repair.action).sort()).toEqual(['refade_audio', 'retime_captions']);
    expect(plan.scenes).toEqual([]);
  });

  it('asks for one retime, not one per caption', () => {
    const plan = planRepairs({
      report: report([
        issue({ check: 'caption_onset', severity: 'soft_fail', repair: 'retime_captions', sceneId: 's1' }),
        issue({ check: 'caption_offset', severity: 'soft_fail', repair: 'retime_captions', sceneId: 's2' }),
      ]),
      attempt: 0,
    });
    // The second would undo the first.
    expect(plan.film).toHaveLength(1);
  });

  it('escalates to another provider once the same repair has failed', () => {
    const history = [failed({ action: 'regenerate_shot' })];
    const plan = planRepairs({ report: report([issue({})]), attempt: 1, history });
    expect(plan.scenes[0]).toMatchObject({ action: 'alternate_provider', escalated: true });
  });

  it('escalates again to another archetype, then to a person', () => {
    const twice = [failed({ action: 'regenerate_shot' }), failed({ action: 'alternate_provider', attempt: 1 })];
    expect(
      planRepairs({ report: report([issue({})]), attempt: 2, maxAttempts: 4, history: twice }).scenes[0],
    ).toMatchObject({ action: 'alternate_archetype' });

    const thrice = [...twice, failed({ action: 'alternate_archetype', attempt: 2 })];
    const exhausted = planRepairs({ report: report([issue({})]), attempt: 3, maxAttempts: 4, history: thrice });
    expect(exhausted.scenes).toEqual([]);
    expect(exhausted.manual).toHaveLength(1);
  });

  it('does not escalate a repair that worked', () => {
    const history = [failed({ action: 'regenerate_shot', outcome: 'fixed' })];
    const plan = planRepairs({ report: report([issue({})]), attempt: 1, history });
    expect(plan.scenes[0]).toMatchObject({ action: 'regenerate_shot', escalated: false });
  });

  it('stops rather than looping once the attempt budget is spent', () => {
    const plan = planRepairs({ report: report([issue({})]), attempt: 2, maxAttempts: 2 });
    expect(plan).toMatchObject({ deadEnd: true, state: 'needs_attention' });
    expect(plan.scenes).toEqual([]);
    expect(plan.manual.length).toBeGreaterThan(0);
  });

  it('routes what a model cannot fix to a person', () => {
    const plan = planRepairs({
      report: report([issue({ repair: 'manual_review', check: 'composition' })]),
      attempt: 0,
    });
    expect(plan.manual).toHaveLength(1);
    expect(plan.state).toBe('needs_attention');
  });

  it('does not hold a draft the customer is still changing', () => {
    const plan = planRepairs({ report: report([issue({})]), attempt: 0, deliverable: false });
    expect(plan).toMatchObject({ shippable: true, state: 'ready' });
  });
});

describe('what a repair achieved', () => {
  const record = (over: Partial<RepairRecord> = {}): RepairRecord => ({
    id: newId('evt'), issueId: 'evt_1', check: 'still_frame_hold', sceneId: 's1',
    action: 'trim_hold', attempt: 0, outcome: 'unchanged', level: 1,
    providerCostUsd: 0, computeMs: 0, estimatedComputeCostUsd: 0, wallClockMs: 0, note: '',
    ...over,
  });
  const finding = (check: QaIssue['check'], sceneId: string | null = 's1'): QaIssue =>
    QaIssue.parse({ id: newId('evt'), check, severity: 'soft_fail', sceneId, message: 'x' });

  it('calls it fixed when the finding does not come back', () => {
    const [settled] = settleRepairs({
      attempted: [record()],
      before: [finding('still_frame_hold')],
      after: [],
      providerCostUsd: 0.4,
      computeMs: 20_000,
      estimatedComputeCostUsd: 0.0025,
      wallClockMs: 20_000,
    });
    expect(settled).toMatchObject({
      outcome: 'fixed',
      providerCostUsd: 0.4,
      wallClockMs: 20_000,
      // Not zero. A deterministic repair pays no provider and still costs a render.
      estimatedComputeCostUsd: 0.0025,
    });
  });

  it('calls it unchanged when it does, which is what drives the escalation', () => {
    const [settled] = settleRepairs({
      attempted: [record()],
      // A re-render gives the same defect a new id, so matching on the id
      // would have reported every repair as a success.
      before: [finding('still_frame_hold')],
      after: [finding('still_frame_hold')],
      providerCostUsd: 0,
      computeMs: 0,
      estimatedComputeCostUsd: 0,
      wallClockMs: 0,
    });
    expect(settled).toMatchObject({ outcome: 'unchanged', note: 'The finding came back.' });
  });

  it('calls it worse when the pass fixed one thing and broke another', () => {
    const [settled] = settleRepairs({
      attempted: [record()],
      before: [finding('still_frame_hold')],
      after: [finding('text_overflow', 's2')],
      providerCostUsd: 0,
      computeMs: 0,
      estimatedComputeCostUsd: 0,
      wallClockMs: 0,
    });
    expect(settled!.outcome).toBe('worse');
    expect(settled!.note).toMatch(/introduced 1 new finding/);
  });

  it('divides one render’s cost and wait across the repairs that shared it', () => {
    const settled = settleRepairs({
      attempted: [record(), record({ sceneId: 's2', check: 'text_overflow' })],
      before: [],
      after: [],
      providerCostUsd: 1,
      computeMs: 30_000,
      estimatedComputeCostUsd: 0.004,
      wallClockMs: 30_000,
    });
    expect(settled.map((entry) => entry.providerCostUsd)).toEqual([0.5, 0.5]);
    /*
     * Shares of one pass, not two measurements.
     *
     * Several deterministic repairs go into one candidate and one render, so
     * reporting the pass's whole wall clock against each record would say the
     * pass took twice as long as it did — which is how "one render" came to
     * read as "two renders" in a report.
     */
    expect(settled.map((entry) => entry.wallClockMs)).toEqual([15_000, 15_000]);
    expect(settled.map((entry) => entry.computeMs)).toEqual([15_000, 15_000]);
  });
});

/** A scene repair with the bookkeeping the planner fills in. */
function sceneRepair(over: { sceneId: string; action: SceneRepair['action']; reason: string }): SceneRepair {
  return { issueId: 'evt_1', check: 'image_artifact', escalated: false, ...over };
}

/** A held-frame finding, which is what `trim_hold` reads to know how much to cut. */
function held(sceneId: string, start: number, end: number): QaIssue {
  return QaIssue.parse({
    id: newId('evt'), check: 'still_frame_hold', severity: 'soft_fail', layer: 'visual',
    sceneId, timecodeStart: start, timecodeEnd: end, message: 'nothing moves',
    confidence: 0.9, repair: 'trim_hold', detectedBy: 'temporal',
  });
}

describe('applyRepairs', () => {
  it('clears assets and marks the scene pending so new material is fetched', () => {
    const original = board([
      scene({ id: 's1', duration: 3, visualType: 'generated_broll', assetRefs: ['ast_bad'] }),
      scene({ id: 's2', duration: 4, visualType: 'product_ui', assetRefs: ['ast_ok'] }),
    ]);
    const { storyboard, needsProvider } = applyRepairs(original, {
      scenes: [sceneRepair(sceneRepair({ sceneId: 's1', action: 'regenerate_shot', reason: 'artifact' }))],
      film: [], manual: [], state: 'repairing', shippable: false, deadEnd: false,
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
      scenes: [sceneRepair(sceneRepair({ sceneId: 's1', action: 'reduce_duration', reason: 'too short to read' }))],
      film: [], manual: [], state: 'repairing', shippable: false, deadEnd: false,
    });
    expect(storyboard.scenes[0]!.duration).toBeGreaterThan(2);
    expect(storyboard.scenes[0]!.onScreenText).toEqual(['Some words']);
  });

  it('never trims a held shot below the time its words take to read', () => {
    const copy = ['Six words is enough to measure'];
    const original = board([
      scene({ id: 's1', duration: 4, visualType: 'kinetic_typography', onScreenText: copy }),
    ]);
    const { storyboard } = applyRepairs(
      original,
      {
        scenes: [sceneRepair({ sceneId: 's1', action: 'trim_hold', reason: 'held' })],
        film: [], manual: [], state: 'repairing', shippable: false, deadEnd: false,
      },
      { issues: [held('s1', 0.2, 4)] },
    );

    /*
     * Trading a soft fail for a hard one is not a repair. The arithmetic alone
     * wants 1.72s here, which is below what six words need, and the next pass
     * came back with `text_overflow` — a worse defect than the hold.
     */
    const floor = readingSecondsFor(copy.join(' '));
    expect(storyboard.scenes[0]!.duration).toBeLessThan(4);
    expect(storyboard.scenes[0]!.duration).toBeGreaterThanOrEqual(floor);
  });

  it('leaves a shot alone when there is nothing to trim off it', () => {
    const original = board([
      scene({
        id: 's1', duration: 3, visualType: 'kinetic_typography',
        onScreenText: ['Eight words is more than this shot can lose'],
      }),
    ]);
    const { storyboard } = applyRepairs(
      original,
      {
        scenes: [sceneRepair({ sceneId: 's1', action: 'trim_hold', reason: 'held' })],
        film: [], manual: [], state: 'repairing', shippable: false, deadEnd: false,
      },
      { issues: [held('s1', 0.2, 3)] },
    );
    // Untouched, so the repair settles as `unchanged` and escalates to a
    // person rather than shaving frames off a shot that cannot spare them.
    expect(storyboard.scenes[0]).toEqual(original.scenes[0]);
  });

  it('cuts a held shot back to the part that moved, in one pass', () => {
    const original = board([
      scene({ id: 's1', duration: 6, visualType: 'generated_broll', assetRefs: ['ast_ok'] }),
    ]);
    const { storyboard } = applyRepairs(
      original,
      {
        scenes: [sceneRepair({ sceneId: 's1', action: 'trim_hold', reason: 'held' })],
        film: [], manual: [], state: 'repairing', shippable: false, deadEnd: false,
      },
      { issues: [held('s1', 1.5, 6)] },
    );

    /*
     * The shot moved for 1.5s and then stopped. What is left is those 1.5s
     * plus the beat a film is allowed to hold — so the recheck finds a hold
     * inside the ceiling rather than a slightly shorter violation, which is
     * what a proportional trim produced and what spent the attempt budget.
     */
    expect(storyboard.scenes[0]!.duration).toBe(round3(1.5 + HELD_FRAME_CEILING.feature - TRIM_MARGIN));
  });

  it('holds a reel to a tighter beat than a film', () => {
    const original = board([scene({ id: 's1', duration: 6, visualType: 'generated_broll' })]);
    const plan = {
      scenes: [sceneRepair({ sceneId: 's1', action: 'trim_hold' as const, reason: 'held' })],
      film: [], manual: [], state: 'repairing' as const, shippable: false, deadEnd: false,
    };
    const short = applyRepairs(original, plan, { issues: [held('s1', 1.5, 6)], cut: 'short' });
    expect(short.storyboard.scenes[0]!.duration).toBe(round3(1.5 + HELD_FRAME_CEILING.short - TRIM_MARGIN));
  });

  it('re-times the film after removing a scene', () => {
    const original = board([
      scene({ id: 's1', duration: 3, visualType: 'kinetic_typography' }),
      scene({ id: 's2', duration: 4, visualType: 'generated_broll' }),
      scene({ id: 's3', duration: 2, visualType: 'logo_reveal' }),
    ]);
    const { storyboard } = applyRepairs(original, {
      scenes: [sceneRepair({ sceneId: 's2', action: 'remove_scene', reason: 'unfixable' })],
      film: [], manual: [], state: 'repairing', shippable: false, deadEnd: false,
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
    expect(frame!.timecodeStart).toBeCloseTo(2.4);
  });

  it('returns frames in playback order', () => {
    const scenes = board([
      scene({ id: 'a', duration: 3, visualType: 'kinetic_typography' }),
      scene({ id: 'b', duration: 3, visualType: 'generated_broll' }),
      scene({ id: 'c', duration: 3, visualType: 'logo_reveal' }),
    ]).scenes;
    const frames = selectFramesToInspect(scenes);
    const times = frames.map((f) => f.timecodeStart);
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

    const issue = issues.find((i) => i.check === 'unsupported_claim' && i.severity === 'hard_fail');
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
    expect(issue!.severity).toBe('soft_fail');
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

describe('the end card', () => {
  const board1 = () =>
    board([scene({ id: 'a', duration: 4, visualType: 'logo_reveal', onScreenText: ['Northwind'] })]);

  it('accepts the company\u2019s own address', () => {
    const issues = runDeterministicChecks({
      storyboard: board1(),
      brand,
      aspect: '16:9',
      cta: 'northwind.example',
    });
    expect(issues.some((i) => /names no action/.test(i.message))).toBe(false);
  });

  it('rejects a call to action that names no action', () => {
    const issues = runDeterministicChecks({
      storyboard: board1(),
      brand,
      aspect: '16:9',
      cta: 'Learn more',
    });
    const issue = issues.find((i) => /names no action/.test(i.message));
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('soft_fail');
  });

  it('has no opinion when no end card was asked for', () => {
    const issues = runDeterministicChecks({ storyboard: board1(), brand, aspect: '16:9' });
    expect(issues.some((i) => /names no action/.test(i.message))).toBe(false);
  });
});

describe('scenes that show nothing', () => {
  it('blocks a typographic scene with no type', () => {
    // Three of these shipped in one film: six seconds of black in twenty-four,
    // past every check the system had.
    const issues = runDeterministicChecks({
      storyboard: board([scene({ id: 'a', duration: 2.2, visualType: 'kinetic_typography' })]),
      brand,
      aspect: '16:9',
    });

    const issue = issues.find((i) => /renders as .* of black/.test(i.message));
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('hard_fail');
    expect(issue!.repair).toBe('remove_scene');
  });

  it('accepts a logo reveal, which composes itself', () => {
    const issues = runDeterministicChecks({
      storyboard: board([scene({ id: 'a', duration: 3, visualType: 'logo_reveal' })]),
      brand,
      aspect: '16:9',
    });
    expect(issues.some((i) => /of black/.test(i.message))).toBe(false);
  });

  it('accepts a scene carried by a capture rather than by words', () => {
    const issues = runDeterministicChecks({
      storyboard: board([
        scene({ id: 'a', duration: 3, visualType: 'screenshot_motion', assetRefs: ['ast_1'] }),
      ]),
      brand,
      aspect: '16:9',
    });
    expect(issues.some((i) => /of black/.test(i.message))).toBe(false);
  });

  it('removes a scene rather than emptying it when repairing copy', () => {
    /*
     * `rewrite_copy` strips a scene's text to take out an unsupported claim.
     * Applied to a typographic scene that was carrying nothing else, it used to
     * leave a black frame — the repair loop manufacturing the defect the rest
     * of QA exists to catch.
     */
    const storyboard = board([
      scene({ id: 'a', duration: 3, visualType: 'kinetic_typography', onScreenText: ['400% faster'] }),
      scene({ id: 'b', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Second scene'] }),
    ]);

    const repaired = applyRepairs(storyboard, {
      scenes: [sceneRepair({ sceneId: 'a', action: 'rewrite_copy', reason: 'unsupported claim' })],
      film: [],
      manual: [],
      state: 'repairing',
      shippable: false,
      deadEnd: false,
    });

    expect(repaired.storyboard.scenes.map((s) => s.id)).toEqual(['b']);
  });

  it('keeps a repaired scene that still has a capture to show', () => {
    const storyboard = board([
      scene({
        id: 'a',
        duration: 3,
        visualType: 'screenshot_motion',
        onScreenText: ['400% faster'],
        assetRefs: ['ast_1'],
      }),
    ]);

    const repaired = applyRepairs(storyboard, {
      scenes: [sceneRepair({ sceneId: 'a', action: 'rewrite_copy', reason: 'unsupported claim' })],
      film: [],
      manual: [],
      state: 'repairing',
      shippable: false,
      deadEnd: false,
    });

    expect(repaired.storyboard.scenes).toHaveLength(1);
    expect(repaired.storyboard.scenes[0]!.onScreenText).toEqual([]);
  });
});

describe('copy that stops mid-thought', () => {
  it('catches a line ending on a preposition', () => {
    const issues = runDeterministicChecks({
      storyboard: board([
        scene({
          id: 'a',
          duration: 4,
          visualType: 'kinetic_typography',
          onScreenText: ['See the difference at'],
        }),
      ]),
      brand,
      aspect: '16:9',
    });
    expect(issues.some((i) => /ends mid-thought/.test(i.message))).toBe(true);
  });

  it('leaves a complete line alone', () => {
    const issues = runDeterministicChecks({
      storyboard: board([
        scene({
          id: 'a',
          duration: 4,
          visualType: 'kinetic_typography',
          onScreenText: ['See the difference.'],
        }),
      ]),
      brand,
      aspect: '16:9',
    });
    expect(issues.some((i) => /ends mid-thought/.test(i.message))).toBe(false);
  });
});

describe('a film that repeats itself', () => {
  it('catches the same line twice', () => {
    // "Momentum, restored." was scene 5 and scene 17 of a 48s film. Every
    // frame was fine; the film was not.
    const issues = runDeterministicChecks({
      storyboard: board([
        scene({ id: 'a', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Momentum, restored.'] }),
        scene({ id: 'b', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Order from chaos'] }),
        scene({ id: 'c', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Momentum restored'] }),
      ]),
      brand,
      aspect: '16:9',
    });

    const issue = issues.find((i) => /is on screen 2 times/.test(i.message));
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('soft_fail');
  });

  it('allows a single word to repeat as a rhythmic device', () => {
    const issues = runDeterministicChecks({
      storyboard: board([
        scene({ id: 'a', duration: 2, visualType: 'kinetic_typography', onScreenText: ['Faster.'] }),
        scene({ id: 'b', duration: 2, visualType: 'kinetic_typography', onScreenText: ['Faster.'] }),
      ]),
      brand,
      aspect: '16:9',
    });
    expect(issues.some((i) => /is on screen/.test(i.message))).toBe(false);
  });

  it('leaves a film that says each thing once alone', () => {
    const issues = runDeterministicChecks({
      storyboard: board([
        scene({ id: 'a', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Order from chaos'] }),
        scene({ id: 'b', duration: 3, visualType: 'kinetic_typography', onScreenText: ['Chaos from order'] }),
      ]),
      brand,
      aspect: '16:9',
    });
    expect(issues.some((i) => /is on screen/.test(i.message))).toBe(false);
  });
});

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * How far inside the ceiling a trimmed hold lands, mirroring the repair's own
 * HOLD_TRIM_MARGIN. Written out here rather than imported so that moving it
 * has to be a decision: these numbers are what the customer sees as the length
 * of a shot.
 */
const TRIM_MARGIN = 0.1;
