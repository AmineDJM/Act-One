import {
  CreativePreference,
  CreativeSignature,
  CreativeTerritory,
  CriticReview,
  DirectorDecision,
} from '@act-one/core';
import { Article as ArticleSchema, ArticleTopic as ArticleTopicSchema, Asset as AssetSchema, Benchmark as BenchmarkSchema, BrandSystem as BrandSystemSchema, CollectionEntry as CollectionEntrySchema, CreativeReplan as CreativeReplanSchema, QaReport as QaReportSchema, Render as RenderSchema, Referral as ReferralSchema } from '@act-one/core';
import { z } from 'zod';
import {
  AppError,
  Entitlement,
  newId,
  notFound,
  PlanLimitGrants,
  plainText,
  redactDetail,
  redactMessage,
  resequence,
  verdictFor,
  windowStartMs,
  type RateLimitRule,
} from '@act-one/core';
import type {
  Benchmark,
  CreativeReplan,
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
  QaReport,
  ProjectStage,
  Render,
  RenderInput,
  ResearchSource,
  RevisionRequest,
  Scene,
  Storyboard,
  CreditLedgerEntry,
  CreditMovement,
  CreditPosting,
  Payment,
  Subscription,
  User,
  Variant,
  VoiceConsentRecord,
  VoiceSettings,
} from '@act-one/core';
import { Database, type QueryClient } from './client.ts';
import type { ArticleQuery, AssetProjectLink, BenchmarkQuery, CollectionQuery, JobQuery, LibraryFilter, PlatformSettings, ReferralQuery, Store } from './store.ts';

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
    create: async (org: NewOrganization): Promise<Organization> =>
      this.asPlatform(async (c) => {
        const result = await c.query(
          `INSERT INTO organizations
             (id, name, slug, plan_id, stripe_customer_id, credit_balance, max_project_cost_usd,
              is_suspended, limit_overrides, extra_entitlements, is_internal, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
            JSON.stringify(org.limitOverrides ?? {}),
            JSON.stringify(org.extraEntitlements ?? []),
            org.isInternal ?? false,
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
             is_suspended = COALESCE($7, is_suspended),
             limit_overrides = COALESCE($8, limit_overrides),
             extra_entitlements = COALESCE($9, extra_entitlements),
             is_internal = COALESCE($10, is_internal)
           WHERE id = $1 RETURNING *`,
          [
            id,
            patch.name ?? null,
            patch.planId ?? null,
            patch.stripeCustomerId ?? null,
            patch.creditBalance ?? null,
            patch.maxProjectCostUsd ?? null,
            patch.isSuspended ?? null,
            patch.limitOverrides ? JSON.stringify(patch.limitOverrides) : null,
            patch.extraEntitlements ? JSON.stringify(patch.extraEntitlements) : null,
            patch.isInternal ?? null,
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
              current_period_end, cancel_at_period_end, seats, billing_interval,
              allowance_granted_through, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (organization_id) DO UPDATE SET
             plan_id = EXCLUDED.plan_id,
             status = EXCLUDED.status,
             stripe_subscription_id = EXCLUDED.stripe_subscription_id,
             stripe_customer_id = EXCLUDED.stripe_customer_id,
             current_period_end = EXCLUDED.current_period_end,
             cancel_at_period_end = EXCLUDED.cancel_at_period_end,
             seats = EXCLUDED.seats,
             billing_interval = EXCLUDED.billing_interval,
             allowance_granted_through = EXCLUDED.allowance_granted_through,
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
            s.billingInterval,
            s.allowanceGrantedThrough,
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

    list: async (limit = 200) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          'SELECT * FROM subscriptions ORDER BY created_at DESC LIMIT $1',
          [limit],
        );
        return r.rows.map(toSubscription);
      }),
  };

  readonly payments = {
    /*
     * ON CONFLICT DO NOTHING on the Stripe event id, so a webhook retry adds
     * nothing to a customer's history. The null return is how the caller tells
     * "recorded" from "already had it" without a second query.
     */
    record: async (payment: Payment) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          `INSERT INTO payments
             (id, organization_id, kind, status, amount_cents, currency, credits, plan_id,
              description, stripe_event_id, stripe_object_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (stripe_event_id) DO NOTHING
           RETURNING *`,
          [
            payment.id,
            payment.organizationId,
            payment.kind,
            payment.status,
            payment.amountCents,
            payment.currency,
            payment.credits,
            payment.planId,
            payment.description,
            payment.stripeEventId,
            payment.stripeObjectId,
            payment.createdAt,
          ],
        );
        return r.rows[0] ? toPayment(r.rows[0]) : null;
      }),

    listForOrganization: async (organizationId: string, limit = 50) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT * FROM payments WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2',
          [organizationId, limit],
        );
        return r.rows.map(toPayment);
      }),

    list: async (limit = 200) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM payments ORDER BY created_at DESC LIMIT $1', [limit]);
        return r.rows.map(toPayment);
      }),
  };

  readonly creditLedger = {
    /*
     * The entry is written before the balance moves, and that order is the
     * whole design.
     *
     * The unique index on `source_key` is the only thing that can decide a
     * race. Moving the balance first and then discovering the key was taken
     * would mean undoing a credit that another transaction had already
     * committed; inserting first means the second arrival blocks on the index,
     * finds nothing to do, and never touches the balance at all.
     *
     * Both statements are in one transaction, so a movement is either written
     * and applied or neither. A refusal — the key is taken, or the balance
     * would go negative — throws to roll the whole thing back, and is
     * classified afterwards from what actually survived.
     */
    post: async (movement: CreditMovement): Promise<CreditPosting> => {
      const id = movement.id ?? newId('cle');
      const createdAt = movement.createdAt ?? new Date().toISOString();
      try {
        return await this.asPlatform(async (c) => {
          /*
           * Three statements, one transaction, in this order deliberately.
           *
           * The entry is written first because the unique index on
           * `source_key` is the only thing that can decide a race: a second
           * arrival blocks here until the first commits, then finds nothing to
           * do and never touches the balance. Moving the balance first would
           * mean undoing a credit another transaction had already committed.
           *
           * Not one statement with data-modifying CTEs, which was the first
           * attempt and does not work: every sub-statement in a `WITH` runs
           * against the same snapshot, so the update could not see the row the
           * insert had just written and silently changed nothing.
           */
          const inserted = await c.query(
            `INSERT INTO credit_ledger
               (id, organization_id, kind, delta, balance_after, source_key, description,
                plan_id, subscription_id, period_key, payment_id, project_id, render_id,
                actor_user_id, created_at)
             VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             ON CONFLICT (source_key) DO NOTHING
             RETURNING id`,
            [
              id,
              movement.organizationId,
              movement.kind,
              movement.delta,
              movement.sourceKey ?? null,
              movement.description ?? '',
              movement.planId ?? null,
              movement.subscriptionId ?? null,
              movement.periodKey ?? null,
              movement.paymentId ?? null,
              movement.projectId ?? null,
              movement.renderId ?? null,
              movement.actorUserId ?? null,
              createdAt,
            ],
          );
          if (!inserted.rows[0]) throw new LedgerNotApplied();

          const moved = await c.query(
            `UPDATE organizations
                SET credit_balance = credit_balance + $2
              WHERE id = $1 AND credit_balance + $2 >= 0
              RETURNING credit_balance`,
            [movement.organizationId, movement.delta],
          );
          // Would go negative: throwing rolls the entry back with it, so a
          // refusal leaves nothing behind.
          if (!moved.rows[0]) throw new LedgerNotApplied();

          const balance = num(moved.rows[0]['credit_balance']);
          const settled = await c.query(
            'UPDATE credit_ledger SET balance_after = $2 WHERE id = $1 RETURNING *',
            [id, balance],
          );
          const entry = toCreditEntry(settled.rows[0]!);
          return { applied: true, reason: 'applied' as const, balance, entry };
        });
      } catch (error) {
        if (!(error instanceof LedgerNotApplied)) throw error;
      }

      // Classified after the rollback, from what actually survived: a
      // pre-existing row under this key means a duplicate, anything else means
      // the balance could not take it.
      const balance = (await this.organizations.get(movement.organizationId))?.creditBalance ?? 0;
      if (movement.sourceKey && (await this.creditLedger.has(movement.sourceKey))) {
        return { applied: false, reason: 'duplicate', balance, entry: null };
      }
      return { applied: false, reason: 'insufficient', balance, entry: null };
    },

    listForOrganization: async (organizationId: string, limit = 100) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          'SELECT * FROM credit_ledger WHERE organization_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
          [organizationId, limit],
        );
        return r.rows.map(toCreditEntry);
      }),

    list: async (limit = 200) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          'SELECT * FROM credit_ledger ORDER BY created_at DESC, id DESC LIMIT $1',
          [limit],
        );
        return r.rows.map(toCreditEntry);
      }),

    has: async (sourceKey: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT 1 FROM credit_ledger WHERE source_key = $1', [sourceKey]);
        return (r.rowCount ?? 0) > 0;
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
              voice_strategy, music_direction, created_at, updated_at, language,
              parent_storyboard_id, revision_reason, hero_shot, handovers)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
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
            storyboard.parentStoryboardId,
            storyboard.revisionReason,
            storyboard.heroShot,
            storyboard.handovers,
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
             hero_shot = COALESCE($7, hero_shot),
             handovers = COALESCE($8, handovers),
             updated_at = now()
           WHERE id = $1 AND organization_id = $2 RETURNING *`,
          [
            id, organizationId, patch.status ?? null, patch.voiceStrategy ?? null,
            patch.musicDirection ?? null, patch.language ?? null,
            patch.heroShot === undefined ? null : patch.heroShot,
            patch.handovers === undefined ? null : patch.handovers,
          ],
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
    create: async (input: RenderInput) => {
      const render = RenderSchema.parse(input);
      return this.tenant(render.organizationId, async (c) => {
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
      });
    },

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
             captions_asset_id = COALESCE($6, captions_asset_id),
             duration_seconds = COALESCE($7, duration_seconds),
             cost_usd = COALESCE($8, cost_usd),
             qa_report_id = COALESCE($9, qa_report_id),
             error = COALESCE($10, error),
             started_at = COALESCE($11, started_at),
             completed_at = COALESCE($12, completed_at),
             production_verdict = COALESCE($13, production_verdict),
             creative_verdict = COALESCE($14, creative_verdict),
             creative_reason = COALESCE($15, creative_reason)
           WHERE id = $1 AND organization_id = $2 RETURNING *`,
          [
            id, organizationId, patch.status ?? null, patch.masterAssetId ?? null,
            patch.posterAssetId ?? null, patch.captionsAssetId ?? null,
            patch.durationSeconds ?? null, patch.costUsd ?? null,
            patch.qaReportId ?? null, patch.error ?? null, patch.startedAt ?? null,
            patch.completedAt ?? null, patch.productionVerdict ?? null,
            patch.creativeVerdict ?? null, patch.creativeReason ?? null,
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

    listRecent: async (limit = 200) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT * FROM renders ORDER BY created_at DESC LIMIT $1', [limit]);
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

  readonly replans = {
    create: async (replan: CreativeReplan, organizationId: string) =>
      this.tenant(organizationId, async (c) => {
        await c.query(
          `INSERT INTO creative_replans
             (id, organization_id, project_id, render_id, from_storyboard_id, to_storyboard_id,
              scene_ids, check_name, diagnosis, strategy, reasoning, options, rejected, attempt,
              direction_cost_usd, estimated_cost_usd, model,
              scenes_reused, scenes_recomposed, scenes_regenerated, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
          [
            replan.id, organizationId, replan.projectId, replan.renderId,
            replan.fromStoryboardId, replan.toStoryboardId,
            JSON.stringify(replan.sceneIds), replan.check, replan.diagnosis,
            replan.strategy, replan.reasoning,
            JSON.stringify(replan.options), JSON.stringify(replan.rejected), replan.attempt,
            replan.directionCostUsd, replan.estimatedCostUsd, replan.model,
            replan.scenesReused, replan.scenesRecomposed, replan.scenesRegenerated,
            replan.createdAt,
          ],
        );
        return replan;
      }),

    listForProject: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT * FROM creative_replans WHERE project_id = $1 AND organization_id = $2
           ORDER BY created_at DESC`,
          [projectId, organizationId],
        );
        return r.rows.map(toReplan);
      }),

    listForRender: async (organizationId: string, renderId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT * FROM creative_replans WHERE render_id = $1 AND organization_id = $2
           ORDER BY created_at ASC`,
          [renderId, organizationId],
        );
        return r.rows.map(toReplan);
      }),

    /** Operator-facing: every beat this product has rewritten on its own. */
    list: async (limit = 200) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          'SELECT * FROM creative_replans ORDER BY created_at DESC LIMIT $1',
          [Math.max(1, Math.min(1000, limit))],
        );
        return r.rows.map((row) => ({
          ...toReplan(row),
          organizationId: row['organization_id'] as string,
        }));
      }),
  };

  /**
   * The creative intelligence layer.
   *
   * JSONB throughout, with the fields an operator filters on lifted into
   * columns. The shape of a brief or a critic's findings is still being
   * learned; a schema migration every time a field is added would slow that
   * down for no benefit anybody can see, and the columns that exist are the
   * ones the Director Lab actually queries by.
   */
  readonly creative = {
    putModel: async (
      organizationId: string,
      model: { id: string; projectId: string; kind: 'brief' | 'audience' | 'genome'; version: number; data: unknown; createdAt: string },
    ) =>
      this.tenant(organizationId, async (c) => {
        await c.query(
          `INSERT INTO creative_models (id, organization_id, project_id, kind, version, data, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (project_id, kind, version) DO UPDATE SET data = EXCLUDED.data`,
          [model.id, organizationId, model.projectId, model.kind, model.version, model.data, model.createdAt],
        );
      }),

    latestModel: async (organizationId: string, projectId: string, kind: 'brief' | 'audience' | 'genome') =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT data FROM creative_models
           WHERE organization_id = $1 AND project_id = $2 AND kind = $3
           ORDER BY version DESC LIMIT 1`,
          [organizationId, projectId, kind],
        );
        return (r.rows[0]?.['data'] as unknown) ?? null;
      }),

    putTerritories: async (
      organizationId: string,
      projectId: string,
      rows: readonly { territory: CreativeTerritory; kept: boolean; selected: boolean; rejectionReason: string | null }[],
    ) =>
      this.tenant(organizationId, async (c) => {
        for (const row of rows) {
          await c.query(
            `INSERT INTO creative_territories
               (id, organization_id, project_id, mechanism, kept, selected, rejection_reason, data, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (id) DO UPDATE SET
               kept = EXCLUDED.kept, selected = EXCLUDED.selected, rejection_reason = EXCLUDED.rejection_reason`,
            [
              row.territory.id, organizationId, projectId, row.territory.mechanism,
              row.kept, row.selected, row.rejectionReason, row.territory, row.territory.createdAt,
            ],
          );
        }
      }),

    listTerritories: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT data, kept, selected, rejection_reason FROM creative_territories
           WHERE organization_id = $1 AND project_id = $2 ORDER BY created_at ASC`,
          [organizationId, projectId],
        );
        return r.rows.map((row) => ({
          territory: CreativeTerritory.parse(row['data']),
          kept: Boolean(row['kept']),
          selected: Boolean(row['selected']),
          rejectionReason: (row['rejection_reason'] as string | null) ?? null,
        }));
      }),

    putReviews: async (organizationId: string, reviews: readonly CriticReview[]) =>
      this.tenant(organizationId, async (c) => {
        for (const review of reviews) {
          await c.query(
            `INSERT INTO critic_reviews
               (id, organization_id, project_id, artifact_kind, artifact_id, critic, verdict,
                critic_version, model, cost_usd, data, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (id) DO NOTHING`,
            [
              review.id, organizationId, review.projectId, review.artifactKind, review.artifactId,
              review.critic, review.verdict, review.criticVersion, review.model, review.costUsd,
              review, review.createdAt,
            ],
          );
        }
      }),

    listReviews: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT data FROM critic_reviews WHERE organization_id = $1 AND project_id = $2
           ORDER BY created_at ASC`,
          [organizationId, projectId],
        );
        return r.rows.map((row) => CriticReview.parse(row['data']));
      }),

    putDecision: async (organizationId: string, decision: DirectorDecision) =>
      this.tenant(organizationId, async (c) => {
        await c.query(
          `INSERT INTO director_decisions
             (id, organization_id, project_id, stage, director_version, data, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
          [decision.id, organizationId, decision.projectId, decision.stage, decision.directorVersion, decision, decision.createdAt],
        );
      }),

    listDecisions: async (organizationId: string, projectId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT data FROM director_decisions WHERE organization_id = $1 AND project_id = $2
           ORDER BY created_at ASC`,
          [organizationId, projectId],
        );
        return r.rows.map((row) => DirectorDecision.parse(row['data']));
      }),

    putSignatures: async (organizationId: string, signatures: readonly CreativeSignature[]) =>
      this.tenant(organizationId, async (c) => {
        for (const signature of signatures) {
          await c.query(
            `INSERT INTO creative_signatures (id, organization_id, project_id, kind, device, key, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
            [signature.id, organizationId, signature.projectId, signature.kind, signature.device, signature.key, signature.createdAt],
          );
        }
      }),

    recentSignatures: async (organizationId: string, limit = 60) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT id, organization_id, project_id, kind, device, key, created_at
           FROM creative_signatures WHERE organization_id = $1
           ORDER BY created_at DESC LIMIT $2`,
          [organizationId, limit],
        );
        return r.rows.map((row) =>
          CreativeSignature.parse({
            id: row['id'],
            organizationId: row['organization_id'],
            projectId: row['project_id'],
            kind: row['kind'],
            device: row['device'],
            key: row['key'],
            createdAt: iso(row['created_at']),
          }),
        );
      }),

    putPreference: async (organizationId: string, preference: CreativePreference) =>
      this.tenant(organizationId, async (c) => {
        await c.query(
          `INSERT INTO creative_preferences
             (id, organization_id, brief_id, artifact_a, artifact_b, judge, winner, dimension, blind, data, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
          [
            preference.id, organizationId, preference.briefId, preference.artifactA, preference.artifactB,
            preference.judge, preference.winner, preference.dimension, preference.blind, preference, preference.createdAt,
          ],
        );
      }),

    listPreferences: async (organizationId: string, limit = 200) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT data FROM creative_preferences WHERE organization_id = $1
           ORDER BY created_at DESC LIMIT $2`,
          [organizationId, limit],
        );
        return r.rows.map((row) => CreativePreference.parse(row['data']));
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
        return r.rows[0] ? toQaReport(r.rows[0]['data']) : null;
      }),

    update: async (organizationId: string, id: string, patch: Partial<QaReport>) =>
      this.tenant(organizationId, async (c) => {
        const existing = await c.query('SELECT data FROM qa_reports WHERE id = $1 AND organization_id = $2', [
          id,
          organizationId,
        ]);
        const current = existing.rows[0] ? toQaReport(existing.rows[0]['data']) : undefined;
        if (!current) throw new AppError('not_found', 'QA report not found.');
        const next = { ...current, ...patch };
        await c.query(
          'UPDATE qa_reports SET data = $3, passed = $4 WHERE id = $1 AND organization_id = $2',
          [id, organizationId, next, next.passed],
        );
        return next;
      }),

    getForRender: async (organizationId: string, renderId: string) =>
      this.tenant(organizationId, async (c) => {
        const r = await c.query(
          `SELECT data FROM qa_reports WHERE render_id = $1 AND organization_id = $2
           ORDER BY created_at DESC LIMIT 1`,
          [renderId, organizationId],
        );
        return r.rows[0] ? toQaReport(r.rows[0]['data']) : null;
      }),

    list: async (limit = 200) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          'SELECT organization_id, data FROM qa_reports ORDER BY created_at DESC LIMIT $1',
          [limit],
        );
        return r.rows.map((row) => ({
          ...toQaReport(row['data']),
          organizationId: row['organization_id'] as string,
        }));
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

    fail: async (id: string, error: string, retryAt: string | null, code: string | null = null) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          `UPDATE jobs SET
             state = CASE WHEN $3::timestamptz IS NULL OR attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
             last_error = $2,
             last_error_code = $4,
             run_after = COALESCE($3::timestamptz, run_after),
             locked_by = NULL, locked_at = NULL, updated_at = now()
           WHERE id = $1 RETURNING *`,
          [id, error.slice(0, 4000), retryAt, code?.slice(0, 60) ?? null],
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
              is_retry, cost_basis, metadata, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [
            cost.id, cost.organizationId, cost.projectId, cost.sceneId, cost.renderId,
            cost.provider, cost.model, cost.operation, cost.estimatedCostUsd, cost.actualCostUsd,
            cost.creditsCharged, cost.quantity, cost.unit, cost.succeeded, cost.isRetry,
            cost.costBasis, cost.metadata, cost.createdAt,
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

  readonly collections = {
    create: async (entry: CollectionEntry) =>
      this.asPlatform(async (c) => {
        try {
          await c.query(
            `INSERT INTO collection_entries
               (id, slug, organization_id, project_id, render_id, status, category, featured, launch_of_the_week, original,
                position, published_at, submitted_at, data, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [
              entry.id, entry.slug, entry.organizationId, entry.projectId, entry.renderId, entry.status, entry.category,
              entry.featured, entry.launchOfTheWeek, entry.original, entry.position, entry.publishedAt, entry.submittedAt,
              entry, entry.createdAt, entry.updatedAt,
            ],
          );
        } catch (error) {
          if ((error as { code?: string }).code === '23505') throw new AppError('conflict', 'That address is taken.');
          throw error;
        }
        return entry;
      }),

    get: async (id: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT data FROM collection_entries WHERE id = $1', [id]);
        return r.rows[0] ? collectionFromRow(r.rows[0]['data']) : null;
      }),

    getBySlug: async (slug: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT data FROM collection_entries WHERE slug = $1', [slug]);
        return r.rows[0] ? collectionFromRow(r.rows[0]['data']) : null;
      }),

    getByFormerSlug: async (slug: string) =>
      this.asPlatform(async (c) => {
        // Containment against the GIN index, not a scan of every document.
        const r = await c.query(
          `SELECT data FROM collection_entries WHERE data -> 'previousSlugs' @> to_jsonb($1::text) LIMIT 1`,
          [slug],
        );
        return r.rows[0] ? collectionFromRow(r.rows[0]['data']) : null;
      }),

    getForProject: async (organizationId: string, projectId: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          'SELECT data FROM collection_entries WHERE organization_id = $1 AND project_id = $2 ORDER BY submitted_at DESC LIMIT 1',
          [organizationId, projectId],
        );
        return r.rows[0] ? collectionFromRow(r.rows[0]['data']) : null;
      }),

    list: async (query: CollectionQuery = {}) =>
      this.asPlatform(async (c) => {
        const where: string[] = [];
        const params: unknown[] = [];
        const bind = (value: unknown) => `$${params.push(value)}`;
        if (query.status) where.push(`status = ${bind(query.status)}`);
        if (query.category) where.push(`category = ${bind(query.category)}`);
        if (query.featured !== undefined) where.push(`featured = ${bind(query.featured)}`);
        const r = await c.query(
          `SELECT data FROM collection_entries ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY position ASC, COALESCE(published_at, submitted_at) DESC
           LIMIT ${Math.min(Math.max(query.limit ?? 200, 1), 1000)}`,
          params,
        );
        return r.rows.map((row) => collectionFromRow(row['data']));
      }),

    update: async (id: string, patch: Partial<CollectionEntry>) =>
      this.asPlatform(async (c) => {
        const current = await c.query('SELECT data FROM collection_entries WHERE id = $1 FOR UPDATE', [id]);
        if (!current.rows[0]) throw notFound('Collection entry');
        const next: CollectionEntry = { ...collectionFromRow(current.rows[0]['data']), ...patch, id, updatedAt: new Date().toISOString() };
        try {
          await c.query(
            `UPDATE collection_entries SET slug = $2, status = $3, category = $4, featured = $5, launch_of_the_week = $6, original = $7,
               position = $8, published_at = $9, data = $10, updated_at = now()
             WHERE id = $1`,
            [id, next.slug, next.status, next.category, next.featured, next.launchOfTheWeek, next.original, next.position, next.publishedAt, next],
          );
        } catch (error) {
          if ((error as { code?: string }).code === '23505') throw new AppError('conflict', 'That address is taken.');
          throw error;
        }
        return next;
      }),

    countByStatus: async () =>
      this.asPlatform(async (c) => {
        const r = await c.query<{ status: string; count: number }>('SELECT status, COUNT(*)::int AS count FROM collection_entries GROUP BY status');
        return Object.fromEntries(r.rows.map((row) => [row.status, num(row.count)]));
      }),
  };

  readonly referrals = {
    create: async (referral: Referral) =>
      this.asPlatform(async (c) => {
        try {
          await c.query(
            `INSERT INTO referrals
               (id, code, invite_code_id, inviter_user_id, invited_user_id, invited_organization_id, stage,
                inviter_credits_granted, invited_credits_granted, rewarded_at, created_at, updated_at, data)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              referral.id, referral.code, referral.inviteCodeId, referral.inviterUserId, referral.invitedUserId,
              referral.invitedOrganizationId, referral.stage, referral.inviterCreditsGranted, referral.invitedCreditsGranted,
              referral.rewardedAt, referral.createdAt, referral.updatedAt, referral,
            ],
          );
        } catch (error) {
          // One referral per invited person, ever: the constraint is the rule.
          if ((error as { code?: string }).code === '23505') throw new AppError('conflict', 'This person was already referred.');
          throw error;
        }
        return referral;
      }),

    get: async (id: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT data FROM referrals WHERE id = $1', [id]);
        return r.rows[0] ? referralFromRow(r.rows[0]['data']) : null;
      }),

    getForInvitedUser: async (invitedUserId: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT data FROM referrals WHERE invited_user_id = $1', [invitedUserId]);
        return r.rows[0] ? referralFromRow(r.rows[0]['data']) : null;
      }),

    getForInvitedOrganization: async (organizationId: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT data FROM referrals WHERE invited_organization_id = $1 ORDER BY created_at LIMIT 1', [organizationId]);
        return r.rows[0] ? referralFromRow(r.rows[0]['data']) : null;
      }),

    list: async (query: ReferralQuery = {}) =>
      this.asPlatform(async (c) => {
        const where: string[] = [];
        const params: unknown[] = [];
        const bind = (value: unknown) => `$${params.push(value)}`;
        if (query.inviterUserId) where.push(`inviter_user_id = ${bind(query.inviterUserId)}`);
        if (query.stage) where.push(`stage = ${bind(query.stage)}`);
        const r = await c.query(
          `SELECT data FROM referrals ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY created_at DESC LIMIT ${Math.min(Math.max(query.limit ?? 200, 1), 1000)}`,
          params,
        );
        return r.rows.map((row) => referralFromRow(row['data']));
      }),

    update: async (id: string, patch: Partial<Referral>) =>
      this.asPlatform(async (c) => {
        const current = await c.query('SELECT data FROM referrals WHERE id = $1 FOR UPDATE', [id]);
        if (!current.rows[0]) throw notFound('Referral');
        const next: Referral = { ...referralFromRow(current.rows[0]['data']), ...patch, id, updatedAt: new Date().toISOString() };
        await c.query(
          `UPDATE referrals SET stage = $2, inviter_credits_granted = $3, invited_credits_granted = $4,
             rewarded_at = $5, data = $6, updated_at = now()
           WHERE id = $1`,
          [id, next.stage, next.inviterCreditsGranted, next.invitedCreditsGranted, next.rewardedAt, next],
        );
        return next;
      }),

    countRewardedFor: async (inviterUserId: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query<{ count: number }>(
          'SELECT COUNT(*)::int AS count FROM referrals WHERE inviter_user_id = $1 AND rewarded_at IS NOT NULL',
          [inviterUserId],
        );
        return num(r.rows[0]?.count ?? 0);
      }),

    countByStage: async () =>
      this.asPlatform(async (c) => {
        const r = await c.query<{ stage: string; count: number }>('SELECT stage, COUNT(*)::int AS count FROM referrals GROUP BY stage');
        return Object.fromEntries(r.rows.map((row) => [row.stage, num(row.count)]));
      }),
  };

  readonly articles = {
    create: async (article: Article) =>
      this.asPlatform(async (c) => {
        try {
          await c.query(
            `INSERT INTO articles (id, slug, title, status, origin, scheduled_for, published_at, created_at, updated_at, data)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [article.id, article.slug, article.title, article.status, article.origin, article.scheduledFor, article.publishedAt, article.createdAt, article.updatedAt, article],
          );
        } catch (error) {
          if ((error as { code?: string }).code === '23505') throw new AppError('conflict', 'That address is taken.');
          throw error;
        }
        return article;
      }),

    get: async (id: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT data FROM articles WHERE id = $1', [id]);
        return r.rows[0] ? articleFromRow(r.rows[0]['data']) : null;
      }),

    getBySlug: async (slug: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT data FROM articles WHERE slug = $1', [slug]);
        return r.rows[0] ? articleFromRow(r.rows[0]['data']) : null;
      }),

    getByFormerSlug: async (slug: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          `SELECT data FROM articles WHERE data -> 'previousSlugs' @> to_jsonb($1::text) LIMIT 1`,
          [slug],
        );
        return r.rows[0] ? articleFromRow(r.rows[0]['data']) : null;
      }),

    list: async (query: ArticleQuery = {}) =>
      this.asPlatform(async (c) => {
        const params: unknown[] = [];
        const where = query.status ? `WHERE status = $${params.push(query.status)}` : '';
        const r = await c.query(
          `SELECT data FROM articles ${where}
           ORDER BY COALESCE(published_at, updated_at) DESC
           LIMIT ${Math.min(Math.max(query.limit ?? 100, 1), 500)}`,
          params,
        );
        return r.rows.map((row) => articleFromRow(row['data']));
      }),

    update: async (id: string, patch: Partial<Article>) =>
      this.asPlatform(async (c) => {
        const current = await c.query('SELECT data FROM articles WHERE id = $1 FOR UPDATE', [id]);
        if (!current.rows[0]) throw notFound('Article');
        const next: Article = { ...articleFromRow(current.rows[0]['data']), ...patch, id, updatedAt: new Date().toISOString() };
        try {
          await c.query(
            `UPDATE articles SET slug = $2, title = $3, status = $4, origin = $5, scheduled_for = $6, published_at = $7, data = $8, updated_at = now()
             WHERE id = $1`,
            [id, next.slug, next.title, next.status, next.origin, next.scheduledFor, next.publishedAt, next],
          );
        } catch (error) {
          if ((error as { code?: string }).code === '23505') throw new AppError('conflict', 'That address is taken.');
          throw error;
        }
        return next;
      }),

    delete: async (id: string) =>
      this.asPlatform(async (c) => {
        await c.query('DELETE FROM articles WHERE id = $1', [id]);
      }),

    listDue: async (now: string, limit = 20) =>
      this.asPlatform(async (c) => {
        const r = await c.query(
          `SELECT data FROM articles WHERE status = 'scheduled' AND scheduled_for IS NOT NULL AND scheduled_for <= $1
           ORDER BY scheduled_for LIMIT ${Math.min(Math.max(limit, 1), 100)}`,
          [now],
        );
        return r.rows.map((row) => articleFromRow(row['data']));
      }),

    countByStatus: async () =>
      this.asPlatform(async (c) => {
        const r = await c.query<{ status: string; count: number }>('SELECT status, COUNT(*)::int AS count FROM articles GROUP BY status');
        return Object.fromEntries(r.rows.map((row) => [row.status, num(row.count)]));
      }),
  };

  readonly benchmarks = {
    create: async (benchmark: Benchmark) =>
      this.asPlatform(async (c) => {
        try {
          await c.query(
            `INSERT INTO benchmarks (id, sha256, title, status, retrieval, created_at, updated_at, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [benchmark.id, benchmark.source.sha256, benchmark.title, benchmark.status, benchmark.retrieval, benchmark.createdAt, benchmark.updatedAt, benchmark],
          );
        } catch (error) {
          if ((error as { code?: string }).code === '23505') throw new AppError('conflict', 'That film is already in the library.');
          throw error;
        }
        return benchmark;
      }),

    get: async (id: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT data FROM benchmarks WHERE id = $1', [id]);
        return r.rows[0] ? benchmarkFromRow(r.rows[0]['data']) : null;
      }),

    getBySha256: async (sha256: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT data FROM benchmarks WHERE sha256 = $1', [sha256]);
        return r.rows[0] ? benchmarkFromRow(r.rows[0]['data']) : null;
      }),

    list: async (query: BenchmarkQuery = {}) =>
      this.asPlatform(async (c) => {
        const { where, params } = benchmarkWhere(query);
        const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
        const offset = Math.max(query.offset ?? 0, 0);
        const r = await c.query(
          `SELECT data FROM benchmarks ${where} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
          params,
        );
        return r.rows.map((row) => benchmarkFromRow(row['data']));
      }),

    count: async (query: Omit<BenchmarkQuery, 'limit' | 'offset'> = {}) =>
      this.asPlatform(async (c) => {
        const { where, params } = benchmarkWhere(query);
        const r = await c.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM benchmarks ${where}`, params);
        return num(r.rows[0]?.count ?? 0);
      }),

    update: async (id: string, patch: Partial<Benchmark>) =>
      this.benchmarks.mutate(id, (current) => ({ ...current, ...patch })),

    mutate: async (id: string, change: (current: Benchmark) => Benchmark) =>
      this.asPlatform(async (c) => {
        const current = await c.query('SELECT data FROM benchmarks WHERE id = $1 FOR UPDATE', [id]);
        if (!current.rows[0]) throw notFound('Benchmark');
        const next: Benchmark = BenchmarkSchema.parse({ ...change(benchmarkFromRow(current.rows[0]['data'])), id, updatedAt: new Date().toISOString() });
        await c.query(
          `UPDATE benchmarks SET title = $2, status = $3, retrieval = $4, data = $5, updated_at = now() WHERE id = $1`,
          [id, next.title, next.status, next.retrieval, next],
        );
        return next;
      }),

    delete: async (id: string) =>
      this.asPlatform(async (c) => {
        await c.query('DELETE FROM benchmarks WHERE id = $1', [id]);
      }),

    countByStatus: async () =>
      this.asPlatform(async (c) => {
        const r = await c.query<{ status: string; count: number }>('SELECT status, COUNT(*)::int AS count FROM benchmarks GROUP BY status');
        return Object.fromEntries(r.rows.map((row) => [row.status, num(row.count)]));
      }),
  };

  readonly topics = {
    create: async (topic: ArticleTopic) =>
      this.asPlatform(async (c) => {
        await c.query(
          `INSERT INTO article_topics (id, status, score, article_id, created_at, updated_at, data) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [topic.id, topic.status, topic.score, topic.articleId, topic.createdAt, topic.updatedAt, topic],
        );
        return topic;
      }),

    get: async (id: string) =>
      this.asPlatform(async (c) => {
        const r = await c.query('SELECT data FROM article_topics WHERE id = $1', [id]);
        return r.rows[0] ? topicFromRow(r.rows[0]['data']) : null;
      }),

    list: async (query: { status?: ArticleTopic['status']; limit?: number } = {}) =>
      this.asPlatform(async (c) => {
        const params: unknown[] = [];
        const where = query.status ? `WHERE status = $${params.push(query.status)}` : '';
        const r = await c.query(
          `SELECT data FROM article_topics ${where} ORDER BY score DESC, created_at DESC LIMIT ${Math.min(Math.max(query.limit ?? 100, 1), 500)}`,
          params,
        );
        return r.rows.map((row) => topicFromRow(row['data']));
      }),

    update: async (id: string, patch: Partial<ArticleTopic>) =>
      this.asPlatform(async (c) => {
        const current = await c.query('SELECT data FROM article_topics WHERE id = $1 FOR UPDATE', [id]);
        if (!current.rows[0]) throw notFound('Topic');
        const next: ArticleTopic = { ...topicFromRow(current.rows[0]['data']), ...patch, id, updatedAt: new Date().toISOString() };
        await c.query('UPDATE article_topics SET status = $2, score = $3, article_id = $4, data = $5, updated_at = now() WHERE id = $1', [
          id, next.status, next.score, next.articleId, next,
        ]);
        return next;
      }),

    delete: async (id: string) =>
      this.asPlatform(async (c) => {
        await c.query('DELETE FROM article_topics WHERE id = $1', [id]);
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
    // Parsed rather than trusted: a grant that came back malformed must not
    // silently become "unlimited". Anything unreadable falls to the plan.
    limitOverrides: PlanLimitGrants.catch({}).parse(row['limit_overrides'] ?? {}),
    extraEntitlements: z.array(Entitlement).catch([]).parse(row['extra_entitlements'] ?? []),
    isInternal: Boolean(row['is_internal']),
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
    billingInterval: (row['billing_interval'] as Subscription['billingInterval']) ?? 'monthly',
    allowanceGrantedThrough: (row['allowance_granted_through'] as string) ?? null,
    createdAt: iso(row['created_at']),
    updatedAt: iso(row['updated_at']),
  };
}

/** Thrown inside the ledger transaction to roll it back. Never escapes. */
class LedgerNotApplied extends Error {}

/**
 * Reports written in the old words, read in the new ones.
 *
 * Severity used to be note/minor/major/blocker and the timecode used to be
 * `atSeconds`. Discarding those rows would have been the easy answer and the
 * wrong one: the Quality console exists to count defects across every film the
 * platform has made, and a console that forgets everything from before the
 * rename measures the rename rather than the quality.
 */
function migrateQaReport(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;
  const report = data as { issues?: unknown };
  if (!Array.isArray(report.issues)) return data;

  const SEVERITY: Record<string, string> = {
    blocker: 'hard_fail',
    major: 'soft_fail',
    minor: 'warning',
    note: 'info',
  };

  return {
    ...report,
    issues: report.issues.map((raw) => {
      if (!raw || typeof raw !== 'object') return raw;
      const issue = raw as Record<string, unknown>;
      const severity = typeof issue['severity'] === 'string' ? issue['severity'] : '';
      const migrated: Record<string, unknown> = { ...issue };
      if (SEVERITY[severity]) migrated['severity'] = SEVERITY[severity];
      if (migrated['timecodeStart'] === undefined && issue['atSeconds'] !== undefined) {
        migrated['timecodeStart'] = issue['atSeconds'];
      }
      return migrated;
    }),
  };
}

/**
 * A stored report, read back through its schema.
 *
 * The JSONB was cast straight to the type, which is a promise rather than a
 * check: a report written before a field existed comes back missing it, and
 * the first page that reads the field crashes on a row nobody can see. Parsing
 * fills the defaults, so an old report reads as one with nothing to say rather
 * than as a broken one.
 */
function toQaReport(data: unknown): QaReport {
  const parsed = QaReportSchema.safeParse(migrateQaReport(data));
  if (parsed.success) return parsed.data;
  // A row we cannot read at all is worth knowing about and is not worth
  // failing a page for.
  console.error('[db] unreadable QA report:', parsed.error.message.slice(0, 200));
  return QaReportSchema.parse({
    id: (data as { id?: string })?.id ?? 'unknown',
    renderId: (data as { renderId?: string })?.renderId ?? 'unknown',
    projectId: (data as { projectId?: string })?.projectId ?? 'unknown',
    passed: false,
    createdAt: (data as { createdAt?: string })?.createdAt ?? new Date(0).toISOString(),
  });
}

function toCreditEntry(row: Row): CreditLedgerEntry {
  return {
    id: row['id'] as string,
    organizationId: row['organization_id'] as string,
    kind: row['kind'] as CreditLedgerEntry['kind'],
    delta: num(row['delta']),
    balanceAfter: num(row['balance_after']),
    sourceKey: (row['source_key'] as string) ?? null,
    description: (row['description'] as string) ?? '',
    planId: (row['plan_id'] as string) ?? null,
    subscriptionId: (row['subscription_id'] as string) ?? null,
    periodKey: (row['period_key'] as string) ?? null,
    paymentId: (row['payment_id'] as string) ?? null,
    projectId: (row['project_id'] as string) ?? null,
    renderId: (row['render_id'] as string) ?? null,
    actorUserId: (row['actor_user_id'] as string) ?? null,
    createdAt: iso(row['created_at']),
  };
}

function toPayment(row: Row): Payment {
  return {
    id: row['id'] as string,
    organizationId: row['organization_id'] as string,
    kind: row['kind'] as Payment['kind'],
    status: row['status'] as Payment['status'],
    amountCents: num(row['amount_cents']),
    currency: row['currency'] as string,
    credits: row['credits'] === null || row['credits'] === undefined ? null : num(row['credits']),
    planId: (row['plan_id'] as string) ?? null,
    description: (row['description'] as string) ?? '',
    stripeEventId: (row['stripe_event_id'] as string) ?? null,
    stripeObjectId: (row['stripe_object_id'] as string) ?? null,
    createdAt: iso(row['created_at']),
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

function toReplan(row: Row): CreativeReplan {
  return CreativeReplanSchema.parse({
    id: row['id'],
    organizationId: row['organization_id'],
    projectId: row['project_id'],
    renderId: row['render_id'] ?? null,
    fromStoryboardId: row['from_storyboard_id'] ?? null,
    toStoryboardId: row['to_storyboard_id'] ?? null,
    sceneIds: row['scene_ids'] ?? [],
    check: row['check_name'] ?? '',
    diagnosis: row['diagnosis'] ?? '',
    strategy: row['strategy'] ?? '',
    reasoning: row['reasoning'] ?? '',
    options: row['options'] ?? [],
    rejected: row['rejected'] ?? [],
    attempt: num(row['attempt']),
    directionCostUsd: num(row['direction_cost_usd']),
    estimatedCostUsd: num(row['estimated_cost_usd']),
    model: row['model'] ?? '',
    scenesReused: num(row['scenes_reused']),
    scenesRecomposed: num(row['scenes_recomposed']),
    scenesRegenerated: num(row['scenes_regenerated']),
    createdAt: iso(row['created_at']),
  });
}

function toStoryboard(row: Row, scenes: Scene[]): Storyboard {
  return resequence({
    id: row['id'] as string,
    projectId: row['project_id'] as string,
    conceptId: row['concept_id'] as string,
    treatmentId: row['treatment_id'] as string,
    handovers: (row['handovers'] as Storyboard['handovers']) ?? {},
    version: num(row['version']),
    scenes,
    voiceStrategy: row['voice_strategy'] as Storyboard['voiceStrategy'],
    language: (row['language'] as string | null) ?? null,
    musicDirection: (row['music_direction'] as string) ?? '',
    heroShot: (row['hero_shot'] as Storyboard['heroShot']) ?? null,
    parentStoryboardId: (row['parent_storyboard_id'] as string | null) ?? null,
    revisionReason: (row['revision_reason'] as string) ?? '',
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

/** An entry as stored, brought up to the current shape. */
function articleFromRow(data: unknown): Article {
  return ArticleSchema.parse(data);
}

function benchmarkFromRow(data: unknown): Benchmark {
  return BenchmarkSchema.parse(data);
}

/** Filters as SQL, every value a parameter. */
function benchmarkWhere(query: Omit<BenchmarkQuery, 'limit' | 'offset'>): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (query.status !== undefined) {
    const statuses = Array.isArray(query.status) ? query.status : [query.status];
    clauses.push(`status = ANY($${params.push(statuses)}::text[])`);
  }
  if (query.retrieval) clauses.push(`retrieval = $${params.push(query.retrieval)}`);
  const needle = query.search?.trim();
  if (needle) {
    // LIKE's own wildcards in the search are matched literally.
    const pattern = `%${needle.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
    const index = params.push(pattern);
    clauses.push(`(title ILIKE $${index} OR data -> 'source' ->> 'fileName' ILIKE $${index})`);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function topicFromRow(data: unknown): ArticleTopic {
  return ArticleTopicSchema.parse(data);
}

function referralFromRow(data: unknown): Referral {
  return ReferralSchema.parse(data);
}

function collectionFromRow(data: unknown): CollectionEntry {
  return CollectionEntrySchema.parse(data);
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
    captionsAssetId: (row['captions_asset_id'] as string) ?? null,
    watermarked: Boolean(row['watermarked']),
    durationSeconds: num(row['duration_seconds']),
    costUsd: num(row['cost_usd']),
    qaReportId: (row['qa_report_id'] as string) ?? null,
    productionVerdict: (row['production_verdict'] as Render['productionVerdict']) ?? null,
    creativeVerdict: (row['creative_verdict'] as Render['creativeVerdict']) ?? null,
    creativeReason: (row['creative_reason'] as string) ?? '',
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
    lastErrorCode: (row['last_error_code'] as string) ?? null,
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
    costBasis: (row['cost_basis'] as GenerationCost['costBasis']) ?? 'listed',
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
