/**
 * The offline evaluation harness.
 *
 * Three questions about the Director Brain that a single film cannot answer,
 * asked against fixtures so that two versions of the creative layer can be
 * compared rather than admired.
 *
 *   1. Does the search actually search? Given one brief, how structurally
 *      different are the directions it finds — and how many of them collapse
 *      into each other once you measure rather than read?
 *   2. Does it read a brand, or describe one? Four deliberately unalike
 *      companies should produce four unalike genomes. A layer that returns
 *      0.5 on every dimension for all of them has read nothing.
 *   3. Does the assignment reach the work? The same product with a different
 *      business objective should produce a different creative objective. If
 *      it does not, the goal model is decoration.
 *
 * Nothing here scores creative quality. It measures whether the machinery has
 * any signal in it at all, which is the thing that can be measured and the
 * thing that silently stops being true.
 *
 *   npm run bench:director
 */
import {
  BRAND_DIMENSIONS,
  genomeContrast,
  BrandSystem,
  genomeDistance,
  lexicalOverlap,
  newId,
  territorySpread,
  type BusinessObjective,
  type ProductUnderstanding,
} from '@act-one/core';
import { neutralRamp } from '@act-one/design';
import { ProviderRegistry } from '@act-one/providers';
import { TerritorySearchEngine, UnderstandingEngine } from '@act-one/creative';

const registry = new ProviderRegistry({});
const llm = registry.llm();
const call = { organizationId: 'org_bench', projectId: 'prj_bench' };

/** Four companies that should not read alike to anybody. */
const BRANDS: { name: string; tone: string; style: BrandSystem['visualStyle']; colour: string; vocabulary: string[] }[] = [
  {
    name: 'Ledgerline', tone: 'Exact, unhurried, never an exclamation mark.',
    style: 'minimal', colour: '#1f3a5f',
    vocabulary: ['reconcile', 'ledger', 'close', 'audit', 'controls'],
  },
  {
    name: 'Sprocket', tone: 'Quick, funny, slightly rude. Talks like a group chat.',
    style: 'playful', colour: '#ff5a1f',
    vocabulary: ['grab', 'zap', 'honestly', 'yikes', 'ship it'],
  },
  {
    name: 'Maison Verre', tone: 'Few words, long pauses, nothing explained twice.',
    style: 'editorial', colour: '#0b0b0b',
    vocabulary: ['atelier', 'made', 'hand', 'considered', 'rare'],
  },
  {
    name: 'Nullpointer', tone: 'Dense, technical, assumes you read the RFC.',
    style: 'technical', colour: '#22c55e',
    vocabulary: ['throughput', 'p99', 'daemon', 'idempotent', 'backpressure'],
  },
];

function brandOf(spec: (typeof BRANDS)[number]): BrandSystem {
  const now = new Date().toISOString();
  return BrandSystem.parse({
    id: newId('brd'), organizationId: 'org_bench', name: spec.name, logo: null, logoVariants: [],
    primaryColor: spec.colour, secondaryColor: spec.colour, accentColors: [], primaryCandidates: [spec.colour],
    neutrals: neutralRamp(spec.colour, 9, 0.05), canvasDark: '#08080c', canvasLight: '#ffffff',
    typography: [], visualStyle: spec.style, imageTreatment: 'none', layoutDensity: 'balanced',
    cornerStyle: 'subtle', cornerRadiusPx: 8, motionStyle: 'precise', tone: spec.tone,
    allowsGlow: false, allowsGradient: false, confirmedByUser: true, sources: ['https://bench.example/'],
    communication: {
      language: 'en', vocabulary: spec.vocabulary, positioning: `${spec.name}, in its own words.`,
      claims: [], naming: spec.name, tagline: '', wordsToAvoid: [],
    },
    createdAt: now, updatedAt: now,
  });
}

