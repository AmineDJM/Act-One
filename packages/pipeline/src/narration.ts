import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  adaptForSpeech,
  directionForTake,
  newId,
  type NarrationContext,
  type PronunciationRule,
  type QaFinding,
  type SpeechQuality,
  type TakeVariant,
  type VoiceDirection,
} from '@act-one/core';
import {
  judgeAudio,
  judgeLoudnessSpread,
  judgeTranscript,
  scoreFindings,
  shortenForTime,
  speedUpFor,
  timingFor,
  type NarrationFinding,
} from '@act-one/creative';
import type { SpeechProvider, SpeechRecognizer, SpeechResult, VoiceConsent, VoicePersona } from '@act-one/providers';
import { analyseVoice, levelVoice, type VoiceAnalysis } from '@act-one/sound';
import { storeAsset, type StageContext } from './context.ts';

/**
 * The narration engine.
 *
 * Content, then the spoken adaptation, then the direction, then the
 * performance, then QA, then the mix or the master. Every passage goes
 * through the same steps whichever engine reads it:
 *
 *  1. adapted for the ear, in its language, with the organisation's own
 *     pronunciations;
 *  2. fitted to its room: rewritten shorter when it would run long, and
 *     only then, mildly, hurried;
 *  3. performed, in one or more takes, with the lines around it so the
 *     piece is one read;
 *  4. listened back to — measured, and transcribed by a different ear
 *     than the one that spoke — and regenerated when what came out is not
 *     what went in;
 *  5. kept, in our own storage, with what it cost and who read it.
 */
export type NarrationPassage = {
  id: string;
  text: string;
  sceneId?: string | null;
  /** The time the line has, when it has one. */
  roomSeconds?: number | null;
  /** Where it sits in the piece, when it has a place. */
  atSeconds?: number | null;
};

export type NarrationOptions = {
  passages: NarrationPassage[];
  direction: VoiceDirection;
  quality: SpeechQuality;
  context: NarrationContext;
  workDir: string;
  /** Alternative reads per passage, 1 to 3. QA chooses; the customer can be shown the rest. */
  takes?: number;
  /** Regenerations of a passage whose read failed QA. */
  regenerations?: number;
  /** Listen back with the recogniser. Previews skip it; finals never do. */
  listenBack?: boolean;
  /** Keep the takes that were not chosen, so the customer can hear them. */
  keepTakes?: boolean;
  pronunciations?: PronunciationRule[];
  persona?: VoicePersona;
  /** A brand or cloned voice; the consent travels with it when it is a clone. */
  voiceId?: string | null;
  consent?: VoiceConsent | null;
  /** A short name for the log lines. */
  label?: string;
};

export type NarrationTrack = {
  passageId: string;
  sceneId: string | null;
  path: string;
  atSeconds: number;
  durationSeconds: number;
  /** Speech only: the read without the dead air at either end. */
  spokenSeconds: number;
  headSilenceSeconds: number;
  tailSilenceSeconds: number;
  assetId: string | null;
  take: TakeVariant;
  text: string;
  requestId: string | null;
  integratedLufs: number | null;
};

export type NarrationUsage = {
  characters: number;
  secondsSynthesised: number;
  costUsd: number;
  calls: number;
  failed: number;
  provider: string | null;
  model: string | null;
};

export type NarrationResult = {
  tracks: NarrationTrack[];
  issues: QaFinding[];
  usage: NarrationUsage;
  /** Passages that produced no usable audio at all. */
  failed: string[];
};

const TAKE_ORDER: TakeVariant[] = ['as_directed', 'restrained', 'warmer'];

type Take = {
  variant: TakeVariant;
  path: string;
  result: SpeechResult;
  analysis: VoiceAnalysis | null;
  findings: NarrationFinding[];
  score: number;
  seed: number;
  rate: number;
};

