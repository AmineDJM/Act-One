/**
 * An Act One Original: the film the studio makes about itself.
 *
 * Built as a proving ground for the craft the four benchmark films were
 * measured for, and written from product truth rather than invention — every
 * claim in it is something this repository actually does, which is the one
 * subject where no research pass is needed to be honest.
 *
 * THE THESIS. Scattered evidence becomes one directed film. That is literally
 * what the pipeline does, and it is the same shape the references use: a
 * fragmentation the viewer recognises, a cause, a named solution, a
 * demonstration, proof, and a resolution that lands on the mark.
 *
 * THE STRUCTURE is the one measured across all four references — problem,
 * cause, solution, demonstration, proof, value — with the hero moment at
 * about a quarter in and a second one near the end, where all four put theirs.
 *
 * THE FIELDS carry the argument rather than decorating it. `converge` is the
 * thesis stated in motion; `settle` is order arriving; `disperse` is reach.
 * Beats with no field are the rest the references have and the first version
 * of this did not.
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { BrandSystem, resequence, type Scene, type Storyboard } from '@act-one/core';
import { neutralRamp } from '@act-one/design';
import { getSystem } from '@act-one/creative';
import { renderFilm } from '@act-one/motion';
import { verifyMaster } from '@act-one/qa';
import {
  DEFAULT_LIBRARY,
  buildMix,
  directSound,
  masterLoudness,
  mixArgs,
  muxArgs,
  runFfmpeg,
} from '@act-one/sound';

const PRIMARY = '#5B8CFF';

export const brand: BrandSystem = BrandSystem.parse({
  id: 'brn_actone',
  organizationId: 'org_actone',
  name: 'Act One',
  primaryColor: PRIMARY,
  secondaryColor: neutralRamp(PRIMARY, 9, 0.05)[6] ?? PRIMARY,
  primaryCandidates: [PRIMARY],
  neutrals: neutralRamp(PRIMARY, 9, 0.05),
  canvasDark: '#07080d',
  canvasLight: '#ffffff',
  visualStyle: 'minimal',
  motionStyle: 'precise',
  cornerStyle: 'subtle',
  cornerRadiusPx: 10,
  tone: 'Confident, plain-spoken, technical.',
  confirmedByUser: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

type Beat = {
  seconds: number;
  lines: string[];
  recipe: Scene['motionRecipe']['name'];
  visual: Scene['visualType'];
  /** The field, when the beat's meaning is carried by many things moving. */
  field?: 'converge' | 'disperse' | 'settle' | 'stream';
  fieldCount?: number;
  camera: Partial<Scene['cameraRecipe']>;
  easing?: Scene['motionRecipe']['easing'];
  /**
   * Sonic marks, in seconds from the start of THIS beat.
   *
   * Three in sixty-three seconds, which is sparse on purpose. A mark is spent
   * where something arrives that the film has been building toward, and the
   * references sit between 0.06 and 0.45 impacts a second — the busiest of
   * them is still quiet next to what a default sound design would do.
   *
   * The director places the mark on the moment the LAST element lands, not on
   * the cut: the beat is the arrival, and a hit on the cut marks the edit
   * instead of the idea. The engine then pulls each sample earlier by its own
   * pre-roll, so the attack — rather than the first sample of the file —
   * falls on the frame asked for.
   */
  cues?: {
    at: number;
    type: Scene['soundCues'][number]['type'];
    intensity?: number;
    why: string;
  }[];
  /**
   * A real capture of the real interface, by key.
   *
   * The rule this film is held to is the product's own: if a real interface
   * exists, the film shows the real interface, and a generated or mocked screen
   * is never acceptable. These are captured from Act One's own running web app
   * at twice device scale, so a shot can push into one without softening.
   */
  asset?: 'home' | 'how' | 'work' | 'pricing';
};

/**
 * The camera vocabulary, calibrated rather than chosen.
 *
 * These amplitudes come from a parameter sweep against the references: a
 * 1.06 scale, which is what the engine used before, measures as a still
 * frame. A move is only a move once the picture changes by enough to be
 * felt, and these are the smallest values that do.
 */
const PUSH = { fromScale: 1.0, toScale: 1.16, fromX: -0.04, toX: 0.03 };
const PULL = { fromScale: 1.18, toScale: 1.0, fromX: 0.05, toX: -0.02 };
const DRIFT = { fromScale: 1.08, toScale: 1.14, fromX: -0.05, toX: 0.05 };
const HOLD_IN = { fromScale: 1.02, toScale: 1.09, fromX: 0.0, toX: 0.0 };

