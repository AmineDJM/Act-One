import { AppError } from '@act-one/core';
import { CopyWriter } from '@act-one/creative';
import type { StageContext } from '../context.ts';

/**
 * Launch copy stage.
 *
 * Runs after the film exists, from the same approved concept and the same
 * verified claims, so the page the film sits on argues the same thing the film
 * does. Cheap enough to run beside the campaign cuts and independent of them —
 * a copy failure must never cost somebody their cuts.
 */
export async function runCopy(context: StageContext): Promise<{ copyKitId: string; lines: number }> {
  const { store, project, organizationId } = context;

  if (!project.selectedConceptId) {
    throw new AppError('conflict', 'There is no approved concept to write from.');
  }

  await context.progress(0.1, 'Reading the approved direction');

  const [concept, understanding] = await Promise.all([
    store.concepts.get(organizationId, project.selectedConceptId),
    project.productUnderstandingId
      ? store.understandings.get(organizationId, project.productUnderstandingId)
      : store.understandings.getLatestForProject(organizationId, project.id),
  ]);

  if (!concept) throw new AppError('conflict', 'The approved concept is missing.');
  if (!understanding) throw new AppError('conflict', 'There is nothing understood about this product yet.');

  const treatment = await store.treatments.getForConcept(organizationId, concept.id);
  if (!treatment) throw new AppError('conflict', 'The treatment behind this concept is missing.');

  await context.progress(0.4, 'Writing the launch copy');

  const kit = await new CopyWriter(context.registry.llm()).write(
    { projectId: project.id, organizationId, concept, treatment, understanding, brief: project.brief },
    { organizationId, projectId: project.id },
  );

  await store.copy.create(kit);
  await context.progress(1, `${kit.lines.length} lines written`);

  return { copyKitId: kit.id, lines: kit.lines.length };
}
