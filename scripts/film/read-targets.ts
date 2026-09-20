/**
 * Reads the reference films we are being asked to match.
 *
 * A deep pass per film, on the real file, with a focus that asks for the
 * things a director would have to copy rather than the things a viewer would
 * say. "It looks premium" is not actionable; "the cut at 4.2s is a match cut
 * on a shape carried from the previous shot" is.
 *
 * The readings are written to .renders/ref/target-readings.json and nothing
 * here decides anything. Deciding comes after, from the readings plus what
 * FFmpeg and OpenCV measure, kept apart.
 *
 *   ACT_ONE_MANAGED_CREDENTIALS=all npm run read:targets
 */
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { GeminiVideoAnalyst } from '@act-one/providers';
import type { VideoAnalysis } from '@act-one/providers';

const CONTEXT = { organizationId: 'org_quality_sprint' };

const FOCUS = [
  'This is a reference film a studio has been asked to match. Read it as a director who must',
  'reproduce its craft, not as a critic scoring it.',
  'Be concrete and specific about mechanism:',
  'For every cut or transition, say what the mechanism is — hard cut, match cut on a shape, mask',
  'reveal, an object carried across, a camera move continuing through the boundary, a morph.',
  'Say what the film is actually made of: live footage, 3D render, photographed objects, vector',
  'graphics, typography, real product capture, particles, hand-drawn elements.',
  'Describe the camera in each shot: what it does, how far it travels, what lens it reads as.',
  'Describe the typography: weight, scale relative to frame, where it sits, how it enters and leaves.',
  'Say what the recurring visual device is — the thing the film repeats so you remember it.',
  'Describe the colour: how many colours, how they are used, when the palette changes.',
  'Describe the sound: what layers, where the accents land, what the music does at each turn.',
  'Say what gives it texture — grain, depth of field, motion blur, lighting, imperfection.',
  'Name the three hardest things to reproduce and why.',
].join(' ');

const TARGETS = ['target1', 'target2', 'target3'];
const only = process.env['ACT_ONE_TARGET'];
const readings: Record<string, unknown> = {};

for (const slug of TARGETS) {
  if (only && slug !== only) continue;
  const file = path.resolve(`.renders/ref/${slug}.mp4`);
  if (!existsSync(file)) {
    console.log(`${slug}: missing`);
    continue;
  }
  console.log(`\n=== ${slug} ===`);
  const analyst = new GeminiVideoAnalyst({});
  if (!analyst.isConfigured()) throw new Error('No Gemini credential in this process.');

  try {
    const analysis: VideoAnalysis = await analyst.analyse(
      { source: file, depth: 'deep', fps: 4, focus: FOCUS },
      CONTEXT,
    );
    readings[slug] = analysis;
    console.log(`  model=${analysis.model}`);
    console.log(`  boundaries=${analysis.boundaries.length} beats=${analysis.beats.length} camera=${analysis.camera.length} transitions=${analysis.transitions.length} hero=${analysis.heroMoments.length}`);
    for (const t of analysis.transitions.slice(0, 8)) console.log(`    transition ${JSON.stringify(t).slice(0, 200)}`);
    for (const c of analysis.camera.slice(0, 6)) console.log(`    camera ${JSON.stringify(c).slice(0, 200)}`);
    for (const h of analysis.heroMoments.slice(0, 3)) console.log(`    hero ${JSON.stringify(h).slice(0, 220)}`);
    for (const l of analysis.limitations.slice(0, 6)) console.log(`    note: ${l}`);
  } catch (error) {
    readings[slug] = { failed: String(error).slice(0, 400) };
    console.log(`  FAILED: ${String(error).slice(0, 300)}`);
  }
}

const out = path.resolve('.renders/ref/target-readings.json');
const prior = existsSync(out) ? JSON.parse(await (await import('node:fs/promises')).readFile(out, 'utf8')) : {};
await writeFile(out, JSON.stringify({ ...prior, ...readings }, null, 2));
console.log(`\nwrote ${out}`);