/**
 * The film.
 *
 * Runtime is chosen by the story rather than by a round number: the
 * references run 65 to 88 seconds because that is how long it takes to be
 * understood by somebody who has never heard of the product.
 */
/**
 * The film.
 *
 * Runtime is chosen by the story rather than by a round number: the
 * references run 65 to 88 seconds because that is how long it takes to be
 * understood by somebody who has never heard of the product.
 *
 * WHERE THE FIELDS ARE, AND WHY THEY ARE NOT ELSEWHERE. The first cut carried
 * a field on nine of these fifteen beats, and a critic watching the rendered
 * file said the shapes obscured the text and that the motion "reads as a
 * generic template" — disconnected from what the film was saying. It was
 * right. The fields had been placed to move a measurement.
 *
 * Three survive, and each one is the sentence rather than an accompaniment:
 *
 *   the six named stages of a production, gathering       -> converge, six
 *   one brief becoming three different directions         -> disperse, three
 *   six weeks collapsing into an afternoon                -> converge, twelve
 *
 * The counts are the nouns. Three directions is three objects, not twenty-one;
 * a field whose count does not match the thing it is naming is decoration
 * wearing a meaning. Every other beat rests, which is where comprehension
 * happens and which the references spend 10 to 48 per cent of their running
 * time doing.
 */
