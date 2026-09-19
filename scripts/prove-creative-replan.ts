/**
 * Proves that Act One solves a creative problem by itself.
 *
 * The film here cannot be repaired by editing its timeline. Three static
 * cards, ten seconds, and a middle beat that holds one word for six of them:
 * trimming the hold takes the film to half the runtime the customer approved,
 * so the deterministic layer refuses its own repair and rolls back. That is
 * where a tool stops and says "I found the problem, please fix it".
 *
 * What should happen instead is what a senior director does in the room:
 * there is not enough here, so split the idea, put something in the middle of
 * it and move the payoff to the end. This runs that — the real escalation, a
 * real call to the Creative Director, the affected beat rebuilt, the film
 * rendered again from the revised plan, and QA run on the result.
 *
 * It needs OpenAI, Chromium and FFmpeg, and takes about five minutes.
 *
 *   npm run prove:creative-replan
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BrandSystem,
  Concept,
  DEFAULT_PRODUCTION_BUDGET,
  Scene,
  Storyboard,
  budgetAllowsReplan,
  newId,
  resequence,
  spendReplan,
  storyboardDuration,
  type Project,
} from '@act-one/core';
import { MemoryStore } from '@act-one/db';
import { LocalFsStorageProvider, ProviderRegistry } from '@act-one/providers';
import { runRender, runCreativeReplan, type StageContext } from '@act-one/pipeline';
import { neutralRamp } from '@act-one/design';

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
    filmFormat: 'product_tour', filmCut: 'feature', targetAudience: 'Finance teams closing the month',
    goal: null, keyMessage: 'The close, end to end, in one run.', durationSeconds: 10,
    channels: [], creativeMode: 'studio', voiceStrategy: 'none', formats: [], excludedClaims: [],
    realMediaOnly: false, language: 'en', tone: null, voiceGender: null, voiceAccent: null,
    voiceStyle: null, voicePace: null,
  },
  productCredentialId: null, costUsd: 0, creditsSpent: 0, archivedAt: null,
  createdAt: now, updatedAt: now,
});

/*
 * What research found, because a director with nothing to say writes nothing.
 *
 * A real production reaches the render with this on file: the audience, the
 * pain, the benefit, what we may claim and what we may not. An earlier version
 * of this proof left it null and the Creative Director — correctly — refused
 * to invent anything, so every option it offered was too thin for the beat.
 * A film with no research behind it is a different failure, and not this one.
 */
