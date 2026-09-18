import {
  CAPTION_MAX_LINES,
  CAPTION_MAX_SECONDS,
  CAPTION_MIN_GAP_SECONDS,
  CAPTION_MIN_SECONDS,
  captionLimits,
  captionScript,
  type CaptionScript,
} from '../standards/caption.ts';

/**
 * Captions.
 *
 * Built from where each word actually fell, and shaped by the published
 * subtitling limits rather than by a character count: two lines, a length per
 * line that depends on the script, a reading rate nobody can beat, a floor and
 * a ceiling on how long a line holds, and a gap between them so the eye knows
 * one has ended.
 *
 * The reading rate is the rule that does the most work and is the easiest to
 * get wrong. Speech runs faster than reading, so a caption timed exactly to
 * the audio is routinely unreadable: the standard answer is to hold the line
 * past the words, into the silence that follows. That works where there is
 * silence. Where there is not, the caption is genuinely too fast, and the
 * honest fix is fewer words — which is why this reports it rather than
 * quietly dropping text to make the sums work.
 */

/** What a caption needs: the words, when they are said, and where they break. */
export type CaptionCue = {
  start: number;
  end: number;
  /** The whole line, for anything that wants the words rather than the layout. */
  text: string;
  /** One or two lines, broken where the language allows. */
  lines: string[];
};

export type CaptionOptions = {
  /** ISO 639-1. Decides the line length and the reading rate. */
  language?: string | null;
  /** How far the last caption may run: the film's own length. */
  filmSeconds?: number | null;
  /**
   * Times a caption may not span, in seconds.
   *
   * Scene starts, in practice. A caption that carries the end of one shot's
   * line and the start of the next one's is read as belonging to neither, and
   * it holds words from a shot that is no longer on screen.
   */
  boundaries?: readonly number[];
};

/**
 * Words that may not end a line.
 *
 * A line ending in "the" or "of" hands the reader a fragment and makes them
 * hold it until the next line arrives, which costs the time captions do not
 * have. The list is small and deliberately shallow: these are the words that
 * govern what comes after them, in the languages this platform writes in.
 */
const DANGLING = new Set([
  // English
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'and', 'or',
  'but', 'as', 'is', 'are', 'was', 'were', 'be', 'that', 'this', 'your', 'our', 'their', 'its',
  // French
  'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'au', 'aux', 'et', 'ou', 'que', 'qui', 'dans',
  'pour', 'par', 'sur', 'sans', 'votre', 'notre', 'leur', 'ses', 'est', 'sont',
  // German
  'der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'einen', 'einem', 'und', 'oder', 'mit', 'für',
  'von', 'zum', 'zur', 'ist', 'sind',
  // Spanish, Italian, Portuguese
  'el', 'los', 'las', 'una', 'unos', 'unas', 'y', 'o', 'con', 'sin', 'por', 'para', 'del', 'al',
  'il', 'lo', 'gli', 'una', 'e', 'di', 'da', 'nel', 'della', 'um', 'uma', 'os', 'as', 'no', 'na',
]);

