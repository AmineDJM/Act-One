import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import {
  captionsFrom,
  newId,
  scoreSeconds,
  storyboardDuration,
  toWebVtt,
  type BrandSystem,
  type CaptionCue,
  type CreativeSystemId,
  type FilmScore,
  type ProductUnderstanding,
  type Storyboard,
} from '@act-one/core';
import { writeEffects, writeScore, type CueToDesign } from '@act-one/creative';
import type { PlacedCue, SoundDesign } from '@act-one/sound';
import type { StageContext } from '../context.ts';

/**
 * The score and the sound design, made for this film rather than found.
 *
 * Everything here is optional by construction. A deployment with no composer
 * configured plays the sound library and makes the same film it made
 * yesterday; one with a composer gets music that turns where the picture
 * turns and sounds built for the shot they are under. A failure anywhere in
 * here falls back to the library rather than failing the render — a film with
 * library music is a film, and a film that did not finish is not.
 */
export type ScoredSound = {
  /** Local file to use as the music bed, replacing the library track. */
  musicPath: string | null;
  /** Local files by cue id, replacing whatever the library offered. */
  effectPaths: Record<string, string>;
  /** What was composed, for the console and the credit. */
  score: FilmScore | null;
  /** What the score and the built sounds are expected to cost, in USD. */
  costUsd: number;
  notes: string[];
};

export const NO_SCORE: ScoredSound = { musicPath: null, effectPaths: {}, score: null, costUsd: 0, notes: [] };

/**
 * What a film's sound may still spend, kept as it is spent.
 *
 * Priced before each call, never after: a sound that would take the film over
 * its budget is not asked for, and the library plays in its place. The score
 * is asked for first because it is under every frame; the built sounds share
 * what it leaves.
 */
export class SoundBudget {
  private spentUsd = 0;
  private readonly limitUsd: number;

  constructor(limitUsd: number) {
    this.limitUsd = limitUsd;
  }

  get spent(): number {
    return this.spentUsd;
  }

  get left(): number {
    return Math.max(0, this.limitUsd - this.spentUsd);
  }

  allows(usd: number): boolean {
    return Number.isFinite(usd) && usd >= 0 && this.spentUsd + usd <= this.limitUsd + 1e-9;
  }

  spend(usd: number): void {
    this.spentUsd += Math.max(0, usd);
  }
}

export async function scoreFilm(
  context: StageContext,
  params: {
    storyboard: Storyboard;
    design: SoundDesign;
    brand: BrandSystem | null;
    understanding: ProductUnderstanding | null;
    creativeSystem: CreativeSystemId;
    workDir: string;
    aspect: string;
    hasVoiceOver: boolean;
    /** What the score and the built sounds may spend together, after the voice. */
    budgetUsd: number;
  },
): Promise<ScoredSound> {
  const composer = context.registry.composerOrNull();
  if (!composer) return NO_SCORE;

  const notes: string[] = [];
  const call = { organizationId: context.organizationId, projectId: context.project.id, ...(context.signal ? { signal: context.signal } : {}) };
  const total = storyboardDuration(params.storyboard);
  const budget = new SoundBudget(params.budgetUsd);

  let score: FilmScore | null = null;
  let musicPath: string | null = null;
  // Priced against the picture before a model is paid to write a score nobody can afford to play.
  if (!budget.allows(composer.musicPriceUsd(total))) {
    notes.push(`A score for ${total.toFixed(1)}s would cost more than the $${budget.left.toFixed(2)} left for this film's sound, so the library was played.`);
    const effectPaths = await buildEffects(context, params, notes, call, budget);
    return { musicPath, effectPaths, score, costUsd: budget.spent, notes };
  }
  try {
    await context.activity({ step: 'composition', kind: 'step', label: 'writing the score', status: 'active' });
    score = await writeScore(
      context.registry.llm(),
      {
        storyboard: params.storyboard,
        brand: params.brand,
        understanding: params.understanding,
        creativeSystem: params.creativeSystem,
        hasVoiceOver: params.hasVoiceOver,
        channel: params.aspect === '9:16' ? 'social' : 'web',
      },
      call,
    );
    const price = composer.musicPriceUsd(scoreSeconds(score));
    if (!budget.allows(price)) {
      throw new Error(`the score as written ($${price.toFixed(2)}) is over the $${budget.left.toFixed(2)} left for this film's sound`);
    }

    const composed = await composer.compose(
      {
        movements: score.movements.map((movement) => ({
          text: `[${movement.name}] ${movement.direction}`,
          durationMs: Math.round(movement.seconds * 1000),
          positiveStyles: movement.styles,
          negativeStyles: movement.avoid,
          adherence: movement.adherence,
        })),
        instrumental: true,
        seed: score.seed,
      },
      call,
    );

    budget.spend(composed.costUsd);
    musicPath = path.join(params.workDir, `score-${newId('ast').slice(-8)}.mp3`);
    await writeFile(musicPath, composed.audio);
    notes.push(
      `Scored for this film: ${score.movements.length} movement${score.movements.length === 1 ? '' : 's'}, ` +
        `${scoreSeconds(score).toFixed(1)}s against a ${total.toFixed(1)}s picture.`,
    );
    await context.activity({
      step: 'composition',
      kind: 'step',
      label: `scored in ${score.movements.length} movements`,
      detail: score.movements.map((movement) => movement.name).join(' → '),
      status: 'done',
    });
  } catch (error) {
    // The library is still there. Say so once, in the console's words.
    notes.push(`The score could not be composed, so the library was played: ${(error as Error).message.slice(0, 160)}`);
    musicPath = null;
    score = null;
  }

  const effectPaths = await buildEffects(context, params, notes, call, budget);
  return { musicPath, effectPaths, score, costUsd: budget.spent, notes };
}

