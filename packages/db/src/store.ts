import type {
  Approval,
  ApprovalGate,
  Asset,
  AssetInput,
  AssetSource,
  BetaApplication,
  BetaApplicationStatus,
  CollectionCategory,
  CollectionEntry,
  CollectionStatus,
  Referral,
  ReferralStage,
  InviteCode,
  InviteCodeKind,
  InviteRedemption,
  LibraryCategory,
  BrandSystem,
  Comment,
  CommentTarget,
  Concept,
  CreativeTreatment,
  CredentialAuditEvent,
  CopyKit,
  GenerationCost,
  RateLimitRule,
  RateLimitVerdict,
  Invitation,
  LogLevel,
  LogQuery,
  OperationalEvent,
  OperationalEventInput,
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
  Variant, AudioEdition, BrandVoice, VoiceConsentRecord, VoiceSettings, JobEvent, ResearchSource,} from '@act-one/core';

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
  readonly invitations: InvitationRepo;
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
  readonly copy: CopyRepo;
  readonly costs: CostRepo;
  readonly log: OperationalLogRepo;
  readonly comments: CommentRepo;
  readonly approvals: ApprovalRepo;
  readonly revisions: RevisionRepo;
  readonly jobEvents: JobEventRepo;
  readonly researchSources: ResearchSourceRepo;
  readonly invites: InviteRepo;
  readonly applications: BetaApplicationRepo;
  readonly collections: CollectionRepo;
  readonly referrals: ReferralRepo;
  readonly brandVoices: BrandVoiceRepo;
  readonly voiceConsents: VoiceConsentRepo;
  readonly voiceSettings: VoiceSettingsRepo;
  readonly audioEditions: AudioEditionRepo;
  readonly credentials: CredentialRepo;
  readonly platform: PlatformRepo;
  readonly rateLimits: RateLimitRepo;
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
  /** Everyone, for the staff console. There is no tenant to scope this to. */
  list(limit?: number): Promise<User[]>;
  /**
   * How many people hold platform access.
   *
   * Used to refuse the revoke that would leave nobody able to reach the
   * console — which is not recoverable from inside the product.
   */
  countSuperAdmins(): Promise<number>;
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

/**
 * Pending invitations.
 *
 * Looked up by token hash, never by raw token, so the value in the link is
 * never compared against anything stored — the same reason sessions work this
 * way, with the difference that an invite is valid for days rather than the
 * length of a visit.
 */
export interface InvitationRepo {
  create(invitation: Invitation): Promise<Invitation>;
  listForOrganization(organizationId: string): Promise<Invitation[]>;
  /** Cross-tenant by nature: whoever holds the link has not joined anything yet. */
  findByTokenHash(tokenHash: string): Promise<Invitation | null>;
  markAccepted(id: string, at: string): Promise<Invitation>;
  revoke(organizationId: string, id: string): Promise<void>;
}

/**
 * Fixed-window attempt counters. One call counts one attempt and says whether
 * it was within the rule; there is no separate "check" because a check that
 * does not count is a race between two requests.
 */
export interface RateLimitRepo {
  hit(key: string, rule: RateLimitRule, nowMs?: number): Promise<RateLimitVerdict>;
  /** Drops windows that ended before the given moment. Returns rows removed. */
  prune(olderThanMs: number): Promise<number>;
}

export interface SessionRepo {
  create(session: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: string;
    organizationId?: string | null;
  }): Promise<void>;
  findByTokenHash(
    tokenHash: string,
  ): Promise<{ userId: string; expiresAt: string; organizationId: string | null } | null>;
  /** Moves this session into another workspace the user belongs to. */
  setOrganization(tokenHash: string, organizationId: string): Promise<void>;
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
  /** Newest first. */
  list(organizationId: string): Promise<BrandSystem[]>;
  /** The brand measured for one project, the newest if it has several. */
  getForProject(organizationId: string, projectId: string): Promise<BrandSystem | null>;
}

