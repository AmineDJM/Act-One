/**
 * The film, made as one timeline rather than as four deliverables.
 *
 * ORDER OF OPERATIONS, and it is the whole point. The voice is read FIRST. Its
 * real word timings are measured. The cut is then laid out from those timings,
 * the typography is generated from the words that were actually said at the
 * seconds they were actually said, and the sound cues are placed on the
 * emphasis moments the reading reports. Nothing is fitted to a schedule that
 * does not know what the voice is doing, because there is no such schedule.
 *
 * The old path — scripts/film/launch.ts — authored shots with durations and
 * placed narration into them afterwards. Every complaint about that film came
 * back to the same thing: the words on screen were not the words being said,
 * so no amount of casting, tuning or aligning could connect them.
 *
 *   ACT_ONE_MANAGED_CREDENTIALS=all npm run film
 */
import path from 'node:path';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BrandSystem, DIALOGUE_LEAD_MIN, inspectScenes } from '@act-one/core';
import { layout, performanceFor, subtitlesFor, type BeatIntent, type SpokenWord } from '@act-one/creative';
import { neutralRamp } from '@act-one/design';
import { EASINGS, renderScenes } from '@act-one/motion';
import {
  DEFAULT_LIBRARY, buildMix, masterLoudness, mixArgs, muxArgs, runFfmpeg, soundForScenes,
  analyseVoice, bedReductionDb, readDialogueLead,
} from '@act-one/sound';
import { ElevenLabsProvider } from '@act-one/providers';
import { BEATS, VISUALS } from './beats.ts';
import { compileBeats } from './compile-beats.ts';

const STORAGE = process.env['ACT_ONE_STORAGE_DIR'] ?? path.resolve('.act-one-demo/storage');
const BASE = process.env['ACT_ONE_CAPTURE_BASE'] ?? 'http://localhost:3000/capture';
const PUBLIC = path.resolve('apps/web/public/capture');
const VO = path.resolve('.renders/vo-beats');

const PALETTE = { ink: '#0B0C10', paper: '#F4F2EC', accent: '#FF4D1F', amber: '#FFB03A', ember: '#2A1006' };

/**
 * Refuse early if nothing is serving the captures.
 *
 * The renderer fetches every capture over HTTP from the web app, so when that
 * process is not running the render still starts, spends three minutes, and
 * dies at the last frame with a wall of 404s. That has now cost two full
 * renders after a container restart took the server with it. A HEAD request
 * costs nothing and turns a late, noisy failure into an immediate sentence.
 */
async function requireCaptureServer(): Promise<void> {
  const probe = `${BASE}/home_hero.png`;
  try {
    const response = await fetch(probe, { method: 'HEAD' });
    if (response.ok) return;
    throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(
      `Nothing is serving the captures at ${BASE} (${(error as Error).message}). ` +
      'Start the web app first: npm run dev',
    );
  }
}
await requireCaptureServer();

const ASSETS: Record<string, string> = {};
// The hero crop is a known 1580x680, which is what lets the audit beat place
// its marks by arithmetic instead of by eye.
for (const name of ['home', 'how', 'work', 'pricing', 'home_hero', 'how_stages'] as const) {
  if (existsSync(path.join(PUBLIC, `${name}.png`))) ASSETS[`ast_${name}`] = `${BASE}/${name}.png`;
}
for (const [key, file] of [
  ['ast_opening', 'opening.mp4'], ['ast_before', 'before.mp4'],
  ['ast_dir_a', 'dir-a-paper.mp4'], ['ast_dir_b', 'dir-b-depth.mp4'], ['ast_dir_c', 'dir-c-field.mp4'],
] as const) {
  if (existsSync(path.join(PUBLIC, file))) ASSETS[key] = `${BASE}/${file}`;
}

