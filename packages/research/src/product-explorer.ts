import { z } from 'zod';
import { derivedId, newId, type ProductMoment } from '@act-one/core';
import type {
  BrowserAutomationProvider,
  BrowserSession,
  CallContext,
  InteractionStep,
  LlmProvider,
  NavigationPolicy,
} from '@act-one/providers';
import { PolicyViolation, policyForAuthenticatedProduct } from '@act-one/providers';

/**
 * Authenticated exploration of a customer's real product.
 *
 * This is the part of the system with the most power and therefore the most
 * restraint. We are a guest in somebody's production account. The rules:
 *
 *   - We only ever sign in with credentials the customer explicitly supplied
 *     and authorised, recorded against a named user.
 *   - The session is confined to one origin and to the paths we were given.
 *   - We never take a state-changing action. The interaction policy in
 *     @act-one/providers blocks destructive clicks in code, so a model that
 *     decides "Delete workspace" looks interesting cannot act on it.
 *   - Everything is audited, and the session is wiped before release.
 *
 * What we are looking for is not "screenshots of the app". It is moments: a
 * before state, an action, and an after state where something meaningful
 * changed. That delta is what a film can actually be cut around.
 */
export type ExplorerCredentials = {
  loginUrl: string;
  username: string | null;
  /** Plaintext, decrypted by the caller inside the worker. Never logged. */
  secret: string;
  allowedPaths: string[];
  deniedPaths: string[];
};

export type ExploreOptions = {
  organizationId: string;
  projectId: string;
  credentials: ExplorerCredentials;
  productName: string;
  /** What the film is about — steers what counts as interesting. */
  focus?: string;
  maxMoments?: number;
  onAudit?: (event: { action: string; detail: string }) => void;
};

const NavigationPlan = z.object({
  targets: z
    .array(
      z.object({
        path: z.string().min(1).max(200),
        why: z.string().max(240),
        expectedMoment: z.string().max(240),
      }),
    )
    .max(8)
    .default([]),
});

const MomentPlan = z.object({
  moments: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        description: z.string().max(600),
        startState: z.string().max(400),
        endState: z.string().max(400),
        /** CSS selector of the element that best frames this moment. */
        focusSelector: z.string().max(200).nullable().default(null),
        steps: z
          .array(
            z.object({
              action: z.enum(['click', 'hover', 'scroll', 'wait']),
              selector: z.string().max(200).default(''),
              y: z.number().default(0),
              ms: z.number().default(400),
              description: z.string().max(200).default(''),
            }),
          )
          .max(5)
          .default([]),
        wowScore: z.number().min(0).max(1).default(0.5),
        relevanceScore: z.number().min(0).max(1).default(0.5),
      }),
    )
    .max(6)
    .default([]),
});

export type MomentCapture = { before: Uint8Array; after: Uint8Array | null };

export type ExploreResult = {
  moments: ProductMoment[];
  /**
   * Screenshot bytes keyed by moment id.
   *
   * Returned alongside the moments rather than embedded in them: ProductMoment
   * is persisted as JSON, so it holds asset ids, not megabytes. The caller
   * writes these to object storage and fills in the ids.
   */
  captures: Map<string, MomentCapture>;
};

export class ProductExplorer {
  private readonly browser: BrowserAutomationProvider;
  private readonly llm: LlmProvider;

  constructor(browser: BrowserAutomationProvider, llm: LlmProvider) {
    this.browser = browser;
    this.llm = llm;
  }

  async explore(options: ExploreOptions, context: CallContext): Promise<ExploreResult> {
    const policy = policyForAuthenticatedProduct({
      loginUrl: options.credentials.loginUrl,
      allowedPaths: options.credentials.allowedPaths,
      deniedPaths: options.credentials.deniedPaths,
      maxPages: 16,
    });

    const session = await this.browser.createSession(
      {
        projectId: options.projectId,
        organizationId: options.organizationId,
        policy,
        // Cookies must survive navigation for an authenticated tour, and are
        // destroyed on close.
        persistState: true,
        viewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
      },
      context,
    );

    try {
      const signedIn = await this.signIn(session, options);
      if (!signedIn) {
        options.onAudit?.({ action: 'blocked', detail: 'Sign-in did not complete.' });
        return { moments: [], captures: new Map() };
      }

      const targets = await this.planNavigation(session, options, context, policy);
      const moments: ProductMoment[] = [];
      const captures = new Map<string, MomentCapture>();
      const limit = options.maxMoments ?? 5;

      for (const target of targets) {
        if (moments.length >= limit) break;
        try {
          const captured = await this.captureMomentsAt(session, target, options, context);
          moments.push(...captured.moments);
          for (const [id, bytes] of captured.captures) captures.set(id, bytes);
        } catch (error) {
          if (error instanceof PolicyViolation) {
            options.onAudit?.({ action: 'blocked', detail: error.message });
            continue;
          }
          // One unreachable screen must not abandon the tour.
          options.onAudit?.({
            action: 'blocked',
            detail: `Could not explore ${target.path}: ${(error as Error).message.slice(0, 160)}`,
          });
        }
      }

      const kept = moments.slice(0, limit);
      const keptIds = new Set(kept.map((m) => m.id));
      for (const id of [...captures.keys()]) {
        // Drop bytes for moments that did not make the cut rather than carrying
        // them through the pipeline.
        if (!keptIds.has(id)) captures.delete(id);
      }
      return { moments: kept, captures };
    } finally {
      await session.close();
    }
  }

