import {
  MATERIAL_BACKED_RECIPES,
  carriesPicture,
  pictureShare,
  storyboardDuration,
  type RenderKind,
  type Scene,
  type Storyboard,
} from '@act-one/core';
import type { UnresolvedAsset } from './context.ts';

/**
 * What a render is allowed to be incomplete about.
 *
 * A preview may be missing things: that is what it is for. A master may not.
 * The distinction existed in the codebase already — `RenderKind` says whether
 * this is the film, a channel cut or a timing animatic, and only the first two
 * are ever delivered — but it was recorded rather than enforced. Both went
 * through the same composition with the same behaviour, and that behaviour was
 * to draw the scene's line of copy whenever its picture was not there.
 *
 * So the mode is derived from the kind, once, and the gate below reads it.
 */
export type RenderMode = 'preview' | 'master';

export function renderModeFor(kind: RenderKind): RenderMode {
  return kind === 'animatic' ? 'preview' : 'master';
}

/**
 * What each shot is, once the material has been looked for.
 *
 * `typographic_by_intent` is the distinction the whole file exists to make.
 * Typography is a real visual language and plenty of excellent films are
 * mostly type — but that has to be a decision somebody made, recorded in the
 * storyboard as the shot's visual type, and not what a shot becomes because
 * its capture could not be found. The two produce identical frames and mean
 * opposite things, and nothing in this pipeline could previously tell them
 * apart.
 */
export type ShotState =
  /** The director asked for a picture and the picture is there. */
  | 'ready'
  /** The director asked for words, a lockup or a pause. Nothing is missing. */
  | 'typographic_by_intent'
  /** The director asked for a picture and there is none. */
  | 'asset_missing';

export type ShotReadiness = {
  sceneId: string;
  /** One-based, as an operator counts shots. */
  number: number;
  visualType: Scene['visualType'];
  recipe: Scene['motionRecipe']['name'];
  state: ShotState;
  wanted: readonly string[];
  resolved: readonly string[];
  missing: readonly UnresolvedAsset[];
};

/** What the film actually got, counted. The manifest, not a guess from pixels. */
export type VisualCoverage = {
  shots: number;
  shotsRequiringMaterial: number;
  shotsWithMaterial: number;
  typographicByIntent: number;
  unresolved: number;
  /**
   * Share of runtime the plan meant to carry a picture, 0..1.
   *
   * What the director asked for. Read straight off the storyboard, so it says
   * nothing at all about whether the pictures arrived.
   */
  plannedPictureShare: number;
  /**
   * Share of runtime that will actually carry one, 0..1.
   *
   * The two used to be the same number, and that is the whole bug in one
   * line: a film planned as 73% product interface and delivered as 0% of it
   * reported 73% either way, because nobody had measured the second thing.
   */
  pictureShare: number;
};

export type BlockerCode =
  | 'asset_missing'
  | 'no_picture'
  | 'audio_missing'
  | 'audio_silent';

export type ReadinessBlocker = {
  code: BlockerCode;
  sceneId: string | null;
  /** One-based shot number, when the blocker belongs to a shot. */
  number: number | null;
  message: string;
};

export type MasterReadiness = {
  mode: RenderMode;
  ready: boolean;
  coverage: VisualCoverage;
  blockers: ReadinessBlocker[];
  shots: ShotReadiness[];
};

/**
 * Does this shot need something handed to it?
 *
 * The union of two independent facts, because either one alone has a hole in
 * it. The visual type is the director's declaration of what the shot is; the
 * motion recipe is what the renderer will actually reach for. A plan where
 * they disagree is a plan with a bug in it, and the safe reading of a
 * disagreement is that the shot needs material.
 */
export function needsMaterial(scene: Pick<Scene, 'visualType' | 'motionRecipe'>): boolean {
  return carriesPicture(scene.visualType) || MATERIAL_BACKED_RECIPES.includes(scene.motionRecipe.name);
}

/**
 * The picture, shot by shot, against what actually resolved.
 *
 * Takes the urls the renderer is about to be given rather than the storyboard's
 * hopes. That distinction is the whole point: a production ran with every
 * asset row present in the database and every object absent from the storage
 * the worker could see, so a check of the plan said the film was fine and the
 * film was thirty seconds of title cards.
 */
