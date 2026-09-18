import { AppError, rankLibraryAssets, storyboardEstimatedCost } from '@act-one/core';
import { planFor } from '../entitlements.ts';
import { CreativeDirector, StoryboardEngine, detectLanguage } from '@act-one/creative';
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
  await context.activity({ step: 'storyboard', kind: 'step', label: 'writing the treatment', status: 'active' });

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
  await context.activity({ step: 'storyboard', kind: 'step', label: 'building the storyboard', status: 'active' });

  const version = await store.storyboards.nextVersion(organizationId, project.id);

  /*
   * Plan a film the customer can actually render.
   *
   * The concept estimates a runtime and the plan caps one, and nothing
   * reconciled them: a free account whose plan renders thirty seconds got a
   * storyboard of forty-eight, approved it, pressed render, and was told its
   * plan renders up to thirty. The ceiling belongs at planning time, where it
   * costs nothing, rather than at the one moment the customer has decided they
   * want the film.
   */
  const plan = await planFor(store, organizationId);
  const ceiling = plan.limits.maxMasterDurationSeconds;
  const wanted =
    project.brief.durationSeconds ?? concept.estimatedDurationSeconds ?? ceiling;
  const target = Math.min(wanted, ceiling);

  /*
   * Real assets first. Everything the library holds for this project — what
   * the customer uploaded and shared, what the research kept — is put in
   * front of the planner before it may imagine anything, approved pictures
   * first. Generative shots are for what nobody has a picture of.
   */
  const libraryAssets = rankLibraryAssets(
    await store.assets.listLibraryForProject(organizationId, project.id),
  ).filter((asset) => asset.contentType.startsWith('image/'));
  if (libraryAssets.length > 0) {
    await context.activity({
      step: 'storyboard',
      kind: 'note',
      label: `${libraryAssets.length} real asset${libraryAssets.length === 1 ? '' : 's'} from the library offered first`,
      status: 'done',
    });
  }

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
      targetDurationSeconds: target,
      libraryAssets,
    },
    call,
  );

  await context.progress(0.85, 'Checking it will actually work');
  await context.activity({ step: 'storyboard', kind: 'step', label: 'checking timing, legibility and budget', status: 'active' });

  // Legibility, timing and budget, decided on paper.
  const issues = runDeterministicChecks({
    storyboard: built.storyboard,
    brand,
    aspect: '16:9',
    knownEvidenceIds: new Set(understanding.evidence.map((evidence) => evidence.id)),
  });
  const blockers = issues.filter((issue) => issue.severity === 'blocker');

  // The language the film was written in, so the voice can be chosen for
  // it. The brief's word when it gave one; otherwise asked of the copy.
  const language =
    project.brief.language ??
    (await detectLanguage(
      registry.llm(),
      built.storyboard.scenes.flatMap((scene) => [scene.narration, ...scene.onScreenText]),
      { organizationId, projectId: project.id },
    ));

  const storyboard = await store.storyboards.create(
    {
      ...built.storyboard,
      language,
      status: blockers.length > 0 ? 'draft' : 'awaiting_approval',
    },
    organizationId,
  );

  await store.projects.update(organizationId, project.id, {
    activeStoryboardId: storyboard.id,
    stage: 'storyboard_ready',
  });

  await context.activity({
    step: 'storyboard',
    kind: 'step',
    label: `${storyboard.scenes.length} scenes, ${Math.round(storyboard.scenes.reduce((sum, scene) => sum + scene.duration, 0))} seconds`,
    status: 'done',
  });
  await context.progress(1, 'Ready for review');

  return {
    storyboardId: storyboard.id,
    estimatedCostUsd: storyboardEstimatedCost(storyboard),
    blockers: blockers.length,
  };
}

