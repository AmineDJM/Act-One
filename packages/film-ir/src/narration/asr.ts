import type { Method, Producer } from '../schema/source.ts';
import type { NarrationIR, Phrase, Word } from '../schema/audio.ts';
import type { RationalTime, Ref, TimeRange } from '../schema/primitives.ts';
import { estimated, measured, unknown } from '../evidence.ts';
import { addTime, compareTime, fromSeconds } from '../time.ts';
import type { SampleClock } from '../compile/clock.ts';
import type { ForensicAudio } from '../forensics/report.ts';

/**
 * The narration, from a transcription and the measured sound.
 *
 * Words and their order come from a recogniser, which reads speech the way
 * OCR reads type: a measurement by a model, kept with its confidence. Where
 * each word starts is the recogniser's alignment — good to a few tens of
 * milliseconds — so word times are ESTIMATED with bounds. A phrase that
 * begins out of silence has a measured onset nearby; when there is one its
 * start is moved onto that sample and becomes MEASURED. Energy, pitch and
 * emphasis are read off the measured curves inside each word.
 *
 * A recogniser writes sentences over music. Words inside measured silence,
 * or in segments the recogniser itself says hold no speech, are discarded
 * and counted rather than kept.
 */
export type TranscriptInput = {
  text: string;
  language: string | null;
  words: { word: string; start: number; end: number }[];
  segments?: { start: number; end: number; text: string; noSpeechProbability: number | null; averageLogProbability: number | null }[];
  model: string;
};

export const ASR_METHODS: Method[] = [
  {
    id: 'asr.transcript',
    kind: 'asr',
    name: 'Transcription',
    version: 'whisper-1',
    deterministic: false,
    description: 'Speech recognised by a model from a 16 kHz mono mix of the film; words, their order and the language it heard. A model reading, kept with its confidence.',
    parameters: {},
    citation: null,
  },
  {
    id: 'asr.alignment',
    kind: 'asr',
    name: 'Word timing',
    version: 'whisper-1',
    deterministic: false,
    description: 'Word start and end as aligned by the recogniser, relative to the first decoded audio sample. Accurate to tens of milliseconds; reported with ±80 ms bounds.',
    parameters: { boundsMs: 80 },
    citation: null,
  },
  {
    id: 'narration.prosody',
    kind: 'derivation',
    name: 'Word prosody',
    version: '1.0.0',
    deterministic: true,
    description: 'Mean RMS level and median YIN pitch over the analysis hops inside a word; pitch slope by least squares; emphasis from level, pitch and length against the phrase, through a logistic.',
    parameters: {},
    citation: null,
  },
  {
    id: 'narration.segmentation',
    kind: 'derivation',
    name: 'Phrases and pauses',
    version: '1.0.0',
    deterministic: true,
    description: 'Phrases split where consecutive words are ≥250 ms apart; a phrase start within 120 ms of a measured voice or onset edge is moved onto that sample.',
    parameters: { pauseMs: 250, snapMs: 120 },
    citation: null,
  },
];

const BOUNDS_S = 0.08;
const PAUSE_S = 0.25;
const SNAP_S = 0.12;