const understanding = await store.understandings.create({
  id: newId('pun'), projectId: project.id, name: 'Northwind',
  oneLiner: 'The month-end close, reconciled in one run.',
  category: 'Finance automation',
  targetAudience: ['Controllers', 'Finance teams at mid-market companies'],
  painPoints: [{ text: 'Month-end close takes a week of manual matching', evidenceIds: [] }],
  keyBenefits: [
    { text: 'Closes the books without manual matching', evidenceIds: [] },
    { text: 'Reconciles every invoice against the source document', evidenceIds: [] },
  ],
  differentiators: [{ text: 'Reads the source documents rather than the ledger', evidenceIds: [] }],
  coreFeatures: [
    { text: 'Automated reconciliation', evidenceIds: [] },
    { text: 'Exception review in one queue', evidenceIds: [] },
  ],
  proofPoints: [],
  productMoments: [], strongestVisualMoments: [],
  tone: 'Plain, exact, unhurried. No exclamation marks.',
  brandTraits: ['precise', 'calm'], competitorCategory: 'Close management',
  productMaturity: 'growth', launchContext: 'product_launch',
  evidence: [], sources: ['https://northwind.example/'],
  gaps: ['No customer numbers published, so no metric may be claimed.'],
  createdAt: now,
}, organizationId);
await store.projects.update(organizationId, project.id, {
  productUnderstandingId: understanding.id,
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
const card = (index: number, duration: number, text: string) =>
  Scene.parse({
    id: newId('scn'), storyboardId, index, startTime: 0, duration,
    purpose: 'the argument', narration: '', onScreenText: [text],
    visualType: 'kinetic_typography', motionRecipe: { name: 'word_reveal' }, cameraRecipe: {},
    voiceOver: false, transition: 'cut', status: 'ready',
  });

const first = await store.storyboards.create(
  resequence(
    Storyboard.parse({
      id: storyboardId, projectId: project.id, conceptId: concept!.id, treatmentId: newId('cpt'),
      version: 1, language: 'en', voiceStrategy: 'none', status: 'approved',
      // Six seconds of room for one word. No timeline edit fixes this.
      scenes: [card(0, 2, 'Close the books.'), card(1, 6, 'Once.'), card(2, 2, 'Northwind.')],
      createdAt: now, updatedAt: now,
    }),
  ),
  organizationId,
);
await store.projects.update(organizationId, project.id, { activeStoryboardId: first.id });

const root = await mkdtemp(path.join(tmpdir(), 'act-one-replan-'));
const registry = new ProviderRegistry({
  overrides: { storage: new LocalFsStorageProvider({ root }) },
});

const approvedSeconds = storyboardDuration(first);
const context: StageContext = {
  store, registry, organizationId, project, jobId: newId('job'),
  progress: async (fraction, message) => console.log(`  ${(fraction * 100).toFixed(0)}%  ${message}`),
  activity: async (event) =>
    console.log(`  · ${event.label}${event.detail ? ` — ${event.detail}` : ''}`),
};

console.log(`Approved: ${approvedSeconds.toFixed(2)}s, three static cards.\n--- render 1 ---`);
const startedAt = Date.now();
let budget = DEFAULT_PRODUCTION_BUDGET;
let storyboardIdToRender = first.id;
let replans = 0;
let strategy = '';
let directionCostUsd = 0;
let escalated = false;

/*
 * The orchestration loop, run by hand.
 *
 * In production this is the job queue: a render escalates, the runner spends a
 * replan and enqueues `creative_replan`, that enqueues another `render_film`.
 * Here it is a `while`, so the whole chain runs in one process and can be
 * asserted on — the stages called are the same ones the runner calls.
 */
let outcome = await runRender(context, {
  storyboardId: storyboardIdToRender,
  skipVisionQa: true,
  maxRepairAttempts: budget.deterministicPasses,
});

while (outcome.escalation && budgetAllowsReplan(budget)) {
  escalated = true;
  console.log(
    `\n--- escalation ---\n  ${outcome.escalation.check} on ${outcome.escalation.sceneIds.length} beat(s)` +
      `\n  ${outcome.escalation.diagnosis}` +
      `\n  room ${outcome.escalation.requiredSeconds.toFixed(2)}s, earns ${outcome.escalation.usableSeconds.toFixed(2)}s`,
  );

  const spent = spendReplan(budget, outcome.escalation.sceneIds.length > 1);
  console.log(`\n--- creative replan ${replans + 1} ---`);
  const replanned = await runCreativeReplan(context, {
    escalation: outcome.escalation,
    budget: spent,
    attempt: replans,
  });
  budget = spent;
  replans += 1;

  if (!replanned.storyboardId) {
    console.log('  the director produced nothing usable.');
    break;
  }
  strategy = replanned.strategy;
  directionCostUsd += replanned.replan?.directionCostUsd ?? 0;
  storyboardIdToRender = replanned.storyboardId;

  console.log(`\n--- render ${replans + 1} ---`);
  outcome = await runRender(context, {
    storyboardId: storyboardIdToRender,
    skipVisionQa: true,
    maxRepairAttempts: budget.deterministicPasses,
  });
}

const elapsed = (Date.now() - startedAt) / 1000;
const render = await store.renders.get(organizationId, outcome.renderId);
const finalBoard = await store.storyboards.get(organizationId, storyboardIdToRender);
const delivered = finalBoard ? storyboardDuration(finalBoard) : 0;

console.log(`\n=== ${elapsed.toFixed(1)}s · render ${render?.status} · qaPassed ${outcome.qaPassed} ===`);
for (const replan of await store.replans.listForProject(organizationId, project.id)) {
  console.log(
    `\nREPLAN ${replan.strategy} on ${replan.sceneIds.length} beat(s)` +
      `\n  ${replan.reasoning}` +
      `\n  options ${replan.options.length}, refused ${replan.rejected.length}` +
      `\n  reused ${replan.scenesReused}, recomposed ${replan.scenesRecomposed}, regenerated ${replan.scenesRegenerated}` +
      `\n  direction $${replan.directionCostUsd.toFixed(4)} (${replan.model}), to make $${replan.estimatedCostUsd.toFixed(4)}`,
  );
  for (const refusal of replan.rejected) console.log(`  ✗ ${refusal.strategy}: ${refusal.reason}`);
}

const reports = (await store.qaReports.list(40)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
console.log('\n--- every pass ---');
for (const report of reports) {
  const holds = report.issues.filter((issue) => issue.check === 'still_frame_hold');
  console.log(
    `  ${report.state.padEnd(16)} ${(report.durationSeconds ?? 0).toFixed(2)}s  ` +
      `${report.issues.length} finding(s), ${holds.length} hold(s)` +
      (report.score ? `  score ${report.score.accepted ? 'ACCEPT' : 'REJECT'}` : ''),
  );
  for (const hold of holds) {
    console.log(`      hold ${hold.timecodeStart}→${hold.timecodeEnd}s — ${hold.message.slice(0, 110)}`);
  }
}

console.log(
  `\nbefore: ${first.scenes.map((s) => `${s.duration}s`).join(' · ')}` +
    `\nafter:  ${finalBoard?.scenes.map((s) => `${s.duration}s`).join(' · ')}` +
    `\nlineage: v${first.version} → v${finalBoard?.version} (${finalBoard?.revisionReason.slice(0, 120)})`,
);

/*
 * What this proof refuses to call a success.
 *
 * Each of these is a way the loop could look like it worked and not have.
 */
const failures: string[] = [];
if (!escalated) failures.push('no creative escalation happened: the deterministic layer did not refuse its own repair.');
if (replans === 0) failures.push('the Creative Director was never called.');
if (!strategy) failures.push('the director produced nothing usable.');
if (finalBoard?.id === first.id) failures.push('the creative plan was not modified.');
/* Walk the chain: two replans make it v1 → v2 → v3, not v1 → v3. */
let walked = finalBoard;
let depth = 0;
while (walked?.parentStoryboardId && depth < 10) {
  walked = await store.storyboards.get(organizationId, walked.parentStoryboardId);
  depth += 1;
}
if (walked?.id !== first.id) failures.push('the lineage does not lead back to the approved cut.');
if (Math.abs(delivered - approvedSeconds) > Math.max(approvedSeconds * 0.05, 0.4)) {
  failures.push(`the film is ${delivered.toFixed(2)}s against an approved ${approvedSeconds.toFixed(2)}s.`);
}
const lastReport = reports.at(-1);

/*
 * The sound is remade for the new picture, and judged against it.
 *
 * A replanned beat has different words, different lengths and different cuts,
 * so a mix, a caption track or a narration carried over from the old cut would
 * be wrong in every one of those ways. The render stage builds all three from
 * the storyboard it is given, and QA's audio and cross-modal layers read the
 * finished file — this checks both actually ran on the final pass rather than
 * trusting that they did.
 */
const audioLayersRan = ['audio', 'cross_modal'].filter((layer) =>
  (lastReport?.layers ?? []).includes(layer as 'audio'),
);
if (replans > 0 && lastReport && audioLayersRan.length < 2) {
  failures.push(
    `the sound was not re-checked against the new cut: layers ran = ${(lastReport.layers ?? []).join(', ') || 'none'}.`,
  );
}
const soundFindings = (lastReport?.issues ?? []).filter(
  (issue) => (issue.layer === 'audio' || issue.layer === 'cross_modal') && issue.severity !== 'info',
);
const soundBlockers = soundFindings.filter(
  (issue) => issue.check !== 'missing_audio' && issue.severity !== 'warning',
);
if (soundBlockers.length > 0) {
  failures.push(
    `the delivered film has unresolved sound findings: ${soundBlockers.map((issue) => issue.check).join(', ')}.`,
  );
}

// And the film's own voice was not changed by the repair.
const spokeBefore = first.scenes.some((scene) => scene.voiceOver);
const speaksAfter = (finalBoard?.scenes ?? []).some((scene) => scene.voiceOver);
if (spokeBefore !== speaksAfter) {
  failures.push(
    `the repair ${speaksAfter ? 'gave the film a voice it did not have' : 'took the film’s voice away'}.`,
  );
}
if (lastReport && lastReport.issues.some((issue) => issue.check === 'still_frame_hold')) {
  failures.push('the original defect is still in the delivered film.');
}
if (lastReport && lastReport.issues.some((issue) => issue.severity === 'hard_fail' || issue.severity === 'critical_fail')) {
  failures.push('the delivered film carries a blocking defect.');
}
if (outcome.qaPassed && outcome.escalation) {
  failures.push('READY was reported with an escalation outstanding.');
}
if (render?.status === 'completed' && !outcome.qaPassed) {
  failures.push('the render says completed and QA says it did not pass.');
}

if (failures.length > 0) {
  console.error('\nFAILED:');
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}

console.log(
  `\nPASS — ${strategy} on beat 2, ${replans} replan(s), ` +
    `$${directionCostUsd.toFixed(4)} of direction, film ${delivered.toFixed(2)}s, ` +
    `render ${render?.status}.`,
);
process.exit(0);
