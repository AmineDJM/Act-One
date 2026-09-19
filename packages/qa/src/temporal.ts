import {
  CAPTION_LINGER_CEILING,
  DEAD_AIR_CEILING,
  HELD_FRAME_CEILING,
  LEVEL_JUMP_CEILING_LU,
  SPEECH_OVERRUN_TOLERANCE,
  TAIL_FADE_SECONDS,
  TAIL_SILENCE_FLOOR_DB,
  TEMPORAL_STANDARDS,
  captionSyncTolerance,
  cite,
  newId,
  readingSecondsFor,
  type CaptionCue,
  type FilmCut,
  type QaFinding,
  type Scene,
} from '@act-one/core';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { runFfmpeg } from '@act-one/sound';

/**
 * Temporal QA: the defects only a clock can find.
 *
 * Everything else in this package decides from a plan or a frame. These need
 * the finished file, and they are the ones a demanding viewer notices without
 * being able to name — a caption a beat behind the word, a shot that stopped
 * moving, music that stops rather than ends, a line that finishes over the
 * next image.
 *
 * Two halves, deliberately separated. The arithmetic is pure and takes what
 * was measured; the measuring runs FFmpeg. That way the thresholds are
 * testable without a render, and a filter that changes its output format
 * breaks one parser rather than every check.
 */

/** A stretch of the film where nothing moved. */
export type Freeze = { start: number; end: number };

/** A stretch where nothing could be heard. */
export type Silence = { start: number; end: number };

/** Short-term loudness, one reading per window. */
export type LoudnessWindow = { at: number; lufs: number };

/** Where a line was actually spoken, as opposed to where it was planned. */
export type SpokenLine = {
  sceneId: string | null;
  /** When the words begin in the film, silence at the head already removed. */
  startsAt: number;
  endsAt: number;
  text: string;
};

/** EBU Tech 3341: short-term loudness is defined over three seconds. */
const SHORT_TERM_WINDOW_SECONDS = 3;

function finding(input: Omit<QaFinding, 'id' | 'detectedBy'>): QaFinding {
  return { id: newId('evt'), detectedBy: 'temporal', ...input };
}

/**
 * Captions against the speech they caption.
 *
 * The published tolerance is in frames, and early is not the same as late: a
 * caption that arrives before the line gives the sentence away, so it is held
 * to three frames, while one that arrives after has until half a second.
 */
