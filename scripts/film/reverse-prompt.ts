/**
 * A reference film, transcribed back into the prompt that would rebuild it.
 *
 * WHY THIS IS NOT THE READING WE ALREADY HAVE. `analyseBenchmark` produces a
 * close reading: twenty-five domains of what a film DOES, in prose, which is
 * what retrieval needs to answer "what do excellent films do here". It is
 * descriptive by design, and description is not a specification. Asked to
 * reproduce target7's opening from its reading you would get the idea and none
 * of the numbers — and the gap between our film and these is made of numbers.
 *
 * So this asks the opposite question: not what did you see, but what would I
 * have to say to make it. Every answer is an instruction with a quantity
 * attached — seconds to two decimals, percentages of frame, hex, dB, BPM,
 * easing names, word rates — and adjectives that carry no measurement are
 * banned outright, because "premium motion" has never once told anybody what
 * to build.
 *
 * NATIVE, AND WITH SOUND. The film goes to the Files API and the model watches
 * and hears it. A reading taken from stills cannot describe motion, timing or
 * synchronisation, which between a good film and an excellent one is most of
 * the difference. Nothing here samples frames.
 *
 * TWO KINDS OF PASS, because one call cannot do both. The film pass asks for
 * the SYSTEM — the palette, the type scale, the grade, the sound design, the
 * rules the film keeps — which requires seeing all of it at once. The window
 * passes ask for EVENTS, second by second, over twenty seconds at a time,
 * because a whole film's worth of half-second entries does not fit in one
 * answer and a truncated JSON is a wasted reading. The Files API keeps one
 * upload for all of them, so a film costs one upload however many windows it
 * is cut into.
 *
 *   ACT_ONE_MANAGED_CREDENTIALS=all npm run reverse -- target7
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GeminiVideoAnalyst } from '@act-one/providers';
import { readModelJson } from '@act-one/qa';

const REF = path.resolve('.renders/ref');
const DURABLE = path.resolve('memory/reference');
const RAW = path.resolve('.renders/reverse');
mkdirSync(DURABLE, { recursive: true });
mkdirSync(RAW, { recursive: true });

const id = process.argv.slice(2).find((a) => !a.startsWith('-'));
if (!id) {
  console.error('Give me a film id from the corpus, e.g. target7.');
  process.exit(1);
}
const film = path.join(REF, `${id}.mp4`);
if (!existsSync(film)) {
  console.error(`No ${id}.mp4 in ${REF}.`);
  process.exit(1);
}

const analyst = new GeminiVideoAnalyst({});
if (!analyst.isConfigured()) {
  console.error('No video analyst is configured, so nothing can watch this.');
  process.exit(1);
}
const context = { organizationId: 'org_platform' } as never;

/** How long the film runs, from the file rather than from the model. */
async function durationOf(file: string): Promise<number> {
  const { execFileSync } = await import('node:child_process');
  const ffmpeg = (await import('ffmpeg-static')).default as unknown as string;
  /*
   * `ffmpeg -i` with no output file EXITS NON-ZERO by design — it prints what
   * it found and then says "At least one output file must be specified". The
   * probe therefore always throws, and the answer is on the exception.
   */
  let printed = '';
  try {
    printed = execFileSync(ffmpeg, ['-hide_banner', '-i', file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    } as never).toString();
  } catch (error) {
    printed = String((error as { stderr?: Buffer | string }).stderr ?? '');
  }
  const line = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(printed);
  if (!line) return 0;
  return Number(line[1]) * 3600 + Number(line[2]) * 60 + Number(line[3]);
}

/*
 * Said once, at the top of every pass.
 *
 * The banned list is not style policing. Every one of those words has appeared
 * in a reading of these films and not one of them has ever told this project
 * what to build: "premium motion" survived four months as a goal and produced
 * nothing, and the moment the same question was asked as "what easing, over
 * how many seconds, on which property" it produced a fix the same afternoon.
 * A word that cannot be checked against the film is a word that cannot be
 * wrong, and an instruction that cannot be wrong is not an instruction.
 */
