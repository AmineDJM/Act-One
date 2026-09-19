/**
 * Proves the QA repair loop on a film that is actually rendered.
 *
 * Every other test of this loop decides from numbers or from a clip FFmpeg
 * built, which proves the arithmetic and the measurement and says nothing
 * about whether the whole chain closes: render, measure, find, plan, repair,
 * render again, measure again, release. This runs that chain and prints what
 * happened at each pass — the findings, the repairs, what each one achieved,
 * and what the repairs added in money and in the customer's waiting.
 *
 * The storyboard is built to fail. Its middle shot holds a single word for six
 * seconds, which is four and a half seconds past what one word earns, so the
 * held-frame check has something real to find and the trim has something real
 * to do. A run that finds nothing means the check stopped working, not that
 * the film got better.
 *
 * It needs Chromium and FFmpeg and takes about two minutes, so it is not part
 * of `npm test`. It is the thing to run when anything in the loop changes.
 *
 *   npm run prove:repair-loop
 */
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BrandSystem,
  Concept,
  Scene,
  Storyboard,
  newId,
  resequence,
  type Project,
} from '@act-one/core';
import { MemoryStore } from '@act-one/db';
import { LocalFsStorageProvider, NullCostSink, ProviderRegistry } from '@act-one/providers';
import { runRender } from '@act-one/pipeline';
import { neutralRamp } from '@act-one/design';
import { runFfmpeg } from '@act-one/sound';

const store = new MemoryStore();
const now = new Date().toISOString();
const organizationId = newId('org');

await store.organizations.create({
  id: organizationId, name: 'Northwind', slug: `northwind-${organizationId.slice(-6)}`,
  planId: 'pro', stripeCustomerId: null, creditBalance: 5000, maxProjectCostUsd: 120,
  isSuspended: false, createdAt: now,
});

const user = await store.users.create({
  id: newId('usr'), email: 'lead@northwind.example', name: 'Lead', avatarUrl: null,
  isSuperAdmin: false, createdAt: now,
});

const brand = await store.brands.create(
  BrandSystem.parse({
    id: newId('brd'), organizationId, name: 'Northwind', logo: null, logoVariants: [],
    primaryColor: '#2f6fed', secondaryColor: '#8fb2f7', accentColors: [], primaryCandidates: ['#2f6fed'],
    neutrals: neutralRamp('#2f6fed', 9, 0.05), canvasDark: '#08080c', canvasLight: '#ffffff',
    typography: [], visualStyle: 'minimal', imageTreatment: 'none', layoutDensity: 'balanced',
    confirmedByUser: true, createdAt: now, updatedAt: now,
  }),
);

const project: Project = await store.projects.create({
  id: newId('prj'), organizationId, createdByUserId: user.id, name: 'Northwind',
  websiteUrl: 'https://northwind.example/', supplementalUrls: [], brandId: brand.id,
  productUnderstandingId: null, selectedConceptId: null, activeStoryboardId: null,
  latestRenderId: null, stage: 'rendering',
  brief: {
    filmFormat: 'product_tour', filmCut: 'feature', targetAudience: null, goal: null,
    keyMessage: null, durationSeconds: 12, channels: [], creativeMode: 'studio',
    voiceStrategy: 'none', formats: [], excludedClaims: [], realMediaOnly: false,
    language: 'en', tone: null, voiceGender: null, voiceAccent: null, voiceStyle: null, voicePace: null,
  },
  productCredentialId: null, costUsd: 0, creditsSpent: 0, archivedAt: null,
  createdAt: now, updatedAt: now,
});

const [concept] = await store.concepts.createMany(
  [
    Concept.parse({
      id: newId('cpt'), projectId: project.id, name: 'One Close',
      keyIdea: 'A week of manual matching disappears into a single run',
      hook: 'The books are already closed.', targetEmotion: 'relief',
      productAngle: 'The close, end to end.', narrativeStructure: 'problem_shift_proof',
      visualDirection: 'Ledger type on near-black.', motionDirection: 'Cuts on the beat.',
      soundDirection: 'Room tone.', productUiUsage: 'The real close screen.',
      generativeUsage: 'none', creativeSystem: 'kinetic_product', estimatedDurationSeconds: 10,
      recommendedChannels: ['homepage_hero'], keyScenes: ['The pile', 'The run', 'The desk'],
      selected: true, createdAt: now,
    }),
  ],
  organizationId,
);
await store.projects.update(organizationId, project.id, { selectedConceptId: concept!.id });

const storyboardId = newId('sbd');
const shot = (index: number, duration: number, text: string) =>
  Scene.parse({
    id: newId('scn'), storyboardId, index, startTime: 0, duration,
    purpose: 'the argument', narration: '', onScreenText: [text],
    visualType: 'kinetic_typography', motionRecipe: { name: 'hold' }, cameraRecipe: {},
    voiceOver: false, transition: 'cut',
  });

