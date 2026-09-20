import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { newId, type Job, type Organization, type Project, type User } from '@act-one/core';
import { MemoryStore, type Store } from '@act-one/db';
import {
  LocalFsStorageProvider,
  NullCostSink,
  ProviderRegistry,
  ScriptedLlmProvider,
  type BrowserAutomationProvider,
  type BrowserSession,
  type PageCapture,
} from '@act-one/providers';
import { runJob } from '../runner.ts';

/**
 * Pipeline integration.
 *
 * Runs the real runner, the real stages and the real Store contract against a
 * scripted model and a fake browser. Nothing here is mocked at the seam we care
 * about — the stages do not know they are being tested — so this catches the
 * class of bug that unit tests cannot: a stage that persists the wrong thing,
 * advances the wrong state, or enqueues nothing when it should chain.
 */
const HOMEPAGE_TEXT = `Northwind
Close the books without a week of manual matching.
Northwind reconciles invoices automatically so finance teams stop chasing spreadsheets.
Teams close their books 3x faster with automated reconciliation.
Built for controllers at mid-market companies.
Trusted by 400 finance teams.`;

function capture(url: string): PageCapture {
  return {
    url,
    title: 'Northwind — automated reconciliation',
    text: HOMEPAGE_TEXT,
    html:
      '<html><head><meta name="description" content="Northwind reconciles invoices automatically."/>' +
      '<meta name="theme-color" content="#2f6fed"/></head><body></body></html>',
    screenshot: new Uint8Array([137, 80, 78, 71]),
    styleProfile: {
      colorWeights: [
        { color: '#ffffff', weight: 900000, role: 'background' },
        { color: '#0a0a0c', weight: 22000, role: 'text' },
        { color: '#2f6fed', weight: 14000, role: 'accent' },
      ],
      fontFamilies: [
        { family: 'Inter', weight: 9000, usage: 'display' },
        { family: 'Inter', weight: 4200, usage: 'body' },
      ],
      borderRadii: [8, 8, 8, 12],
      spacingScale: [8, 16, 24, 32],
      hasGradients: false,
      hasGlow: false,
      logoCandidates: [{ src: '/logo.svg', alt: 'Northwind', width: 120, height: 32 }],
      maxHeadingSizePx: 60,
      bodySizePx: 16,
    },
    links: [
      { href: 'https://northwind.example/pricing', text: 'Pricing' },
      { href: 'https://northwind.example/product', text: 'How it works' },
    ],
    statusCode: 200,
    capturedAt: new Date().toISOString(),
  };
}

/** A browser that returns fixed captures. The session contract is honoured exactly. */
class FakeBrowserProvider implements BrowserAutomationProvider {
  readonly name = 'fake-browser';
  readonly kind = 'browser' as const;
  visited: string[] = [];

  async health() {
    return { provider: this.name, kind: 'browser' as const, healthy: true, checkedAt: new Date().toISOString() };
  }

  async createSession(): Promise<BrowserSession> {
    let current = 'https://northwind.example/';
    const visited = this.visited;
    return {
      id: 'fake',
      async goto(url) {
        current = url;
        visited.push(url);
      },
      async capture() {
        return capture(current);
      },
      async screenshot() {
        return new Uint8Array([137, 80, 78, 71]);
      },
      async boundsOf() {
        return null;
      },
      async perform() {},
      async record() {
        return { video: null, frames: [], durationSeconds: 0 };
      },
      async currentUrl() {
        return current;
      },
      async clearState() {},
      async close() {},
    };
  }
}

const UNDERSTANDING_RESPONSE = {
  name: 'Northwind',
  oneLiner: 'Closes the books without a week of manual matching.',
  category: 'Finance automation',
  targetAudience: ['Controllers at mid-market companies'],
  painPoints: [{ text: 'Finance teams chase spreadsheets to reconcile invoices', evidenceIds: [] }],
  keyBenefits: [{ text: 'Reconciles invoices automatically', evidenceIds: [] }],
  differentiators: [{ text: 'Teams close their books 3x faster with automated reconciliation', evidenceIds: [] }],
  coreFeatures: [{ text: 'Automated reconciliation', evidenceIds: [] }],
  proofPoints: [{ text: 'Trusted by 400 finance teams', evidenceIds: [] }],
  tone: 'Direct and plain-spoken.',
  brandTraits: ['precise'],
  competitorCategory: 'Close management',
  productMaturity: 'growth',
  launchContext: 'product_launch',
  gaps: [],
  suggestedMoments: [
    {
      title: 'Reconciliation runs',
      description: 'Unmatched rows resolve to zero',
      startState: '40 unmatched rows',
      endState: '0 unmatched rows',
      relevanceScore: 0.9,
      evidenceIds: [],
    },
  ],
};

let conceptCount = 0;
const CONCEPT_IDEAS = [
  'A week of manual matching disappears into a single automated run',
  'Finance stops being the department everyone else waits for',
  'The ledger reconciles itself overnight while nobody is watching',
];