export function captionSyncIssues(params: {
  cues: readonly CaptionCue[];
  spoken: readonly SpokenLine[];
  fps: number;
}): QaFinding[] {
  const issues: QaFinding[] = [];
  const tolerance = captionSyncTolerance(params.fps);
  const frame = params.fps > 0 ? 1 / params.fps : 0.04;

  for (const line of params.spoken) {
    // The cue that carries this line: the one whose window overlaps it most.
    const cue = bestOverlap(params.cues, line);
    if (!cue) continue;

    const onset = cue.start - line.startsAt;
    if (onset < -tolerance.early) {
      issues.push(
        finding({
          check: 'caption_onset',
          severity: 'soft_fail',
          layer: 'cross_modal',
          sceneId: line.sceneId,
          timecodeStart: round3(cue.start),
          timecodeEnd: round3(line.startsAt),
          frameStart: toFrame(cue.start, params.fps),
          frameEnd: toFrame(line.startsAt, params.fps),
          confidence: 0.95,
          repair: 'retime_captions',
          message:
            `A caption appears ${Math.abs(onset * 1000).toFixed(0)}ms before the line is spoken ` +
            `(${describeFrames(Math.abs(onset), frame)}), at ${cue.start.toFixed(2)}s.`,
          because: cite(TEMPORAL_STANDARDS.captionSync),
        }),
      );
    } else if (onset > tolerance.late) {
      issues.push(
        finding({
          check: 'caption_onset',
          severity: 'soft_fail',
          layer: 'cross_modal',
          sceneId: line.sceneId,
          timecodeStart: round3(line.startsAt),
          timecodeEnd: round3(cue.start),
          frameStart: toFrame(line.startsAt, params.fps),
          frameEnd: toFrame(cue.start, params.fps),
          confidence: 0.95,
          repair: 'retime_captions',
          message:
            `A caption lands ${(onset * 1000).toFixed(0)}ms after the line starts ` +
            `(${describeFrames(onset, frame)}), at ${cue.start.toFixed(2)}s.`,
          because: cite(TEMPORAL_STANDARDS.captionSync),
        }),
      );
    }

    const linger = cue.end - line.endsAt;
    if (linger > CAPTION_LINGER_CEILING) {
      issues.push(
        finding({
          check: 'caption_offset',
          severity: 'warning',
          layer: 'cross_modal',
          sceneId: line.sceneId,
          timecodeStart: round3(line.endsAt),
          timecodeEnd: round3(cue.end),
          confidence: 0.9,
          repair: 'retime_captions',
          message: `A caption stays ${linger.toFixed(2)}s after its line ends, at ${line.endsAt.toFixed(2)}s.`,
          because: cite(TEMPORAL_STANDARDS.captionLinger),
        }),
      );
    } else if (linger < -frame) {
      issues.push(
        finding({
          check: 'caption_offset',
          severity: 'soft_fail',
          layer: 'cross_modal',
          sceneId: line.sceneId,
          timecodeStart: round3(cue.end),
          timecodeEnd: round3(line.endsAt),
          confidence: 0.95,
          repair: 'retime_captions',
          message:
            `A caption leaves ${Math.abs(linger).toFixed(2)}s before its line finishes, at ` +
            `${cue.end.toFixed(2)}s — the end of the sentence is never read.`,
          because: cite(TEMPORAL_STANDARDS.captionLinger),
        }),
      );
    }
  }

  return [...issues, ...captionOverlapIssues(params.cues)];
}

/** Two cues in the same moment. Which one the player draws is its choice. */
export function captionOverlapIssues(cues: readonly CaptionCue[]): QaFinding[] {
  const ordered = [...cues].sort((left, right) => left.start - right.start);
  const issues: QaFinding[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (current.start < previous.end) {
      issues.push(
        finding({
          check: 'caption_overlap',
          severity: 'hard_fail',
          layer: 'cross_modal',
          timecodeStart: round3(current.start),
          timecodeEnd: round3(previous.end),
          confidence: 1,
          repair: 'retime_captions',
          message:
            `Two captions overlap by ${((previous.end - current.start) * 1000).toFixed(0)}ms at ` +
            `${current.start.toFixed(2)}s.`,
          because: cite(TEMPORAL_STANDARDS.captionOverlap),
        }),
      );
    }
  }
  return issues;
}

/**
 * A line that finishes over the next image.
 *
 * The most common reason an assembled film feels assembled, and one of the
 * few defects here with an obvious repair: give the shot the time its line
 * needs rather than cutting away mid-thought.
 */
export function speechDriftIssues(params: {
  spoken: readonly SpokenLine[];
  scenes: readonly Scene[];
}): QaFinding[] {
  const byId = new Map(params.scenes.map((scene) => [scene.id, scene]));
  const issues: QaFinding[] = [];

  for (const line of params.spoken) {
    const scene = line.sceneId ? byId.get(line.sceneId) : undefined;
    if (!scene) continue;
    const sceneEnd = scene.startTime + scene.duration;
    const overrun = line.endsAt - sceneEnd;
    if (overrun > SPEECH_OVERRUN_TOLERANCE) {
      issues.push(
        finding({
          check: 'narration_shot_drift',
          severity: 'soft_fail',
          layer: 'cross_modal',
          sceneId: scene.id,
          timecodeStart: round3(sceneEnd),
          timecodeEnd: round3(line.endsAt),
          confidence: 0.95,
          repair: 'retime_scene',
          message:
            `Scene ${scene.index + 1}'s line runs ${overrun.toFixed(2)}s past the cut, so it ` +
            `finishes over the next shot.`,
          because: cite(TEMPORAL_STANDARDS.speechInsideItsShot),
        }),
      );
    }
  }
  return issues;
}