/**
 * A shot of real moving footage.
 *
 * `footage` is one of the seven recipes the renderer actually drives with the
 * camera, and the only one that needs no capture of a customer's product. It
 * plays, so the held-frame check finds nothing on it — which is what lets it
 * carry the seconds a trim gives back.
 *
 * An earlier version of this put a `slow_push` on a typographic card and
 * assumed that counted as motion. The renderer ignores `cameraRecipe` on
 * typographic recipes, so the card sat still for eight seconds and the real
 * render said so. That is now a lint in `film-motion.test.ts`.
 */
const movingShot = (index: number, duration: number, assetId: string) =>
  Scene.parse({
    id: newId('scn'), storyboardId, index, startTime: 0, duration,
    purpose: 'the argument', narration: '', onScreenText: [],
    visualType: 'generated_broll', motionRecipe: { name: 'footage' },
    cameraRecipe: { move: 'slow_push', fromScale: 1, toScale: 1.12 },
    assetRefs: [assetId], voiceOver: false, transition: 'cut',
  });

/** `npm run prove:repair-loop -- --absorbing` proves the accepting path instead. */
const absorbing = process.argv.includes('--absorbing');

/*
 * The same storage a deployment uses, when one is configured.
 *
 * The sound library lives in storage, and a proof that writes to a fresh
 * temporary directory has no library in it — so every film it renders comes
 * out silent and carries a `missing_audio` finding that says more about the
 * fixture than about the loop. `npm run sound-library` puts the library in
 * ACT_ONE_STORAGE_DIR; this uses it when it is there.
 */
const root =
  process.env['ACT_ONE_STORAGE_DIR'] ?? (await mkdtemp(path.join(tmpdir(), 'act-one-proof-')));
const storage = new LocalFsStorageProvider({ root });
const registry = new ProviderRegistry({ costSink: new NullCostSink(), overrides: { storage } });

/**
 * A clip for the absorbing film to play.
 *
 * Built here rather than commissioned, because what is being proved is the
 * repair loop and not a provider: eight seconds of a moving test pattern is
 * eight seconds the held-frame check has nothing to say about, which is all
 * this shot has to be.
 */
async function footageAsset(): Promise<string> {
  const clipPath = path.join(root, 'broll.mp4');
  const built = await runFfmpeg(
    [
      '-nostdin', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=12',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipPath,
    ],
    { timeoutMs: 120_000 },
  );
  if (!built.ok) throw new Error(`the b-roll clip could not be built: ${built.stderr.slice(-400)}`);

  const assetId = newId('ast');
  const storageKey = `${organizationId}/${project.id}/${assetId}.mp4`;
  await storage.put(storageKey, await readFile(clipPath), { contentType: 'video/mp4' });
  const asset = await store.assets.create({
    id: assetId, organizationId, projectId: project.id, conceptId: null, sceneId: null,
    kind: 'generated_video', origin: 'generated', rights: 'generated_derivative',
    storageKey, contentType: 'video/mp4', bytes: 0,
    width: 1280, height: 720, durationSeconds: 12,
    provider: null, model: null, sourceUrl: null,
    costUsd: 0, metadata: {}, createdAt: now,
  });
  return asset.id;
}

const brollId = absorbing ? await footageAsset() : '';

const storyboard = await store.storyboards.create(
  resequence(
    Storyboard.parse({
      id: storyboardId, projectId: project.id, conceptId: concept!.id, treatmentId: newId('cpt'),
      version: 1, language: 'en', voiceStrategy: 'none', status: 'approved',
      /*
       * The middle shot holds one word for six seconds. That is the defect.
       *
       * In the default film every shot is a static card, so the seconds the
       * trim recovers have nowhere to go and the repair has to be refused. In
       * the absorbing film the closing shot is real footage, which plays — so
       * it can take them and the film keeps the length it was approved at.
       */
      scenes: absorbing
        ? [shot(0, 2, 'Close the books.'), shot(1, 6, 'Once.'), movingShot(2, 8, brollId)]
        : [shot(0, 2, 'Close the books.'), shot(1, 6, 'Once.'), shot(2, 2, 'Northwind.')],
      createdAt: now, updatedAt: now,
    }),
  ),
  organizationId,
);
await store.projects.update(organizationId, project.id, { activeStoryboardId: storyboard.id });

console.log(absorbing ? 'Film: one shot can absorb the recovered time.' : 'Film: every shot is a static card.');
const startedAt = Date.now();
const result = await runRender(
  {
    store, registry, organizationId, project, jobId: newId('job'),
    // What the customer reads while this happens. No check names, no severities.
    progress: async (fraction, message) => console.log(`  ${(fraction * 100).toFixed(0)}%  ${message}`),
    activity: async () => undefined,
  },
  { storyboardId: storyboard.id, skipVisionQa: true, maxRepairAttempts: 2 },
);

const render = await store.renders.get(organizationId, result.renderId);
console.log(`\n=== ${((Date.now() - startedAt) / 1000).toFixed(1)}s · render ${render?.status} ===`);

