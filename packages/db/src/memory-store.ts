import {
  AppError,
  levelSeverity,
  matchesLogQuery,
  newId,
  notFound,
  redactDetail,
  redactMessage,
  retryDelayMs,
} from '@act-one/core';
import type {
  LogLevel,
  LogQuery,
  OperationalEvent,
  OperationalEventInput,
  Approval,
  ApprovalGate,
  Asset,
  BrandSystem,
  Comment,
  CommentTarget,
  Concept,
  CreativeTreatment,
  CredentialAuditEvent,
  GenerationCost,
  Job,
  JobKind,
  JobState,
  Membership,
  MemberRole,
  Organization,
  ProductCredential,
  ProductUnderstanding,
  Project,
  ProjectStage,
  QaReport,
  Render,
  RevisionRequest,
  Scene,
  Storyboard,
  Subscription,
  User,
  Variant,
} from '@act-one/core';
import type { PlatformSettings, Store } from './store.ts';

/**
 * In-memory Store.
 *
 * Not a mock: it is a second real implementation of the same contract, and the
 * test suite runs the tenancy conformance suite against both. That is what
 * makes it safe to test the whole creative pipeline without Postgres — if the
 * two implementations ever diverge on isolation semantics, the shared suite
 * fails rather than the difference reaching production.
 */
export class MemoryStore implements Store {
  private readonly tables = {
    organizations: new Map<string, Organization>(),
    users: new Map<string, User & { passwordHash: string | null }>(),
    memberships: new Map<string, Membership>(),
    sessions: new Map<string, { id: string; userId: string; tokenHash: string; expiresAt: string }>(),
    subscriptions: new Map<string, Subscription>(),
    brands: new Map<string, BrandSystem>(),
    projects: new Map<string, Project>(),
    understandings: new Map<string, ProductUnderstanding & { organizationId: string }>(),
    concepts: new Map<string, Concept & { organizationId: string }>(),
    treatments: new Map<string, CreativeTreatment & { organizationId: string }>(),
    storyboards: new Map<string, Storyboard & { organizationId: string }>(),
    scenes: new Map<string, Scene & { organizationId: string }>(),
    assets: new Map<string, Asset>(),
    renders: new Map<string, Render>(),
    variants: new Map<string, Variant & { organizationId: string }>(),
    qaReports: new Map<string, QaReport & { organizationId: string }>(),
    jobs: new Map<string, Job>(),
    costs: new Map<string, GenerationCost>(),
    log: new Map<string, OperationalEvent>(),
    comments: new Map<string, Comment>(),
    approvals: new Map<string, Approval>(),
    revisions: new Map<string, RevisionRequest & { organizationId: string }>(),
    credentials: new Map<string, ProductCredential & { ciphertext: unknown }>(),
    credentialAudit: new Map<string, CredentialAuditEvent>(),
    stripeEvents: new Map<string, string>(),
  };

  private settings: PlatformSettings = {
    providerConfig: {},
    plans: [],
    featureFlags: {},
    creativeBudget: {},
    updatedAt: new Date().toISOString(),
  };

  private providerSecrets = new Map<
    string,
    { ciphertext: unknown; fingerprint: string; enabled: boolean; updatedAt: string }
  >();

  async close(): Promise<void> {
    for (const table of Object.values(this.tables)) table.clear();
  }

  // --- helpers ------------------------------------------------------------

  private scoped<T extends { organizationId: string }>(
    table: Map<string, T>,
    organizationId: string,
  ): T[] {
    return [...table.values()].filter((row) => row.organizationId === organizationId);
  }

  private require<T>(value: T | null | undefined, what: string): T {
    if (value === null || value === undefined) throw notFound(what);
    return value;
  }

  private patch<T extends { organizationId: string; id: string }>(
    table: Map<string, T>,
    organizationId: string,
    id: string,
    // NoInfer keeps the entity type pinned to the table's value type: without
    // it TypeScript widens T to whatever the patch object happens to contain.
    patch: Partial<NoInfer<T>>,
    what: string,
  ): T {
    const existing = table.get(id);
    // Scope check first: an id from another tenant must read as "not found",
    // never as "forbidden", so ids cannot be probed for existence.
    if (!existing || existing.organizationId !== organizationId) throw notFound(what);
    const next = { ...existing, ...patch, id: existing.id, organizationId } as T;
    table.set(id, next);
    return next;
  }

