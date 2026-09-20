import {
  AudienceModel,
  BrandGenome,
  CreativeBrief,
  strictestVerdict,
  weakestDimensions,
  type CreativeVerdict,
  type CriticId,
  type CriticReview,
  type DirectorDecision,
  type DirectorsVerdict,
  type QaFinding,
  type Storyboard,
} from '@act-one/core';
import { CriticPanel, DirectorBrain } from '@act-one/creative';
import {
  buildContactSheet,
  listenBlind,
  masterFloor,
  readMasterFacts,
  senseIssues,
  watchBoth,
  watchMuted,
  type MasterFacts,
} from '@act-one/qa';
import { posterArgs, runFfmpeg } from '@act-one/sound';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { StageContext } from '../context.ts';

/**
 * Creative QA, on the file.
 *
 * Production QA asks whether the film is technically complete — the frames
 * arrived, the container plays, the loudness is in range — and a film can pass
 * every one of those checks and still be thirty seconds of white text on a
 * dark rectangle in silence. That is not a hypothetical: it is what a customer
 * opened, and every gate in this system said the production had succeeded,
 * because every gate was reading the plan.
 *
 * So this one reads the file. It opens the master that is about to be
 * delivered, samples it, measures what is actually on the screen and in the
 * track, shows the whole cut to the panel as a contact sheet, and asks the
 * director to decide. Three things in that order, and the order matters:
 *
 *   The measurements come first and cannot be overruled upward. A film nobody
 *   can hear, a film that is a flat field with words on it end to end, or a
 *   film that shows two pictures in thirty seconds is refused before any model
 *   is asked, because a model asked whether a film is good will find something
 *   generous to say about almost anything.
 *
 *   The panel argues. They are kept apart, they contradict each other, and a
 *   critic that found something disqualifying has found it whatever the
 *   director thinks of the film overall.
 *
 *   The director decides, and has to say what the weakest part of it is.
 *
 * What comes back is a verdict recorded on the render, and `releasable()`
 * reads it. A master that has not passed here exists, is watchable, and is a
 * workprint.
 */

/**
 * Everyone who can usefully judge a finished film.
 *
 * `production` is left out and it is the only one: its question — can this be
 * made with the material we hold — was answered by making it. Asking it of a
 * film that exists produces notes about a risk that has already resolved.
 */
const MASTER_PANEL: readonly CriticId[] = [
  'film',
  'art_direction',
  'brand',
  'product_marketing',
  'conversion',
  'copy',
  'sound',
  'originality',
];

export type CreativeGateResult = {
  verdict: CreativeVerdict;
  /** One line, in the director's words, recorded on the render. */
  reason: string;
  changes: string[];
  facts: MasterFacts;
  /** What the measurements alone refused, before anybody was asked. */
  floorReasons: string[];
  /**
   * What the film said when it was watched muted and listened to blind.
   *
   * Soft fails, every one: a film may knowingly be any of them. What they may
   * not be is invisible, which is what they were while the only viewing this
   * system ever did was with everything switched on.
   */
  senseFindings: QaFinding[];
  /** Which entries of the negative corpus this film fell into, by id. */
  matched: string[];
  reviews: CriticReview[];
  decision: DirectorDecision | null;
  costUsd: number;
  /** False when the gate could not run at all — which is not a pass. */
  ran: boolean;
};