/** Punctuation that ends a thought, and punctuation that pauses one. */
const ENDS_SENTENCE = /[.!?…]["'”’)\]]?$/;
const ENDS_CLAUSE = /[,;:—–-]$/;

/**
 * Captions from aligned words.
 *
 * Three passes, because the rules pull against each other and doing them at
 * once produces a builder nobody can reason about: group the words into cues
 * that break where the language breaks; hold each cue long enough to read;
 * then break each cue into lines.
 */
export function captionsFrom(
  words: readonly { word: string; start: number; end: number }[],
  options: CaptionOptions & { maxCharacters?: number } = {},
): CaptionCue[] {
  const limits = captionLimits(options.language);
  const script = captionScript(options.language);
  // `maxCharacters` is the whole cue across both lines; a caller that passes one
  // is asking for a narrower cue than the script allows, never a wider one.
  const perLine = options.maxCharacters
    ? Math.max(8, Math.floor(options.maxCharacters / CAPTION_MAX_LINES))
    : limits.charactersPerLine;
  /*
   * Everything below measures in columns, so the per-line character limit is
   * converted once, here. Conflating the two is how a Japanese caption ends up
   * held to half the length the guide gives it.
   */
  const maxCue = perLine * (script === 'full_width' ? 2 : 1) * CAPTION_MAX_LINES;

  const grouped = groupWords(words, { maxCue, script, boundaries: options.boundaries ?? [] });
  const timed = holdLongEnough(grouped, {
    charactersPerSecond: limits.charactersPerSecond,
    script,
    filmSeconds: options.filmSeconds ?? null,
  });
  return timed.map((cue) => ({
    start: round3(cue.start),
    end: round3(cue.end),
    text: cue.text,
    lines: captionLines(cue.text, perLine, script),
  }));
}

type Grouped = { start: number; end: number; text: string };
type Entry = { word: string; start: number; end: number };

/**
 * Words into cues.
 *
 * A sentence that ends is always a break — it is the best one available and it
 * costs nothing. Otherwise the cue grows until it would exceed the line budget
 * or the seven-second ceiling, and then breaks at the last clause boundary it
 * passed rather than at the word that happened to overflow, so long as that
 * boundary does not leave a scrap of a caption behind.
 */
function groupWords(
  words: readonly { word: string; start: number; end: number }[],
  params: { maxCue: number; script: CaptionScript; boundaries: readonly number[] },
): Grouped[] {
  const cues: Grouped[] = [];
  let current: Entry[] = [];
  /** How many words in, the last place this cue could be cut. -1 for nowhere. */
  let lastClause = -1;

  const push = (entries: Entry[]) => {
    if (entries.length === 0) return;
    cues.push({
      start: entries[0]!.start,
      end: entries.at(-1)!.end,
      text: entries.map((entry) => entry.word).join(' '),
    });
  };
  const widthOf = (entries: Entry[]) => columns(entries.map((entry) => entry.word).join(' '), params.script);
  const clauseIn = (entries: Entry[]) => {
    let at = -1;
    for (const [index, entry] of entries.entries()) if (ENDS_CLAUSE.test(entry.word)) at = index + 1;
    return at;
  };

  /*
   * Every token, with the over-wide ones already broken up. Done before the
   * loop rather than inside it so the grouping below has one kind of thing to
   * reason about.
   */
  const entries = words
    .map((raw) => ({ word: raw.word.trim(), start: raw.start, end: raw.end }))
    .filter((entry) => entry.word !== '')
    .flatMap((entry) => splitWide(entry, params));

  const boundaries = [...params.boundaries].sort((a, b) => a - b);
  let boundary = 0;

  for (const entry of entries) {
    const word = entry.word;

    // A scene has started since the last word. Whatever the cue was building,
    // it belongs to the shot that is now gone.
    while (boundary < boundaries.length && boundaries[boundary]! <= entry.start) {
      if (boundaries[boundary]! > (current[0]?.start ?? Infinity)) {
        push(current);
        current = [];
        lastClause = -1;
      }
      boundary += 1;
    }

    if (current.length > 0) {
      const candidate = [...current, entry];
      const tooWide = widthOf(candidate) > params.maxCue;
      const tooLong = entry.end - current[0]!.start > CAPTION_MAX_SECONDS;
      if (tooWide || tooLong) {
        // A clause boundary is only worth using if it leaves a real caption on
        // both sides; near the very start of a cue it just makes two scraps.
        const at = lastClause > 0 && lastClause >= current.length / 3 ? lastClause : current.length;
        push(current.slice(0, at));
        let carried = current.slice(at);
        if (carried.length > 0 && widthOf([...carried, entry]) > params.maxCue) {
          push(carried);
          carried = [];
        }
        current = [...carried, entry];
        lastClause = clauseIn(current);
        if (ENDS_SENTENCE.test(word)) {
          push(current);
          current = [];
          lastClause = -1;
        }
        continue;
      }
      current = candidate;
    } else {
      current = [entry];
      lastClause = -1;
    }

    if (ENDS_CLAUSE.test(word)) lastClause = current.length;
    if (ENDS_SENTENCE.test(word)) {
      push(current);
      current = [];
      lastClause = -1;
    }
  }
  push(current);
  return cues;
}

/**
 * A single token too wide for a whole caption.
 *
 * In Japanese and Chinese an aligner returns runs rather than words, because
 * the writing has no spaces to return. A run that will not fit is split at
 * character boundaries and its time divided across the pieces in proportion,
 * which is the only honest way to caption it: the alternative is a line the
 * player crops.
 */
function splitWide(entry: Entry, params: { maxCue: number; script: CaptionScript }): Entry[] {
  if (columns(entry.word, params.script) <= params.maxCue) return [entry];
  const pieces = hardWrap(entry.word, params.maxCue, params.script);
  if (pieces.length <= 1) return [entry];
  const span = Math.max(0, entry.end - entry.start);
  const width = pieces.reduce((sum, piece) => sum + columns(piece, params.script), 0) || 1;
  let at = entry.start;
  return pieces.map((piece) => {
    const share = (columns(piece, params.script) / width) * span;
    const part = { word: piece, start: at, end: at + share };
    at += share;
    return part;
  });
}

/**
 * A line's length in the unit the published limits are written in.
 *
 * Both figures — 42 characters a line, 20 a second — count characters, while
 * everything to do with fitting a line on a screen counts columns. A
 * full-width character is one character occupying two columns, so a Japanese
 * line with a Latin product name in it counts that name at half weight, which
 * is what the reader's eye does with it too. Keeping the two units in one
 * helper is the only way this stays straight: measuring a Japanese line in
 * columns and comparing it to a character limit holds it to half the length
 * the guide actually gives it.
 */
export function characterWidth(text: string, script: CaptionScript): number {
  return script === 'full_width' ? columns(text, script) / 2 : text.length;
}

/**
 * Long enough to read, and never overlapping.
 *
 * Every cue is given the time its own characters need at the script's reading
 * rate, and at least the floor. It may borrow the silence after it, up to the
 * next cue's start less the two-frame gap, and up to the ceiling. Where the
 * silence is not there the cue is cut back rather than allowed to run into its
 * neighbour: two captions on screen at once is worse than one that is quick,
 * and the checks report the one that is quick.
 */
function holdLongEnough(
  cues: Grouped[],
  params: { charactersPerSecond: number; script: CaptionScript; filmSeconds: number | null },
): Grouped[] {
  return cues.map((cue, index) => {
    const needed = Math.max(CAPTION_MIN_SECONDS, characterWidth(cue.text, params.script) / params.charactersPerSecond);
    const next = cues[index + 1];
    const ceiling =
      next !== undefined
        ? next.start - CAPTION_MIN_GAP_SECONDS
        : params.filmSeconds !== null
          ? params.filmSeconds
          : cue.start + CAPTION_MAX_SECONDS;
    const wanted = cue.start + Math.min(needed, CAPTION_MAX_SECONDS);
    const end = Math.min(Math.max(cue.end, wanted), Math.max(cue.start + CAPTION_MIN_GAP_SECONDS, ceiling));
    return { ...cue, end: Math.min(end, cue.start + CAPTION_MAX_SECONDS) };
  });
}

/**
 * One cue into one or two lines.
 *
 * The break goes as close to the middle as the language allows: after
 * punctuation if there is any near the centre, otherwise at the balanced word
 * boundary that does not leave an article or a preposition hanging. A cue that
 * fits on one line stays on one line — a break that buys nothing costs the
 * reader a saccade.
 *
 * Japanese and Chinese are written without spaces, so there may be no word
 * boundary to break at. Then the break goes at a character boundary, which is
 * what a Japanese subtitle does anyway.
 */
export function captionLines(text: string, perLine: number, script: CaptionScript = 'latin'): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const budget = script === 'full_width' ? perLine * 2 : perLine;
  if (columns(text, script) <= budget) return [text];

  const total = words.length;
  let best: { index: number; score: number } | null = null;
  for (let split = 1; split < total; split += 1) {
    const first = words.slice(0, split).join(' ');
    const second = words.slice(split).join(' ');
    if (columns(first, script) > budget || columns(second, script) > budget) continue;
    const previous = words[split - 1]!.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
    // Balance first, then the quality of the break.
    let score = -Math.abs(columns(first, script) - columns(second, script));
    if (ENDS_CLAUSE.test(words[split - 1]!)) score += 24;
    if (DANGLING.has(previous)) score -= 40;
    if (best === null || score > best.score) best = { index: split, score };
  }
  if (best !== null) {
    return [words.slice(0, best.index).join(' '), words.slice(best.index).join(' ')];
  }
  // No word boundary works, either because there is none or because one word
  // is wider than a line. Break by character, as close to even as the budget
  // allows. Anything still over is a finding; it is never silently dropped.
  return hardWrap(text, budget, script).slice(0, CAPTION_MAX_LINES);
}

