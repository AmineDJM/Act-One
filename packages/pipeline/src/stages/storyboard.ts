import { AppError, storyboardEstimatedCost } from '@act-one/core';
import { CreativeDirector, StoryboardEngine } from '@act-one/creative';
import { runDeterministicChecks } from '@act-one/qa';
import type { StageContext } from '../context.ts';

/**
 * Storyboard stage.
 *
 * Treatment, then storyboard, then a deterministic QA pass before the customer
 * ever sees it. Everything expensive happens after this, so a defect caught
 * here costs nothing and the same defect caught after rendering costs a render.
 */
export async function runStoryboard(
  context: StageContext,
  options: { conceptId?: string } = {},
): Promise<{ storyboardId: string; estimatedCostUsd: number; blockers: number }> {
  const { store, registry, project, organizationId } = context;
  const call = { organizationId, projectId: project.id, signal: context.signal };

  const conceptId = options.conceptId ?? project.selectedConceptId;
  if (!conceptId) throw new AppError('conflict', 'No concept has been chosen.');

  const [concept, understanding, brand] = await Promise.all([
    store.concepts.get(organizationId, conceptId),
    project.productUnderstandingId
      ? store.understandings.get(organizationId, project.productUnderstandingId)
      : store.understandings.getLatestForProject(organizationId, project.id),
    project.brandId ? store.brands.get(organizationId, project.brandId) : null,
  ]);

  if (!concept) throw new AppError('not_found', 'Concept not found.');
  if (!understanding) throw new AppError('conflict', 'The product has not been understood yet.');
  if (!brand) throw new AppError('conflict', 'No brand system for this project.');

  await context.progress(0.1, 'Writing the treatment');

  // Reuse an existing treatment for this concept rather than writing a second
  // one: a customer revising a storyboard must not silently get a new film.
  const existing = await store.treatments.getForConcept(organizationId, concept.id);
  const treatment =
    existing ??
    (await store.treatments.create(
      await new CreativeDirector(registry.llm()).direct(
        { projectId: project.id, concept, understanding, brand, brief: project.brief },
        call,
      ),
      organizationId,
    ));

  await context.progress(0.4, 'Building the storyboard');

  const version = await store.storyboards.nextVersion(organizationId, project.id);
  const engine = new StoryboardEngine(registry.llm());
  const built = await engine.build(
    {
      projectId: project.id,
      concept,
      treatment,
      understanding,
      brand,
      brief: project.brief,
      version,
    },
    call,
  );

  await context.progress(0.85, 'Checking it will actually work');

  // Legibility, timing and budget, decided on paper.
  const issues = runDeterministicChecks({
    storyboard: built.storyboard,
    brand,
    aspect: '16:9',
    knownEvidenceIds: new Set(understanding.evidence.map((evidence) => evidence.id)),
  });
  const blockers = issues.filter((issue) => issue.severity === 'blocker');

  const storyboard = await store.storyboards.create(
    {
      ...built.storyboard,
      status: blockers.length > 0 ? 'draft' : 'awaiting_approval',
    },
    organizationId,
  );

  await store.projects.update(organizationId, project.id, {
    activeStoryboardId: storyboard.id,
    stage: 'storyboard_ready',
  });

  await context.progress(1, 'Ready for review');

  return {
    storyboardId: storyboard.id,
    estimatedCostUsd: storyboardEstimatedCost(storyboard),
    blockers: blockers.length,
  };
}