function conceptResponse() {
  const idea = CONCEPT_IDEAS[Math.min(conceptCount, CONCEPT_IDEAS.length - 1)]!;
  const emotion = ['relief', 'confidence', 'ambition'][conceptCount % 3]!;
  conceptCount += 1;
  return {
    name: `Direction ${conceptCount}`,
    keyIdea: idea,
    hook: `Hook number ${conceptCount} that opens the film`,
    targetEmotion: emotion,
    productAngle: 'angle',
    visualDirection: 'Dark and restrained',
    motionDirection: 'Slow pushes',
    soundDirection: 'Sub-heavy',
    productUiUsage: 'The real reconciliation screen',
    generativeUsage: 'None',
    estimatedDurationSeconds: 45,
    recommendedChannels: ['homepage_hero'],
    keyScenes: ['Rows pile up', 'One run', 'Zero remaining'],
    momentIds: [],
  };
}

const TREATMENT_RESPONSE = {
  title: 'One run',
  tagline: 'Close the books while you sleep.',
  script: 'Forty rows.\nOne run.\nZero left.',
  visualLanguage: 'Near-black canvas, one idea per frame, generous space.',
  typographyDirection: 'Large display type, flush left, two lines maximum.',
  cameraLanguage: 'Single-axis slow pushes. Never two moves at once.',
  rhythm: 'Long holds broken by one hard cut at the turn.',
  motionStyleNotes: 'Precise, confident, nothing springy.',
  soundStyle: 'Sub-heavy and sparse. Silence before the first impact.',
  voiceStrategy: 'none',
  voiceRationale: 'The on-screen text says it better than a voice would.',
  generativeMediaStrategy: 'None. The product carries the film.',
  productUiUsage: 'The reconciliation run, shown once, in full.',
  exclusions: ['No voice-over', 'No stock imagery of people at laptops'],
  cta: 'northwind.example',
};

const SCENE_PLAN = {
  scenes: [
    { archetypeId: 'statement', purpose: 'Open on the problem', onScreenText: ['Forty unmatched rows.'], narration: '', momentId: null, generativeBrief: '', claimText: '' },
    { archetypeId: 'statement', purpose: 'State the shift', onScreenText: ['One run.'], narration: '', momentId: null, generativeBrief: '', claimText: '' },
    { archetypeId: 'proof', purpose: 'Land the proof', onScreenText: ['0 remaining'], narration: '', momentId: null, generativeBrief: '', claimText: '' },
    { archetypeId: 'statement', purpose: 'Sign off', onScreenText: ['Close the books while you sleep.'], narration: '', momentId: null, generativeBrief: '', claimText: '' },
  ],
};

/**
 * The Director Brain's answers, scripted.
 *
 * Matched on the system prompt like everything else here, so the pipeline runs
 * its real direction stage — understanding, a wide search, a panel that
 * disagrees, an arbitration — against a model that returns the same thing
 * every time. What is being tested is the wiring and the arithmetic, not the
 * model: that the chosen direction actually reaches the concepts, that a
 * rejected direction is written down with its reason, and that a critic
 * conflict arrives at the director rather than being averaged away.
 */
const BRIEF_RESPONSE = {
  goal: {
    business: 'demo_request', desiredAction: 'Book a walkthrough of the close',
    friction: 'medium', awarenessStage: 'problem_aware',
    proofRequired: ['A real close, end to end'], ctaStrength: 'stated',
  },
  transformation: {
    before: 'Closing the books takes a week and there is no way around it.',
    after: 'The close can run once, unattended, and be trusted.',
    pivot: 'Seeing a real month close in one run.',
  },
  creativeObjective:
    'A finance lead should believe, within ten seconds, that the month can close in one run and that the run is trustworthy.',
  constraints: [], avoid: ['stock people at laptops'], because: 'Read from their own pricing and docs.',
};

const AUDIENCE_RESPONSE = {
  who: 'Finance leads at 200–2000 person companies',
  economicBuyer: 'The CFO', knows: ['Reconciliation is manual'], doesNotKnow: ['That it can be automated safely'],
  statusQuo: 'A week of spreadsheets and a shared inbox',
  frustrations: ['The same week every month'], desires: ['To leave on time in the first week'],
  objections: ['Automation will be wrong and I will not know'],
  decisionCriteria: ['Auditability'], likelyMisconceptions: ['That this is another reporting tool'],
  sophistication: 'practitioner', attentionContext: 'On a laptop, in a tab, probably muted',
  riskTolerance: 'low', categoryLanguage: ['close', 'reconciliation'], because: 'Read from the site.',
};

