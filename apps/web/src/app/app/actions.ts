'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  AppError,
  CommentTarget,
  FILM_LANGUAGES,
  ProductCredentialKind,
  Tone,
  VoiceAccent,
  VoicePace,
  VoiceStyle,
  can,
  newId,
  normalizeUrl,
  stageReached,
  type JobKind,
  type Project,
  type ProjectBrief,
  type ProjectStage,
} from '@act-one/core';
import { requireSession, switchWorkspace } from '@/server/auth.ts';
import { getStore } from '@/server/store.ts';
import { createProject, enqueue, getProjectOr404, hostLabel } from '@/server/projects.ts';
import { reportError } from '@/server/report.ts';
import { authorizeProductAccess, revokeProductAccess } from '@/server/credentials.ts';
import { postComment, resolveComment } from '@/server/collaboration.ts';

export type FormState = { error: string | null; message?: string };

export async function createProjectAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  let destination: string;

  try {
    const session = await requireSession();
    const website = normalizeUrl(String(formData.get('website') ?? ''));
    if (!website) return { error: 'That does not look like a website address.' };

    // The sources the customer pointed us at: one field per source on the
    // command bar, and the older free-text field, both honoured.
    const supplemental = [
      ...formData.getAll('source').map(String),
      ...String(formData.get('supplemental') ?? '').split(/[\s,]+/),
    ]
      .map((value) => normalizeUrl(value))
      .filter((value): value is string => value !== null && value !== website);

    const project = await createProject(session, {
      websiteUrl: website,
      supplementalUrls: supplemental,
      brief: briefFromForm(formData),
    });
    destination = `/app/projects/${project.id}`;
  } catch (error) {
    return { error: reportError('createProjectAction', error).publicMessage };
  }

  redirect(destination);
}

export async function chooseConceptAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const session = await requireSession();
    if (!can(session.actor, 'concept:approve')) {
      throw new AppError('forbidden', 'Your role cannot approve a concept.');
    }

    const projectId = String(formData.get('projectId') ?? '');
    const conceptId = String(formData.get('conceptId') ?? '');
    const project = await getProjectOr404(session, projectId);
    const store = getStore();

    const concept = await store.concepts.select(session.organizationId, project.id, conceptId);
    await store.projects.update(session.organizationId, project.id, {
      selectedConceptId: concept.id,
      stage: 'storyboarding',
    });

    // Approval is recorded, not inferred from the stage — reviewers need to
    // know who signed off, and a stage can be moved by the pipeline.
    await store.approvals.create({
      id: newId('cmt'),
      organizationId: session.organizationId,
      projectId: project.id,
      gate: 'concept',
      targetId: concept.id,
      approvedByUserId: session.user.id,
      createdAt: new Date().toISOString(),
    });

    await enqueue(project, 'build_storyboard', { conceptId: concept.id }, 8);
    revalidatePath(`/app/projects/${project.id}`);
    return { error: null, message: `Building the storyboard for "${concept.name}".` };
  } catch (error) {
    return { error: reportError('chooseConceptAction', error).publicMessage };
  }
}

export async function regenerateConceptsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const session = await requireSession();
    const project = await getProjectOr404(session, String(formData.get('projectId') ?? ''));
    const existing = await getStore().concepts.listForProject(session.organizationId, project.id);

    await enqueue(
      project,
      'generate_concepts',
      // The rejected set travels with the job so the strategy engine can be
      // told explicitly what not to repeat.
      { rejectedConceptIds: existing.map((concept) => concept.id) },
      8,
    );
    await getStore().projects.setStage(session.organizationId, project.id, 'concepting');
    revalidatePath(`/app/projects/${project.id}`);
    return { error: null, message: 'Working on three new directions.' };
  } catch (error) {
    return { error: reportError('regenerateConceptsAction', error).publicMessage };
  }
}

