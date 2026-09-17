'use client';

import { useActionState } from 'react';
import type { Storyboard } from '@act-one/core';
import { previewTimingAction, reviseStoryboardAction, type FormState } from '../../actions.ts';
import styles from './storyboard.module.css';

/**
 * The storyboard, and the way you change it.
 *
 * Revisions are a sentence, not a form. "Revision Round 2" is an agency's
 * internal accounting, and exposing it to a customer turns an edit into a
 * negotiation.
 */
const SUGGESTIONS = [
  'The opening is too slow.',
  'Use less text.',
  'Remove the voice-over.',
  'Make it more cinematic.',
  'Use only real product assets.',
];

export function StoryboardPanel({
  projectId,
  storyboard,
  animaticAssetId,
  animaticPosterAssetId,
  animaticProgress,
}: {
  projectId: string;
  storyboard: Storyboard;
  /** The last preview of this exact storyboard, if one has been built. */
  animaticAssetId: string | null;
  animaticPosterAssetId: string | null;
  /** Set while a preview is being built, so it reports where it was asked for. */
  animaticProgress: number | null;
}) {
  const [state, revise, pending] = useActionState<FormState, FormData>(reviseStoryboardAction, {
    error: null,
  });
  const [previewState, preview, previewing] = useActionState<FormState, FormData>(
    previewTimingAction,
    { error: null },
  );

  return (
    <>
      <ol className={styles.timeline}>
        {storyboard.scenes.map((scene) => (
          <li key={scene.id} className={styles.scene} data-status={scene.status}>
            <div className={styles.sceneHead}>
              <span className={styles.sceneIndex}>{String(scene.index + 1).padStart(2, '0')}</span>
              <span className={styles.sceneType}>{scene.visualType.replace(/_/g, ' ')}</span>
              <span className={styles.sceneTime}>{scene.duration.toFixed(1)}s</span>
            </div>

            <div className={styles.sceneBody}>
              {scene.onScreenText.length > 0 ? (
                <p className={styles.sceneText}>{scene.onScreenText.join(' / ')}</p>
              ) : (
                <p className={styles.scenePurpose}>{scene.purpose}</p>
              )}
              {scene.narration ? <p className={styles.sceneVo}>“{scene.narration}”</p> : null}
            </div>

            <div className={styles.sceneFoot}>
              <span className={styles.sceneMeta}>{scene.motionRecipe.name.replace(/_/g, ' ')}</span>
              {scene.assetRefs.length > 0 ? (
                <span className={styles.sceneMeta}>{scene.assetRefs.length} assets</span>
              ) : null}
              {scene.claimEvidenceIds.length > 0 ? (
                <span className={styles.sceneCited} title="This scene states a sourced claim">
                  cited
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <form action={revise} className={styles.revise}>
        <input type="hidden" name="projectId" value={projectId} />
        <label htmlFor="instruction" className="eyebrow">
          Change something
        </label>
        <textarea
          id="instruction"
          name="instruction"
          className="input"
          placeholder="Tell us what to change, the way you would tell a person."
          rows={2}
        />
        <div className={styles.suggestions}>
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className={styles.suggestion}
              onClick={(event) => {
                const form = event.currentTarget.closest('form');
                const field = form?.querySelector<HTMLTextAreaElement>('#instruction');
                if (field) {
                  field.value = suggestion;
                  field.focus();
                }
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 'var(--space-3)' }}>
          <button className="btn" type="submit" disabled={pending}>
            {pending ? 'Applying…' : 'Apply'}
          </button>
          {/*
            * Its own form, because it is not a revision: previewing the cut
            * costs nothing and changes nothing, and nesting it in the revision
            * form would submit the instruction along with it.
            */}
          <button className="btn btn--secondary" type="submit" form="preview-timing" disabled={previewing}>
            {previewing ? 'Building…' : 'Preview the cut'}
          </button>
          <span className="hint">Only the scenes this affects are re-rendered.</span>
        </div>
        {state.message ? (
          <p className="secondary" style={{ fontSize: '0.88rem' }} role="status">
            {state.message}
          </p>
        ) : null}
        {state.error ? (
          <p style={{ color: 'var(--danger)', fontSize: '0.88rem' }} role="alert">
            {state.error}
          </p>
        ) : null}
      </form>

      <form action={preview} id="preview-timing">
        <input type="hidden" name="projectId" value={projectId} />
      </form>

      {/*
        * The preview reports here rather than over the whole project: a timing
        * preview is a side errand, and taking the page over for it would tell a
        * customer their film was being made when it is not.
        */}
      {animaticProgress === null ? null : (
        <p className="secondary" style={{ fontSize: '0.88rem' }} role="status">
          Building a preview of the cut — {Math.round(animaticProgress * 100)}%. Refresh to see it.
        </p>
      )}
      {animaticProgress === null && previewState.message ? (
        <p className="secondary" style={{ fontSize: '0.88rem' }} role="status">
          {previewState.message}
        </p>
      ) : null}
      {previewState.error ? (
        <p style={{ color: 'var(--danger)', fontSize: '0.88rem' }} role="alert">
          {previewState.error}
        </p>
      ) : null}

      {/*
        * The animatic. Rough by design — no vision QA, no repair pass, preview
        * resolution — and labelled as such, because a customer who mistakes it
        * for the film will judge the film on it.
        */}
      {animaticAssetId ? (
        <figure className={styles.animatic}>
          <video
            className={styles.animaticPlayer}
            src={`/api/assets/${animaticAssetId}`}
            {...(animaticPosterAssetId ? { poster: `/api/assets/${animaticPosterAssetId}` } : {})}
            controls
            playsInline
            preload="metadata"
          />
          <figcaption>
            Timing preview of version {storyboard.version} — rough resolution, no grade. The film
            is rendered at full quality.
          </figcaption>
        </figure>
      ) : null}
    </>
  );
}
