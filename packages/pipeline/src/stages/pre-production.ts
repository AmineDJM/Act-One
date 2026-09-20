import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AppError,
  ProductionBudget,
  budgetAllowsReplan,
  describeSequence,
  filmShape,
  newId,
  spendReplan,
  storyboardDuration,
  strictestVerdict,
  weakestDimensions,
  type AudienceModel,
  type BrandGenome,
  type CreativeBrief,
  type CreativeEscalation,
  type CreativeVerdict,
  type CriticId,
  type CriticReview,
  type DirectorDecision,
  type DirectorsVerdict,
  type Storyboard,
} from '@act-one/core';
import { CriticPanel, DirectorBrain } from '@act-one/creative';
import { buildContactSheet, reviewCut } from '@act-one/qa';
import { runFfmpeg } from '@act-one/sound';
import { runAnimatic } from './animatic.ts';
import { runCreativeReplan } from './replan.ts';
import type { StageContext } from '../context.ts';

/**
 * Watching the film before paying to make it.
 *
 * The director already watched finished cuts — that has been true for a while,
 * and it is the only thing in this system that asks whether a film is any
 * good rather than whether anything is wrong with it. What it could not do is
 * change very much, because by the time it watched, the shots had been
 * generated, the voice had been read, the mix had been mastered, and the only
 * honest move left was to send one shot back.
 *
 * So it watches the animatic instead, which costs a render and nothing else,
 * and it watches it with the same eyes: one frame per shot as a contact sheet,
 * where rhythm and repetition and a palette that drifts are visible and are
 * invisible inside any single frame.
 *
 * Then the panel, then one director, then — if the answer is revise — the beat
 * replan machinery that already exists, on the beats the notes actually named.
 * Bounded: taste is not convergent, and a reviewer asked again about a film it
 * has already sent back will find something else to send back for ever, on the
 * customer's money.
 */

/** Everyone who can usefully judge a timing cut. Production has nothing to say yet. */
const ANIMATIC_PANEL: readonly CriticId[] = [
  'film',
  'art_direction',
  'brand',
  'product_marketing',
  'conversion',
  'copy',
  'sound',
  'originality',
];

export type PreProductionResult = {
  /** The storyboard production should use. The same one, or one the director revised. */
  storyboardId: string;
  approved: boolean;
  verdict: CreativeVerdict;
  rounds: number;
  /** What the director said each time it watched, oldest first. */
  watched: DirectorsVerdict[];
  decisions: DirectorDecision[];
  reviews: CriticReview[];
  /** Why production was not approved, in the words of the work. Empty when it was. */
  holdReason: string;
  costUsd: number;
};

export type PreProductionInput = {
  storyboardId: string;
  brief: CreativeBrief;
  audience: AudienceModel;
  genome: BrandGenome;
  /** How many times the director may send the cut back. Two is plenty. */
  maxRounds?: number;
};

