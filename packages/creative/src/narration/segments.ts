/**
 * Segmentation for speech.
 *
 * A long piece is read in passages: whole sentences, packed under the size
 * an engine reads well, never split mid-sentence, and never across a
 * paragraph, because a paragraph break is a breath the reader is owed and
 * the stitcher gives it one. Each passage knows its neighbours, so the
 * engine can be handed the lines before and after and keep one read going.
 */
export type Passage = {
  index: number;
  text: string;
  paragraph: number;
  sentences: number;
  /** The last passage of its paragraph: the stitcher leaves a longer pause after it. */
  endsParagraph: boolean;
};

export type SegmentOptions = {
  /** Characters per passage at most. Well under the engines' limits, so a bad estimate cannot cross one. */
  maxChars?: number;
};

const DEFAULT_MAX_CHARS = 2400;

/** Abbreviations whose full stop does not end a sentence. */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'inc', 'ltd', 'co', 'no',
  'm', 'mme', 'mlle', 'ex', 'cf', 'p', 'pp', 'fig', 'approx', 'dept', 'est', 'al', 'e.g', 'i.e',
]);

/** Splits into sentences the way a reader does: at terminal punctuation, not at every full stop. */
export function splitSentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < cleaned.length; i += 1) {
    const char = cleaned[i]!;
    if (!'.!?…'.includes(char)) continue;
    // Run of terminal punctuation, then optional closing quotes or brackets.
    let end = i + 1;
    while (end < cleaned.length && '.!?…'.includes(cleaned[end]!)) end += 1;
    while (end < cleaned.length && '"”’)\]»'.includes(cleaned[end]!)) end += 1;
    const next = cleaned[end];
    if (next !== undefined && next !== ' ') {
      i = end - 1;
      continue;
    }
    // "Yes… and then some": a stop followed by a lowercase word is a breath, not an end.
    const following = cleaned[end + 1];
    if (following !== undefined && following === following.toLowerCase() && following !== following.toUpperCase()) {
      i = end - 1;
      continue;
    }
    if (char === '.') {
      const before = cleaned.slice(start, i);
      const word = before.match(/(\S+)$/)?.[1]?.toLowerCase().replace(/^[("«]+/, '') ?? '';
      // "Dr." and "3.5" do not end sentences; "3." at the end of a line does.
      if (ABBREVIATIONS.has(word) || /^\d+$/.test(word) && /^\d/.test(cleaned[end + 1] ?? '')) {
        i = end - 1;
        continue;
      }
      // A single capital letter with a stop is an initial: "J. Smith".
      if (/^[A-Z]$/.test(word)) {
        i = end - 1;
        continue;
      }
    }
    const sentence = cleaned.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
    i = end - 1;
  }
  const tail = cleaned.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

export function segmentForSpeech(text: string, options: SegmentOptions = {}): Passage[] {
  const maxChars = Math.max(200, options.maxChars ?? DEFAULT_MAX_CHARS);
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const passages: Passage[] = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const sentences = splitSentences(paragraph);
    let current: string[] = [];
    let length = 0;
    const flush = (endsParagraph: boolean) => {
      if (current.length === 0) return;
      passages.push({
        index: passages.length,
        text: current.join(' '),
        paragraph: paragraphIndex,
        sentences: current.length,
        endsParagraph,
      });
      current = [];
      length = 0;
    };
    for (const sentence of sentences) {
      const extra = sentence.length + (current.length > 0 ? 1 : 0);
      if (current.length > 0 && length + extra > maxChars) flush(false);
      if (sentence.length > maxChars) {
        // One sentence longer than a passage: broken at clauses rather than mid-word.
        for (const clause of splitLongSentence(sentence, maxChars)) {
          flush(false);
          current = [clause];
          length = clause.length;
        }
        continue;
      }
      current.push(sentence);
      length += extra;
    }
    flush(true);
  });
  return passages;
}

function splitLongSentence(sentence: string, maxChars: number): string[] {
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    const at = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(' '));
    const cut = at > maxChars / 3 ? at + 1 : maxChars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** The pause after a passage: a breath between sentences, longer at a paragraph's end. */
export function pauseAfter(passage: Pick<Passage, 'endsParagraph'>, options: { sentence?: number; paragraph?: number } = {}): number {
  return passage.endsParagraph ? (options.paragraph ?? 0.9) : (options.sentence ?? 0.35);
}
