/**
 * End-to-end demo.
 *
 * Runs the real pipeline — research, strategy, direction, storyboard, render —
 * against a real website with real providers, using the in-memory store so it
 * needs no database. This is the check that matters: unit tests prove each
 * stage in isolation, and this proves they compose.
 *
 *   npm run demo -- https://linear.app
 *
 * Requires OPENAI_API_KEY (or an egress proxy that injects it) and a Chromium.
 * Rendering additionally needs chrome-headless-shell via
 * ACT_ONE_CHROME_HEADLESS_SHELL; without it the run stops after the storyboard
 * and says so.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { newId, storyboardDuration, visualMix } from '@act-one/core';
import { MemoryStore } from '@act-one/db';
import {
  LocalChromiumProvider,
  LocalFsStorageProvider,
  NullCostSink,
  OpenAiLlmProvider,
  OpenAiSpeechProvider,
  ProviderRegistry,
} from '@act-one/providers';
import { runJob } from '@act-one/pipeline';

const websiteUrl = process.argv[2] ?? 'https://linear.app';
const outputDir = process.argv[3] ?? path.resolve('.act-one-demo');
const shouldRender = process.env.ACT_ONE_CHROME_HEADLESS_SHELL !== undefined;

const started = Date.now();
const costSink = new NullCostSink();
const store = new MemoryStore();

function heading(text: string): void {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(16)} ${value}`);
}

async function main(): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const now = new Date().toISOString();

  const organization = await store.organizations.create({
    id: newId('org'), name: 'Demo', slug: `demo-${Date.now()}`, planId: 'pro',
    stripeCustomerId: null, creditBalance: 10_000, maxProjectCostUsd: 50,
    isSuspended: false, createdAt: now,
  });
  const user = await store.users.create({
    id: newId('usr'), email: 'demo@example.com', name: 'Demo', avatarUrl: null,
    isSuperAdmin: true, createdAt: now,
  });
  const project = await store.projects.create({
    id: newId('prj'), organizationId: organization.id, createdByUserId: user.id,
    name: 'Demo', websiteUrl, supplementalUrls: [], brandId: null,
    productUnderstandingId: null, selectedConceptId: null, activeStoryboardId: null,
    latestRenderId: null, stage: 'created',
    brief: {
      filmFormat: 'product_tour', filmCut: 'feature', targetAudience: null, goal: null, keyMessage: null, durationSeconds: 45,
      channels: [], creativeMode: 'studio', voiceStrategy: null, formats: [],
      excludedClaims: [], realMediaOnly: false, language: null, tone: null, voiceGender: null, voiceAccent: null, voiceStyle: null, voicePace: null,
    },
    productCredentialId: null, costUsd: 0, creditsSpent: 0, archivedAt: null,
    createdAt: now, updatedAt: now,
  });

  const registry = new ProviderRegistry({
    costSink,
    overrides: {
      llm: new OpenAiLlmProvider({ costSink }),
      browser: new LocalChromiumProvider({ costSink }),
      speech: new OpenAiSpeechProvider({ costSink }),
      storage: new LocalFsStorageProvider({ root: path.join(outputDir, 'storage') }),
    },
  });

  const deps = { store, workerId: 'demo', buildRegistry: async () => registry };

  const run = async (kind: Parameters<typeof runJob>[1]['kind'], payload: Record<string, unknown> = {}) => {
    const created = new Date().toISOString();
    await store.jobs.enqueue({
      id: newId('job'), organizationId: organization.id, projectId: project.id, kind,
      state: 'queued', payload, progress: 0, statusMessage: '', attempts: 0, maxAttempts: 1,
      lastError: null, lastErrorCode: null, runAfter: created, lockedBy: null, lockedAt: null, startedAt: null, priority: 0,
      createdAt: created, updatedAt: created,
    });
    const claimed = await store.jobs.claim('demo', [kind]);
    if (!claimed) throw new Error(`nothing claimable for ${kind}`);
    const outcome = await runJob(deps, claimed);
    if (outcome.status === 'failed') throw new Error(`${kind} failed: ${outcome.error}`);
    return outcome;
  };

  heading(`Researching ${websiteUrl}`);
  await run('research_product');

  const understanding = (await store.understandings.getLatestForProject(organization.id, project.id))!;
  const brand = (await store.brands.list(organization.id))[0]!;

  line('Product', understanding.name);
  line('One line', understanding.oneLiner);
  line('Audience', understanding.targetAudience.slice(0, 2).join(', ') || '—');
  line('Evidence', `${understanding.evidence.length} excerpts from ${understanding.sources.length} pages`);
  line('Claims', `${[...understanding.keyBenefits, ...understanding.differentiators, ...understanding.proofPoints].length} supported`);
  if (understanding.gaps.length > 0) line('Gaps', understanding.gaps[0]!.slice(0, 80));

  heading('Brand, measured');
  line('Primary', `${brand.primaryColor}${brand.primaryCandidates.length > 1 ? ` (of ${brand.primaryCandidates.length} candidates)` : ''}`);
  line('Canvas', `${brand.canvasDark} dark · ${brand.canvasLight} light`);
  line('Type', brand.typography.map((f) => `${f.family}→${f.renderFamily}`).join(', ') || '—');
  line('Radius', `${brand.cornerRadiusPx}px (${brand.cornerStyle})`);
  line('Language', `${brand.visualStyle} · ${brand.motionStyle} · ${brand.layoutDensity}`);
  line('Logo', brand.logo ? `${brand.logo.format} captured` : 'none found');

  heading('Three creative directions');
  await run('generate_concepts');
  const concepts = await store.concepts.listForProject(organization.id, project.id);
  for (const concept of concepts) {
    console.log(`\n  \x1b[1m${concept.name}\x1b[0m  (${concept.narrativeStructure} · ${concept.creativeSystem})`);
    console.log(`    ${concept.keyIdea}`);
    console.log(`    \x1b[2mHook:\x1b[0m ${concept.hook}`);
  }

  heading('Storyboard');
  const chosen = concepts[0]!;
  await store.concepts.select(organization.id, project.id, chosen.id);
  await store.projects.update(organization.id, project.id, { selectedConceptId: chosen.id });
  await run('build_storyboard', { conceptId: chosen.id });

  const storyboard = (await store.storyboards.listForProject(organization.id, project.id))[0]!;
  const mix = visualMix(storyboard);
  line('Chosen', chosen.name);
  line('Scenes', String(storyboard.scenes.length));
  line('Runtime', `${storyboardDuration(storyboard).toFixed(1)}s`);
  line('Mix', `${pct(mix.deterministic)} engine · ${pct(mix.realMedia)} real · ${pct(mix.generative)} generated`);
  console.log('');
  for (const scene of storyboard.scenes) {
    const text = scene.onScreenText.join(' / ') || `\x1b[2m${scene.purpose}\x1b[0m`;
    console.log(
      `  ${String(scene.index + 1).padStart(2, '0')}  ${scene.duration.toFixed(1).padStart(4)}s  ` +
        `${scene.visualType.padEnd(19)} ${text}`,
    );
  }

  if (shouldRender) {
    heading('Rendering');
    await run('render_film', { storyboardId: storyboard.id });
    const render = (await store.renders.listForProject(organization.id, project.id))[0]!;
    line('Status', render.status);
    line('Duration', `${render.durationSeconds.toFixed(1)}s`);
    const qa = await store.qaReports.getForRender(organization.id, render.id);
    if (qa) {
      line('QA', qa.passed ? 'passed' : `${qa.issues.filter((i) => i.severity === 'hard_fail').length} blockers`);
      for (const issue of qa.issues.slice(0, 4)) {
        console.log(`    \x1b[2m${issue.severity}\x1b[0m ${issue.check}: ${issue.message.slice(0, 90)}`);
      }
    }
    if (render.masterAssetId) {
      const asset = await store.assets.get(organization.id, render.masterAssetId);
      line('Master', asset ? path.join(outputDir, 'storage', asset.storageKey) : '—');
    }
    /*
     * What the film was made from, kept beside it: the delivered storyboard
     * (after any repair), the render record and its QA. A film whose every cut,
     * line and cue is known is the one film a reverse analysis can be scored
     * against rather than only looked at.
     */
    const delivered = await store.storyboards.get(organization.id, render.storyboardId);
    const voice = await store.assets.listForProject(organization.id, project.id, 'audio_voice');
    await writeFile(
      path.join(outputDir, 'ground-truth.json'),
      JSON.stringify({ render, storyboard: delivered, qa, voice }, null, 1),
    );
    line('Ground truth', path.join(outputDir, 'ground-truth.json'));
  } else {
    heading('Rendering skipped');
    console.log('  Set ACT_ONE_CHROME_HEADLESS_SHELL to render the film.');
  }

  heading('Cost');
  const byProvider = new Map<string, number>();
  for (const record of costSink.records) {
    byProvider.set(record.provider, (byProvider.get(record.provider) ?? 0) + record.actualCostUsd);
  }
  for (const [provider, cost] of byProvider) line(provider, `$${cost.toFixed(4)}`);
  line('Total', `$${costSink.records.reduce((sum, r) => sum + r.actualCostUsd, 0).toFixed(4)}`);
  line('Elapsed', `${((Date.now() - started) / 1000).toFixed(1)}s`);
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

main().catch((error: unknown) => {
  console.error('\n\x1b[31mDemo failed:\x1b[0m', error instanceof Error ? error.message : error);
  process.exit(1);
});