const RULES = [
  'You are shown ONE film, made by a strong creative studio. Watch it AND listen to it.',
  '',
  'Your job is REVERSE PROMPTING: write the specification that would let a competent',
  'motion studio rebuild this film without ever seeing it. Not a description of what you',
  'saw — an instruction for what to make.',
  '',
  'RULES, all of them enforced:',
  '1. EVERY claim carries a number and a unit. Seconds to two decimals. Percentages of',
  '   frame width or height. Hex for colour. dB or LUFS for level. BPM for tempo. Degrees',
  '   for rotation. Named easing curves. Words per minute for speech.',
  '2. If you cannot measure something, say so in `confidence` as "inferred" and give your',
  '   best number anyway. An honest estimate is usable; a missing field is not.',
  '3. Write instructions in the imperative: "hold the word at 62% of frame height for',
  '   0.80s, then scale to 140% over 0.45s on out_expo".',
  '4. Cover every domain even when the answer is "none": a film that uses no 3D is telling',
  '   you something, and a blank field is not.',
  '',
  'BANNED WORDS, in every field: premium, polished, professional, elevated, sleek, modern,',
  'clean, dynamic, engaging, beautiful, stunning, cinematic, high-quality, sophisticated,',
  'striking, compelling. Replace each with the measurement that made you want to write it.',
].join('\n');

/*
 * FIVE SMALL QUESTIONS RATHER THAN ONE LARGE ONE, AND NOT FOR TIDINESS.
 *
 * The first version asked for the whole system in one answer and got HTTP 502
 * from the egress gateway, four attempts running. It is not the vendor and it
 * is not the film: a thinking model spends its budget before it emits a single
 * byte, this deployment's proxy cuts about ninety seconds of silence, and it
 * reports the cut as 502 rather than as a timeout. Measured: the same model,
 * the same film, asked for ONE hex value with the ceiling left at 65,536
 * tokens, took sixty seconds to answer. The ceiling is a thinking budget, and
 * a large schema spends all of it in silence.
 *
 * So each pass asks for one part of the system with a ceiling sized to it. The
 * answers start arriving in seconds, and the questions are better for being
 * narrow — "what is the type doing" gets a more careful answer than "describe
 * everything" ever did.
 */
type Pass = { key: string; title: string; maxOutputTokens: number; schema: string[] };

