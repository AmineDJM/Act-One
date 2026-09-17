import type {
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

/**
 * The persistence contract.
 *
 * Deliberately narrow: it exposes the operations the product performs, not
 * generic CRUD over every table. That keeps two implementations (Postgres for
 * production, in-memory for tests and local development) genuinely equivalent,
 * and it means a reviewer can see every way the system touches customer data
 * by reading one file.
 *
 * Every tenant-scoped method takes organizationId as its first argument. This
 * is not decoration — it is the parameter that makes it impossible to write a
 * repository call that forgets to scope, and it is mirrored by row-level
 * security in migration 0002 so a mistake fails closed at the database.
 */
export interface Store {
  readonly organizations: OrganizationRepo;
  readonly users: UserRepo;
  readonly memberships: MembershipRepo;
  readonly sessions: SessionRepo;
  readonly subscriptions: SubscriptionRepo;
  readonly brands: BrandRepo;
  readonly projects: ProjectRepo;
  readonly understandings: UnderstandingRepo;
  readonly concepts: ConceptRepo;
  readonly treatments: TreatmentRepo;
  readonly storyboards: StoryboardRepo;
  readonly assets: AssetRepo;
  readonly renders: RenderRepo;
  readonly variants: VariantRepo;
  readonly qaReports: QaReportRepo;
  readonly jobs: JobRepo;
  readonly costs: CostRepo;
  readonly comments: CommentRepo;
  readonly approvals: ApprovalRepo;
  readonly revisions: RevisionRepo;
  readonly credentials: CredentialRepo;
  readonly platform: PlatformRepo;
  close(): Promise<void>;
}

export interface OrganizationRepo {
  create(org: Organization): Promise<Organization>;
  get(id: string): Promise<Organization | null>;
  getBySlug(slug: string): Promise<Organization | null>;
  getByStripeCustomerId(customerId: string): Promise<Organization | null>;
  update(id: string, patch: Partial<Organization>): Promise<Organization>;
  /** Atomic credit movement. Returns null when the balance would go negative. */
  adjustCredits(id: string, delta: number): Promise<Organization | null>;
  list(limit?: number, offset?: number): Promise<Organization[]>;
  count(): Promise<number>;
}

export interface UserRepo {
  create(user: User & { passwordHash?: string | null }): Promise<User>;
  get(id: string): Promise<User | null>;
  getByEmail(email: string): Promise<(User & { passwordHash: string | null }) | null>;
  update(id: string, patch: Partial<User>): Promise<User>;
  count(): Promise<number>;
}

export interface MembershipRepo {
  create(membership: Membership): Promise<Membership>;
  listForUser(userId: string): Promise<Membership[]>;
  listForOrganization(organizationId: string): Promise<(Membership & { user: User })[]>;
  find(organizationId: string, userId: string): Promise<Membership | null>;
  updateRole(organizationId: string, userId: string, role: MemberRole): Promise<Membership>;
  remove(organizationId: string, userId: string): Promise<void>;
  countForOrganization(organizationId: string): Promise<number>;
}

export interface SessionRepo {
  create(session: { id: string; userId: string; tokenHash: string; expiresAt: string }): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<{ userId: string; expiresAt: string } | null>;
  delete(tokenHash: string): Promise<void>;
  deleteExpired(): Promise<number>;
}

export interface SubscriptionRepo {
  upsert(subscription: Subscription): Promise<Subscription>;
  getForOrganization(organizationId: string): Promise<Subscription | null>;
  getByStripeSubscriptionId(id: string): Promise<Subscription | null>;
}

export interface BrandRepo {
  create(brand: BrandSystem): Promise<BrandSystem>;
  get(organizationId: string, id: string): Promise<BrandSystem | null>;
  update(organizationId: string, id: string, patch: Partial<BrandSystem>): Promise<BrandSystem>;
  list(organizationId: string): Promise<BrandSystem[]>;
}

export interface ProjectRepo {
  create(project: Project): Promise<Project>;
  get(organizationId: string, id: string): Promise<Project | null>;
  update(organizationId: string, id: string, patch: Partial<Project>): Promise<Project>;
  list(organizationId: string, options?: { includeArchived?: boolean }): Promise<Project[]>;
  countCreatedSince(organizationId: string, since: string): Promise<number>;
  setStage(organizationId: string, id: string, stage: ProjectStage): Promise<Project>;
  addCost(organizationId: string, id: string, costUsd: number, credits: number): Promise<void>;
  listByStage(stage: ProjectStage, limit?: number): Promise<Project[]>;
}

export interface UnderstandingRepo {
  create(understanding: ProductUnderstanding, organizationId: string): Promise<ProductUnderstanding>;
  get(organizationId: string, id: string): Promise<ProductUnderstanding | null>;
  getLatestForProject(organizationId: string, projectId: string): Promise<ProductUnderstanding | null>;
  update(
    organizationId: string,
    id: string,
    patch: Partial<ProductUnderstanding>,
  ): Promise<ProductUnderstanding>;
}

export interface ConceptRepo {
  createMany(concepts: Concept[], organizationId: string): Promise<Concept[]>;
  get(organizationId: string, id: string): Promise<Concept | null>;
  listForProject(organizationId: string, projectId: string): Promise<Concept[]>;
  update(organizationId: string, id: string, patch: Partial<Concept>): Promise<Concept>;
  /** Marks one concept selected and clears the rest, in a single transaction. */
  select(organizationId: string, projectId: string, conceptId: string): Promise<Concept>;
}

export interface TreatmentRepo {
  create(treatment: CreativeTreatment, organizationId: string): Promise<CreativeTreatment>;
  get(organizationId: string, id: string): Promise<CreativeTreatment | null>;
  getForConcept(organizationId: string, conceptId: string): Promise<CreativeTreatment | null>;
}

export interface StoryboardRepo {
  create(storyboard: Storyboard, organizationId: string): Promise<Storyboard>;
  get(organizationId: string, id: string): Promise<Storyboard | null>;
  listForProject(organizationId: string, projectId: string): Promise<Storyboard[]>;
  /** Replaces the whole scene list atomically; used by every structural edit. */
  replaceScenes(organizationId: string, storyboardId: string, scenes: Scene[]): Promise<Storyboard>;
  updateScene(organizationId: string, sceneId: string, patch: Partial<Scene>): Promise<Scene>;
  getScene(organizationId: string, sceneId: string): Promise<Scene | null>;
  update(organizationId: string, id: string, patch: Partial<Storyboard>): Promise<Storyboard>;
  nextVersion(organizationId: string, projectId: string): Promise<number>;
}

export interface AssetRepo {
  create(asset: Asset): Promise<Asset>;
  get(organizationId: string, id: string): Promise<Asset | null>;
  getMany(organizationId: string, ids: string[]): Promise<Asset[]>;
  listForProject(organizationId: string, projectId: string, kind?: Asset['kind']): Promise<Asset[]>;
  listForScene(organizationId: string, sceneId: string): Promise<Asset[]>;
  update(organizationId: string, id: string, patch: Partial<Asset>): Promise<Asset>;
  delete(organizationId: string, id: string): Promise<void>;
}

export interface RenderRepo {
  create(render: Render): Promise<Render>;
  get(organizationId: string, id: string): Promise<Render | null>;
  listForProject(organizationId: string, projectId: string): Promise<Render[]>;
  update(organizationId: string, id: string, patch: Partial<Render>): Promise<Render>;
  countForProject(organizationId: string, projectId: string): Promise<number>;
  listActive(limit?: number): Promise<Render[]>;
}

export interface VariantRepo {
  createMany(variants: Variant[]): Promise<Variant[]>;
  listForRender(organizationId: string, renderId: string): Promise<Variant[]>;
  update(organizationId: string, id: string, patch: Partial<Variant>): Promise<Variant>;
}

export interface QaReportRepo {
  create(report: QaReport, organizationId: string): Promise<QaReport>;
  get(organizationId: string, id: string): Promise<QaReport | null>;
  getForRender(organizationId: string, renderId: string): Promise<QaReport | null>;
}

export interface JobRepo {
  enqueue(job: Job): Promise<Job>;
  get(organizationId: string, id: string): Promise<Job | null>;
  /**
   * Atomically claims the next runnable job. Implementations must make this
   * safe under concurrent workers — in Postgres via SKIP LOCKED.
   */
  claim(workerId: string, kinds?: JobKind[]): Promise<Job | null>;
  update(id: string, patch: Partial<Job>): Promise<Job>;
  complete(id: string, state: JobState, message?: string): Promise<Job>;
  fail(id: string, error: string, retryAt: string | null): Promise<Job>;
  listForProject(organizationId: string, projectId: string): Promise<Job[]>;
  /** Releases jobs whose worker died holding the lock. */
  reapStale(olderThanMs: number): Promise<number>;
  countByState(): Promise<Record<string, number>>;
}

export interface CostRepo {
  record(cost: GenerationCost): Promise<GenerationCost>;
  listForProject(organizationId: string, projectId: string): Promise<GenerationCost[]>;
  totalForProject(organizationId: string, projectId: string): Promise<number>;
  totalForOrganization(organizationId: string, since?: string): Promise<number>;
  /** Platform-wide rollup for the Super Admin dashboard. */
  platformSummary(since: string): Promise<{
    totalCostUsd: number;
    totalCreditsCharged: number;
    byProvider: { provider: string; costUsd: number; calls: number; failures: number }[];
    byOperation: { operation: string; costUsd: number; calls: number }[];
  }>;
}

export interface CommentRepo {
  create(comment: Comment): Promise<Comment>;
  listForTarget(organizationId: string, target: CommentTarget, targetId: string): Promise<Comment[]>;
  listForProject(organizationId: string, projectId: string): Promise<Comment[]>;
  resolve(organizationId: string, id: string, userId: string): Promise<Comment>;
}

export interface ApprovalRepo {
  create(approval: Approval): Promise<Approval>;
  listForProject(organizationId: string, projectId: string): Promise<Approval[]>;
  has(organizationId: string, projectId: string, gate: ApprovalGate, targetId: string): Promise<boolean>;
}

export interface RevisionRepo {
  create(revision: RevisionRequest, organizationId: string): Promise<RevisionRequest>;
  listForStoryboard(organizationId: string, storyboardId: string): Promise<RevisionRequest[]>;
  markApplied(organizationId: string, id: string, affectedSceneIds: string[]): Promise<RevisionRequest>;
}

export interface CredentialRepo {
  create(
    credential: ProductCredential,
    ciphertext: unknown,
  ): Promise<ProductCredential>;
  getForProject(organizationId: string, projectId: string): Promise<ProductCredential | null>;
  /** Returns the sealed envelope. Decryption happens only in the worker. */
  getCiphertext(organizationId: string, credentialId: string): Promise<unknown | null>;
  revoke(organizationId: string, credentialId: string): Promise<void>;
  touch(organizationId: string, credentialId: string): Promise<void>;
  audit(event: CredentialAuditEvent): Promise<void>;
  listAudit(organizationId: string, credentialId: string): Promise<CredentialAuditEvent[]>;
}

export type PlatformSettings = {
  providerConfig: Record<string, unknown>;
  plans: unknown[];
  featureFlags: Record<string, boolean>;
  creativeBudget: Record<string, unknown>;
  updatedAt: string;
};

export interface PlatformRepo {
  getSettings(): Promise<PlatformSettings>;
  updateSettings(patch: Partial<PlatformSettings>, updatedBy: string): Promise<PlatformSettings>;
  setProviderSecret(provider: string, ciphertext: unknown, fingerprint: string, updatedBy: string): Promise<void>;
  getProviderSecret(provider: string): Promise<{ ciphertext: unknown; fingerprint: string; enabled: boolean } | null>;
  listProviderSecrets(): Promise<{ provider: string; fingerprint: string; enabled: boolean; updatedAt: string }[]>;
  /** Stripe webhook idempotency. Returns false when the event was already seen. */
  recordStripeEvent(id: string, type: string): Promise<boolean>;
}
