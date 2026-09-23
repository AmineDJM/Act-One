import { describe, expect, it } from 'vitest';
import { SampleClock } from '../compile/clock.ts';
import { buildNarration, wordErrorRate, type TranscriptInput } from '../narration/asr.ts';
import { toSeconds } from '../time.ts';
import { ASR_PRODUCER, syntheticReport } from './helpers.ts';

/**
 * A recogniser is one listener. Its words enter the narration only where the
 * analyzer measured a voice too; what it alone heard is withheld, not written.
 */
const report = syntheticReport();
const audio = report.audio!;
const samples = new SampleClock(audio.rate, audio.samples, audio.firstPts, audio.timebase);

const transcript = (words: [string, number, number][]): TranscriptInput => ({
  text: words.map(([word]) => word).join(' '),
  language: 'en',
  words: words.map(([word, start, end]) => ({ word, start, end })),
  segments: [{ start: words[0]![1], end: words[words.length - 1]![2], text: words.map(([word]) => word).join(' '), noSpeechProbability: 0.2, averageLogProbability: -0.3 }],
  model: 'whisper-1',
});

describe('buildNarration', () => {
  it('withholds words no measured voice activity overlaps: the recogniser alone heard them', () => {
    const built = buildNarration({ transcript: transcript([['Thanks', 2.1, 2.4], ['for', 2.4, 2.5], ['watching', 2.5, 2.9]]), audio, samples, producer: ASR_PRODUCER });
    expect(built.narration.words).toHaveLength(0);
    expect(built.narration.present).toMatchObject({ value: false });
    expect(built.withheld).toEqual([{ text: 'Thanks for watching', startSeconds: 2.1, endSeconds: 2.9, reason: expect.stringMatching(/heard only by the recogniser/) }]);
  });

  it('withholds a lone word the recogniser itself doubted, even where a voice-like sound was measured', () => {
    // The Plasma 5.25 benchmark's music outro: Whisper heard "You" and put the chance of no speech at 0.82.
    const voiced = { ...audio, voiceSpans: [{ startSample: Math.round(2.0 * audio.rate), endSample: Math.round(2.9 * audio.rate), meanProbability: 0.9 }] };
    const input = { ...transcript([['You', 2.1, 2.8]]), segments: [{ start: 2.1, end: 2.8, text: 'You', noSpeechProbability: 0.82, averageLogProbability: -0.91 }] };
    const built = buildNarration({ transcript: input, audio: voiced, samples, producer: ASR_PRODUCER });
    expect(built.narration.words).toEqual([]);
    expect(built.narration.phrases).toEqual([]);
    expect(built.narration.present).toMatchObject({ evidenceType: 'ESTIMATED', value: false });
    expect(built.narration.transcript.evidenceType).toBe('UNKNOWN');
    expect(built.withheld).toEqual([{ text: 'You', startSeconds: 2.1, endSeconds: 2.8, reason: expect.stringMatching(/only 1 word\(s\) in the whole film, and the recogniser itself put the chance of no speech at 0\.82/) }]);
  });

  it('keeps a short line the recogniser was sure of, where a voice was measured', () => {
    const voiced = { ...audio, voiceSpans: [{ startSample: Math.round(2.0 * audio.rate), endSample: Math.round(2.9 * audio.rate), meanProbability: 0.9 }] };
    const built = buildNarration({ transcript: transcript([['Plasma', 2.1, 2.8]]), audio: voiced, samples, producer: ASR_PRODUCER });
    expect(built.withheld).toEqual([]);
    expect(built.narration.words.map((word) => word.text)).toEqual(['Plasma']);
    expect(built.narration.present).toMatchObject({ evidenceType: 'MEASURED', value: true });
    expect(built.narration.transcript.value).toBe('Plasma');
  });

  it('keeps a phrase a voice was measured in, and moves its start onto the measured onset', () => {
    const voiced = { ...audio, voiceSpans: [{ startSample: Math.round(2.2 * audio.rate), endSample: Math.round(2.7 * audio.rate), meanProbability: 0.8 }] };
    const built = buildNarration({ transcript: transcript([['The', 2.02, 2.2], ['new', 2.2, 2.45], ['feature', 2.45, 2.9]]), audio: voiced, samples, producer: ASR_PRODUCER });
    expect(built.withheld).toEqual([]);
    expect(built.narration.words.map((word) => word.text)).toEqual(['The', 'new', 'feature']);
    const [phrase] = built.narration.phrases;
    // 20 ms from the onset measured at 1.9992 s: the phrase starts on that sample.
    expect(phrase!.range.evidenceType).toBe('MEASURED');
    expect(Math.abs(toSeconds(phrase!.range.value!.start) - 1.9992)).toBeLessThan(0.001);
    // Word times are the recogniser's alignment: estimated, with its ±80 ms.
    const first = built.narration.words[0]!;
    expect(first.range.evidenceType).toBe('ESTIMATED');
    expect(toSeconds(first.range.value!.start) - toSeconds(first.range.lowerBound!.start)).toBeCloseTo(0.08, 3);
  });

  it('discards words inside measured silence and counts them', () => {
    const voiced = { ...audio, voiceSpans: [{ startSample: 0, endSample: audio.samples, meanProbability: 0.8 }] };
    const built = buildNarration({ transcript: transcript([['quiet', 1.2, 1.4], ['hello', 2.1, 2.5]]), audio: voiced, samples, producer: ASR_PRODUCER });
    expect(built.discarded).toBe(1);
    expect(built.narration.words.map((word) => word.text)).toEqual(['hello']);
  });

  it('never reports prosody it could not measure', () => {
    const voiced = { ...audio, voiceSpans: [{ startSample: Math.round(2.1 * audio.rate), endSample: Math.round(2.5 * audio.rate), meanProbability: 0.8 }] };
    const built = buildNarration({ transcript: transcript([['tone', 2.1, 2.5]]), audio: voiced, samples, producer: ASR_PRODUCER });
    // The 880 Hz tone is above the pitch tracker's range: no pitch, and not a guessed one.
    expect(built.narration.words[0]!.pitchHz).toMatchObject({ evidenceType: 'UNKNOWN', value: null });
    expect(built.narration.words[0]!.energyDb.evidenceType).toBe('ESTIMATED');
  });
});

describe('wordErrorRate', () => {
  it('counts edits against the reference, ignoring case and punctuation', () => {
    expect(wordErrorRate('Every team, every launch.', 'every team every launch')).toEqual({ wer: 0, words: 4 });
    expect(wordErrorRate('one two three four', 'one too three')).toEqual({ wer: 0.5, words: 4 });
    expect(wordErrorRate('', 'anything')).toEqual({ wer: 1, words: 0 });
  });
});