const SYSTEM_PASSES: Pass[] = [
  {
    key: 'look',
    title: 'the colour and the grade',
    maxOutputTokens: 8192,
    schema: [
      '{',
      ' "identity":{"durationSeconds":0,"aspectRatio":"","framesPerSecond":0,"subject":"",',
      '             "language":"","proposition":"<what it claims, in one sentence>"},',
      ' "palette":[{"hex":"#RRGGBB","role":"ground|type|accent|support","firstAtSeconds":0,',
      '             "sharePercentOfRunningTime":0,"whatItIsFor":""}],',
      ' "grade":{"blackPointHex":"","whitePointHex":"","contrastRatioTypeToGround":0,',
      '          "saturationNote":"","grainPercent":0,"vignettePercent":0,"bloomPercent":0,',
      '          "isTheGroundFlatOrLit":"flat|lit","lightSourceDescription":""}',
      '}',
    ],
  },
  {
    key: 'type',
    title: 'the typography and the layout',
    maxOutputTokens: 8192,
    schema: [
      '{',
      ' "typography":{"families":[{"classification":"grotesque|neo-grotesque|geometric|serif|mono",',
      '                            "weights":[0],"usedFor":""}],',
      '               "scale":[{"role":"display|statement|body|caption","sizePercentOfFrameHeight":0,',
      '                         "trackingEm":0,"lineHeight":0,"case":"","maxLines":0,',
      '                         "exampleWordsAtSeconds":0}],',
      '               "setting":{"alignment":"","maxMeasurePercentOfFrameWidth":0,"opticalNotes":""}},',
      ' "layout":{"gridColumns":0,"marginPercentOfFrameWidth":0,',
      '           "anchorsUsed":[{"xPercent":0,"yPercent":0,"whatSitsThere":"","howOftenUsed":0}]},',
      ' "typeInMotion":{"entrance":"","entranceDurationSeconds":0,"entranceEasing":"",',
      '                 "staggerSecondsBetweenUnits":0,"staggerUnit":"letter|word|line",',
      '                 "exit":"","exitDurationSeconds":0,"doesTypeEverSitStill":false}',
      '}',
    ],
  },
  {
    key: 'move',
    title: 'the camera, the motion, the transitions and any 3D',
    maxOutputTokens: 12288,
    schema: [
      '{',
      ' "camera":{"moves":[{"atSeconds":0,"kind":"static|dolly|pan|tilt|zoom|handheld|orbit",',
      '                     "amplitudePercent":0,"durationSeconds":0,"easing":"",',
      '                     "whatMotivatesIt":""}],',
      '           "lensFeelMm":0,"depthOfFieldNote":"","shakeAmplitudePercent":0,',
      '           "isAnythingEverCompletelyStill":false},',
      ' "motion":{"easingsUsed":[{"name":"","appliedTo":"","typicalDurationSeconds":0}],',
      '           "somethingAlwaysMoving":true,"idleMotionDescription":"",',
      '           "velocityProfile":"<how speed is distributed across a move>"},',
      ' "transitions":[{"atSeconds":0,"kind":"","durationSeconds":0,',
      '                 "causedByWhatIsAlreadyOnScreen":"","easing":""}],',
      ' "threeD":{"present":false,"whatIsDimensional":"","lightingSetup":"","materials":"",',
      '           "cameraPerspectiveMm":0,"atSecondsExamples":[0],"whyItEarnsItsPlace":""},',
      ' "ui":{"present":false,"howProductIsShown":"","cropOrFraming":"","annotationStyle":""}',
      '}',
    ],
  },
  {
    key: 'sound',
    title: 'the sound, the voice and the cutting',
    maxOutputTokens: 12288,
    schema: [
      '{',
      ' "editing":{"cutCount":0,"averageShotSeconds":0,"shortestShotSeconds":0,',
      '            "longestShotSeconds":0,"rhythmRule":"","cutsOnTheBeat":false},',
      ' "sound":{"musicBpm":0,"musicKey":"","musicStructure":[{"atSeconds":0,"section":""}],',
      '          "bedLufs":0,"masterLufs":0,"sidechainedToVoice":false,',
      '          "sfxFamilies":[{"family":"","countInFilm":0,"typicalLevelDbBelowVoice":0,',
      '                          "atSecondsExamples":[0]}]},',
      ' "voice":{"present":false,"register":"","wordsPerMinute":0,"medianPauseSeconds":0,',
      '          "leadOverBedLu":0,"toneChanges":[{"atSeconds":0,"from":"","to":"","whyThere":""}]},',
      ' "sync":{"rule":"<what sound is allowed to land on>","toleranceSeconds":0,',
      '         "examplesAtSeconds":[0],"whatHappensOnTheLoudestHit":""}',
      '}',
    ],
  },
  {
    key: 'build',
    title: 'the structure and the recipe',
    maxOutputTokens: 16384,
    schema: [
      '{',
      ' "structure":{"beats":[{"atSeconds":0,"untilSeconds":0,"job":"","whatChanges":""}],',
      '              "turnAtSeconds":0,"callToActionAtSeconds":0},',
      ' "rulesItNeverBreaks":["<a constraint the film keeps every single time>"],',
      ' "recipe":["<ordered imperative steps to rebuild the whole film, each quantified>"],',
      ' "whatWouldBeHardestToCopy":["<the thing a weaker studio would get wrong, and why>"]',
      '}',
    ],
  },
];

const systemPass = (pass: Pass): string =>
  [
    RULES,
    '',
    `THIS PASS: ${pass.title}. Watch and listen to the whole film, then answer about this`,
    'alone. Do not describe anything outside it — other passes cover the rest.',
    '',
    'Return ONLY JSON:',
    ...pass.schema,
  ].join('\n');

/*
 * The window is cut in two for the same reason the system pass is cut in five.
 * `events` and a half-second sampling of the same twenty seconds is one answer
 * that spends its whole budget thinking; asked separately, both arrive.
 */
