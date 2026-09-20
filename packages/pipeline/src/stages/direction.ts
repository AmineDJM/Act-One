import {
  AudienceModel,
  BrandGenome,
  CreativeBrief,
  CreativeTerritory,
  REPETITION_WARNING_THRESHOLD,
  cutSeconds,
  repetitionAgainst,
  AppError,
  type CriticReview,
  type DirectorDecision,
} from '@act-one/core';
import {
  CriticPanel,
  DirectorBrain,
  TERRITORY_PANEL,
  TerritorySearchEngine,
  UnderstandingEngine,
} from '@act-one/creative';
import { planFor } from '../entitlements.ts';
import type { StageContext } from '../context.ts';

/**
 * Understanding, then searching, then choosing — before anything is written.
 *
 * This stage is the answer to a specific complaint about what came before it:
 * the pipeline went from a brief almost straight to three concepts, and three
 * is not a search. It is the first idea and two alternates written to make the
 * first one look considered.
 *
 * So there are four movements, in the order a studio actually works.
 *
 * It builds three models it never had — what the film is for, who is watching
 * and what they currently believe, and what the brand is like as a set of
 * behaviours rather than a palette. A concept written without those is a
 * concept about a product rather than about a person, and "increase demo
 * requests" cannot be directed while "a CTO should believe this removes a
 * painful workflow" can.
 *
 * It explores widely and cheaply, at the only stage where exploring is nearly
 * free, and measures whether the exploration actually explored — a model asked
 * for twenty directions returns twenty wordings of about three unless
 * something checks the structure.
 *
 * It shows the whole wall to five specialists who are kept apart so they can
 * disagree, because a panel that converges has told you nothing.
 *
 * And then one director chooses, records why, records what it gave up, and
 * records which conflict between two specialists it had to settle to choose.
 *
 * None of this is shown to the customer. What they see is that their film is
 * being directed.
 */
export type DirectionResult = {
  brief: CreativeBrief;
  audience: AudienceModel;
  genome: BrandGenome;
  territory: CreativeTerritory;
  decision: DirectorDecision;
  reviews: CriticReview[];
  /** How many directions were actually on the table, and how far apart. */
  explored: number;
  spread: number;
  costUsd: number;
};

