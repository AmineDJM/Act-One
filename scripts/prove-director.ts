/**
 * The whole chain, on a real website, with nothing mocked.
 *
 * This is the demonstration the Creative Intelligence work exists to pass:
 * give Act One a URL and a goal, and watch it understand before it creates,
 * explore before it chooses, watch before it approves, and refuse its own
 * work when the work deserves it.
 *
 * It runs the real stages against a real public product site — research,
 * direction, concepts, storyboard, the animatic the director watches, and the
 * master — and then opens the resulting MP4 and measures it. Every number
 * printed at the end is read out of the file, not out of the database.
 *
 * It needs OpenAI, Chromium and FFmpeg, and takes ten to fifteen minutes.
 *
 *   npm run prove:director -- https://some-product.example
 *
 * Two things it needs from the host, both learned the hard way.
 *
 * Chromium has to be reachable and has to trust whatever terminates TLS in
 * front of it. Behind a corporate or agent egress proxy that means both of:
 *
 *   ACT_ONE_CHROMIUM_PATH=/path/to/chrome
 *   ACT_ONE_BROWSER_PROXY=$HTTPS_PROXY
 *   ACT_ONE_BROWSER_TRUSTED_CA_SPKI=<sha256/base64 SPKI of the proxy CA>
 *
 * And the model calls have to be allowed to take their time. The research
 * synthesis runs on the deep tier and can take well over a minute on a large
 * site; a gateway that cuts requests at ninety seconds turns that into a 502
 * that no amount of retrying fixes, because it is not transient. If this
 * script dies at "identifying target audience" with an HTTP 502, that is what
 * happened, and it is the host rather than the pipeline.
 */
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AudienceModel,
  BrandGenome,
  CreativeBrief,
  newId,
  storyboardDuration,
  type Project,
} from '@act-one/core';
import { DbCostSink, MemoryStore } from '@act-one/db';
import { LocalFsStorageProvider, ProviderRegistry, loadLocalEnv } from '@act-one/providers';
import {
  runConcepts,
  runPreProduction,
  runRender,
  runResearch,
  runStoryboard,
  visualReadiness,
  type StageContext,
} from '@act-one/pipeline';
import { measureFilm, readContainer } from '@act-one/qa';

const WEBSITE = process.argv[2] ?? 'https://www.ashbyhq.com/';

/*
 * A key that exists somewhere the process cannot see is a key that does not
 * exist. Deployed, every secret is an environment variable; on a machine or in
 * a sandbox it is usually a file the repository ignores, and Act One spent a
 * long time reporting "no video provider configured" to a person who had
 * configured one. Names only — the values are never printed.
 */
const fromFile = loadLocalEnv(path.resolve(fileURLToPath(new URL('..', import.meta.url))));
if (fromFile.length > 0) console.log(`  .env.local → ${fromFile.join(', ')}`);

const store = new MemoryStore();
const now = new Date().toISOString();

/*
 * Checkpoints, so a run that dies in its ninth minute does not re-buy the
 * first eight.
 *
 * Research crawls a dozen pages through a real browser and the direction stage
 * runs nine critics and a deep arbitration; between them that is most of the
 * cost and nearly all of the wall clock. When the storyboard call dies on a
 * gateway \u2014 which it did, four attempts, twice \u2014 throwing all of that away to
 * try again is how an afternoon disappears.
 *
 * Point ACT_ONE_PROVE_CHECKPOINT at a file and every finished stage is written
 * there; run again with the same path and those stages are read back instead
 * of re-run. Delete the file for a clean run. Nothing in the product does
 * this: it is a development affordance over the in-memory store.
 *
 * It caches what a stage *returned*, including an unhappy answer. A stage
 * that finished by holding the film is finished as far as this is concerned,
 * so re-running after fixing the thing that held it replays the hold and
 * proves nothing. Delete that stage's key from the file (or the whole file)
 * before testing a fix to a stage that already ran.
 */
/**
 * Which code a stage's answer depends on.
 *
 * A checkpoint that replays an answer produced by code that has since changed
 * is worse than no checkpoint: it looks like a result. A blocked
 * pre-production verdict was replayed after the logic that blocked it had
 * been fixed, and the run reported the same hold, having tested nothing.
 *
 * So each stage is fingerprinted from the packages it actually runs, and an
 * answer is only reused when that fingerprint still matches. Listing the
 * dependencies by hand is the point rather than an inconvenience: it says out
 * loud which code can change a stage's mind.
 */