for (const report of (await store.qaReports.list(20)).sort((a, b) => a.attempt - b.attempt)) {
  console.log(
    `\n--- pass ${report.attempt} · ${report.state} · ${report.durationSeconds ?? '?'}s ---`,
  );
  for (const found of report.issues) {
    const at = found.timecodeStart === null ? '' : ` ${found.timecodeStart}→${found.timecodeEnd ?? '?'}s`;
    console.log(`  ${found.severity.padEnd(13)} ${found.check.padEnd(20)}${at}  → ${found.repair ?? 'none'}`);
  }
  for (const repair of report.repairs) {
    console.log(
      `  REPAIR L${repair.level} ${repair.action} on ${repair.sceneId ?? 'the film'} → ${repair.outcome}` +
        ` (provider $${repair.providerCostUsd.toFixed(4)},` +
        ` compute $${repair.estimatedComputeCostUsd.toFixed(4)} / ${(repair.computeMs / 1000).toFixed(1)}s)`,
    );
  }
  if (report.score) {
    const score = report.score;
    console.log(
      `  SCORE resolved=${score.targetDefectsResolved} remaining=${score.targetDefectsRemaining}` +
        ` newHard=${score.newHardDefects} newSoft=${score.newSoftDefects}` +
        ` runtime=${score.runtimeBefore}→${score.runtimeAfter}s (±${score.runtimeTolerance.toFixed(2)})` +
        ` duration=${score.durationConstraintSatisfied} readability=${score.readabilitySatisfied}` +
        ` narrative=${score.narrativeSatisfied} assets=${score.assetsSatisfied}` +
        ` → ${score.accepted ? 'ACCEPT' : 'REJECT'}`,
    );
    for (const violation of score.violations) {
      console.log(`    ✗ ${violation.invariant}: ${violation.message}`);
    }
  }
  if (report.repairs.length > 0) {
    console.log(
      `  added: provider $${report.extraCostUsd.toFixed(4)} ·` +
        ` compute $${report.extraComputeCostUsd.toFixed(4)} ·` +
        ` ${(report.extraLatencyMs / 1000).toFixed(1)}s wall clock ·` +
        ` ${report.rendersSpent} render${report.rendersSpent === 1 ? '' : 's'} in total`,
    );
  }
}

const finalCut = await store.storyboards.get(organizationId, storyboard.id);
console.log(
  '\nfinal cut:',
  finalCut?.scenes.map((s) => `${s.duration}s`).join(' · '),
  `(was ${storyboard.scenes.map((s) => `${s.duration}s`).join(' · ')})`,
);

/*
 * A run that did not repair anything proved nothing, so it fails rather than
 * printing a clean report and exiting zero.
 */
const repaired = (await store.qaReports.list(20)).flatMap((report) => report.repairs);
if (repaired.length === 0) {
  console.error('\nNo repair ran. The loop did not close, or the check that finds the defect stopped working.');
  process.exit(1);
}
const finalReport = (await store.qaReports.list(20)).sort((a, b) => b.attempt - a.attempt)[0];
const approved = storyboard.scenes.reduce((sum, s) => sum + s.duration, 0);
const delivered = finalCut?.scenes.reduce((sum, s) => sum + s.duration, 0) ?? 0;

/*
 * A film that reached READY having lost a third of its runtime is the exact
 * failure this proof exists to catch, so it fails here rather than printing a
 * clean report. A rejected repair is a pass: the loop declined to ship a
 * film it had made worse, which is the behaviour being proved.
 */
if (result.qaPassed && Math.abs(delivered - approved) > Math.max(approved * 0.05, 0.4)) {
  console.error(
    `\nREADY at ${delivered.toFixed(2)}s against an approved ${approved.toFixed(2)}s. ` +
      'The repairs fixed the defects and broke the film.',
  );
  process.exit(1);
}
if (!result.qaPassed && !finalReport?.score) {
  console.error('\nThe film did not reach a releasable state, and no score says why.');
  process.exit(1);
}
if (absorbing && !finalReport?.score?.accepted) {
  console.error('\nThe recovered time had somewhere to go and the repair was refused anyway.');
  process.exit(1);
}
if (!absorbing && finalReport?.score?.accepted) {
  console.error('\nA film of static cards lost time it could not place, and the repair was accepted.');
  process.exit(1);
}
if (!absorbing && Math.abs(delivered - approved) > 0.001) {
  console.error(`\nRolled back, and the cut is ${delivered.toFixed(2)}s rather than the approved ${approved.toFixed(2)}s.`);
  process.exit(1);
}
console.log(
  `\n${repaired.filter((r) => r.outcome === 'fixed').length}/${repaired.length} repairs fixed their finding; ` +
    `${repaired.filter((r) => r.outcome === 'rejected').length} rolled back.`,
);
console.log(
  result.qaPassed
    ? `READY at ${delivered.toFixed(2)}s against an approved ${approved.toFixed(2)}s.`
    : `Held for a person: ${(await store.renders.get(organizationId, result.renderId))?.error ?? ''}`,
);
process.exit(0);
