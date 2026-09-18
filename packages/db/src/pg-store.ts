import { Asset as AssetSchema, BrandSystem as BrandSystemSchema } from '@act-one/core';
import {
  AppError,
  newId,
  notFound,
  plainText,
  redactDetail,
  redactMessage,
  resequence,
  verdictFor,
  windowStartMs,
  type RateLimitRule,
} from '@act-one/core';
import type {
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
  ProductCredential,
  ProductUnderstanding,
  Project,
  ProjectStage,
  QaReport,
  Render,
  ResearchSource,
  RevisionRequest,
  Scene,
  Storyboard,
  Subscription,
  User,
  Variant,
  VoiceConsentRecord,
  VoiceSettings,
} from '@act-one/core';
import { Database, type QueryClient } from './client.ts';
import type { AssetProjectLink, JobQuery, LibraryFilter, PlatformSettings, Store } from './store.ts';

type Row = Record<string, unknown>;

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value);
const isoOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : iso(value);
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0));

/**
 * Postgres-backed Store.
 *
 * Tenant-scoped reads and writes go through db.withTenant(), which opens a
 * transaction with `app.organization_id` set so row-level security applies.
 * The explicit `organization_id = $n` predicates below are therefore belt and
 * braces — they make intent obvious in review and keep the query plans honest,
 * while RLS is what actually guarantees isolation if one is ever forgotten.
 */
export class PgStore implements Store {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  /**
   * A platform-scoped query against the underlying database.
   *
   * For the conformance suite and for operations, which sometimes need a
   * statement no repository offers. Not for application code: everything the
   * product does has a repository method, and that is where tenancy lives.
   */
  raw<T>(fn: (client: QueryClient) => Promise<T>): Promise<T> {
    return this.db.withPlatform(fn);
  }

  /** A tenant-scoped query, for tests that check what a tenant can see with no WHERE at all. */
  asTenant<T>(organizationId: string, fn: (client: QueryClient) => Promise<T>): Promise<T> {
    return this.db.withTenant(organizationId, fn);
  }

  private tenant<T>(organizationId: string, fn: (c: QueryClient) => Promise<T>): Promise<T> {
    return this.db.withTenant(organizationId, fn);
  }

  /** Named distinctly from the `platform` repo so the bypass is obvious in review. */
  private asPlatform<T>(fn: (c: QueryClient) => Promise<T>): Promise<T> {
    return this.db.withPlatform(fn);
  }

  // --- tenancy ------------------------------------------------------------

  readonly organizations = {
    create: async (org: Organization): Promise<Organization> =>
      this.asPlatform(async (c) => {
        const result = await c.query(
          `INSERT INTO organizations
             (id, name, slug, plan_id, stripe_customer_id, credit_balance, max_project_cost_usd, is_suspended, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING *`,
          [
            org.id,
            org.name,
            org.slug,
            org.planId,
            org.stripeCustomerId,
            org.creditBalance,
            org.maxProjectCostUsd,
            org.isSuspended,
            org.createdAt,
          ],
        ).catch((error: unknown) => {
          if (isUniqueViolation(error)) {
            throw new AppError('conflict', `Organization slug "${org.slug}" is taken.`);
          }
          throw error;
        });
        return toOrganization(result.rows[0]!);
      }),

    get: async (id: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM organizations WHERE id = $1', [id]);
        return r.rows[0] ? toOrganization(r.rows[0]) : null;
      }),