/** Frames that never changed. A held composition and a dropped motion look alike. */
export function heldFrameIssues(params: {
  freezes: readonly Freeze[];
  scenes: readonly Scene[];
  cut: FilmCut;
  fps: number;
}): QaFinding[] {
  const beat = HELD_FRAME_CEILING[params.cut === 'short' ? 'short' : 'feature'];

  return params.freezes
    .map((freeze) => {
      const scene = sceneAt(params.scenes, freeze.start);
      const reading = readingAllowance(scene);
      return { freeze, scene, ceiling: Math.max(beat, reading), reading };
    })
    // Compared at the precision the measurement is reported at. FFmpeg gives
    // these back as floats, and `3.2 - 2 > 1.2` is true in binary — a rule
    // that says "more than a beat" must not fire on exactly a beat because of
    // the last bit of a double.
    .filter(({ freeze, ceiling }) => round3(freeze.end - freeze.start) > ceiling)
    .map(({ freeze, scene, ceiling, reading }) =>
      finding({
        check: 'still_frame_hold',
        severity: 'soft_fail',
        layer: 'visual',
        sceneId: scene?.id ?? null,
        timecodeStart: round3(freeze.start),
        timecodeEnd: round3(freeze.end),
        frameStart: toFrame(freeze.start, params.fps),
        frameEnd: toFrame(freeze.end, params.fps),
        confidence: 0.9,
        repair: 'trim_hold',
        message:
          `Nothing on screen changes for ${(freeze.end - freeze.start).toFixed(2)}s from ` +
          `${freeze.start.toFixed(2)}s; ` +
          (reading > beat
            ? `its copy takes ${reading.toFixed(2)}s to read and the hold outlasts it.`
            : `the ceiling for this cut is ${ceiling}s.`),
        because: cite(TEMPORAL_STANDARDS.heldFrame),
      }),
    );
}

/**
 * How long a still frame is allowed to stay still because someone is reading it.
 *
 * The standard behind the check says a frozen frame is either a held
 * composition or a render that dropped its motion, and that the bar is what
 * the eye tolerates rather than what the code intended. What the eye tolerates
 * is not a constant: a viewer halfway through a sentence is not waiting, they
 * are reading, and a beat-and-a-bit ceiling applied to a typographic shot
 * flags every well-made one of them. So the shot is given the time its own
 * copy needs — and past that it is a finding again, held on purpose or not,
 * which is what keeps this from becoming an exemption for anything that calls
 * itself a hold.
 *
 * A shot with nothing to read gets no allowance. There is nothing on it that
 * asks for the time.
 */
function readingAllowance(scene: Scene | null): number {
  if (!scene || scene.onScreenText.length === 0) return 0;
  return readingSecondsFor(scene.onScreenText.join(' '));
}

/** Holes in the track. A pause is a tool; past a second it reads as a fault. */
export function deadAirIssues(params: {
  silences: readonly Silence[];
  durationSeconds: number;
  cut: FilmCut;
  scenes: readonly Scene[];
}): QaFinding[] {
  const ceiling = DEAD_AIR_CEILING[params.cut === 'short' ? 'short' : 'feature'];
  return params.silences
    .filter((silence) => {
      // The head and tail of a film are allowed to be quiet: one is before
      // anything has started and the other is the ending.
      if (silence.start < 0.2) return false;
      if (silence.end > params.durationSeconds - 0.3) return false;
      return round3(silence.end - silence.start) > ceiling;
    })
    .map((silence) =>
      finding({
        check: 'silence_gap',
        severity: 'soft_fail',
        layer: 'audio',
        sceneId: sceneAt(params.scenes, silence.start)?.id ?? null,
        timecodeStart: round3(silence.start),
        timecodeEnd: round3(silence.end),
        confidence: 0.95,
        repair: 'remix_audio',
        message:
          `${(silence.end - silence.start).toFixed(2)}s of silence from ${silence.start.toFixed(2)}s; ` +
          `the ceiling for this cut is ${ceiling}s.`,
        because: cite(TEMPORAL_STANDARDS.deadAir),
      }),
    );
}