export async function runPreProduction(
  context: StageContext,
  input: PreProductionInput,
): Promise<PreProductionResult> {
  const { store, registry, organizationId, project } = context;
  const call = { organizationId, projectId: project.id, signal: context.signal };
  const maxRounds = Math.max(0, Math.min(3, input.maxRounds ?? 2));

  const brand = project.brandId ? await store.brands.get(organizationId, project.brandId) : null;
  if (!brand) throw new AppError('conflict', 'No brand system for this project.');
  const understanding = project.productUnderstandingId
    ? await store.understandings.get(organizationId, project.productUnderstandingId)
    : null;

  const brain = new DirectorBrain(registry.llm());
  const panel = new CriticPanel(registry.llm());

  let storyboardId = input.storyboardId;
  let budget = ProductionBudget.parse({});
  const watched: DirectorsVerdict[] = [];
  const decisions: DirectorDecision[] = [];
  const reviews: CriticReview[] = [];
  let costUsd = 0;
  let verdict: CreativeVerdict = 'pass';
  let holdReason = '';
  let rounds = 0;

  for (let round = 0; round <= maxRounds; round += 1) {
    rounds = round + 1;

    await context.progress(0.15 + round * 0.2, 'Directing your film');
    await context.activity({
      step: 'storyboard',
      kind: 'step',
      // Operator-facing. The customer sees "Directing your film" above.
      label: round === 0 ? 'previewing the cut' : `previewing the revised cut (${round + 1})`,
      status: 'active',
    });

    const animatic = await runAnimatic(context, { storyboardId });
    const storyboard = await store.storyboards.get(organizationId, storyboardId);
    if (!storyboard) throw new AppError('not_found', 'The storyboard being previewed is gone.');

    const sheet = await contactSheetFor(context, { storyboard, assetId: animatic.assetId });
    if (!sheet) {
      /*
       * No frames means no judgement. Reported rather than guessed at: a
       * director who cannot see the cut has nothing to say about it, and
       * inventing a pass here would be the exact failure this layer exists to
       * prevent.
       */
      await context.activity({
        step: 'storyboard', kind: 'note', label: 'the cut could not be read back',
        detail: 'Production continues; the finished film is still watched.', status: 'done',
      });
      return {
        storyboardId, approved: true, verdict: 'pass_with_concerns', rounds,
        watched, decisions, reviews, holdReason: '', costUsd,
      };
    }

    const seen = await reviewCut(
      registry.llm(),
      {
        storyboard,
        contactSheet: sheet,
        brief: understanding ? `${understanding.name}: ${understanding.oneLiner}` : project.name,
        tone: brand.tone,
        format: project.brief.filmFormat,
        cut: project.brief.filmCut,
      },
      call,
    );
    watched.push(seen);

    await context.activity({
      step: 'storyboard', kind: 'note',
      label: `the director says: ${seen.grade}`, detail: seen.summary, status: 'done',
    });

    const panelled = await panel.review(
      {
        projectId: project.id,
        artifactKind: 'animatic',
        artifactId: animatic.renderId,
        brief: input.brief,
        audience: input.audience,
        genome: input.genome,
        artifact: describeCut(storyboard, seen, { silent: animatic.silent }),
        images: [{ url: sheet.url, detail: 'high' }],
      },
      ANIMATIC_PANEL,
      call,
    );
    costUsd += panelled.costUsd;
    reviews.push(...panelled.reviews);
    if (panelled.reviews.length > 0) await store.creative.putReviews(organizationId, panelled.reviews);

    const gate = await brain.gate(
      {
        projectId: project.id,
        brief: input.brief,
        audience: input.audience,
        genome: input.genome,
        stage: 'animatic',
        artifactId: animatic.renderId,
        artifact: describeCut(storyboard, seen, { silent: animatic.silent }),
        reviews: panelled.reviews,
      },
      call,
    );
    costUsd += gate.costUsd;
    verdict = gate.verdict;
    decisions.push(gate.decision);
    await store.creative.putDecision(organizationId, gate.decision);

    await context.activity({
      step: 'storyboard', kind: 'note',
      label: `${gate.verdict.replace(/_/g, ' ')} before production`,
      detail: gate.decision.reason,
      status: 'done',
    });

    if (gate.verdict === 'pass' || gate.verdict === 'pass_with_concerns') {
      return { storyboardId, approved: true, verdict, rounds, watched, decisions, reviews, holdReason: '', costUsd };
    }

    /*
     * A block that names what to change earns one attempt at changing it.
     *
     * This used to end the production outright, on the reasoning that a block
     * is disqualifying and no amount of re-cutting the same material fixes
     * it. Sometimes true. But a block here is the strictest verdict on the
     * panel, not the director's own: one critic finding one dimension
     * unacceptable makes the gate say block even when the director's written
     * reason is "clear enough to continue, but not strong enough to ship" —
     * which is a revise in every sense except the word.
     *
     * So the two are told apart by what the gate produced rather than by its
     * label. A block with changes to make is worth one replan; a block with
     * nothing to change is a dead end and says so. Either way the verdict
     * stands: nothing below rounds it up to approved.
     */
    if (gate.verdict === 'block' && gate.changes.length === 0) {
      holdReason = gate.decision.reason;
      break;
    }

    if (round >= maxRounds || !budgetAllowsReplan(budget)) {
      holdReason = gate.decision.reason;
      break;
    }

    /*
     * Revise: the notes become a beat replan, on the beats the notes named.
     *
     * Routed through the machinery that already exists rather than a second
     * one — the same bounds, the same option scoring, the same lineage, and
     * the same refusal to take an option the director itself called weaker.
     */
    const targets = beatsToRevise(storyboard, seen, gate.changes);
    if (targets.length === 0) {
      holdReason = gate.decision.reason;
      break;
    }

    const escalation: CreativeEscalation = {
      type: 'creative_replan_required',
      renderId: animatic.renderId,
      storyboardId,
      sceneIds: targets,
      check: 'direction',
      diagnosis: [gate.decision.reason, ...gate.changes].filter(Boolean).join(' '),
      // What the director named, so the replan can pick the right repair and
      // the regression check can pick the right number to watch.
      problems: gate.problems,
      requiredSeconds: storyboardDuration(storyboard),
      usableSeconds: storyboardDuration(storyboard),
      preservedConstraints: [
        `The film runs ${storyboardDuration(storyboard).toFixed(1)}s and that is what was approved.`,
        `It is "${input.brief.creativeObjective}" and stays so.`,
      ],
      previousAttempts: [],
    };

    const replanned = await runCreativeReplan(context, { escalation, budget, attempt: round });
    budget = spendReplan(budget, false);
    if (!replanned.storyboardId) {
      holdReason = gate.decision.reason;
      break;
    }
    storyboardId = replanned.storyboardId;
    await store.projects.update(organizationId, project.id, { activeStoryboardId: storyboardId });
  }

  return {
    storyboardId,
    approved: false,
    verdict: verdict === 'pass' ? 'revise' : verdict,
    rounds,
    watched,
    decisions,
    reviews,
    holdReason,
    costUsd,
  };
}