export interface ProjectRepo {
  create(project: Project): Promise<Project>;
  get(organizationId: string, id: string): Promise<Project | null>;
  update(organizationId: string, id: string, patch: Partial<Project>): Promise<Project>;
  list(organizationId: string, options?: { includeArchived?: boolean }): Promise<Project[]>;
  /**
   * Projects that count against the plan's monthly allowance.
   *
   * Not simply "projects created": a project that failed before research ever
   * produced an understanding cost the customer nothing and delivered nothing,
   * and charging it against their allowance means a founder whose first two
   * attempts broke on *our* side is told to upgrade. The moment an
   * understanding exists we have delivered something, and it counts — however
   * the project ends after that.
   */
  countTowardQuotaSince(organizationId: string, since: string): Promise<number>;
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

/**
 * How the library is asked for.
 *
 * `query` matches the name, the description the classifier wrote, the tags,
 * the category, the source and the page an asset was captured from — so
 * "founder", "pricing page" and "office" all find what a person means.
 * `projectId` narrows to what that project can use: assets attached to it,
 * and assets shared with every project.
 */
export type LibraryFilter = {
  query?: string;
  category?: LibraryCategory;
  source?: AssetSource;
  projectId?: string;
  favorite?: boolean;
  approved?: boolean;
  limit?: number;
};

/** One library asset attached to one project. No rows at all means "every project". */
export type AssetProjectLink = { assetId: string; projectId: string; attachedAt: string };

export interface AssetRepo {
  /** Defaults are filled in here: a caller names what it knows and the store parses the rest. */
  create(asset: AssetInput): Promise<Asset>;
  get(organizationId: string, id: string): Promise<Asset | null>;
  getMany(organizationId: string, ids: string[]): Promise<Asset[]>;
  listForProject(organizationId: string, projectId: string, kind?: Asset['kind']): Promise<Asset[]>;
  listForScene(organizationId: string, sceneId: string): Promise<Asset[]>;
  update(organizationId: string, id: string, patch: Partial<Asset>): Promise<Asset>;
  delete(organizationId: string, id: string): Promise<void>;

