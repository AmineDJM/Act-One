import {
  AppError,
  CreativeEscalation,
  Scene,
  Storyboard,
  coherentRecipe,
  isSourceMaterial,
  newId,
  recipeSuitsVisual,
  resequence,
  storyboardDuration,
  type CreativeReplan,
  type ProductionBudget,
} from '@act-one/core';
import {
  BeatDirector,
  allowedVisualTypesFor,
  estimateOptionCostUsd,
  normalizeOption,
  rejectOption,
  type ReplanOption,
} from '@act-one/creative';
import { checkStructure, contractFor } from '@act-one/qa';
import type { StageContext } from '../context.ts';

/**
 * The creative replan.
 *
 * This is the step that makes Act One an agency rather than a tool that
 * reports problems. The render and repair layers are deterministic and stay
 * that way; when they find a defect that editing a timeline cannot fix, they
 * stop and hand up a diagnosis. This stage is where a model is called, in a
 * job of its own, above the renderer — so nothing recurses and the render
 * worker never reaches for a director mid-render.
 *
 * What it does is narrow on purpose. It replaces the beats it was told about
 * and nothing else: every other shot keeps its material, its status and its
 * id, so the render that follows reuses them rather than making the film
 * again. A replan that rewrote the film would be cheaper to build and would
 * change work the customer already approved.
 *
 * The Director's proposals are not trusted. Each option is checked against the
 * same invariants the deterministic repairs are held to — the room filled
 * exactly, every shot readable in its own duration, no shot asking for
 * material we do not hold — and the cheapest surviving option that the
 * Director did not mark weaker is the one built. An option that fails is
 * recorded with its reason, so a director that keeps missing is visible.
 */