export function visualReadiness(params: {
  storyboard: Storyboard;
  mode: RenderMode;
  /** Asset ids that resolved to a url something is actually behind. */
  resolved: ReadonlySet<string>;
  /** Everything that was asked for and could not be produced, with the reason. */
  missing: readonly UnresolvedAsset[];
}): MasterReadiness {
  const missingById = new Map(params.missing.map((entry) => [entry.id, entry] as const));

  const shots: ShotReadiness[] = params.storyboard.scenes.map((scene) => {
    const resolved = scene.assetRefs.filter((id) => params.resolved.has(id));
    const missing = scene.assetRefs
      .filter((id) => !params.resolved.has(id))
      .map(
        (id) => missingById.get(id) ?? { id, reason: 'object_missing' as const, storageKey: '' },
      );
    const state: ShotState = !needsMaterial(scene)
      ? 'typographic_by_intent'
      : resolved.length > 0
        ? 'ready'
        : 'asset_missing';
    return {
      sceneId: scene.id,
      number: scene.index + 1,
      visualType: scene.visualType,
      recipe: scene.motionRecipe.name,
      state,
      wanted: [...scene.assetRefs],
      resolved,
      missing,
    };
  });

  const total = storyboardDuration(params.storyboard) || 1;
  const byId = new Map(params.storyboard.scenes.map((scene) => [scene.id, scene] as const));
  const delivered = shots.reduce((sum, shot) => {
    const scene = byId.get(shot.sceneId);
    if (!scene || shot.state !== 'ready' || !carriesPicture(scene.visualType)) return sum;
    return sum + scene.duration * (scene.visualType === 'mixed_media' ? 0.5 : 1);
  }, 0);

  const coverage: VisualCoverage = {
    shots: shots.length,
    shotsRequiringMaterial: shots.filter((shot) => shot.state !== 'typographic_by_intent').length,
    shotsWithMaterial: shots.filter((shot) => shot.state === 'ready').length,
    typographicByIntent: shots.filter((shot) => shot.state === 'typographic_by_intent').length,
    unresolved: shots.filter((shot) => shot.state === 'asset_missing').length,
    plannedPictureShare: pictureShare(params.storyboard),
    pictureShare: delivered / total,
  };

  const blockers: ReadinessBlocker[] = [];
  if (params.mode === 'master') {
    for (const shot of shots) {
      if (shot.state !== 'asset_missing') continue;
      const first = shot.missing[0];
      blockers.push({
        code: 'asset_missing',
        sceneId: shot.sceneId,
        number: shot.number,
        message:
          `Shot ${shot.number} is planned as ${shot.visualType.replace(/_/g, ' ')} and has no ` +
          `material: ${describeMissing(shot)}${first && first.storageKey ? ` (${first.storageKey})` : ''}.`,
      });
    }

    /*
     * And the whole-film version of the same question, which no per-shot check
     * can ask: a plan made entirely of title cards has no missing asset in it
     * anywhere, because it never asked for one. That is a legitimate film when
     * a director chose it and a failure of every upstream stage when nobody
     * did — and the two are told apart one level up, by whether the plan's own
     * shots were ever meant to carry a picture. Here we only refuse to deliver
     * a film that shows nothing at all while claiming to be a product film.
     */
    if (coverage.shots > 0 && coverage.pictureShare <= 0 && coverage.shotsRequiringMaterial > 0) {
      blockers.push({
        code: 'no_picture',
        sceneId: null,
        number: null,
        message:
          `${coverage.shotsRequiringMaterial} of ${coverage.shots} shots were planned around a ` +
          `picture — ${(coverage.plannedPictureShare * 100).toFixed(0)}% of the runtime — and not ` +
          `one of them has one; the whole ${storyboardDuration(params.storyboard).toFixed(1)}s ` +
          `would render as type on the canvas.`,
      });
    }
  }

  return { mode: params.mode, ready: blockers.length === 0, coverage, blockers, shots };
}

function describeMissing(shot: ShotReadiness): string {
  if (shot.wanted.length === 0) return 'nothing was ever attached to it';
  const gone = shot.missing.filter((entry) => entry.reason === 'object_missing').length;
  const absent = shot.missing.filter((entry) => entry.reason === 'no_such_asset').length;
  const parts: string[] = [];
  if (gone > 0) parts.push(`${gone} asset(s) recorded but not in storage`);
  if (absent > 0) parts.push(`${absent} asset(s) referenced but never created`);
  return parts.join(', ') || 'nothing resolved';
}

/**
 * One line an operator can read, for the production timeline.
 *
 * Deliberately not customer-facing. What the person who paid is told while
 * this is being worked out lives in the render stage, in the words of the
 * work rather than the words of the checker.
 */
export function summariseCoverage(coverage: VisualCoverage): string {
  return (
    `${coverage.shotsWithMaterial}/${coverage.shotsRequiringMaterial} shots with material · ` +
    `${coverage.typographicByIntent} typographic by intent · ` +
    `${coverage.unresolved} unresolved · ` +
    `${(coverage.pictureShare * 100).toFixed(0)}% picture of ` +
    `${(coverage.plannedPictureShare * 100).toFixed(0)}% planned`
  );
}