    getBySlug: async (slug: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM organizations WHERE slug = $1', [slug]);
        return r.rows[0] ? toOrganization(r.rows[0]) : null;
      }),

    getByStripeCustomerId: async (customerId: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM organizations WHERE stripe_customer_id = $1', [
          customerId,
        ]);
        return r.rows[0] ? toOrganization(r.rows[0]) : null;
      }),

    update: async (id: string, patch: Partial<Organization>) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          `UPDATE organizations SET
             name = COALESCE($2, name),
             plan_id = COALESCE($3, plan_id),
             stripe_customer_id = COALESCE($4, stripe_customer_id),
             credit_balance = COALESCE($5, credit_balance),
             max_project_cost_usd = COALESCE($6, max_project_cost_usd),
             is_suspended = COALESCE($7, is_suspended)
           WHERE id = $1 RETURNING *`,
          [
            id,
            patch.name ?? null,
            patch.planId ?? null,
            patch.stripeCustomerId ?? null,
            patch.creditBalance ?? null,
            patch.maxProjectCostUsd ?? null,
            patch.isSuspended ?? null,
          ],
        );
        if (!r.rows[0]) throw notFound('Organization');
        return toOrganization(r.rows[0]);
      }),

    adjustCredits: async (id: string, delta: number) =>
      this.asPlatform(async (c) => {
        // The CHECK constraint would reject a negative balance, but a WHERE
        // guard lets us distinguish "insufficient credits" from a real error
        // without parsing a constraint name.
        const r = await c.query(
          `UPDATE organizations SET credit_balance = credit_balance + $2
           WHERE id = $1 AND credit_balance + $2 >= 0
           RETURNING *`,
          [id, delta],
        );
        return r.rows[0] ? toOrganization(r.rows[0]) : null;
      }),

    list: async (limit = 50, offset = 0) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          'SELECT * FROM organizations ORDER BY created_at DESC LIMIT $1 OFFSET $2',
          [limit, offset],
        );
        return r.rows.map(toOrganization);
      }),

    count: async () =>
      this.asPlatform(async (c) => {
        const r = await c.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM organizations');
        return num(r.rows[0]?.count);
      }),
  };

  readonly users = {
    create: async (user: User & { passwordHash?: string | null }) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          `INSERT INTO users (id, email, name, avatar_url, password_hash, is_super_admin, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            user.id,
            user.email.toLowerCase(),
            user.name,
            user.avatarUrl,
            user.passwordHash ?? null,
            user.isSuperAdmin,
            user.createdAt,
          ],
        ).catch((error: unknown) => {
          if (isUniqueViolation(error)) {
            throw new AppError('conflict', 'An account with that email already exists.');
          }
          throw error;
        });
        return toUser(r.rows[0]!);
      }),

    get: async (id: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM users WHERE id = $1', [id]);
        return r.rows[0] ? toUser(r.rows[0]) : null;
      }),

    getByEmail: async (email: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
        if (!r.rows[0]) return null;
        return { ...toUser(r.rows[0]), passwordHash: (r.rows[0]['password_hash'] as string) ?? null };
      }),

    update: async (id: string, patch: Partial<User>) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          `UPDATE users SET name = COALESCE($2, name), avatar_url = COALESCE($3, avatar_url)
           WHERE id = $1 RETURNING *`,
          [id, patch.name ?? null, patch.avatarUrl ?? null],
        );
        if (!r.rows[0]) throw notFound('User');
        return toUser(r.rows[0]);
      }),

    count: async () =>
      this.asPlatform(async (c) => {
        const r = await c.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM users');
        return num(r.rows[0]?.count);
      }),

    list: async (limit = 200) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM users ORDER BY created_at DESC LIMIT $1', [
          Math.min(Math.max(limit, 1), 1000),
        ]);
        return r.rows.map(toUser);
      }),

    countSuperAdmins: async () =>
      this.asPlatform(async (c) => {
        const r = await c.query<{ count: number }>(
          'SELECT COUNT(*)::int AS count FROM users WHERE is_super_admin',
        );
        return num(r.rows[0]?.count);
      }),
  };

  readonly memberships = {
    create: async (m: Membership) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          `INSERT INTO memberships (id, organization_id, user_id, role, created_at)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [m.id, m.organizationId, m.userId, m.role, m.createdAt],
        ).catch((error: unknown) => {
          if (isUniqueViolation(error)) {
            throw new AppError('conflict', 'Already a member of this organisation.');
          }
          throw error;
        });
        return toMembership(r.rows[0]!);
      }),

    listForUser: async (userId: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM memberships WHERE user_id = $1', [userId]);
        return r.rows.map(toMembership);
      }),

    listForOrganization: async (organizationId: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          `SELECT m.*, u.email, u.name AS user_name, u.avatar_url, u.is_super_admin,
                  u.created_at AS user_created_at
           FROM memberships m JOIN users u ON u.id = m.user_id
           WHERE m.organization_id = $1 ORDER BY m.created_at`,
          [organizationId],
        );
        return r.rows.map((row) => ({
          ...toMembership(row),
          user: {
            id: row['user_id'] as string,
            email: row['email'] as string,
            name: (row['user_name'] as string) ?? '',
            avatarUrl: (row['avatar_url'] as string) ?? null,
            isSuperAdmin: Boolean(row['is_super_admin']),
            createdAt: iso(row['user_created_at']),
          },
        }));
      }),

    find: async (organizationId: string, userId: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          'SELECT * FROM memberships WHERE organization_id = $1 AND user_id = $2',
          [organizationId, userId],
        );
        return r.rows[0] ? toMembership(r.rows[0]) : null;
      }),

    updateRole: async (organizationId: string, userId: string, role: MemberRole) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'UPDATE memberships SET role = $3 WHERE organization_id = $1 AND user_id = $2 RETURNING *',
          [organizationId, userId, role],
        );
        if (!r.rows[0]) throw notFound('Membership');
        return toMembership(r.rows[0]);
      }),

    remove: async (organizationId: string, userId: string) =>
      this.tenant(organizationId, async (c) => {
        await c.query('DELETE FROM memberships WHERE organization_id = $1 AND user_id = $2', [
          organizationId,
          userId,
        ]);
      }),

    countForOrganization: async (organizationId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query<{ count: number }>(
          'SELECT COUNT(*)::int AS count FROM memberships WHERE organization_id = $1',
          [organizationId],
        );
        return num(r.rows[0]?.count);
      }),
  };

  readonly invitations = {
    create: async (invitation: Invitation) =>
      this.tenant(invitation.organizationId, async (c) => {
        await c.query(
          `INSERT INTO invitations
             (id, organization_id, email, role, token_hash, invited_by, accepted_at, expires_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (organization_id, email) DO UPDATE SET
             role = EXCLUDED.role,
             token_hash = EXCLUDED.token_hash,
             invited_by = EXCLUDED.invited_by,
             accepted_at = NULL,
             expires_at = EXCLUDED.expires_at,
             created_at = EXCLUDED.created_at`,
          [
            invitation.id, invitation.organizationId, invitation.email.toLowerCase(),
            invitation.role, invitation.tokenHash, invitation.invitedByUserId,
            invitation.acceptedAt, invitation.expiresAt, invitation.createdAt,
          ],
        );
        return invitation;
      }),

    listForOrganization: async (organizationId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT * FROM invitations WHERE organization_id = $1 ORDER BY created_at DESC',
          [organizationId],
        );
        return r.rows.map(toInvitation);
      }),

    findByTokenHash: async (tokenHash: string) =>
      /*
       * Platform scope on purpose: whoever is holding this link is not a member
       * of anything yet, so there is no tenant to scope the lookup to. The hash
       * itself is the only thing that identifies the row.
       */
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM invitations WHERE token_hash = $1', [tokenHash]);
        return r.rows[0] ? toInvitation(r.rows[0]) : null;
      }),

    markAccepted: async (id: string, at: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('UPDATE invitations SET accepted_at = $2 WHERE id = $1 RETURNING *', [
          id,
          at,
        ]);
        if (!r.rows[0]) throw notFound('Invitation');
        return toInvitation(r.rows[0]);
      }),

    revoke: async (organizationId: string, id: string) =>
      this.tenant(organizationId, async (c) => {
        await c.query('DELETE FROM invitations WHERE id = $1 AND organization_id = $2', [
          id,
          organizationId,
        ]);
      }),
  };

  readonly rateLimits = {
    hit: async (key: string, rule: RateLimitRule, nowMs = Date.now()) =>
      this.asPlatform(async (c) => {
        const windowStart = new Date(windowStartMs(nowMs, rule)).toISOString();
        // One statement, one row, one count: the upsert is what makes two
        // instances agree without a lock.
        const r = await c.query<{ count: number }>(
          `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1)
           ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
           RETURNING count`,
          [key, windowStart],
        );
        return verdictFor(Number(r.rows[0]?.count ?? 1), nowMs, rule);
      }),
    prune: async (olderThanMs: number) =>
      this.asPlatform(async (c) => {
        const r = await c.query('DELETE FROM rate_limits WHERE window_start < $1', [
          new Date(olderThanMs).toISOString(),
        ]);
        return r.rowCount ?? 0;
      }),
  };

  readonly sessions = {
    create: async (s: {
      id: string;
      userId: string;
      tokenHash: string;
      expiresAt: string;
      organizationId?: string | null;
    }) =>
      this.asPlatform(async (c) => {
        await c.query(
          'INSERT INTO sessions (id, user_id, token_hash, expires_at, organization_id) VALUES ($1,$2,$3,$4,$5)',
          [s.id, s.userId, s.tokenHash, s.expiresAt, s.organizationId ?? null],
        );
      }),

    findByTokenHash: async (tokenHash: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          'SELECT user_id, expires_at, organization_id FROM sessions WHERE token_hash = $1',
          [tokenHash],
        );
        if (!r.rows[0]) return null;
        return {
          userId: r.rows[0]['user_id'] as string,
          expiresAt: iso(r.rows[0]['expires_at']),
          organizationId: (r.rows[0]['organization_id'] as string) ?? null,
        };
      }),

    setOrganization: async (tokenHash: string, organizationId: string) =>
      this.asPlatform(async (c) => {
        await c.query('UPDATE sessions SET organization_id = $2 WHERE token_hash = $1', [
          tokenHash,
          organizationId,
        ]);
      }),

    delete: async (tokenHash: string) =>
      this.asPlatform(async (c) => {
        await c.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
      }),

    deleteExpired: async () =>
      this.asPlatform(async (c) => {
        const r = await c.query('DELETE FROM sessions WHERE expires_at <= now()');
        return r.rowCount ?? 0;
      }),
  };

  readonly subscriptions = {
    upsert: async (s: Subscription) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          `INSERT INTO subscriptions
             (id, organization_id, plan_id, status, stripe_subscription_id, stripe_customer_id,
              current_period_end, cancel_at_period_end, seats, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (organization_id) DO UPDATE SET
             plan_id = EXCLUDED.plan_id,
             status = EXCLUDED.status,
             stripe_subscription_id = EXCLUDED.stripe_subscription_id,
             stripe_customer_id = EXCLUDED.stripe_customer_id,
             current_period_end = EXCLUDED.current_period_end,
             cancel_at_period_end = EXCLUDED.cancel_at_period_end,
             seats = EXCLUDED.seats,
             updated_at = EXCLUDED.updated_at
           RETURNING *`,
          [
            s.id,
            s.organizationId,
            s.planId,
            s.status,
            s.stripeSubscriptionId,
            s.stripeCustomerId,
            s.currentPeriodEnd,
            s.cancelAtPeriodEnd,
            s.seats,
            s.createdAt,
            s.updatedAt,
          ],
        );
        return toSubscription(r.rows[0]!);
      }),

    getForOrganization: async (organizationId: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM subscriptions WHERE organization_id = $1', [
          organizationId,
        ]);
        return r.rows[0] ? toSubscription(r.rows[0]) : null;
      }),

    getByStripeSubscriptionId: async (id: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM subscriptions WHERE stripe_subscription_id = $1', [id]);
        return r.rows[0] ? toSubscription(r.rows[0]) : null;
      }),
  };

  // --- creative documents -------------------------------------------------

  readonly brands = {
    create: async (brand: BrandSystem) =>
      this.tenant(brand.organizationId, async (c) => {
        await c.query(
          `INSERT INTO brands (id, organization_id, name, confirmed, data, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [brand.id, brand.organizationId, brand.name, brand.confirmedByUser, brand, brand.createdAt, brand.updatedAt],
        );
        return brand;
      }),

    get: async (organizationId: string, id: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT data FROM brands WHERE id = $1 AND organization_id = $2',
          [id, organizationId],
        );
        return r.rows[0] ? brandFromRow(r.rows[0]['data']) : null;
      }),

    update: async (organizationId: string, id: string, patch: Partial<BrandSystem>) =>
      this.tenant(organizationId, async (c) => {
        const current = await c.query(
          'SELECT data FROM brands WHERE id = $1 AND organization_id = $2 FOR UPDATE',
          [id, organizationId],
        );
        if (!current.rows[0]) throw notFound('Brand');
        const next: BrandSystem = {
          ...brandFromRow(current.rows[0]['data']),
          ...patch,
          id,
          organizationId,
          updatedAt: new Date().toISOString(),
        };
        await c.query(
          'UPDATE brands SET data = $3, name = $4, confirmed = $5, updated_at = now() WHERE id = $1 AND organization_id = $2',
          [id, organizationId, next, next.name, next.confirmedByUser],
        );
        return next;
      }),

    list: async (organizationId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT data FROM brands WHERE organization_id = $1 ORDER BY created_at DESC',
          [organizationId],
        );
        return r.rows.map((row) => brandFromRow(row['data']));
      }),

    getForProject: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT data FROM brands WHERE organization_id = $1 AND data->>'projectId' = $2
           ORDER BY created_at DESC LIMIT 1`,
          [organizationId, projectId],
        );
        return r.rows[0] ? brandFromRow(r.rows[0]['data']) : null;
      }),
  };

  readonly projects = {
    create: async (project: Project) =>
      this.tenant(project.organizationId, async (c) => {
        await c.query(
          `INSERT INTO projects
             (id, organization_id, created_by_user_id, name, website_url, supplemental_urls,
              brand_id, stage, brief, cost_usd, credits_spent, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            project.id,
            project.organizationId,
            project.createdByUserId,
            project.name,
            project.websiteUrl,
            JSON.stringify(project.supplementalUrls),
            project.brandId,
            project.stage,
            project.brief,
            project.costUsd,
            project.creditsSpent,
            project.createdAt,
            project.updatedAt,
          ],
        );
        return project;
      }),

    get: async (organizationId: string, id: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query('SELECT * FROM projects WHERE id = $1 AND organization_id = $2', [
          id,
          organizationId,
        ]);
        return r.rows[0] ? toProject(r.rows[0]) : null;
      }),

    update: async (organizationId: string, id: string, patch: Partial<Project>) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `UPDATE projects SET
             name = COALESCE($3, name),
             website_url = COALESCE($4, website_url),
             supplemental_urls = COALESCE($5, supplemental_urls),
             brand_id = COALESCE($6, brand_id),
             product_understanding_id = COALESCE($7, product_understanding_id),
             selected_concept_id = COALESCE($8, selected_concept_id),
             active_storyboard_id = COALESCE($9, active_storyboard_id),
             latest_render_id = COALESCE($10, latest_render_id),
             stage = COALESCE($11, stage),
             brief = COALESCE($12, brief),
             product_credential_id = COALESCE($13, product_credential_id),
             archived_at = COALESCE($14, archived_at),
             updated_at = now()
           WHERE id = $1 AND organization_id = $2 RETURNING *`,
          [
            id,
            organizationId,
            patch.name ?? null,
            patch.websiteUrl ?? null,
            patch.supplementalUrls ? JSON.stringify(patch.supplementalUrls) : null,
            patch.brandId ?? null,
            patch.productUnderstandingId ?? null,
            patch.selectedConceptId ?? null,
            patch.activeStoryboardId ?? null,
            patch.latestRenderId ?? null,
            patch.stage ?? null,
            patch.brief ?? null,
            patch.productCredentialId ?? null,
            patch.archivedAt ?? null,
          ],
        );
        if (!r.rows[0]) throw notFound('Project');
        return toProject(r.rows[0]);
      }),

    list: async (organizationId: string, options: { includeArchived?: boolean } = {}) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT * FROM projects WHERE organization_id = $1
             ${options.includeArchived ? '' : 'AND archived_at IS NULL'}
           ORDER BY created_at DESC`,
          [organizationId],
        );
        return r.rows.map(toProject);
      }),

    countTowardQuotaSince: async (organizationId: string, since: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM projects p
           WHERE p.organization_id = $1
             AND p.created_at >= $2
             AND NOT (
               p.stage = 'failed'
               AND NOT EXISTS (
                 SELECT 1 FROM product_understandings u WHERE u.project_id = p.id
               )
             )`,
          [organizationId, since],
        );
        return num(r.rows[0]?.count);
      }),

    setStage: async (organizationId: string, id: string, stage: ProjectStage) =>
      this.projects.update(organizationId, id, { stage }),

    addCost: async (organizationId: string, id: string, costUsd: number, credits: number) =>
      this.tenant(organizationId, async (c) => {
        await c.query(
          `UPDATE projects SET cost_usd = cost_usd + $3, credits_spent = credits_spent + $4, updated_at = now()
           WHERE id = $1 AND organization_id = $2`,
          [id, organizationId, costUsd, credits],
        );
      }),

    listByStage: async (stage: ProjectStage, limit = 100) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          'SELECT * FROM projects WHERE stage = $1 AND archived_at IS NULL ORDER BY updated_at DESC LIMIT $2',
          [stage, limit],
        );
        return r.rows.map(toProject);
      }),
  };

  readonly understandings = {
    create: async (u: ProductUnderstanding, organizationId: string) =>
      this.tenant(organizationId, async (c) => {
        await c.query(
          `INSERT INTO product_understandings (id, organization_id, project_id, data, created_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [u.id, organizationId, u.projectId, u, u.createdAt],
        );
        return u;
      }),

    get: async (organizationId: string, id: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT data FROM product_understandings WHERE id = $1 AND organization_id = $2',
          [id, organizationId],
        );
        return (r.rows[0]?.['data'] as ProductUnderstanding) ?? null;
      }),

    getLatestForProject: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT data FROM product_understandings
           WHERE project_id = $1 AND organization_id = $2
           ORDER BY created_at DESC LIMIT 1`,
          [projectId, organizationId],
        );
        return (r.rows[0]?.['data'] as ProductUnderstanding) ?? null;
      }),

    update: async (organizationId: string, id: string, patch: Partial<ProductUnderstanding>) =>
      this.tenant(organizationId, async (c) => {
        const current = await c.query(
          'SELECT data FROM product_understandings WHERE id = $1 AND organization_id = $2 FOR UPDATE',
          [id, organizationId],
        );
        if (!current.rows[0]) throw notFound('Product understanding');
        const next = { ...(current.rows[0]['data'] as ProductUnderstanding), ...patch, id };
        await c.query(
          'UPDATE product_understandings SET data = $3 WHERE id = $1 AND organization_id = $2',
          [id, organizationId, next],
        );
        return next;
      }),
  };

  readonly concepts = {
    createMany: async (concepts: Concept[], organizationId: string) =>
      this.tenant(organizationId, async (c) => {
        for (const concept of concepts) {
          await c.query(
            `INSERT INTO concepts
               (id, organization_id, project_id, name, creative_system, selected, data, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              concept.id,
              organizationId,
              concept.projectId,
              concept.name,
              concept.creativeSystem,
              concept.selected,
              concept,
              concept.createdAt,
            ],
          );
        }
        return concepts;
      }),

    get: async (organizationId: string, id: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT data FROM concepts WHERE id = $1 AND organization_id = $2',
          [id, organizationId],
        );
        return (r.rows[0]?.['data'] as Concept) ?? null;
      }),

    listForProject: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT data FROM concepts WHERE project_id = $1 AND organization_id = $2 ORDER BY created_at',
          [projectId, organizationId],
        );
        return r.rows.map((row) => row['data'] as Concept);
      }),

    update: async (organizationId: string, id: string, patch: Partial<Concept>) =>
      this.tenant(organizationId, async (c) => {
        const current = await c.query(
          'SELECT data FROM concepts WHERE id = $1 AND organization_id = $2 FOR UPDATE',
          [id, organizationId],
        );
        if (!current.rows[0]) throw notFound('Concept');
        const next = { ...(current.rows[0]['data'] as Concept), ...patch, id };
        await c.query(
          'UPDATE concepts SET data = $3, selected = $4 WHERE id = $1 AND organization_id = $2',
          [id, organizationId, next, next.selected],
        );
        return next;
      }),

    select: async (organizationId: string, projectId: string, conceptId: string) =>
      this.tenant(organizationId, async (c) => {
        // One transaction: a project must never have two selected concepts,
        // even briefly, because the storyboard job reads this to decide what
        // to build.
        await c.query(
          `UPDATE concepts
             SET selected = (id = $3), data = jsonb_set(data, '{selected}', to_jsonb(id = $3))
           WHERE project_id = $1 AND organization_id = $2`,
          [projectId, organizationId, conceptId],
        );
        const r = await c.query(
          'SELECT data FROM concepts WHERE id = $1 AND organization_id = $2',
          [conceptId, organizationId],
        );
        if (!r.rows[0]) throw notFound('Concept');
        return r.rows[0]['data'] as Concept;
      }),
  };

  readonly treatments = {
    create: async (t: CreativeTreatment, organizationId: string) =>
      this.tenant(organizationId, async (c) => {
        await c.query(
          `INSERT INTO treatments (id, organization_id, project_id, concept_id, data, created_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [t.id, organizationId, t.projectId, t.conceptId, t, t.createdAt],
        );
        return t;
      }),

    get: async (organizationId: string, id: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT data FROM treatments WHERE id = $1 AND organization_id = $2',
          [id, organizationId],
        );
        return (r.rows[0]?.['data'] as CreativeTreatment) ?? null;
      }),

    getForConcept: async (organizationId: string, conceptId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT data FROM treatments WHERE concept_id = $1 AND organization_id = $2
           ORDER BY created_at DESC LIMIT 1`,
          [conceptId, organizationId],
        );
        return (r.rows[0]?.['data'] as CreativeTreatment) ?? null;
      }),
  };

  readonly storyboards = {
    create: async (storyboard: Storyboard, organizationId: string) =>
      this.tenant(organizationId, async (c) => {
        await c.query(
          `INSERT INTO storyboards
             (id, organization_id, project_id, concept_id, treatment_id, version, status,
              voice_strategy, music_direction, created_at, updated_at, language)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            storyboard.id,
            organizationId,
            storyboard.projectId,
            storyboard.conceptId,
            storyboard.treatmentId,
            storyboard.version,
            storyboard.status,
            storyboard.voiceStrategy,
            storyboard.musicDirection,
            storyboard.createdAt,
            storyboard.updatedAt,
            storyboard.language ?? null,
          ],
        );
        await insertScenes(c, organizationId, storyboard.id, storyboard.scenes);
        return storyboard;
      }),

    get: async (organizationId: string, id: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query('SELECT * FROM storyboards WHERE id = $1 AND organization_id = $2', [
          id,
          organizationId,
        ]);
        if (!r.rows[0]) return null;
        const scenes = await loadScenes(c, organizationId, id);
        return toStoryboard(r.rows[0], scenes);
      }),

    listForProject: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT * FROM storyboards WHERE project_id = $1 AND organization_id = $2 ORDER BY version DESC',
          [projectId, organizationId],
        );
        const boards: Storyboard[] = [];
        for (const row of r.rows) {
          const scenes = await loadScenes(c, organizationId, row['id'] as string);
          boards.push(toStoryboard(row, scenes));
        }
        return boards;
      }),

    replaceScenes: async (organizationId: string, storyboardId: string, scenes: Scene[]) =>
      this.tenant(organizationId, async (c) => {
        const board = await c.query(
          'SELECT * FROM storyboards WHERE id = $1 AND organization_id = $2 FOR UPDATE',
          [storyboardId, organizationId],
        );
        if (!board.rows[0]) throw notFound('Storyboard');
        await c.query('DELETE FROM scenes WHERE storyboard_id = $1 AND organization_id = $2', [
          storyboardId,
          organizationId,
        ]);
        await insertScenes(c, organizationId, storyboardId, scenes);
        await c.query('UPDATE storyboards SET updated_at = now() WHERE id = $1', [storyboardId]);
        return toStoryboard(board.rows[0], scenes);
      }),

    updateScene: async (organizationId: string, sceneId: string, patch: Partial<Scene>) =>
      this.tenant(organizationId, async (c) => {
        const current = await c.query(
          'SELECT data FROM scenes WHERE id = $1 AND organization_id = $2 FOR UPDATE',
          [sceneId, organizationId],
        );
        if (!current.rows[0]) throw notFound('Scene');
        const next: Scene = { ...(current.rows[0]['data'] as Scene), ...patch, id: sceneId };
        await c.query(
          `UPDATE scenes SET data = $3, scene_index = $4, start_time = $5, duration = $6,
                             visual_type = $7, status = $8, estimated_cost_usd = $9
           WHERE id = $1 AND organization_id = $2`,
          [
            sceneId,
            organizationId,
            next,
            next.index,
            next.startTime,
            next.duration,
            next.visualType,
            next.status,
            next.estimatedCostUsd,
          ],
        );
        return next;
      }),

    getScene: async (organizationId: string, sceneId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query('SELECT data FROM scenes WHERE id = $1 AND organization_id = $2', [
          sceneId,
          organizationId,
        ]);
        return (r.rows[0]?.['data'] as Scene) ?? null;
      }),

    update: async (organizationId: string, id: string, patch: Partial<Storyboard>) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `UPDATE storyboards SET
             status = COALESCE($3, status),
             voice_strategy = COALESCE($4, voice_strategy),
             music_direction = COALESCE($5, music_direction),
             language = COALESCE($6, language),
             updated_at = now()
           WHERE id = $1 AND organization_id = $2 RETURNING *`,
          [id, organizationId, patch.status ?? null, patch.voiceStrategy ?? null, patch.musicDirection ?? null, patch.language ?? null],
        );
        if (!r.rows[0]) throw notFound('Storyboard');
        const scenes = patch.scenes ?? (await loadScenes(c, organizationId, id));
        return toStoryboard(r.rows[0], scenes);
      }),

    nextVersion: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query<{ max: number | null }>(
          'SELECT MAX(version) AS max FROM storyboards WHERE project_id = $1 AND organization_id = $2',
          [projectId, organizationId],
        );
        return num(r.rows[0]?.max) + 1;
      }),
  };

  // --- production ---------------------------------------------------------

  readonly assets = {
    create: async (input: AssetInput) => {
      const asset = AssetSchema.parse(input);
      return this.tenant(asset.organizationId, async (c) => {
        await c.query(
          `INSERT INTO assets
             (id, organization_id, project_id, concept_id, scene_id, kind, origin, rights,
              storage_key, content_type, bytes, width, height, duration_seconds, checksum,
              provider, model, source_url, cost_usd, metadata, created_at,
              library, name, category, category_source, description, tags, favorite, approved,
              parent_asset_id, uploaded_by_user_id, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
                   $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32)`,
          [
            asset.id, asset.organizationId, asset.projectId, asset.conceptId, asset.sceneId,
            asset.kind, asset.origin, asset.rights, asset.storageKey, asset.contentType,
            asset.bytes, asset.width, asset.height, asset.durationSeconds, asset.checksum,
            asset.provider, asset.model, asset.sourceUrl, asset.costUsd, asset.metadata,
            asset.createdAt,
            asset.library, asset.name, asset.category, asset.categorySource, asset.description,
            JSON.stringify(asset.tags), asset.favorite, asset.approved, asset.parentAssetId,
            asset.uploadedByUserId, asset.source,
          ],
        );
        return asset;
      });
    },

    get: async (organizationId: string, id: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query('SELECT * FROM assets WHERE id = $1 AND organization_id = $2', [
          id,
          organizationId,
        ]);
        return r.rows[0] ? toAsset(r.rows[0]) : null;
      }),

    getMany: async (organizationId: string, ids: string[]) =>
      ids.length === 0
        ? []
        : this.tenant(organizationId, async (c) => {
            const r = await c.query(
              'SELECT * FROM assets WHERE id = ANY($1) AND organization_id = $2',
              [ids, organizationId],
            );
            return r.rows.map(toAsset);
          }),

    listForProject: async (organizationId: string, projectId: string, kind?: Asset['kind']) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT * FROM assets WHERE project_id = $1 AND organization_id = $2
             ${kind ? 'AND kind = $3' : ''}
           ORDER BY created_at DESC`,
          kind ? [projectId, organizationId, kind] : [projectId, organizationId],
        );
        return r.rows.map(toAsset);
      }),

    listForScene: async (organizationId: string, sceneId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT * FROM assets WHERE scene_id = $1 AND organization_id = $2 ORDER BY created_at',
          [sceneId, organizationId],
        );
        return r.rows.map(toAsset);
      }),

    update: async (organizationId: string, id: string, patch: Partial<Asset>) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `UPDATE assets SET
             scene_id = COALESCE($3, scene_id),
             rights = COALESCE($4, rights),
             metadata = COALESCE($5, metadata),
             cost_usd = COALESCE($6, cost_usd),
             library = COALESCE($7, library),
             name = COALESCE($8, name),
             category = COALESCE($9, category),
             category_source = COALESCE($10, category_source),
             description = COALESCE($11, description),
             tags = COALESCE($12::jsonb, tags),
             favorite = COALESCE($13, favorite),
             approved = COALESCE($14, approved),
             parent_asset_id = CASE WHEN $15::boolean THEN $16 ELSE parent_asset_id END,
             source = COALESCE($17, source),
             width = COALESCE($18, width),
             height = COALESCE($19, height)
           WHERE id = $1 AND organization_id = $2 RETURNING *`,
          [
            id, organizationId, patch.sceneId ?? null, patch.rights ?? null, patch.metadata ?? null, patch.costUsd ?? null,
            patch.library ?? null, patch.name ?? null, patch.category ?? null, patch.categorySource ?? null,
            patch.description ?? null, patch.tags ? JSON.stringify(patch.tags) : null, patch.favorite ?? null,
            patch.approved ?? null, 'parentAssetId' in patch, patch.parentAssetId ?? null, patch.source ?? null,
            patch.width ?? null, patch.height ?? null,
          ],
        );
        if (!r.rows[0]) throw notFound('Asset');
        return toAsset(r.rows[0]);
      }),

    delete: async (organizationId: string, id: string) =>
      this.tenant(organizationId, async (c) => {
        await c.query('DELETE FROM assets WHERE id = $1 AND organization_id = $2', [id, organizationId]);
      }),

    listLibrary: async (organizationId: string, filter: LibraryFilter = {}) =>
      this.tenant(organizationId, async (c) => {
        const params: unknown[] = [organizationId];
        const where: string[] = ['organization_id = $1', 'library'];
        const add = (value: unknown): string => {
          params.push(value);
          return `$${params.length}`;
        };
        if (filter.category) where.push(`category = ${add(filter.category)}`);
        if (filter.source) where.push(`source = ${add(filter.source)}`);
        if (filter.favorite !== undefined) where.push(`favorite = ${add(filter.favorite)}`);
        if (filter.approved !== undefined) where.push(`approved = ${add(filter.approved)}`);
        if (filter.projectId) {
          const project = add(filter.projectId);
          where.push(
            `(EXISTS (SELECT 1 FROM asset_projects ap WHERE ap.asset_id = assets.id AND ap.project_id = ${project})
              OR NOT EXISTS (SELECT 1 FROM asset_projects ap WHERE ap.asset_id = assets.id))`,
          );
        }
        const needle = filter.query?.trim();
        if (needle) {
          const like = add(`%${needle.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
          where.push(
            `(name ILIKE ${like} OR description ILIKE ${like} OR category ILIKE ${like} OR source ILIKE ${like}
              OR COALESCE(source_url, '') ILIKE ${like} OR content_type ILIKE ${like}
              OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(tags) tag WHERE tag ILIKE ${like}))`,
          );
        }
        const limit = add(Math.min(Math.max(filter.limit ?? 500, 1), 2000));
        const r = await c.query(
          `SELECT * FROM assets WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id LIMIT ${limit}`,
          params,
        );
        return r.rows.map(toAsset);
      }),

    listLibraryForProject: async (organizationId: string, projectId: string) =>
      this.assets.listLibrary(organizationId, { projectId }),

    setProjects: async (organizationId: string, assetId: string, projectIds: string[]) =>
      this.tenant(organizationId, async (c) => {
        const owned = await c.query('SELECT 1 FROM assets WHERE id = $1 AND organization_id = $2', [assetId, organizationId]);
        if (!owned.rows[0]) throw notFound('Asset');
        // Every project checked before anything is removed, whatever the
        // transaction would do: a list with a foreign id changes nothing.
        for (const projectId of new Set(projectIds)) {
          const project = await c.query('SELECT 1 FROM projects WHERE id = $1 AND organization_id = $2', [projectId, organizationId]);
          if (!project.rows[0]) throw notFound('Project');
        }
        await c.query('DELETE FROM asset_projects WHERE asset_id = $1 AND organization_id = $2', [assetId, organizationId]);
        await attachProjects(c, organizationId, assetId, projectIds);
      }),

    attachToProjects: async (organizationId: string, assetId: string, projectIds: string[]) =>
      this.tenant(organizationId, async (c) => {
        const owned = await c.query('SELECT 1 FROM assets WHERE id = $1 AND organization_id = $2', [assetId, organizationId]);
        if (!owned.rows[0]) throw notFound('Asset');
        await attachProjects(c, organizationId, assetId, projectIds);
      }),

    listProjectLinks: async (organizationId: string, assetIds: string[]) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT asset_id, project_id, attached_at FROM asset_projects
           WHERE organization_id = $1 ${assetIds.length > 0 ? 'AND asset_id = ANY($2)' : ''}
           ORDER BY attached_at, project_id`,
          assetIds.length > 0 ? [organizationId, assetIds] : [organizationId],
        );
        return r.rows.map(
          (row): AssetProjectLink => ({
            assetId: row['asset_id'] as string,
            projectId: row['project_id'] as string,
            attachedAt: iso(row['attached_at']),
          }),
        );
      }),

    listVersions: async (organizationId: string, parentAssetId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT * FROM assets WHERE parent_asset_id = $1 AND organization_id = $2 ORDER BY created_at DESC',
          [parentAssetId, organizationId],
        );
        return r.rows.map(toAsset);
      }),
  };

  readonly renders = {
    create: async (render: Render) =>
      this.tenant(render.organizationId, async (c) => {
        await c.query(
          `INSERT INTO renders
             (id, organization_id, project_id, storyboard_id, kind, version, aspect, quality, fps,
              status, watermarked, duration_seconds, cost_usd, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            render.id, render.organizationId, render.projectId, render.storyboardId, render.kind,
            render.version, render.aspect, render.quality, render.fps, render.status,
            render.watermarked, render.durationSeconds, render.costUsd, render.createdAt,
          ],
        );
        return render;
      }),

    get: async (organizationId: string, id: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query('SELECT * FROM renders WHERE id = $1 AND organization_id = $2', [
          id,
          organizationId,
        ]);
        return r.rows[0] ? toRender(r.rows[0]) : null;
      }),

    listForProject: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT * FROM renders WHERE project_id = $1 AND organization_id = $2 ORDER BY created_at DESC',
          [projectId, organizationId],
        );
        return r.rows.map(toRender);
      }),

    update: async (organizationId: string, id: string, patch: Partial<Render>) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `UPDATE renders SET
             status = COALESCE($3, status),
             master_asset_id = COALESCE($4, master_asset_id),
             poster_asset_id = COALESCE($5, poster_asset_id),
             duration_seconds = COALESCE($6, duration_seconds),
             cost_usd = COALESCE($7, cost_usd),
             qa_report_id = COALESCE($8, qa_report_id),
             error = COALESCE($9, error),
             started_at = COALESCE($10, started_at),
             completed_at = COALESCE($11, completed_at)
           WHERE id = $1 AND organization_id = $2 RETURNING *`,
          [
            id, organizationId, patch.status ?? null, patch.masterAssetId ?? null,
            patch.posterAssetId ?? null, patch.durationSeconds ?? null, patch.costUsd ?? null,
            patch.qaReportId ?? null, patch.error ?? null, patch.startedAt ?? null,
            patch.completedAt ?? null,
          ],
        );
        if (!r.rows[0]) throw notFound('Render');
        return toRender(r.rows[0]);
      }),

    /*
     * Films only. This count is what the plan's renders-per-project limit is
     * measured against, and counting campaign cuts and timing previews meant a
     * customer spent their allowance on work they never chose to pay for.
     */
    countForProject: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM renders
             WHERE project_id = $1 AND organization_id = $2 AND kind = 'film'`,
          [projectId, organizationId],
        );
        return num(r.rows[0]?.count);
      }),

    listActive: async (limit = 50) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          `SELECT * FROM renders WHERE status NOT IN ('completed','failed','canceled')
           ORDER BY created_at DESC LIMIT $1`,
          [limit],
        );
        return r.rows.map(toRender);
      }),
  };

  readonly variants = {
    createMany: async (variants: Variant[]) => {
      if (variants.length === 0) return [];
      const organizationId = await this.asPlatform(async (c) => {
        const r = await c.query('SELECT organization_id FROM renders WHERE id = $1', [
          variants[0]!.renderId,
        ]);
        if (!r.rows[0]) throw notFound('Render');
        return r.rows[0]['organization_id'] as string;
      });
      return this.tenant(organizationId, async (c) => {
        for (const v of variants) {
          await c.query(
            `INSERT INTO variants
               (id, organization_id, project_id, render_id, purpose, aspect, duration_seconds,
                scene_ids, audio_stem, captions_burned, asset_id, status, cost_usd, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
              v.id, organizationId, v.projectId, v.renderId, v.purpose, v.aspect,
              v.durationSeconds, JSON.stringify(v.sceneIds), v.audioStem, v.captionsBurned,
              v.assetId, v.status, v.costUsd, v.createdAt,
            ],
          );
        }
        return variants;
      });
    },

    listForRender: async (organizationId: string, renderId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT * FROM variants WHERE render_id = $1 AND organization_id = $2 ORDER BY created_at',
          [renderId, organizationId],
        );
        return r.rows.map(toVariant);
      }),

    update: async (organizationId: string, id: string, patch: Partial<Variant>) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `UPDATE variants SET status = COALESCE($3, status), asset_id = COALESCE($4, asset_id),
                               cost_usd = COALESCE($5, cost_usd)
           WHERE id = $1 AND organization_id = $2 RETURNING *`,
          [id, organizationId, patch.status ?? null, patch.assetId ?? null, patch.costUsd ?? null],
        );
        if (!r.rows[0]) throw notFound('Variant');
        return toVariant(r.rows[0]);
      }),
  };

  readonly qaReports = {
    create: async (report: QaReport, organizationId: string) =>
      this.tenant(organizationId, async (c) => {
        await c.query(
          `INSERT INTO qa_reports (id, organization_id, project_id, render_id, passed, frames_inspected, data, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [report.id, organizationId, report.projectId, report.renderId, report.passed, report.framesInspected, report, report.createdAt],
        );
        return report;
      }),

    get: async (organizationId: string, id: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query('SELECT data FROM qa_reports WHERE id = $1 AND organization_id = $2', [
          id,
          organizationId,
        ]);
        return (r.rows[0]?.['data'] as QaReport) ?? null;
      }),

    getForRender: async (organizationId: string, renderId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT data FROM qa_reports WHERE render_id = $1 AND organization_id = $2
           ORDER BY created_at DESC LIMIT 1`,
          [renderId, organizationId],
        );
        return (r.rows[0]?.['data'] as QaReport) ?? null;
      }),
  };

  readonly jobs = {
    enqueue: async (job: Job) =>
      this.tenant(job.organizationId, async (c) => {
        await c.query(
          `INSERT INTO jobs
             (id, organization_id, project_id, kind, state, payload, progress, status_message,
              attempts, max_attempts, run_after, priority, created_at, updated_at, started_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            job.id, job.organizationId, job.projectId, job.kind, job.state, job.payload,
            job.progress, job.statusMessage, job.attempts, job.maxAttempts, job.runAfter,
            job.priority, job.createdAt, job.updatedAt, job.startedAt,
          ],
        );
        return job;
      }),

    get: async (organizationId: string, id: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query('SELECT * FROM jobs WHERE id = $1 AND organization_id = $2', [
          id,
          organizationId,
        ]);
        return r.rows[0] ? toJob(r.rows[0]) : null;
      }),

    claim: async (workerId: string, kinds?: JobKind[]) =>
      this.asPlatform(async (c) => {
        // FOR UPDATE SKIP LOCKED is what makes multiple render workers safe:
        // each transaction takes a different row instead of serialising on the
        // same one or double-claiming it.
        const r = await c.query(
          `UPDATE jobs SET locked_by = $1, locked_at = now(), started_at = now(),
             attempts = attempts + 1, updated_at = now()
           WHERE id = (
             SELECT id FROM jobs
             WHERE state = 'queued' AND locked_by IS NULL AND run_after <= now()
               ${kinds && kinds.length > 0 ? 'AND kind = ANY($2)' : ''}
             ORDER BY priority DESC, run_after ASC
             FOR UPDATE SKIP LOCKED
             LIMIT 1
           )
           RETURNING *`,
          kinds && kinds.length > 0 ? [workerId, kinds] : [workerId],
        );
        return r.rows[0] ? toJob(r.rows[0]) : null;
      }),

    update: async (id: string, patch: Partial<Job>) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          `UPDATE jobs SET
             state = COALESCE($2, state),
             progress = COALESCE($3, progress),
             status_message = COALESCE($4, status_message),
             payload = COALESCE($5, payload),
             run_after = COALESCE($6, run_after),
             updated_at = now()
           WHERE id = $1 RETURNING *`,
          [id, patch.state ?? null, patch.progress ?? null, patch.statusMessage ?? null, patch.payload ?? null, patch.runAfter ?? null],
        );
        if (!r.rows[0]) throw notFound('Job');
        return toJob(r.rows[0]);
      }),

    complete: async (id: string, state: JobState, message = '') =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          `UPDATE jobs SET state = $2, status_message = $3,
             progress = CASE WHEN $2 = 'completed' THEN 1 ELSE progress END,
             locked_by = NULL, locked_at = NULL, updated_at = now()
           WHERE id = $1 RETURNING *`,
          [id, state, message],
        );
        if (!r.rows[0]) throw notFound('Job');
        return toJob(r.rows[0]);
      }),

    fail: async (id: string, error: string, retryAt: string | null) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          `UPDATE jobs SET
             state = CASE WHEN $3::timestamptz IS NULL OR attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
             last_error = $2,
             run_after = COALESCE($3::timestamptz, run_after),
             locked_by = NULL, locked_at = NULL, updated_at = now()
           WHERE id = $1 RETURNING *`,
          [id, error.slice(0, 4000), retryAt],
        );
        if (!r.rows[0]) throw notFound('Job');
        return toJob(r.rows[0]);
      }),

    listForProject: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT * FROM jobs WHERE project_id = $1 AND organization_id = $2 ORDER BY created_at DESC',
          [projectId, organizationId],
        );
        return r.rows.map(toJob);
      }),

    reapStale: async (olderThanMs: number) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          `UPDATE jobs SET
             locked_by = NULL, locked_at = NULL,
             state = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
             last_error = 'Worker lock expired; job reclaimed.',
             run_after = now() + ($1 || ' milliseconds')::interval,
             updated_at = now()
           WHERE locked_by IS NOT NULL AND locked_at < now() - ($1 || ' milliseconds')::interval`,
          [String(olderThanMs)],
        );
        return r.rowCount ?? 0;
      }),

    countByState: async () =>
      this.asPlatform(async (c) => {
        const r = await c.query<{ state: string; count: number }>(
          'SELECT state, COUNT(*)::int AS count FROM jobs GROUP BY state',
        );
        return Object.fromEntries(r.rows.map((row) => [row.state, num(row.count)]));
      }),

    listRecent: async (query: JobQuery = {}) =>
      this.asPlatform(async (c) => {
        const where: string[] = [];
        const params: unknown[] = [];
        const bind = (value: unknown) => `$${params.push(value)}`;
        if (query.state) where.push(`state = ${bind(query.state)}`);
        if (query.kind) where.push(`kind = ${bind(query.kind)}`);
        if (query.organizationId) where.push(`organization_id = ${bind(query.organizationId)}`);
        if (query.projectId) where.push(`project_id = ${bind(query.projectId)}`);
        if (query.since) where.push(`created_at >= ${bind(query.since)}`);
        const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
        const r = await c.query(
          `SELECT * FROM jobs ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY created_at DESC LIMIT ${limit}`,
          params,
        );
        return r.rows.map(toJob);
      }),

    getAny: async (id: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM jobs WHERE id = $1', [id]);
        return r.rows[0] ? toJob(r.rows[0]) : null;
      }),

    typicalDurationMs: async (kind: JobKind) =>
      this.asPlatform(async (c) => {
        const r = await c.query<{ median: number | null; samples: number }>(
          `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) AS median, COUNT(*)::int AS samples
           FROM (
             SELECT EXTRACT(EPOCH FROM (updated_at - started_at)) * 1000 AS ms
             FROM jobs
             WHERE kind = $1 AND state = 'completed' AND started_at IS NOT NULL
             ORDER BY updated_at DESC
             LIMIT 12
           ) recent`,
          [kind],
        );
        const row = r.rows[0];
        if (!row || row.median === null || num(row.samples) < 2) return null;
        return Math.round(num(row.median));
      }),
  };

  readonly copy = {
    create: async (kit: CopyKit) =>
      this.tenant(kit.organizationId, async (c) => {
        await c.query(
          `INSERT INTO copy_kits (id, organization_id, project_id, concept_id, lines, created_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [kit.id, kit.organizationId, kit.projectId, kit.conceptId, JSON.stringify(kit.lines), kit.createdAt],
        );
        return kit;
      }),

    getLatestForProject: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT * FROM copy_kits WHERE project_id = $1 AND organization_id = $2
           ORDER BY created_at DESC LIMIT 1`,
          [projectId, organizationId],
        );
        return r.rows[0] ? toCopyKit(r.rows[0]) : null;
      }),
  };

  readonly costs = {
    record: async (cost: GenerationCost) =>
      this.tenant(cost.organizationId, async (c) => {
        await c.query(
          `INSERT INTO generation_costs
             (id, organization_id, project_id, scene_id, render_id, provider, model, operation,
              estimated_cost_usd, actual_cost_usd, credits_charged, quantity, unit, succeeded,
              is_retry, metadata, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            cost.id, cost.organizationId, cost.projectId, cost.sceneId, cost.renderId,
            cost.provider, cost.model, cost.operation, cost.estimatedCostUsd, cost.actualCostUsd,
            cost.creditsCharged, cost.quantity, cost.unit, cost.succeeded, cost.isRetry,
            cost.metadata, cost.createdAt,
          ],
        );
        return cost;
      }),

    listForProject: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT * FROM generation_costs WHERE project_id = $1 AND organization_id = $2 ORDER BY created_at DESC',
          [projectId, organizationId],
        );
        return r.rows.map(toCost);
      }),

    totalForProject: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query<{ total: number | null }>(
          'SELECT SUM(actual_cost_usd) AS total FROM generation_costs WHERE project_id = $1 AND organization_id = $2',
          [projectId, organizationId],
        );
        return num(r.rows[0]?.total);
      }),

    totalForOrganization: async (organizationId: string, since?: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query<{ total: number | null }>(
          `SELECT SUM(actual_cost_usd) AS total FROM generation_costs
           WHERE organization_id = $1 ${since ? 'AND created_at >= $2' : ''}`,
          since ? [organizationId, since] : [organizationId],
        );
        return num(r.rows[0]?.total);
      }),

    listSince: async (since: string, operationPrefix?: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          `SELECT * FROM generation_costs
           WHERE created_at >= $1 ${operationPrefix ? 'AND operation LIKE $2' : ''}
           ORDER BY created_at DESC LIMIT 5000`,
          operationPrefix ? [since, `${operationPrefix.replace(/[%_]/g, '')}%`] : [since],
        );
        return r.rows.map(toCost);
      }),

    dailySeries: async (since: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query<{
          day: string;
          cost: number | null;
          credits: number | null;
          calls: number;
          failures: number;
        }>(
          `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                  SUM(actual_cost_usd) AS cost,
                  SUM(credits_charged) AS credits,
                  COUNT(*)::int AS calls,
                  COUNT(*) FILTER (WHERE NOT succeeded)::int AS failures
           FROM generation_costs
           WHERE created_at >= $1
           GROUP BY 1 ORDER BY 1`,
          [since],
        );
        return r.rows.map((row) => ({
          day: row.day,
          costUsd: num(row.cost),
          creditsCharged: num(row.credits),
          calls: num(row.calls),
          failures: num(row.failures),
        }));
      }),

    platformSummary: async (since: string) =>
      this.asPlatform(async (c) => {
        const totals = await c.query<{ cost: number | null; credits: number | null }>(
          `SELECT SUM(actual_cost_usd) AS cost, SUM(credits_charged) AS credits
           FROM generation_costs WHERE created_at >= $1`,
          [since],
        );
        const byProvider = await c.query<{ provider: string; cost: number; calls: number; failures: number }>(
          `SELECT provider,
                  SUM(actual_cost_usd) AS cost,
                  COUNT(*)::int AS calls,
                  COUNT(*) FILTER (WHERE NOT succeeded)::int AS failures
           FROM generation_costs WHERE created_at >= $1
           GROUP BY provider ORDER BY cost DESC`,
          [since],
        );
        const byOperation = await c.query<{ operation: string; cost: number; calls: number }>(
          `SELECT operation, SUM(actual_cost_usd) AS cost, COUNT(*)::int AS calls
           FROM generation_costs WHERE created_at >= $1
           GROUP BY operation ORDER BY cost DESC`,
          [since],
        );
        return {
          totalCostUsd: num(totals.rows[0]?.cost),
          totalCreditsCharged: num(totals.rows[0]?.credits),
          byProvider: byProvider.rows.map((row) => ({
            provider: row.provider,
            costUsd: num(row.cost),
            calls: num(row.calls),
            failures: num(row.failures),
          })),
          byOperation: byOperation.rows.map((row) => ({
            operation: row.operation,
            costUsd: num(row.cost),
            calls: num(row.calls),
          })),
        };
      }),
  };

  // --- operations ---------------------------------------------------------

  readonly log = {
    record: async (input: OperationalEventInput) => this.writeEvent(input),

    recordSafely: (input: OperationalEventInput) => {
      /*
       * Deliberately not awaited, and deliberately swallowing. This is called
       * from failure paths — if the database is the thing that is unwell,
       * logging that fact must not replace the original error with a second
       * one, or turn a handled failure into an unhandled rejection.
       */
      void this.writeEvent(input).catch(() => undefined);
    },

    list: async (query: LogQuery = {}) =>
      this.asPlatform(async (c) => {
        const where: string[] = [];
        const params: unknown[] = [];
        /** Appends a parameter and returns its placeholder. */
        const bind = (value: unknown) => `$${params.push(value)}`;

        if (query.level) where.push(`level = ${bind(query.level)}`);
        if (query.minLevel) {
          where.push(`severity_of(level) >= severity_of(${bind(query.minLevel)})`);
        }
        if (query.source) where.push(`source = ${bind(query.source)}`);
        if (query.organizationId) where.push(`organization_id = ${bind(query.organizationId)}`);
        if (query.projectId) where.push(`project_id = ${bind(query.projectId)}`);
        if (query.jobId) where.push(`job_id = ${bind(query.jobId)}`);
        if (query.event) where.push(`event = ${bind(query.event)}`);
        if (query.since) where.push(`at >= ${bind(query.since)}`);
        if (query.search) {
          const needle = bind(`%${query.search}%`);
          where.push(`(message ILIKE ${needle} OR event ILIKE ${needle})`);
        }

        const limit = bind(Math.min(Math.max(query.limit ?? 200, 1), 1000));
        const r = await c.query(
          `SELECT * FROM operational_events
           ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY at DESC LIMIT ${limit}`,
          params,
        );
        return r.rows.map(toEvent);
      }),

    levelCounts: async (since: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query<{ level: LogLevel; count: number }>(
          'SELECT level, COUNT(*)::int AS count FROM operational_events WHERE at >= $1 GROUP BY level',
          [since],
        );
        const counts: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
        for (const row of r.rows) counts[row.level] = num(row.count);
        return counts;
      }),

    topEvents: async (since: string, limit = 8) =>
      this.asPlatform(async (c) => {
        const r = await c.query<{ event: string; level: LogLevel; count: number }>(
          `SELECT event,
                  (ARRAY_AGG(level ORDER BY severity_of(level) DESC))[1] AS level,
                  COUNT(*)::int AS count
           FROM operational_events WHERE at >= $1
           GROUP BY event ORDER BY count DESC LIMIT $2`,
          [since, limit],
        );
        return r.rows.map((row) => ({ event: row.event, level: row.level, count: num(row.count) }));
      }),

    prune: async (olderThan: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('DELETE FROM operational_events WHERE at < $1', [olderThan]);
        return r.rowCount ?? 0;
      }),
  };

  private async writeEvent(input: OperationalEventInput): Promise<OperationalEvent> {
    const event: OperationalEvent = {
      ...input,
      id: input.id ?? newId('evt'),
      at: input.at ?? new Date().toISOString(),
      message: redactMessage(input.message ?? ''),
      detail: redactDetail(input.detail ?? {}),
    };
    await this.asPlatform(async (c) => {
      await c.query(
        `INSERT INTO operational_events
           (id, at, level, source, event, message, organization_id, project_id, job_id,
            actor_user_id, duration_ms, detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          event.id, event.at, event.level, event.source, event.event, event.message,
          event.organizationId, event.projectId, event.jobId, event.actorUserId,
          event.durationMs, event.detail,
        ],
      );
    });
    return event;
  }

  // --- collaboration ------------------------------------------------------

  readonly comments = {
    create: async (comment: Comment) =>
      this.tenant(comment.organizationId, async (c) => {
        await c.query(
          `INSERT INTO comments (id, organization_id, project_id, target, target_id, author_user_id, body, at_seconds, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [comment.id, comment.organizationId, comment.projectId, comment.target, comment.targetId, comment.authorUserId, comment.body, comment.atSeconds, comment.createdAt],
        );
        return comment;
      }),

    listForTarget: async (organizationId: string, target: CommentTarget, targetId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT * FROM comments WHERE target = $1 AND target_id = $2 AND organization_id = $3 ORDER BY created_at',
          [target, targetId, organizationId],
        );
        return r.rows.map(toComment);
      }),

    listForProject: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT * FROM comments WHERE project_id = $1 AND organization_id = $2 ORDER BY created_at',
          [projectId, organizationId],
        );
        return r.rows.map(toComment);
      }),

    resolve: async (organizationId: string, id: string, userId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `UPDATE comments SET resolved_at = now(), resolved_by_user_id = $3
           WHERE id = $1 AND organization_id = $2 RETURNING *`,
          [id, organizationId, userId],
        );
        if (!r.rows[0]) throw notFound('Comment');
        return toComment(r.rows[0]);
      }),
  };

  readonly approvals = {
    create: async (approval: Approval) =>
      this.tenant(approval.organizationId, async (c) => {
        const r = await c.query(
          `INSERT INTO approvals (id, organization_id, project_id, gate, target_id, approved_by_user_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (project_id, gate, target_id) DO NOTHING
           RETURNING *`,
          [approval.id, approval.organizationId, approval.projectId, approval.gate, approval.targetId, approval.approvedByUserId, approval.createdAt],
        );
        return r.rows[0] ? toApproval(r.rows[0]) : approval;
      }),

    listForProject: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT * FROM approvals WHERE project_id = $1 AND organization_id = $2 ORDER BY created_at',
          [projectId, organizationId],
        );
        return r.rows.map(toApproval);
      }),

    has: async (organizationId: string, projectId: string, gate: ApprovalGate, targetId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT 1 FROM approvals WHERE project_id = $1 AND gate = $2 AND target_id = $3 AND organization_id = $4',
          [projectId, gate, targetId, organizationId],
        );
        return r.rows.length > 0;
      }),
  };

  readonly revisions = {
    create: async (revision: RevisionRequest, organizationId: string) =>
      this.tenant(organizationId, async (c) => {
        await c.query(
          `INSERT INTO revision_requests
             (id, organization_id, project_id, storyboard_id, author_user_id, instruction, intent,
              affected_scene_ids, applied, created_at, status, proposal, reply, decided_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            revision.id, organizationId, revision.projectId, revision.storyboardId, revision.authorUserId,
            revision.instruction, revision.intent, JSON.stringify(revision.affectedSceneIds), revision.applied,
            revision.createdAt, revision.status, revision.proposal ? JSON.stringify(revision.proposal) : null,
            revision.reply, revision.decidedAt,
          ],
        );
        return revision;
      }),

    get: async (organizationId: string, id: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT * FROM revision_requests WHERE id = $1 AND organization_id = $2',
          [id, organizationId],
        );
        return r.rows[0] ? toRevision(r.rows[0]) : null;
      }),

    update: async (
      organizationId: string,
      id: string,
      patch: Partial<Pick<RevisionRequest, 'status' | 'proposal' | 'reply' | 'decidedAt' | 'intent' | 'affectedSceneIds'>>,
    ) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `UPDATE revision_requests SET
             status = COALESCE($3, status),
             proposal = COALESCE($4, proposal),
             reply = COALESCE($5, reply),
             decided_at = COALESCE($6, decided_at),
             intent = COALESCE($7, intent),
             affected_scene_ids = COALESCE($8, affected_scene_ids)
           WHERE id = $1 AND organization_id = $2 RETURNING *`,
          [
            id, organizationId, patch.status ?? null,
            patch.proposal ? JSON.stringify(patch.proposal) : null, patch.reply ?? null,
            patch.decidedAt ?? null, patch.intent ?? null,
            patch.affectedSceneIds ? JSON.stringify(patch.affectedSceneIds) : null,
          ],
        );
        if (!r.rows[0]) throw notFound('Revision request');
        return toRevision(r.rows[0]);
      }),

    listForStoryboard: async (organizationId: string, storyboardId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT * FROM revision_requests WHERE storyboard_id = $1 AND organization_id = $2 ORDER BY created_at',
          [storyboardId, organizationId],
        );
        return r.rows.map(toRevision);
      }),

    markApplied: async (organizationId: string, id: string, affectedSceneIds: string[]) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `UPDATE revision_requests SET applied = TRUE, applied_at = now(), affected_scene_ids = $3
           WHERE id = $1 AND organization_id = $2 RETURNING *`,
          [id, organizationId, JSON.stringify(affectedSceneIds)],
        );
        if (!r.rows[0]) throw notFound('Revision request');
        return toRevision(r.rows[0]);
      }),
  };

  // --- activity and the research trail ------------------------------------

  readonly jobEvents = {
    record: async (event: JobEvent) =>
      this.tenant(event.organizationId, async (c) => {
        await c.query(
          'INSERT INTO job_events (id, organization_id, project_id, job_id, at, data) VALUES ($1,$2,$3,$4,$5,$6)',
          [event.id, event.organizationId, event.projectId, event.jobId, event.at, event],
        );
        return event;
      }),

    listForJob: async (organizationId: string, jobId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query('SELECT data FROM job_events WHERE organization_id = $1 AND job_id = $2 ORDER BY at, id', [organizationId, jobId]);
        return r.rows.map((row) => row['data'] as JobEvent);
      }),

    listForProject: async (organizationId: string, projectId: string, since?: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT data FROM job_events WHERE organization_id = $1 AND project_id = $2 ${since ? 'AND at >= $3' : ''} ORDER BY at, id LIMIT 2000`,
          since ? [organizationId, projectId, since] : [organizationId, projectId],
        );
        return r.rows.map((row) => row['data'] as JobEvent);
      }),
  };

  readonly researchSources = {
    replaceForProject: async (organizationId: string, projectId: string, sources: ResearchSource[]) =>
      this.tenant(organizationId, async (c) => {
        await c.query('DELETE FROM research_sources WHERE organization_id = $1 AND project_id = $2', [organizationId, projectId]);
        for (const source of sources) {
          await c.query(
            'INSERT INTO research_sources (id, organization_id, project_id, job_id, visited_at, data) VALUES ($1,$2,$3,$4,$5,$6)',
            [source.id, organizationId, projectId, source.jobId, source.visitedAt, { ...source, organizationId, projectId }],
          );
        }
        return sources.map((source) => ({ ...source, organizationId, projectId }));
      }),

    listForProject: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT data FROM research_sources WHERE organization_id = $1 AND project_id = $2
           ORDER BY COALESCE((data->>'position')::int, 0), visited_at, id`,
          [organizationId, projectId],
        );
        return r.rows.map((row) => row['data'] as ResearchSource);
      }),
  };

  // --- the voice --------------------------------------------------------

  readonly brandVoices = {
    create: async (voice: BrandVoice) =>
      this.tenant(voice.organizationId, async (c) => {
        await c.query(
          `INSERT INTO brand_voices (id, organization_id, consent_id, is_default, data, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [voice.id, voice.organizationId, voice.consentId, voice.isDefault, voice, voice.createdAt, voice.updatedAt],
        );
        return voice;
      }),

    get: async (organizationId: string, id: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query('SELECT data FROM brand_voices WHERE id = $1 AND organization_id = $2', [id, organizationId]);
        return (r.rows[0]?.['data'] as BrandVoice) ?? null;
      }),

    list: async (organizationId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT data FROM brand_voices WHERE organization_id = $1 ORDER BY is_default DESC, created_at',
          [organizationId],
        );
        return r.rows.map((row) => row['data'] as BrandVoice);
      }),

    update: async (organizationId: string, id: string, patch: Partial<BrandVoice>) =>
      this.tenant(organizationId, async (c) => {
        const current = await c.query('SELECT data FROM brand_voices WHERE id = $1 AND organization_id = $2 FOR UPDATE', [id, organizationId]);
        if (!current.rows[0]) throw notFound('Brand voice');
        const next: BrandVoice = {
          ...(current.rows[0]['data'] as BrandVoice),
          ...patch,
          id,
          organizationId,
          updatedAt: new Date().toISOString(),
        };
        await c.query(
          'UPDATE brand_voices SET data = $3, consent_id = $4, is_default = $5, updated_at = $6 WHERE id = $1 AND organization_id = $2',
          [id, organizationId, next, next.consentId, next.isDefault, next.updatedAt],
        );
        return next;
      }),

    setDefault: async (organizationId: string, id: string) =>
      this.tenant(organizationId, async (c) => {
        const chosen = await c.query('SELECT data FROM brand_voices WHERE id = $1 AND organization_id = $2', [id, organizationId]);
        if (!chosen.rows[0]) throw notFound('Brand voice');
        await c.query(
          `UPDATE brand_voices SET is_default = FALSE, data = data || '{"isDefault": false}'::jsonb WHERE organization_id = $1 AND id <> $2 AND is_default`,
          [organizationId, id],
        );
        const now = new Date().toISOString();
        const next: BrandVoice = { ...(chosen.rows[0]['data'] as BrandVoice), isDefault: true, updatedAt: now };
        await c.query('UPDATE brand_voices SET is_default = TRUE, data = $3, updated_at = $4 WHERE id = $1 AND organization_id = $2', [id, organizationId, next, now]);
        return next;
      }),

    remove: async (organizationId: string, id: string) =>
      this.tenant(organizationId, async (c) => {
        await c.query('DELETE FROM brand_voices WHERE id = $1 AND organization_id = $2', [id, organizationId]);
      }),
  };

  readonly voiceConsents = {
    create: async (consent: VoiceConsentRecord) =>
      this.tenant(consent.organizationId, async (c) => {
        await c.query(
          `INSERT INTO voice_consents
             (id, organization_id, project_id, subject_name, granted_by_user_id, scope, provider_voice_id, granted_at, revoked_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            consent.id, consent.organizationId, consent.projectId, consent.subjectName, consent.grantedByUserId,
            consent.scope, consent.providerVoiceId, consent.grantedAt, consent.revokedAt,
          ],
        );
        return consent;
      }),

    get: async (organizationId: string, id: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query('SELECT * FROM voice_consents WHERE id = $1 AND organization_id = $2', [id, organizationId]);
        return r.rows[0] ? toVoiceConsent(r.rows[0]) : null;
      }),

    list: async (organizationId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query('SELECT * FROM voice_consents WHERE organization_id = $1 ORDER BY granted_at DESC', [organizationId]);
        return r.rows.map(toVoiceConsent);
      }),

    revoke: async (organizationId: string, id: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'UPDATE voice_consents SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 AND organization_id = $2 RETURNING *',
          [id, organizationId],
        );
        if (!r.rows[0]) throw notFound('Voice consent');
        return toVoiceConsent(r.rows[0]);
      }),

    setProviderVoice: async (organizationId: string, id: string, providerVoiceId: string | null) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'UPDATE voice_consents SET provider_voice_id = $3 WHERE id = $1 AND organization_id = $2 RETURNING *',
          [id, organizationId, providerVoiceId],
        );
        if (!r.rows[0]) throw notFound('Voice consent');
        return toVoiceConsent(r.rows[0]);
      }),
  };

  readonly voiceSettings = {
    get: async (organizationId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query('SELECT data FROM voice_settings WHERE organization_id = $1', [organizationId]);
        return (r.rows[0]?.['data'] as VoiceSettings) ?? null;
      }),

    save: async (settings: VoiceSettings) =>
      this.tenant(settings.organizationId, async (c) => {
        await c.query(
          `INSERT INTO voice_settings (organization_id, data, updated_at) VALUES ($1,$2,$3)
           ON CONFLICT (organization_id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
          [settings.organizationId, settings, settings.updatedAt],
        );
        return settings;
      }),
  };

  readonly audioEditions = {
    create: async (edition: AudioEdition) =>
      this.tenant(edition.organizationId, async (c) => {
        await c.query(
          `INSERT INTO audio_editions (id, organization_id, project_id, status, data, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
          [edition.id, edition.organizationId, edition.projectId, edition.status, edition, edition.createdAt],
        );
        return edition;
      }),

    get: async (organizationId: string, id: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query('SELECT data FROM audio_editions WHERE id = $1 AND organization_id = $2', [id, organizationId]);
        return (r.rows[0]?.['data'] as AudioEdition) ?? null;
      }),

    listForProject: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT data FROM audio_editions WHERE organization_id = $1 AND project_id = $2 ORDER BY created_at DESC',
          [organizationId, projectId],
        );
        return r.rows.map((row) => row['data'] as AudioEdition);
      }),

    update: async (organizationId: string, id: string, patch: Partial<AudioEdition>) =>
      this.tenant(organizationId, async (c) => {
        const current = await c.query('SELECT data FROM audio_editions WHERE id = $1 AND organization_id = $2 FOR UPDATE', [id, organizationId]);
        if (!current.rows[0]) throw notFound('Audio edition');
        const next: AudioEdition = { ...(current.rows[0]['data'] as AudioEdition), ...patch, id, organizationId };
        await c.query('UPDATE audio_editions SET data = $3, status = $4 WHERE id = $1 AND organization_id = $2', [id, organizationId, next, next.status]);
        return next;
      }),
  };

  readonly credentials = {
    create: async (credential: ProductCredential, ciphertext: unknown) =>
      this.tenant(credential.organizationId, async (c) => {
        await c.query(
          `INSERT INTO product_credentials
             (id, organization_id, project_id, kind, login_url, username, secret_ciphertext,
              authorized_by_user_id, authorized_at, allowed_paths, denied_paths, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            credential.id, credential.organizationId, credential.projectId, credential.kind,
            credential.loginUrl, credential.username, ciphertext, credential.authorizedByUserId,
            credential.authorizedAt, JSON.stringify(credential.allowedPaths),
            JSON.stringify(credential.deniedPaths), credential.createdAt,
          ],
        );
        return credential;
      }),

    getForProject: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT id, organization_id, project_id, kind, login_url, username, authorized_by_user_id,
                  authorized_at, allowed_paths, denied_paths, revoked_at, last_used_at, created_at
           FROM product_credentials
           WHERE project_id = $1 AND organization_id = $2 AND revoked_at IS NULL`,
          [projectId, organizationId],
        );
        return r.rows[0] ? toCredential(r.rows[0]) : null;
      }),

    getCiphertext: async (organizationId: string, credentialId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT secret_ciphertext FROM product_credentials
           WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL`,
          [credentialId, organizationId],
        );
        return r.rows[0]?.['secret_ciphertext'] ?? null;
      }),

    revoke: async (organizationId: string, credentialId: string) =>
      this.tenant(organizationId, async (c) => {
        // Revocation destroys the sealed secret. "Revoked" has to mean the
        // material is gone, not merely flagged.
        const r = await c.query(
          `UPDATE product_credentials SET revoked_at = now(), secret_ciphertext = 'null'::jsonb
           WHERE id = $1 AND organization_id = $2`,
          [credentialId, organizationId],
        );
        if ((r.rowCount ?? 0) === 0) throw notFound('Credential');
      }),

    touch: async (organizationId: string, credentialId: string) =>
      this.tenant(organizationId, async (c) => {
        await c.query(
          'UPDATE product_credentials SET last_used_at = now() WHERE id = $1 AND organization_id = $2',
          [credentialId, organizationId],
        );
      }),

    audit: async (event: CredentialAuditEvent) =>
      this.tenant(event.organizationId, async (c) => {
        await c.query(
          `INSERT INTO credential_audit_events (id, organization_id, project_id, credential_id, action, detail, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            event.id, event.organizationId, event.projectId, event.credentialId, event.action,
            // Flattened here rather than at each call site: these details are
            // quoted from libraries that write for a terminal, and the customer
            // reads them.
            redactMessage(plainText(event.detail)),
            event.createdAt,
          ],
        );
      }),

    listAudit: async (organizationId: string, credentialId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT * FROM credential_audit_events WHERE credential_id = $1 AND organization_id = $2 ORDER BY created_at DESC',
          [credentialId, organizationId],
        );
        return r.rows.map((row) => ({
          id: row['id'] as string,
          credentialId: row['credential_id'] as string,
          organizationId: row['organization_id'] as string,
          projectId: row['project_id'] as string,
          action: row['action'] as CredentialAuditEvent['action'],
          detail: row['detail'] as string,
          createdAt: iso(row['created_at']),
        }));
      }),
  };

  readonly invites = {
    create: async (code: InviteCode) =>
      this.asPlatform(async (c) => {
        try {
          await c.query(
            `INSERT INTO invite_codes (id, code, kind, note, max_uses, uses, expires_at, created_by_user_id, owner_user_id, created_at, revoked_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [code.id, code.code, code.kind, code.note, code.maxUses, code.uses, code.expiresAt, code.createdByUserId, code.ownerUserId, code.createdAt, code.revokedAt],
          );
        } catch (error) {
          if ((error as { code?: string }).code === '23505') throw new AppError('conflict', 'That code already exists.');
          throw error;
        }
        return code;
      }),

    get: async (id: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM invite_codes WHERE id = $1', [id]);
        return r.rows[0] ? toInviteCode(r.rows[0]) : null;
      }),

    getByCode: async (code: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM invite_codes WHERE code = $1', [code]);
        return r.rows[0] ? toInviteCode(r.rows[0]) : null;
      }),

    list: async (query: { kind?: InviteCodeKind; ownerUserId?: string; limit?: number } = {}) =>
      this.asPlatform(async (c) => {
        const where: string[] = [];
        const params: unknown[] = [];
        const bind = (value: unknown) => `$${params.push(value)}`;
        if (query.kind) where.push(`kind = ${bind(query.kind)}`);
        if (query.ownerUserId) where.push(`owner_user_id = ${bind(query.ownerUserId)}`);
        const r = await c.query(
          `SELECT * FROM invite_codes ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY created_at DESC LIMIT ${Math.min(Math.max(query.limit ?? 200, 1), 1000)}`,
          params,
        );
        return r.rows.map(toInviteCode);
      }),

    redeem: async (codeId: string, userId: string, now = new Date().toISOString()) =>
      this.asPlatform(async (c) => {
        // The same person twice is not a second use.
        const seen = await c.query('SELECT 1 FROM invite_redemptions WHERE code_id = $1 AND user_id = $2', [codeId, userId]);
        if (seen.rows[0]) return false;
        // One statement decides: the conditions and the increment are the
        // same row lock, so two people racing for the last use get one each.
        const r = await c.query(
          `UPDATE invite_codes SET uses = uses + 1
           WHERE id = $1 AND revoked_at IS NULL
             AND (expires_at IS NULL OR expires_at > $2)
             AND (max_uses IS NULL OR uses < max_uses)
           RETURNING id`,
          [codeId, now],
        );
        if (!r.rows[0]) return false;
        await c.query('INSERT INTO invite_redemptions (code_id, user_id, at) VALUES ($1, $2, $3)', [codeId, userId, now]);
        return true;
      }),

    revoke: async (id: string) =>
      this.asPlatform(async (c) => {
        await c.query('UPDATE invite_codes SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [id]);
      }),

    listRedemptions: async (codeId: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM invite_redemptions WHERE code_id = $1 ORDER BY at', [codeId]);
        return r.rows.map(toRedemption);
      }),

    redemptionFor: async (userId: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM invite_redemptions WHERE user_id = $1 ORDER BY at LIMIT 1', [userId]);
        return r.rows[0] ? toRedemption(r.rows[0]) : null;
      }),
  };

  readonly applications = {
    create: async (application: BetaApplication) =>
      this.asPlatform(async (c) => {
        await c.query(
          `INSERT INTO beta_applications (id, email, name, company, website, message, status, invite_code_id, note, created_at, decided_at, decided_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            application.id, application.email, application.name, application.company, application.website, application.message,
            application.status, application.inviteCodeId, application.note, application.createdAt, application.decidedAt, application.decidedByUserId,
          ],
        );
        return application;
      }),

    get: async (id: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM beta_applications WHERE id = $1', [id]);
        return r.rows[0] ? toApplication(r.rows[0]) : null;
      }),

    getByEmail: async (email: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM beta_applications WHERE lower(email) = lower($1) ORDER BY created_at DESC LIMIT 1', [email.trim()]);
        return r.rows[0] ? toApplication(r.rows[0]) : null;
      }),

    list: async (query: { status?: BetaApplicationStatus; limit?: number } = {}) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          `SELECT * FROM beta_applications ${query.status ? 'WHERE status = $1' : ''}
           ORDER BY created_at DESC LIMIT ${Math.min(Math.max(query.limit ?? 200, 1), 1000)}`,
          query.status ? [query.status] : [],
        );
        return r.rows.map(toApplication);
      }),

    update: async (id: string, patch: Partial<BetaApplication>) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          `UPDATE beta_applications SET
             status = COALESCE($2, status),
             invite_code_id = COALESCE($3, invite_code_id),
             note = COALESCE($4, note),
             decided_at = COALESCE($5, decided_at),
             decided_by_user_id = COALESCE($6, decided_by_user_id)
           WHERE id = $1 RETURNING *`,
          [id, patch.status ?? null, patch.inviteCodeId ?? null, patch.note ?? null, patch.decidedAt ?? null, patch.decidedByUserId ?? null],
        );
        if (!r.rows[0]) throw notFound('Application');
        return toApplication(r.rows[0]);
      }),

    countByStatus: async () =>
      this.asPlatform(async (c) => {
        const r = await c.query<{ status: string; count: number }>('SELECT status, COUNT(*)::int AS count FROM beta_applications GROUP BY status');
        return Object.fromEntries(r.rows.map((row) => [row.status, num(row.count)]));
      }),
  };

  readonly platform = {
    getSettings: async (): Promise<PlatformSettings> =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM platform_settings WHERE id = $1', ['singleton']);
        const row = r.rows[0];
        return {
          providerConfig: (row?.['provider_config'] as Record<string, unknown>) ?? {},
          plans: (row?.['plans'] as unknown[]) ?? [],
          featureFlags: (row?.['feature_flags'] as Record<string, boolean>) ?? {},
          creativeBudget: (row?.['creative_budget'] as Record<string, unknown>) ?? {},
          product: (row?.['product'] as Record<string, unknown>) ?? {},
          updatedAt: row ? iso(row['updated_at']) : new Date().toISOString(),
        };
      }),

    updateSettings: async (patch: Partial<PlatformSettings>, updatedBy: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          `INSERT INTO platform_settings (id, provider_config, plans, feature_flags, creative_budget, product, updated_at, updated_by)
           VALUES ('singleton', COALESCE($1, '{}'::jsonb), COALESCE($2, '[]'::jsonb), COALESCE($3, '{}'::jsonb), COALESCE($4, '{}'::jsonb), COALESCE($6, '{}'::jsonb), now(), $5)
           ON CONFLICT (id) DO UPDATE SET
             provider_config = COALESCE($1, platform_settings.provider_config),
             plans = COALESCE($2, platform_settings.plans),
             feature_flags = COALESCE($3, platform_settings.feature_flags),
             creative_budget = COALESCE($4, platform_settings.creative_budget),
             product = COALESCE($6, platform_settings.product),
             updated_at = now(), updated_by = $5
           RETURNING *`,
          [
            patch.providerConfig ?? null,
            patch.plans ? JSON.stringify(patch.plans) : null,
            patch.featureFlags ?? null,
            patch.creativeBudget ?? null,
            updatedBy,
            patch.product ?? null,
          ],
        );
        const row = r.rows[0]!;
        return {
          providerConfig: row['provider_config'] as Record<string, unknown>,
          plans: row['plans'] as unknown[],
          featureFlags: row['feature_flags'] as Record<string, boolean>,
          creativeBudget: row['creative_budget'] as Record<string, unknown>,
          product: (row['product'] as Record<string, unknown>) ?? {},
          updatedAt: iso(row['updated_at']),
        };
      }),

    setProviderSecret: async (provider: string, ciphertext: unknown, fingerprint: string, updatedBy: string) =>
      this.asPlatform(async (c) => {
        await c.query(
          `INSERT INTO provider_secrets (provider, ciphertext, fingerprint, updated_at, updated_by)
           VALUES ($1,$2,$3,now(),$4)
           ON CONFLICT (provider) DO UPDATE SET
             ciphertext = EXCLUDED.ciphertext, fingerprint = EXCLUDED.fingerprint,
             updated_at = now(), updated_by = EXCLUDED.updated_by`,
          [provider, ciphertext, fingerprint, updatedBy],
        );
      }),

    getProviderSecret: async (provider: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM provider_secrets WHERE provider = $1', [provider]);
        if (!r.rows[0]) return null;
        return {
          ciphertext: r.rows[0]['ciphertext'],
          fingerprint: r.rows[0]['fingerprint'] as string,
          enabled: Boolean(r.rows[0]['enabled']),
        };
      }),

    listProviderSecrets: async () =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT provider, fingerprint, enabled, updated_at FROM provider_secrets ORDER BY provider');
        return r.rows.map((row) => ({
          provider: row['provider'] as string,
          fingerprint: row['fingerprint'] as string,
          enabled: Boolean(row['enabled']),
          updatedAt: iso(row['updated_at']),
        }));
      }),

    recordStripeEvent: async (id: string, type: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          'INSERT INTO stripe_events (id, type) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING RETURNING id',
          [id, type],
        );
        return r.rows.length > 0;
      }),
  };
}

