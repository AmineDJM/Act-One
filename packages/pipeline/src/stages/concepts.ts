import { AppError } from '@act-one/core';
import { planFor } from '../entitlements.ts';
import { CreativeStrategyEngine } from '@act-one/creative';
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
  options: { rejectedConceptIds?: string[] } = {},
): Promise<{ conceptIds: string[]; divergence: number }> {
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

  await context.progress(0.2, 'Developing three directions');
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
  };
}