export async function confirmBrandAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const session = await requireSession();
    if (!can(session.actor, 'brand:edit')) {
      throw new AppError('forbidden', 'Your role cannot edit the brand.');
    }

    const projectId = String(formData.get('projectId') ?? '');
    const brandId = String(formData.get('brandId') ?? '');
    const primaryColor = String(formData.get('primaryColor') ?? '').trim();

    const brand = await getStore().brands.get(session.organizationId, brandId);
    if (!brand) throw new AppError('not_found', 'Brand not found.');
    await getStore().brands.update(session.organizationId, brandId, {
      confirmedByUser: true,
      confirmedAt: new Date().toISOString(),
      ...(primaryColor && primaryColor !== brand.primaryColor
        ? { primaryColor, overrides: brand.overrides.includes('colors') ? brand.overrides : [...brand.overrides, 'colors'] }
        : {}),
    });

    revalidatePath(`/app/projects/${projectId}`);
    return { error: null, message: 'Brand confirmed.' };
  } catch (error) {
    return { error: reportError('confirmBrandAction', error).publicMessage };
  }
}

/**
 * A revision is a conversation. The customer writes a sentence; we answer
 * with what we understood and exactly what we would do; nothing is touched
 * until they confirm. This is the first half: the proposal.
 */
export async function reviseStoryboardAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const session = await requireSession();
    if (!can(session.actor, 'storyboard:edit')) {
      throw new AppError('forbidden', 'Your role cannot change the storyboard.');
    }
    const projectId = String(formData.get('projectId') ?? '');
    const instruction = String(formData.get('instruction') ?? '').trim();
    if (!instruction) return { error: 'Tell us what to change.' };

    const project = await getProjectOr404(session, projectId);
    if (!project.activeStoryboardId) return { error: 'There is no storyboard to revise yet.' };

    const { proposeRevision } = await import('@/server/revisions.ts');
    const proposal = await proposeRevision(session, project, instruction);
    revalidatePath(`/app/projects/${projectId}`);
    return { error: null, message: proposal.reply };
  } catch (error) {
    return { error: reportError('reviseStoryboardAction', error).publicMessage };
  }
}

/** The second half: the customer said go. */
export async function confirmRevisionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const session = await requireSession();
    if (!can(session.actor, 'storyboard:edit')) {
      throw new AppError('forbidden', 'Your role cannot change the storyboard.');
    }
    const projectId = String(formData.get('projectId') ?? '');
    const requestId = String(formData.get('requestId') ?? '');
    const project = await getProjectOr404(session, projectId);

    const { confirmRevision } = await import('@/server/revisions.ts');
    const outcome = await confirmRevision(session, project, requestId);
    revalidatePath(`/app/projects/${projectId}`);
    return { error: null, message: outcome.message };
  } catch (error) {
    return { error: reportError('confirmRevisionAction', error).publicMessage };
  }
}

/** Not that. The proposal is set aside and the customer writes again. */
export async function declineRevisionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const session = await requireSession();
    if (!can(session.actor, 'storyboard:edit')) {
      throw new AppError('forbidden', 'Your role cannot change the storyboard.');
    }
    const projectId = String(formData.get('projectId') ?? '');
    const requestId = String(formData.get('requestId') ?? '');
    const project = await getProjectOr404(session, projectId);

    const { declineRevision } = await import('@/server/revisions.ts');
    await declineRevision(session, project, requestId);
    revalidatePath(`/app/projects/${projectId}`);
    return { error: null, message: 'Set aside. Tell us again, differently.' };
  } catch (error) {
    return { error: reportError('declineRevisionAction', error).publicMessage };
  }
}