/** Splits a run of text at character boundaries into pieces of at most `budget` columns. */
function hardWrap(text: string, budget: number, script: CaptionScript): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const char of text) {
    if (piece !== '' && columns(piece + char, script) > budget) {
      pieces.push(piece);
      piece = char === ' ' ? '' : char;
      continue;
    }
    piece += char;
  }
  if (piece.trim() !== '') pieces.push(piece);
  return pieces.map((part) => part.trim()).filter(Boolean);
}

/**
 * What a line costs in columns.
 *
 * A full-width character occupies two, which is the whole reason the published
 * limits differ between scripts rather than being a different rule for each.
 */
export function columns(text: string, script: CaptionScript): number {
  if (script === 'latin') return text.length;
  let width = 0;
  for (const char of text) width += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(char) ? 2 : 1;
  return width;
}

/** Captions as WebVTT, which is what a browser reads. */
export function toWebVtt(cues: readonly CaptionCue[]): string {
  const stamp = (seconds: number) => {
    const whole = Math.max(0, seconds);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const rest = whole % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${rest.toFixed(3).padStart(6, '0')}`;
  };
  return [
    'WEBVTT',
    '',
    ...cues.flatMap((cue, index) => [
      String(index + 1),
      `${stamp(cue.start)} --> ${stamp(cue.end)}`,
      (cue.lines.length > 0 ? cue.lines : [cue.text]).join('\n'),
      '',
    ]),
  ].join('\n');
}

/**
 * Where a caption track breaks the rules.
 *
 * Reported rather than fixed, because every one of these has exactly one
 * honest fix and it is upstream: a line that cannot be read at twenty
 * characters a second is a line with too many words in it, and stretching it
 * over the next caption would hide that rather than solve it.
 */
export type CaptionFinding = {
  standardId: string;
  cueIndex: number;
  atSeconds: number;
  message: string;
};

export function captionFindings(
  cues: readonly CaptionCue[],
  options: CaptionOptions = {},
): CaptionFinding[] {
  const limits = captionLimits(options.language);
  const script = captionScript(options.language);
  const findings: CaptionFinding[] = [];

  for (const [index, cue] of cues.entries()) {
    const seconds = cue.end - cue.start;
    if (cue.lines.length > CAPTION_MAX_LINES) {
      findings.push({
        standardId: 'caption.two_lines',
        cueIndex: index,
        atSeconds: cue.start,
        message: `${cue.lines.length} lines on screen at once.`,
      });
    }
    for (const line of cue.lines) {
      const width = characterWidth(line, script);
      if (width > limits.charactersPerLine) {
        findings.push({
          standardId: 'caption.line_length',
          cueIndex: index,
          atSeconds: cue.start,
          message: `A caption line runs ${width} characters against a limit of ${limits.charactersPerLine}.`,
        });
        break;
      }
    }
    const readable = characterWidth(cue.text, script) / limits.charactersPerSecond;
    if (seconds + 0.02 < readable) {
      findings.push({
        standardId: 'caption.reading_rate',
        cueIndex: index,
        atSeconds: cue.start,
        message:
          `A caption holds ${seconds.toFixed(1)}s for ${characterWidth(cue.text, script)} characters, which needs ` +
          `${readable.toFixed(1)}s at ${limits.charactersPerSecond} a second.`,
      });
    }
    if (seconds + 0.02 < CAPTION_MIN_SECONDS) {
      findings.push({
        standardId: 'caption.minimum_duration',
        cueIndex: index,
        atSeconds: cue.start,
        message: `A caption flashes for ${seconds.toFixed(2)}s.`,
      });
    }
    if (seconds > CAPTION_MAX_SECONDS + 0.02) {
      findings.push({
        standardId: 'caption.maximum_duration',
        cueIndex: index,
        atSeconds: cue.start,
        message: `A caption holds for ${seconds.toFixed(1)}s.`,
      });
    }
    const next = cues[index + 1];
    if (next && next.start + 0.001 < cue.end + CAPTION_MIN_GAP_SECONDS) {
      findings.push({
        standardId: 'caption.gap',
        cueIndex: index,
        atSeconds: cue.start,
        message: `Two captions are ${Math.max(0, next.start - cue.end).toFixed(3)}s apart.`,
      });
    }
  }
  return findings;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