/**
 * The animatic as one image, downloaded back out of storage.
 *
 * Out of storage rather than out of the render's temp directory on purpose:
 * the frames judged here are the frames that actually landed, which is the
 * distinction that mattered when a whole production's assets existed in the
 * database and nowhere a worker could read them.
 */
async function contactSheetFor(
  context: StageContext,
  params: { storyboard: Storyboard; assetId: string },
): Promise<{ url: string; shots: { sceneId: string; timecodeStart: number }[] } | null> {
  const asset = await context.store.assets.get(context.organizationId, params.assetId);
  if (!asset) return null;
  const storage = context.registry.storage();
  if (!(await storage.exists(asset.storageKey).catch(() => false))) return null;

  const { mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const workDir = await mkdtemp(path.join(tmpdir(), 'act-one-animatic-'));
  try {
    const filmPath = path.join(workDir, 'animatic.mp4');
    await writeFile(filmPath, Buffer.from(await storage.get(asset.storageKey)));

    const frames: { sceneId: string; timecodeStart: number; data: Uint8Array }[] = [];
    for (const scene of params.storyboard.scenes) {
      // Six tenths in: the motion has settled and the shot is not yet leaving.
      const timecodeStart = scene.startTime + scene.duration * 0.6;
      const framePath = path.join(workDir, `shot-${scene.id}.jpg`);
      const extracted = await runFfmpeg(
        ['-nostdin', '-y', '-ss', timecodeStart.toFixed(3), '-i', filmPath, '-frames:v', '1', '-q:v', '3', framePath],
        { ...(context.signal ? { signal: context.signal } : {}), timeoutMs: 60_000 },
      );
      if (!extracted.ok) continue;
      frames.push({ sceneId: scene.id, timecodeStart, data: new Uint8Array(await readFile(framePath)) });
    }
    if (frames.length === 0) return null;

    const sheet = await buildContactSheet(frames);
    return {
      url: `data:image/png;base64,${Buffer.from(sheet.png).toString('base64')}`,
      shots: sheet.shots,
    };
  } catch (error) {
    console.error('[pre-production] contact sheet failed:', (error as Error).message.slice(0, 200));
    return null;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The cut as a critic should read it: the shot list, and what the director saw. */
function describeCut(
  storyboard: Storyboard,
  seen: DirectorsVerdict,
  audio: { silent: boolean } = { silent: false },
): string {
  const shots = storyboard.scenes.map((scene, index) =>
    [
      `${index + 1}. ${scene.id} @ ${scene.startTime.toFixed(1)}s for ${scene.duration.toFixed(1)}s`,
      `   ${scene.visualType.replace(/_/g, ' ')} · ${scene.purpose}`,
      scene.onScreenText.length > 0 ? `   on screen: ${scene.onScreenText.join(' / ')}` : '',
      scene.narration ? `   said: ${scene.narration}` : '',
      /*
       * What production made of it, not only what it was written as.
       *
       * "Screenshot motion" and "the shell falls back while the schedule
       * panel comes forward, then the control is pressed and the
       * confirmation lifts" are the same visual type and are not remotely
       * the same shot. A panel shown only the first judges the intention.
       */
      scene.uiSequence ? `   filmed: ${describeSequence(scene.uiSequence)}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  const shape = filmShape(storyboard);
  return [
    `A ${storyboardDuration(storyboard).toFixed(0)}-second cut, at preview quality.`,
    `The director graded it ${seen.grade}: ${seen.summary}`,
    /*
     * The measure that tells a held screenshot from a filmed one. Picture
     * share cannot: a film of stills has a high one, which is how a slide
     * show kept passing a check meant to catch slide shows.
     */
    `${Math.round(shape.cinematicShare * 100)}% of the running time has the interface itself moving ` +
      `(${shape.cinematicShots} of ${shape.shots} shots; ${shape.operatedShots} show a control being used, ` +
      `${shape.spatialShots} open into a built space).`,
    ...weakestDimensions(seen).map((note) => `Weakest — ${note.dimension} (${note.grade}): ${note.note}`),
    ``,
    `THE SHOTS:`,
    ...shots,
    ``,
    `Frames from the cut are attached as a contact sheet, one per shot, in order.`,
    /*
     * Say it, rather than let a panel hear silence and call it a choice.
     *
     * A sound critic shown a film with nothing on its track has no way to
     * tell a deliberate hush from a library that was never provisioned, and
     * it will write one of them down as taste. It is a production fault, the
     * picture is what is being judged here, and saying so costs one line.
     */
    ...(audio.silent
      ? [
          ``,
          `THE PREVIEW HAS NO SOUND, AND THAT IS NOT A CHOICE.`,
          `This film's plan asks for sound; the preview could not obtain it, which is a`,
          `production fault being handled separately. Judge the picture, the cut and the`,
          `writing. Do not read the silence as an intention, and do not mark the film`,
          `down for a mix nobody has heard.`,
        ]
      : []),
  ].join('\n');
}

/**
 * Which beats the notes actually named.
 *
 * Only ones that exist, and at most three: a revision that touches half the
 * film is not a revision, it is a different film, and the thing that produces
 * it is the territory search rather than a note on a cut.
 */
function beatsToRevise(
  storyboard: Storyboard,
  seen: DirectorsVerdict,
  changes: readonly string[],
): string[] {
  const known = new Set(storyboard.scenes.map((scene) => scene.id));
  const named = new Set<string>();

  if (seen.weakestSceneId && known.has(seen.weakestSceneId)) named.add(seen.weakestSceneId);
  for (const note of seen.notes) {
    if (note.sceneId && known.has(note.sceneId)) named.add(note.sceneId);
  }
  for (const change of changes) {
    for (const scene of storyboard.scenes) {
      if (change.includes(scene.id)) named.add(scene.id);
    }
  }
  return [...named].slice(0, 3);
}