export async function startRenderAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const session = await requireSession();
    if (!can(session.actor, 'render:start')) {
      throw new AppError('forbidden', 'Your role cannot start a render.');
    }

    const project = await getProjectOr404(session, String(formData.get('projectId') ?? ''));
    if (!project.activeStoryboardId) return { error: 'Approve a storyboard first.' };

    const { renderPermission } = await import('@/server/projects.ts');
    const permission = await renderPermission(session, project);
    if (!permission.allowed) return { error: permission.reason };

    const store = getStore();
    await store.approvals.create({
      id: newId('cmt'),
      organizationId: session.organizationId,
      projectId: project.id,
      gate: 'storyboard',
      targetId: project.activeStoryboardId,
      approvedByUserId: session.user.id,
      createdAt: new Date().toISOString(),
    });

    /*
     * The payload says what to render, not on what terms. Watermark and
     * resolution are resolved by the worker from the plan at the moment the
     * film is made, so a job that waits in the queue through an upgrade or a
     * lapse gets the right answer rather than the one from when it was queued.
     */
    await enqueue(project, 'render_film', { storyboardId: project.activeStoryboardId }, 5);
    await store.projects.setStage(session.organizationId, project.id, 'rendering');

    revalidatePath(`/app/projects/${project.id}`);
    return {
      error: null,
      message: permission.watermarked
        ? 'Rendering a watermarked preview.'
        : 'Rendering your film.',
    };
  } catch (error) {
    return { error: reportError('startRenderAction', error).publicMessage };
  }
}

export async function createCampaignAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const session = await requireSession();
    const project = await getProjectOr404(session, String(formData.get('projectId') ?? ''));
    if (!project.latestRenderId) return { error: 'Render the master film first.' };

    await enqueue(project, 'generate_campaign', { renderId: project.latestRenderId }, 4);

    // Separate job on purpose. The copy is quick and the cuts are not, so a
    // copy failure must never cost somebody their campaign — and they get the
    // headlines while the cuts are still rendering.
    await enqueue(project, 'generate_copy', {}, 5);

    revalidatePath(`/app/projects/${project.id}`);
    return { error: null, message: 'Cutting your campaign and writing the launch copy.' };
  } catch (error) {
    return { error: reportError('createCampaignAction', error).publicMessage };
  }
}

/**
 * Picks a failed project back up.
 *
 * A project that failed was reachable only by starting again from the URL,
 * which throws away the research, the brand and the concepts that did succeed —
 * and, on the free plan, spends another project from the monthly allowance to
 * recover from our own error. This re-queues the stage that actually failed and
 * keeps everything before it.
 */
export async function retryProjectAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const session = await requireSession();
    const project = await getProjectOr404(session, String(formData.get('projectId') ?? ''));

    if (!can(session.actor, 'project:create')) {
      throw new AppError('forbidden', 'Your role cannot restart work on a project.');
    }

    // Resume from the furthest point that completed, so a render that died does
    // not re-run the research that did not.
    const { kind, stage } = resumePointFor(project);
    await getStore().projects.setStage(session.organizationId, project.id, stage);
    await enqueue(project, kind, {}, 1);

    revalidatePath(`/app/projects/${project.id}`);
    return { error: null, message: 'Picking up where it stopped.' };
  } catch (error) {
    return { error: reportError('retryProjectAction', error).publicMessage };
  }
}

/** The stage to re-enter, given what the project already has. */
function resumePointFor(project: Project): { kind: JobKind; stage: ProjectStage } {
  if (project.activeStoryboardId) return { kind: 'render_film', stage: 'rendering' };
  if (project.selectedConceptId) return { kind: 'build_storyboard', stage: 'storyboarding' };
  if (project.productUnderstandingId) return { kind: 'generate_concepts', stage: 'concepting' };
  return { kind: 'research_product', stage: 'researching' };
}

/**
 * Moves this session into another workspace.
 *
 * The id arrives from the client, which is exactly why switchWorkspace refuses
 * any workspace the caller is not a member of — this is the one place an
 * organisation id is allowed in from outside.
 */
export async function switchWorkspaceAction(organizationId: string): Promise<void> {
  await requireSession();
  const moved = await switchWorkspace(organizationId);
  if (moved) revalidatePath('/app', 'layout');
}

/**
 * Connects the customer's own product so the film can show the real thing.
 *
 * The whole quality argument of this product rests on filming a real interface
 * rather than inventing one, and without this there was no way to let us in —
 * every film was typography over brand colour because it had no choice.
 */