export const BEATS: Beat[] = [
  // --- PROBLEM ------------------------------------------------------------
  {
    seconds: 4.0,
    lines: ['A launch film', 'takes six weeks'],
    recipe: 'kinetic_headline',
    visual: 'kinetic_typography',
    camera: PUSH,
    easing: 'out_quint',
  },

  // The line names six things. Six things arrive and gather. The figure IS
  // the sentence, which is the only reason a field is allowed here.
  {
    seconds: 5.5,
    lines: ['A brief. A script. A board.', 'A shoot. An edit. A mix.'],
    recipe: 'word_reveal',
    visual: 'kinetic_typography',
    field: 'converge',
    fieldCount: 6,
    camera: DRIFT,
    easing: 'out_cubic',
  },

  {
    seconds: 3.5,
    lines: ['Six weeks', 'you do not have'],
    recipe: 'kinetic_headline',
    visual: 'kinetic_typography',
    camera: HOLD_IN,
    easing: 'out_quint',
  },

  // --- CAUSE --------------------------------------------------------------
  {
    seconds: 4.0,
    lines: ['Everything about your product', 'is already published'],
    recipe: 'word_reveal',
    visual: 'kinetic_typography',
    camera: PULL,
    easing: 'out_cubic',
  },
  {
    seconds: 3.5,
    lines: ['It has just never been', 'read by a director'],
    recipe: 'editorial_headline',
    visual: 'kinetic_typography',
    camera: PUSH,
    easing: 'in_out_cubic',
  },

  // --- THE HERO -----------------------------------------------------------
  /*
   * The one moment the film is built to arrive at.
   *
   * Everything before it is abstract — type on a field, fragments gathering.
   * This is where the film stops describing and shows the thing, and the
   * transformation is the point: the six fragments the production was broken
   * into at the top resolve, and what they resolve INTO is the real running
   * interface rather than another card. A critic found no hero and no
   * memorable image in the first three cuts. This beat exists to be both, and
   * the mark lands on the frame the last fragment settles.
   */
  {
    seconds: 5.0,
    lines: ['Act One'],
    recipe: 'kinetic_headline',
    visual: 'kinetic_typography',
    field: 'converge',
    fieldCount: 6,
    camera: PULL,
    easing: 'out_quint',
    cues: [
      {
        at: 1.85,
        type: 'impact',
        intensity: 0.8,
        why: 'The six fragments finish resolving onto the mark.',
      },
    ],
  },

  /*
   * And immediately, the product itself — the same push continuing.
   *
   * The camera does not cut and restart here: the previous beat ends pulling
   * back and this one pushes in, so the move carries across the boundary and
   * the interface arrives inside a gesture the film was already making. That
   * carry is the handover; without it this is two cards in a row.
   */
  {
    seconds: 5.0,
    lines: [],
    recipe: 'product_window',
    visual: 'product_ui',
    asset: 'home',
    camera: PUSH,
    easing: 'out_quint',
    /*
     * The second mark, on the arrival of the real thing.
     *
     * All four references place a hero at sixteen to twenty-nine seconds and
     * another near the end; the first four cuts of this film had only the
     * ending one, and a critic found no hero at all before it. This is the
     * moment the film stops describing a product and shows one, which is the
     * hero whether or not it is marked — marking it is what makes a viewer
     * look up.
     */
    cues: [
      {
        at: 0.15,
        type: 'whoosh',
        intensity: 0.55,
        why: 'The abstract resolves and the real interface arrives.',
      },
    ],
  },

  // --- DEMONSTRATION: the real product, doing the thing --------------------
  {
    seconds: 4.0,
    lines: ['It reads the product'],
    recipe: 'word_reveal',
    visual: 'kinetic_typography',
    camera: DRIFT,
    easing: 'out_cubic',
  },

  // A real page of the real product, moved through rather than held.
  {
    seconds: 5.0,
    lines: [],
    recipe: 'product_zoom',
    visual: 'screenshot_motion',
    asset: 'how',
    camera: PULL,
    easing: 'in_out_cubic',
  },

  {
    seconds: 4.5,
    lines: ['It develops three', 'genuinely different directions'],
    recipe: 'word_reveal',
    visual: 'kinetic_typography',
    field: 'disperse',
    fieldCount: 3,
    camera: PULL,
    easing: 'in_out_cubic',
  },

  {
    seconds: 5.0,
    lines: [],
    recipe: 'product_window',
    visual: 'product_ui',
    asset: 'work',
    camera: DRIFT,
    easing: 'out_cubic',
  },

  {
    seconds: 3.5,
    lines: ['Then it produces the one', 'you choose'],
    recipe: 'editorial_headline',
    visual: 'kinetic_typography',
    camera: PUSH,
    easing: 'in_out_cubic',
  },

  // --- PROOF --------------------------------------------------------------
  {
    seconds: 4.0,
    lines: ['Nothing is claimed', 'that you have not published'],
    recipe: 'word_reveal',
    visual: 'kinetic_typography',
    camera: HOLD_IN,
    easing: 'out_quint',
  },
  {
    seconds: 4.0,
    lines: [],
    recipe: 'product_zoom',
    visual: 'screenshot_motion',
    asset: 'pricing',
    camera: PUSH,
    easing: 'out_cubic',
  },

  // --- VALUE + ENDING -----------------------------------------------------
  // Twelve fragments collapse to one. The film's opening figure, answered.
  {
    seconds: 4.5,
    lines: ['Six weeks', 'becomes an afternoon'],
    recipe: 'kinetic_headline',
    visual: 'kinetic_typography',
    field: 'converge',
    fieldCount: 12,
    camera: PULL,
    easing: 'out_quint',
    cues: [
      {
        at: 2.2,
        type: 'sub_drop',
        intensity: 0.7,
        why: 'Twelve weeks of work collapsing into one afternoon.',
      },
    ],
  },

  {
    seconds: 4.0,
    lines: ['Act One'],
    recipe: 'logo_reveal',
    visual: 'logo_reveal',
    camera: HOLD_IN,
    easing: 'out_quint',
    cues: [
      {
        at: 0.35,
        type: 'logo_sting',
        intensity: 0.6,
        why: 'The mark, and the end of the sentence the film has been saying.',
      },
    ],
  },
];

