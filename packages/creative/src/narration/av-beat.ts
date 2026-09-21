import type { SpokenWord } from './spoken-word.ts';

/**
 * One beat of an audio-visual timeline.
 *
 * WHAT THIS REPLACES. Until now a film was a list of shots with durations
 * somebody chose, and narration was fitted into them afterwards — placed at a
 * delay, shortened when it would not fit, and left to fall where it fell
 * against a cut it had no part in. That produces exactly what every critic
 * reported: a voice running alongside a film rather than through it, on-screen
 * words that are not the spoken words, and emphasis that lands wherever the
 * typography happened to be scheduled.
 *
 * A beat is the other way round. It is ONE SPOKEN IDEA and the visual
 * consequence of that idea, and its length is whatever the reading of it turns
 * out to be. The voice is generated first, its real word timings are measured,
 * and the cut, the typography, the motion and the sound cues are all derived
 * from those timings. Nothing is placed against a schedule that does not know
 * what was said.
 *
 * The rule that keeps it honest: every spoken idea has a visual consequence,
 * and every visual event has a reason in the narration. A beat with no `line`
 * is allowed — a film needs moments that are only picture — but it has to say
 * why it exists, and `reason` is not optional anywhere.
 */
export type AvBeat = {
  id: string;
  /** The idea, spoken. Empty for a beat that is deliberately wordless. */
  line: string;
  /**
   * The word or phrase that carries the idea, exactly as it appears in `line`.
   *
   * This is the one the picture reacts to: the field arrives on it, the mark
   * lands on it, the impact hits on it. Matched against the real reading, so
   * it must be a substring of the line rather than a paraphrase of it.
   */
  emphasis: string | null;
  /** Why this beat exists at all, in the film's argument. */
  reason: string;
  /** Held after the last word, so the idea lands before the next one starts. */
  tailSeconds?: number;
  /** Held before the first word, when the picture needs to arrive first. */
  leadSeconds?: number;
};

/** A beat once the voice has been read and measured. */
export type TimedBeat = AvBeat & {
  /** Where this beat starts on the film's clock. */
  atSeconds: number;
  /** How long it runs: lead, the reading, and tail. */
  durationSeconds: number;
  /** When the voice starts, relative to the beat. */
  voiceAtSeconds: number;
  /** The reading, in seconds. Zero for a wordless beat. */
  voiceSeconds: number;
  /** Every word, relative to the BEAT rather than to the take. */
  words: SpokenWord[];
  /** The emphasis word's moment, relative to the beat. Null when there is none. */
  emphasisAtSeconds: number | null;
  /** The line broken where the voice breathes, for putting it on screen. */
  phrases: Phrase[];
};

/**
 * A run of words shown together.
 *
 * Split where the READING pauses, not where the punctuation is. A voice does
 * not always breathe at a comma, and when it does not, a caption that breaks
 * there contradicts what the viewer is hearing.
 */
export type Phrase = {
  text: string;
  /** Relative to the beat. */
  atSeconds: number;
  endSeconds: number;
  /** True when the emphasis word is in this phrase. */
  carriesEmphasis: boolean;
};

export type LayoutOptions = {
  /** A silence at least this long ends a phrase. */
  breathSeconds?: number;
  /** At most this many words in one phrase, however the voice runs on. */
  maxWords?: number;
  /** Default hold after the last word of a beat. */
  tailSeconds?: number;
};

/**
 * Lays beats end to end on one clock, from the readings themselves.
 *
 * `readings` is keyed by beat id. A beat with no reading is wordless and keeps
 * whatever lead and tail it declares, which is how a film gets a moment that
 * is only picture without pretending somebody said something over it.
 */
export function layout(
  beats: readonly AvBeat[],
  readings: ReadonlyMap<string, { durationSeconds: number; words: SpokenWord[] }>,
  options: LayoutOptions = {},
): TimedBeat[] {
  const defaultTail = options.tailSeconds ?? 0.35;
  const timed: TimedBeat[] = [];
  let at = 0;

  for (const beat of beats) {
    const reading = readings.get(beat.id);
    const lead = beat.leadSeconds ?? 0;
    const tail = beat.tailSeconds ?? defaultTail;
    const voiceSeconds = reading?.durationSeconds ?? 0;
    const words = reading?.words ?? [];

    const phrases = phrasesOf(words, beat.emphasis, options).map((phrase) => ({
      ...phrase,
      atSeconds: round(phrase.atSeconds + lead),
      endSeconds: round(phrase.endSeconds + lead),
    }));

    const emphasisWord = beat.emphasis ? findEmphasis(words, beat.emphasis) : null;

    timed.push({
      ...beat,
      atSeconds: round(at),
      // A wordless beat is its lead and tail and nothing else, so it needs at
      // least one of them to exist at all.
      durationSeconds: round(Math.max(0.4, lead + voiceSeconds + tail)),
      voiceAtSeconds: round(lead),
      voiceSeconds: round(voiceSeconds),
      words: words.map((w) => ({ ...w, startSeconds: round(w.startSeconds + lead), endSeconds: round(w.endSeconds + lead) })),
      emphasisAtSeconds: emphasisWord ? round(emphasisWord.startSeconds + lead) : null,
      phrases,
    });
    at += timed[timed.length - 1]!.durationSeconds;
  }
  return timed;
}

/**
 * Where the emphasis actually falls in the reading.
 *
 * Matched on the words the engine reported rather than on the script, because
 * those are the ones with times attached. Punctuation is ignored on both sides:
 * a line asking to stress "Three" must still match a spoken "Three." — and an
 * emphasis of several words matches at the first of them.
 */
export function findEmphasis(words: readonly SpokenWord[], emphasis: string): SpokenWord | null {
  const wanted = emphasis.trim().toLowerCase().split(/\s+/).map(bare).filter(Boolean);
  if (!wanted.length) return null;
  for (let i = 0; i + wanted.length <= words.length; i += 1) {
    if (wanted.every((want, j) => bare(words[i + j]!.word.toLowerCase()) === want)) return words[i]!;
  }
  return null;
}

/** Breaks a reading where the voice breathes. */
export function phrasesOf(
  words: readonly SpokenWord[],
  emphasis: string | null,
  options: LayoutOptions = {},
): Phrase[] {
  if (!words.length) return [];
  const breath = options.breathSeconds ?? 0.18;
  const maxWords = options.maxWords ?? 5;
  const emphasisWord = emphasis ? findEmphasis(words, emphasis) : null;

  const phrases: Phrase[] = [];
  let current: SpokenWord[] = [];

  const close = () => {
    if (!current.length) return;
    phrases.push({
      text: current.map((w) => w.word).join(' '),
      atSeconds: round(current[0]!.startSeconds),
      endSeconds: round(current[current.length - 1]!.endSeconds),
      carriesEmphasis: emphasisWord !== null && current.includes(emphasisWord),
    });
    current = [];
  };

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    /*
     * The emphasis word stands alone.
     *
     * It is the thing the picture reacts to, and a caption that shows it
     * inside a run of five other words gives the viewer nothing to look at
     * when the field arrives on it. This is the one place where the layout
     * overrides the breathing.
     */
    if (word === emphasisWord && current.length) close();
    current.push(word);
    const next = words[i + 1];
    const gap = next ? next.startSeconds - word.endSeconds : Infinity;
    if (word === emphasisWord || gap >= breath || current.length >= maxWords) close();
  }
  close();
  return phrases;
}

/** Punctuation is not part of a word for matching purposes. */
function bare(word: string): string {
  return word.replace(/[^\p{L}\p{N}'’-]/gu, '');
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}