export async function runCreativeMasterGate(
  context: StageContext,
  params: {
    renderId: string;
    storyboard: Storyboard;
    /** The finished file, still on disk. Not the asset, not the manifest. */
    masterPath: string;
    workDir: string;
    /** What the director already said watching it back, so it is not paid for twice. */
    watched?: DirectorsVerdict | null;
    /**
     * Whether speech was actually mixed into this master.
     *
     * Produced material, never `voiceStrategy`. A film that was written with a
     * voiceover and came out with none has to fail the blind viewing, and a
     * check that read the plan would have given it full marks — which is the
     * exact mistake this system keeps making in new places.
     */
    speechInTheMix?: boolean;
  },
): Promise<CreativeGateResult> {
  const { store, registry, organizationId, project } = context;
  const call = { organizationId, projectId: project.id, signal: context.signal };

  const facts = await readMasterFacts(params.masterPath, {
    ...(context.signal ? { signal: context.signal } : {}),
    workDir: params.workDir,
  });
  const floor = masterFloor(facts, {
    typographicByDesign: project.brief.filmFormat === 'pitch',
  });

  /*
   * Three viewings, on the delivered file.
   *
   * Muted, blind, then both — because a film that only works with everything
   * switched on is usually a film where neither channel is doing its job. The
   * cuts come from the storyboard because a cut IS the storyboard; every other
   * number is read out of the master, including the loudness trace, so a cue
   * that was placed and then buried counts as the silence a listener hears
   * rather than as the cue somebody wrote.
   */
  const cuts = params.storyboard.scenes
    .map((scene) => scene.startTime)
    .filter((at) => at > 0.01);
  const blind = listenBlind({
    facts,
    windows: facts.loudness,
    cuts,
    hasNarration: params.speechInTheMix ?? false,
  });
  const muted = watchMuted({ facts, storyboard: params.storyboard });
  const both = watchBoth(params.storyboard, muted, blind);
  const senseFindings = senseIssues({ storyboard: params.storyboard, muted, blind, both });

  for (const finding of senseFindings) {
    await context.activity({
      step: 'composition',
      kind: 'note',
      label: 'watched muted, listened to blind',
      detail: finding.message,
      status: 'done',
    });
  }

  for (const reason of floor.reasons) {
    await context.activity({
      step: 'composition',
      kind: 'note',
      label: 'the film does not clear the floor',
      detail: reason,
      status: 'done',
    });
  }

  const models = await creativeModels(context);
  if (!models) {
    /*
     * No brief, no audience, no genome: this project was made before the
     * creative system existed, or research never finished. The measurements
     * still stand — they are the part that does not need a model — and the
     * verdict is theirs alone, said plainly rather than dressed up as a full
     * review that did not happen.
     */
    return {
      verdict: floor.verdict,
      reason:
        floor.reasons.join(' ') ||
        'Measured clean; there is no creative brief on this production to judge it against.',
      changes: [],
      facts,
      floorReasons: floor.reasons,
      senseFindings,
      matched: floor.matched,
      reviews: [],
      decision: null,
      costUsd: 0,
      ran: false,
    };
  }

  const sheet = await contactSheet(context, params);
  if (!sheet) {
    return {
      verdict: floor.verdict,
      reason: floor.reasons.join(' ') || 'The finished film could not be read back to be judged.',
      changes: [],
      facts,
      floorReasons: floor.reasons,
      senseFindings,
      matched: floor.matched,
      reviews: [],
      decision: null,
      costUsd: 0,
      ran: false,
    };
  }

  const artifact = describeMaster(params.storyboard, facts, floor.reasons, params.watched ?? null, {
    muted,
    blind,
    findings: senseFindings,
  });
  const panel = new CriticPanel(registry.llm());
  const brain = new DirectorBrain(registry.llm());
  let costUsd = 0;

  const panelled = await panel.review(
    {
      projectId: project.id,
      artifactKind: 'master',
      artifactId: params.renderId,
      brief: models.brief,
      audience: models.audience,
      genome: models.genome,
      artifact,
      images: [{ url: sheet, detail: 'high' }],
    },
    MASTER_PANEL,
    call,
  );
  costUsd += panelled.costUsd;
  if (panelled.reviews.length > 0) await store.creative.putReviews(organizationId, panelled.reviews);

  const gate = await brain.gate(
    {
      projectId: project.id,
      brief: models.brief,
      audience: models.audience,
      genome: models.genome,
      stage: 'creative_qa',
      artifactId: params.renderId,
      artifact,
      reviews: panelled.reviews,
    },
    call,
  );
  costUsd += gate.costUsd;
  await store.creative.putDecision(organizationId, gate.decision);

  /*
   * The strictest of the three, always.
   *
   * The floor because it measured the file; the panel because a critic that
   * found something disqualifying found it; the director because deciding is
   * the job. Nothing here may round a verdict up — the whole failure this
   * gate exists to end was a chain of layers each willing to call the film
   * finished on somebody else's evidence.
   */
  const verdict = strictestVerdict([floor.verdict, gate.verdict]);
  const reason = floor.reasons.length > 0
    ? `${floor.reasons.join(' ')} ${gate.decision.reason}`.trim()
    : gate.decision.reason;

  await context.activity({
    step: 'composition',
    kind: 'note',
    label: `creative QA: ${verdict.replace(/_/g, ' ')}`,
    detail: reason,
    status: 'done',
  });

  return {
    verdict,
    reason: reason.slice(0, 800),
    changes: [...floor.reasons, ...gate.changes].slice(0, 8),
    facts,
    floorReasons: floor.reasons,
    senseFindings,
    matched: floor.matched,
    reviews: panelled.reviews,
    decision: gate.decision,
    costUsd,
    ran: true,
  };
}

/** The brief, the audience and the genome this project was actually made from. */
async function creativeModels(
  context: StageContext,
): Promise<{ brief: CreativeBrief; audience: AudienceModel; genome: BrandGenome } | null> {
  const { store, organizationId, project } = context;
  try {
    const [brief, audience, genome] = await Promise.all([
      store.creative.latestModel(organizationId, project.id, 'brief'),
      store.creative.latestModel(organizationId, project.id, 'audience'),
      store.creative.latestModel(organizationId, project.id, 'genome'),
    ]);
    if (!brief || !audience || !genome) return null;
    return {
      brief: CreativeBrief.parse(brief),
      audience: AudienceModel.parse(audience),
      genome: BrandGenome.parse(genome),
    };
  } catch (error) {
    console.error('[creative-gate] the creative models would not load:', (error as Error).message.slice(0, 200));
    return null;
  }
}