const windowEvents = (from: number, to: number, system: unknown): string =>
  [
    RULES,
    '',
    `THIS PASS: every discrete thing that HAPPENS between ${from.toFixed(2)}s and ${to.toFixed(2)}s.`,
    'Times are absolute seconds in the whole film, not offsets into the window.',
    '',
    'You already described this film\'s system. Use it, do not repeat it:',
    JSON.stringify(system).slice(0, 5000),
    '',
    'A cut, a word arriving, a colour changing, a hit landing, a camera starting or stopping,',
    'a shape growing — however small. If two things happen at the same second, list both.',
    '',
    'Return ONLY JSON:',
    '{"events":[{"atSeconds":0,"untilSeconds":0,',
    '            "domain":"picture|type|motion|camera|transition|sound|voice|sfx|threeD|ui",',
    '            "instruction":"<imperative and quantified>",',
    '            "quantities":{"<name>":"<value with unit>"},',
    '            "whyItReads":"<what a viewer gets from it>",',
    '            "confidence":"observed|inferred"}]}',
  ].join('\n');

const windowSeconds = (from: number, to: number): string =>
  [
    RULES,
    '',
    `THIS PASS: sample ${from.toFixed(2)}s to ${to.toFixed(2)}s every 0.5s, whether or not anything`,
    'happened. A stretch where nothing moves must be recorded as a stretch where nothing moves,',
    'not left out. Times are absolute seconds in the whole film.',
    '',
    'Return ONLY JSON:',
    '{"seconds":[{"at":0,"onScreen":"","typeOnScreen":"","dominantHex":"#RRGGBB",',
    '             "motionNow":"","audioNow":"","spokenNow":""}]}',
  ].join('\n');

// ---------------------------------------------------------------------------

const durationSeconds = await durationOf(film);
console.log(`=== ${id}  ${durationSeconds.toFixed(2)}s ===`);

console.log('  uploading once, for every pass');
const put = await analyst.putFilm(film, context).catch(async (error: Error) => {
  console.log(`  ${error.message.slice(0, 90)} — retrying once.`);
  return analyst.putFilm(film, context);
});

/** Twenty seconds: long enough to hold a whole move, short enough to answer whole. */
const WINDOW = 20;
const windows: { from: number; to: number }[] = [];
for (let at = 0; at < durationSeconds; at += WINDOW) {
  windows.push({ from: at, to: Math.min(durationSeconds, at + WINDOW) });
}

let tokens = 0;
const startedAt = Date.now();

/*
 * One pass, with its raw answer kept before anything tries to parse it.
 *
 * A reading this expensive that fails on a stray brace and leaves nothing
 * behind is a reading paid for twice. The file on disk is also the only way to
 * see WHAT the model said when the JSON is wrong.
 */
async function run(name: string, prompt: string, maxOutputTokens: number, window?: { from: number; to: number }) {
  const raw = path.join(RAW, `${id}.${name}.txt`);
  /*
   * A pass already paid for is never paid for again.
   *
   * Thirteen passes over one film, any of which can be cut by the gateway,
   * means a naive script re-asks everything that already worked every time it
   * is restarted. The raw answers are the cache: delete the file to redo a
   * pass, delete the folder to redo the film. This is also why the raw text is
   * written before anything parses it — a stray brace should cost a repair,
   * not a re-reading.
   */
  if (existsSync(raw) && !process.argv.includes('--fresh')) {
    const kept = readFileSync(raw, 'utf8');
    console.log(`    ${name.padEnd(18)}   —  kept from an earlier run`);
    return readModelJson(kept) as Record<string, unknown>;
  }

  /*
   * Retried here as well as inside the provider, because the two retries are
   * for different failures. `httpStream` retries only BEFORE the first byte,
   * which is right — after it, a retry throws away an answer we are paying
   * for. But the gateway also cuts a stream that has already started writing,
   * and that arrives as a 502 the provider will not retry. Measured on this
   * film: the same pass failed once and succeeded on the next attempt without
   * anything else changing.
   */
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const at = Date.now();
    try {
      const answer = await analyst.ask(
        {
          prompt,
          films: [
            window
              ? { uri: put.uri, mimeType: put.mimeType, window: { startSeconds: window.from, endSeconds: window.to } }
              : { uri: put.uri, mimeType: put.mimeType },
          ],
          depth: 'deep',
          maxOutputTokens,
        },
        context,
      );
      tokens += answer.tokens;
      writeFileSync(raw, answer.text);
      const parsed = readModelJson(answer.text) as Record<string, unknown>;
      console.log(
        `    ${name.padEnd(18)} ${String(Math.round((Date.now() - at) / 1000)).padStart(3)}s  ` +
          `${(answer.tokens / 1000).toFixed(1)}k tokens` +
          (answer.finishReason && answer.finishReason !== 'STOP' ? `  (${answer.finishReason})` : '') +
          (attempt > 1 ? `  (attempt ${attempt})` : ''),
      );
      return parsed;
    } catch (error) {
      lastError = error as Error;
      console.log(
        `    ${name.padEnd(18)} ${String(Math.round((Date.now() - at) / 1000)).padStart(3)}s  ` +
          `${lastError.message.slice(0, 60)} — attempt ${attempt} of 3`,
      );
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 8000));
    }
  }
  throw lastError ?? new Error(`${name} failed without an error.`);
}