const STAGE_CODE: Record<string, string[]> = {
  research: ['packages/research', 'packages/providers'],
  direction: ['packages/creative', 'packages/providers', 'packages/core'],
  storyboard: ['packages/creative', 'packages/core'],
  'pre-production': [
    'packages/creative',
    'packages/pipeline',
    'packages/qa',
    'packages/motion',
    'packages/sound',
    'packages/core',
  ],
};

/** A hash of every source file under these directories. */
async function fingerprint(roots: readonly string[]): Promise<string> {
  const hash = createHash('sha256');
  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        hash.update(full);
        hash.update(await readFile(full));
      }
    }
  };
  for (const root of [...roots].sort()) await walk(path.join(process.cwd(), root, 'src'));
  return hash.digest('hex').slice(0, 16);
}

type Checkpoint = { results: Record<string, unknown>; codes?: Record<string, string>; store: string };
const checkpointPath = process.env['ACT_ONE_PROVE_CHECKPOINT'] ?? '';
let checkpoint: Checkpoint | null = null;
if (checkpointPath) {
  try {
    checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8')) as Checkpoint;
    store.restore(checkpoint.store);
    console.log(`  (resuming: ${Object.keys(checkpoint.results).join(', ')} already done)`);
  } catch {
    checkpoint = null;
  }
}

/*
 * The workspace the checkpoint already holds, or a new one.
 *
 * Every id in this script is generated, so a resume that made a fresh project
 * would be looking for rows under an id the restored store has never heard
 * of, and would report an empty run rather than a resumed one.
 */
const held = checkpoint?.results['workspace'] as { organizationId: string; projectId: string } | undefined;
const organizationId = held?.organizationId ?? newId('org');
const resumed = held ? await store.projects.get(organizationId, held.projectId) : null;

if (!resumed) {
  await store.organizations.create({
    id: organizationId, name: 'Act One proof', slug: `proof-${organizationId.slice(-6)}`,
    planId: 'pro', stripeCustomerId: null, creditBalance: 20_000, maxProjectCostUsd: 60,
    isSuspended: false, createdAt: now,
  });
  await store.users.create({
    id: newId('usr'), email: 'lead@actone.example', name: 'Lead', avatarUrl: null,
    isSuperAdmin: false, createdAt: now,
  });
}
const user = (await store.users.getByEmail('lead@actone.example'))!;

const project: Project = resumed ?? (await store.projects.create({
  id: newId('prj'), organizationId, createdByUserId: user.id,
  name: new URL(WEBSITE).hostname.replace(/^www\./, ''),
  websiteUrl: WEBSITE, supplementalUrls: [],
  brandId: null, productUnderstandingId: null, selectedConceptId: null,
  activeStoryboardId: null, latestRenderId: null, stage: 'created',
  brief: {
    filmFormat: 'product_tour', filmCut: 'feature',
    targetAudience: null, goal: 'product_launch', keyMessage: null, durationSeconds: 24,
    channels: ['homepage_hero'], creativeMode: 'studio', voiceStrategy: null, formats: [],
    excludedClaims: [], realMediaOnly: false, language: null, tone: null,
    voiceGender: null, voiceAccent: null, voiceStyle: null, voicePace: null,
  },
  productCredentialId: null, costUsd: 0, creditsSpent: 0, archivedAt: null,
  createdAt: now, updatedAt: now,
}));

const root = process.env['ACT_ONE_STORAGE_DIR'] ?? (await mkdtemp(path.join(tmpdir(), 'act-one-director-')));
/*
 * The ledger, on a proof run.
 *
 * Without a sink every provider call is free as far as this script can tell,
 * and "what does a film cost" is the question a proof of the pipeline is
 * uniquely placed to answer. The same sink the worker uses, so what it
 * records here is what a customer would be charged for.
 */
const registry = new ProviderRegistry({
  overrides: { storage: new LocalFsStorageProvider({ root }) },
  costSink: new DbCostSink(store, { organizationId, projectId: project.id }),
});

