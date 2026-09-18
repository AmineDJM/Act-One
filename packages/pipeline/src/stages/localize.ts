import {
  AppError,
  displayHost,
  firstClause,
  languageInEnglish,
  isFilmLanguage,
  newId,
  resequence,
  type Storyboard,
} from '@act-one/core';
import { localiseFilm } from '@act-one/creative';
import type { StageContext } from '../context.ts';
import { runRender } from './render.ts';

/**
 * The film in another language.
 *
 * Not a dub and not a subtitle track. The script is written again by a writer
 * working in the target language, read by a voice that speaks it natively, and
 * the film is rendered from the same picture with the same score — so what
 * comes out is a master in that language rather than an English film with
 * something laid over it.
 *
 * Everything except the words is reused on purpose. The storyboard is the same
 * storyboard, the shots are the same shots, the score is the same score. A
 * launch film is an argument made in pictures and time, and neither of those
 * changes when the language does; what changes is what is said over them, what
 * is written on them, and who says it.
 *
 * The vendor's dubbing endpoint is deliberately not used. Dubbing exists for
 * material whose separate tracks you do not have — you are given a finished
 * mix and have to replace a voice inside it. We hold every stem of our own
 * films, so re-narrating gives a cleaner result: the music and the effects are
 * never touched, the new read is metered and mastered by the same code as the
 * original, and the captions come from the new recording rather than from a
 * translation of the old one.
 */
export async function runLocalisation(
  context: StageContext,
  options: { renderId: string; language: string },
): Promise<{ renderId: string; storyboardId: string; problems: number }> {
  const { store, registry, project, organizationId } = context;

  if (!isFilmLanguage(options.language)) {
    throw new AppError('validation_failed', `Unsupported language: ${options.language}`, {
      publicMessage: 'We do not produce films in that language yet.',
    });
  }

  const master = await store.renders.get(organizationId, options.renderId);
  if (!master) throw new AppError('not_found', 'Master render not found.');

  const source = await store.storyboards.get(organizationId, master.storyboardId);
  if (!source) throw new AppError('conflict', 'The storyboard behind this film is missing.');

  const from = source.language ?? project.brief.language ?? null;
  if (from && from.slice(0, 2).toLowerCase() === options.language.slice(0, 2).toLowerCase()) {
    throw new AppError('validation_failed', 'The film is already in that language.', {
      publicMessage: 'This film is already in that language.',
    });
  }

  const brand = project.brandId ? await store.brands.get(organizationId, project.brandId) : null;
  if (!brand) throw new AppError('conflict', 'No brand system for this project.');

  const understanding = project.productUnderstandingId
    ? await store.understandings.get(organizationId, project.productUnderstandingId)
    : null;

  const target = languageInEnglish(options.language);
  await context.progress(0.05, `Writing the film in ${target}`);
  await context.activity({
    step: 'storyboard',
    kind: 'step',
    label: `writing the film in ${target.toLowerCase()}`,
    status: 'active',
  });

  const written = await localiseFilm(
    registry.llm(),
    {
      storyboard: source,
      brand,
      understanding,
      from,
      to: options.language,
      // The end card carries the company's own line about itself, which is
      // copy like any other and has to cross like any other.
      tagline: understanding ? firstClause(understanding.oneLiner) : '',
      companyName: project.name,
      websiteUrl: displayHost(project.websiteUrl),
    },
    { organizationId, projectId: project.id, ...(context.signal ? { signal: context.signal } : {}) },
  );

  await context.activity({
    step: 'storyboard',
    kind: 'step',
    label: `${written.localisation.scenes.length} shots written in ${target.toLowerCase()}`,
    detail: written.localisation.notes.slice(0, 200),
    status: 'done',
  });

  const localised = await store.storyboards.create(
    {
      ...localisedStoryboard(source, written.localisation, newId('sbd')),
      version: await store.storyboards.nextVersion(organizationId, project.id),
      status: 'approved',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    organizationId,
  );

  await context.progress(0.15, `Producing the ${target} master`);

  /*
   * A master in its own right, and never this project's master.
   *
   * `localised` is its own kind for three reasons that all follow from the
   * same fact: it is a deliverable the customer keeps. It must not replace the
   * film on the project page, it must not be what the campaign is cut from,
   * and it must not spend a render from a plan that sells renders of the film.
   */
  const result = await runRender(context, {
    storyboardId: localised.id,
    aspect: master.aspect,
    kind: 'localised',
    // The picture was already reviewed frame by frame on the master, and these
    // are the same frames with different words on them. What changed is the
    // copy and the voice, and both are checked by their own engines.
    skipVisionQa: true,
    maxRepairAttempts: 1,
  });

  /*
   * What the localiser could not fit, said plainly.
   *
   * Reported after the render rather than before it, because a film with one
   * line that runs long is still a film, and holding it back over that would
   * trade the whole master for a note.
   */
  const skipped = untranslatedScenes(source, written.localisation);
  const notes = [
    ...written.problems.map((problem) => problem.problem),
    ...(skipped.length > 0 ? [`${skipped.length} shot${skipped.length === 1 ? '' : 's'} kept the original words`] : []),
  ];
  if (notes.length > 0) {
    await context.activity({
      step: 'storyboard',
      kind: 'note',
      label: `${notes.length} line${notes.length === 1 ? '' : 's'} to look at`,
      detail: notes.join('; ').slice(0, 400),
      status: 'done',
    });
  }

  return { renderId: result.renderId, storyboardId: localised.id, problems: notes.length };
}

/**
 * The same film, in the new words.
 *
 * New ids, because it is a different storyboard that can be revised on its
 * own; everything else about each shot — the asset it uses, the motion, the
 * camera, the sound cues, the seconds it runs — is carried over untouched.
 * A shot the localiser did not return keeps its original text rather than
 * losing it, which is visibly wrong in the right way: a line in the wrong
 * language is a thing somebody notices, and an empty shot is not.
 */
export function localisedStoryboard(
  source: Storyboard,
  localisation: { language: string; scenes: readonly { sceneId: string; narration: string; onScreenText: string[] }[] },
  storyboardId: string,
): Storyboard {
  const written = new Map(localisation.scenes.map((scene) => [scene.sceneId, scene]));
  const scenes = source.scenes.map((scene) => {
    const now = written.get(scene.id);
    return {
      ...scene,
      id: newId('scn'),
      storyboardId,
      narration: now ? now.narration : scene.narration,
      onScreenText: now && now.onScreenText.length > 0 ? now.onScreenText : scene.onScreenText,
      status: 'draft' as const,
    };
  });

  return resequence({
    ...source,
    id: storyboardId,
    scenes,
    language: localisation.language,
    updatedAt: new Date().toISOString(),
  });
}

/** Shots the localiser never returned, for a caller that wants to say so. */
export function untranslatedScenes(
  source: Storyboard,
  localisation: { scenes: readonly { sceneId: string }[] },
): string[] {
  const written = new Set(localisation.scenes.map((scene) => scene.sceneId));
  return source.scenes
    .filter((scene) => !written.has(scene.id))
    .filter((scene) => scene.narration.trim().length > 0 || scene.onScreenText.length > 0)
    .map((scene) => scene.id);
}