const brand = BrandSystem.parse({
  id: 'brn_launch', organizationId: 'org_launch', name: 'Act One',
  primaryColor: PALETTE.accent,
  secondaryColor: neutralRamp(PALETTE.accent, 9, 0.05)[6] ?? PALETTE.accent,
  primaryCandidates: [PALETTE.accent], neutrals: neutralRamp(PALETTE.accent, 9, 0.05),
  canvasDark: PALETTE.ink, canvasLight: PALETTE.paper,
  visualStyle: 'editorial', motionStyle: 'precise', cornerStyle: 'subtle', cornerRadiusPx: 10,
  confirmedByUser: true,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

// ---------------------------------------------------------------------------
// 1. THE VOICE, FIRST
// ---------------------------------------------------------------------------

const VOICE = process.env['ACT_ONE_VOICE'] ?? 'iP95p4xoKVk53GoZ742B';
/*
 * eleven_v3, AND THE REASON IT IS NOW RIGHT IS THE REASON IT WAS ONCE WRONG.
 *
 * This film ran on eleven_multilingual_v2 for a long time, chosen deliberately:
 * v3 accepts no continuity at all — previous_text, next_text and
 * previous_request_ids each hard-400 — so it reads every line as a cold start,
 * and "rigid" and "disjointed" was what a critic said about the result. v2's
 * continuity was worth more than v3's expressiveness.
 *
 * That was true of a film where every line was read with one direction. It is
 * not true of this one. Each beat now carries its own register and its own
 * written breath, so the continuity v2 was supplying is being supplied by the
 * script instead — and what is left to compare is expressiveness, which is
 * what v3 has.
 *
 * Measured rather than assumed, three readings of each finished mix by the ear
 * that hears the whole thing:
 *
 *   soundsHuman            6.7 [6,7,7]  ->  8.0 [8,8,8]
 *   toneMatchesClaim       8.0 [8,8,8]  ->  9.0 [9,9,9]
 *   authoredTogether       7.7 [7,8,8]  ->  8.7 [9,8,9]
 *   wouldYouKeepListening  7.3 [7,7,8]  ->  9.0 [9,9,9]
 *
 * Three of the four spreads do not overlap, which is what makes this a result
 * rather than a coin toss on a critic with a one-point noise floor. The tells
 * changed character too: v2's readings all said flat, mechanical, lacking
 * natural pauses; one of v3's said the pacing and intonation "vary naturally,
 * with subtle emphasis and pauses that mimic human thought".
 *
 * It also sits better in the mix unaided — the quietest line arrives 3.9 LU
 * above the bed rather than 0.4, so the correction takes 0.6 dB of music out
 * instead of 4.1.
 */
const MODEL = process.env['ACT_ONE_VOICE_MODEL'] ?? 'eleven_v3';
/**
 * THE VOICE IS DIRECTED PER BEAT, not once for the whole film.
 *
 * This was a single object — one stability, one expressiveness, one pace, from
 * the hook to the sign-off — and it produced exactly what that describes. Four
 * consecutive craft readings named the narration as the strongest tell that a
 * machine made the film ("lacks any human inflection", "entirely synthetic and
 * robotic"), and the note from the person who commissioned it was the same:
 * monotone from A to Z. Not that it should never be flat. b4 and b11 SHOULD be
 * flat — a film naming itself and a film turning are both moments to be
 * certain rather than expressive. The fault was that every other line was flat
 * too, and emphasis is a difference: with nothing to differ from, there is no
 * emphasis anywhere.
 *
 * The register comes from the beat's own intent, so the same decision that
 * tells the engine to confide also tells the camera to hold and the words to
 * assemble slowly. A voice leaning into a picture that is not leaning is worse
 * than neither moving.
 */
const BASE_DIRECTION = {
  language: 'en', locale: 'en-US', gender: 'male' as const,
  voiceProfile: 'assured male, 30-45, founder rather than announcer',
  tone: 'Direct, certain.',
  style: 'professional' as const, context: 'launch_film' as const,
  emotionCurve: [], avoid: [],
};

function directionFor(beat: { intent?: BeatIntent }) {
  const performance = performanceFor(beat.intent);
  return {
    ...BASE_DIRECTION,
    profile: performance.profile,
    energy: performance.energy,
    pace: performance.pace,
    stability: performance.stability,
  };
}

mkdirSync(VO, { recursive: true });
const provider = new ElevenLabsProvider({ models: { final: MODEL, preview: MODEL } });
const readings = new Map<string, { durationSeconds: number; words: SpokenWord[] }>();
const spoken: string[] = [];

console.log(`=== reading the script: ${BEATS.filter((b) => b.line).length} lines, ${VOICE} on ${MODEL} ===`);
for (const [index, beat] of BEATS.entries()) {
  if (!beat.line) continue;
  const previousText = BEATS.slice(0, index).reverse().find((b) => b.line)?.line ?? null;
  const nextText = BEATS.slice(index + 1).find((b) => b.line)?.line ?? null;
  const key = createHash('sha256')
    // The direction is in the key: changing a beat's register must re-read it.
    .update(JSON.stringify({ line: beat.line, previousText, nextText, VOICE, MODEL, direction: directionFor(beat), v: 2 }))
    .digest('hex').slice(0, 16);
  const mp3 = path.join(VO, `${beat.id}-${key}.mp3`);
  const json = `${mp3}.json`;

  if (!existsSync(json)) {
    const result = await provider.synthesize(
      {
        text: beat.line, voiceId: VOICE, persona: 'narrator_low', language: 'en', quality: 'final',
        direction: directionFor(beat) as never, wantWordTimings: true,
        continuity: { previousText, nextText, previousRequestIds: spoken.slice(-3) },
      },
      { organizationId: 'org_launch', projectId: 'prj_launch' } as never,
    );
    if (result.requestId) spoken.push(result.requestId);
    writeFileSync(mp3, result.audio);
    writeFileSync(json, JSON.stringify(result.words ?? []));
  }

  const words: SpokenWord[] = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(json, 'utf8')));
  /*
   * The DURATION comes from the file, not from the last word's end time.
   *
   * A reading has air after its last consonant, and cutting a beat at the end
   * of the final word clips the tail of the performance. The measurement is
   * what the mix will actually play.
   */
  const heard = await analyseVoice(mp3, { loudness: false });
  readings.set(beat.id, { durationSeconds: heard?.durationSeconds ?? 0, words });
  process.stdout.write(`  ${beat.id} ${(heard?.durationSeconds ?? 0).toFixed(2)}s  ${words.length} words\n`);
}

