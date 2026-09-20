/**
 * Commissions one real shot from a video model, as a brief rather than a prompt.
 *
 * WHY A SHOT AND NOT A LOOK. The three creative directions are typographic —
 * words, colour fields, real captures of the real product. What a native video
 * reading kept saying about the strongest of them is that it is "entirely
 * static text cards", and what benchmark launch films do that this does not is
 * ground the abstraction in something physical before the product arrives. A
 * room. Hands. Light moving across a surface. That shot is the "before" the
 * product replaces, and it is the one thing in this film that cannot come from
 * a screenshot or from type.
 *
 * So the generated footage is doing a job the rest of the film cannot do,
 * rather than being decoration proving a provider works.
 *
 * THE PRODUCT RULE IS NOT NEGOTIABLE HERE. `sealBrief` appends the refusals on
 * the way out and `checkBrief` rejects a brief that commissions an interface —
 * a model asked for a dashboard will draw a convincing one, and a convincing
 * invented dashboard presented as a customer's software is the worst thing
 * this system could ship. A model may build the world the product lives in. It
 * may never build the product.
 *
 *   ACT_ONE_MANAGED_CREDENTIALS=all npm run commission:shot
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ShotBrief, briefToPrompt, checkBrief, sealBrief } from '@act-one/core';
import { HiggsfieldProvider, RunwayProvider } from '@act-one/providers';
import type { GenerativeMediaProvider, VideoRequest } from '@act-one/providers';

const CONTEXT = { organizationId: 'org_quality_sprint' };

/**
 * The shot, written so two competent people would produce the same one.
 *
 * Dusk, one practical source, a desk somebody has been at too long. The frame
 * opens on the hands and ends on the empty desk, which is what makes it
 * cuttable: the film cuts on the emptiness into the colour field that says
 * GONE.
 */
const BRIEF = sealBrief(
  ShotBrief.parse({
    id: 'shot_before',
    subject:
      'A pair of hands pushing back from a cluttered wooden desk at dusk and leaving the frame, ' +
      'a cold cup of coffee and scattered paper left behind, one warm lamp burning at the edge of frame',
    shotScale: 'medium_close',
    cameraMotion: 'push_in',
    cameraIntensity: 0.25,
    framing: 'Hands low and left of centre; the lamp a warm blown highlight at the right edge; the desk surface fills the lower two thirds.',
    negativeSpace: 'The upper right third stays dark and empty, for the word that lands there.',
    lens: { focalLengthMm: 40, shallowness: 0.72 },
    light: { direction: 'practical_sources', contrast: 0.78, temperatureK: 2900 },
    palette: ['#F2F0EA', '#12131A', '#FF4D1F'],
    motionIntensity: 0.3,
    durationSeconds: 4,
    startFrame: 'Both hands flat on the desk, still, the lamp the brightest thing in frame.',
    endFrame: 'The desk empty, the chair edge just leaving frame, the lamp still burning.',
    continuity:
      'Warm practical light from frame right, a dark cool field everywhere else, the same orange the film uses as its accent appearing only in the lamp.',
  }),
);

const problems = checkBrief(BRIEF);
if (problems.length > 0) {
  for (const problem of problems) console.error(`REJECTED ${problem.field}: ${problem.message}`);
  process.exit(1);
}

const { prompt, negative } = briefToPrompt(BRIEF);
console.log('BRIEF');
console.log(`  ${prompt}\n`);
console.log(`  forbids: ${negative}\n`);

const request: VideoRequest = {
  prompt,
  aspect: '16:9',
  tier: 'cinematic',
  durationSeconds: BRIEF.durationSeconds,
  motionStrength: BRIEF.motionIntensity,
};

/*
 * Two vendors, the cheaper one first.
 *
 * Not a fallback for reliability — a choice about what a shot is worth. The
 * estimate is printed before anything is spent, because a film that quietly
 * costs whatever the first provider charges is a film nobody can budget.
 */
const candidates: [string, GenerativeMediaProvider][] = [
  ['higgsfield', new HiggsfieldProvider({}) as unknown as GenerativeMediaProvider],
  ['runway', new RunwayProvider({}) as unknown as GenerativeMediaProvider],
];

const only = process.env['ACT_ONE_SHOT_PROVIDER'];
for (const [name, provider] of candidates) {
  if (only && name !== only) continue;
  if (provider.isConfigured && !provider.isConfigured()) {
    console.log(`${name}: no credential in this process`);
    continue;
  }
  const estimate = await provider.estimateCost(request).catch(() => Number.NaN);
  /*
   * Zero means "this vendor publishes no estimate", not "this shot is free".
   * Runway prices in credits and offers no estimate endpoint, and its provider
   * deliberately returns 0 with an unknown-price basis rather than inventing a
   * figure — so printing "$0.000" here would turn an honest refusal to guess
   * into a false claim about what a film costs.
   */
  const price = !Number.isFinite(estimate) ? 'unavailable' : estimate > 0 ? `$${estimate.toFixed(3)}` : 'not published by this vendor';
  console.log(`${name}: estimate ${price}`);

  if (process.env['ACT_ONE_COMMISSION'] !== '1') {
    console.log(`  dry run. Set ACT_ONE_COMMISSION=1 to actually buy this shot.`);
    continue;
  }

  try {
    const job = await provider.generateVideo(request, CONTEXT);
    console.log(`  job ${job.id} on ${job.model} (${job.status})`);
    const done = await provider.waitForJob(job.id, CONTEXT, 12 * 60_000);
    console.log(`  ${done.status} $${done.costUsd.toFixed(3)} ${done.outputUrls.join(' ')}`);
    if (done.status === 'succeeded' && done.outputUrls[0]) {
      const bytes = Buffer.from(await (await fetch(done.outputUrls[0])).arrayBuffer());
      const out = path.resolve(`.renders/shot-before.${name}.mp4`);
      await writeFile(out, bytes);
      console.log(`  wrote ${out} (${(bytes.length / 1e6).toFixed(1)} MB)`);
      break;
    }
    if (done.error) console.log(`  error: ${done.error}`);
  } catch (error) {
    console.log(`  FAILED: ${String(error).slice(0, 300)}`);
  }
}