function understandingOf(name: string): ProductUnderstanding {
  const now = new Date().toISOString();
  return {
    id: newId('pun'), projectId: 'prj_bench', name,
    oneLiner: `${name} closes the books for finance teams in one automated run.`,
    category: 'Financial close management', targetAudience: ['Finance leads'],
    painPoints: [{ text: 'The close takes a week of manual matching.', evidenceIds: [] }],
    keyBenefits: [{ text: 'The close runs unattended.', evidenceIds: [] }],
    differentiators: [{ text: 'Every match is auditable line by line.', evidenceIds: [] }],
    coreFeatures: [{ text: 'Automated reconciliation', evidenceIds: [] }],
    proofPoints: [], productMoments: [], strongestVisualMoments: [],
    tone: 'Plain and exact.', brandTraits: ['precise'], competitorCategory: 'Close management',
    productMaturity: 'growth', launchContext: 'product_launch', evidence: [],
    sources: ['https://bench.example/'], gaps: [], createdAt: now,
  } as ProductUnderstanding;
}

const brief = (objective: BusinessObjective) => ({
  filmFormat: 'product_tour' as const, filmCut: 'feature' as const,
  targetAudience: 'Finance leads at mid-market software companies',
  goal: objective === 'investor_conviction' ? ('fundraise' as const) : ('product_launch' as const),
  keyMessage: null, durationSeconds: 30, channels: [], creativeMode: 'studio' as const,
  voiceStrategy: null, formats: [], excludedClaims: [], realMediaOnly: false,
  language: 'en', tone: null, voiceGender: null, voiceAccent: null, voiceStyle: null, voicePace: null,
});

const understanding = new UnderstandingEngine(llm);
const failures: string[] = [];
let costUsd = 0;

console.log('='.repeat(72));
console.log('1. DOES THE BRAND READING READ ANYTHING?');
console.log('='.repeat(72));

const genomes = [] as { name: string; genome: Awaited<ReturnType<typeof understanding.build>>['genome'] }[];
for (const spec of BRANDS) {
  const built = await understanding.build(
    {
      projectId: 'prj_bench', brief: brief('product_understanding'),
      understanding: understandingOf(spec.name), brand: brandOf(spec), company: spec.name,
      filmCut: 'feature', durationSeconds: 30, language: 'en',
      productionBudgetUsd: 5, productAccess: 'public_site',
    },
    call,
  );
  costUsd += built.costUsd;
  genomes.push({ name: spec.name, genome: built.genome });
  const values = BRAND_DIMENSIONS.map((d) => (built.genome.dimensions[d] ?? 0).toFixed(2)).join(' ');
  console.log(`  ${spec.name.padEnd(14)} ${built.genome.archetype.padEnd(18)} ${values}`);
}

let flattest = 1;
for (let i = 0; i < genomes.length; i += 1) {
  for (let j = i + 1; j < genomes.length; j += 1) {
    const overall = genomeDistance(genomes[i]!.genome, genomes[j]!.genome);
    const contrast = genomeContrast(genomes[i]!.genome, genomes[j]!.genome);
    flattest = Math.min(flattest, contrast.score);
    console.log(
      `  ${genomes[i]!.name.padEnd(14)} vs ${genomes[j]!.name.padEnd(14)} ` +
        `overall ${overall.toFixed(3)} · sharpest ${contrast.score.toFixed(3)} on ${contrast.on.join(', ')}`,
    );
  }
}
console.log(`\n  flattest pair, by sharpest dimensions: ${flattest.toFixed(3)}`);
const sameArchetype = new Set(genomes.map((entry) => entry.genome.archetype)).size;
console.log(`  distinct archetypes: ${sameArchetype} of ${genomes.length}`);
/*
 * A fifth of the range on the three dimensions where two brands differ most.
 * Not the mean across all ten: four companies that are all serious agree on
 * most dimensions because they really are all serious, and character lives in
 * the few where they do not.
 */