/** One frame per shot, from the master, as a data URL the panel can look at. */
async function contactSheet(
  context: StageContext,
  params: { storyboard: Storyboard; masterPath: string; workDir: string },
): Promise<string | null> {
  const frames: { sceneId: string; timecodeStart: number; data: Uint8Array }[] = [];
  for (const scene of params.storyboard.scenes) {
    const timecodeStart = scene.startTime + scene.duration * 0.6;
    const framePath = path.join(params.workDir, `gate-${scene.id}.jpg`);
    const extracted = await runFfmpeg(posterArgs(params.masterPath, timecodeStart, framePath), {
      ...(context.signal ? { signal: context.signal } : {}),
      timeoutMs: 60_000,
    });
    if (!extracted.ok) continue;
    try {
      frames.push({ sceneId: scene.id, timecodeStart, data: new Uint8Array(await readFile(framePath)) });
    } catch {
      continue;
    }
  }
  if (frames.length === 0) return null;
  try {
    const sheet = await buildContactSheet(frames);
    return `data:image/png;base64,${Buffer.from(sheet.png).toString('base64')}`;
  } catch (error) {
    console.error('[creative-gate] the contact sheet would not build:', (error as Error).message.slice(0, 200));
    return null;
  }
}

/**
 * The film, described in what was measured rather than what was planned.
 *
 * The storyboard's own words are here because a critic has to know what the
 * film was trying to do — but they come after the measurements and are
 * labelled as intentions, so a shot list that promises a product capture
 * cannot stand in for a frame that does not contain one.
 */
function describeMaster(
  storyboard: Storyboard,
  facts: MasterFacts,
  floorReasons: readonly string[],
  watched: DirectorsVerdict | null,
  senses: {
    muted: ReturnType<typeof watchMuted>;
    blind: ReturnType<typeof listenBlind>;
    findings: readonly QaFinding[];
  },
): string {
  const lines: string[] = [
    'THE FINISHED FILM, AS MEASURED',
    'These numbers were read out of the delivered file, not out of the plan.',
    `Runtime ${facts.durationSeconds.toFixed(1)}s at ${facts.width}×${facts.height}.`,
    facts.hasAudio
      ? `There is an audio track, audible for ${Math.round(facts.audibleShare * 100)}% of the running time.`
      : 'There is no audio track. The film plays in silence.',
    `${facts.sampled} moments sampled evenly across the film: ${facts.flatFrames} of them are a flat ` +
      `field of colour with marks on it, and they produce ${facts.distinctFrames} distinct images between them.`,
    '',
    'WATCHED MUTED, THEN LISTENED TO BLIND',
    'Two viewings of the delivered file, each with one channel switched off.',
    `Muted: words are on screen for ${senses.muted.wordsOnScreenSeconds.toFixed(1)}s and the real ` +
      `product for ${senses.muted.productSeconds.toFixed(1)}s. ` +
      (senses.muted.spokenOnly.length === 0
        ? 'Nothing the film says out loud goes unshown.'
        : `${senses.muted.spokenOnly.length} spoken sentences are never shown: ` +
          `${senses.muted.spokenOnly.slice(0, 3).map((line) => `"${line}"`).join(' ')}`),
    `Blind: the loudness moves over a range of ${senses.blind.loudnessRangeLu} LU and marks ` +
      `${Math.round(senses.blind.cutsMarked * 100)}% of the cuts. ` +
      (senses.blind.hasNarration ? 'There is speech in the mix.' : 'There is no speech in the mix.'),
    ...senses.findings.map((finding) => `- ${finding.message}`),
  ];

  if (floorReasons.length > 0) {
    lines.push('', 'ALREADY REFUSED ON THE MEASUREMENTS', ...floorReasons.map((reason) => `- ${reason}`));
    lines.push(
      'Do not argue the film out of these. Say what would fix them and judge everything else.',
    );
  }

  lines.push('', 'WHAT THE CUT WAS MEANT TO BE', `${storyboard.scenes.length} shots.`);
  for (const [index, scene] of storyboard.scenes.entries()) {
    const text = scene.onScreenText.join(' / ');
    lines.push(
      `${index + 1}. ${scene.startTime.toFixed(1)}–${(scene.startTime + scene.duration).toFixed(1)}s ` +
        `· ${scene.visualType.replace(/_/g, ' ')}${text ? ` · "${text}"` : ''}` +
        `${scene.narration ? ` · spoken: "${scene.narration}"` : ''}`,
    );
  }

  if (watched) {
    lines.push(
      '',
      'THE DIRECTOR HAS ALREADY WATCHED IT BACK',
      `Grade: ${watched.grade}. ${watched.summary}`,
      `The one change that would lift it: ${watched.oneChange}`,
      ...weakestDimensions(watched).map((note) => `- ${note.dimension} (${note.grade}): ${note.note}`),
    );
  }

  lines.push(
    '',
    'The contact sheet is one frame from each shot, in order, labelled with its timecode.',
    'That is the film. Judge it.',
  );
  return lines.join('\n');
}
