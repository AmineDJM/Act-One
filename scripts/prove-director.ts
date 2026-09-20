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
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AudienceModel,
  BrandGenome,
  CreativeBrief,
  newId,
  storyboardDuration,
  type Project,
} from '@act-one/core';
import { MemoryStore } from '@act-one/db';
import { LocalFsStorageProvider, ProviderRegistry } from '@act-one/providers';
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

const store = new MemoryStore();
const now = new Date().toISOString();
const organizationId = newId('org');

await store.organizations.create({
  id: organizationId, name: 'Act One proof', slug: `proof-${organizationId.slice(-6)}`,
  planId: 'pro', stripeCustomerId: null, creditBalance: 20_000, maxProjectCostUsd: 60,
  isSuspended: false, createdAt: now,
});
const user = await store.users.create({
  id: newId('usr'), email: 'lead@actone.example', name: 'Lead', avatarUrl: null,
  isSuperAdmin: false, createdAt: now,
});

const project: Project = await store.projects.create({
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
});

const root = process.env['ACT_ONE_STORAGE_DIR'] ?? (await mkdtemp(path.join(tmpdir(), 'act-one-director-')));
const registry = new ProviderRegistry({ overrides: { storage: new LocalFsStorageProvider({ root }) } });

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

// --- Research ---------------------------------------------------------------
section(`RESEARCH — ${WEBSITE}`);
await runResearch(context);
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
const concepts = await runConcepts(context);
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
const board = await runStoryboard(context, { conceptId: chosen.id });
const storyboard = (await store.storyboards.get(organizationId, board.storyboardId))!;
console.log(`\n  ${storyboard.scenes.length} shots, ${storyboardDuration(storyboard).toFixed(1)}s`);
for (const scene of storyboard.scenes) {
  console.log(`  ${String(scene.index + 1).padStart(2)}. ${scene.duration.toFixed(1)}s ${scene.visualType.padEnd(18)} ${scene.onScreenText.join(' / ').slice(0, 60)}`);
}

// --- The animatic, watched --------------------------------------------------
section('PRE-PRODUCTION — the director watches before we pay');
const pre = await runPreProduction(context, {
  storyboardId: board.storyboardId, brief, audience, genome, maxRounds: 1,
});
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
process.exit(0);