/** Somebody turning a knob, heard between two adjacent windows. */
export function levelJumpIssues(windows: readonly LoudnessWindow[]): QaFinding[] {
  const issues: QaFinding[] = [];
  for (let index = 1; index < windows.length; index += 1) {
    const previous = windows[index - 1]!;
    const current = windows[index]!;
    /*
     * The first three seconds are not measurable here, by construction.
     *
     * Short-term loudness is defined over a three-second window, so until the
     * window has filled the filter reports -120 and every film would appear to
     * jump a hundred units as its opening arrives. The opening's level is not
     * unwatched — integrated loudness and true peak both cover it — but it is
     * not this check's to judge.
     */
    if (current.at < SHORT_TERM_WINDOW_SECONDS) continue;
    // A window with nothing in it is not a jump either: silence has its own
    // check, and -70 against -16 would fire on every intentional pause.
    if (previous.lufs < -60 || current.lufs < -60) continue;
    const jump = Math.abs(current.lufs - previous.lufs);
    if (jump > LEVEL_JUMP_CEILING_LU) {
      issues.push(
        finding({
          check: 'level_jump',
          severity: 'soft_fail',
          layer: 'audio',
          timecodeStart: round3(previous.at),
          timecodeEnd: round3(current.at),
          confidence: 0.85,
          repair: 'remix_audio',
          message:
            `Loudness jumps ${jump.toFixed(1)} LU at ${current.at.toFixed(1)}s ` +
            `(${previous.lufs.toFixed(1)} to ${current.lufs.toFixed(1)} LUFS).`,
          because: cite(TEMPORAL_STANDARDS.levelJump),
        }),
      );
    }
  }
  return issues;
}

/**
 * A film that stops rather than ends.
 *
 * Measured from the tail: if the last fifth of a second is still at level, the
 * track was cut rather than faded, which is the most recognisable sound of an
 * unfinished edit.
 */
export function abruptEndIssue(params: {
  tailPeakDb: number;
  durationSeconds: number;
}): QaFinding[] {
  if (params.tailPeakDb <= TAIL_SILENCE_FLOOR_DB) return [];
  return [
    finding({
      check: 'abrupt_music_end',
      severity: 'soft_fail',
      layer: 'audio',
      timecodeStart: round3(Math.max(0, params.durationSeconds - TAIL_FADE_SECONDS)),
      timecodeEnd: round3(params.durationSeconds),
      confidence: 0.9,
      repair: 'refade_audio',
      message:
        `The track is still at ${params.tailPeakDb.toFixed(1)} dBFS in its final ` +
        `${(TAIL_FADE_SECONDS * 1000).toFixed(0)}ms: it stops rather than ends.`,
      because: cite(TEMPORAL_STANDARDS.endedNotStopped),
    }),
  ];
}

// --- repair --------------------------------------------------------------

/**
 * Snaps every caption onto the speech it captions.
 *
 * The deterministic repair for the onset and offset findings above: the cue
 * keeps its words and takes its times from where the words actually are, with
 * a frame of lead so it is never ahead of the line. A cue with no speech under
 * it — a title card, an end plate — is left exactly as it was, because there
 * is nothing to snap it to and moving it would be guessing.
 *
 * Pure, and it returns a new list: a repair that mutated the cues in place
 * could not be compared against what it replaced.
 */
export function retimeCaptionsToSpeech(params: {
  cues: readonly CaptionCue[];
  spoken: readonly SpokenLine[];
  fps: number;
}): CaptionCue[] {
  if (params.spoken.length === 0) return [...params.cues];
  const frame = params.fps > 0 ? 1 / params.fps : 0.04;

  const retimed = params.cues.map((cue) => {
    const line = bestOverlapLine(params.spoken, cue);
    if (!line) return cue;
    // One frame early, deliberately: a caption level with the first syllable
    // reads as late, and a whole frame is inside the published tolerance.
    const start = Math.max(0, round3(line.startsAt - frame));
    const end = round3(Math.max(start + MIN_CUE_SECONDS, line.endsAt));
    return { ...cue, start, end };
  });

  /*
   * Then the overlaps the snapping may have created.
   *
   * Two lines spoken close together can be snapped onto windows that touch,
   * and an overlap is a hard fail — so the earlier cue gives way, never the
   * later one, because the later one is sitting on speech that is happening.
   */
  const ordered = [...retimed].sort((left, right) => left.start - right.start);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (previous.end > current.start) {
      ordered[index - 1] = { ...previous, end: round3(Math.max(previous.start + MIN_CUE_SECONDS, current.start - frame)) };
    }
  }
  return ordered;
}

