import { Asset as AssetSchema, Render as RenderSchema } from '@act-one/core';
import {
  AppError,
  levelSeverity,
  matchesLogQuery,
  newId,
  notFound,
  plainText,
  redactDetail,
  redactMessage,
  resequence,
  retryDelayMs,
  verdictFor,
  windowStartMs,
  type RateLimitRule,
} from '@act-one/core';
import type {
  CreativePreference,
  CreativeReplan,
  CreativeSignature,
  CreativeTerritory,
  CriticReview,
  DirectorDecision,
  CopyKit,
  Invitation,
  LogLevel,
  LogQuery,
  OperationalEvent,
  OperationalEventInput,
  Approval,
  ApprovalGate,
  Asset,
  AssetInput,
  BetaApplication,
  BetaApplicationStatus,
  CollectionEntry,
  Referral,
  Article,
  ArticleTopic,
  Benchmark,
  InviteCode,
  InviteCodeKind,
  InviteRedemption,
  AudioEdition,
  BrandSystem,
  BrandVoice,
  Comment,
  CommentTarget,
  Concept,
  CreativeTreatment,
  CredentialAuditEvent,
  GenerationCost,
  Job,
  JobEvent,
  JobKind,
  JobState,
  Membership,
  MemberRole,
  Organization,
  NewOrganization,
  ProductCredential,
  ProductUnderstanding,
  Project,
  ProjectStage,
  QaReport,
  Render,
  RenderInput,
  ResearchSource,
  RevisionRequest,
  VoiceConsentRecord,
  VoiceSettings,
  Scene,
  Storyboard,
  CreditLedgerEntry,
  CreditMovement,
  CreditPosting,
  Payment,
  Subscription,
  User,
  Variant,
} from '@act-one/core';
import type { ArticleQuery, AssetProjectLink, BenchmarkQuery, CollectionQuery, JobQuery, LibraryFilter, PlatformSettings, ReferralQuery, Store } from './store.ts';

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
    sessions: new Map<
      string,
      { id: string; userId: string; tokenHash: string; expiresAt: string; organizationId?: string | null }
    >(),
    subscriptions: new Map<string, Subscription>(),
    payments: new Map<string, Payment>(),
    creditLedger: new Map<string, CreditLedgerEntry>(),
    brands: new Map<string, BrandSystem>(),
    projects: new Map<string, Project>(),
    understandings: new Map<string, ProductUnderstanding & { organizationId: string }>(),
    concepts: new Map<string, Concept & { organizationId: string }>(),
    treatments: new Map<string, CreativeTreatment & { organizationId: string }>(),
    storyboards: new Map<string, Storyboard & { organizationId: string }>(),
    scenes: new Map<string, Scene & { organizationId: string }>(),
    assets: new Map<string, Asset>(),
    assetProjects: new Map<string, AssetProjectLink & { organizationId: string }>(),
    invites: new Map<string, InviteCode>(),
    redemptions: new Map<string, InviteRedemption>(),
    applications: new Map<string, BetaApplication>(),
    collections: new Map<string, CollectionEntry>(),
    referrals: new Map<string, Referral>(),
    articles: new Map<string, Article>(),
    topics: new Map<string, ArticleTopic>(),
    benchmarks: new Map<string, Benchmark>(),
    renders: new Map<string, Render>(),
    variants: new Map<string, Variant & { organizationId: string }>(),
    qaReports: new Map<string, QaReport & { organizationId: string }>(),
    replans: new Map<string, CreativeReplan & { organizationId: string }>(),
    creativeModels: new Map<
      string,
      { id: string; organizationId: string; projectId: string; kind: string; version: number; data: unknown; createdAt: string }
    >(),
    creativeTerritories: new Map<
      string,
      {
        organizationId: string;
        projectId: string;
        territory: CreativeTerritory;
        kept: boolean;
        selected: boolean;
        rejectionReason: string | null;
      }
    >(),
    criticReviews: new Map<string, CriticReview & { organizationId: string }>(),
    directorDecisions: new Map<string, DirectorDecision & { organizationId: string }>(),
    creativeSignatures: new Map<string, CreativeSignature>(),
    creativePreferences: new Map<string, CreativePreference>(),
    jobs: new Map<string, Job>(),
    costs: new Map<string, GenerationCost>(),
    copy: new Map<string, CopyKit>(),
    log: new Map<string, OperationalEvent>(),
    invitations: new Map<string, Invitation>(),
    comments: new Map<string, Comment>(),
    approvals: new Map<string, Approval>(),
    revisions: new Map<string, RevisionRequest & { organizationId: string }>(),
    jobEvents: new Map<string, JobEvent>(),
    researchSources: new Map<string, ResearchSource>(),
    brandVoices: new Map<string, BrandVoice>(),
    voiceConsents: new Map<string, VoiceConsentRecord>(),
    voiceSettings: new Map<string, VoiceSettings>(),
    audioEditions: new Map<string, AudioEdition>(),
    credentials: new Map<string, ProductCredential & { ciphertext: unknown }>(),
    credentialAudit: new Map<string, CredentialAuditEvent>(),
    stripeEvents: new Map<string, string>(),
  };

  private settings: PlatformSettings = {
    providerConfig: {},
    plans: [],
    featureFlags: {},
    creativeBudget: {},
    product: {},
    updatedAt: new Date().toISOString(),
  };

  readonly invites = {
    create: async (code: InviteCode) => {
      for (const existing of this.tables.invites.values()) {
        if (existing.code === code.code) throw new AppError('conflict', 'That code already exists.');
      }
      this.tables.invites.set(code.id, code);
      return code;
    },
    get: async (id: string) => this.tables.invites.get(id) ?? null,
    getByCode: async (code: string) => [...this.tables.invites.values()].find((candidate) => candidate.code === code) ?? null,
    list: async (query: { kind?: InviteCodeKind; ownerUserId?: string; limit?: number } = {}) =>
      [...this.tables.invites.values()]
        .filter((code) => !query.kind || code.kind === query.kind)
        .filter((code) => !query.ownerUserId || code.ownerUserId === query.ownerUserId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, query.limit ?? 200),
    redeem: async (codeId: string, userId: string, now = new Date().toISOString()) => {
      const code = this.tables.invites.get(codeId);
      if (!code || code.revokedAt) return false;
      if (code.expiresAt && code.expiresAt <= now) return false;
      if (code.maxUses !== null && code.uses >= code.maxUses) return false;
      if (this.tables.redemptions.has(`${codeId}:${userId}`)) return false;
      this.tables.invites.set(codeId, { ...code, uses: code.uses + 1 });
      this.tables.redemptions.set(`${codeId}:${userId}`, { codeId, userId, at: now });
      return true;
    },
    revoke: async (id: string) => {
      const code = this.tables.invites.get(id);
      if (code && !code.revokedAt) this.tables.invites.set(id, { ...code, revokedAt: new Date().toISOString() });
    },
    listRedemptions: async (codeId: string) =>
      [...this.tables.redemptions.values()].filter((entry) => entry.codeId === codeId).sort((a, b) => a.at.localeCompare(b.at)),
    redemptionFor: async (userId: string) => [...this.tables.redemptions.values()].find((entry) => entry.userId === userId) ?? null,
  };

  readonly collections = {
    create: async (entry: CollectionEntry) => {
      for (const existing of this.tables.collections.values()) {
        if (existing.slug === entry.slug) throw new AppError('conflict', 'That address is taken.');
      }
      this.tables.collections.set(entry.id, entry);
      return entry;
    },
    get: async (id: string) => this.tables.collections.get(id) ?? null,
    getBySlug: async (slug: string) => [...this.tables.collections.values()].find((entry) => entry.slug === slug) ?? null,
    getByFormerSlug: async (slug: string) =>
      [...this.tables.collections.values()].find((entry) => entry.previousSlugs.includes(slug)) ?? null,
    getForProject: async (organizationId: string, projectId: string) =>
      [...this.tables.collections.values()]
        .filter((entry) => entry.organizationId === organizationId && entry.projectId === projectId)
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0] ?? null,
    list: async (query: CollectionQuery = {}) =>
      [...this.tables.collections.values()]
        .filter((entry) => !query.status || entry.status === query.status)
        .filter((entry) => !query.category || entry.category === query.category)
        .filter((entry) => query.featured === undefined || entry.featured === query.featured)
        .sort((a, b) => a.position - b.position || (b.publishedAt ?? b.submittedAt).localeCompare(a.publishedAt ?? a.submittedAt))
        .slice(0, query.limit ?? 200),
    update: async (id: string, patch: Partial<CollectionEntry>) => {
      const existing = this.require(this.tables.collections.get(id), 'Collection entry');
      if (patch.slug && patch.slug !== existing.slug) {
        for (const other of this.tables.collections.values()) {
          if (other.id !== id && other.slug === patch.slug) throw new AppError('conflict', 'That address is taken.');
        }
      }
      const next = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
      this.tables.collections.set(id, next);
      return next;
    },
    countByStatus: async () => {
      const counts: Record<string, number> = {};
      for (const entry of this.tables.collections.values()) counts[entry.status] = (counts[entry.status] ?? 0) + 1;
      return counts;
    },
  };

  readonly referrals = {
    create: async (referral: Referral) => {
      // One referral per invited person, ever.
      for (const existing of this.tables.referrals.values()) {
        if (existing.invitedUserId === referral.invitedUserId) throw new AppError('conflict', 'This person was already referred.');
      }
      this.tables.referrals.set(referral.id, referral);
      return referral;
    },
    get: async (id: string) => this.tables.referrals.get(id) ?? null,
    getForInvitedUser: async (invitedUserId: string) =>
      [...this.tables.referrals.values()].find((referral) => referral.invitedUserId === invitedUserId) ?? null,
    getForInvitedOrganization: async (organizationId: string) =>
      [...this.tables.referrals.values()]
        .filter((referral) => referral.invitedOrganizationId === organizationId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null,
    list: async (query: ReferralQuery = {}) =>
      [...this.tables.referrals.values()]
        .filter((referral) => !query.inviterUserId || referral.inviterUserId === query.inviterUserId)
        .filter((referral) => !query.stage || referral.stage === query.stage)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, query.limit ?? 200),
    update: async (id: string, patch: Partial<Referral>) => {
      const existing = this.require(this.tables.referrals.get(id), 'Referral');
      const next = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
      this.tables.referrals.set(id, next);
      return next;
    },
    countRewardedFor: async (inviterUserId: string) =>
      [...this.tables.referrals.values()].filter((referral) => referral.inviterUserId === inviterUserId && referral.rewardedAt !== null).length,
    countByStage: async () => {
      const counts: Record<string, number> = {};
      for (const referral of this.tables.referrals.values()) counts[referral.stage] = (counts[referral.stage] ?? 0) + 1;
      return counts;
    },
  };

  readonly articles = {
    create: async (article: Article) => {
      for (const existing of this.tables.articles.values()) {
        if (existing.slug === article.slug) throw new AppError('conflict', 'That address is taken.');
      }
      this.tables.articles.set(article.id, article);
      return article;
    },
    get: async (id: string) => this.tables.articles.get(id) ?? null,
    getBySlug: async (slug: string) => [...this.tables.articles.values()].find((article) => article.slug === slug) ?? null,
    getByFormerSlug: async (slug: string) =>
      [...this.tables.articles.values()].find((article) => article.previousSlugs.includes(slug)) ?? null,
    list: async (query: ArticleQuery = {}) =>
      [...this.tables.articles.values()]
        .filter((article) => !query.status || article.status === query.status)
        .sort((a, b) => (b.publishedAt ?? b.updatedAt).localeCompare(a.publishedAt ?? a.updatedAt))
        .slice(0, query.limit ?? 100),
    update: async (id: string, patch: Partial<Article>) => {
      const existing = this.require(this.tables.articles.get(id), 'Article');
      if (patch.slug && patch.slug !== existing.slug) {
        for (const other of this.tables.articles.values()) {
          if (other.id !== id && other.slug === patch.slug) throw new AppError('conflict', 'That address is taken.');
        }
      }
      const next = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
      this.tables.articles.set(id, next);
      return next;
    },
    delete: async (id: string) => {
      this.tables.articles.delete(id);
    },
    listDue: async (now: string, limit = 20) =>
      [...this.tables.articles.values()]
        .filter((article) => article.status === 'scheduled' && article.scheduledFor !== null && article.scheduledFor <= now)
        .sort((a, b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? ''))
        .slice(0, limit),
    countByStatus: async () => {
      const counts: Record<string, number> = {};
      for (const article of this.tables.articles.values()) counts[article.status] = (counts[article.status] ?? 0) + 1;
      return counts;
    },
  };

  readonly benchmarks = {
    create: async (benchmark: Benchmark) => {
      for (const existing of this.tables.benchmarks.values()) {
        if (existing.source.sha256 === benchmark.source.sha256) throw new AppError('conflict', 'That film is already in the library.');
      }
      this.tables.benchmarks.set(benchmark.id, structuredClone(benchmark));
      return benchmark;
    },
    get: async (id: string) => {
      const found = this.tables.benchmarks.get(id);
      return found ? structuredClone(found) : null;
    },
    getBySha256: async (sha256: string) => {
      const found = [...this.tables.benchmarks.values()].find((benchmark) => benchmark.source.sha256 === sha256);
      return found ? structuredClone(found) : null;
    },
    list: async (query: BenchmarkQuery = {}) =>
      matchingBenchmarks([...this.tables.benchmarks.values()], query)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .slice(query.offset ?? 0, (query.offset ?? 0) + Math.min(Math.max(query.limit ?? 100, 1), 500))
        .map((benchmark) => structuredClone(benchmark)),
    count: async (query: Omit<BenchmarkQuery, 'limit' | 'offset'> = {}) => matchingBenchmarks([...this.tables.benchmarks.values()], query).length,
    update: async (id: string, patch: Partial<Benchmark>) => {
      const existing = this.require(this.tables.benchmarks.get(id), 'Benchmark');
      const next: Benchmark = { ...structuredClone(existing), ...structuredClone(patch), id, updatedAt: new Date().toISOString() };
      this.tables.benchmarks.set(id, next);
      return structuredClone(next);
    },
    mutate: async (id: string, change: (current: Benchmark) => Benchmark) => {
      const existing = this.require(this.tables.benchmarks.get(id), 'Benchmark');
      const next: Benchmark = { ...change(structuredClone(existing)), id, updatedAt: new Date().toISOString() };
      this.tables.benchmarks.set(id, next);
      return structuredClone(next);
    },
    delete: async (id: string) => {
      this.tables.benchmarks.delete(id);
    },
    countByStatus: async () => {
      const counts: Record<string, number> = {};
      for (const benchmark of this.tables.benchmarks.values()) counts[benchmark.status] = (counts[benchmark.status] ?? 0) + 1;
      return counts;
    },
  };

  readonly topics = {
    create: async (topic: ArticleTopic) => {
      this.tables.topics.set(topic.id, topic);
      return topic;
    },
    get: async (id: string) => this.tables.topics.get(id) ?? null,
    list: async (query: { status?: ArticleTopic['status']; limit?: number } = {}) =>
      [...this.tables.topics.values()]
        .filter((topic) => !query.status || topic.status === query.status)
        .sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt))
        .slice(0, query.limit ?? 100),
    update: async (id: string, patch: Partial<ArticleTopic>) => {
      const existing = this.require(this.tables.topics.get(id), 'Topic');
      const next = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
      this.tables.topics.set(id, next);
      return next;
    },
    delete: async (id: string) => {
      this.tables.topics.delete(id);
    },
  };

  readonly applications = {
    create: async (application: BetaApplication) => {
      this.tables.applications.set(application.id, application);
      return application;
    },
    get: async (id: string) => this.tables.applications.get(id) ?? null,
    getByEmail: async (email: string) =>
      [...this.tables.applications.values()]
        .filter((candidate) => candidate.email.toLowerCase() === email.trim().toLowerCase())
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null,
    list: async (query: { status?: BetaApplicationStatus; limit?: number } = {}) =>
      [...this.tables.applications.values()]
        .filter((candidate) => !query.status || candidate.status === query.status)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, query.limit ?? 200),
    update: async (id: string, patch: Partial<BetaApplication>) => {
      const existing = this.require(this.tables.applications.get(id), 'Application');
      const next = { ...existing, ...patch, id };
      this.tables.applications.set(id, next);
      return next;
    },
    countByStatus: async () => {
      const counts: Record<string, number> = {};
      for (const application of this.tables.applications.values()) counts[application.status] = (counts[application.status] ?? 0) + 1;
      return counts;
    },
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

  /**
   * The whole store as JSON, and back from it.
   *
   * For proof runs and local work only \u2014 production state lives in Postgres,
   * and nothing in the product calls these. They exist because a pipeline that
   * costs ten minutes of real crawling and real model calls should not have to
   * buy the first eight minutes again to debug the ninth, and because a run
   * killed by a gateway on its last stage is a run whose work is still good.
   *
   * Deliberately dumb: every table, every row, as it is. No migration, no
   * versioning, no compatibility promise across a schema change. A snapshot
   * taken before a field existed and restored after it does is a snapshot that
   * fails validation the first time something reads it, which is the correct
   * outcome and a cheap one to recover from.
   */
  snapshot(): string {
    const out: Record<string, [string, unknown][]> = {};
    for (const [name, table] of Object.entries(this.tables)) {
      out[name] = [...(table as Map<string, unknown>).entries()];
    }
    return JSON.stringify(out);
  }

  restore(json: string): void {
    const data = JSON.parse(json) as Record<string, [string, unknown][]>;
    for (const [name, entries] of Object.entries(data)) {
      const table = (this.tables as unknown as Record<string, Map<string, unknown>>)[name];
      if (!table) continue;
      table.clear();
      for (const [key, value] of entries) table.set(key, value);
    }
  }

  readonly organizations = {
    create: async (org: NewOrganization) => {
      if ([...this.tables.organizations.values()].some((o) => o.slug === org.slug)) {
        throw new AppError('conflict', `Organization slug "${org.slug}" is taken.`);
      }
      const opened: Organization = { limitOverrides: {}, extraEntitlements: [], isInternal: false, ...org };
      this.tables.organizations.set(opened.id, opened);
      return opened;
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
    list: async (limit = 200) =>
      [...this.tables.users.values()]
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, limit)
        .map(stripPassword),
    countSuperAdmins: async () =>
      [...this.tables.users.values()].filter((u) => u.isSuperAdmin).length,
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

  readonly invitations = {
    create: async (invitation: Invitation) => {
      this.tables.invitations.set(invitation.id, invitation);
      return invitation;
    },
    listForOrganization: async (organizationId: string) =>
      [...this.tables.invitations.values()]
        .filter((row) => row.organizationId === organizationId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    findByTokenHash: async (tokenHash: string) =>
      [...this.tables.invitations.values()].find((row) => row.tokenHash === tokenHash) ?? null,
    markAccepted: async (id: string, at: string) => {
      const existing = this.require(this.tables.invitations.get(id), 'Invitation');
      const next = { ...existing, acceptedAt: at };
      this.tables.invitations.set(id, next);
      return next;
    },
    revoke: async (organizationId: string, id: string) => {
      const existing = this.tables.invitations.get(id);
      if (existing?.organizationId === organizationId) this.tables.invitations.delete(id);
    },
  };

  private readonly rateWindows = new Map<string, { windowStart: number; count: number }>();

  readonly rateLimits = {
    hit: async (key: string, rule: RateLimitRule, nowMs = Date.now()) => {
      const windowStart = windowStartMs(nowMs, rule);
      const current = this.rateWindows.get(key);
      const count = current && current.windowStart === windowStart ? current.count + 1 : 1;
      this.rateWindows.set(key, { windowStart, count });
      return verdictFor(count, nowMs, rule);
    },
    prune: async (olderThanMs: number) => {
      let removed = 0;
      for (const [key, entry] of this.rateWindows) {
        if (entry.windowStart < olderThanMs) {
          this.rateWindows.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
  };

  readonly sessions = {
    create: async (session: {
      id: string;
      userId: string;
      tokenHash: string;
      expiresAt: string;
      organizationId?: string | null;
    }) => {
      this.tables.sessions.set(session.tokenHash, {
        ...session,
        organizationId: session.organizationId ?? null,
      });
    },
    findByTokenHash: async (tokenHash: string) => {
      const found = this.tables.sessions.get(tokenHash);
      if (!found) return null;
      return {
        userId: found.userId,
        expiresAt: found.expiresAt,
        organizationId: found.organizationId ?? null,
      };
    },
    setOrganization: async (tokenHash: string, organizationId: string) => {
      const found = this.tables.sessions.get(tokenHash);
      if (found) this.tables.sessions.set(tokenHash, { ...found, organizationId });
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
    list: async (limit = 200) =>
      [...this.tables.subscriptions.values()]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit),
  };

  readonly payments = {
    record: async (payment: Payment) => {
      // Keyed by the Stripe event, so a retry writes nothing twice.
      if (
        payment.stripeEventId &&
        [...this.tables.payments.values()].some((p) => p.stripeEventId === payment.stripeEventId)
      ) {
        return null;
      }
      this.tables.payments.set(payment.id, payment);
      return payment;
    },
    listForOrganization: async (organizationId: string, limit = 50) =>
      this.scoped(this.tables.payments, organizationId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit),
    list: async (limit = 200) =>
      [...this.tables.payments.values()]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit),
  };

  readonly creditLedger = {
    post: async (movement: CreditMovement): Promise<CreditPosting> => {
      const organization = this.require(this.tables.organizations.get(movement.organizationId), 'Organization');

      // The key decides before anything moves: a retry must read as "already
      // done", not as a second grant and not as an error.
      if (movement.sourceKey) {
        const seen = [...this.tables.creditLedger.values()].some(
          (entry) => entry.sourceKey === movement.sourceKey,
        );
        if (seen) return { applied: false, reason: 'duplicate', balance: organization.creditBalance, entry: null };
      }

      const balance = organization.creditBalance + movement.delta;
      if (balance < 0) {
        return { applied: false, reason: 'insufficient', balance: organization.creditBalance, entry: null };
      }

      const entry: CreditLedgerEntry = {
        planId: null, subscriptionId: null, periodKey: null, paymentId: null,
        projectId: null, renderId: null, actorUserId: null, description: '', sourceKey: null,
        ...movement,
        id: movement.id ?? newId('cle'),
        balanceAfter: balance,
        createdAt: movement.createdAt ?? new Date().toISOString(),
      };
      this.tables.creditLedger.set(entry.id, entry);
      this.tables.organizations.set(organization.id, { ...organization, creditBalance: balance });
      return { applied: true, reason: 'applied', balance, entry };
    },
    listForOrganization: async (organizationId: string, limit = 100) =>
      this.scoped(this.tables.creditLedger, organizationId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit),
    list: async (limit = 200) =>
      [...this.tables.creditLedger.values()]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit),
    has: async (sourceKey: string) =>
      [...this.tables.creditLedger.values()].some((entry) => entry.sourceKey === sourceKey),
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
    getForProject: async (organizationId: string, projectId: string) =>
      this.scoped(this.tables.brands, organizationId)
        .filter((brand) => brand.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null,
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
    /*
     * Read back on the film's own clock.
     *
     * `resequence`, here and in the Postgres store both, because a storyboard
     * is stored as a bag of scenes and a timeline is a property of the order
     * they are in — not of whatever `startTime` each row happened to be
     * written with. Only one of the two stores did this, and the difference
     * was invisible until temporal QA started reading `startTime`: on
     * Postgres a finding at 00:02 named the shot that plays at two seconds,
     * and on the memory store it named whichever shot was written with a
     * matching number, so a repair trimmed the wrong shot.
     */
    get: async (organizationId: string, id: string) => {
      const found = this.tables.storyboards.get(id);
      if (!found || found.organizationId !== organizationId) return null;
      return resequence({ ...found, scenes: this.scenesFor(organizationId, id) });
    },
    listForProject: async (organizationId: string, projectId: string) =>
      this.scoped(this.tables.storyboards, organizationId)
        .filter((s) => s.projectId === projectId)
        .sort((a, b) => b.version - a.version)
        .map((s) => resequence({ ...s, scenes: this.scenesFor(organizationId, s.id) })),
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
      return resequence({ ...next, scenes });
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
    create: async (input: AssetInput) => {
      const asset = AssetSchema.parse(input);
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
      if (!found || found.organizationId !== organizationId) return;
      this.tables.assets.delete(id);
      for (const [key, link] of this.tables.assetProjects) {
        if (link.assetId === id) this.tables.assetProjects.delete(key);
      }
      // A deleted original leaves its versions standing on their own.
      for (const child of this.tables.assets.values()) {
        if (child.parentAssetId === id) this.tables.assets.set(child.id, { ...child, parentAssetId: null });
      }
    },

    listLibrary: async (organizationId: string, filter: LibraryFilter = {}) => {
      const needle = filter.query?.trim().toLowerCase() ?? '';
      const linked = filter.projectId ? await this.assets.listProjectLinks(organizationId, []) : [];
      const attachedTo = new Set(linked.filter((link) => link.projectId === filter.projectId).map((link) => link.assetId));
      const withLinks = new Set(linked.map((link) => link.assetId));
      return this.scoped(this.tables.assets, organizationId)
        .filter((a) => a.library)
        .filter((a) => !filter.category || a.category === filter.category)
        .filter((a) => !filter.source || a.source === filter.source)
        .filter((a) => filter.favorite === undefined || a.favorite === filter.favorite)
        .filter((a) => filter.approved === undefined || a.approved === filter.approved)
        .filter((a) => !filter.projectId || attachedTo.has(a.id) || !withLinks.has(a.id))
        .filter((a) => !needle || haystack(a).includes(needle))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
        .slice(0, filter.limit ?? 500);
    },
    listLibraryForProject: async (organizationId: string, projectId: string) =>
      this.assets.listLibrary(organizationId, { projectId }),
    setProjects: async (organizationId: string, assetId: string, projectIds: string[]) => {
      const asset = this.tables.assets.get(assetId);
      if (!asset || asset.organizationId !== organizationId) throw notFound('Asset');
      // Every project checked before anything is removed: a list with a
      // foreign id in it changes nothing, rather than leaving the asset
      // attached to nobody.
      for (const projectId of new Set(projectIds)) {
        const project = this.tables.projects.get(projectId);
        if (!project || project.organizationId !== organizationId) throw notFound('Project');
      }
      for (const [key, link] of this.tables.assetProjects) {
        if (link.assetId === assetId) this.tables.assetProjects.delete(key);
      }
      await this.assets.attachToProjects(organizationId, assetId, projectIds);
    },
    attachToProjects: async (organizationId: string, assetId: string, projectIds: string[]) => {
      const asset = this.tables.assets.get(assetId);
      if (!asset || asset.organizationId !== organizationId) throw notFound('Asset');
      for (const projectId of new Set(projectIds)) {
        const project = this.tables.projects.get(projectId);
        if (!project || project.organizationId !== organizationId) throw notFound('Project');
        const key = `${assetId}:${projectId}`;
        if (!this.tables.assetProjects.has(key)) {
          this.tables.assetProjects.set(key, { assetId, projectId, organizationId, attachedAt: new Date().toISOString() });
        }
      }
    },
    listProjectLinks: async (organizationId: string, assetIds: string[]) => {
      const wanted = assetIds.length > 0 ? new Set(assetIds) : null;
      return this.scoped(this.tables.assetProjects, organizationId)
        .filter((link) => !wanted || wanted.has(link.assetId))
        .map(({ assetId, projectId, attachedAt }) => ({ assetId, projectId, attachedAt }));
    },
    listVersions: async (organizationId: string, parentAssetId: string) =>
      this.scoped(this.tables.assets, organizationId)
        .filter((a) => a.parentAssetId === parentAssetId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };

  readonly renders = {
    create: async (input: RenderInput) => {
      const render = RenderSchema.parse(input);
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
    /** Films only — cuts and animatics do not spend the plan's allowance. */
    countForProject: async (organizationId: string, projectId: string) =>
      this.scoped(this.tables.renders, organizationId).filter(
        (r) => r.projectId === projectId && r.kind === 'film',
      ).length,
    listActive: async (limit = 50) =>
      [...this.tables.renders.values()]
        .filter((r) => !['completed', 'failed', 'canceled'].includes(r.status))
        .slice(0, limit),

    listRecent: async (limit = 200) =>
      [...this.tables.renders.values()]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
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
    update: async (organizationId: string, id: string, patch: Partial<QaReport>) =>
      this.patch(this.tables.qaReports, organizationId, id, patch, 'QA report'),
    getForRender: async (organizationId: string, renderId: string) =>
      this.scoped(this.tables.qaReports, organizationId)
        .filter((r) => r.renderId === renderId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null,
    list: async (limit = 200) =>
      [...this.tables.qaReports.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit),
  };

  readonly replans = {
    create: async (replan: CreativeReplan, organizationId: string) => {
      this.tables.replans.set(replan.id, { ...replan, organizationId });
      return replan;
    },
    listForProject: async (organizationId: string, projectId: string) =>
      this.scoped(this.tables.replans, organizationId)
        .filter((entry) => entry.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    listForRender: async (organizationId: string, renderId: string) =>
      this.scoped(this.tables.replans, organizationId)
        .filter((entry) => entry.renderId === renderId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    list: async (limit = 200) =>
      [...this.tables.replans.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit),
  };

  /**
   * The creative intelligence layer.
   *
   * A second real implementation of the same contract, not a mock — which is
   * what makes the conformance suite meaningful and what caught the storyboard
   * resequencing that Postgres did on read and this did not.
   */
  readonly creative = {
    putModel: async (
      organizationId: string,
      model: { id: string; projectId: string; kind: 'brief' | 'audience' | 'genome'; version: number; data: unknown; createdAt: string },
    ) => {
      this.tables.creativeModels.set(`${model.projectId}:${model.kind}:${model.version}`, {
        ...model,
        organizationId,
      });
    },

    latestModel: async (organizationId: string, projectId: string, kind: 'brief' | 'audience' | 'genome') => {
      const rows = [...this.tables.creativeModels.values()]
        .filter((row) => row.organizationId === organizationId && row.projectId === projectId && row.kind === kind)
        .sort((a, b) => b.version - a.version);
      return rows[0]?.data ?? null;
    },

    putTerritories: async (
      organizationId: string,
      projectId: string,
      rows: readonly { territory: CreativeTerritory; kept: boolean; selected: boolean; rejectionReason: string | null }[],
    ) => {
      for (const row of rows) {
        this.tables.creativeTerritories.set(row.territory.id, { ...row, organizationId, projectId });
      }
    },

    listTerritories: async (organizationId: string, projectId: string) =>
      [...this.tables.creativeTerritories.values()]
        .filter((row) => row.organizationId === organizationId && row.projectId === projectId)
        .sort((a, b) => a.territory.createdAt.localeCompare(b.territory.createdAt))
        .map(({ territory, kept, selected, rejectionReason }) => ({ territory, kept, selected, rejectionReason })),

    putReviews: async (organizationId: string, reviews: readonly CriticReview[]) => {
      for (const review of reviews) this.tables.criticReviews.set(review.id, { ...review, organizationId });
    },

    listReviews: async (organizationId: string, projectId: string) =>
      [...this.tables.criticReviews.values()]
        .filter((row) => row.organizationId === organizationId && row.projectId === projectId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(({ organizationId: _org, ...review }) => review),

    putDecision: async (organizationId: string, decision: DirectorDecision) => {
      this.tables.directorDecisions.set(decision.id, { ...decision, organizationId });
    },

    listDecisions: async (organizationId: string, projectId: string) =>
      [...this.tables.directorDecisions.values()]
        .filter((row) => row.organizationId === organizationId && row.projectId === projectId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(({ organizationId: _org, ...decision }) => decision),

    putSignatures: async (organizationId: string, signatures: readonly CreativeSignature[]) => {
      for (const signature of signatures) {
        this.tables.creativeSignatures.set(signature.id, { ...signature, organizationId });
      }
    },

    recentSignatures: async (organizationId: string, limit = 60) =>
      [...this.tables.creativeSignatures.values()]
        .filter((row) => row.organizationId === organizationId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit),

    putPreference: async (organizationId: string, preference: CreativePreference) => {
      this.tables.creativePreferences.set(preference.id, { ...preference, organizationId });
    },

    listPreferences: async (organizationId: string, limit = 200) =>
      [...this.tables.creativePreferences.values()]
        .filter((row) => row.organizationId === organizationId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit),
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
        startedAt: now,
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
    fail: async (id: string, error: string, retryAt: string | null, code: string | null = null) => {
      const existing = this.require(this.tables.jobs.get(id), 'Job');
      const exhausted = retryAt === null || existing.attempts >= existing.maxAttempts;
      const next: Job = {
        ...existing,
        state: exhausted ? 'failed' : 'queued',
        lastError: error,
        lastErrorCode: code,
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
    listRecent: async (query: JobQuery = {}) =>
      [...this.tables.jobs.values()]
        .filter((job) => !query.state || job.state === query.state)
        .filter((job) => !query.kind || job.kind === query.kind)
        .filter((job) => !query.organizationId || job.organizationId === query.organizationId)
        .filter((job) => !query.projectId || job.projectId === query.projectId)
        .filter((job) => !query.since || job.createdAt >= query.since)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, Math.min(Math.max(query.limit ?? 100, 1), 500)),
    getAny: async (id: string) => this.tables.jobs.get(id) ?? null,
    typicalDurationMs: async (kind: JobKind) => {
      const durations = [...this.tables.jobs.values()]
        .filter((job) => job.kind === kind && job.state === 'completed' && job.startedAt)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 12)
        .map((job) => Date.parse(job.updatedAt) - Date.parse(job.startedAt!))
        .sort((a, b) => a - b);
      if (durations.length < 2) return null;
      const middle = durations.length / 2;
      return Math.round(
        durations.length % 2 === 1
          ? durations[Math.floor(middle)]!
          : (durations[middle - 1]! + durations[middle]!) / 2,
      );
    },
  };

  readonly copy = {
    create: async (kit: CopyKit) => {
      this.tables.copy.set(kit.id, kit);
      return kit;
    },
    getLatestForProject: async (organizationId: string, projectId: string) =>
      this.scoped(this.tables.copy, organizationId)
        .filter((kit) => kit.projectId === projectId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null,
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
    listSince: async (since: string, operationPrefix?: string) =>
      [...this.tables.costs.values()]
        .filter((c) => c.createdAt >= since && (!operationPrefix || c.operation.startsWith(operationPrefix)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5000),
    dailySeries: async (since: string) => {
      const byDay = new Map<string, { day: string; costUsd: number; creditsCharged: number; calls: number; failures: number }>();
      for (const row of this.tables.costs.values()) {
        if (row.createdAt < since) continue;
        const day = row.createdAt.slice(0, 10);
        const bucket = byDay.get(day) ?? { day, costUsd: 0, creditsCharged: 0, calls: 0, failures: 0 };
        bucket.costUsd += row.actualCostUsd;
        bucket.creditsCharged += row.creditsCharged;
        bucket.calls += 1;
        if (!row.succeeded) bucket.failures += 1;
        byDay.set(day, bucket);
      }
      return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
    },

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
    get: async (organizationId: string, id: string) =>
      this.scoped(this.tables.revisions, organizationId).find((r) => r.id === id) ?? null,
    listForStoryboard: async (organizationId: string, storyboardId: string) =>
      this.scoped(this.tables.revisions, organizationId)
        .filter((r) => r.storyboardId === storyboardId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    update: async (
      organizationId: string,
      id: string,
      patch: Partial<Pick<RevisionRequest, 'status' | 'proposal' | 'reply' | 'decidedAt' | 'intent' | 'affectedSceneIds'>>,
    ) => this.patch(this.tables.revisions, organizationId, id, patch, 'Revision request'),
    markApplied: async (organizationId: string, id: string, affectedSceneIds: string[]) =>
      this.patch(
        this.tables.revisions,
        organizationId,
        id,
        { applied: true, appliedAt: new Date().toISOString(), affectedSceneIds },
        'Revision request',
      ),
  };

  readonly jobEvents = {
    record: async (event: JobEvent) => {
      this.tables.jobEvents.set(event.id, event);
      return event;
    },
    listForJob: async (organizationId: string, jobId: string) =>
      this.scoped(this.tables.jobEvents, organizationId)
        .filter((e) => e.jobId === jobId)
        .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)),
    listForProject: async (organizationId: string, projectId: string, since?: string) =>
      this.scoped(this.tables.jobEvents, organizationId)
        .filter((e) => e.projectId === projectId && (!since || e.at >= since))
        .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
        .slice(0, 2000),
  };

  readonly researchSources = {
    replaceForProject: async (organizationId: string, projectId: string, sources: ResearchSource[]) => {
      for (const existing of this.scoped(this.tables.researchSources, organizationId)) {
        if (existing.projectId === projectId) this.tables.researchSources.delete(existing.id);
      }
      const stored = sources.map((source) => ({ ...source, organizationId, projectId }));
      for (const source of stored) this.tables.researchSources.set(source.id, source);
      return stored;
    },
    listForProject: async (organizationId: string, projectId: string) =>
      this.scoped(this.tables.researchSources, organizationId)
        .filter((s) => s.projectId === projectId)
        .sort((a, b) => a.position - b.position || a.visitedAt.localeCompare(b.visitedAt) || a.id.localeCompare(b.id)),
  };

  readonly brandVoices = {
    create: async (voice: BrandVoice) => {
      this.tables.brandVoices.set(voice.id, voice);
      return voice;
    },
    get: async (organizationId: string, id: string) =>
      this.scoped(this.tables.brandVoices, organizationId).find((v) => v.id === id) ?? null,
    list: async (organizationId: string) =>
      this.scoped(this.tables.brandVoices, organizationId).sort(
        (a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt.localeCompare(b.createdAt),
      ),
    update: async (organizationId: string, id: string, patch: Partial<BrandVoice>) =>
      this.patch(this.tables.brandVoices, organizationId, id, { ...patch, updatedAt: new Date().toISOString() }, 'Brand voice'),
    setDefault: async (organizationId: string, id: string) => {
      const chosen = this.scoped(this.tables.brandVoices, organizationId).find((v) => v.id === id);
      if (!chosen) throw notFound('Brand voice');
      for (const voice of this.scoped(this.tables.brandVoices, organizationId)) {
        if (voice.id !== id && voice.isDefault) this.tables.brandVoices.set(voice.id, { ...voice, isDefault: false });
      }
      return this.patch(this.tables.brandVoices, organizationId, id, { isDefault: true, updatedAt: new Date().toISOString() }, 'Brand voice');
    },
    remove: async (organizationId: string, id: string) => {
      const existing = this.tables.brandVoices.get(id);
      if (existing && existing.organizationId === organizationId) this.tables.brandVoices.delete(id);
    },
  };

  readonly voiceConsents = {
    create: async (consent: VoiceConsentRecord) => {
      this.tables.voiceConsents.set(consent.id, consent);
      return consent;
    },
    get: async (organizationId: string, id: string) =>
      this.scoped(this.tables.voiceConsents, organizationId).find((c) => c.id === id) ?? null,
    list: async (organizationId: string) =>
      this.scoped(this.tables.voiceConsents, organizationId).sort((a, b) => b.grantedAt.localeCompare(a.grantedAt)),
    revoke: async (organizationId: string, id: string) => {
      const existing = this.scoped(this.tables.voiceConsents, organizationId).find((c) => c.id === id);
      if (!existing) throw notFound('Voice consent');
      return this.patch(this.tables.voiceConsents, organizationId, id, { revokedAt: existing.revokedAt ?? new Date().toISOString() }, 'Voice consent');
    },
    setProviderVoice: async (organizationId: string, id: string, providerVoiceId: string | null) =>
      this.patch(this.tables.voiceConsents, organizationId, id, { providerVoiceId }, 'Voice consent'),
  };

  readonly voiceSettings = {
    get: async (organizationId: string) => this.tables.voiceSettings.get(organizationId) ?? null,
    save: async (settings: VoiceSettings) => {
      this.tables.voiceSettings.set(settings.organizationId, settings);
      return settings;
    },
  };

  readonly audioEditions = {
    create: async (edition: AudioEdition) => {
      this.tables.audioEditions.set(edition.id, edition);
      return edition;
    },
    get: async (organizationId: string, id: string) =>
      this.scoped(this.tables.audioEditions, organizationId).find((e) => e.id === id) ?? null,
    listForProject: async (organizationId: string, projectId: string) =>
      this.scoped(this.tables.audioEditions, organizationId)
        .filter((e) => e.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    update: async (organizationId: string, id: string, patch: Partial<AudioEdition>) =>
      this.patch(this.tables.audioEditions, organizationId, id, patch, 'Audio edition'),
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
      // Flattened here rather than at each call site: these details are quoted
      // from libraries that write for a terminal, and the customer reads them.
      this.tables.credentialAudit.set(event.id, {
        ...event,
        detail: redactMessage(plainText(event.detail)),
      });
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

/** Everything a library search may match, lower-cased. */
function haystack(asset: Asset): string {
  return [asset.name, asset.description, asset.category, asset.source, asset.sourceUrl ?? '', ...asset.tags, asset.contentType]
    .join(' ')
    .toLowerCase();
}

function matchingBenchmarks(all: Benchmark[], query: Omit<BenchmarkQuery, 'limit' | 'offset'>): Benchmark[] {
  const statuses = query.status === undefined ? null : Array.isArray(query.status) ? query.status : [query.status];
  const needle = query.search?.trim().toLowerCase() ?? '';
  return all.filter((benchmark) =>
    (!statuses || statuses.includes(benchmark.status)) &&
    (!query.retrieval || benchmark.retrieval === query.retrieval) &&
    (!needle || benchmark.title.toLowerCase().includes(needle) || benchmark.source.fileName.toLowerCase().includes(needle)),
  );
}