// ---------------------------------------------------------------------------
// 2. THE CUT, FROM THE READING
// ---------------------------------------------------------------------------

const timed = layout(BEATS, readings, { tailSeconds: 0.4, breathSeconds: 0.2, maxWords: 5 });
const seconds = timed.reduce((sum, beat) => sum + beat.durationSeconds, 0);
console.log(`\n=== the film: ${seconds.toFixed(1)}s, ${timed.length} beats ===`);
for (const beat of timed) {
  const emphasis = beat.emphasisAtSeconds !== null ? ` emphasis@${beat.emphasisAtSeconds.toFixed(2)}s` : '';
  console.log(`  ${beat.id.padEnd(4)} ${beat.atSeconds.toFixed(1).padStart(5)}s +${beat.durationSeconds.toFixed(2)}s  ${beat.phrases.length} phrase(s)${emphasis}`);
  for (const phrase of beat.phrases) console.log(`        "${phrase.text}" @${phrase.atSeconds.toFixed(2)}s${phrase.carriesEmphasis ? '  <- the word' : ''}`);
  /*
   * The subtitle track is PRINTED, because it has broken twice unnoticed.
   *
   * Phrases are what the editorial layer composes from; captions are what a
   * viewer reads, and the two are allowed to differ. Every time they drifted
   * apart wrongly it was invisible until somebody watched the film. Now the
   * run that builds the film also shows what it will say, with how long each
   * line is on screen, so a flash or a lead is visible before a frame renders.
   */
  for (const row of subtitlesFor(beat.phrases, beat.durationSeconds)) {
    const held = row.untilSeconds - row.atSeconds;
    console.log(`     cc "${row.text}" @${row.atSeconds.toFixed(2)}s for ${held.toFixed(2)}s`);
  }
}

const scenes = compileBeats(timed, { palette: PALETTE, visuals: VISUALS, assets: ASSETS });

const findings = inspectScenes(scenes, EASINGS, {});
const problems = findings.filter((f) => f.severity === 'hard_fail');
/*
 * Blockers first, and never truncated.
 *
 * This printed the first twelve findings of any severity, and this film's
 * palette IS its brand, so a dozen brand_token_violations filled the list and
 * pushed the one hard failure off the end. It said "refusing to render" and
 * showed nothing that would refuse to render, which cost a render and a wrong
 * diagnosis — I had begun debugging a change that was never exercised.
 */
for (const f of problems) {
  console.log(`  HARD FAIL ${f.check.padEnd(28)} ${f.sceneId} ${f.message.slice(0, 120)}`);
}
const soft = findings.filter((f) => f.severity === 'soft_fail' && f.check !== 'brand_token_violation');
for (const f of soft.slice(0, 8)) {
  console.log(`  soft_fail ${f.check.padEnd(28)} ${f.sceneId} ${f.message.slice(0, 96)}`);
}
const tokenNotes = findings.length - problems.length - soft.length;
if (tokenNotes > 0) console.log(`  (${tokenNotes} notes suppressed: this film's palette is its brand)`);
if (problems.length) { console.log('  refusing to render'); process.exit(1); }
if (process.env['ACT_ONE_INSPECT_ONLY']) process.exit(0);

// ---------------------------------------------------------------------------
// 3. PICTURE, THEN SOUND, BOTH ON THE SAME CLOCK
// ---------------------------------------------------------------------------