let lastStep = '';
const context: StageContext = {
  store, registry, organizationId, project, jobId: newId('job'),
  progress: async (fraction, message) => {
    const line = `${Math.round(fraction * 100)}% ${message}`;
    if (line !== lastStep) { console.log(`  ${line}`); lastStep = line; }
  },
  activity: async (event) => {
    console.log(`  · ${event.label}${event.detail ? ` — ${String(event.detail).slice(0, 160)}` : ''}`);
  },
};

const started = Date.now();
const failures: string[] = [];
function section(title: string): void {
  console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
}

/**
 * Runs a stage, or hands back the result already recorded under this name.
 *
 * The store and the stage's own return value both, because some of what a
 * stage produces lives in neither the database nor the storyboard \u2014 the
 * spread of the territories it explored, for one \u2014 and a resume that quietly
 * lost it would report a search that never happened.
 */
async function stage<T>(name: string, run: () => Promise<T>): Promise<T> {
  const code = await fingerprint(STAGE_CODE[name] ?? []);
  if (checkpoint && name in checkpoint.results) {
    if ((checkpoint.codes?.[name] ?? '') === code) {
      console.log(`  (${name}: from the checkpoint)`);
      return checkpoint.results[name] as T;
    }
    console.log(`  (${name}: the code changed since it ran, so it runs again)`);
  }
  const value = await run();
  if (checkpointPath) {
    checkpoint = {
      codes: { ...(checkpoint?.codes ?? {}), [name]: code },
      results: {
        ...(checkpoint?.results ?? {}),
        // The ids too: every id here is generated, so a resume that made a
        // fresh project would look for rows the restored store never held.
        workspace: { organizationId, projectId: project.id },
        [name]: value,
      },
      store: store.snapshot(),
    };
    await writeFile(checkpointPath, JSON.stringify(checkpoint));
  }
  return value;
}

// --- Research ---------------------------------------------------------------
section(`RESEARCH — ${WEBSITE}`);
await stage('research', () => runResearch(context));
const researched = (await store.projects.get(organizationId, project.id))!;
Object.assign(context, { project: researched });
const understanding = researched.productUnderstandingId
  ? await store.understandings.get(organizationId, researched.productUnderstandingId)
  : null;
if (!understanding) {
  console.error('\nFAILED: research produced no product understanding.');
  process.exit(1);
}
console.log(`\n  ${understanding.name} — ${understanding.oneLiner}`);
console.log(`  moments we can film: ${understanding.productMoments.length} (${understanding.productMoments.filter((m) => m.screenshots.length > 0).length} with real captures)`);

// --- Direction and concepts -------------------------------------------------
section('DIRECTION — understand, explore, arbitrate');
const concepts = await stage('direction', () => runConcepts(context));
const direction = concepts.direction;
if (!direction) {
  console.error('\nFAILED: the Director Brain did not run.');
  process.exit(1);
}

const brief = CreativeBrief.parse(await store.creative.latestModel(organizationId, project.id, 'brief'));
const audience = AudienceModel.parse(await store.creative.latestModel(organizationId, project.id, 'audience'));
const genome = BrandGenome.parse(await store.creative.latestModel(organizationId, project.id, 'genome'));

console.log(`\nTHE BRIEF`);
console.log(`  business objective : ${brief.goal.business} (${brief.goal.ctaStrength} call to action, ${brief.goal.awarenessStage})`);
console.log(`  creative objective : ${brief.creativeObjective}`);
console.log(`  before             : ${brief.transformation.before}`);
console.log(`  after              : ${brief.transformation.after}`);
console.log(`  pivot              : ${brief.transformation.pivot}`);

console.log(`\nTHE AUDIENCE`);
console.log(`  ${audience.who} (${audience.sophistication}, risk ${audience.riskTolerance})`);
console.log(`  status quo : ${audience.statusQuo}`);
console.log(`  objections : ${audience.objections.slice(0, 3).join(' · ')}`);

console.log(`\nTHE BRAND GENOME  (${genome.archetype})`);
for (const [dimension, value] of Object.entries(genome.dimensions)) {
  console.log(`  ${dimension.padEnd(20)} ${'█'.repeat(Math.round(value * 20)).padEnd(20)} ${value.toFixed(2)}`);
}
console.log(`  never: ${genome.taboos.join(' · ')}`);