export async function narrate(context: StageContext, options: NarrationOptions): Promise<NarrationResult> {
  const speech = context.registry.speech(options.quality);
  const recognizer = options.listenBack ? context.registry.recognizer() : null;
  const takes = Math.max(1, Math.min(3, options.takes ?? 1));
  const regenerations = Math.max(0, Math.min(3, options.regenerations ?? 1));
  const label = options.label ?? 'narration';
  const persona = options.persona ?? 'narrator_neutral';
  const language = options.direction.language;
  const call = { organizationId: context.organizationId, projectId: context.project.id, signal: context.signal };

  const tracks: NarrationTrack[] = [];
  const issues: QaFinding[] = [];
  const failed: string[] = [];
  const usage: NarrationUsage = { characters: 0, secondsSynthesised: 0, costUsd: 0, calls: 0, failed: 0, provider: null, model: null };
  const previousRequestIds: string[] = [];

  // 1 and 2: the spoken adaptation, fitted to its room.
  const prepared: { passage: NarrationPassage; text: string; rate: number }[] = [];
  for (const passage of options.passages) {
    let text = adaptForSpeech(passage.text.trim(), { language, pronunciations: options.pronunciations ?? [] });
    let rate = 1;
    const plan = timingFor(text, passage.roomSeconds);
    if (!plan.fits && plan.targetWords) {
      const shortened = await shortenForTime(
        context.registry.llm(),
        { text: passage.text.trim(), language, targetWords: plan.targetWords, roomSeconds: plan.roomSeconds, context: options.context },
        call,
      );
      if (shortened.changed) {
        text = adaptForSpeech(shortened.text, { language, pronunciations: options.pronunciations ?? [] });
      }
      rate = speedUpFor(text, passage.roomSeconds);
    }
    prepared.push({ passage, text, rate });
  }

  // 3 and 4: performed, listened back to, regenerated where it failed.
  for (const [position, entry] of prepared.entries()) {
    const { passage, text } = entry;
    const continuity = {
      previousText: prepared[position - 1]?.text ?? null,
      nextText: prepared[position + 1]?.text ?? null,
      previousRequestIds: previousRequestIds.slice(-3),
    };
    const candidates: Take[] = [];
    const perform = async (variant: TakeVariant, seed: number, rate: number): Promise<Take | null> => {
      const direction = directionForTake(options.direction, variant);
      const request = {
        text,
        persona,
        direction,
        quality: options.quality,
        format: 'wav' as const,
        language,
        gender: direction.gender,
        continuity,
        seed,
        take: variant,
        ...(rate !== 1 ? { rate } : {}),
      };
      usage.calls += 1;
      let result: SpeechResult;
      try {
        result =
          options.voiceId && options.consent
            ? await speech.synthesizeWithVoice({ ...request, voiceId: options.voiceId }, options.consent, { ...call, sceneId: passage.sceneId ?? null })
            : await speech.synthesize({ ...request, ...(options.voiceId ? { voiceId: options.voiceId } : {}) }, { ...call, sceneId: passage.sceneId ?? null });
      } catch (error) {
        usage.failed += 1;
        console.error(`[${label}] ${passage.id} (${variant}) failed:`, (error as Error).message.slice(0, 200));
        return null;
      }
      usage.characters += result.characters ?? text.length;
      usage.costUsd += result.costUsd;
      usage.provider = speech.name;
      usage.model = result.model;

      const file = path.join(options.workDir, `vo-${safe(passage.id)}-${variant}-${seed.toString(36)}.wav`);
      await writeFile(file, result.audio);
      const analysis = await analyseVoice(file, { loudness: true, ...(context.signal ? { signal: context.signal } : {}) });
      const findings: NarrationFinding[] = analysis
        ? judgeAudio({ facts: analysis, roomSeconds: passage.roomSeconds ?? null, characters: text.length })
        : [];
      if (recognizer && analysis && !findings.some((finding) => finding.check === 'narration_truncated')) {
        try {
          const transcript = await recognizer.transcribe({ audio: result.audio, contentType: result.contentType, language }, { ...call, sceneId: passage.sceneId ?? null });
          findings.push(...judgeTranscript({ script: text, transcript, language }));
        } catch (error) {
          console.error(`[${label}] listening back to ${passage.id} failed:`, (error as Error).message.slice(0, 200));
        }
      }
      return { variant, path: file, result, analysis, findings, score: scoreFindings(findings), seed, rate };
    };

    for (let k = 0; k < takes; k += 1) {
      const take = await perform(TAKE_ORDER[k]!, seedFor(passage.id, k), entry.rate);
      if (take) candidates.push(take);
    }
    let best = choose(candidates, passage.roomSeconds ?? null);

    // A read that failed — the engine, or the QA — is read again, as directed,
    // with a fresh seed; hurried a little when it was the timing that failed.
    for (let attempt = 0; (!best || best.findings.some((finding) => finding.blocking)) && attempt < regenerations; attempt += 1) {
      const timing = best?.findings.find((finding) => finding.check === 'narration_timing' && finding.blocking);
      const rate = timing && passage.roomSeconds && best?.analysis
        ? Math.min(1.1, Math.max(entry.rate, (best.analysis.durationSeconds - best.analysis.headSilenceSeconds - best.analysis.tailSilenceSeconds) / passage.roomSeconds))
        : entry.rate;
      const again = await perform('as_directed', seedFor(passage.id, 10 + attempt), Math.round(rate * 100) / 100);
      if (again) candidates.push(again);
      best = choose(candidates, passage.roomSeconds ?? null);
    }

    if (!best || !best.analysis) {
      failed.push(passage.id);
      issues.push(issue(passage, 'missing_audio', 'soft_fail', `Passage ${position + 1} could not be read: the voice engine failed on every attempt.`, 'manual_review'));
      continue;
    }
    if (best.result.requestId) previousRequestIds.push(best.result.requestId);

    // 5: kept, with what it cost and who read it.
    const store = async (take: Take, selected: boolean): Promise<string | null> => {
      try {
        const stored = await storeAsset(context, {
          data: take.result.audio,
          kind: 'audio_voice',
          origin: 'generated',
          rights: 'our_license',
          extension: 'wav',
          contentType: take.result.contentType,
          sceneId: passage.sceneId ?? null,
          provider: speech.name,
          model: take.result.model,
          costUsd: take.result.costUsd,
          durationSeconds: take.analysis?.durationSeconds ?? null,
          metadata: {
            passageId: passage.id,
            text,
            take: take.variant,
            selected,
            seed: take.seed,
            rate: take.rate,
            voiceId: take.result.voiceId ?? null,
            language,
            locale: options.direction.locale,
            quality: options.quality,
            characters: take.result.characters ?? text.length,
            integratedLufs: take.analysis?.integratedLufs ?? null,
            peakDb: take.analysis?.peakDb ?? null,
            findings: take.findings.map((finding) => ({ check: finding.check, severity: finding.severity, message: finding.message })),
            requestId: take.result.requestId ?? null,
          },
        });
        return stored.asset.id;
      } catch (error) {
        console.error(`[${label}] storing ${passage.id} failed:`, (error as Error).message.slice(0, 200));
        return null;
      }
    };
    const assetId = await store(best, true);
    if (options.keepTakes) {
      for (const take of candidates) if (take !== best) await store(take, false);
    }

    usage.secondsSynthesised += best.analysis.durationSeconds;
    for (const finding of best.findings) {
      issues.push(issue(passage, finding.check, finding.severity, `Passage ${position + 1}: ${finding.message}`, finding.blocking ? 'regenerate_voice' : null));
    }
    tracks.push({
      passageId: passage.id,
      sceneId: passage.sceneId ?? null,
      path: best.path,
      atSeconds: passage.atSeconds ?? 0,
      durationSeconds: best.analysis.durationSeconds,
      spokenSeconds: Math.max(0, best.analysis.durationSeconds - best.analysis.headSilenceSeconds - best.analysis.tailSilenceSeconds),
      headSilenceSeconds: best.analysis.headSilenceSeconds,
      tailSilenceSeconds: best.analysis.tailSilenceSeconds,
      assetId,
      take: best.variant,
      text,
      requestId: best.result.requestId ?? null,
      integratedLufs: best.analysis.integratedLufs,
    });
  }

  // One voice, one level: passages are brought to the median before anything hears them together.
  const spread = judgeLoudnessSpread(tracks.map((track) => track.integratedLufs));
  if (spread) {
    issues.push(issue({ id: 'all', sceneId: null, atSeconds: tracks[0]?.atSeconds ?? null }, spread.check, spread.severity, spread.message, null));
  }
  await levelTracks(tracks, options.workDir, context.signal);

  return { tracks, issues, usage, failed };
}

