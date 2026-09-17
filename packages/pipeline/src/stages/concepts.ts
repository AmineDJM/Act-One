import { AppError } from '@act-one/core';
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

  const engine = new CreativeStrategyEngine(registry.llm());
  const result = await engine.generate(
    {
      projectId: project.id,
      understanding,
      brand,
      brief: project.brief,
      rejectedConcepts: rejected,
    },
    { organizationId, projectId: project.id, signal: context.signal },
  );

  await context.progress(0.9, 'Writing them up');

  await store.concepts.createMany(result.concepts, organizationId);
  await store.projects.setStage(organizationId, project.id, 'concepts_ready');

  await context.progress(1, 'Ready');
  return {
    conceptIds: result.concepts.map((concept) => concept.id),
    divergence: result.divergence,
  };
}
