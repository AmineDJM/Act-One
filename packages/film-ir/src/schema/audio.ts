import { z } from 'zod';
import {
  EvidencedBoolean,
  EvidencedNumber,
  EvidencedRange,
  EvidencedString,
  Provenance,
  RationalTime,
  Ref,
  Series,
  TimeRange,
  evidenced,
} from './primitives.ts';

/**
 * The sound, as signal and as meaning.
 *
 * Signal first: curves and events measured from the decoded samples, their
 * times on the sample clock. There is no source-separation model in this
 * analysis, so voice, music and effects are probabilities estimated from the
 * spectrum, never separated stems, and the document says so.
 */
export const AudioEventKind = z.enum([
  'onset',
  'transient',
  'silence',
  'loudness_peak',
  'beat',
  'downbeat',
  'section_boundary',
  'riser',
  'hit',
  'voice_start',
  'voice_end',
]);

export const AudioEvent = z.object({
  id: z.string(),
  kind: AudioEventKind,
  at: RationalTime,
  range: TimeRange.nullable().default(null),
  magnitude: z.number().nullable().default(null),
  unit: z.string().max(40).default(''),
  provenance: Provenance,
});
export type AudioEvent = z.infer<typeof AudioEvent>;

export const AudioIR = z.object({
  present: z.boolean(),
  streamRef: Ref.nullable(),
  analysis: z.object({
    sampleRate: z.number().int().positive(),
    channels: z.number().int().positive(),
    mixdown: z.string().max(200),
    hop: RationalTime,
    window: RationalTime,
    analyzedSamples: z.number().int().nonnegative(),
  }).nullable(),
  loudness: z.object({
    integratedLufs: EvidencedNumber,
    loudnessRangeLu: EvidencedNumber,
    truePeakDbtp: EvidencedNumber,
    samplePeakDbfs: EvidencedNumber,
  }).nullable(),
  series: z.array(Series),
  events: z.array(AudioEvent),
  separation: z.object({
    performed: z.boolean(),
    method: z.string().nullable(),
    note: z.string().max(600),
  }),
});
export type AudioIR = z.infer<typeof AudioIR>;

export const Word = z.object({
  id: z.string().regex(/^word\.[0-9]{4}$/),
  text: z.string().max(120),
  range: EvidencedRange,
  confidence: z.number().min(0).max(1).nullable(),
  energyDb: EvidencedNumber,
  pitchHz: EvidencedNumber,
  pitchSlopeHzPerSecond: EvidencedNumber,
  /** How much this word stands out from its phrase, 0..1, from loudness, pitch and length. */
  emphasis: EvidencedNumber,
  phraseId: z.string().nullable(),
  sentenceId: z.string().nullable(),
});
export type Word = z.infer<typeof Word>;

export const Phrase = z.object({
  id: z.string(),
  text: z.string().max(2000),
  range: EvidencedRange,
  wordIds: z.array(z.string()),
  pauseBefore: EvidencedNumber,
  pauseAfter: EvidencedNumber,
});
export type Phrase = z.infer<typeof Phrase>;

export const Sentence = z.object({
  id: z.string(),
  text: z.string().max(4000),
  range: EvidencedRange,
  phraseIds: z.array(z.string()),
});

export const Pause = z.object({ id: z.string(), range: EvidencedRange, durationMs: z.number().nonnegative() });

export const NarrationIR = z.object({
  present: EvidencedBoolean,
  language: EvidencedString,
  transcript: EvidencedString,
  speakers: z.array(z.object({ id: z.string(), description: EvidencedString })),
  sentences: z.array(Sentence),
  phrases: z.array(Phrase),
  words: z.array(Word),
  pauses: z.array(Pause),
  /** How two independent listeners agreed on the words. */
  agreement: z.object({
    comparedWith: z.string().nullable(),
    wordErrorRate: z.number().min(0).nullable(),
    comparedWords: z.number().int().nonnegative(),
  }),
});
export type NarrationIR = z.infer<typeof NarrationIR>;

export const MusicIR = z.object({
  present: EvidencedBoolean,
  tempoBpm: EvidencedNumber,
  meter: EvidencedString,
  key: EvidencedString,
  beats: z.object({ times: z.array(RationalTime), provenance: Provenance }),
  downbeats: z.object({ times: z.array(RationalTime), provenance: Provenance }),
  sections: z.array(z.object({ id: z.string(), range: TimeRange, label: EvidencedString, provenance: Provenance })),
  ducking: z.array(
    z.object({
      id: z.string(),
      range: TimeRange,
      depthDb: EvidencedNumber,
      underRefs: z.array(Ref),
    }),
  ),
  description: EvidencedString,
});
export type MusicIR = z.infer<typeof MusicIR>;

export const SfxEvent = z.object({
  id: z.string(),
  at: RationalTime,
  range: TimeRange,
  label: EvidencedString,
  onsetStrength: z.number().nullable(),
  spectralCentroidHz: z.number().nullable(),
  eventRef: Ref.nullable(),
  provenance: Provenance,
});
export type SfxEvent = z.infer<typeof SfxEvent>;

export const AudioBridge = z.object({
  id: z.string(),
  boundaryId: z.string(),
  kind: evidenced(z.enum(['j_cut', 'l_cut', 'sustain_across', 'riser_into', 'hit_on_cut', 'silence_on_cut', 'none'])),
  range: TimeRange,
});

export const SoundIR = z.object({
  music: MusicIR,
  sfx: z.array(SfxEvent),
  ambience: z.object({ present: EvidencedBoolean, description: EvidencedString }),
  silences: z.array(z.object({ id: z.string(), range: TimeRange, levelDbfs: z.number(), provenance: Provenance })),
  bridges: z.array(AudioBridge),
});
export type SoundIR = z.infer<typeof SoundIR>;