  // --- repositories -------------------------------------------------------

  readonly organizations = {
    create: async (org: Organization) => {
      if ([...this.tables.organizations.values()].some((o) => o.slug === org.slug)) {
        throw new AppError('conflict', `Organization slug "${org.slug}" is taken.`);
      }
      this.tables.organizations.set(org.id, org);
      return org;
    },
    get: async (id: string) => this.tables.organizations.get(id) ?? null,
    getBySlug: async (slug: string) =>
      [...this.tables.organizations.values()].find((o) => o.slug === slug) ?? null,
    getByStripeCustomerId: async (customerId: string) =>
      [...this.tables.organizations.values()].find((o) => o.stripeCustomerId === customerId) ?? null,
    update: async (id: string, patch: Partial<Organization>) => {
      const existing = this.require(this.tables.organizations.get(id), 'Organization');
      const next = { ...existing, ...patch, id };
      this.tables.organizations.set(id, next);
      return next;
    },
    adjustCredits: async (id: string, delta: number) => {
      const existing = this.require(this.tables.organizations.get(id), 'Organization');
      const balance = existing.creditBalance + delta;
      if (balance < 0) return null;
      const next = { ...existing, creditBalance: balance };
      this.tables.organizations.set(id, next);
      return next;
    },
    list: async (limit = 50, offset = 0) =>
      [...this.tables.organizations.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(offset, offset + limit),
    count: async () => this.tables.organizations.size,
  };

  readonly users = {
    create: async (user: User & { passwordHash?: string | null }) => {
      const email = user.email.toLowerCase();
      if ([...this.tables.users.values()].some((u) => u.email === email)) {
        throw new AppError('conflict', 'An account with that email already exists.');
      }
      const record = { ...user, email, passwordHash: user.passwordHash ?? null };
      this.tables.users.set(user.id, record);
      return stripPassword(record);
    },
    get: async (id: string) => {
      const found = this.tables.users.get(id);
      return found ? stripPassword(found) : null;
    },
    getByEmail: async (email: string) =>
      [...this.tables.users.values()].find((u) => u.email === email.toLowerCase()) ?? null,
    update: async (id: string, patch: Partial<User>) => {
      const existing = this.require(this.tables.users.get(id), 'User');
      const next = { ...existing, ...patch, id };
      this.tables.users.set(id, next);
      return stripPassword(next);
    },
    count: async () => this.tables.users.size,
  };

  readonly memberships = {
    create: async (membership: Membership) => {
      const existing = [...this.tables.memberships.values()].find(
        (m) => m.organizationId === membership.organizationId && m.userId === membership.userId,
      );
      if (existing) throw new AppError('conflict', 'Already a member of this organisation.');
      this.tables.memberships.set(membership.id, membership);
      return membership;
    },
    listForUser: async (userId: string) =>
      [...this.tables.memberships.values()].filter((m) => m.userId === userId),
    listForOrganization: async (organizationId: string) =>
      this.scoped(this.tables.memberships, organizationId).map((m) => ({
        ...m,
        user: stripPassword(this.require(this.tables.users.get(m.userId), 'User')),
      })),
    find: async (organizationId: string, userId: string) =>
      [...this.tables.memberships.values()].find(
        (m) => m.organizationId === organizationId && m.userId === userId,
      ) ?? null,
    updateRole: async (organizationId: string, userId: string, role: MemberRole) => {
      const existing = this.require(
        [...this.tables.memberships.values()].find(
          (m) => m.organizationId === organizationId && m.userId === userId,
        ),
        'Membership',
      );
      const next = { ...existing, role };
      this.tables.memberships.set(existing.id, next);
      return next;
    },
    remove: async (organizationId: string, userId: string) => {
      for (const [id, m] of this.tables.memberships) {
        if (m.organizationId === organizationId && m.userId === userId) {
          this.tables.memberships.delete(id);
        }
      }
    },
    countForOrganization: async (organizationId: string) =>
      this.scoped(this.tables.memberships, organizationId).length,
  };

  readonly sessions = {
    create: async (session: { id: string; userId: string; tokenHash: string; expiresAt: string }) => {
      this.tables.sessions.set(session.tokenHash, session);
    },
    findByTokenHash: async (tokenHash: string) => {
      const found = this.tables.sessions.get(tokenHash);
      if (!found) return null;
      return { userId: found.userId, expiresAt: found.expiresAt };
    },
    delete: async (tokenHash: string) => {
      this.tables.sessions.delete(tokenHash);
    },
    deleteExpired: async () => {
      const now = new Date().toISOString();
      let removed = 0;
      for (const [hash, session] of this.tables.sessions) {
        if (session.expiresAt <= now) {
          this.tables.sessions.delete(hash);
          removed += 1;
        }
      }
      return removed;
    },
  };

  readonly subscriptions = {
    upsert: async (subscription: Subscription) => {
      for (const [id, existing] of this.tables.subscriptions) {
        if (existing.organizationId === subscription.organizationId) {
          this.tables.subscriptions.delete(id);
        }
      }
      this.tables.subscriptions.set(subscription.id, subscription);
      return subscription;
    },
    getForOrganization: async (organizationId: string) =>
      this.scoped(this.tables.subscriptions, organizationId)[0] ?? null,
    getByStripeSubscriptionId: async (id: string) =>
      [...this.tables.subscriptions.values()].find((s) => s.stripeSubscriptionId === id) ?? null,
  };

  readonly brands = {
    create: async (brand: BrandSystem) => {
      this.tables.brands.set(brand.id, brand);
      return brand;
    },
    get: async (organizationId: string, id: string) => {
      const found = this.tables.brands.get(id);
      return found && found.organizationId === organizationId ? found : null;
    },
    update: async (organizationId: string, id: string, patch: Partial<BrandSystem>) =>
      this.patch(this.tables.brands, organizationId, id, { ...patch, updatedAt: new Date().toISOString() }, 'Brand'),
    list: async (organizationId: string) => this.scoped(this.tables.brands, organizationId),
  };

  readonly projects = {
    create: async (project: Project) => {
      this.tables.projects.set(project.id, project);
      return project;
    },
    get: async (organizationId: string, id: string) => {
      const found = this.tables.projects.get(id);
      return found && found.organizationId === organizationId ? found : null;
    },
    update: async (organizationId: string, id: string, patch: Partial<Project>) =>
      this.patch(
        this.tables.projects,
        organizationId,
        id,
        { ...patch, updatedAt: new Date().toISOString() },
        'Project',
      ),
    list: async (organizationId: string, options: { includeArchived?: boolean } = {}) =>
      this.scoped(this.tables.projects, organizationId)
        .filter((p) => options.includeArchived || p.archivedAt === null)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    countTowardQuotaSince: async (organizationId: string, since: string) => {
      const understood = new Set(
        [...this.tables.understandings.values()].map((u) => u.projectId),
      );
      return this.scoped(this.tables.projects, organizationId).filter(
        (p) => p.createdAt >= since && !(p.stage === 'failed' && !understood.has(p.id)),
      ).length;
    },
    setStage: async (organizationId: string, id: string, stage: ProjectStage) =>
      this.patch(
        this.tables.projects,
        organizationId,
        id,
        { stage, updatedAt: new Date().toISOString() },
        'Project',
      ),
    addCost: async (organizationId: string, id: string, costUsd: number, credits: number) => {
      const existing = this.tables.projects.get(id);
      if (!existing || existing.organizationId !== organizationId) throw notFound('Project');
      this.tables.projects.set(id, {
        ...existing,
        costUsd: existing.costUsd + costUsd,
        creditsSpent: existing.creditsSpent + credits,
      });
    },
    listByStage: async (stage: ProjectStage, limit = 100) =>
      [...this.tables.projects.values()].filter((p) => p.stage === stage).slice(0, limit),
  };

  readonly understandings = {
    create: async (understanding: ProductUnderstanding, organizationId: string) => {
      this.tables.understandings.set(understanding.id, { ...understanding, organizationId });
      return understanding;
    },
    get: async (organizationId: string, id: string) => {
      const found = this.tables.understandings.get(id);
      return found && found.organizationId === organizationId ? found : null;
    },
    getLatestForProject: async (organizationId: string, projectId: string) =>
      this.scoped(this.tables.understandings, organizationId)
        .filter((u) => u.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null,
    update: async (organizationId: string, id: string, patch: Partial<ProductUnderstanding>) =>
      this.patch(this.tables.understandings, organizationId, id, patch, 'Product understanding'),
  };

  readonly concepts = {
    createMany: async (concepts: Concept[], organizationId: string) => {
      for (const concept of concepts) {
        this.tables.concepts.set(concept.id, { ...concept, organizationId });
      }
      return concepts;
    },
    get: async (organizationId: string, id: string) => {
      const found = this.tables.concepts.get(id);
      return found && found.organizationId === organizationId ? found : null;
    },
    listForProject: async (organizationId: string, projectId: string) =>
      this.scoped(this.tables.concepts, organizationId)
        .filter((c) => c.projectId === projectId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    update: async (organizationId: string, id: string, patch: Partial<Concept>) =>
      this.patch(this.tables.concepts, organizationId, id, patch, 'Concept'),
    select: async (organizationId: string, projectId: string, conceptId: string) => {
      const concepts = this.scoped(this.tables.concepts, organizationId).filter(
        (c) => c.projectId === projectId,
      );
      const target = concepts.find((c) => c.id === conceptId);
      if (!target) throw notFound('Concept');
      for (const concept of concepts) {
        this.tables.concepts.set(concept.id, { ...concept, selected: concept.id === conceptId });
      }
      return { ...target, selected: true };
    },
  };

  readonly treatments = {
    create: async (treatment: CreativeTreatment, organizationId: string) => {
      this.tables.treatments.set(treatment.id, { ...treatment, organizationId });
      return treatment;
    },
    get: async (organizationId: string, id: string) => {
      const found = this.tables.treatments.get(id);
      return found && found.organizationId === organizationId ? found : null;
    },
    getForConcept: async (organizationId: string, conceptId: string) =>
      this.scoped(this.tables.treatments, organizationId)
        .filter((t) => t.conceptId === conceptId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null,
  };

  readonly storyboards = {
    create: async (storyboard: Storyboard, organizationId: string) => {
      this.tables.storyboards.set(storyboard.id, { ...storyboard, organizationId, scenes: [] });
      for (const scene of storyboard.scenes) {
        this.tables.scenes.set(scene.id, { ...scene, organizationId });
      }
      return storyboard;
    },
    get: async (organizationId: string, id: string) => {
      const found = this.tables.storyboards.get(id);
      if (!found || found.organizationId !== organizationId) return null;
      return { ...found, scenes: this.scenesFor(organizationId, id) };
    },
    listForProject: async (organizationId: string, projectId: string) =>
      this.scoped(this.tables.storyboards, organizationId)
        .filter((s) => s.projectId === projectId)
        .sort((a, b) => b.version - a.version)
        .map((s) => ({ ...s, scenes: this.scenesFor(organizationId, s.id) })),
    replaceScenes: async (organizationId: string, storyboardId: string, scenes: Scene[]) => {
      const board = this.tables.storyboards.get(storyboardId);
      if (!board || board.organizationId !== organizationId) throw notFound('Storyboard');
      for (const [id, scene] of this.tables.scenes) {
        if (scene.storyboardId === storyboardId) this.tables.scenes.delete(id);
      }
      for (const scene of scenes) {
        this.tables.scenes.set(scene.id, { ...scene, organizationId, storyboardId });
      }
      const next = { ...board, updatedAt: new Date().toISOString() };
      this.tables.storyboards.set(storyboardId, next);
      return { ...next, scenes };
    },
    updateScene: async (organizationId: string, sceneId: string, patch: Partial<Scene>) =>
      this.patch(this.tables.scenes, organizationId, sceneId, patch, 'Scene'),
    getScene: async (organizationId: string, sceneId: string) => {
      const found = this.tables.scenes.get(sceneId);
      return found && found.organizationId === organizationId ? found : null;
    },
    update: async (organizationId: string, id: string, patch: Partial<Storyboard>) => {
      const next = this.patch(
        this.tables.storyboards,
        organizationId,
        id,
        { ...patch, scenes: [], updatedAt: new Date().toISOString() },
        'Storyboard',
      );
      return { ...next, scenes: this.scenesFor(organizationId, id) };
    },
    nextVersion: async (organizationId: string, projectId: string) => {
      const versions = this.scoped(this.tables.storyboards, organizationId)
        .filter((s) => s.projectId === projectId)
        .map((s) => s.version);
      return versions.length === 0 ? 1 : Math.max(...versions) + 1;
    },
  };

  private scenesFor(organizationId: string, storyboardId: string): Scene[] {
    return this.scoped(this.tables.scenes, organizationId)
      .filter((s) => s.storyboardId === storyboardId)
      .sort((a, b) => a.index - b.index);
  }

  readonly assets = {
    create: async (asset: Asset) => {
      this.tables.assets.set(asset.id, asset);
      return asset;
    },
    get: async (organizationId: string, id: string) => {
      const found = this.tables.assets.get(id);
      return found && found.organizationId === organizationId ? found : null;
    },
    getMany: async (organizationId: string, ids: string[]) =>
      ids
        .map((id) => this.tables.assets.get(id))
        .filter((a): a is Asset => Boolean(a) && a!.organizationId === organizationId),
    listForProject: async (organizationId: string, projectId: string, kind?: Asset['kind']) =>
      this.scoped(this.tables.assets, organizationId)
        .filter((a) => a.projectId === projectId && (!kind || a.kind === kind))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    listForScene: async (organizationId: string, sceneId: string) =>
      this.scoped(this.tables.assets, organizationId).filter((a) => a.sceneId === sceneId),
    update: async (organizationId: string, id: string, patch: Partial<Asset>) =>
      this.patch(this.tables.assets, organizationId, id, patch, 'Asset'),
    delete: async (organizationId: string, id: string) => {
      const found = this.tables.assets.get(id);
      if (found && found.organizationId === organizationId) this.tables.assets.delete(id);
    },
  };

  readonly renders = {
    create: async (render: Render) => {
      this.tables.renders.set(render.id, render);
      return render;
    },
    get: async (organizationId: string, id: string) => {
      const found = this.tables.renders.get(id);
      return found && found.organizationId === organizationId ? found : null;
    },
    listForProject: async (organizationId: string, projectId: string) =>
      this.scoped(this.tables.renders, organizationId)
        .filter((r) => r.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    update: async (organizationId: string, id: string, patch: Partial<Render>) =>
      this.patch(this.tables.renders, organizationId, id, patch, 'Render'),
    countForProject: async (organizationId: string, projectId: string) =>
      this.scoped(this.tables.renders, organizationId).filter((r) => r.projectId === projectId).length,
    listActive: async (limit = 50) =>
      [...this.tables.renders.values()]
        .filter((r) => !['completed', 'failed', 'canceled'].includes(r.status))
        .slice(0, limit),
  };

  readonly variants = {
    createMany: async (variants: Variant[]) => {
      for (const variant of variants) {
        const render = this.tables.renders.get(variant.renderId);
        if (!render) throw notFound('Render');
        this.tables.variants.set(variant.id, { ...variant, organizationId: render.organizationId });
      }
      return variants;
    },
    listForRender: async (organizationId: string, renderId: string) =>
      this.scoped(this.tables.variants, organizationId).filter((v) => v.renderId === renderId),
    update: async (organizationId: string, id: string, patch: Partial<Variant>) =>
      this.patch(this.tables.variants, organizationId, id, patch, 'Variant'),
  };

  readonly qaReports = {
    create: async (report: QaReport, organizationId: string) => {
      this.tables.qaReports.set(report.id, { ...report, organizationId });
      return report;
    },
    get: async (organizationId: string, id: string) => {
      const found = this.tables.qaReports.get(id);
      return found && found.organizationId === organizationId ? found : null;
    },
    getForRender: async (organizationId: string, renderId: string) =>
      this.scoped(this.tables.qaReports, organizationId)
        .filter((r) => r.renderId === renderId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null,
  };

  readonly jobs = {
    enqueue: async (job: Job) => {
      this.tables.jobs.set(job.id, job);
      return job;
    },
    get: async (organizationId: string, id: string) => {
      const found = this.tables.jobs.get(id);
      return found && found.organizationId === organizationId ? found : null;
    },
    claim: async (workerId: string, kinds?: JobKind[]) => {
      const now = new Date().toISOString();
      const candidates = [...this.tables.jobs.values()]
        .filter(
          (job) =>
            job.state === 'queued' &&
            job.lockedBy === null &&
            job.runAfter <= now &&
            (!kinds || kinds.includes(job.kind)),
        )
        .sort((a, b) => b.priority - a.priority || a.runAfter.localeCompare(b.runAfter));
      const job = candidates[0];
      if (!job) return null;
      const claimed = {
        ...job,
        lockedBy: workerId,
        lockedAt: now,
        attempts: job.attempts + 1,
        updatedAt: now,
      };
      this.tables.jobs.set(job.id, claimed);
      return claimed;
    },
    update: async (id: string, patch: Partial<Job>) => {
      const existing = this.require(this.tables.jobs.get(id), 'Job');
      const next = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
      this.tables.jobs.set(id, next);
      return next;
    },
    complete: async (id: string, state: JobState, message = '') => {
      const existing = this.require(this.tables.jobs.get(id), 'Job');
      const next = {
        ...existing,
        state,
        statusMessage: message,
        progress: state === 'completed' ? 1 : existing.progress,
        lockedBy: null,
        lockedAt: null,
        updatedAt: new Date().toISOString(),
      };
      this.tables.jobs.set(id, next);
      return next;
    },
    fail: async (id: string, error: string, retryAt: string | null) => {
      const existing = this.require(this.tables.jobs.get(id), 'Job');
      const exhausted = retryAt === null || existing.attempts >= existing.maxAttempts;
      const next: Job = {
        ...existing,
        state: exhausted ? 'failed' : 'queued',
        lastError: error,
        lockedBy: null,
        lockedAt: null,
        runAfter: retryAt ?? existing.runAfter,
        updatedAt: new Date().toISOString(),
      };
      this.tables.jobs.set(id, next);
      return next;
    },
    listForProject: async (organizationId: string, projectId: string) =>
      this.scoped(this.tables.jobs, organizationId)
        .filter((j) => j.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    reapStale: async (olderThanMs: number) => {
      const cutoff = new Date(Date.now() - olderThanMs).toISOString();
      let reaped = 0;
      for (const [id, job] of this.tables.jobs) {
        if (job.lockedBy && job.lockedAt && job.lockedAt < cutoff) {
          this.tables.jobs.set(id, {
            ...job,
            lockedBy: null,
            lockedAt: null,
            state: job.attempts >= job.maxAttempts ? 'failed' : 'queued',
            lastError: 'Worker lock expired; job reclaimed.',
            runAfter: new Date(Date.now() + retryDelayMs(job.attempts)).toISOString(),
          });
          reaped += 1;
        }
      }
      return reaped;
    },
    countByState: async () => {
      const counts: Record<string, number> = {};
      for (const job of this.tables.jobs.values()) {
        counts[job.state] = (counts[job.state] ?? 0) + 1;
      }
      return counts;
    },
  };

  readonly costs = {
    record: async (cost: GenerationCost) => {
      this.tables.costs.set(cost.id, cost);
      return cost;
    },
    listForProject: async (organizationId: string, projectId: string) =>
      this.scoped(this.tables.costs, organizationId).filter((c) => c.projectId === projectId),
    totalForProject: async (organizationId: string, projectId: string) =>
      this.scoped(this.tables.costs, organizationId)
        .filter((c) => c.projectId === projectId)
        .reduce((sum, c) => sum + c.actualCostUsd, 0),
    totalForOrganization: async (organizationId: string, since?: string) =>
      this.scoped(this.tables.costs, organizationId)
        .filter((c) => !since || c.createdAt >= since)
        .reduce((sum, c) => sum + c.actualCostUsd, 0),
    platformSummary: async (since: string) => {
      const rows = [...this.tables.costs.values()].filter((c) => c.createdAt >= since);
      const byProvider = new Map<string, { costUsd: number; calls: number; failures: number }>();
      const byOperation = new Map<string, { costUsd: number; calls: number }>();
      for (const row of rows) {
        const p = byProvider.get(row.provider) ?? { costUsd: 0, calls: 0, failures: 0 };
        p.costUsd += row.actualCostUsd;
        p.calls += 1;
        if (!row.succeeded) p.failures += 1;
        byProvider.set(row.provider, p);

        const o = byOperation.get(row.operation) ?? { costUsd: 0, calls: 0 };
        o.costUsd += row.actualCostUsd;
        o.calls += 1;
        byOperation.set(row.operation, o);
      }
      return {
        totalCostUsd: rows.reduce((sum, r) => sum + r.actualCostUsd, 0),
        totalCreditsCharged: rows.reduce((sum, r) => sum + r.creditsCharged, 0),
        byProvider: [...byProvider.entries()].map(([provider, v]) => ({ provider, ...v })),
        byOperation: [...byOperation.entries()].map(([operation, v]) => ({ operation, ...v })),
      };
    },
  };

  readonly log = {
    record: async (input: OperationalEventInput) => this.writeEvent(input),
    recordSafely: (input: OperationalEventInput) => {
      // Logging a failure must never become a second failure.
      try {
        this.writeEvent(input);
      } catch {
        /* ignore */
      }
    },
    list: async (query: LogQuery = {}) => {
      const rows = [...this.tables.log.values()]
        .filter((e) => matchesLogQuery(e, query))
        .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      return rows.slice(0, query.limit ?? 200);
    },
    levelCounts: async (since: string) => {
      const counts: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
      for (const event of this.tables.log.values()) {
        if (event.at >= since) counts[event.level] += 1;
      }
      return counts;
    },
    topEvents: async (since: string, limit = 8) => {
      const seen = new Map<string, { event: string; level: LogLevel; count: number }>();
      for (const event of this.tables.log.values()) {
        if (event.at < since) continue;
        const existing = seen.get(event.event);
        if (existing) {
          existing.count += 1;
          if (levelSeverity(event.level) > levelSeverity(existing.level)) existing.level = event.level;
        } else {
          seen.set(event.event, { event: event.event, level: event.level, count: 1 });
        }
      }
      return [...seen.values()].sort((a, b) => b.count - a.count).slice(0, limit);
    },
    prune: async (olderThan: string) => {
      let removed = 0;
      for (const [id, event] of this.tables.log) {
        if (event.at < olderThan) {
          this.tables.log.delete(id);
          removed += 1;
        }
      }
      return removed;
    },
  };

  private writeEvent(input: OperationalEventInput): OperationalEvent {
    const event: OperationalEvent = {
      ...input,
      id: input.id ?? newId('evt'),
      at: input.at ?? new Date().toISOString(),
      message: redactMessage(input.message ?? ''),
      detail: redactDetail(input.detail ?? {}),
    };
    this.tables.log.set(event.id, event);
    return event;
  }

  readonly comments = {
    create: async (comment: Comment) => {
      this.tables.comments.set(comment.id, comment);
      return comment;
    },
    listForTarget: async (organizationId: string, target: CommentTarget, targetId: string) =>
      this.scoped(this.tables.comments, organizationId)
        .filter((c) => c.target === target && c.targetId === targetId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    listForProject: async (organizationId: string, projectId: string) =>
      this.scoped(this.tables.comments, organizationId).filter((c) => c.projectId === projectId),
    resolve: async (organizationId: string, id: string, userId: string) =>
      this.patch(
        this.tables.comments,
        organizationId,
        id,
        { resolvedAt: new Date().toISOString(), resolvedByUserId: userId },
        'Comment',
      ),
  };

  readonly approvals = {
    create: async (approval: Approval) => {
      this.tables.approvals.set(approval.id, approval);
      return approval;
    },
    listForProject: async (organizationId: string, projectId: string) =>
      this.scoped(this.tables.approvals, organizationId).filter((a) => a.projectId === projectId),
    has: async (organizationId: string, projectId: string, gate: ApprovalGate, targetId: string) =>
      this.scoped(this.tables.approvals, organizationId).some(
        (a) => a.projectId === projectId && a.gate === gate && a.targetId === targetId,
      ),
  };

  readonly revisions = {
    create: async (revision: RevisionRequest, organizationId: string) => {
      this.tables.revisions.set(revision.id, { ...revision, organizationId });
      return revision;
    },
    listForStoryboard: async (organizationId: string, storyboardId: string) =>
      this.scoped(this.tables.revisions, organizationId)
        .filter((r) => r.storyboardId === storyboardId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    markApplied: async (organizationId: string, id: string, affectedSceneIds: string[]) =>
      this.patch(
        this.tables.revisions,
        organizationId,
        id,
        { applied: true, appliedAt: new Date().toISOString(), affectedSceneIds },
        'Revision request',
      ),
  };

  readonly credentials = {
    create: async (credential: ProductCredential, ciphertext: unknown) => {
      this.tables.credentials.set(credential.id, { ...credential, ciphertext });
      return credential;
    },
    getForProject: async (organizationId: string, projectId: string) => {
      const found = this.scoped(this.tables.credentials, organizationId).find(
        (c) => c.projectId === projectId && c.revokedAt === null,
      );
      if (!found) return null;
      const { ciphertext: _ciphertext, ...credential } = found;
      return credential;
    },
    getCiphertext: async (organizationId: string, credentialId: string) => {
      const found = this.tables.credentials.get(credentialId);
      if (!found || found.organizationId !== organizationId || found.revokedAt) return null;
      return found.ciphertext;
    },
    revoke: async (organizationId: string, credentialId: string) => {
      const found = this.tables.credentials.get(credentialId);
      if (!found || found.organizationId !== organizationId) throw notFound('Credential');
      this.tables.credentials.set(credentialId, {
        ...found,
        revokedAt: new Date().toISOString(),
        // Revocation destroys the sealed secret rather than merely flagging the
        // row: "revoked" must mean the material is gone.
        ciphertext: null,
      });
    },
    touch: async (organizationId: string, credentialId: string) => {
      const found = this.tables.credentials.get(credentialId);
      if (!found || found.organizationId !== organizationId) return;
      this.tables.credentials.set(credentialId, {
        ...found,
        lastUsedAt: new Date().toISOString(),
      });
    },
    audit: async (event: CredentialAuditEvent) => {
      this.tables.credentialAudit.set(event.id, event);
    },
    listAudit: async (organizationId: string, credentialId: string) =>
      this.scoped(this.tables.credentialAudit, organizationId)
        .filter((e) => e.credentialId === credentialId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };

  readonly platform = {
    getSettings: async () => this.settings,
    updateSettings: async (patch: Partial<PlatformSettings>, _updatedBy: string) => {
      this.settings = { ...this.settings, ...patch, updatedAt: new Date().toISOString() };
      return this.settings;
    },
    setProviderSecret: async (
      provider: string,
      ciphertext: unknown,
      fingerprint: string,
      _updatedBy: string,
    ) => {
      this.providerSecrets.set(provider, {
        ciphertext,
        fingerprint,
        enabled: true,
        updatedAt: new Date().toISOString(),
      });
    },
    getProviderSecret: async (provider: string) => {
      const found = this.providerSecrets.get(provider);
      return found ? { ciphertext: found.ciphertext, fingerprint: found.fingerprint, enabled: found.enabled } : null;
    },
    listProviderSecrets: async () =>
      [...this.providerSecrets.entries()].map(([provider, v]) => ({
        provider,
        fingerprint: v.fingerprint,
        enabled: v.enabled,
        updatedAt: v.updatedAt,
      })),
    recordStripeEvent: async (id: string, type: string) => {
      if (this.tables.stripeEvents.has(id)) return false;
      this.tables.stripeEvents.set(id, type);
      return true;
    },
  };
}

function stripPassword<T extends { passwordHash?: string | null }>(record: T): Omit<T, 'passwordHash'> {
  const { passwordHash: _passwordHash, ...rest } = record;
  return rest;
}