export async function runDirection(context: StageContext): Promise<DirectionResult> {
  const { store, registry, project, organizationId } = context;
  const call = { organizationId, projectId: project.id, signal: context.signal };

  const understanding = project.productUnderstandingId
    ? await store.understandings.get(organizationId, project.productUnderstandingId)
    : await store.understandings.getLatestForProject(organizationId, project.id);
  if (!understanding) {
    throw new AppError('conflict', 'The film cannot be directed before the product is understood.');
  }
  const brand = project.brandId ? await store.brands.get(organizationId, project.brandId) : null;
  if (!brand) throw new AppError('conflict', 'The film cannot be directed without a brand system.');

  const plan = await planFor(store, organizationId);
  const cut = project.brief.filmCut;
  const duration = Math.min(
    cutSeconds(cut, project.brief.durationSeconds),
    plan.limits.maxMasterDurationSeconds,
  );

  let costUsd = 0;

  // --- Understanding -------------------------------------------------------
  await context.progress(0.05, 'Understanding your product');
  await context.activity({ step: 'strategy', kind: 'step', label: 'reading the product, the audience and the brand', status: 'active' });

  const models = await new UnderstandingEngine(registry.llm()).build(
    {
      projectId: project.id,
      brief: project.brief,
      understanding,
      brand,
      company: project.name,
      filmCut: cut,
      durationSeconds: duration,
      language: project.brief.language ?? (brand.communication.language || 'en'),
      productionBudgetUsd: plan.limits.maxMasterDurationSeconds > 0 ? project.costUsd : 0,
      productAccess: project.productCredentialId ? 'authenticated' : 'public_site',
    },
    call,
  );
  costUsd += models.costUsd;

  await Promise.all([
    store.creative.putModel(organizationId, {
      id: models.brief.id, projectId: project.id, kind: 'brief', version: models.brief.version,
      data: models.brief, createdAt: models.brief.createdAt,
    }),
    store.creative.putModel(organizationId, {
      id: models.audience.id, projectId: project.id, kind: 'audience', version: models.audience.version,
      data: models.audience, createdAt: models.audience.createdAt,
    }),
    store.creative.putModel(organizationId, {
      id: models.genome.id, projectId: project.id, kind: 'genome', version: models.genome.version,
      data: models.genome, createdAt: models.genome.createdAt,
    }),
  ]);

  await context.activity({
    step: 'strategy',
    kind: 'note',
    label: 'what this film has to change',
    // Operator-facing: the transformation is the single most useful line in
    // the whole production and the one every later decision is argued from.
    detail: `${models.brief.transformation.before} → ${models.brief.transformation.after}`,
    status: 'done',
  });

  // --- Searching -----------------------------------------------------------
  await context.progress(0.25, 'Developing creative directions');
  await context.activity({ step: 'strategy', kind: 'step', label: 'exploring directions', status: 'active' });

  const recentSignatures = await store.creative.recentSignatures(organizationId, 80);
  /*
   * How wide to look, from what the film is worth rather than a constant. A
   * thirty-second short does not need forty directions explored and spending
   * forty model calls to prove it would be the wrong kind of rigour.
   */
  const target = cut === 'short' ? 10 : duration >= 45 ? 20 : 14;

  const search = await new TerritorySearchEngine(registry.llm()).explore(
    {
      brief: models.brief,
      understanding,
      audience: models.audience,
      genome: models.genome,
      recentSignatures,
      target,
    },
    call,
  );
  costUsd += search.costUsd;

  if (search.territories.length === 0) {
    throw new AppError('internal', 'No creative directions came back.', {
      publicMessage: 'We could not find a direction for this film. Nothing has been spent; try again.',
    });
  }

  await context.activity({
    step: 'strategy',
    kind: 'note',
    label: `${search.territories.length} directions on the table`,
    detail:
      `spread ${Math.round(search.spread * 100)}% · ` +
      `${search.verdicts.filter((verdict) => !verdict.kept).length} collapsed into others` +
      (search.repeated.length > 0 ? ` · repeats: ${search.repeated.slice(0, 2).join('; ')}` : ''),
    status: 'done',
  });

  // --- The panel -----------------------------------------------------------
  await context.progress(0.5, 'Directing your film');
  await context.activity({ step: 'strategy', kind: 'step', label: 'reviewing the directions', status: 'active' });

  /*
   * The whole wall at once, not one direction at a time.
   *
   * Five critics against sixteen directions is eighty model calls, and the
   * eighty would be worse as well as dearer: a critic shown one direction
   * cannot say "this is the third version of the same idea", which is the
   * most useful thing a critic can say at this stage. So each one is shown
   * every direction and cites the ids in its findings, which is also how a
   * panel works in a real room.
   */
  const panel = await new CriticPanel(registry.llm()).review(
    {
      projectId: project.id,
      artifactKind: 'territory',
      artifactId: 'the-wall',
      brief: models.brief,
      audience: models.audience,
      genome: models.genome,
      artifact: search.territories.map(describeForCritics).join('\n\n'),
      recentDevices: recentSignatures.map((signature) => signature.device),
    },
    TERRITORY_PANEL,
    call,
  );
  costUsd += panel.costUsd;
  if (panel.reviews.length > 0) await store.creative.putReviews(organizationId, panel.reviews);
  if (panel.failed.length > 0) {
    await context.activity({
      step: 'strategy', kind: 'note', label: 'a specialist did not answer',
      detail: panel.failed.join(', '), status: 'done',
    });
  }

  // --- The decision --------------------------------------------------------
  const repetition = repetitionAgainst(
    recentSignatures,
    search.territories.map((territory) => ({ kind: 'opening' as const, device: territory.opening })),
  );

  const selection = await new DirectorBrain(registry.llm()).select(
    {
      projectId: project.id,
      brief: models.brief,
      audience: models.audience,
      genome: models.genome,
      territories: search.territories,
      reviews: panel.reviews,
      repeatedDevices: repetition.score >= REPETITION_WARNING_THRESHOLD ? repetition.repeated : [],
    },
    call,
  );
  costUsd += selection.costUsd;

  const chosenId = selection.territory.id;
  const byId = new Map(selection.verdicts.map((verdict) => [verdict.territoryId, verdict] as const));
  await store.creative.putTerritories(
    organizationId,
    project.id,
    search.territories.map((territory) => {
      const verdict = byId.get(territory.id);
      return {
        territory,
        kept: territory.id === chosenId || (verdict?.kept ?? false),
        selected: territory.id === chosenId,
        rejectionReason: territory.id === chosenId ? null : (verdict?.reason ?? null),
      };
    }),
  );
  await store.creative.putDecision(organizationId, selection.decision);

  await context.activity({
    step: 'strategy',
    kind: 'step',
    label: `directed as "${selection.territory.name}"`,
    detail: selection.decision.reason.slice(0, 240),
    status: 'done',
  });

  await context.progress(0.95, 'Directing your film');

  return {
    brief: models.brief,
    audience: models.audience,
    genome: models.genome,
    territory: selection.territory,
    decision: selection.decision,
    reviews: panel.reviews,
    explored: search.territories.length,
    spread: search.spread,
    costUsd,
  };
}

/** One direction, as a critic should read it: prose, with its id to cite. */
function describeForCritics(territory: CreativeTerritory): string {
  return [
    `${territory.id} — "${territory.name}" (${territory.mechanism.replace(/_/g, ' ')}; the product is ${territory.productRole})`,
    `Premise: ${territory.premise}`,
    `Opens on: ${territory.opening}`,
    `Emotion: ${territory.emotion}`,
    `Why it should work: ${territory.rationale}`,
    `How it could fail: ${territory.risk}`,
  ].join('\n');
}