  /**
   * Signs in using the supplied credentials.
   *
   * Field discovery is by standard semantics (autocomplete, type, name) rather
   * than by asking a model where to type a password — a model that mis-identifies
   * a field would type a customer's credential into a search box that might be
   * logged or shared.
   */
  private async signIn(session: BrowserSession, options: ExploreOptions): Promise<boolean> {
    await session.goto(options.credentials.loginUrl, { waitUntil: 'domcontentloaded' });
    options.onAudit?.({ action: 'navigate', detail: options.credentials.loginUrl });

    const passwordSelector = await firstPresent(session, [
      'input[type="password"]',
      'input[autocomplete="current-password"]',
      'input[name="password"]',
    ]);
    if (!passwordSelector) {
      // No password field: a shared demo link, which is already signed in.
      return true;
    }

    if (options.credentials.username) {
      const userSelector = await firstPresent(session, [
        'input[type="email"]',
        'input[autocomplete="username"]',
        'input[name="email"]',
        'input[name="username"]',
        'input[type="text"]',
      ]);
      if (userSelector) {
        await session.perform([
          { type: 'type', selector: userSelector, text: options.credentials.username },
        ]);
      }
    }

    await session.perform([
      { type: 'type', selector: passwordSelector, text: options.credentials.secret },
      { type: 'press', key: 'Enter' },
      { type: 'wait', ms: 3500 },
    ]);

    const afterUrl = await session.currentUrl();
    const stillOnLogin = /login|signin|sign-in|auth/i.test(afterUrl);
    options.onAudit?.({
      action: stillOnLogin ? 'blocked' : 'session_open',
      // Never record the URL's query string here: magic-link flows put tokens in it.
      detail: stillOnLogin ? 'Still on the sign-in screen after submitting.' : 'Signed in.',
    });
    return !stillOnLogin;
  }

  private async planNavigation(
    session: BrowserSession,
    options: ExploreOptions,
    context: CallContext,
    policy: NavigationPolicy,
  ): Promise<{ path: string; why: string; expectedMoment: string }[]> {
    const capture = await session.capture({ hideChrome: true });
    const inAppLinks = capture.links
      .map((link) => {
        try {
          return { path: new URL(link.href).pathname, text: link.text };
        } catch {
          return null;
        }
      })
      .filter((link): link is { path: string; text: string } => link !== null)
      .filter((link) => link.text.length > 0)
      .slice(0, 80);

    const { value } = await this.llm.completeJson(
      [
        {
          role: 'system',
          content:
            'You are a director scouting a software product for a launch film. ' +
            'You are choosing which screens to visit. Pick screens where something visibly ' +
            'HAPPENS — results appearing, work being done, state changing — over static ' +
            'settings or list views. Never choose billing, admin, security or destructive screens. ' +
            'Return JSON only.',
        },
        {
          role: 'user',
          content:
            `Product: ${options.productName}\n` +
            (options.focus ? `The film is about: ${options.focus}\n` : '') +
            `Paths we are authorised to visit: ${
              policy.allowedPaths.length > 0 ? policy.allowedPaths.join(', ') : 'any path in the app'
            }\n` +
            `Current screen text (truncated):\n${capture.text.slice(0, 4000)}\n\n` +
            `Navigation links available:\n${inAppLinks
              .map((l) => `${l.path} — ${l.text}`)
              .join('\n')}`,
        },
      ],
      { schema: NavigationPlan, schemaName: 'NavigationPlan', tier: 'balanced', temperature: 0.4 },
      context,
    );

    const origin = new URL(await session.currentUrl()).origin;
    return value.targets
      .map((target) => ({ ...target, path: target.path.startsWith('/') ? target.path : `/${target.path}` }))
      // Filter against policy here as well as in the session: failing a
      // navigation is noisier and slower than simply not planning it.
      .filter((target) => {
        const url = `${origin}${target.path}`;
        return !policy.deniedPaths.some((denied) => target.path.toLowerCase().includes(denied)) &&
          (policy.allowedPaths.length === 0 ||
            policy.allowedPaths.some((allowed) => target.path.startsWith(allowed))) &&
          url.length < 400;
      });
  }