const territories = await store.creative.listTerritories(organizationId, project.id);
console.log(`\nTERRITORIES EXPLORED — ${territories.length}, spread ${Math.round(direction.spread * 100)}%`);
for (const row of territories) {
  const mark = row.selected ? '→' : row.kept ? ' ' : '✗';
  console.log(`  ${mark} ${row.territory.name} (${row.territory.mechanism}, product ${row.territory.productRole})${row.rejectionReason ? ` — ${row.rejectionReason}` : ''}`);
  console.log(`      ${row.territory.premise}`);
}

const reviews = await store.creative.listReviews(organizationId, project.id);
console.log(`\nTHE PANEL`);
for (const review of reviews.filter((entry) => entry.artifactKind === 'territory')) {
  console.log(`  ${review.critic.padEnd(18)} ${review.verdict}`);
  for (const finding of review.findings.slice(0, 2)) {
    console.log(`      [${finding.severity}] ${finding.observation}`);
  }
}

const decisions = await store.creative.listDecisions(organizationId, project.id);
const pick = decisions.find((entry) => entry.stage === 'territories');
console.log(`\nTHE DIRECTOR`);
console.log(`  ${pick?.decision ?? '(nothing recorded)'}`);
console.log(`  because: ${pick?.reason ?? ''}`);
for (const arbitration of pick?.arbitrations ?? []) {
  console.log(`  settled ${arbitration.between.join(' vs ')}: ${arbitration.resolution}`);
}
if (!pick) failures.push('the director recorded no decision.');
if (territories.filter((row) => !row.selected).length === 0) {
  failures.push('nothing was rejected, so nothing was explored.');
}

// --- Storyboard -------------------------------------------------------------
section('STORYBOARD');
const chosen = (await store.concepts.listForProject(organizationId, project.id))[0];
if (!chosen) {
  console.error('\nFAILED: no concepts were written.');
  process.exit(1);
}
await store.projects.update(organizationId, project.id, { selectedConceptId: chosen.id });
Object.assign(context, { project: (await store.projects.get(organizationId, project.id))! });
const board = await stage('storyboard', () => runStoryboard(context, { conceptId: chosen.id }));
const storyboard = (await store.storyboards.get(organizationId, board.storyboardId))!;
console.log(`\n  ${storyboard.scenes.length} shots, ${storyboardDuration(storyboard).toFixed(1)}s`);
for (const scene of storyboard.scenes) {
  console.log(`  ${String(scene.index + 1).padStart(2)}. ${scene.duration.toFixed(1)}s ${scene.visualType.padEnd(18)} ${scene.onScreenText.join(' / ').slice(0, 60)}`);
}

// --- The animatic, watched --------------------------------------------------
section('PRE-PRODUCTION — the director watches before we pay');
const pre = await stage('pre-production', () =>
  runPreProduction(context, {
    storyboardId: board.storyboardId, brief, audience, genome, maxRounds: 1,
  }),
);
console.log(`\n  ${pre.rounds} viewing(s) · ${pre.verdict} · ${pre.approved ? 'approved for production' : 'held'}`);
for (const [index, seen] of pre.watched.entries()) {
  console.log(`  animatic v${index + 1}: ${seen.grade} — ${seen.summary}`);
}
if (pre.storyboardId !== board.storyboardId) {
  const revised = (await store.storyboards.get(organizationId, pre.storyboardId))!;
  console.log(`  revised: ${storyboard.scenes.length} shots → ${revised.scenes.length} shots`);
}
if (pre.watched.length === 0) failures.push('the director never watched the cut.');