/** The best take: fewest problems, then the one that lands closest to its room, then the one as directed. */
function choose(candidates: Take[], roomSeconds: number | null): Take | null {
  const usable = candidates.filter((take) => take.analysis);
  if (usable.length === 0) return null;
  return [...usable].sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (roomSeconds) {
      const fit = (take: Take) => Math.abs(spoken(take) - roomSeconds * 0.92);
      const difference = fit(a) - fit(b);
      if (Math.abs(difference) > 0.15) return difference;
    }
    return TAKE_ORDER.indexOf(a.variant) - TAKE_ORDER.indexOf(b.variant);
  })[0]!;
}

function spoken(take: Take): number {
  const analysis = take.analysis!;
  return Math.max(0, analysis.durationSeconds - analysis.headSilenceSeconds - analysis.tailSilenceSeconds);
}

async function levelTracks(tracks: NarrationTrack[], workDir: string, signal: AbortSignal | undefined): Promise<void> {
  const levels = tracks.map((track) => track.integratedLufs).filter((level): level is number => typeof level === 'number');
  if (levels.length < 2) return;
  const sorted = [...levels].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  for (const track of tracks) {
    if (track.integratedLufs === null) continue;
    const gain = median - track.integratedLufs;
    if (Math.abs(gain) < 1) continue;
    const target = path.join(workDir, `${path.basename(track.path, '.wav')}-levelled.wav`);
    try {
      await levelVoice(track.path, target, Math.max(-12, Math.min(12, gain)), { ...(signal ? { signal } : {}) });
      track.path = target;
      track.integratedLufs = median;
    } catch (error) {
      console.error(`[narration] levelling ${track.passageId} failed:`, (error as Error).message.slice(0, 200));
    }
  }
}

function issue(
  passage: { id: string; sceneId?: string | null; atSeconds?: number | null },
  check: QaFinding['check'],
  severity: QaFinding['severity'],
  message: string,
  repair: QaFinding['repair'],
): QaFinding {
  return {
    id: newId('evt'),
    sceneId: passage.sceneId ?? null,
    timecodeStart: passage.atSeconds ?? null,
    detectedBy: 'audio',
    evidenceAssetId: null,
    check,
    severity,
    message,
    confidence: 0.9,
    repair,
  };
}

/** A seed from the passage and the take, so the same passage reads the same way twice. */
export function seedFor(passageId: string, take: number): number {
  let hash = 2166136261;
  for (const char of `${passageId}:${take}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function safe(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
}

export type { SpeechProvider, SpeechRecognizer };