  private async captureMomentsAt(
    session: BrowserSession,
    target: { path: string; why: string; expectedMoment: string },
    options: ExploreOptions,
    context: CallContext,
  ): Promise<ExploreResult> {
    const origin = new URL(await session.currentUrl()).origin;
    const url = `${origin}${target.path}`;
    await session.goto(url);
    options.onAudit?.({ action: 'navigate', detail: url });

    const before = await session.capture({ hideChrome: true, freezeAnimations: true });
    options.onAudit?.({ action: 'capture', detail: url });

    const { value } = await this.llm.completeJson(
      [
        {
          role: 'system',
          content:
            'You are identifying filmable moments on a product screen. A moment has a clear ' +
            'before state, one or two harmless interactions (click, hover, scroll), and an after ' +
            'state where something visibly changed. Never propose anything that deletes, sends, ' +
            'pays for, invites, publishes, deploys or signs out. If the screen has no real moment, ' +
            'return an empty list. Return JSON only.',
        },
        {
          role: 'user',
          content:
            `Product: ${options.productName}\nScreen: ${target.path}\n` +
            `We came here expecting: ${target.expectedMoment}\n\n` +
            `Visible text:\n${before.text.slice(0, 5000)}`,
        },
      ],
      { schema: MomentPlan, schemaName: 'MomentPlan', tier: 'balanced', temperature: 0.5 },
      context,
    );

    const moments: ProductMoment[] = [];
    const captures = new Map<string, MomentCapture>();

    for (const planned of value.moments) {
      const steps: InteractionStep[] = planned.steps
        .map((step): InteractionStep | null => {
          switch (step.action) {
            case 'click':
              return step.selector
                ? { type: 'click', selector: step.selector, description: step.description }
                : null;
            case 'hover':
              return step.selector
                ? { type: 'hover', selector: step.selector, description: step.description }
                : null;
            case 'scroll':
              return { type: 'scroll', y: step.y, description: step.description };
            case 'wait':
              return { type: 'wait', ms: step.ms, description: step.description };
          }
        })
        .filter((step): step is InteractionStep => step !== null);

      const startShot = await session.screenshot({
        hideChrome: true,
        ...(planned.focusSelector ? { selector: planned.focusSelector } : {}),
      });

      let endShot: Uint8Array | null = null;
      let recordedSteps: string[] = [];
      if (steps.length > 0) {
        try {
          await session.perform(steps);
          recordedSteps = steps.map((s) => s.description ?? s.type);
          endShot = await session.screenshot({
            hideChrome: true,
            ...(planned.focusSelector ? { selector: planned.focusSelector } : {}),
          });
        } catch (error) {
          if (error instanceof PolicyViolation) {
            options.onAudit?.({ action: 'blocked', detail: error.message });
            // The moment is still usable as a static state; we just do not
            // claim an after state we never reached.
          } else {
            endShot = null;
          }
        }
      }

      const bounds = planned.focusSelector ? await session.boundsOf(planned.focusSelector) : null;

      moments.push({
        // Stable across crawls, for the same reason evidence ids are: a scene
        // points at the moment it dramatises, and re-reading the product must
        // not orphan that link.
        id: derivedId('mom', url, planned.title),
        title: planned.title,
        description: planned.description,
        startState: planned.startState,
        endState: endShot ? planned.endState : planned.startState,
        // Screenshots are handed back as raw bytes via the sidecar below; the
        // ids are filled in by the caller once they are in our storage.
        screenshots: [],
        recording: null,
        sourceUrl: url,
        wowScore: endShot ? planned.wowScore : Math.min(planned.wowScore, 0.5),
        // A moment we actually reached outranks one we only described.
        relevanceScore: planned.relevanceScore,
        interactionSteps: recordedSteps,
        requiresAuth: true,
        elementBounds: bounds,
      });

      captures.set(moments[moments.length - 1]!.id, { before: startShot, after: endShot });

      // Reset for the next moment on this screen.
      await session.goto(url);
    }

    return { moments, captures };
  }
}

async function firstPresent(session: BrowserSession, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    if (await session.boundsOf(selector)) return selector;
  }
  return null;
}