const silent = path.resolve('.renders/one-timeline.silent.mp4');
const out = path.resolve('.renders/one-timeline.mp4');
/*
 * A refused render must not leave the last one lying there.
 *
 * Three times now I have changed something, had the inspector refuse the
 * render, extracted a frame from the file still on disk from the PREVIOUS
 * run, and concluded the change did not work. Twice I started debugging code
 * that was never executed. The stale file is the whole problem: it is
 * indistinguishable from a fresh one, and it is the thing you reach for when
 * you want to know whether the fix landed.
 *
 * So the output goes before the render begins. If this run refuses, there is
 * nothing to misread.
 */
if (existsSync(out)) rmSync(out);

/*
 * ACT_ONE_MIX_ONLY reuses the existing silent picture.
 *
 * The audio half of this film costs seconds to rebuild and the picture costs
 * three minutes, and every audio question was being paid for at picture
 * prices. That is not a convenience: an audio defect that takes three minutes
 * to re-test gets tested once and guessed at thereafter, which is how the mix
 * went out unmeasured. It is refused when there is no picture to reuse, rather
 * than quietly muxing onto nothing.
 */
const mixOnly = process.env['ACT_ONE_MIX_ONLY'] === '1';
if (mixOnly && !existsSync(silent)) {
  throw new Error('ACT_ONE_MIX_ONLY needs an existing silent render at .renders/one-timeline.silent.mp4; there is none.');
}
if (mixOnly) {
  console.log('  reusing the existing picture (ACT_ONE_MIX_ONLY)');
} else {
  const started = Date.now();
  await renderScenes({
    scenes, brand, assetUrls: ASSETS, aspect: '16:9',
    quality: (process.env['ACT_ONE_QUALITY'] as 'preview' | 'hd' | undefined) ?? 'hd',
    outputPath: silent, concurrency: 3, theme: 'light',
  });
  console.log(`  rendered in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

/*
 * WHERE THIS FILM TURNS, told rather than guessed.
 *
 * The beat whose register is `land` and whose frame fills with the accent is
 * the turn — "Take the waiting out." The sound director had been inferring it
 * by scanning for the first product scene, which a scene-graph film never has,
 * so the score's drop has never once been placed on anything. Three separate
 * readings called the music a passive bed that ignores the structure; it was
 * starting at the top of the track and landing its drop wherever the track
 * happened to put it.
 */
const turnBeat = timed.find((beat) => beat.intent === 'land' && VISUALS[beat.id]?.kind === 'statement'
  && (VISUALS[beat.id] as { field?: string | null }).field === PALETTE.accent);
const turnAtSeconds = turnBeat ? turnBeat.atSeconds + (turnBeat.emphasisAtSeconds ?? 0) : undefined;
if (turnAtSeconds !== undefined) {
  console.log(`  the film turns at ${turnAtSeconds.toFixed(1)}s (${turnBeat!.id}); the score's drop is placed there.`);
}

const design = soundForScenes(scenes, {
  ...(turnAtSeconds !== undefined ? { turnAtSeconds } : {}),
  behaviour: { musicCharacter: 'percussive', openOnMusic: false, uiSoundDensity: 'rhythmic', impactsOnCuts: true, endWithSting: true },
  channel: 'web', hasVoiceOver: true,
});
const resolved = Object.fromEntries(
  [...DEFAULT_LIBRARY.music, ...DEFAULT_LIBRARY.sfx]
    .map((item) => [item.storageKey, path.join(STORAGE, item.storageKey)] as const)
    .filter(([, file]) => existsSync(file)),
);

// The voice goes on the timeline at the beat's own voice offset — the same
// number the typography was generated from.
const voiceTracks = timed
  .filter((beat) => readings.has(beat.id))
  .map((beat) => ({
    path: path.join(VO, `${beat.id}-${createHash('sha256').update(JSON.stringify({
      line: beat.line,
      previousText: BEATS.slice(0, BEATS.findIndex((b) => b.id === beat.id)).reverse().find((b) => b.line)?.line ?? null,
      nextText: BEATS.slice(BEATS.findIndex((b) => b.id === beat.id) + 1).find((b) => b.line)?.line ?? null,
      VOICE, MODEL, direction: directionFor(beat), v: 2,
    })).digest('hex').slice(0, 16)}.mp3`),
    atSeconds: beat.atSeconds + beat.voiceAtSeconds,
    durationSeconds: readings.get(beat.id)!.durationSeconds,
  }));

let plan = buildMix({ design, resolvedPaths: resolved, durationSeconds: seconds, voiceTracks });

/*
 * DOES THE MUSIC COVER THE WORDS? MEASURED, not assumed.
 *
 * The critic that listens to the mix said twice, on two different renders,
 * that "the music briefly overpowers the narration" — and the number that
 * decides it was never taken here. The sidechain compressor ducks the bed
 * under the voice, which is the right tool and still a guess about how much:
 * a quiet bed ducks to nothing and a loud one ducks to not enough.
 *
 * The pipeline has measured and corrected this for a long time
 * (pipeline/stages/render.ts). This script never called it. So the film that
 * is the acceptance criterion for the whole project was the one film going out
 * unmeasured, and the correction existed the entire time.
 *
 * Meter the bed and the voice separately over the stretches where somebody is
 * actually speaking, take the bed down by the shortfall, and meter again — the
 * second reading is the one that proves it, because the first only says what
 * was wrong.
 */
/**
 * The WORST line, not the average of all of them.
 *
 * One integrated reading over the union of every voice window is the number a
 * dubbing stage would not accept. A film can lead by 4.5 LU overall while one
 * line sits under a loud passage and is genuinely hard to hear — the average
 * is carried by the quiet stretches, and the buried line is exactly the moment
 * a listener notices. The audio critic reported "the music briefly overpowers
 * the voice" on a mix that had already passed the integrated floor, twice, and
 * it was right both times: BRIEFLY is what an integrated measurement cannot
 * see.
 *
 * So every line is metered against the bed underneath it and the quietest one
 * decides. Correcting to the worst line costs a decibel of music and buys the
 * one thing the measurement exists for.
 */
type LineLead = { leadLu: number; voiceLufs: number; musicLufs: number };

async function worstLine(
  built: typeof plan,
  windows: typeof voiceTracks,
): Promise<{ lead: LineLead; at: number } | null> {
  let worst: { lead: LineLead; at: number } | null = null;
  for (const window of windows) {
    const read = await readDialogueLead(built, [window]);
    if (!('leadLu' in read)) continue;
    if (!worst || read.leadLu < worst.lead.leadLu) worst = { lead: read, at: window.atSeconds };
  }
  return worst;
}

if (voiceTracks.length > 0 && design.music) {
  let worst = await worstLine(plan, voiceTracks);
  let lead = worst?.lead ?? null;
  if (lead) {
    const reduction = bedReductionDb(lead);
    console.log(`  quietest line leads music by ${lead.leadLu.toFixed(1)} LU at ${worst!.at.toFixed(1)}s (voice ${lead.voiceLufs.toFixed(1)}, bed ${lead.musicLufs.toFixed(1)} LUFS)`);
    if (reduction > 0) {
      plan = buildMix({
        design: { ...design, music: { ...design.music, baseGainDb: design.music.baseGainDb - reduction } },
        resolvedPaths: resolved,
        durationSeconds: seconds,
        voiceTracks,
      });
      worst = await worstLine(plan, voiceTracks);
      lead = worst?.lead ?? null;
      console.log(`  bed taken down ${reduction} dB -> quietest line now leads by ${lead ? lead.leadLu.toFixed(1) : '?'} LU`);
    }
    // Said out loud rather than swallowed: one correction is not guaranteed to
    // be enough, and a mix that still fails the floor must not look like a pass.
    if (lead && lead.leadLu < DIALOGUE_LEAD_MIN) {
      console.log(`  STILL UNDER THE FLOOR: ${lead.leadLu.toFixed(1)} LU against a floor of ${DIALOGUE_LEAD_MIN}. The words do not carry.`);
    }
  } else {
    /*
     * Null has three causes and they are not the same problem: the mix has no
     * music bus, no voice bus, or ffmpeg/the meter did not produce two
     * readings. Reporting them as one line was how this stayed unexplained.
     */
    console.log('  dialogue lead could not be measured on any voice window.');
  }
}

const premix = path.resolve('.renders/one-timeline.premix.wav');
const mixed = await runFfmpeg(mixArgs(plan, premix), { timeoutMs: 8 * 60_000 });
if (!mixed.ok) throw new Error(`mix failed: ${mixed.stderr.slice(-300)}`);
const master = path.resolve('.renders/one-timeline.mix.wav');
await masterLoudness({ source: premix, target: master, lufs: design.targetLufs, outputArgs: ['-c:a', 'pcm_s24le'] });
const muxedOk = await runFfmpeg(muxArgs(silent, master, out), { timeoutMs: 8 * 60_000 });
if (!muxedOk.ok) throw new Error(`mux failed: ${muxedOk.stderr.slice(-300)}`);
console.log(`  ${design.cues.length} cues, ${design.targetLufs} LUFS -> ${out}`);