export function buildStoryboard(): Storyboard {
  /*
   * Cue times are written per beat and stored against the film's clock.
   *
   * A director thinks "1.85 seconds into this beat", because that is where the
   * last fragment lands; the schema wants seconds from the first frame. Doing
   * the arithmetic here means a beat whose duration changes takes its marks
   * with it, rather than leaving them behind at a timecode that used to mean
   * something.
   */
  let elapsed = 0;
  const starts = BEATS.map((beat) => {
    const at = elapsed;
    elapsed += beat.seconds;
    return at;
  });

  return resequence({
    id: 'sbd_actone',
    projectId: 'prj_actone',
    conceptId: 'cpt_actone',
    treatmentId: 'trt_actone',
    version: 1,
    voiceStrategy: 'none',
    language: 'en',
    musicDirection:
      'One continuous cue that gathers rather than restarts; a single resolution on the mark.',
    heroShot: null,
    status: 'draft',
    parentStoryboardId: null,
    revisionReason: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    scenes: BEATS.map((beat, index) => ({
      id: `scn_actone_${index}`,
      storyboardId: 'sbd_actone',
      index,
      startTime: 0,
      duration: beat.seconds,
      purpose: beat.lines.join(' '),
      narration: '',
      onScreenText: beat.lines,
      visualType: beat.visual,
      assetRefs: beat.asset ? [`ast_${beat.asset}`] : [],
      momentIds: [],
      motionRecipe: {
        name: beat.recipe,
        easing: beat.easing ?? 'out_quint',
        delay: 0,
        // The stagger band measured across all four references.
        stagger: 0.07,
        intensity: 0.65,
        params: beat.field ? { field: beat.field, fieldCount: beat.fieldCount ?? 16 } : {},
      },
      cameraRecipe: {
        move: 'push_in',
        fromScale: 1,
        toScale: 1,
        fromX: 0,
        toX: 0,
        fromY: 0,
        toY: 0,
        motionBlur: 0.25,
        depthOfField: 0,
        easing: beat.easing ?? 'in_out_quart',
        ...beat.camera,
      },
      uiSequence: null,
      soundCues: (beat.cues ?? []).map((cue) => ({
        time: Number((starts[index]! + cue.at).toFixed(3)),
        type: cue.type,
        assetId: null,
        intensity: cue.intensity ?? 0.6,
        durationSeconds: null,
      })),
      voiceOver: false,
      generativeNeeds: [],
      threeDSceneId: null,
      status: 'draft',
      claimEvidenceIds: [],
      notes: '',
      estimatedCostUsd: 0,
    })) as Scene[],
  } as Storyboard);
}

const storyboard = buildStoryboard();
const total = storyboard.scenes.reduce((sum, scene) => sum + scene.duration, 0);
const out = process.env['ACT_ONE_FILM_OUT'] ?? path.resolve('.renders/act-one-original.mp4');
const quality = (process.env['ACT_ONE_FILM_QUALITY'] ?? 'preview') as 'preview' | 'hd' | 'uhd';
const STORAGE = process.env['ACT_ONE_STORAGE_DIR'] ?? path.resolve('.act-one-demo/storage');
console.log(`${storyboard.scenes.length} beats, ${total.toFixed(1)}s, ${quality}`);

const started = Date.now();

/*
 * Picture first, then the real sound chain.
 *
 * The first cut shipped with no audio stream at all, and the critic watching
 * it said so before it said anything else. This is the pipeline's own chain
 * rather than an approximation: the same Sound Director reading the same
 * creative system, the same mix graph with its sidechain, the same two-pass
 * loudness master, and the same playability gate every customer's master
 * passes.
 */
const silent = out.replace(/\.mp4$/, '.silent.mp4');
/*
 * The real captures, as file URLs the renderer's browser can open.
 *
 * Keyed by the same ids the beats reference, so a beat that asks for the
 * interface and finds nothing renders as its line of type instead of an empty
 * frame — and `undecodable` below reports any the browser refused, which is
 * how a shot that was meant to show the product but silently did not gets
 * caught before the film ships.
 */
/*
 * The real captures, over HTTP rather than as file URLs.
 *
 * `file://` is the obvious thing to try and it does not work: the renderer's
 * page is served from a bundle, and a browser will not let that page load a
 * local file. What it produces is not an error about permissions — it is a
 * `CancelledError` with a null frame, because the image never resolves and the
 * render is still waiting for it when the timeout fires. In the deployed
 * pipeline these are signed object-store URLs; here they are the same captures
 * served by the app they were taken from.
 */
const CAPTURE_BASE = process.env['ACT_ONE_CAPTURE_BASE'] ?? 'http://localhost:3000/capture';
const CAPTURES = path.resolve('apps/web/public/capture');
const assetUrls: Record<string, string> = Object.fromEntries(
  (['home', 'how', 'work', 'pricing'] as const)
    .filter((name) => existsSync(path.join(CAPTURES, `${name}.png`)))
    .map((name) => [`ast_${name}`, `${CAPTURE_BASE}/${name}.png`] as const),
);
const wanted = new Set(storyboard.scenes.flatMap((scene) => scene.assetRefs));
const absent = [...wanted].filter((id) => !assetUrls[id]);
if (absent.length > 0) {
  console.error(
    `Missing product captures: ${absent.join(', ')}. Run scripts/film/capture-product.mjs with the app running.`,
  );
  process.exit(1);
}

/*
 * The picture is kept when only the sound is being worked on.
 *
 * A 1080p pass over this film takes about three minutes, and the last four
 * changes were all to the mix. Re-rendering identical frames to hear a
 * different score is three minutes of nothing.
 */