/**
 * One sound per cue, built from what the shot does.
 *
 * Bounded three times: only the cues the film actually placed, only the kinds
 * where a built sound beats a library one, and only while the film's sound
 * budget lasts. The closing sting is built too: the library's is a house
 * sound synthesized from a score, not the brand's, and it is the last thing
 * a viewer hears. Music cues are the score's business.
 */
const DESIGNABLE = new Set(['impact', 'riser', 'sub_drop', 'whoosh', 'texture', 'ui_click', 'typing', 'logo_sting']);

async function buildEffects(
  context: StageContext,
  params: { storyboard: Storyboard; design: SoundDesign; creativeSystem: CreativeSystemId; brand: BrandSystem | null; workDir: string },
  notes: string[],
  call: { organizationId: string; projectId: string | null; signal?: AbortSignal },
  budget: SoundBudget,
): Promise<Record<string, string>> {
  const engine = context.registry.soundEffectsOrNull();
  if (!engine) return {};
  if (!budget.allows(engine.effectPriceUsd(0.5))) {
    notes.push(`Nothing was left of this film's sound budget to build sounds with, so the library was played.`);
    return {};
  }
  const designable = params.design.cues.filter((cue) => DESIGNABLE.has(cue.type));
  // The closing sting first: when the budget or the cap runs out, it runs out on a whoosh, not on the last sound of the film.
  const wanted = [
    ...designable.filter((cue) => cue.type === 'logo_sting'),
    ...designable.filter((cue) => cue.type !== 'logo_sting'),
  ].slice(0, 12);
  if (wanted.length === 0) return {};

  let briefs;
  try {
    briefs = await writeEffects(
      context.registry.llm(),
      {
        cues: wanted.map((cue): CueToDesign => ({
          id: cue.id,
          type: cue.type,
          atSeconds: cue.atSeconds,
          intensity: 0.6,
          sceneIntent: sceneAt(params.storyboard, cue),
        })),
        creativeSystem: params.creativeSystem,
        brandTone: params.brand?.tone ?? null,
      },
      call,
    );
  } catch (error) {
    notes.push(`The sound briefs could not be written, so the library was played: ${(error as Error).message.slice(0, 160)}`);
    return {};
  }

  const paths: Record<string, string> = {};
  let unaffordable = 0;
  const lasting = new Map(wanted.filter((cue) => cue.type === 'typing' && cue.durationSeconds).map((cue) => [cue.id, cue.durationSeconds!]));
  for (const written of briefs) {
    // Keystrokes run exactly as long as the typing they accompany, whatever length the brief proposed.
    const lasts = lasting.get(written.cueId);
    const brief = lasts ? { ...written, seconds: Math.min(22, Math.max(0.5, lasts)), loop: false } : written;
    if (!budget.allows(engine.effectPriceUsd(brief.seconds))) {
      unaffordable += 1;
      continue;
    }
    try {
      const built = await engine.effect(
        { brief: brief.brief, seconds: brief.seconds, influence: brief.influence, loop: brief.loop },
        call,
      );
      budget.spend(built.costUsd);
      const file = path.join(params.workDir, `sfx-${brief.cueId.slice(-8)}.mp3`);
      await writeFile(file, built.audio);
      paths[brief.cueId] = file;
    } catch {
      // One sound that would not build is one library sample played instead.
    }
  }
  if (Object.keys(paths).length > 0) {
    notes.push(`${Object.keys(paths).length} sound${Object.keys(paths).length === 1 ? '' : 's'} built for this film.`);
  }
  if (unaffordable > 0) {
    notes.push(`${unaffordable} sound${unaffordable === 1 ? ' was' : 's were'} left to the library: the film's sound budget was spent.`);
  }
  return paths;
}

function sceneAt(storyboard: Storyboard, cue: PlacedCue): string {
  let at = 0;
  for (const scene of storyboard.scenes) {
    const end = at + scene.duration;
    if (cue.atSeconds >= at - 0.01 && cue.atSeconds < end) return scene.purpose;
    at = end;
  }
  return storyboard.scenes.at(-1)?.purpose ?? 'the film';
}

/**
 * Captions from the recording itself.
 *
 * A caption track built from an estimated speaking rate drifts within a few
 * seconds and reads as sloppy. Alignment reads the audio against the script
 * we already have and says when each word was actually spoken.
 */
export async function captionsFor(
  context: StageContext,
  params: { audio: Uint8Array; text: string },
): Promise<{ cues: CaptionCue[]; vtt: string } | null> {
  const aligner = context.registry.alignerOrNull();
  if (!aligner || !params.text.trim() || params.audio.byteLength === 0) return null;
  try {
    const alignment = await aligner.align(params.audio, params.text, {
      organizationId: context.organizationId,
      projectId: context.project.id,
      ...(context.signal ? { signal: context.signal } : {}),
    });
    const cues = captionsFrom(alignment.words);
    return { cues, vtt: toWebVtt(cues) };
  } catch {
    return null;
  }
}
