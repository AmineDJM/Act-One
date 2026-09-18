'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setAssetProjectsAction } from './actions.ts';
import styles from '../app.module.css';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg';
const PARALLEL = 3;

type Item = {
  key: string;
  file: File;
  status: 'queued' | 'uploading' | 'done' | 'failed';
  progress: number;
  error: string | null;
  assetId: string | null;
};

/**
 * The drop zone.
 *
 * Files start uploading the moment they land, several at a time, each on
 * its own request so one bad file never takes the batch with it. When the
 * batch is in, one question: which projects use these. Nothing else is
 * asked — the name is the filename and the category is inferred.
 */
export function LibraryUploader({ projects, defaultProjectIds }: { projects: { id: string; name: string }[]; defaultProjectIds: string[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const [ask, setAsk] = useState<{ ids: string[] } | null>(null);
  const [scope, setScope] = useState<'all' | 'some'>(defaultProjectIds.length > 0 ? 'some' : 'all');
  const [chosen, setChosen] = useState<Set<string>>(new Set(defaultProjectIds));
  const [pending, start] = useTransition();
  const running = useRef(0);
  const queue = useRef<Item[]>([]);

  const update = (key: string, patch: Partial<Item>) =>
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const pump = useCallback(() => {
    while (running.current < PARALLEL && queue.current.length > 0) {
      const item = queue.current.shift()!;
      running.current += 1;
      update(item.key, { status: 'uploading' });
      send(item.file, defaultProjectIds, (progress) => update(item.key, { progress }))
        .then((assetId) => update(item.key, { status: 'done', progress: 1, assetId }))
        .catch((error: Error) => update(item.key, { status: 'failed', error: error.message }))
        .finally(() => {
          running.current -= 1;
          if (queue.current.length > 0) pump();
          else if (running.current === 0) {
            setItems((current) => {
              const ids = current.filter((entry) => entry.status === 'done' && entry.assetId).map((entry) => entry.assetId!);
              if (ids.length > 0) setAsk({ ids });
              router.refresh();
              return current;
            });
          }
        });
    }
  }, [defaultProjectIds, router]);

  const add = (files: FileList | File[]) => {
    const fresh: Item[] = [...files].map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      status: 'queued',
      progress: 0,
      error: null,
      assetId: null,
    }));
    if (fresh.length === 0) return;
    setAsk(null);
    setItems((current) => [...current.filter((item) => item.status !== 'done'), ...fresh]);
    queue.current.push(...fresh);
    pump();
  };

  const apply = () => {
    if (!ask) return;
    const projectIds = scope === 'all' ? [] : [...chosen];
    start(async () => {
      await setAssetProjectsAction({ ids: ask.ids, projectIds });
      setAsk(null);
      setItems([]);
      router.refresh();
    });
  };

  const active = items.filter((item) => item.status !== 'done');
  const done = items.filter((item) => item.status === 'done').length;

  return (
    <section className={styles.uploader} id="upload">
      <div
        className={styles.dropzone}
        data-over={over || undefined}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          add(event.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            input.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Add pictures to the archive"
      >
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            if (event.target.files) add(event.target.files);
            event.target.value = '';
          }}
        />
        <span className={styles.dropPrompt}>
          <span aria-hidden="true">&gt;</span> DROP PICTURES HERE
        </span>
        <span className={styles.dropHint}>or choose files · PNG, JPG, WebP, SVG · any number, up to 25 MB each</span>
      </div>

      {active.length > 0 || (done > 0 && !ask) ? (
        <ul className={styles.queue} aria-live="polite">
          {items.map((item) => (
            <li key={item.key} className={styles.queueRow} data-status={item.status}>
              <span className={styles.queueName}>{item.file.name}</span>
              <span className={styles.queueSize}>{size(item.file.size)}</span>
              <span className={styles.queueState}>
                {item.status === 'queued' ? 'WAITING' : item.status === 'uploading' ? 'UPLOADING' : item.status === 'done' ? '✓ ADDED' : `✕ ${item.error ?? 'FAILED'}`}
              </span>
              <span className={styles.queueBar} aria-hidden="true">
                <span style={{ transform: `scaleX(${item.status === 'done' ? 1 : item.progress})` }} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {ask ? (
        <div className={styles.useIn} role="group" aria-label="Use in">
          <div className={styles.useInHead}>
            <span className="prompt" data-tone="text">
              <span className="prompt__chevron" aria-hidden="true">&gt;</span> {ask.ids.length} added · use in
            </span>
          </div>
          <div className={styles.useInBody}>
            <label className={styles.useInOption}>
              <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} />
              <span>
                <strong>All productions</strong>
                <span>Every production, now and later.</span>
              </span>
            </label>
            <label className={styles.useInOption}>
              <input type="radio" name="scope" checked={scope === 'some'} onChange={() => setScope('some')} disabled={projects.length === 0} />
              <span>
                <strong>Select productions</strong>
                <span>{projects.length === 0 ? 'No productions yet.' : 'Only the ones you tick.'}</span>
              </span>
            </label>
            {scope === 'some' ? (
              <div className={styles.useInProjects}>
                {projects.map((project) => (
                  <label key={project.id} className={styles.chip} data-on={chosen.has(project.id) || undefined}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={chosen.has(project.id)}
                      onChange={(event) => {
                        const next = new Set(chosen);
                        if (event.target.checked) next.add(project.id);
                        else next.delete(project.id);
                        setChosen(next);
                      }}
                    />
                    {project.name}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          <div className={styles.useInFoot}>
            <button type="button" className="btn" onClick={apply} disabled={pending || (scope === 'some' && chosen.size === 0)}>
              {pending ? 'Saving' : 'Done'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** One file, one request, with progress from the browser rather than a guess. */
function send(file: File, projectIds: string[], onProgress: (fraction: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.set('file', file, file.name);
    for (const id of projectIds) body.append('project', id);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/library/upload');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new Error('The upload did not go through.'));
    xhr.onload = () => {
      let payload: { asset?: { id: string }; error?: string } = {};
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        // A non-JSON body is a proxy or a crash; the status says enough.
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload.asset) resolve(payload.asset.id);
      else reject(new Error(payload.error ?? (xhr.status === 413 ? 'Too large.' : 'The upload was refused.')));
    };
    xhr.send(body);
  });
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
