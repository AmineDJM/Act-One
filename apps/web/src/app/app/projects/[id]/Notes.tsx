'use client';

import { useActionState, useState } from 'react';
import { postCommentAction, resolveCommentAction, type FormState } from '../../actions.ts';
import styles from '../../app.module.css';

export type NoteView = {
  id: string;
  body: string;
  atSeconds: number | null;
  authorName: string;
  createdAt: string;
  resolvedAt: string | null;
};

/**
 * Notes on the project.
 *
 * The reviewer role promises people they can comment, so this is what makes
 * that true. Deliberately one thread on the project rather than a comment
 * system with threads, mentions and notifications: the useful version of this
 * is three people agreeing on a change before it costs a render, and that fits
 * in a list.
 *
 * A note can carry a timestamp, because "the cut at 0:14 is too fast" and "the
 * cut is too fast" are different notes and only one can be acted on without
 * watching the film again.
 */
export function Notes({
  projectId,
  notes,
  canComment,
  filmSeconds,
}: {
  projectId: string;
  notes: NoteView[];
  canComment: boolean;
  filmSeconds: number | null;
}) {
  const [postState, post, posting] = useActionState<FormState, FormData>(postCommentAction, {
    error: null,
  });
  const [resolveState, resolve] = useActionState<FormState, FormData>(resolveCommentAction, {
    error: null,
  });
  const [showResolved, setShowResolved] = useState(false);

  const open = notes.filter((note) => !note.resolvedAt);
  const resolved = notes.filter((note) => note.resolvedAt);
  const shown = showResolved ? notes : open;
  const error = postState.error ?? resolveState.error;

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <h3>Notes</h3>
        {resolved.length > 0 ? (
          <button className="btn btn--ghost" type="button" onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? 'Hide resolved' : `${resolved.length} resolved`}
          </button>
        ) : (
          <span className="badge">{open.length}</span>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="hint">
          Notes for the edit. Anyone on the team can leave one — &ldquo;the opening holds too
          long&rdquo;, &ldquo;lead with the dashboard&rdquo; — and the next revision is made
          against them. Before the master exists, it is the cheapest place to disagree; once
          there is a film, a note can point at a moment of it.
        </p>
      ) : (
        <ol className={styles.noteList}>
          {shown.map((note) => (
            <li key={note.id} data-resolved={Boolean(note.resolvedAt)}>
              <div className={styles.noteHead}>
                <strong>{note.authorName}</strong>
                {note.atSeconds !== null ? (
                  <span className={styles.cite}>{formatTime(note.atSeconds)}</span>
                ) : null}
                <time dateTime={note.createdAt}>
                  {new Date(note.createdAt).toLocaleDateString()}
                </time>
                {canComment && !note.resolvedAt ? (
                  <form action={resolve}>
                    <input type="hidden" name="commentId" value={note.id} />
                    <input type="hidden" name="projectId" value={projectId} />
                    <button className="btn btn--ghost" type="submit">
                      Resolve
                    </button>
                  </form>
                ) : null}
              </div>
              <p>{note.body}</p>
            </li>
          ))}
        </ol>
      )}

      {canComment ? (
        <form action={post} className={styles.noteForm}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="target" value="project" />
          <input type="hidden" name="targetId" value={projectId} />

          <textarea
            name="body"
            className="input"
            rows={2}
            required
            placeholder="The opening holds too long. Everything after the turn is right."
          />

          <div className={styles.noteActions}>
            {filmSeconds !== null ? (
              <label className="hint">
                At
                <input
                  name="atSeconds"
                  className="input"
                  type="number"
                  min={0}
                  max={Math.ceil(filmSeconds)}
                  step={1}
                  placeholder="s"
                />
              </label>
            ) : null}
            <button className="btn" type="submit" disabled={posting}>
              {posting ? 'Posting…' : 'Post note'}
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: '0.88rem' }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}

function formatTime(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