/** Below this a cue is on screen too briefly to read at all. */
const MIN_CUE_SECONDS = 0.7;

function bestOverlapLine(lines: readonly SpokenLine[], cue: CaptionCue): SpokenLine | null {
  let best: SpokenLine | null = null;
  let bestOverlapSeconds = 0;
  for (const line of lines) {
    const overlap = Math.min(cue.end, line.endsAt) - Math.max(cue.start, line.startsAt);
    if (overlap > bestOverlapSeconds) {
      bestOverlapSeconds = overlap;
      best = line;
    }
  }
  return best;
}

// --- measurement ---------------------------------------------------------

/**
 * Runs the three FFmpeg filters the checks above need, in one pass each.
 *
 * Each returns what it measured and nothing else; a filter that fails returns
 * an empty measurement rather than throwing, because a QA pass that cannot run
 * must not be the reason a finished film is withheld.
 */
export async function measureFilm(
  masterPath: string,
  options: { signal?: AbortSignal; timeoutMs?: number; silenceFloorDb?: number; workDir?: string } = {},
): Promise<{ freezes: Freeze[]; silences: Silence[]; windows: LoudnessWindow[]; tailPeakDb: number }> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const signal = options.signal;
  const floor = options.silenceFloorDb ?? -50;

  /*
   * Loudness goes to a file rather than to the log.
   *
   * ebur128 only prints its per-frame readings at verbose log level, and the
   * runner keeps the last few kilobytes of stderr — so on any film longer than
   * a few seconds the early windows would be the ones thrown away, and the
   * check would quietly measure the end of the film only. `ametadata` writes
   * exactly the readings we asked for and nothing else.
   */
  const loudnessPath = path.join(
    options.workDir ?? path.dirname(masterPath),
    `loudness-${Math.random().toString(36).slice(2, 10)}.txt`,
  );

  const [freezeRun, silenceRun] = await Promise.all([
    runFfmpeg(
      ['-nostdin', '-i', masterPath, '-vf', 'freezedetect=n=-60dB:d=0.5', '-map', '0:v:0', '-f', 'null', '-'],
      { ...(signal ? { signal } : {}), timeoutMs },
    ),
    runFfmpeg(
      ['-nostdin', '-i', masterPath, '-af', `silencedetect=noise=${floor}dB:d=0.3`, '-f', 'null', '-'],
      { ...(signal ? { signal } : {}), timeoutMs },
    ),
  ]);

  await runFfmpeg(
    [
      '-nostdin',
      '-i',
      masterPath,
      '-af',
      `ebur128=metadata=1,ametadata=mode=print:key=lavfi.r128.S:file=${loudnessPath}`,
      '-f',
      'null',
      '-',
    ],
    { ...(signal ? { signal } : {}), timeoutMs },
  );

  let windows: LoudnessWindow[] = [];
  try {
    windows = parseShortTermLoudness(await readFile(loudnessPath, 'utf8'));
  } catch {
    // A measurement that could not run proves nothing and withholds nothing.
    windows = [];
  } finally {
    await rm(loudnessPath, { force: true }).catch(() => undefined);
  }

  return {
    freezes: parseFreezes(freezeRun.stderr),
    silences: parseSilences(silenceRun.stderr),
    windows,
    tailPeakDb: await measureTailPeak(masterPath, { ...(signal ? { signal } : {}), timeoutMs }),
  };
}