console.log(`  the system, in ${SYSTEM_PASSES.length} passes`);
const system: Record<string, unknown> = {};
for (const pass of SYSTEM_PASSES) {
  const part = await run(pass.key, systemPass(pass), pass.maxOutputTokens);
  Object.assign(system, part);
}

console.log(`  the timeline, in ${windows.length} window(s)`);
const events: unknown[] = [];
const seconds: unknown[] = [];
for (const w of windows) {
  const e = (await run(`events-${w.from}`, windowEvents(w.from, w.to, system), 16_384, w)) as {
    events?: unknown[];
  };
  const t = (await run(`seconds-${w.from}`, windowSeconds(w.from, w.to), 12_288, w)) as {
    seconds?: unknown[];
  };
  events.push(...(e.events ?? []));
  seconds.push(...(t.seconds ?? []));
}

const at = (x: unknown, key: string) => Number((x as Record<string, number>)[key] ?? 0);
const document = {
  source: { reference: film, id, durationSeconds },
  model: 'gemini-3.1-pro-preview',
  analysedAt: new Date().toISOString(),
  windowSeconds: WINDOW,
  system,
  events: events.sort((a, b) => at(a, 'atSeconds') - at(b, 'atSeconds')),
  seconds: seconds.sort((a, b) => at(a, 'at') - at(b, 'at')),
};

writeFileSync(path.join(DURABLE, `${id}.prompt.json`), JSON.stringify(document, null, 2));

/*
 * The JSON is what retrieval reads; the prose is what a person reads.
 *
 * Both are the same document. Writing only the JSON would leave the actual
 * deliverable — a brief somebody could hand to a studio, or paste into a
 * system, and get this film back — locked inside a structure nobody reads
 * aloud. Writing only the prose would leave nothing queryable.
 */
writeFileSync(path.join(DURABLE, `${id}.prompt.md`), asBrief(document));

console.log(
  `\n=== ${id}: ${Object.keys(system).length} system sections, ${events.length} events, ` +
    `${seconds.length} half-second samples ===`,
);
console.log(
  `  ${(tokens / 1000).toFixed(0)}k tokens, ${((Date.now() - startedAt) / 1000).toFixed(0)}s -> memory/reference/${id}.prompt.json`,
);