  // --- the library ------------------------------------------------------
  /** Library assets, newest first, narrowed by the filter. */
  listLibrary(organizationId: string, filter?: LibraryFilter): Promise<Asset[]>;
  /** What a project can use: attached to it, or shared with every project. Newest first. */
  listLibraryForProject(organizationId: string, projectId: string): Promise<Asset[]>;
  /** Replaces an asset's project list. An empty list shares it with every project. */
  setProjects(organizationId: string, assetId: string, projectIds: string[]): Promise<void>;
  /** Adds projects to an asset's list without touching the rest. */
  attachToProjects(organizationId: string, assetId: string, projectIds: string[]): Promise<void>;
  /** The project links for these assets. */
  listProjectLinks(organizationId: string, assetIds: string[]): Promise<AssetProjectLink[]>;
  /** Assets made from this one, newest first. */
  listVersions(organizationId: string, parentAssetId: string): Promise<Asset[]>;
}

export interface RenderRepo {
  create(render: Render): Promise<Render>;
  get(organizationId: string, id: string): Promise<Render | null>;
  listForProject(organizationId: string, projectId: string): Promise<Render[]>;
  update(organizationId: string, id: string, patch: Partial<Render>): Promise<Render>;
  /** Films only. Cuts and animatics are not what a plan's allowance counts. */
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

/** How the console asks for jobs. */
export type JobQuery = {
  state?: JobState;
  kind?: JobKind;
  organizationId?: string;
  projectId?: string;
  since?: string;
  limit?: number;
};

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
  /** The platform's recent jobs, newest first, for the console. */
  listRecent(query?: JobQuery): Promise<Job[]>;
  /** One job by id across the platform, for the console. */
  getAny(id: string): Promise<Job | null>;
  /**
   * What a job of this kind usually takes here: the median over recent
   * completed ones, across the platform. Null until there are at least two,
   * because one job is an anecdote and the page must not present it as a
   * forecast.
   */
  typicalDurationMs(kind: JobKind): Promise<number | null>;
}

export interface CostRepo {
  record(cost: GenerationCost): Promise<GenerationCost>;
  listForProject(organizationId: string, projectId: string): Promise<GenerationCost[]>;
  totalForProject(organizationId: string, projectId: string): Promise<number>;
  totalForOrganization(organizationId: string, since?: string): Promise<number>;
  /** Platform-wide rows since a moment, optionally only one family of operations ('speech.'). */
  listSince(since: string, operationPrefix?: string): Promise<GenerationCost[]>;
  /** Platform-wide rollup for the Super Admin dashboard. */
  platformSummary(since: string): Promise<{
    totalCostUsd: number;
    totalCreditsCharged: number;
    byProvider: { provider: string; costUsd: number; calls: number; failures: number }[];
    byOperation: { operation: string; costUsd: number; calls: number }[];
  }>;
  /**
   * Spend per day, for the dashboard.
   *
   * Only days with rows come back — a caller plotting this must fill the gaps,
   * or a straight line gets drawn across an outage.
   */
  dailySeries(since: string): Promise<
    { day: string; costUsd: number; creditsCharged: number; calls: number; failures: number }[]
  >;
}

/**
 * The operator's record of what the platform did.
 *
 * No organizationId parameter anywhere: these events span tenants by design and
 * are reachable only with platform access. A tenant-scoped caller has no
 * business here at all, so the contract does not offer them a way in.
 */
export interface OperationalLogRepo {
  record(event: OperationalEventInput): Promise<OperationalEvent>;
  /** Fire-and-forget: logging must never be the reason an operation fails. */
  recordSafely(event: OperationalEventInput): void;
  list(query?: LogQuery): Promise<OperationalEvent[]>;
  /** Counts per level over a window, for the dashboard's health strip. */
  levelCounts(since: string): Promise<Record<LogLevel, number>>;
  /** The events happening most often, so an operator sees the pattern first. */
  topEvents(since: string, limit?: number): Promise<{ event: string; level: LogLevel; count: number }[]>;
  /** Trims events older than the retention window. Returns rows removed. */
  prune(olderThan: string): Promise<number>;
}

export interface CopyRepo {
  create(kit: CopyKit): Promise<CopyKit>;
  getLatestForProject(organizationId: string, projectId: string): Promise<CopyKit | null>;
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

/** The curated activity a worker writes as it works, shown live and kept. */
export interface JobEventRepo {
  record(event: JobEvent): Promise<JobEvent>;
  listForJob(organizationId: string, jobId: string): Promise<JobEvent[]>;
  /** The project's events, oldest first, since a moment when given. */
  listForProject(organizationId: string, projectId: string, since?: string): Promise<JobEvent[]>;
}

/** The pages the research read, kept per project as the trail behind the brief. */
export interface ResearchSourceRepo {
  /** Replaces the trail of one research run: the pages of a rerun supersede the last. */
  replaceForProject(organizationId: string, projectId: string, sources: ResearchSource[]): Promise<ResearchSource[]>;
  listForProject(organizationId: string, projectId: string): Promise<ResearchSource[]>;
}

/** One narrator kept across everything an organisation makes. */
export interface BrandVoiceRepo {
  create(voice: BrandVoice): Promise<BrandVoice>;
  get(organizationId: string, id: string): Promise<BrandVoice | null>;
  list(organizationId: string): Promise<BrandVoice[]>;
  update(organizationId: string, id: string, patch: Partial<BrandVoice>): Promise<BrandVoice>;
  /** Makes this the voice that reads by default; every other loses the flag. */
  setDefault(organizationId: string, id: string): Promise<BrandVoice>;
  remove(organizationId: string, id: string): Promise<void>;
}

/** A person's recorded, revocable consent to be cloned. Never deleted: revoked. */
export interface VoiceConsentRepo {
  create(consent: VoiceConsentRecord): Promise<VoiceConsentRecord>;
  get(organizationId: string, id: string): Promise<VoiceConsentRecord | null>;
  list(organizationId: string): Promise<VoiceConsentRecord[]>;
  revoke(organizationId: string, id: string): Promise<VoiceConsentRecord>;
  setProviderVoice(organizationId: string, id: string, providerVoiceId: string | null): Promise<VoiceConsentRecord>;
}

export interface VoiceSettingsRepo {
  get(organizationId: string): Promise<VoiceSettings | null>;
  save(settings: VoiceSettings): Promise<VoiceSettings>;
}

export interface AudioEditionRepo {
  create(edition: AudioEdition): Promise<AudioEdition>;
  get(organizationId: string, id: string): Promise<AudioEdition | null>;
  listForProject(organizationId: string, projectId: string): Promise<AudioEdition[]>;
  update(organizationId: string, id: string, patch: Partial<AudioEdition>): Promise<AudioEdition>;
}

export interface RevisionRepo {
  create(revision: RevisionRequest, organizationId: string): Promise<RevisionRequest>;
  get(organizationId: string, id: string): Promise<RevisionRequest | null>;
  listForStoryboard(organizationId: string, storyboardId: string): Promise<RevisionRequest[]>;
  markApplied(organizationId: string, id: string, affectedSceneIds: string[]): Promise<RevisionRequest>;
  /** The conversation's state: proposed, confirmed, declined. */
  update(
    organizationId: string,
    id: string,
    patch: Partial<Pick<RevisionRequest, 'status' | 'proposal' | 'reply' | 'decidedAt' | 'intent' | 'affectedSceneIds'>>,
  ): Promise<RevisionRequest>;
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
  /** The product's phase, landing copy and mark: see ProductConfig. */
  product: Record<string, unknown>;
  updatedAt: string;
};

/** Invitation codes: the door in a private beta, and the referral programme's currency. */
export interface InviteRepo {
  create(code: InviteCode): Promise<InviteCode>;
  get(id: string): Promise<InviteCode | null>;
  getByCode(code: string): Promise<InviteCode | null>;
  list(query?: { kind?: InviteCodeKind; ownerUserId?: string; limit?: number }): Promise<InviteCode[]>;
  /**
   * Consumes one use for this person, atomically. False when the code
   * cannot be used: unknown, withdrawn, expired, exhausted, or already
   * redeemed by the same person. Two people racing for the last use get
   * one true and one false, never two trues.
   */
  redeem(codeId: string, userId: string, now?: string): Promise<boolean>;
  revoke(id: string): Promise<void>;
  listRedemptions(codeId: string): Promise<InviteRedemption[]>;
  /** The code a person came in on, if any. */
  redemptionFor(userId: string): Promise<InviteRedemption | null>;
}

/** The curated public gallery, and every film offered for it. */
export type CollectionQuery = { status?: CollectionStatus; category?: CollectionCategory; featured?: boolean; limit?: number };

export interface CollectionRepo {
  create(entry: CollectionEntry): Promise<CollectionEntry>;
  get(id: string): Promise<CollectionEntry | null>;
  getBySlug(slug: string): Promise<CollectionEntry | null>;
  /** The latest entry for a project, whatever its state. */
  getForProject(organizationId: string, projectId: string): Promise<CollectionEntry | null>;
  /** Editorial order first, then newest published. */
  list(query?: CollectionQuery): Promise<CollectionEntry[]>;
  update(id: string, patch: Partial<CollectionEntry>): Promise<CollectionEntry>;
  countByStatus(): Promise<Record<string, number>>;
}

/** Who brought whom, and what it paid. */
export type ReferralQuery = { inviterUserId?: string; stage?: ReferralStage; limit?: number };

export interface ReferralRepo {
  /** One referral per invited person, ever: a second attempt is a conflict. */
  create(referral: Referral): Promise<Referral>;
  get(id: string): Promise<Referral | null>;
  /** The referral that brought this person, if any. */
  getForInvitedUser(invitedUserId: string): Promise<Referral | null>;
  /** The referral whose invited workspace this is, so a payment can find it. */
  getForInvitedOrganization(organizationId: string): Promise<Referral | null>;
  list(query?: ReferralQuery): Promise<Referral[]>;
  update(id: string, patch: Partial<Referral>): Promise<Referral>;
  /** How many of this person's referrals have ever been rewarded. */
  countRewardedFor(inviterUserId: string): Promise<number>;
  countByStage(): Promise<Record<string, number>>;
}

/** Requests for access while the product is by invitation. */
export interface BetaApplicationRepo {
  create(application: BetaApplication): Promise<BetaApplication>;
  get(id: string): Promise<BetaApplication | null>;
  /** The latest request from this address. */
  getByEmail(email: string): Promise<BetaApplication | null>;
  list(query?: { status?: BetaApplicationStatus; limit?: number }): Promise<BetaApplication[]>;
  update(id: string, patch: Partial<BetaApplication>): Promise<BetaApplication>;
  countByStatus(): Promise<Record<string, number>>;
}

export interface PlatformRepo {
  getSettings(): Promise<PlatformSettings>;
  updateSettings(patch: Partial<PlatformSettings>, updatedBy: string): Promise<PlatformSettings>;
  setProviderSecret(provider: string, ciphertext: unknown, fingerprint: string, updatedBy: string): Promise<void>;
  getProviderSecret(provider: string): Promise<{ ciphertext: unknown; fingerprint: string; enabled: boolean } | null>;
  listProviderSecrets(): Promise<{ provider: string; fingerprint: string; enabled: boolean; updatedAt: string }[]>;
  /** Stripe webhook idempotency. Returns false when the event was already seen. */
  recordStripeEvent(id: string, type: string): Promise<boolean>;
}