const GENOME_RESPONSE = {
  dimensions: {
    rationality: 0.85, expressiveness: 0.25, visualDensity: 0.3, motionEnergy: 0.35,
    humour: 0.05, sophistication: 0.8, warmth: 0.3, confidence: 0.7, minimalism: 0.8, technicality: 0.7,
  },
  archetype: 'the_engineer',
  productPresentation: 'The real interface, held, never staged.',
  languageBehaviour: 'Short declaratives. No exclamation marks.',
  motionBehaviour: 'Single-axis, slow, never two moves at once.',
  taboos: ['never animates the logo', 'never uses an exclamation mark'],
  because: 'Read from their own writing.',
};

const TERRITORIES_RESPONSE = {
  territories: [
    {
      name: 'The quiet close', premise: 'A month closes in one run while nobody watches.',
      mechanism: 'data_proof', rationale: 'It answers the auditability objection directly.',
      emotion: 'relief', productRole: 'evidence', opening: 'A ledger, already closed.',
      risk: 'It could read as cold.',
    },
    {
      name: 'The week that vanished', premise: 'A person who used to dread the first week now leaves at six.',
      mechanism: 'human_transformation', rationale: 'The pain is felt, not described.',
      emotion: 'release', productRole: 'context', opening: 'An empty desk at six in the evening.',
      risk: 'It could read as sentimental and prove nothing.',
    },
    {
      name: 'Everything at once', premise: 'Every ledger in the company, reconciled in a single sweep.',
      mechanism: 'world_building', rationale: 'Scale is the argument.',
      emotion: 'awe', productRole: 'hero', opening: 'A city of ledgers at night.',
      risk: 'Spectacle with no proof under it.',
    },
  ],
};

/** A panel that genuinely disagrees, which is what the director is for. */
const CRITIC_RESPONSES: { when: RegExp; respond: unknown }[] = [
  {
    when: /you are the conversion specialist/i,
    respond: {
      verdict: 'revise',
      findings: [
        {
          severity: 'high', observation: 'The quiet close never asks for anything.',
          evidence: ['the quiet close'], risk: 'No demo requests.',
          recommendation: 'End on a spoken call to action.', confidence: 0.8,
        },
      ],
      headline: 'Nothing is asked for.',
    },
  },
  {
    when: /you are the film critic/i,
    respond: {
      verdict: 'pass',
      findings: [
        {
          severity: 'medium', observation: 'A spoken call to action would land on the held beat.',
          evidence: ['the quiet close'], risk: 'The ending stops working.',
          recommendation: 'Keep the ending silent.', confidence: 0.75,
        },
      ],
      headline: 'The ending is the film.',
    },
  },
  { when: /you are the brand guardian/i, respond: { verdict: 'pass', findings: [], headline: '' } },
  { when: /you are the product marketer/i, respond: { verdict: 'pass_with_concerns', findings: [], headline: '' } },
  { when: /you are the originality critic/i, respond: { verdict: 'pass', findings: [], headline: '' } },
];

const SELECTION_RESPONSE = {
  selectedId: 'PLACEHOLDER',
  reason: 'It proves the thing the audience objects to, which the other two only assert.',
  thesis: 'A month closes in one run, and you can watch it happen.',
  rejections: [],
  arbitrations: [
    {
      between: ['conversion', 'film'],
      conflict: 'Conversion wants a spoken call to action; film says it would land on the held beat.',
      resolution: 'The address is on screen at the end. Nothing is spoken.',
    },
  ],
  weakest: 'The opening asks for patience it has not yet earned.',
};

function scriptedLlm() {
  return new ScriptedLlmProvider([
    { when: /research lead at a creative studio/i, respond: UNDERSTANDING_RESPONSE },
    { when: /you are a strategist writing the brief/i, respond: BRIEF_RESPONSE },
    { when: /you model the person who will watch/i, respond: AUDIENCE_RESPONSE },
    { when: /you read brands as behaviour/i, respond: GENOME_RESPONSE },
    { when: /put genuinely different directions on the table/i, respond: TERRITORIES_RESPONSE },
    ...CRITIC_RESPONSES,
    {
      when: /you are the creative director of a studio/i,
      /*
       * The director names an id it cannot know in advance. Returning one that
       * is not on the shortlist exercises the path that matters more: the
       * brain falls back to the strongest shortlisted direction and records
       * that its choice was not honoured, rather than failing the production.
       */
      respond: SELECTION_RESPONSE,
    },
    {
      when: /how a brand speaks/i,
      respond: { language: 'en', vocabulary: ['reconcile', 'ledger'], positioning: 'The reconciliation layer.', claims: [], naming: 'Northwind', tagline: 'Reconcile everything.', wordsToAvoid: ['cheap'] },
    },
    { when: /creative strategist at a studio/i, respond: () => conceptResponse() },
    { when: /you are the creative director/i, respond: TREATMENT_RESPONSE },
    { when: /storyboarding an approved treatment/i, respond: SCENE_PLAN },
  ]);
}

async function makeRegistry(): Promise<ProviderRegistry> {
  const root = await mkdtemp(path.join(tmpdir(), 'act-one-pipeline-'));
  return new ProviderRegistry({
    costSink: new NullCostSink(),
    overrides: {
      llm: scriptedLlm(),
      browser: new FakeBrowserProvider(),
      storage: new LocalFsStorageProvider({ root }),
    },
  });
}