if (flattest < 0.2) failures.push(`brand genomes barely differ (flattest pair ${flattest.toFixed(3)}).`);
if (sameArchetype < 3) failures.push(`only ${sameArchetype} distinct archetypes across four unalike companies.`);

console.log(`\n${'='.repeat(72)}`);
console.log('2. DOES THE SEARCH SEARCH?');
console.log('='.repeat(72));

const first = genomes[0]!;
const built = await understanding.build(
  {
    projectId: 'prj_bench', brief: brief('demo_request'),
    understanding: understandingOf('Ledgerline'), brand: brandOf(BRANDS[0]!), company: 'Ledgerline',
    filmCut: 'feature', durationSeconds: 30, language: 'en',
    productionBudgetUsd: 5, productAccess: 'public_site',
  },
  call,
);
costUsd += built.costUsd;

const search = await new TerritorySearchEngine(llm).explore(
  {
    brief: built.brief, understanding: understandingOf('Ledgerline'),
    audience: built.audience, genome: first.genome, recentSignatures: [], target: 16,
  },
  call,
);
costUsd += search.costUsd;

const collapsed = search.verdicts.filter((verdict) => !verdict.kept).length;
console.log(`  proposed  : ${search.verdicts.length}`);
console.log(`  kept      : ${search.territories.length}`);
console.log(`  collapsed : ${collapsed}`);
console.log(`  spread    : ${territorySpread(search.territories).toFixed(3)}`);
console.log(`  mechanisms: ${[...new Set(search.territories.map((t) => t.mechanism))].join(', ')}`);
for (const territory of search.territories) {
  console.log(`    ${territory.mechanism.padEnd(26)} ${territory.name}`);
}
if (search.territories.length < 6) failures.push(`only ${search.territories.length} distinct directions survived.`);
if (territorySpread(search.territories) < 0.45) {
  failures.push(`the directions are too alike (spread ${territorySpread(search.territories).toFixed(3)}).`);
}
if (new Set(search.territories.map((t) => t.mechanism)).size < 5) {
  failures.push('fewer than five distinct mechanisms were reached for.');
}

console.log(`\n${'='.repeat(72)}`);
console.log('3. DOES THE OBJECTIVE REACH THE WORK?');
console.log('='.repeat(72));

const objectives: BusinessObjective[] = ['brand_desirability', 'demo_request'];
const briefs = [] as { objective: BusinessObjective; creativeObjective: string; cta: string }[];
for (const objective of objectives) {
  const made = await understanding.build(
    {
      projectId: 'prj_bench', brief: brief(objective),
      understanding: understandingOf('Ledgerline'), brand: brandOf(BRANDS[0]!), company: 'Ledgerline',
      filmCut: 'feature', durationSeconds: 30, language: 'en',
      productionBudgetUsd: 5, productAccess: 'public_site',
    },
    call,
  );
  costUsd += made.costUsd;
  briefs.push({
    objective,
    creativeObjective: made.brief.creativeObjective,
    cta: made.brief.goal.ctaStrength,
  });
  console.log(`\n  ${objective}`);
  console.log(`    ${made.brief.creativeObjective}`);
  console.log(`    call to action: ${made.brief.goal.ctaStrength}`);
}

const overlap = lexicalOverlap(briefs[0]!.creativeObjective, briefs[1]!.creativeObjective);
console.log(`\n  wording overlap between the two: ${overlap.toFixed(2)}`);
/*
 * Not zero — it is the same product, so the same nouns appear. But two films
 * whose objectives are worded almost identically are two films that will be
 * directed identically, and then the goal model is decoration.
 */
if (overlap > 0.7 && briefs[0]!.cta === briefs[1]!.cta) {
  failures.push('the business objective did not change the creative objective.');
}

console.log(`\n${'='.repeat(72)}`);
console.log(`Spent $${costUsd.toFixed(4)} of reasoning.`);
if (failures.length > 0) {
  console.error('\nFAILED:');
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log('PASS — the machinery has signal in it.');
process.exit(0);
