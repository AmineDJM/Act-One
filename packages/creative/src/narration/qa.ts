import { adaptForSpeech, type QaCheck } from '@act-one/core';
import type { QaSeverity } from '@act-one/core';

/** How much each level counts against a take when takes are compared. */
const SEVERITY_WEIGHT: Record<QaSeverity, number> = {
  info: 1,
  warning: 1,
  soft_fail: 10,
  hard_fail: 50,
  critical_fail: 100,
};

/**
 * Voice QA: the recording is listened back to and compared with the script.
 *
 * A finding names what a listener would notice: the wrong language, a
 * figure that was not said, an ending that was cut off, a pause where none
 * was written, a read that runs past its room, clipping. Blocking findings
 * regenerate the passage; the rest are reported with the film.
 */
export type NarrationFinding = {
  check: Extract<
    QaCheck,
    | 'narration_language'
    | 'narration_accuracy'
    | 'narration_timing'
    | 'narration_pause'
    | 'narration_truncated'
    | 'narration_loudness'
    | 'audio_clipping'
  >;
  severity: QaSeverity;
  message: string;
  /** Regenerate the passage rather than ship it. */
  blocking: boolean;
};

export type TranscriptLike = {
  text: string;
  language: string | null;
  languageConfidence: number | null;
  durationSeconds: number | null;
  words: { word: string; start: number; end: number }[];
};

export type VoiceAudioFacts = {
  durationSeconds: number;
  /** Sample peak, dBFS. */
  peakDb: number;
  integratedLufs: number | null;
  headSilenceSeconds: number;
  tailSilenceSeconds: number;
  /** Silences inside the read, after the head and before the tail. */
  silences: { start: number; end: number }[];
};

/** Diacritics stay; punctuation, case and audio tags go. */
export function tokensForCompare(text: string, language: string | null): string[] {
  const spoken = language ? adaptForSpeech(text, { language }) : text;
  return spoken
    .replace(/\[[^\]]{1,40}\]/g, ' ')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Word error rate: edits to turn what was heard into what was written, over the script's length. */