// --- row mappers ----------------------------------------------------------

async function insertScenes(
  c: QueryClient,
  organizationId: string,
  storyboardId: string,
  scenes: Scene[],
): Promise<void> {
  for (const scene of scenes) {
    await c.query(
      `INSERT INTO scenes
         (id, organization_id, storyboard_id, scene_index, start_time, duration, visual_type, status, estimated_cost_usd, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        scene.id, organizationId, storyboardId, scene.index, scene.startTime, scene.duration,
        scene.visualType, scene.status, scene.estimatedCostUsd, { ...scene, storyboardId },
      ],
    );
  }
}

async function loadScenes(c: QueryClient, organizationId: string, storyboardId: string): Promise<Scene[]> {
  const r = await c.query(
    'SELECT data FROM scenes WHERE storyboard_id = $1 AND organization_id = $2 ORDER BY scene_index',
    [storyboardId, organizationId],
  );
  return r.rows.map((row) => row['data'] as Scene);
}

function toOrganization(row: Row): Organization {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    slug: row['slug'] as string,
    planId: row['plan_id'] as string,
    stripeCustomerId: (row['stripe_customer_id'] as string) ?? null,
    creditBalance: num(row['credit_balance']),
    maxProjectCostUsd: num(row['max_project_cost_usd']),
    isSuspended: Boolean(row['is_suspended']),
    createdAt: iso(row['created_at']),
  };
}

function toUser(row: Row): User {
  return {
    id: row['id'] as string,
    email: row['email'] as string,
    name: (row['name'] as string) ?? '',
    avatarUrl: (row['avatar_url'] as string) ?? null,
    isSuperAdmin: Boolean(row['is_super_admin']),
    createdAt: iso(row['created_at']),
  };
}

function toMembership(row: Row): Membership {
  return {
    id: row['id'] as string,
    organizationId: row['organization_id'] as string,
    userId: row['user_id'] as string,
    role: row['role'] as MemberRole,
    createdAt: iso(row['created_at']),
  };
}

function toSubscription(row: Row): Subscription {
  return {
    id: row['id'] as string,
    organizationId: row['organization_id'] as string,
    planId: row['plan_id'] as string,
    status: row['status'] as Subscription['status'],
    stripeSubscriptionId: (row['stripe_subscription_id'] as string) ?? null,
    stripeCustomerId: (row['stripe_customer_id'] as string) ?? null,
    currentPeriodEnd: isoOrNull(row['current_period_end']),
    cancelAtPeriodEnd: Boolean(row['cancel_at_period_end']),
    seats: num(row['seats']),
    createdAt: iso(row['created_at']),
    updatedAt: iso(row['updated_at']),
  };
}

function toProject(row: Row): Project {
  return {
    id: row['id'] as string,
    organizationId: row['organization_id'] as string,
    createdByUserId: row['created_by_user_id'] as string,
    name: row['name'] as string,
    websiteUrl: row['website_url'] as string,
    supplementalUrls: (row['supplemental_urls'] as string[]) ?? [],
    brandId: (row['brand_id'] as string) ?? null,
    productUnderstandingId: (row['product_understanding_id'] as string) ?? null,
    selectedConceptId: (row['selected_concept_id'] as string) ?? null,
    activeStoryboardId: (row['active_storyboard_id'] as string) ?? null,
    latestRenderId: (row['latest_render_id'] as string) ?? null,
    stage: row['stage'] as ProjectStage,
    brief: row['brief'] as Project['brief'],
    productCredentialId: (row['product_credential_id'] as string) ?? null,
    costUsd: num(row['cost_usd']),
    creditsSpent: num(row['credits_spent']),
    archivedAt: isoOrNull(row['archived_at']),
    createdAt: iso(row['created_at']),
    updatedAt: iso(row['updated_at']),
  };
}

function toStoryboard(row: Row, scenes: Scene[]): Storyboard {
  return resequence({
    id: row['id'] as string,
    projectId: row['project_id'] as string,
    conceptId: row['concept_id'] as string,
    treatmentId: row['treatment_id'] as string,
    version: num(row['version']),
    scenes,
    voiceStrategy: row['voice_strategy'] as Storyboard['voiceStrategy'],
    language: (row['language'] as string | null) ?? null,
    musicDirection: (row['music_direction'] as string) ?? '',
    status: row['status'] as Storyboard['status'],
    createdAt: iso(row['created_at']),
    updatedAt: iso(row['updated_at']),
  });
}

/**
 * A brand as stored, brought up to the current shape.
 *
 * Brands are documents, and a document written before a field existed has
 * no value for it. Parsing on the way out fills every default, so a brand
 * measured last month reads exactly like one measured today.
 */
function brandFromRow(data: unknown): BrandSystem {
  return BrandSystemSchema.parse(data);
}

function toInviteCode(row: Row): InviteCode {
  return {
    id: row['id'] as string,
    code: row['code'] as string,
    kind: row['kind'] as InviteCode['kind'],
    note: (row['note'] as string) ?? '',
    maxUses: row['max_uses'] === null ? null : num(row['max_uses']),
    uses: num(row['uses']),
    expiresAt: row['expires_at'] ? iso(row['expires_at']) : null,
    createdByUserId: (row['created_by_user_id'] as string) ?? null,
    ownerUserId: (row['owner_user_id'] as string) ?? null,
    createdAt: iso(row['created_at']),
    revokedAt: row['revoked_at'] ? iso(row['revoked_at']) : null,
  };
}

function toRedemption(row: Row): InviteRedemption {
  return { codeId: row['code_id'] as string, userId: row['user_id'] as string, at: iso(row['at']) };
}

function toApplication(row: Row): BetaApplication {
  return {
    id: row['id'] as string,
    email: row['email'] as string,
    name: (row['name'] as string) ?? '',
    company: (row['company'] as string) ?? '',
    website: (row['website'] as string) ?? null,
    message: (row['message'] as string) ?? '',
    status: row['status'] as BetaApplication['status'],
    inviteCodeId: (row['invite_code_id'] as string) ?? null,
    note: (row['note'] as string) ?? '',
    createdAt: iso(row['created_at']),
    decidedAt: row['decided_at'] ? iso(row['decided_at']) : null,
    decidedByUserId: (row['decided_by_user_id'] as string) ?? null,
  };
}

function toAsset(row: Row): Asset {
  return {
    id: row['id'] as string,
    organizationId: row['organization_id'] as string,
    projectId: (row['project_id'] as string) ?? null,
    conceptId: (row['concept_id'] as string) ?? null,
    sceneId: (row['scene_id'] as string) ?? null,
    kind: row['kind'] as Asset['kind'],
    origin: row['origin'] as Asset['origin'],
    rights: row['rights'] as Asset['rights'],
    storageKey: row['storage_key'] as string,
    contentType: row['content_type'] as string,
    bytes: num(row['bytes']),
    width: row['width'] === null ? null : num(row['width']),
    height: row['height'] === null ? null : num(row['height']),
    durationSeconds: row['duration_seconds'] === null ? null : num(row['duration_seconds']),
    checksum: (row['checksum'] as string) ?? null,
    provider: (row['provider'] as string) ?? null,
    model: (row['model'] as string) ?? null,
    sourceUrl: (row['source_url'] as string) ?? null,
    costUsd: num(row['cost_usd']),
    metadata: (row['metadata'] as Record<string, unknown>) ?? {},
    createdAt: iso(row['created_at']),
    library: Boolean(row['library']),
    name: (row['name'] as string) ?? '',
    category: (row['category'] as Asset['category']) ?? 'other',
    categorySource: (row['category_source'] as Asset['categorySource']) ?? 'none',
    description: (row['description'] as string) ?? '',
    tags: Array.isArray(row['tags']) ? (row['tags'] as string[]) : [],
    favorite: Boolean(row['favorite']),
    approved: Boolean(row['approved']),
    parentAssetId: (row['parent_asset_id'] as string) ?? null,
    uploadedByUserId: (row['uploaded_by_user_id'] as string) ?? null,
    source: (row['source'] as Asset['source']) ?? 'pipeline',
  };
}

/**
 * Attaches an asset to projects it is not yet attached to. The project must
 * be the tenant's own: the foreign key allows any project, the policy on
 * `projects` does not, and this reads the row first so a foreign id is
 * "not found" rather than a constraint error naming a real row.
 */
async function attachProjects(c: QueryClient, organizationId: string, assetId: string, projectIds: string[]): Promise<void> {
  for (const projectId of new Set(projectIds)) {
    const project = await c.query('SELECT 1 FROM projects WHERE id = $1 AND organization_id = $2', [projectId, organizationId]);
    if (!project.rows[0]) throw notFound('Project');
    await c.query(
      `INSERT INTO asset_projects (asset_id, project_id, organization_id) VALUES ($1, $2, $3)
       ON CONFLICT (asset_id, project_id) DO NOTHING`,
      [assetId, projectId, organizationId],
    );
  }
}

function toRender(row: Row): Render {
  return {
    id: row['id'] as string,
    projectId: row['project_id'] as string,
    storyboardId: row['storyboard_id'] as string,
    organizationId: row['organization_id'] as string,
    kind: (row['kind'] as Render['kind']) ?? 'film',
    version: num(row['version']),
    aspect: row['aspect'] as Render['aspect'],
    quality: row['quality'] as Render['quality'],
    fps: num(row['fps']),
    status: row['status'] as Render['status'],
    masterAssetId: (row['master_asset_id'] as string) ?? null,
    posterAssetId: (row['poster_asset_id'] as string) ?? null,
    watermarked: Boolean(row['watermarked']),
    durationSeconds: num(row['duration_seconds']),
    costUsd: num(row['cost_usd']),
    qaReportId: (row['qa_report_id'] as string) ?? null,
    error: (row['error'] as string) ?? null,
    startedAt: isoOrNull(row['started_at']),
    completedAt: isoOrNull(row['completed_at']),
    createdAt: iso(row['created_at']),
  };
}

function toVariant(row: Row): Variant {
  return {
    id: row['id'] as string,
    renderId: row['render_id'] as string,
    projectId: row['project_id'] as string,
    purpose: row['purpose'] as Variant['purpose'],
    aspect: row['aspect'] as Variant['aspect'],
    durationSeconds: num(row['duration_seconds']),
    sceneIds: (row['scene_ids'] as string[]) ?? [],
    audioStem: row['audio_stem'] as Variant['audioStem'],
    captionsBurned: Boolean(row['captions_burned']),
    assetId: (row['asset_id'] as string) ?? null,
    status: row['status'] as Variant['status'],
    costUsd: num(row['cost_usd']),
    createdAt: iso(row['created_at']),
  };
}

function toJob(row: Row): Job {
  return {
    id: row['id'] as string,
    organizationId: row['organization_id'] as string,
    projectId: (row['project_id'] as string) ?? null,
    kind: row['kind'] as Job['kind'],
    state: row['state'] as JobState,
    payload: (row['payload'] as Record<string, unknown>) ?? {},
    progress: num(row['progress']),
    statusMessage: (row['status_message'] as string) ?? '',
    attempts: num(row['attempts']),
    maxAttempts: num(row['max_attempts']),
    lastError: (row['last_error'] as string) ?? null,
    runAfter: iso(row['run_after']),
    lockedBy: (row['locked_by'] as string) ?? null,
    lockedAt: isoOrNull(row['locked_at']),
    startedAt: isoOrNull(row['started_at']),
    priority: num(row['priority']),
    createdAt: iso(row['created_at']),
    updatedAt: iso(row['updated_at']),
  };
}

function toCost(row: Row): GenerationCost {
  return {
    id: row['id'] as string,
    organizationId: row['organization_id'] as string,
    projectId: (row['project_id'] as string) ?? null,
    sceneId: (row['scene_id'] as string) ?? null,
    renderId: (row['render_id'] as string) ?? null,
    provider: row['provider'] as string,
    model: (row['model'] as string) ?? null,
    operation: row['operation'] as GenerationCost['operation'],
    estimatedCostUsd: num(row['estimated_cost_usd']),
    actualCostUsd: num(row['actual_cost_usd']),
    creditsCharged: num(row['credits_charged']),
    quantity: num(row['quantity']),
    unit: row['unit'] as string,
    succeeded: Boolean(row['succeeded']),
    isRetry: Boolean(row['is_retry']),
    metadata: (row['metadata'] as Record<string, unknown>) ?? {},
    createdAt: iso(row['created_at']),
  };
}

function toCopyKit(row: Row): CopyKit {
  return {
    id: row['id'] as string,
    organizationId: row['organization_id'] as string,
    projectId: row['project_id'] as string,
    conceptId: row['concept_id'] as string,
    lines: (row['lines'] as CopyKit['lines']) ?? [],
    createdAt: iso(row['created_at']),
  };
}

function toInvitation(row: Row): Invitation {
  return {
    id: row['id'] as string,
    organizationId: row['organization_id'] as string,
    email: row['email'] as string,
    role: row['role'] as Invitation['role'],
    tokenHash: row['token_hash'] as string,
    invitedByUserId: row['invited_by'] as string,
    acceptedAt: row['accepted_at'] ? iso(row['accepted_at']) : null,
    expiresAt: iso(row['expires_at']),
    createdAt: iso(row['created_at']),
  };
}

function toEvent(row: Row): OperationalEvent {
  return {
    id: row['id'] as string,
    at: iso(row['at']),
    level: row['level'] as OperationalEvent['level'],
    source: row['source'] as OperationalEvent['source'],
    event: row['event'] as string,
    message: (row['message'] as string) ?? '',
    organizationId: (row['organization_id'] as string) ?? null,
    projectId: (row['project_id'] as string) ?? null,
    jobId: (row['job_id'] as string) ?? null,
    actorUserId: (row['actor_user_id'] as string) ?? null,
    durationMs: row['duration_ms'] === null || row['duration_ms'] === undefined ? null : num(row['duration_ms']),
    detail: (row['detail'] as Record<string, unknown>) ?? {},
  };
}

function toComment(row: Row): Comment {
  return {
    id: row['id'] as string,
    organizationId: row['organization_id'] as string,
    projectId: row['project_id'] as string,
    target: row['target'] as CommentTarget,
    targetId: row['target_id'] as string,
    authorUserId: row['author_user_id'] as string,
    body: row['body'] as string,
    atSeconds: row['at_seconds'] === null ? null : num(row['at_seconds']),
    resolvedAt: isoOrNull(row['resolved_at']),
    resolvedByUserId: (row['resolved_by_user_id'] as string) ?? null,
    createdAt: iso(row['created_at']),
  };
}

function toApproval(row: Row): Approval {
  return {
    id: row['id'] as string,
    organizationId: row['organization_id'] as string,
    projectId: row['project_id'] as string,
    gate: row['gate'] as ApprovalGate,
    targetId: row['target_id'] as string,
    approvedByUserId: row['approved_by_user_id'] as string,
    createdAt: iso(row['created_at']),
  };
}

function toVoiceConsent(row: Row): VoiceConsentRecord {
  return {
    id: row['id'] as string,
    organizationId: row['organization_id'] as string,
    projectId: (row['project_id'] as string) ?? null,
    subjectName: row['subject_name'] as string,
    grantedByUserId: row['granted_by_user_id'] as string,
    scope: (row['scope'] as VoiceConsentRecord['scope']) ?? 'organization',
    providerVoiceId: (row['provider_voice_id'] as string) ?? null,
    grantedAt: iso(row['granted_at']),
    revokedAt: isoOrNull(row['revoked_at']),
  };
}

function toRevision(row: Row): RevisionRequest {
  return {
    id: row['id'] as string,
    projectId: row['project_id'] as string,
    storyboardId: row['storyboard_id'] as string,
    authorUserId: row['author_user_id'] as string,
    instruction: row['instruction'] as string,
    intent: row['intent'] as RevisionRequest['intent'],
    affectedSceneIds: (row['affected_scene_ids'] as string[]) ?? [],
    applied: Boolean(row['applied']),
    appliedAt: isoOrNull(row['applied_at']),
    status: (row['status'] as RevisionRequest['status']) ?? (row['applied'] ? 'applied' : 'confirmed'),
    proposal: (row['proposal'] as RevisionRequest['proposal']) ?? null,
    reply: (row['reply'] as string) ?? '',
    decidedAt: isoOrNull(row['decided_at']),
    createdAt: iso(row['created_at']),
  };
}

function toCredential(row: Row): ProductCredential {
  return {
    id: row['id'] as string,
    organizationId: row['organization_id'] as string,
    projectId: row['project_id'] as string,
    kind: row['kind'] as ProductCredential['kind'],
    loginUrl: row['login_url'] as string,
    username: (row['username'] as string) ?? null,
    secretRef: row['id'] as string,
    authorizedByUserId: row['authorized_by_user_id'] as string,
    authorizedAt: iso(row['authorized_at']),
    allowedPaths: (row['allowed_paths'] as string[]) ?? [],
    deniedPaths: (row['denied_paths'] as string[]) ?? [],
    revokedAt: isoOrNull(row['revoked_at']),
    lastUsedAt: isoOrNull(row['last_used_at']),
    createdAt: iso(row['created_at']),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
