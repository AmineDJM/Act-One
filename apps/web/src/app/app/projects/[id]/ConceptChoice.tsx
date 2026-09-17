'use client';

import { useActionState } from 'react';
import type { Concept } from '@act-one/core';
import { chooseConceptAction, regenerateConceptsAction, type FormState } from '../../actions.ts';
import styles from '../../app.module.css';

export function ConceptChoice({ projectId, concepts }: { projectId: string; concepts: Concept[] }) {
  const [chooseState, choose, choosing] = useActionState<FormState, FormData>(chooseConceptAction, {
    error: null,
  });
  const [regenState, regenerate, regenerating] = useActionState<FormState, FormData>(
    regenerateConceptsAction,
    { error: null },
  );

  const message = chooseState.message ?? regenState.message;
  const error = chooseState.error ?? regenState.error;

  return (
    <>
      <div className={styles.concepts}>
        {concepts.map((concept) => (
          <article key={concept.id} className={styles.concept} data-selected={concept.selected}>
            <div className={styles.conceptTop}>
              <h3 className={styles.conceptName}>{concept.name}</h3>
              <p className={styles.conceptIdea}>{concept.keyIdea}</p>
              <p className={styles.conceptHook}>{concept.hook}</p>
              <ul className={styles.beats}>
                {concept.keyScenes.map((scene, index) => (
                  <li key={scene}>
                    <span className={styles.beatIndex}>{String(index + 1).padStart(2, '0')}</span>
                    {scene}
                  </li>
                ))}
              </ul>
            </div>
            <div className={styles.conceptFoot}>
              <span className={styles.conceptMeta}>
                {concept.estimatedDurationSeconds}s · {concept.creativeSystem.replace(/_/g, ' ')}
              </span>
              <form action={choose}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="conceptId" value={concept.id} />
                <button
                  className={concept.selected ? 'btn btn--secondary' : 'btn'}
                  type="submit"
                  disabled={choosing}
                >
                  {concept.selected ? 'Chosen' : 'Create this'}
                </button>
              </form>
            </div>
          </article>
        ))}
      </div>

      <div className="row" style={{ gap: 'var(--space-4)', marginTop: 'var(--space-5)', flexWrap: 'wrap' }}>
        <form action={regenerate}>
          <input type="hidden" name="projectId" value={projectId} />
          <button className="btn btn--secondary" type="submit" disabled={regenerating}>
            {regenerating ? 'Thinking…' : 'Try three new directions'}
          </button>
        </form>
        {message ? (
          <span className="secondary" style={{ fontSize: '0.88rem' }} role="status">
            {message}
          </span>
        ) : null}
        {error ? (
          <span style={{ color: 'var(--danger)', fontSize: '0.88rem' }} role="alert">
            {error}
          </span>
        ) : null}
      </div>
    </>
  );
}
