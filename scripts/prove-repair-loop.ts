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
import { mkdtemp } from 'node:fs/promises';
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

const storyboard = await store.storyboards.create(
  resequence(
    Storyboard.parse({
      id: storyboardId, projectId: project.id, conceptId: concept!.id, treatmentId: newId('cpt'),
      version: 1, language: 'en', voiceStrategy: 'none', status: 'approved',
      // The middle shot holds one word for six seconds. That is the defect.
      scenes: [shot(0, 2, 'Close the books.'), shot(1, 6, 'Once.'), shot(2, 2, 'Northwind.')],
      createdAt: now, updatedAt: now,
    }),
  ),
  organizationId,
);
await store.projects.update(organizationId, project.id, { activeStoryboardId: storyboard.id });

const root = await mkdtemp(path.join(tmpdir(), 'act-one-loop-'));
const registry = new ProviderRegistry({
  costSink: new NullCostSink(),
  overrides: { storage: new LocalFsStorageProvider({ root }) },
});

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
      `  REPAIR ${repair.action} on ${repair.sceneId ?? 'the film'} → ${repair.outcome}` +
        ` ($${repair.costUsd.toFixed(4)}, ${(repair.latencyMs / 1000).toFixed(1)}s)`,
    );
  }
  if (report.repairs.length > 0) {
    console.log(`  added: $${report.extraCostUsd.toFixed(4)} · ${(report.extraLatencyMs / 1000).toFixed(1)}s`);
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
if (!result.qaPassed) {
  console.error('\nThe film did not reach a releasable state.');
  process.exit(1);
}
console.log(`\n${repaired.filter((r) => r.outcome === 'fixed').length}/${repaired.length} repairs fixed their finding.`);
process.exit(0);
