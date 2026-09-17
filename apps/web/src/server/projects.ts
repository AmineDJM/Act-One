import 'server-only';
import {
  AppError,
  newId,
  ProjectBrief,
  type ProjectBrief as ProjectBriefType,
  can,
  hasEntitlement,
  withinLimit,
  type Job,
  type JobKind,
  type Project,
  type ProjectStage,
} from '@act-one/core';
import { getStore } from './store.ts';
import { entitlementsFor } from './platform.ts';
import type { Session } from './auth.ts';

/**
 * Project lifecycle.
 *
 * Every entry point runs the same three checks in the same order — permission,
 * entitlement, limit — so a new route cannot accidentally skip one. They fail
 * with distinct errors because the fixes are different: a permission failure
 * means ask your admin, an entitlement failure means upgrade, a limit failure
 * means wait or upgrade.
 */
export type CreateProjectInput = {
  websiteUrl: string;
  name?: string;
  supplementalUrls?: string[];
  brief?: Partial<ProjectBriefType>;
};

export async function createProject(session: Session, input: CreateProjectInput): Promise<Project> {
  const store = getStore();

  if (!can(session.actor, 'project:create')) {
    throw new AppError('forbidden', 'Your role cannot create projects.');
  }

  const organization = await store.organizations.get(session.organizationId);
  if (!organization) throw new AppError('not_found', 'Workspace not found.');
  if (organization.isSuspended) {
    throw new AppError('forbidden', 'This workspace is suspended. Contact support.');
  }

  const { plan, entitlements } = await entitlementsFor(organization);
  if (!entitlements.has('research.run')) {
    throw new AppError('entitlement_required', 'Your plan cannot start new research.');
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const used = await store.projects.countCreatedSince(organization.id, monthStart.toISOString());

  if (!withinLimit(plan.limits.projectsPerMonth, used)) {
    throw new AppError(
      'entitlement_required',
      `${plan.name} includes ${plan.limits.projectsPerMonth} project${
        plan.limits.projectsPerMonth === 1 ? '' : 's'
      } a month. Upgrade to start another.`,
    );
  }

  const now = new Date().toISOString();
  const project = await store.projects.create({
    id: newId('prj'),
    organizationId: organization.id,
    createdByUserId: session.user.id,
    name: input.name?.trim() || hostLabel(input.websiteUrl),
    websiteUrl: input.websiteUrl,
    supplementalUrls: input.supplementalUrls ?? [],
    brandId: null,
    productUnderstandingId: null,
    selectedConceptId: null,
    activeStoryboardId: null,
    latestRenderId: null,
    stage: 'created',
    brief: ProjectBrief.parse(input.brief ?? {}),
    productCredentialId: null,
    costUsd: 0,
    creditsSpent: 0,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  // Research starts immediately. The whole promise of the product is that
  // pasting a URL is the last thing you have to do.
  await enqueue(project, 'research_product', { websiteUrl: project.websiteUrl }, 10);
  await store.projects.setStage(organization.id, project.id, 'researching');

  return { ...project, stage: 'researching' };
}

export async function enqueue(
  project: Project,
  kind: JobKind,
  payload: Record<string, unknown> = {},
  priority = 0,
): Promise<Job> {
  const now = new Date().toISOString();
  return getStore().jobs.enqueue({
    id: newId('job'),
    organizationId: project.organizationId,
    projectId: project.id,
    kind,
    state: 'queued',
    payload,
    progress: 0,
    statusMessage: '',
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
    runAfter: now,
    lockedBy: null,
    lockedAt: null,
    priority,
    createdAt: now,
    updatedAt: now,
  });
}

export async function getProjectOr404(session: Session, projectId: string): Promise<Project> {
  const project = await getStore().projects.get(session.organizationId, projectId);
  if (!project) throw new AppError('not_found', 'Project not found.');
  return project;
}

/**
 * Everything the project page needs, in one pass.
 *
 * Assembled server-side rather than fetched piecemeal by the client: the page
 * shows one strong CTA derived from the whole state, and computing that from
 * four independently-loading fetches produces a CTA that flickers between
 * answers while they arrive.
 */
export async function loadProjectView(session: Session, projectId: string) {
  const store = getStore();
  const project = await getProjectOr404(session, projectId);

  const [understanding, brand, concepts, storyboards, renders, jobs, organization] =
    await Promise.all([
      project.productUnderstandingId
        ? store.understandings.get(session.organizationId, project.productUnderstandingId)
        : store.understandings.getLatestForProject(session.organizationId, project.id),
      project.brandId ? store.brands.get(session.organizationId, project.brandId) : null,
      store.concepts.listForProject(session.organizationId, project.id),
      store.storyboards.listForProject(session.organizationId, project.id),
      store.renders.listForProject(session.organizationId, project.id),
      store.jobs.listForProject(session.organizationId, project.id),
      store.organizations.get(session.organizationId),
    ]);

  const { plan, entitlements } = organization
    ? await entitlementsFor(organization)
    : { plan: null, entitlements: new Set<never>() };

  return {
    project,
    understanding,
    brand,
    concepts,
    storyboard: storyboards[0] ?? null,
    renders,
    activeJob: jobs.find((job) => job.state !== 'completed' && job.state !== 'failed') ?? null,
    jobs,
    organization,
    plan,
    entitlements,
  };
}

export async function setStage(session: Session, projectId: string, stage: ProjectStage) {
  return getStore().projects.setStage(session.organizationId, projectId, stage);
}

/** Can this organisation render a clean master, or only a watermarked preview? */
export async function renderPermission(session: Session, project: Project) {
  const store = getStore();
  const organization = await store.organizations.get(session.organizationId);
  if (!organization) throw new AppError('not_found', 'Workspace not found.');

  const { plan, entitlements } = await entitlementsFor(organization);
  const renders = await store.renders.countForProject(session.organizationId, project.id);

  if (!entitlements.has('render.clean')) {
    return {
      allowed: entitlements.has('render.watermarked'),
      watermarked: true,
      reason: `${plan.name} renders a watermarked preview. Upgrade for a clean master.`,
      plan,
    };
  }
  if (!withinLimit(plan.limits.rendersPerProject, renders)) {
    return {
      allowed: false,
      watermarked: false,
      reason: `${plan.name} includes ${plan.limits.rendersPerProject} renders per project.`,
      plan,
    };
  }
  return { allowed: true, watermarked: false, reason: '', plan };
}

function hostLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const name = host.split('.')[0] ?? host;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return 'New project';
  }
}