export function buildNarration(input: {
  transcript: TranscriptInput;
  audio: ForensicAudio;
  samples: SampleClock;
  producer: Producer;
}): { narration: NarrationIR; discarded: number } {
  const { transcript, audio, samples } = input;
  const pass: Ref = `producer:${input.producer.id}`;
  const second = (value: number): RationalTime => addTime(samples.start, fromSeconds(value, 1000));
  const silences = audio.silences.map((silence) => [silence.startSample / audio.rate, silence.endSample / audio.rate] as const);
  const noSpeech = (transcript.segments ?? []).filter((segment) => (segment.noSpeechProbability ?? 0) > 0.6 && (segment.averageLogProbability ?? 0) < -1);
  let discarded = 0;
  const kept = transcript.words.filter((word) => {
    const middle = (word.start + word.end) / 2;
    const silent = silences.some(([a, b]) => middle >= a && middle <= b);
    const unheard = noSpeech.some((segment) => middle >= segment.start && middle <= segment.end);
    if (silent || unheard) discarded += 1;
    return !silent && !unheard && word.end >= word.start;
  });

  const hop = audio.hop / audio.rate;
  const series = (name: string) => audio.series[name] ?? [];
  const within = (name: string, start: number, end: number): number[] => {
    const values = series(name);
    const out: number[] = [];
    for (let i = Math.max(0, Math.floor(start / hop)); i <= Math.min(values.length - 1, Math.ceil(end / hop)); i += 1) {
      const value = values[i];
      if (value !== null && value !== undefined) out.push(value);
    }
    return out;
  };

  const words: Word[] = kept.map((word, index) => {
    const id = `word.${String(index + 1).padStart(4, '0')}`;
    const levels = within('rms_db', word.start, word.end);
    const pitches = within('pitch_hz', word.start, word.end);
    const range: TimeRange = { start: second(word.start), end: second(word.end) };
    return {
      id,
      text: word.word.trim().slice(0, 120),
      range: estimated(range, 'asr.alignment', [pass], 0.7, {
        lowerBound: { start: second(Math.max(0, word.start - BOUNDS_S)), end: second(Math.max(0, word.end - BOUNDS_S)) },
        upperBound: { start: second(word.start + BOUNDS_S), end: second(word.end + BOUNDS_S) },
      }),
      confidence: null,
      energyDb: levels.length ? estimated(round(mean(levels), 2), 'narration.prosody', [pass, 'series:audio.rms_db'], 0.7, { unit: 'dBFS' }) : unknown('narration.prosody', 'No analysis hop inside the word.'),
      pitchHz: pitches.length >= 2 ? estimated(round(median(pitches), 1), 'narration.prosody', [pass, 'series:audio.pitch_hz'], 0.6, { unit: 'Hz' }) : unknown('narration.prosody', 'Too few voiced frames in the word to read a pitch.'),
      pitchSlopeHzPerSecond: pitches.length >= 3 ? estimated(round(slope(pitches, hop), 1), 'narration.prosody', [pass, 'series:audio.pitch_hz'], 0.5, { unit: 'Hz/s' }) : unknown('narration.prosody', 'Too few voiced frames in the word.'),
      emphasis: unknown('narration.prosody', 'Computed per phrase below.'),
      phraseId: null,
      sentenceId: null,
    };
  });

  // Phrases: split at pauses, then emphasis within each phrase.
  const phrases: Phrase[] = [];
  const pauses: NarrationIR['pauses'] = [];
  let start = 0;
  const edges = [...audio.voiceSpans.map((span) => span.startSample), ...audio.events.map((event) => event.sample)].sort((a, b) => a - b);
  for (let i = 1; i <= kept.length; i += 1) {
    const gap = i < kept.length ? kept[i]!.start - kept[i - 1]!.end : Infinity;
    if (gap < PAUSE_S) continue;
    const members = words.slice(start, i);
    const first = kept[start]!;
    const last = kept[i - 1]!;
    const id = `phrase.${String(phrases.length + 1).padStart(3, '0')}`;
    const firstSample = Math.round(first.start * audio.rate);
    const snap = nearest(edges, firstSample, Math.round(SNAP_S * audio.rate));
    const phraseStart = snap === null ? second(first.start) : samples.at(snap);
    const phraseRange: TimeRange = { start: phraseStart, end: second(last.end) };
    const levels = members.map((word) => word.energyDb.value).filter((v): v is number => v !== null);
    const pitches = members.map((word) => word.pitchHz.value).filter((v): v is number => v !== null);
    const meanLevel = levels.length ? mean(levels) : 0;
    const medianPitch = pitches.length ? median(pitches) : 0;
    for (let k = 0; k < members.length; k += 1) {
      const word = members[k]!;
      const source = kept[start + k]!;
      const loud = word.energyDb.value === null ? 0 : (word.energyDb.value - meanLevel) / 3;
      const high = word.pitchHz.value === null || medianPitch === 0 ? 0 : Math.log2(word.pitchHz.value / medianPitch) * 6;
      const long = (source.end - source.start) / Math.max(0.08, 0.06 * Math.max(1, word.text.length)) - 1;
      const score = 1 / (1 + Math.exp(-(loud + high + 0.8 * long)));
      word.emphasis = estimated(round(score, 3), 'narration.prosody', [pass, `phrase:${id}`], 0.5, { note: 'level, pitch and length against the rest of the phrase' });
      word.phraseId = id;
    }
    const previousEnd = start > 0 ? kept[start - 1]!.end : null;
    phrases.push({
      id,
      text: members.map((word) => word.text).join(' '),
      range: snap === null
        ? estimated(phraseRange, 'asr.alignment', [pass], 0.7, {
            lowerBound: { start: second(Math.max(0, first.start - BOUNDS_S)), end: second(Math.max(0, last.end - BOUNDS_S)) },
            upperBound: { start: second(first.start + BOUNDS_S), end: second(last.end + BOUNDS_S) },
          })
        : measured(phraseRange, 'narration.segmentation', [pass, `sample:${snap}`], 0.9, {
            note: 'start moved onto the measured voice or onset edge; end from the recogniser',
            lowerBound: { start: phraseStart, end: second(Math.max(0, last.end - BOUNDS_S)) },
            upperBound: { start: phraseStart, end: second(last.end + BOUNDS_S) },
          }),
      wordIds: members.map((word) => word.id),
      pauseBefore: previousEnd === null ? unknown('narration.segmentation', 'The first phrase has no pause before it.') : estimated(round((first.start - previousEnd) * 1000, 0), 'narration.segmentation', [pass], 0.7, { unit: 'ms' }),
      pauseAfter: i < kept.length ? estimated(round((kept[i]!.start - last.end) * 1000, 0), 'narration.segmentation', [pass], 0.7, { unit: 'ms' }) : unknown('narration.segmentation', 'The last phrase has no pause after it.'),
    });
    if (i < kept.length) {
      pauses.push({
        id: `pause.${String(pauses.length + 1).padStart(3, '0')}`,
        range: estimated({ start: second(last.end), end: second(kept[i]!.start) }, 'narration.segmentation', [pass], 0.7),
        durationMs: round((kept[i]!.start - last.end) * 1000, 0),
      });
    }
    start = i;
  }

  // Sentences: the recogniser's segments, which it breaks at sentence ends.
  const sentences: NarrationIR['sentences'] = [];
  for (const segment of transcript.segments ?? []) {
    const inside = phrases.filter((phrase) => {
      const s = phrase.range.value!.start;
      return compareTime(s, second(segment.start - BOUNDS_S)) >= 0 && compareTime(s, second(segment.end)) < 0;
    });
    if (inside.length === 0) continue;
    const id = `sentence.${String(sentences.length + 1).padStart(3, '0')}`;
    sentences.push({
      id,
      text: segment.text.slice(0, 4000),
      range: estimated({ start: second(segment.start), end: second(segment.end) }, 'asr.alignment', [pass], 0.6),
      phraseIds: inside.map((phrase) => phrase.id),
    });
    for (const phrase of inside) for (const wordId of phrase.wordIds) {
      const word = words.find((candidate) => candidate.id === wordId);
      if (word) word.sentenceId = id;
    }
  }

  const confidence = transcript.segments && transcript.segments.length > 0
    ? mean(transcript.segments.map((segment) => Math.exp(Math.min(0, segment.averageLogProbability ?? -1))))
    : 0.6;
  const spoken = words.length >= 3;
  const narration: NarrationIR = {
    present: spoken
      ? measured(true, 'asr.transcript', [pass], round(confidence, 3), { note: `${words.length} words recognised${discarded ? `, ${discarded} discarded as heard over silence or non-speech` : ''}` })
      : estimated(false, 'asr.transcript', [pass], 0.6, { note: `${words.length} word(s) recognised after discarding ${discarded}` }),
    language: transcript.language ? measured(transcript.language, 'asr.transcript', [pass], round(confidence, 3)) : unknown('asr.transcript', 'The recogniser did not report a language.'),
    transcript: spoken ? measured(words.map((word) => word.text).join(' '), 'asr.transcript', [pass], round(confidence, 3)) : unknown('asr.transcript', 'No speech was recognised.'),
    speakers: [],
    sentences,
    phrases,
    words,
    pauses,
    agreement: { comparedWith: null, wordErrorRate: null, comparedWords: 0 },
  };
  return { narration, discarded };
}

/** Word error rate of `hypothesis` against `reference`: edits over reference words. */
export function wordErrorRate(reference: string, hypothesis: string): { wer: number; words: number } {
  const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);
  const a = norm(reference);
  const b = norm(hypothesis);
  if (a.length === 0) return { wer: b.length === 0 ? 0 : 1, words: 0 };
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    previous = current;
  }
  return { wer: previous[b.length]! / a.length, words: a.length };
}

function nearest(sorted: number[], target: number, radius: number): number | null {
  let best: number | null = null;
  for (const value of sorted) {
    if (Math.abs(value - target) <= radius && (best === null || Math.abs(value - target) < Math.abs(best - target))) best = value;
    if (value > target + radius) break;
  }
  return best;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function slope(values: number[], step: number): number {
  const n = values.length;
  const xs = values.map((_, i) => i * step);
  const mx = mean(xs);
  const my = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i]! - mx) * (values[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