export async function authorizeProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const session = await requireSession();
    const projectId = String(formData.get('projectId') ?? '');

    await authorizeProductAccess(session, {
      projectId,
      kind: ProductCredentialKind.catch('password').parse(formData.get('kind')),
      loginUrl: String(formData.get('loginUrl') ?? ''),
      username: String(formData.get('username') ?? ''),
      secret: String(formData.get('secret') ?? ''),
      allowedPaths: splitPaths(String(formData.get('allowedPaths') ?? '')),
      deniedPaths: splitPaths(String(formData.get('deniedPaths') ?? '')),
      confirmed: formData.get('confirmed') === 'on',
    });

    const project = await getProjectOr404(session, projectId);
    // Explore straight away. Somebody who just handed over access expects
    // something to happen, and the capture is what makes their film different.
    await enqueue(project, 'capture_product_moments', {}, 7);

    revalidatePath(`/app/projects/${projectId}`);
    return { error: null, message: 'Signing in and looking around your product now.' };
  } catch (error) {
    return { error: reportError('authorizeProductAction', error).publicMessage };
  }
}

export async function revokeProductAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const session = await requireSession();
    const projectId = String(formData.get('projectId') ?? '');
    await revokeProductAccess(session, projectId);
    revalidatePath(`/app/projects/${projectId}`);
    return { error: null, message: 'Access withdrawn.' };
  } catch (error) {
    return { error: reportError('revokeProductAction', error).publicMessage };
  }
}

/** Accepts a comma or newline separated list, which is how people type them. */
function splitPaths(raw: string): string[] {
  return raw.split(/[\n,]+/).map((path) => path.trim()).filter((path) => path.length > 0);
}

export async function postCommentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const session = await requireSession();
    const projectId = String(formData.get('projectId') ?? '');
    const atRaw = String(formData.get('atSeconds') ?? '').trim();

    await postComment(session, {
      projectId,
      target: CommentTarget.catch('project').parse(formData.get('target')),
      targetId: String(formData.get('targetId') ?? projectId),
      body: String(formData.get('body') ?? ''),
      atSeconds: atRaw ? Math.max(0, Number(atRaw)) : null,
    });

    revalidatePath(`/app/projects/${projectId}`);
    return { error: null, message: 'Posted.' };
  } catch (error) {
    return { error: reportError('postCommentAction', error).publicMessage };
  }
}

export async function resolveCommentAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const session = await requireSession();
    await resolveComment(session, String(formData.get('commentId') ?? ''));
    revalidatePath(`/app/projects/${String(formData.get('projectId') ?? '')}`);
    return { error: null };
  } catch (error) {
    return { error: reportError('resolveCommentAction', error).publicMessage };
  }
}

/**
 * Renders the storyboard as a moving thing, before the film costs anything.
 *
 * Reading a list of scene durations and feeling a cut are different activities,
 * and a revision is free at this stage and not at the next one.
 */
export async function previewTimingAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const session = await requireSession();
    const project = await getProjectOr404(session, String(formData.get('projectId') ?? ''));
    if (!project.activeStoryboardId) return { error: 'There is no storyboard to preview yet.' };

    await enqueue(project, 'render_animatic', { storyboardId: project.activeStoryboardId }, 6);
    revalidatePath(`/app/projects/${project.id}`);
    return { error: null, message: 'Building a preview of the cut.' };
  } catch (error) {
    return { error: reportError('previewTimingAction', error).publicMessage };
  }
}

/** Reads the film aloud as one piece: the audio version, for feeds and posts. */
export async function produceAudioAction(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requireSession();
    const project = await getProjectOr404(session, String(formData.get('projectId') ?? ''));
    const { produceAudioEdition } = await import('@/server/voice.ts');
    await produceAudioEdition(session, project, {
      brandVoiceId: String(formData.get('brandVoiceId') ?? '') || null,
    });
    revalidatePath(`/app/projects/${project.id}`);
    return { error: null, message: 'Writing it for the ear, then reading it.' };
  } catch (error) {
    return { error: reportError('produceAudioAction', error).publicMessage };
  }
}

/**
 * Corrects the address a project was started from, and reads it again.
 *
 * A founder who typed their own domain wrong had a permanently dead project:
 * the research failed, the page offered a retry that would fail identically
 * forever, and nothing anywhere could change the URL. The only way out was to
 * abandon the project and start another one, which nothing said either.
 *
 * Everything downstream is derived from what we read, so correcting the
 * address restarts from research rather than trying to salvage a brief built
 * from a site that was never reached.
 */
