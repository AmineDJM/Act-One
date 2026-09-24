/**
 * Renders the reference films shown on /work.
 *
 * These are our own demonstration projects for fictional companies, and they
 * are labelled as such everywhere they appear — presenting invented work as a
 * real client's launch is the exact dishonesty this product refuses to commit
 * on a customer's behalf, and it would be strange to do it on our own site.
 *
 * Written out by hand rather than generated on each run, for two reasons. The
 * copy on a marketing page should be something a person chose, and a reference
 * film that changes every time somebody runs a script is not a reference. What
 * this does exercise is the real thing: the real brand system, the real
 * creative systems, the real type and colour engines, the real renderer. If a
 * scene here looks wrong, a customer's film is wrong too.
 *
 *   npm run reference-films
 */
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { renderFilm } from '@act-one/motion';
import { runDeterministicChecks, verifyMaster } from '@act-one/qa';
import { getSystem } from '@act-one/creative';
import {
  DEFAULT_LIBRARY,
  buildMix,
  directSound,
  masterLoudness,
  mixArgs,
  muxArgs,
  runFfmpeg,
} from '@act-one/sound';
import { FILMS } from './reference-films-data.ts';

const OUT = path.resolve(process.cwd(), 'apps/web/public/work');
const STORAGE = process.env['ACT_ONE_STORAGE_DIR'] ?? path.resolve('.act-one-demo/storage');

const browserExecutable = process.env['ACT_ONE_CHROME_HEADLESS_SHELL'];

/*
 * Our own shop window is held to our own standards.
 *
 * These are hand-written rather than generated, which makes it easy for them
 * to quietly fall behind the rules every customer's film is checked against —
 * and a reference film that would fail QA is an advertisement for work we
 * would refuse to deliver. So they are checked before they are rendered, and a
 * failure stops the build rather than shipping to the marketing page.
 */
for (const film of FILMS) {
  const issues = runDeterministicChecks({
    storyboard: film.props.storyboard,
    brand: film.props.brand,
    aspect: '16:9',
    cta: film.props.cta,
    /*
     * The figures in these films cite evidence the way a real project's would.
     * The evidence is invented, because the companies are — and they are
     * labelled as fictional everywhere they appear, which is the difference
     * between a demonstration and a fabrication. Stripping the numbers instead
     * would make the shop window less like the product, and passing them
     * uncited would mean exempting ourselves from the rule we hold every
     * customer's film to.
     */
    knownEvidenceIds: new Set([
      'evd_northwind_close',
      'evd_meridian_latency',
      'evd_halyard_pages',
    ]),
  }).filter((issue) => issue.severity === 'hard_fail' || issue.severity === 'soft_fail');

  if (issues.length > 0) {
    console.error(`\n${film.slug} would not pass our own QA:`);
    for (const issue of issues) console.error(`  ${issue.severity} ${issue.check}: ${issue.message}`);
    process.exit(1);
  }
}
console.log(`${FILMS.length} reference films pass deterministic QA`);

await mkdir(OUT, { recursive: true });

for (const film of FILMS) {
  const started = Date.now();

  /*
   * Picture first, then the real sound chain.
   *
   * These used to ship with no audio stream at all — three silent films as the
   * shop window for a product whose sound design is half of what it makes. The
   * chain below is the pipeline's, not an approximation of it: the same Sound
   * Director reading the same creative system, the same mix graph with its
   * sidechain, and the same two-pass master. If the sound here is wrong, a
   * customer's film is wrong too, which is the whole point of these existing.
   */
  const silentPath = path.join(OUT, `${film.slug}.silent.mp4`);
  await renderFilm({
    props: film.props,
    aspect: '16:9',
    quality: 'hd',
    outputPath: silentPath,
    ...(browserExecutable ? { browserExecutable } : {}),
  });

  const design = directSound({
    storyboard: film.props.storyboard,
    behaviour: getSystem(film.system).sound,
    channel: 'web',
    hasVoiceOver: false,
  });

  const resolvedPaths = Object.fromEntries(
    [...DEFAULT_LIBRARY.music, ...DEFAULT_LIBRARY.sfx]
      .map((item) => [item.storageKey, path.join(STORAGE, item.storageKey)] as const)
      .filter(([, file]) => existsSync(file)),
  );

  const missing = [design.music?.storageKey, ...design.cues.map((cue) => cue.storageKey)]
    .filter((key): key is string => Boolean(key))
    .filter((key) => !resolvedPaths[key]);
  if (missing.length > 0) {
    console.error(`\n${film.slug} has no sound library to score with. Run \`npm run sound-library\`.`);
    process.exit(1);
  }

  const plan = buildMix({
    design,
    resolvedPaths,
    durationSeconds: film.props.storyboard.scenes.reduce((sum, scene) => sum + scene.duration, 0),
  });

  const premaster = path.join(OUT, `${film.slug}.premix.wav`);
  const mixed = await runFfmpeg(mixArgs(plan, premaster), { timeoutMs: 5 * 60_000 });
  if (!mixed.ok) throw new Error(`${film.slug} mix failed: ${mixed.stderr.slice(-400)}`);

  const mastered = path.join(OUT, `${film.slug}.mix.wav`);
  await masterLoudness({
    source: premaster,
    target: mastered,
    lufs: design.targetLufs,
    outputArgs: ['-c:a', 'pcm_s24le'],
  });

  const muxed = await runFfmpeg(
    muxArgs(silentPath, mastered, path.join(OUT, `${film.slug}.mp4`)),
    { timeoutMs: 5 * 60_000 },
  );
  if (!muxed.ok) throw new Error(`${film.slug} mux failed: ${muxed.stderr.slice(-400)}`);

  // The same gate every customer's master passes: the file has to say the
  // right things and decode end to end, or the shop window shows a film that
  // some visitors' browsers would refuse.
  const playable = await verifyMaster(path.join(OUT, `${film.slug}.mp4`), { width: 1920, height: 1080 });
  if (playable.issues.length > 0) {
    console.error(`\n${film.slug} would not play everywhere:`);
    for (const issue of playable.issues) console.error(`  ${issue}`);
    process.exit(1);
  }

  await Promise.all([rm(silentPath, { force: true }), rm(premaster, { force: true }), rm(mastered, { force: true })]);

  // A poster held a beat after the first cut, so the card shows the film
  // composed rather than the frame before anything has moved.
  await renderFilm({
    props: film.props,
    aspect: '16:9',
    quality: 'hd',
    outputPath: path.join(OUT, `${film.slug}.png`),
    stillAtSeconds: film.posterAt,
    ...(browserExecutable ? { browserExecutable } : {}),
  });

  const seconds = film.props.storyboard.scenes.reduce((sum, scene) => sum + scene.duration, 0);
  console.log(`${film.slug.padEnd(10)} ${seconds.toFixed(1)}s film + poster in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

console.log(`\nWritten to ${OUT}`);