/** The loudest sample in the final fifth of a second. */
export async function measureTailPeak(
  masterPath: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<number> {
  const run = await runFfmpeg(
    [
      '-nostdin',
      '-sseof',
      `-${TAIL_FADE_SECONDS}`,
      '-i',
      masterPath,
      '-af',
      'astats=measure_overall=Peak_level:measure_perchannel=none',
      '-f',
      'null',
      '-',
    ],
    options,
  );
  const match = /Peak level dB:\s*(-?\d+(?:\.\d+)?|-inf)/i.exec(run.stderr);
  if (!match) return Number.NEGATIVE_INFINITY;
  return match[1] === '-inf' ? Number.NEGATIVE_INFINITY : Number(match[1]);
}

/**
 * freezedetect writes a start and an end as separate lines.
 *
 * An unterminated start means the film ended frozen, which is worth reporting
 * rather than dropping, so it is closed at the last timestamp seen.
 */
export function parseFreezes(stderr: string): Freeze[] {
  const freezes: Freeze[] = [];
  let open: number | null = null;
  for (const line of stderr.split('\n')) {
    const start = /freeze_start:\s*(\d+(?:\.\d+)?)/.exec(line);
    if (start) {
      open = Number(start[1]);
      continue;
    }
    const end = /freeze_end:\s*(\d+(?:\.\d+)?)/.exec(line);
    if (end && open !== null) {
      freezes.push({ start: open, end: Number(end[1]) });
      open = null;
    }
  }
  return freezes;
}

/** silencedetect writes silence_start and silence_end on separate lines. */
export function parseSilences(stderr: string): Silence[] {
  const silences: Silence[] = [];
  let open: number | null = null;
  for (const line of stderr.split('\n')) {
    const start = /silence_start:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (start) {
      open = Math.max(0, Number(start[1]));
      continue;
    }
    const end = /silence_end:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (end && open !== null) {
      silences.push({ start: open, end: Number(end[1]) });
      open = null;
    }
  }
  return silences;
}

/**
 * The short-term loudness readings, as `ametadata` writes them.
 *
 * A frame header carrying `pts_time`, then the value on the line after it.
 * `S` is the published three-second window from EBU Tech 3341, which is what
 * makes the five-unit threshold mean what the standard means.
 */
export function parseShortTermLoudness(text: string): LoudnessWindow[] {
  const readings: LoudnessWindow[] = [];
  let at: number | null = null;
  for (const line of text.split('\n')) {
    const header = /pts_time:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (header) {
      at = Number(header[1]);
      continue;
    }
    const value = /lavfi\.r128\.S=\s*(-?\d+(?:\.\d+)?|-inf|nan)/i.exec(line);
    if (value && at !== null) {
      const raw = value[1]!;
      readings.push({ at, lufs: raw === '-inf' || raw === 'nan' ? -70 : Number(raw) });
      at = null;
    }
  }
  // One reading a second is enough to hear a knob turn, and keeps a minute of
  // film to sixty comparisons rather than six hundred.
  const spaced: LoudnessWindow[] = [];
  for (const reading of readings) {
    const last = spaced[spaced.length - 1];
    if (!last || reading.at - last.at >= 0.9) spaced.push(reading);
  }
  return spaced;
}

function bestOverlap(cues: readonly CaptionCue[], line: SpokenLine): CaptionCue | null {
  let best: CaptionCue | null = null;
  let bestOverlapSeconds = 0;
  for (const cue of cues) {
    const overlap = Math.min(cue.end, line.endsAt) - Math.max(cue.start, line.startsAt);
    if (overlap > bestOverlapSeconds) {
      bestOverlapSeconds = overlap;
      best = cue;
    }
  }
  return best;
}

function sceneAt(scenes: readonly Scene[], seconds: number): Scene | null {
  return scenes.find((scene) => seconds >= scene.startTime && seconds < scene.startTime + scene.duration) ?? null;
}

function toFrame(seconds: number, fps: number): number | null {
  return fps > 0 ? Math.round(seconds * fps) : null;
}

function describeFrames(seconds: number, frameSeconds: number): string {
  const frames = Math.round(seconds / frameSeconds);
  return `${frames} frame${frames === 1 ? '' : 's'}`;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