export async function runCreativeReplan(
  context: StageContext,
  options: { escalation: CreativeEscalation; budget: ProductionBudget; attempt?: number },
): Promise<{
  storyboardId: string | null;
  strategy: string;
  /** Null when nothing usable came back; the film is then held for a person. */
  replan: CreativeReplan | null;
}> {
  const { store, registry, organizationId, project } = context;
  const escalation = options.escalation;
  const attempt = options.attempt ?? 0;

  const storyboard = await store.storyboards.get(organizationId, escalation.storyboardId);
  if (!storyboard) throw new AppError('not_found', 'The storyboard to replan is gone.');

  const brand = project.brandId ? await store.brands.get(organizationId, project.brandId) : null;
  if (!brand) throw new AppError('conflict', 'No brand system for this project.');

  const concept = await store.concepts.get(organizationId, storyboard.conceptId);
  if (!concept) throw new AppError('conflict', 'The concept behind this storyboard is missing.');

  const understanding = project.productUnderstandingId
    ? await store.understandings.get(organizationId, project.productUnderstandingId)
    : null;

  const affected = storyboard.scenes.filter((scene) => escalation.sceneIds.includes(scene.id));
  if (affected.length === 0) {
    throw new AppError('conflict', 'The beats to replan are no longer in the film.');
  }

  await context.progress(0.2, 'Polishing the final cut');
  await context.activity({
    step: 'storyboard',
    kind: 'refine',
    label: 'creative escalation',
    detail: `${escalation.check} on ${affected.length} beat(s): ${escalation.diagnosis.slice(0, 200)}`,
    status: 'active',
  });

  /*
   * What we can actually make.
   *
   * A director asked for a product shot we cannot film will propose one, so
   * the material we hold is a fact in the brief rather than something the
   * model is left to infer from silence.
   */
  const held = (await store.assets.listForProject(organizationId, project.id)).filter(isSourceMaterial);
  const availableAssetKinds = [...new Set(held.map((asset) => asset.kind))];
  const hasFootage = held.some((asset) => asset.contentType.startsWith('video/'));

  const director = new BeatDirector(registry.llm());
  const room = round3(affected.reduce((sum, scene) => sum + scene.duration, 0));
  const briefFor = (refusals: string[]) => ({
    projectId: project.id,
    escalation,
    storyboard,
    affected,
    brand,
    brief: project.brief,
    concept,
    understanding,
    cut: project.brief.filmCut,
    availableAssetKinds,
    allowedVisualTypes: allowedVisualTypesFor({ hasFootage }),
    history: escalation.previousAttempts.map(
      (entry) => `${entry.action} on attempt ${entry.attempt} → ${entry.outcome}`,
    ),
    ...(refusals.length > 0 ? { refusals } : {}),
  });
  const callContext = {
    organizationId,
    projectId: project.id,
    ...(context.signal ? { signal: context.signal } : {}),
  };

  let proposal = await director.replan(briefFor([]), callContext);
  /*
   * What a new shot would cost, from the registry's own ceiling rather than a
   * guess: the cap on a single media request is what one generated shot can
   * cost us at most, which is the right number for deciding whether to ask.
   */
  const generatedShotUsd = registry.config.media.maxCostPerRequestUsd || DEFAULT_GENERATED_SHOT_USD;

  /*
   * Cheapest option that is not weaker, and not the first one offered.
   *
   * Quality first, then cost: an option the director marked weaker is never
   * taken however cheap it is, and among the rest the one that spends least
   * wins. Recomposing what we already hold is free; asking a provider for a
   * new shot is not, and the difference is usually the whole repair budget.
   */
  const cut = project.brief.filmCut === 'short' ? ('short' as const) : ('feature' as const);
  /*
   * One retry, with the reasons.
   *
   * A director whose copy is a few words short of the beat is one sentence
   * away from a usable proposal, and asking again costs three cents. Spending
   * a whole replan and another render to find that out costs two minutes of
   * the customer's time and a render worker's.
   */
  let rejected: { strategy: string; reason: string }[] = [];
  let usable: { option: ReplanOption; durations: number[]; costUsd: number }[] = [];
  let directionCostUsd = 0;

  for (let round = 0; round < 2; round += 1) {
    directionCostUsd += proposal.usage.costUsd;
    ({ rejected, usable } = sift(proposal.options));
    if (usable.length > 0 || round === 1) break;
    await context.activity({
      step: 'storyboard',
      kind: 'refine',
      label: 'creative escalation',
      detail: `asking again: ${rejected.map((entry) => entry.reason).join('; ')}`,
      status: 'active',
    });
    proposal = await director.replan(
      briefFor(rejected.map((entry) => `${entry.strategy}: ${entry.reason}`)),
      callContext,
    );
  }

  function sift(options: readonly ReplanOption[]) {
    const refused: { strategy: string; reason: string }[] = [];
    const kept: { option: ReplanOption; durations: number[]; costUsd: number }[] = [];
    for (const option of options) {
      const reason = rejectOption(option, room, { hasFootage, cut });
      if (reason) {
        refused.push({ strategy: option.strategy, reason });
        continue;
      }
    /*
     * The director authors; the arithmetic is ours. What goes into the film
     * is the normalised option, whose shots fill the beat exactly and none of
     * which holds past what its own copy earns.
     */
      const exact = normalizeOption(option, room, { cut });
      if (!exact.durations) {
        refused.push({ strategy: option.strategy, reason: exact.reason });
        continue;
      }
      kept.push({
        option,
        durations: exact.durations,
        costUsd: estimateOptionCostUsd(option, generatedShotUsd),
      });
    }
    return { rejected: refused, usable: kept };
  }
  usable.sort(
    (left, right) =>
      left.costUsd - right.costUsd || QUALITY_ORDER[right.option.quality] - QUALITY_ORDER[left.option.quality],
  );

  const chosen = usable.find((entry) => entry.costUsd <= options.budget.providerCostUsd) ?? null;
  if (!chosen) {
    await context.activity({
      step: 'storyboard',
      kind: 'refine',
      label: 'creative escalation',
      detail:
        rejected.length > 0
          ? `no usable option: ${rejected.map((entry) => `${entry.strategy} — ${entry.reason}`).join('; ')}`
          : 'every option the director gave costs more than the budget left.',
      status: 'failed',
    });
    return { storyboardId: null, strategy: '', replan: null };
  }

  /*
   * The new cut: the affected beats replaced, everything else untouched.
   *
   * Untouched means the same scene object — same id, same material, same
   * `ready` status — so the render reuses what it already made. Regenerating
   * scenes nobody complained about costs money, costs minutes, and hands the
   * customer a different film from the one they approved.
   */
  /*
   * The film's voice is not the director's to change.
   *
   * A beat is being repaired, and `narration` is a field the director can
   * fill. Left unchecked, a silent film acquires a voice-over because one
   * beat was rewritten — which changes the whole sound design, costs a speech
   * provider on every future render, and is not what anybody approved. A film
   * that speaks keeps speaking; one that does not, does not.
   */
  const speaks = storyboard.voiceStrategy !== 'none';
  const replacement = chosen.option.shots.map((shot, index) =>
    Scene.parse({
      id: newId('scn'),
      storyboardId: '',
      index,
      startTime: 0,
      duration: chosen.durations[index] ?? round3(shot.duration),
      purpose: shot.purpose,
      narration: speaks ? shot.narration : '',
      onScreenText: shot.onScreenText,
      visualType: shot.visualType,
      motionRecipe: {
        name: recipeSuitsVisual(shot.motionRecipe, shot.visualType)
          ? shot.motionRecipe
          : coherentRecipe(shot.visualType, shot.motionRecipe),
      },
      cameraRecipe: {},
      voiceOver: speaks && shot.narration.length > 0,
      transition: 'cut',
      notes: shot.justification,
      status: 'draft',
    }),
  );

  const firstIndex = storyboard.scenes.findIndex((scene) => scene.id === affected[0]!.id);
  const kept = storyboard.scenes.filter((scene) => !escalation.sceneIds.includes(scene.id));
  const before = kept.slice(0, firstIndex);
  const after = kept.slice(firstIndex);

  const nextStoryboardId = newId('sbd');
  const candidate: Storyboard = resequence({
    ...storyboard,
    id: nextStoryboardId,
    version: storyboard.version + 1,
    parentStoryboardId: storyboard.id,
    revisionReason: `${chosen.option.strategy}: ${chosen.option.reasoning}`.slice(0, 600),
    status: 'approved',
    scenes: [...before, ...replacement, ...after].map((scene) => ({
      ...scene,
      storyboardId: nextStoryboardId,
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  /*
   * The Director is held to the contract too.
   *
   * Same check, same invariants: a proposal that would leave the film the
   * wrong length or a shot nobody can read is refused here rather than after a
   * render has been spent finding out.
   */
  const contract = contractFor(storyboard, { cut: project.brief.filmCut });
  const violations = checkStructure(candidate, contract, {
    removing: escalation.sceneIds,
  });
  if (violations.length > 0) {
    await context.activity({
      step: 'storyboard',
      kind: 'refine',
      label: 'creative escalation',
      detail: `the director's cut broke the contract: ${violations[0]!.message}`,
      status: 'failed',
    });
    return { storyboardId: null, strategy: chosen.option.strategy, replan: null };
  }

  await store.storyboards.create(candidate, organizationId);
  await store.projects.update(organizationId, project.id, { activeStoryboardId: candidate.id });

  const record = await store.replans.create(
    {
      id: newId('evt'),
      organizationId,
      projectId: project.id,
      renderId: escalation.renderId,
      fromStoryboardId: storyboard.id,
      toStoryboardId: candidate.id,
      sceneIds: escalation.sceneIds,
      check: escalation.check,
      diagnosis: proposal.diagnosis,
      strategy: chosen.option.strategy,
      reasoning: chosen.option.reasoning,
      options: proposal.options.map((option) => ({ ...option })),
      rejected,
      attempt,
      directionCostUsd,
      estimatedCostUsd: chosen.costUsd,
      model: proposal.usage.model,
      scenesReused: kept.length,
      scenesRecomposed: replacement.filter((scene) => scene.assetRefs.length === 0).length,
      scenesRegenerated: replacement.filter((scene) => NEEDS_PROVIDER.has(scene.visualType)).length,
      createdAt: new Date().toISOString(),
    },
    organizationId,
  );

  await context.activity({
    step: 'storyboard',
    kind: 'refine',
    label: 'creative escalation',
    detail:
      `${chosen.option.strategy} on beat ${firstIndex + 1}: ${affected.length} → ` +
      `${replacement.length} shot(s), ${kept.length} reused, ` +
      `$${directionCostUsd.toFixed(4)} direction, $${chosen.costUsd.toFixed(4)} to make. ` +
      `Film ${storyboardDuration(candidate).toFixed(2)}s.`,
    status: 'done',
  });

  return { storyboardId: candidate.id, strategy: chosen.option.strategy, replan: record };
}

/** Better beats comparable at the same price; weaker never gets here. */
const QUALITY_ORDER: Record<ReplanOption['quality'], number> = {
  better: 2,
  comparable: 1,
  weaker: 0,
};

/** Visual types that need a provider to make, so the estimate is not zero. */
const NEEDS_PROVIDER: ReadonlySet<string> = new Set([
  'generated_broll',
  'cinematic_3d',
  'product_ui_3d',
]);

/** What one generated shot costs, when the registry has no figure of its own. */
const DEFAULT_GENERATED_SHOT_USD = 0.4;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