/**
 * Enqueues a job and claims it, the way a worker would.
 *
 * Constructing a Job object in memory and handing it to the runner looks
 * equivalent and is not: the runner reports progress and completion back to the
 * store by id, so a job that was never enqueued fails on the first update. This
 * helper exercises the real claim path instead.
 */
async function enqueued(
  store: Store,
  organizationId: string,
  projectId: string,
  kind: Job['kind'],
  payload: Record<string, unknown> = {},
): Promise<Job> {
  const now = new Date().toISOString();
  await store.jobs.enqueue({
    id: newId('job'), organizationId, projectId, kind, state: 'queued', payload,
    progress: 0, statusMessage: '', attempts: 0, maxAttempts: 3, lastError: null, lastErrorCode: null,
    runAfter: now, lockedBy: null, lockedAt: null, startedAt: null, priority: 0, createdAt: now, updatedAt: now,
  });
  const claimed = await store.jobs.claim('test-worker', [kind]);
  if (!claimed) throw new Error(`Nothing claimable for ${kind}`);
  return claimed;
}

describe('pipeline', () => {
  let store: Store;
  let org: Organization;
  let user: User;
  let project: Project;
  let deps: Awaited<ReturnType<typeof makeDeps>>;

  async function makeDeps() {
    const registry = await makeRegistry();
    return {
      store,
      workerId: 'test-worker',
      buildRegistry: async () => registry,
    };
  }

  beforeEach(async () => {
    conceptCount = 0;
    store = new MemoryStore();
    const now = new Date().toISOString();

    org = await store.organizations.create({
      id: newId('org'), name: 'Acme', slug: 'acme', planId: 'pro', stripeCustomerId: null,
      creditBalance: 5000, maxProjectCostUsd: 120, isSuspended: false, createdAt: now,
    });
    user = await store.users.create({
      id: newId('usr'), email: 'a@acme.com', name: 'A', avatarUrl: null,
      isSuperAdmin: false, createdAt: now,
    });
    project = await store.projects.create({
      id: newId('prj'), organizationId: org.id, createdByUserId: user.id, name: 'Northwind',
      websiteUrl: 'https://northwind.example/', supplementalUrls: [], brandId: null,
      productUnderstandingId: null, selectedConceptId: null, activeStoryboardId: null,
      latestRenderId: null, stage: 'created',
      brief: {
        filmFormat: 'product_tour', filmCut: 'feature', targetAudience: null, goal: null, keyMessage: null, durationSeconds: 45, channels: [],
        creativeMode: 'studio', voiceStrategy: null, formats: [], excludedClaims: [], realMediaOnly: false, language: null, tone: null, voiceGender: null, voiceAccent: null, voiceStyle: null, voicePace: null,
      },
      productCredentialId: null, costUsd: 0, creditsSpent: 0, archivedAt: null,
      createdAt: now, updatedAt: now,
    });

    deps = await makeDeps();
  });

  it('researches a product, stores a cited brief and a measured brand', async () => {
    const outcome = await runJob(deps, await enqueued(store, org.id, project.id, 'research_product'));
    expect(outcome.status).toBe('completed');

    const understanding = await store.understandings.getLatestForProject(org.id, project.id);
    expect(understanding).not.toBeNull();
    expect(understanding!.name).toBe('Northwind');
    expect(understanding!.evidence.length).toBeGreaterThan(0);

    // The claim about 3x is in the page text, so it must survive verification.
    const claims = [...understanding!.differentiators, ...understanding!.proofPoints];
    expect(claims.some((claim) => claim.text.includes('3x'))).toBe(true);
    for (const claim of claims) expect(claim.evidenceIds.length).toBeGreaterThan(0);

    const brands = await store.brands.list(org.id);
    expect(brands).toHaveLength(1);
    // Measured from the page, not the white background.
    expect(brands[0]!.primaryColor).toBe('#2f6fed');
    expect(brands[0]!.cornerRadiusPx).toBe(8);

    const updated = await store.projects.get(org.id, project.id);
    expect(updated!.stage).toBe('understanding_ready');
    expect(updated!.brandId).toBe(brands[0]!.id);

    // The trail: every page read, kept with its screenshot and what it gave.
    const sources = await store.researchSources.listForProject(org.id, project.id);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0]).toMatchObject({ pageType: 'home', domain: 'northwind.example', useful: true, statusCode: 200 });
    expect(sources[0]!.screenshotAssetId).toMatch(/^ast_/);
    expect(sources[0]!.findings.length).toBeGreaterThan(0);
    const kept = await store.assets.get(org.id, sources[0]!.screenshotAssetId!);
    expect(kept).toMatchObject({ kind: 'screenshot', origin: 'captured' });
    expect(kept!.metadata).toMatchObject({ role: 'research', source: 'browser_research', pageType: 'home' });
    // ...and in the library, named, categorised, attached to the project,
    // tagged with where it came from — with nothing but the page's address.
    expect(kept).toMatchObject({ library: true, category: 'screenshot', categorySource: 'inferred', source: 'browser_research' });
    expect(kept!.name.length).toBeGreaterThan(0);
    expect(kept!.sourceUrl).not.toMatch(/[?#]/);
    const inLibrary = await store.assets.listLibraryForProject(org.id, project.id);
    expect(inLibrary.map((asset) => asset.id)).toContain(kept!.id);
    expect(inLibrary.every((asset) => asset.source === 'browser_research')).toBe(true);

    // The activity the customer watched: pages as they were read, then the steps.
    const events = await store.jobEvents.listForProject(org.id, project.id);
    const pages = events.filter((event) => event.kind === 'page');
    expect(pages.length).toBe(sources.length);
    expect(pages[0]).toMatchObject({ step: 'research', label: 'homepage', status: 'done', index: 0 });
    expect(events.some((event) => event.step === 'brand' && event.status === 'done')).toBe(true);
    expect(events.some((event) => event.kind === 'step' && event.label === 'extracting positioning')).toBe(true);

    // The brand is the project's own, unconfirmed, with what the site says about itself.
    expect(brands[0]).toMatchObject({ projectId: project.id, parentBrandId: null, confirmedByUser: false });
    expect(brands[0]!.communication.tagline).toBe('Reconcile everything.');
  });

  it('starts a second project from the confirmed brand and keeps its own reading as signals', async () => {
    await runJob(deps, await enqueued(store, org.id, project.id, 'research_product'));
    const first = (await store.brands.list(org.id))[0]!;
    // A person confirms the first project's brand, with a colour of their own.
    await store.brands.update(org.id, first.id, { confirmedByUser: true, confirmedAt: new Date().toISOString(), primaryColor: '#111111', overrides: ['colors'] });

    const now = new Date().toISOString();
    const second = await store.projects.create({
      ...project,
      id: newId('prj'), name: 'Northwind again', brandId: null, productUnderstandingId: null, createdAt: now, updatedAt: now,
    });
    await runJob(deps, await enqueued(store, org.id, second.id, 'research_product'));

    const updated = await store.projects.get(org.id, second.id);
    const inherited = await store.brands.get(org.id, updated!.brandId!);
    expect(inherited).not.toBeNull();
    expect(inherited!.id).not.toBe(first.id);
    expect(inherited).toMatchObject({ projectId: second.id, parentBrandId: first.id, confirmedByUser: true, primaryColor: '#111111', overrides: ['colors'] });
    // The fresh reading measured the site's blue; it is proposed, not applied.
    const pending = inherited!.signals.filter((signal) => signal.status === 'pending');
    expect(pending.map((signal) => signal.field)).toContain('primaryColor');
    expect(pending.find((signal) => signal.field === 'primaryColor')).toMatchObject({ current: '#111111', proposed: '#2f6fed', projectId: second.id });
    // The first project's brand is untouched.
    expect((await store.brands.get(org.id, first.id))!.signals).toEqual([]);

    // Reading the second project again proposes nothing new.
    await runJob(deps, await enqueued(store, org.id, second.id, 'research_product'));
    const again = await store.brands.get(org.id, updated!.brandId!);
    expect(again!.signals.filter((signal) => signal.status === 'pending')).toHaveLength(pending.length);
    expect((await store.brands.list(org.id))).toHaveLength(2);
  });

  it('chains straight into concepts without waiting for another button', async () => {
    await runJob(deps, await enqueued(store, org.id, project.id, 'research_product'));
    const queued = await store.jobs.listForProject(org.id, project.id);
    expect(queued.some((entry) => entry.kind === 'generate_concepts')).toBe(true);
  });

  it('produces three genuinely different concepts', async () => {
    await runJob(deps, await enqueued(store, org.id, project.id, 'research_product'));
    const outcome = await runJob(deps, await enqueued(store, org.id, project.id, 'generate_concepts'));
    expect(outcome.status).toBe('completed');

    const concepts = await store.concepts.listForProject(org.id, project.id);
    expect(concepts).toHaveLength(3);
    expect(new Set(concepts.map((c) => c.narrativeStructure)).size).toBe(3);
    expect(new Set(concepts.map((c) => c.creativeSystem)).size).toBe(3);
    expect((await store.projects.get(org.id, project.id))!.stage).toBe('concepts_ready');
  });

  it('builds a storyboard whose text is legible in the time it is on screen', async () => {
    await runJob(deps, await enqueued(store, org.id, project.id, 'research_product'));
    await runJob(deps, await enqueued(store, org.id, project.id, 'generate_concepts'));

    const concepts = await store.concepts.listForProject(org.id, project.id);
    await store.concepts.select(org.id, project.id, concepts[0]!.id);
    await store.projects.update(org.id, project.id, { selectedConceptId: concepts[0]!.id });

    const outcome = await runJob(deps, await enqueued(store, org.id, project.id, 'build_storyboard', { conceptId: concepts[0]!.id }));
    expect(outcome.status).toBe('completed');

    const boards = await store.storyboards.listForProject(org.id, project.id);
    expect(boards).toHaveLength(1);
    const board = boards[0]!;
    expect(board.scenes.length).toBeGreaterThanOrEqual(3);

    for (const scene of board.scenes) {
      const words = scene.onScreenText.join(' ').split(/\s+/).filter(Boolean).length;
      if (words === 0) continue;
      // Reading time plus arrival. A scene that fails this ships clipped text.
      expect(scene.duration, `scene ${scene.index}`).toBeGreaterThanOrEqual(0.45 + words / 2.6 - 0.01);
    }

    // Timing must be internally consistent or the render drifts from the plan.
    let cursor = 0;
    for (const scene of board.scenes) {
      expect(scene.startTime).toBeCloseTo(cursor, 2);
      cursor += scene.duration;
    }

    const updated = await store.projects.get(org.id, project.id);
    expect(updated!.activeStoryboardId).toBe(board.id);
    expect(updated!.stage).toBe('storyboard_ready');
  });

  it('applies a natural-language revision to only the scenes it affects', async () => {
    await runJob(deps, await enqueued(store, org.id, project.id, 'research_product'));
    await runJob(deps, await enqueued(store, org.id, project.id, 'generate_concepts'));
    const concepts = await store.concepts.listForProject(org.id, project.id);
    await store.projects.update(org.id, project.id, { selectedConceptId: concepts[0]!.id });
    await runJob(deps, await enqueued(store, org.id, project.id, 'build_storyboard', { conceptId: concepts[0]!.id }));

    const board = (await store.storyboards.listForProject(org.id, project.id))[0]!;
    const before = new Map(board.scenes.map((scene) => [scene.id, scene.duration]));

    const outcome = await runJob(
      deps,
      await enqueued(store, org.id, project.id, 'repair_scene', {
        storyboardId: board.id,
        instruction: 'The opening is too slow.',
        authorUserId: user.id,
      }),
    );
    expect(outcome.status).toBe('completed');

    const after = (await store.storyboards.get(org.id, board.id))!;
    const changed = after.scenes.filter((scene) => before.get(scene.id) !== scene.duration);

    expect(changed.length).toBeGreaterThan(0);
    // Not every scene: a scoped revision that rewrites the whole film is not scoped.
    expect(changed.length).toBeLessThan(after.scenes.length);

    const revisions = await store.revisions.listForStoryboard(org.id, board.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.applied).toBe(true);
    expect(revisions[0]!.intent).toBe('retime_scene');
  });

  it('applies the proposal the customer confirmed, as proposed, and regenerates the film', async () => {
    await runJob(deps, await enqueued(store, org.id, project.id, 'research_product'));
    await runJob(deps, await enqueued(store, org.id, project.id, 'generate_concepts'));
    const concepts = await store.concepts.listForProject(org.id, project.id);
    await store.projects.update(org.id, project.id, { selectedConceptId: concepts[0]!.id });
    await runJob(deps, await enqueued(store, org.id, project.id, 'build_storyboard', { conceptId: concepts[0]!.id }));
    const board = (await store.storyboards.listForProject(org.id, project.id))[0]!;
    const first = board.scenes[0]!;

    // What was written back and confirmed: one scene, faster. The sentence
    // itself is vague on purpose — it is the proposal that must be applied.
    const now = new Date().toISOString();
    await store.revisions.create(
      {
        id: 'cmt_confirmed',
        projectId: project.id,
        storyboardId: board.id,
        authorUserId: user.id,
        instruction: 'Hmm, the start.',
        intent: 'retime_scene',
        affectedSceneIds: [first.id],
        applied: false,
        appliedAt: null,
        status: 'confirmed',
        proposal: {
          intent: 'retime_scene',
          affectedSceneIds: [first.id],
          requestedSubject: '',
          direction: 'faster',
          needsRecapture: false,
          summary: 'Retiming 1 scene.',
          rerender: true,
        },
        reply: 'Retiming 1 scene. It touches scene 1. The film will be re-rendered with the change. Shall I go ahead?',
        decidedAt: now,
        createdAt: now,
      },
      org.id,
    );

    const outcome = await runJob(
      deps,
      await enqueued(store, org.id, project.id, 'repair_scene', {
        storyboardId: board.id,
        instruction: 'Hmm, the start.',
        authorUserId: user.id,
        revisionRequestId: 'cmt_confirmed',
        rerender: true,
      }),
    );
    expect(outcome.status).toBe('completed');

    const after = (await store.storyboards.get(org.id, board.id))!;
    const changed = after.scenes.filter((scene, index) => scene.duration !== board.scenes[index]!.duration);
    expect(changed.map((scene) => scene.id)).toEqual([first.id]);

    const revisions = await store.revisions.listForStoryboard(org.id, board.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ id: 'cmt_confirmed', status: 'applied', applied: true });

    // Regenerating is the point of confirming once a film exists.
    const jobs = await store.jobs.listForProject(org.id, project.id);
    expect(jobs.some((job) => job.kind === 'render_film' && job.state === 'queued')).toBe(true);
  });

  it('refuses to render invented software as somebody\u2019s product', async () => {
    await runJob(deps, await enqueued(store, org.id, project.id, 'research_product'));
    await runJob(deps, await enqueued(store, org.id, project.id, 'generate_concepts'));
    const concepts = await store.concepts.listForProject(org.id, project.id);
    await store.projects.update(org.id, project.id, { selectedConceptId: concepts[0]!.id });
    await runJob(deps, await enqueued(store, org.id, project.id, 'build_storyboard', { conceptId: concepts[0]!.id }));

    const board = (await store.storyboards.listForProject(org.id, project.id))[0]!;

    // A generated shot, of the kind the media provider returns.
    const generated = await store.assets.create({
      id: newId('ast'), organizationId: org.id, projectId: project.id, conceptId: null,
      sceneId: board.scenes[0]!.id, kind: 'generated_video', origin: 'generated',
      rights: 'generated_derivative', storageKey: 'fake/shot.mp4', contentType: 'video/mp4',
      bytes: 10, width: 1920, height: 1080, durationSeconds: 3, checksum: null,
      provider: 'higgsfield', model: 'test', sourceUrl: null, costUsd: 0, metadata: {},
      createdAt: new Date().toISOString(),
    });

    // However it got there — a revision, a repair, a bug — a scene that says it
    // shows the product is now backed by imagery a model invented.
    await store.storyboards.updateScene(org.id, board.scenes[0]!.id, {
      visualType: 'product_ui',
      assetRefs: [generated.id],
    });

    const outcome = await runJob(
      deps,
      await enqueued(store, org.id, project.id, 'render_film', { storyboardId: board.id }),
    );

    expect(outcome.status).toBe('failed');
    // And it stops before a single frame is rendered, rather than being caught
    // by QA after the film has been paid for.
    expect(outcome.status === 'failed' && outcome.error).toMatch(/generated material/i);
    expect(outcome.status === 'failed' && outcome.retryable).toBe(false);
  });

  it('refuses a pitch that has quietly become a product tour', async () => {
    /*
     * A pitch may cut to the product; it may not be led by it. A revision, a
     * repair or a change of format after storyboarding can all turn that
     * cutaway into a walkthrough, so it is checked where the frames are about
     * to be made rather than trusted to hold because of how the storyboard was
     * planned.
     */
    await runJob(deps, await enqueued(store, org.id, project.id, 'research_product'));
    await runJob(deps, await enqueued(store, org.id, project.id, 'generate_concepts'));
    const concepts = await store.concepts.listForProject(org.id, project.id);
    await store.projects.update(org.id, project.id, { selectedConceptId: concepts[0]!.id });
    await runJob(deps, await enqueued(store, org.id, project.id, 'build_storyboard', { conceptId: concepts[0]!.id }));

    const board = (await store.storyboards.listForProject(org.id, project.id))[0]!;
    // Driven, not merely shown: a cursor crossing a live interface is a
    // demonstration however briefly it runs.
    await store.storyboards.updateScene(org.id, board.scenes[1]!.id, { visualType: 'product_ui' });

    const stored = (await store.projects.get(org.id, project.id))!;
    await store.projects.update(org.id, project.id, {
      brief: { ...stored.brief, filmFormat: 'pitch' },
    });

    const outcome = await runJob(
      deps,
      await enqueued(store, org.id, project.id, 'render_film', { storyboardId: board.id }),
    );

    expect(outcome.status).toBe('failed');
    expect(outcome.status === 'failed' && outcome.error).toMatch(/become a product tour/i);
    // Failing identically forever: retrying it only costs money.
    expect(outcome.status === 'failed' && outcome.retryable).toBe(false);
  });

  it('records a failure against the project instead of spinning forever', async () => {
    // No research has run, so there is no concept to storyboard.
    const outcome = await runJob(deps, await enqueued(store, org.id, project.id, 'build_storyboard'));
    expect(outcome.status).toBe('failed');
    // A conflict will fail identically forever; retrying it only costs money.
    expect(outcome.status === 'failed' && outcome.retryable).toBe(false);
    expect((await store.projects.get(org.id, project.id))!.stage).toBe('failed');
  });

  it('never fails the project over a side errand beside a finished film', async () => {
    /*
     * The film is delivered. A master in another language fails — the render
     * it was asked to translate does not exist — and the project must still
     * say it has a film, because it does. Putting a red status over the top of
     * a page showing somebody their finished film is the worst thing this can
     * say to them.
     */
    await store.projects.setStage(org.id, project.id, 'film_ready');
    const outcome = await runJob(
      deps,
      await enqueued(store, org.id, project.id, 'localise_film', { renderId: 'rnd_gone', language: 'de' }),
    );
    expect(outcome.status).toBe('failed');
    expect((await store.projects.get(org.id, project.id))!.stage).toBe('film_ready');
  });

  it('cancels rather than failing when the project was deleted mid-queue', async () => {
    const orphan = await enqueued(store, org.id, 'prj_gone', 'research_product');
    const outcome = await runJob(deps, orphan);
    expect(outcome.status).toBe('skipped');
  });

  it('never lets one tenant’s job touch another tenant’s project', async () => {
    const other = await store.organizations.create({
      id: newId('org'), name: 'Globex', slug: 'globex', planId: 'free', stripeCustomerId: null,
      creditBalance: 0, maxProjectCostUsd: 120, isSuspended: false, createdAt: new Date().toISOString(),
    });
    // The job claims Globex's organisation but points at Acme's project.
    const outcome = await runJob(deps, await enqueued(store, other.id, project.id, 'research_product'));
    expect(outcome.status).toBe('skipped');
    // And Acme's project is untouched.
    expect((await store.projects.get(org.id, project.id))!.stage).toBe('created');
  });

  /**
   * The direction stage, doing the thing it was built for.
   *
   * Not "does it run" — the tests above already prove that, because the
   * concept stage now goes through it. These are the claims the stage
   * actually makes, and every one of them was false before it existed.
   */
  describe('the film is directed before it is written', () => {
    it('understands, explores, arbitrates, and writes all of it down', async () => {
      await runJob(deps, await enqueued(store, org.id, project.id, 'research_product'));
      await runJob(deps, await enqueued(store, org.id, project.id, 'generate_concepts'));

      // 1. It understood something. The transformation is the line every
      //    later decision is argued from, and nothing before this stated one.
      const brief = (await store.creative.latestModel(org.id, project.id, 'brief')) as {
        transformation: { before: string; after: string };
        creativeObjective: string;
        goal: { business: string };
      } | null;
      expect(brief?.transformation.before).toContain('takes a week');
      expect(brief?.creativeObjective).toContain('one run');
      // The business objective and the creative objective are different
      // fields because they are different sentences.
      expect(brief?.goal.business).toBe('demo_request');

      const audience = (await store.creative.latestModel(org.id, project.id, 'audience')) as { objections: string[] } | null;
      expect(audience?.objections[0]).toContain('will be wrong');

      const genome = (await store.creative.latestModel(org.id, project.id, 'genome')) as { taboos: string[] } | null;
      expect(genome?.taboos).toContain('never animates the logo');

      // 2. It explored a field, and kept the ones that died.
      const territories = await store.creative.listTerritories(org.id, project.id);
      expect(territories.length).toBeGreaterThanOrEqual(3);
      expect(territories.filter((row) => row.selected)).toHaveLength(1);
      const rejected = territories.filter((row) => !row.selected);
      expect(rejected.length).toBeGreaterThanOrEqual(2);
      // A rejected direction survives whole: a negative example nobody can
      // read is not an example.
      expect(rejected.every((row) => row.territory.premise.length > 0)).toBe(true);

      // 3. The panel disagreed, and both opinions were kept apart.
      const reviews = await store.creative.listReviews(org.id, project.id);
      expect(reviews.map((review) => review.critic).sort()).toEqual([
        'brand', 'conversion', 'film', 'originality', 'product_marketing',
      ]);
      expect(reviews.find((review) => review.critic === 'conversion')?.verdict).toBe('revise');
      // The film critic said "pass" and listed a medium finding; its own
      // evidence is the stricter of the two, and that is what is recorded.
      expect(reviews.find((review) => review.critic === 'film')?.verdict).toBe('pass_with_concerns');

      // 4. The director settled it, in writing.
      const [decision] = await store.creative.listDecisions(org.id, project.id);
      expect(decision?.stage).toBe('territories');
      expect(decision?.arbitrations[0]?.between).toEqual(['conversion', 'film']);
      expect(decision?.arbitrations[0]?.resolution).toContain('Nothing is spoken');
      // Everything it did not choose, so the road not taken is recoverable.
      expect(decision?.rejected.length).toBeGreaterThanOrEqual(2);
    });

    it('survives a director that names a direction nobody offered', async () => {
      /*
       * The scripted selection returns an id that is not on the shortlist,
       * which is what a model does when it answers a question nobody asked. A
       * production must not die of it: the strongest shortlisted direction
       * stands and the record says the choice was not honoured.
       */
      await runJob(deps, await enqueued(store, org.id, project.id, 'research_product'));
      await runJob(deps, await enqueued(store, org.id, project.id, 'generate_concepts'));

      const [decision] = await store.creative.listDecisions(org.id, project.id);
      expect(decision?.reason).toContain('not on the shortlist');
      expect(
        (await store.creative.listTerritories(org.id, project.id)).filter((row) => row.selected),
      ).toHaveLength(1);
    });
  });
});