const reuse = process.env['ACT_ONE_REUSE_PICTURE'] === '1' && existsSync(silent);
const result = reuse
  ? { width: 1920, height: 1080, durationSeconds: total, undecodable: [] as string[] }
  : await renderFilm({
      props: { storyboard, brand, assetUrls },
      aspect: '16:9',
      quality,
      outputPath: silent,
      concurrency: 3,
      onProgress: (p) => {
        if (p.renderedFrames % 240 === 0) process.stdout.write(`\r  ${p.renderedFrames} frames`);
      },
    });
console.log(
  `\n  ${reuse ? 'picture reused' : 'picture'} in ${((Date.now() - started) / 1000).toFixed(0)}s  ${result.width}x${result.height}`,
);
if (result.undecodable.length) console.log('  undecodable:', result.undecodable);

/*
 * The music has to move, because the film does.
 *
 * `cinematic_black` asks for sub-heavy and sparse, "nothing melodic enough to
 * hum", and the Sound Director correctly gave it a 72bpm tonal pad. The result
 * is technically exemplary — measured at -16.1 LUFS integrated with a -2.0
 * dBFS true peak and 5.9 LU of range — and a critic watching the film called
 * it "a minute of silent text", because a bed that never asserts itself is a
 * bed nobody hears.
 *
 * All four reference films use music the same way and it is the opposite of
 * this: every one was read as driving momentum and holding energy. This film
 * argues that six weeks becomes an afternoon; a score that refuses to move is
 * arguing against it.
 */
const design = directSound({
  storyboard,
  behaviour: getSystem('kinetic_product').sound,
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
  console.error(
    `No sound library to score with (${missing.length} missing). Run \`npm run sound-library\`.`,
  );
  process.exit(1);
}

const plan = buildMix({ design, resolvedPaths, durationSeconds: total });
const premaster = out.replace(/\.mp4$/, '.premix.wav');
const mixed = await runFfmpeg(mixArgs(plan, premaster), { timeoutMs: 5 * 60_000 });
if (!mixed.ok) throw new Error(`mix failed: ${mixed.stderr.slice(-400)}`);

const mastered = out.replace(/\.mp4$/, '.mix.wav');
/*
 * A lower ceiling than the default, because this film's bed is dense.
 *
 * The mastering chain limits true peak correctly and its default leaves half
 * a decibel inside EBU R 128 as headroom for the encoder. That is enough for
 * a sparse tonal pad and it is not enough here: with a 124bpm percussive
 * track the mastered WAV cleared its ceiling and the AAC in the delivered
 * file measured 0.0 dBTP — at the ceiling, where the references sit at -0.2
 * and -1.7. Inter-sample peaks rise on the way into AAC by more than the
 * default anticipates when the material is busy.
 *
 * Measured on the finished file rather than assumed, which is the only way
 * this was visible at all.
 */
await masterLoudness({
  source: premaster,
  target: mastered,
  lufs: design.targetLufs,
  truePeak: -2.5,
  outputArgs: ['-c:a', 'pcm_s24le'],
});

const muxedOk = await runFfmpeg(muxArgs(silent, mastered, out), { timeoutMs: 5 * 60_000 });
if (!muxedOk.ok) throw new Error(`mux failed: ${muxedOk.stderr.slice(-400)}`);

const playable = await verifyMaster(out, { width: result.width, height: result.height });
if (playable.issues.length > 0) {
  console.error('Would not play everywhere:');
  for (const issue of playable.issues) console.error('  ', issue);
}

await Promise.all([
  ...(process.env['ACT_ONE_KEEP_PICTURE'] === '1' ? [] : [rm(silent, { force: true })]),
  rm(premaster, { force: true }),
  rm(mastered, { force: true }),
]);
console.log(`done in ${((Date.now() - started) / 1000).toFixed(0)}s -> ${out}`);
console.log(
  `  music: ${design.music?.storageKey ?? 'none'}  cues: ${design.cues.length}  target ${design.targetLufs} LUFS`,
);
/*
 * The cue times, printed so the alignment check measures the film that exists.
 *
 * Hand-computed cue times went stale the moment a beat's duration changed, and
 * a sync check aimed at the wrong second reports "no audible attack" for a
 * mark that is perfectly placed. The storyboard knows where they are.
 */
const marks = storyboard.scenes
  .flatMap((scene) => scene.soundCues.map((cue) => cue.time))
  .sort((a, b) => a - b);
console.log(`  cue times: ${marks.map((t) => t.toFixed(2)).join(',')}`);