// --- The master -------------------------------------------------------------
section('PRODUCTION');
if (!pre.approved && pre.verdict === 'block') {
  console.log('\n  The director refused the cut. That is a legitimate outcome and the proof of the gate.');
} else {
  const rendered = await runRender(context, { storyboardId: pre.storyboardId });
  const master = await store.assets.get(organizationId, rendered.assetId);
  if (!master) {
    console.error('\nFAILED: the render produced no master.');
    process.exit(1);
  }

  const filmDir = await mkdtemp(path.join(tmpdir(), 'act-one-proof-film-'));
  const filmPath = path.join(filmDir, 'master.mp4');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(filmPath, Buffer.from(await registry.storage().get(master.storageKey)));

  section('THE FILE THE CUSTOMER GETS');
  const container = await readContainer(filmPath);
  const measured = await measureFilm(filmPath, { workDir: filmDir });
  const finalBoard = (await store.storyboards.get(organizationId, pre.storyboardId))!;
  const referenced = finalBoard.scenes.flatMap((scene) => scene.assetRefs);
  const held = new Set<string>();
  for (const id of new Set(referenced)) {
    const asset = await store.assets.get(organizationId, id);
    if (asset && (await registry.storage().exists(asset.storageKey).catch(() => false))) held.add(id);
  }
  const readiness = visualReadiness({ storyboard: finalBoard, mode: 'master', resolved: held, missing: [] });

  console.log(`\n  duration        ${container.durationSeconds.toFixed(2)}s`);
  console.log(`  resolution      ${container.video?.width}x${container.video?.height}`);
  console.log(`  video           ${container.video?.codec} profile ${container.video?.profile} level ${container.video?.level}`);
  console.log(`  audio           ${container.audio?.codec ?? 'none'} ${container.audio?.sampleRate ?? ''} ${container.audio?.channels ?? ''}ch`);
  console.log(`  peak level      ${measured.peakDb === Number.NEGATIVE_INFINITY ? '-inf' : measured.peakDb.toFixed(1)} dBFS`);
  console.log(`  shots           ${readiness.coverage.shots}`);
  console.log(`  needing media   ${readiness.coverage.shotsRequiringMaterial}`);
  console.log(`  with media      ${readiness.coverage.shotsWithMaterial}`);
  console.log(`  typographic     ${readiness.coverage.typographicByIntent} (by intent)`);
  console.log(`  unresolved      ${readiness.coverage.unresolved}`);
  console.log(`  picture         ${Math.round(readiness.coverage.pictureShare * 100)}% of ${Math.round(readiness.coverage.plannedPictureShare * 100)}% planned`);
  console.log(`  QA              ${rendered.qaPassed ? 'passed' : 'needs attention'}`);

  /*
   * The bar this whole exercise exists to enforce. Not "did it render" — a
   * silent film of type on black renders perfectly.
   */
  if (measured.peakDb <= -60) failures.push('the master is silent.');
  if (readiness.coverage.unresolved > 0) failures.push(`${readiness.coverage.unresolved} shot(s) lost their material.`);
  if (!container.audio) failures.push('the master has no audio track.');
  if (container.durationSeconds < 5) failures.push('the master is shorter than five seconds.');
}

// --- Verdict ----------------------------------------------------------------
section('VERDICT');
const minutes = ((Date.now() - started) / 60_000).toFixed(1);
if (failures.length > 0) {
  console.error(`\nFAILED after ${minutes} minutes:`);
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(`\nPASS in ${minutes} minutes.`);
console.log(`  ${territories.length} directions explored, ${territories.filter((row) => !row.selected).length} rejected`);
console.log(`  ${reviews.length} critic reviews, ${decisions.length} director decisions`);
console.log(`  ${pre.watched.length} animatic viewing(s) before production`);

/*
 * What it cost, by family of work rather than by provider call: an operator
 * deciding whether a film is worth making needs to know that reasoning was
 * four fifths of it, not that there were ninety-one requests.
 */
const spent = await store.costs.listForProject(organizationId, project.id);
if (spent.length > 0) {
  const families = new Map<string, { usd: number; calls: number; guessed: number }>();
  for (const cost of spent) {
    const family = cost.operation.split('.')[0] ?? cost.operation;
    const row = families.get(family) ?? { usd: 0, calls: 0, guessed: 0 };
    row.usd += cost.actualCostUsd || cost.estimatedCostUsd;
    row.calls += 1;
    if (cost.costBasis === 'unknown_price') row.guessed += 1;
    families.set(family, row);
  }
  const total = [...families.values()].reduce((sum, row) => sum + row.usd, 0);
  console.log(`\n  COST  $${total.toFixed(4)} across ${spent.length} calls`);
  for (const [family, row] of [...families].sort((a, b) => b[1].usd - a[1].usd)) {
    console.log(
      `    ${family.padEnd(14)} $${row.usd.toFixed(4)}  ${String(row.calls).padStart(3)} calls` +
        (row.guessed > 0 ? `  (${row.guessed} at a guessed rate)` : ''),
    );
  }
}
process.exit(0);
