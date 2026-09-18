'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { PRODUCT_NAME, pieceLabel, type Storyboard } from '@act-one/core';
import {
  confirmRevisionAction,
  declineRevisionAction,
  previewTimingAction,
  reviseStoryboardAction,
  type FormState,
} from '../../actions.ts';
import styles from './storyboard.module.css';

/**
 * The storyboard, and the way you change it.
 *
 * Revisions are a conversation, not a form. The customer writes a sentence;
 * we answer with what we understood and what we would do; nothing changes
 * until they say so. "Revision Round 2" is an agency's internal accounting,
 * and exposing it to a customer turns an edit into a negotiation — the
 * count is shown once, quietly, against their plan.
 */
export type RevisionExchange = {
  id: string;
  instruction: string;
  reply: string;
  status: 'proposed' | 'confirmed' | 'applied' | 'declined';
  rerender: boolean;
  authorName: string;
  createdAt: string;
};
const PRODUCT_TYPES = new Set(['product_ui', 'product_ui_3d', 'screenshot_motion']);

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
  revisions,
  exchanges,
}: {
  projectId: string;
  storyboard: Storyboard;
  /** The last preview of this exact storyboard, if one has been built. */
  animaticAssetId: string | null;
  animaticPosterAssetId: string | null;
  /** Set while a preview is being built, so it reports where it was asked for. */
  animaticProgress: number | null;
  /** Revisions this project has had against what the plan includes; -1 is unlimited. */
  revisions: { used: number; limit: number; reason: string };
  /** The conversation so far, oldest first. */
  exchanges: RevisionExchange[];
}) {
  const exhausted = revisions.limit >= 0 && revisions.used >= revisions.limit;
  const [confirmState, confirm, confirming] = useActionState<FormState, FormData>(
    confirmRevisionAction,
    {
      error: null,
    },
  );
  const [declineState, decline, declining] = useActionState<FormState, FormData>(
    declineRevisionAction,
    {
      error: null,
    },
  );
  const pendingProposal = exchanges.find((exchange) => exchange.status === 'proposed') ?? null;
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

            {/* The capture this scene is built on — the founder sees what the
                product beat will show before a frame is rendered, instead of
                a count of "assets". Product scenes only: a statistic that
                cites a moment draws a figure, not the capture. */}
            {scene.assetRefs[0] && PRODUCT_TYPES.has(scene.visualType) ? (
              <img
                className={styles.sceneThumb}
                src={`/api/assets/${scene.assetRefs[0]}`}
                alt=""
                loading="lazy"
              />
            ) : null}

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

      <section className={styles.revise}>
        <span className="eyebrow">Change something</span>

        {exchanges.length > 0 ? (
          <ol className={styles.thread}>
            {exchanges.map((exchange) => (
              <li key={exchange.id} className={styles.exchange} data-status={exchange.status}>
                <p className={styles.said}>
                  <strong>{exchange.authorName}</strong>
                  {exchange.instruction}
                </p>
                {exchange.reply ? (
                  <p className={styles.answered}>
                    <strong>{PRODUCT_NAME}</strong>
                    {exchange.reply}
                  </p>
                ) : null}
                {exchange.status === 'proposed' ? (
                  <div className={styles.decide}>
                    <form action={confirm}>
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="requestId" value={exchange.id} />
                      <button
                        className="btn"
                        type="submit"
                        disabled={confirming || declining || exhausted}
                      >
                        {confirming
                          ? 'Starting…'
                          : exchange.rerender
                            ? 'Yes, apply it and re-render the film'
                            : 'Yes, apply it'}
                      </button>
                    </form>
                    <form action={decline}>
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="requestId" value={exchange.id} />
                      <button
                        className="btn btn--secondary"
                        type="submit"
                        disabled={confirming || declining}
                      >
                        Not that
                      </button>
                    </form>
                  </div>
                ) : (
                  <span className={styles.outcome}>
                    {exchange.status === 'applied'
                      ? 'Applied'
                      : exchange.status === 'confirmed'
                        ? 'Applying…'
                        : 'Set aside'}
                  </span>
                )}
              </li>
            ))}
          </ol>
        ) : null}

        <form action={revise} className={styles.ask}>
          <input type="hidden" name="projectId" value={projectId} />
          <textarea
            id="instruction"
            name="instruction"
            className="input"
            placeholder={
              pendingProposal
                ? 'Or say it differently — a new sentence sets the proposal above aside.'
                : 'Tell us what to change, the way you would tell a person.'
            }
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
            <button className="btn" type="submit" disabled={pending || exhausted}>
              {pending ? 'Reading…' : 'Send'}
            </button>
            {/*
             * Its own form, because it is not a revision: previewing the cut
             * costs nothing and changes nothing, and nesting it in the revision
             * form would submit the instruction along with it.
             */}
            <button
              className="btn btn--secondary"
              type="submit"
              form="preview-timing"
              disabled={previewing}
            >
              {previewing ? 'Building…' : 'Preview the cut'}
            </button>
            <span className="hint">
              {revisions.limit < 0
                ? 'Unlimited revisions on your plan. Nothing changes until you confirm.'
                : `${revisions.used} of ${revisions.limit} revision${revisions.limit === 1 ? '' : 's'} used on your plan. Nothing changes until you confirm.`}
            </span>
          </div>
          {exhausted ? (
            <p className="secondary" style={{ fontSize: '0.88rem' }} role="status">
              {revisions.reason}{' '}
              <Link href="/app/billing" style={{ color: 'var(--accent-text)' }}>
                See plans →
              </Link>
            </p>
          ) : null}
          {(confirmState.message ?? declineState.message) ? (
            <p className="secondary" style={{ fontSize: '0.88rem' }} role="status">
              {confirmState.message ?? declineState.message}
            </p>
          ) : null}
          {(state.error ?? confirmState.error ?? declineState.error) ? (
            <p style={{ color: 'var(--danger)', fontSize: '0.88rem' }} role="alert">
              {state.error ?? confirmState.error ?? declineState.error}
            </p>
          ) : null}
        </form>
      </section>

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
            <span className="mono muted">{pieceLabel('workprint')}</span> · storyboard {storyboard.version}, timed.
            Rough resolution, no grade: the master is produced at full quality.
          </figcaption>
        </figure>
      ) : null}
    </>
  );
}
