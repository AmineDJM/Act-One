import { AppError } from '@act-one/core';
import { planFor } from '../entitlements.ts';
import { CreativeStrategyEngine } from '@act-one/creative';
import { runDirection, type DirectionResult } from './direction.ts';
import type { StageContext } from '../context.ts';

/**
 * Concept stage.
 *
 * Cheap relative to everything downstream, which is why it is the gate the
 * customer sees first: they decide whether the thinking is good before anybody
 * spends money on rendering it.
 */
export async function runConcepts(
  context: StageContext,
  options: { rejectedConceptIds?: string[]; direct?: boolean } = {},
): Promise<{ conceptIds: string[]; divergence: number; direction: DirectionResult | null }> {
  const { store, registry, project, organizationId } = context;

  await context.progress(0.05, 'Reading the brief');
  await context.activity({ step: 'strategy', kind: 'step', label: 'reading the brief', status: 'active' });

  const understanding = project.productUnderstandingId
    ? await store.understandings.get(organizationId, project.productUnderstandingId)
    : await store.understandings.getLatestForProject(organizationId, project.id);
  if (!understanding) {
    throw new AppError('conflict', 'Cannot develop concepts before the product is understood.');
  }

  const brand = project.brandId ? await store.brands.get(organizationId, project.brandId) : null;
  if (!brand) throw new AppError('conflict', 'Cannot develop concepts without a brand system.');

  const rejected = options.rejectedConceptIds?.length
    ? (
        await Promise.all(
          options.rejectedConceptIds.map((id) => store.concepts.get(organizationId, id)),
        )
      ).filter((concept): concept is NonNullable<typeof concept> => concept !== null)
    : [];

  /*
   * The direction comes first, and the concepts execute it.
   *
   * Without this the strategy engine is the whole of Act One's creative
   * thinking: three concepts, written straight off the research, compared
   * against each other and one of them picked. Three is not a search — it is
   * the first idea and two alternates written to make the first look
   * considered — and nothing anywhere had stated what the film was supposed
   * to do to the person watching it.
   *
   * So the Director Brain runs first: it builds what the film is for, who is
   * watching and how the brand behaves, explores a wide field of structurally
   * different directions, puts the whole wall to a panel kept apart so it can
   * disagree, and chooses one with the reason recorded. The concepts below are
   * then three ways of executing that choice.
   *
   * Optional and defaulted on, so a caller that predates it still works: a
   * production run with `direct: false` behaves exactly as this stage always
   * did.
   */
  const direction = options.direct === false ? null : await runDirection(context);

  await context.progress(0.6, 'Developing three directions');
  await context.activity({ step: 'strategy', kind: 'step', label: 'developing three directions', status: 'active' });

  /*
   * Three directions the customer can actually render.
   *
   * The concept estimates a runtime and the plan caps one, and nothing
   * reconciled them here — so a free account was shown three sixty-second
   * directions, chose one, and the storyboard silently cut it to thirty. The
   * film they approved was not the film they got. The storyboard stage has
   * capped this for a while; by then the promise has already been made.
   */
  const plan = await planFor(store, organizationId);

  const engine = new CreativeStrategyEngine(registry.llm());
  const result = await engine.generate(
    {
      projectId: project.id,
      understanding,
      brand,
      brief: project.brief,
      maxDurationSeconds: plan.limits.maxMasterDurationSeconds,
      rejectedConcepts: rejected,
      ...(direction
        ? {
            direction: {
              territory: direction.territory,
              brief: direction.brief,
              audience: direction.audience,
              genome: direction.genome,
            },
          }
        : {}),
    },
    { organizationId, projectId: project.id, signal: context.signal },
  );

  await context.progress(0.9, 'Writing them up');
  await context.activity({ step: 'strategy', kind: 'step', label: 'three structurally different directions', status: 'done' });
  await context.activity({ step: 'concepts', kind: 'step', label: 'writing the concepts up', status: 'active' });

  await store.concepts.createMany(result.concepts, organizationId);
  await store.projects.setStage(organizationId, project.id, 'concepts_ready');

  await context.activity({
    step: 'concepts',
    kind: 'step',
    label: `${result.concepts.length} concepts ready`,
    detail: `divergence ${Math.round(result.divergence * 100)}%`,
    status: 'done',
  });
  await context.progress(1, 'Ready');
  return {
    conceptIds: result.concepts.map((concept) => concept.id),
    divergence: result.divergence,
    direction,
  };
}