/** The document as a brief: the same facts, in the order somebody builds in. */
function asBrief(doc: {
  source: { id: string; durationSeconds: number };
  model: string;
  system: Record<string, unknown>;
  events: unknown[];
  seconds: unknown[];
}): string {
  const out: string[] = [];
  const sys = doc.system as Record<string, any>;
  const num = (v: unknown, unit = '') => (v === undefined || v === null || v === '' ? '—' : `${v}${unit}`);

  out.push(`# ${doc.source.id} — the prompt that would rebuild this film`);
  out.push('');
  out.push(
    `${doc.source.durationSeconds.toFixed(2)}s · ${num(sys['identity']?.aspectRatio)} · ` +
      `${num(sys['identity']?.framesPerSecond, 'fps')} · read and heard by ${doc.model}`,
  );
  out.push('');
  out.push(`**Subject.** ${num(sys['identity']?.subject)}`);
  out.push(`**Claim.** ${num(sys['identity']?.proposition)}`);
  out.push('');

  out.push('## The ground and the colour');
  out.push('');
  for (const c of sys['palette'] ?? []) {
    out.push(
      `- \`${c.hex}\` — ${c.role}, from ${num(c.firstAtSeconds, 's')}, ` +
        `${num(c.sharePercentOfRunningTime, '% of the running time')}. ${c.whatItIsFor ?? ''}`,
    );
  }
  const g = sys['grade'] ?? {};
  out.push('');
  out.push(
    `Black point \`${num(g.blackPointHex)}\`, white point \`${num(g.whitePointHex)}\`, ` +
      `type against ground at ${num(g.contrastRatioTypeToGround, ':1')}. ` +
      `Grain ${num(g.grainPercent, '%')}, vignette ${num(g.vignettePercent, '%')}, bloom ${num(g.bloomPercent, '%')}.`,
  );
  if (g.isTheGroundFlatOrLit) out.push(`The ground is **${g.isTheGroundFlatOrLit}**. ${g.lightSourceDescription ?? ''}`);
  if (g.saturationNote) out.push(g.saturationNote);
  out.push('');

  out.push('## The type');
  out.push('');
  for (const f of sys['typography']?.families ?? []) {
    out.push(`- ${f.classification}, weights ${(f.weights ?? []).join('/')} — ${f.usedFor ?? ''}`);
  }
  out.push('');
  for (const step of sys['typography']?.scale ?? []) {
    out.push(
      `- **${step.role}** — ${num(step.sizePercentOfFrameHeight, '% of frame height')}, ` +
        `tracking ${num(step.trackingEm, 'em')}, line height ${num(step.lineHeight)}, ` +
        `${num(step.case)}, max ${num(step.maxLines)} lines` +
        (step.exampleWordsAtSeconds ? ` (see ${step.exampleWordsAtSeconds}s)` : ''),
    );
  }
  const tm = sys['typeInMotion'] ?? {};
  if (Object.keys(tm).length) {
    out.push('');
    out.push(
      `Type enters by ${num(tm.entrance)} over ${num(tm.entranceDurationSeconds, 's')} on ` +
        `\`${num(tm.entranceEasing)}\`, staggered ${num(tm.staggerSecondsBetweenUnits, 's')} per ` +
        `${num(tm.staggerUnit)}; it leaves by ${num(tm.exit)} over ${num(tm.exitDurationSeconds, 's')}. ` +
        `Does it ever sit still: **${tm.doesTypeEverSitStill ? 'yes' : 'no'}**.`,
    );
  }
  out.push('');

  out.push('## The camera and the motion');
  out.push('');
  for (const m of sys['camera']?.moves ?? []) {
    out.push(
      `- ${num(m.atSeconds, 's')} — ${m.kind} ${num(m.amplitudePercent, '%')} over ` +
        `${num(m.durationSeconds, 's')} on \`${num(m.easing)}\`` +
        (m.whatMotivatesIt && m.whatMotivatesIt !== 'none' ? `, because ${m.whatMotivatesIt}` : ''),
    );
  }
  const mo = sys['motion'] ?? {};
  out.push('');
  out.push(`Something is always moving: **${mo.somethingAlwaysMoving ? 'yes' : 'no'}**. ${mo.idleMotionDescription ?? ''}`);
  for (const e of mo.easingsUsed ?? []) {
    out.push(`- \`${e.name}\` on ${e.appliedTo}, typically ${num(e.typicalDurationSeconds, 's')}`);
  }
  out.push('');

  if ((sys['transitions'] ?? []).length) {
    out.push('## The transitions');
    out.push('');
    for (const t of sys['transitions']) {
      out.push(
        `- ${num(t.atSeconds, 's')} — ${t.kind} over ${num(t.durationSeconds, 's')} on \`${num(t.easing)}\`, ` +
          `caused by ${t.causedByWhatIsAlreadyOnScreen ?? '—'}`,
      );
    }
    out.push('');
  }

  const td = sys['threeD'] ?? {};
  out.push('## Dimension');
  out.push('');
  out.push(
    td.present
      ? `**Yes.** ${td.whatIsDimensional ?? ''} Lit by ${td.lightingSetup ?? '—'}; materials ${td.materials ?? '—'}; ` +
          `perspective ${num(td.cameraPerspectiveMm, 'mm')}. ${td.whyItEarnsItsPlace ?? ''}`
      : '**No 3D.** The film is flat, and that is a decision it keeps.',
  );
  out.push('');

  const ed = sys['editing'] ?? {};
  const sd = sys['sound'] ?? {};
  const vo = sys['voice'] ?? {};
  const sy = sys['sync'] ?? {};
  out.push('## The cut and the sound');
  out.push('');
  out.push(
    `${num(ed.cutCount)} cuts, average shot ${num(ed.averageShotSeconds, 's')} ` +
      `(${num(ed.shortestShotSeconds, 's')}–${num(ed.longestShotSeconds, 's')}). ` +
      `Cuts on the beat: **${ed.cutsOnTheBeat ? 'yes' : 'no'}**. ${ed.rhythmRule ?? ''}`,
  );
  out.push('');
  out.push(
    `Music at ${num(sd.musicBpm, ' BPM')}${sd.musicKey ? ` in ${sd.musicKey}` : ''}, ` +
      `bed ${num(sd.bedLufs, ' LUFS')}, master ${num(sd.masterLufs, ' LUFS')}, ` +
      `sidechained to the voice: **${sd.sidechainedToVoice ? 'yes' : 'no'}**.`,
  );
  for (const s2 of sd.musicStructure ?? []) out.push(`- ${num(s2.atSeconds, 's')} — ${s2.section}`);
  for (const f of sd.sfxFamilies ?? []) {
    out.push(`- ${f.family} × ${num(f.countInFilm)}, about ${num(f.typicalLevelDbBelowVoice, ' dB')} below the voice`);
  }
  out.push('');
  if (vo.present) {
    out.push(
      `Voice: ${num(vo.register)}, ${num(vo.wordsPerMinute, ' wpm')}, median pause ` +
        `${num(vo.medianPauseSeconds, 's')}, leading the bed by ${num(vo.leadOverBedLu, ' LU')}.`,
    );
    for (const t of vo.toneChanges ?? []) {
      out.push(`- ${num(t.atSeconds, 's')} — ${t.from} → ${t.to}${t.whyThere ? `, ${t.whyThere}` : ''}`);
    }
  } else {
    out.push('**No narration.** Everything is carried by type, picture and score.');
  }
  out.push('');
  out.push(`**Sync rule.** ${num(sy.rule)} Tolerance ${num(sy.toleranceSeconds, 's')}. ${sy.whatHappensOnTheLoudestHit ?? ''}`);
  out.push('');

  out.push('## What it never does');
  out.push('');
  for (const r of sys['rulesItNeverBreaks'] ?? []) out.push(`- ${r}`);
  out.push('');
  if ((sys['whatWouldBeHardestToCopy'] ?? []).length) {
    out.push('## What a weaker studio would get wrong');
    out.push('');
    for (const r of sys['whatWouldBeHardestToCopy']) out.push(`- ${r}`);
    out.push('');
  }

  out.push('## The recipe');
  out.push('');
  (sys['recipe'] ?? []).forEach((step: string, i: number) => out.push(`${i + 1}. ${step}`));
  out.push('');

  out.push('## The timeline');
  out.push('');
  for (const e of doc.events as any[]) {
    const q = Object.entries(e.quantities ?? {})
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    out.push(
      `- **${Number(e.atSeconds ?? 0).toFixed(2)}s–${Number(e.untilSeconds ?? e.atSeconds ?? 0).toFixed(2)}s** ` +
        `· ${e.domain} · ${e.instruction}` +
        (q ? `  \n  *${q}*` : '') +
        (e.whyItReads ? `  \n  ${e.whyItReads}` : '') +
        (e.confidence === 'inferred' ? '  *(inferred)*' : ''),
    );
  }
  out.push('');

  if ((doc.seconds as any[]).length) {
    out.push('## Every half second');
    out.push('');
    out.push('| at | on screen | type | hex | motion | audio | spoken |');
    out.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const s3 of doc.seconds as any[]) {
      const cell = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|') || '—';
      out.push(
        `| ${Number(s3.at ?? 0).toFixed(2)}s | ${cell(s3.onScreen)} | ${cell(s3.typeOnScreen)} | ` +
          `${cell(s3.dominantHex)} | ${cell(s3.motionNow)} | ${cell(s3.audioNow)} | ${cell(s3.spokenNow)} |`,
      );
    }
    out.push('');
  }

  return out.join('\n');
}
