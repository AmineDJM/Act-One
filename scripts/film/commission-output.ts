/**
 * Commissions the shot the film was missing: its own output.
 *
 * WHY THIS SHOT EXISTS. A model that watched the finished film returned one
 * note above all the others — "the viewer never sees the actual output (the
 * generated film), only the ordering interface" — and scored the film zero for
 * hero moments. It is a film about making films that only ever shows the order
 * form. Every other gap measured in this project is a number; this one is the
 * argument.
 *
 * WHAT IT IS. The film opens on a desk at dusk, cluttered, somebody pushing
 * back from it after too long a day. This is the same desk at dawn: empty,
 * squared, the light rising across it. The rhyme is the point — the opening is
 * the six weeks and this is the afternoon, the same world photographed rather
 * than endured. It reads as the delivered film because it is the only thing in
 * the picture that looks SHOT rather than composed.
 *
 * THE PRODUCT RULE STILL HOLDS, and it is why this is a room and not a
 * timeline. `checkBrief` rejects a brief that commissions an interface, and it
 * would be a genuinely bad idea here: a convincing invented editor presented as
 * Act One's output is the one thing this system must never ship. A model may
 * build the world the product lives in. The output of this product is a piece
 * of film, so a piece of film is exactly what may be commissioned.
 *
 *   ACT_ONE_MANAGED_CREDENTIALS=all npm run commission:output
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ShotBrief, briefToPrompt, checkBrief, sealBrief } from '@act-one/core';
import { HiggsfieldProvider, RunwayProvider } from '@act-one/providers';
import type { GenerativeMediaProvider, VideoRequest } from '@act-one/providers';

const CONTEXT = { organizationId: 'org_quality_sprint' };

const BRIEF = sealBrief(
  ShotBrief.parse({
    id: 'shot_output',
    subject:
      'The same wooden desk at dawn, cleared and squared, low sun crossing the grain of the wood, ' +
      'dust drifting slowly through the beam, one closed notebook set flush to the edge and an empty chair',
    shotScale: 'medium_wide',
    // Pulling back rather than pushing in: the opening pushed INTO the
    // exhaustion, so the payoff should open out of it.
    cameraMotion: 'pull_back',
    cameraIntensity: 0.3,
    framing:
      'The desk runs across the lower half; the sun enters low from frame left and lays a hard bright band across the wood; the chair sits empty at the right.',
    negativeSpace: 'The upper third stays clear and bright, so a line can sit in it without fighting the picture.',
    lens: { focalLengthMm: 35, shallowness: 0.65 },
    // Backlit at dawn, and warmer and far lower in contrast than the opening:
    // the same room, lit like somebody chose to photograph it.
    light: { direction: 'back_lit', contrast: 0.45, temperatureK: 5200 },
    palette: ['#F4F2EC', '#FFB03A', '#2A1006'],
    motionIntensity: 0.28,
    durationSeconds: 4,
    startFrame: 'The desk still in blue pre-dawn shadow, the sun not yet touching it, the room quiet.',
    endFrame: 'Warm low sun fully across the desk, the wood grain lit, the notebook edge bright, the chair still empty.',
    continuity:
      'The same desk, lamp and room as the opening shot, twelve hours later and cleared; the film accent appears only as the warmth in the sunlight, never as a graphic.',
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

const only = process.env['ACT_ONE_SHOT_PROVIDER'] ?? 'higgsfield';
const providers: Record<string, GenerativeMediaProvider> = {
  higgsfield: new HiggsfieldProvider({}) as unknown as GenerativeMediaProvider,
  runway: new RunwayProvider({}) as unknown as GenerativeMediaProvider,
};
const provider = providers[only];
if (!provider) throw new Error(`No such provider: ${only}`);

// Printed before anything is spent: a film that quietly costs whatever the
// first provider charges is a film nobody can budget.
const estimate = await provider.estimateCost?.(request);
console.log(`${only}: estimated $${typeof estimate === 'number' ? estimate.toFixed(3) : '?'}`);

const job = await provider.generateVideo(request, CONTEXT as never);
console.log(`  submitted ${job.id}`);
const done = await provider.waitForJob(job.id, CONTEXT as never, 20 * 60_000);
if (done.status !== 'succeeded' || !done.outputUrls[0]) {
  throw new Error(`${only} returned ${done.status}: ${done.error ?? 'no output'}`);
}

const target = path.resolve('apps/web/public/capture/output.mp4');
await writeFile(target, new Uint8Array(await (await fetch(done.outputUrls[0])).arrayBuffer()));
console.log(`  ${done.model} -> ${target} ($${done.costUsd.toFixed(3)})`);