export function wordErrorRate(reference: string[], hypothesis: string[]): number {
  if (reference.length === 0) return hypothesis.length === 0 ? 0 : 1;
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, j) => j);
  for (let i = 1; i <= reference.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= hypothesis.length; j += 1) {
      const cost = reference[i - 1] === hypothesis[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[hypothesis.length]! / reference.length;
}

const WER_MINOR = 0.18;
const WER_MAJOR = 0.35;
const PAUSE_MINOR = 1.4;
const PAUSE_MAJOR = 2.5;

export function judgeTranscript(params: {
  script: string;
  transcript: TranscriptLike;
  language: string | null;
}): NarrationFinding[] {
  const findings: NarrationFinding[] = [];
  const expected = params.language?.toLowerCase().slice(0, 2) ?? null;
  const heard = params.transcript.language?.toLowerCase().slice(0, 2) ?? null;
  const confidence = params.transcript.languageConfidence ?? 1;
  if (expected && heard && heard !== expected && confidence >= 0.6) {
    findings.push({
      check: 'narration_language',
      severity: 'hard_fail',
      message: `The passage was read in ${heard}, not ${expected}.`,
      blocking: true,
    });
  }

  const reference = tokensForCompare(params.script, expected);
  const hypothesis = tokensForCompare(params.transcript.text, heard ?? expected);
  const wer = wordErrorRate(reference, hypothesis);
  if (wer >= WER_MAJOR) {
    findings.push({
      check: 'narration_accuracy',
      severity: 'soft_fail',
      message: `What was heard differs from the script in ${Math.round(wer * 100)}% of the words.`,
      blocking: true,
    });
  } else if (wer >= WER_MINOR) {
    findings.push({
      check: 'narration_accuracy',
      severity: 'warning',
      message: `What was heard differs from the script in ${Math.round(wer * 100)}% of the words.`,
      blocking: false,
    });
  }

  // Figures are checked on their own: a mis-heard "and" is nothing; a dropped "twelve" is a wrong claim.
  if (wer < WER_MAJOR) {
    const figures = tokensForCompare(params.script, expected).filter((token) => /^\p{N}+$/u.test(token));
    const scriptNumbers = numberWords(params.script, expected);
    const heardTokens = new Set(hypothesis);
    const missing = [...scriptNumbers, ...figures].filter((word) => !heardTokens.has(word));
    if (missing.length > 0) {
      findings.push({
        check: 'narration_accuracy',
        severity: 'soft_fail',
        message: `A figure was not heard as written: ${[...new Set(missing)].slice(0, 4).join(', ')}.`,
        blocking: true,
      });
    }

    const lastWritten = reference.slice(-2);
    const lastHeard = new Set(hypothesis.slice(-5));
    if (reference.length >= 3 && lastWritten.length > 0 && !lastWritten.some((word) => lastHeard.has(word))) {
      findings.push({
        check: 'narration_truncated',
        severity: 'soft_fail',
        message: `The ending was not heard: "…${lastWritten.join(' ')}".`,
        blocking: true,
      });
    }
  }

  const words = params.transcript.words;
  for (let i = 1; i < words.length; i += 1) {
    const gap = words[i]!.start - words[i - 1]!.end;
    if (gap >= PAUSE_MINOR) {
      findings.push({
        check: 'narration_pause',
        severity: gap >= PAUSE_MAJOR ? 'soft_fail' : 'warning',
        message: `A ${gap.toFixed(1)}s pause after "${words[i - 1]!.word}" that the script does not have.`,
        blocking: gap >= PAUSE_MAJOR,
      });
      break;
    }
  }
  return findings;
}

/** The spelled-out figures of the script, so "12" is looked for as "twelve" in what was heard. */
function numberWords(script: string, language: string | null): string[] {
  if (!language) return [];
  const raw = script.match(/\d[\d.,]*/g) ?? [];
  const words: string[] = [];
  for (const figure of raw) {
    const spoken = tokensForCompare(figure, language).filter((token) => !/^\p{N}+$/u.test(token));
    // The first word of the figure is enough to know it was said: "twelve" of "twelve point five".
    if (spoken[0]) words.push(spoken[0]);
  }
  return words;
}

export function judgeAudio(params: {
  facts: VoiceAudioFacts;
  roomSeconds: number | null;
  characters: number;
}): NarrationFinding[] {
  const findings: NarrationFinding[] = [];
  const { facts } = params;
  if (facts.peakDb > -0.3) {
    findings.push({
      check: 'audio_clipping',
      severity: 'soft_fail',
      message: `The recording peaks at ${facts.peakDb.toFixed(1)} dBFS: it clips.`,
      blocking: true,
    });
  }
  const spoken = Math.max(0, facts.durationSeconds - facts.headSilenceSeconds - facts.tailSilenceSeconds);
  // Fifteen characters a second is faster than anybody reads; shorter than that, the read stopped early.
  if (params.characters >= 40 && spoken < params.characters / 22) {
    findings.push({
      check: 'narration_truncated',
      severity: 'soft_fail',
      message: `${spoken.toFixed(1)}s of speech for ${params.characters} characters: the read stopped early.`,
      blocking: true,
    });
  }
  if (params.roomSeconds && spoken > params.roomSeconds + 0.25) {
    const over = spoken / params.roomSeconds - 1;
    findings.push({
      check: 'narration_timing',
      severity: over > 0.1 ? 'soft_fail' : 'warning',
      message: `The read runs ${spoken.toFixed(1)}s in a ${params.roomSeconds.toFixed(1)}s scene.`,
      blocking: over > 0.1,
    });
  }
  const longest = facts.silences.reduce((max, s) => Math.max(max, s.end - s.start), 0);
  if (longest >= PAUSE_MINOR) {
    findings.push({
      check: 'narration_pause',
      severity: longest >= PAUSE_MAJOR ? 'soft_fail' : 'warning',
      message: `A ${longest.toFixed(1)}s silence inside the read.`,
      blocking: longest >= PAUSE_MAJOR,
    });
  }
  return findings;
}

/** Lower is better: blocking findings dominate, then the rest. */
export function scoreFindings(findings: NarrationFinding[]): number {
  return findings.reduce(
    (score, finding) => score + (finding.blocking ? 100 : 0) + SEVERITY_WEIGHT[finding.severity],
    0,
  );
}

/** Across the passages of one piece: a voice that changes level between lines is heard as an edit. */
export function judgeLoudnessSpread(levels: (number | null)[]): NarrationFinding | null {
  const known = levels.filter((level): level is number => typeof level === 'number' && Number.isFinite(level));
  if (known.length < 2) return null;
  const spread = Math.max(...known) - Math.min(...known);
  if (spread <= 3) return null;
  return {
    check: 'narration_loudness',
    severity: spread > 6 ? 'soft_fail' : 'warning',
    message: `The passages differ by ${spread.toFixed(1)} LU before levelling.`,
    blocking: false,
  };
}