export async function correctWebsiteAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const session = await requireSession();
    const project = await getProjectOr404(session, String(formData.get('projectId') ?? ''));

    if (!can(session.actor, 'project:update')) {
      throw new AppError('forbidden', 'Your role cannot change this project.');
    }

    const website = normalizeUrl(String(formData.get('website') ?? ''));
    if (!website) {
      return { error: 'That does not look like a website address. Try acme.com.' };
    }
    if (website === project.websiteUrl) {
      return { error: 'That is the same address. Change it, or try again as it is.' };
    }

    const store = getStore();
    await store.projects.update(session.organizationId, project.id, {
      websiteUrl: website,
      // The name came from the old host, so it would otherwise keep a typo in
      // the title of every film made from this project.
      name: hostLabel(website),
      productUnderstandingId: null,
      selectedConceptId: null,
      activeStoryboardId: null,
      latestRenderId: null,
      stage: 'created',
    });
    await enqueue({ ...project, websiteUrl: website }, 'research_product', {}, 1);

    revalidatePath(`/app/projects/${project.id}`);
    return { error: null, message: `Reading ${hostLabel(website)} instead.` };
  } catch (error) {
    return { error: reportError('correctWebsiteAction', error).publicMessage };
  }
}

/**
 * Length, tone and language, as the forms send them. Empty means "you
 * decide", which is the brief's own default.
 */
function briefFromForm(formData: FormData): Partial<ProjectBrief> {
  const brief: Partial<ProjectBrief> = {};
  const duration = Number(formData.get('duration') ?? '');
  if (Number.isFinite(duration) && duration > 0) brief.durationSeconds = Math.round(duration);
  const tone = String(formData.get('tone') ?? '');
  if (Tone.options.includes(tone as Tone)) brief.tone = tone as Tone;
  const language = String(formData.get('language') ?? '').trim().toLowerCase();
  if (FILM_LANGUAGES.some((candidate) => candidate.code === language)) brief.language = language;
  const voice = String(formData.get('voice') ?? '');
  if (voice === 'none') {
    brief.voiceStrategy = 'none';
    brief.voiceGender = null;
  } else if (voice === 'female' || voice === 'male') {
    brief.voiceStrategy = null;
    brief.voiceGender = voice;
  }
  // Accent, style and pace: "Auto" is null, so the film's context decides.
  const accent = String(formData.get('voiceAccent') ?? '');
  if (accent && accent !== 'auto' && VoiceAccent.options.includes(accent as VoiceAccent)) {
    brief.voiceAccent = accent as VoiceAccent;
  }
  const style = String(formData.get('voiceStyle') ?? '');
  if (VoiceStyle.options.includes(style as VoiceStyle)) brief.voiceStyle = style as VoiceStyle;
  const pace = String(formData.get('voicePace') ?? '');
  if (VoicePace.options.includes(pace as VoicePace)) brief.voicePace = pace as VoicePace;
  return brief;
}

export async function updateBriefAction(_previous: FormState, formData: FormData): Promise<FormState> {
  try {
    const session = await requireSession();
    if (!can(session.actor, 'project:update')) {
      throw new AppError('forbidden', 'Your role cannot change the brief.');
    }
    const projectId = String(formData.get('projectId') ?? '');
    const project = await getProjectOr404(session, projectId);
    if (stageReached(project.stage, 'rendering')) {
      return { error: 'The film is rendered; the brief is fixed. Start a new project to change it.' };
    }
    const { updateBrief } = await import('@/server/projects.ts');
    await updateBrief(session, project, {
      durationSeconds: null,
      tone: null,
      language: null,
      voiceStrategy: null,
      voiceGender: null,
      voiceAccent: null,
      voiceStyle: null,
      voicePace: null,
      ...briefFromForm(formData),
    });
    revalidatePath(`/app/projects/${projectId}`);
    return { error: null, message: 'Saved. It applies to the next step.' };
  } catch (error) {
    return { error: reportError('updateBriefAction', error).publicMessage };
  }
}
