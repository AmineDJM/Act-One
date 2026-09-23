'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import styles from './benchmarks.module.css';

/**
 * Films into the library, one request each.
 *
 * Each film is sent as its own body — not a form — so the server can stream
 * it to disk, and one at a time, so a batch of reference films is a queue of
 * uploads with a bar each rather than one request a proxy cuts off at the
 * first gigabyte. The file's name and the operator's notes travel URI-encoded
 * in headers; the server decides what the file is from its bytes.
 */
type Row = { name: string; size: number; progress: number; state: 'waiting' | 'uploading' | 'done' | 'duplicate' | 'failed'; message?: string; id?: string };

export function UploadBenchmarks({ maxBytes }: { maxBytes: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState('');
  const [rights, setRights] = useState('');
  const [analyze, setAnalyze] = useState(false);

  const update = (index: number, patch: Partial<Row>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const send = (file: File, index: number) =>
    new Promise<void>((resolve) => {
      const request = new XMLHttpRequest();
      request.open('POST', '/api/admin/benchmarks');
      request.setRequestHeader('content-type', file.type || 'application/octet-stream');
      request.setRequestHeader('x-file-name', encodeURIComponent(file.name));
      if (origin.trim()) request.setRequestHeader('x-benchmark-origin', encodeURIComponent(origin.trim()));
      if (rights.trim()) request.setRequestHeader('x-benchmark-rights', encodeURIComponent(rights.trim()));
      if (analyze) request.setRequestHeader('x-benchmark-analyze', '1');
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) update(index, { progress: event.loaded / event.total });
      };
      request.onload = () => {
        let body: { id?: string; duplicate?: boolean; error?: string } = {};
        try {
          body = JSON.parse(request.responseText) as typeof body;
        } catch {
          // A proxy's HTML error page: the status says enough.
        }
        if (request.status === 201 || request.status === 200) {
          update(index, { state: body.duplicate ? 'duplicate' : 'done', progress: 1, ...(body.id ? { id: body.id } : {}), message: body.duplicate ? 'Already in the library' : analyze ? 'Uploaded and queued' : 'Uploaded' });
        } else {
          update(index, { state: 'failed', message: body.error ?? `HTTP ${request.status}` });
        }
        resolve();
      };
      request.onerror = () => {
        update(index, { state: 'failed', message: 'The connection dropped.' });
        resolve();
      };
      update(index, { state: 'uploading' });
      request.send(file);
    });

  const start = async () => {
    const files = [...(input.current?.files ?? [])];
    if (files.length === 0) return;
    const fresh: Row[] = files.map((file) => ({
      name: file.name,
      size: file.size,
      progress: 0,
      state: file.size > maxBytes ? 'failed' : 'waiting',
      ...(file.size > maxBytes ? { message: `Larger than ${Math.round(maxBytes / 1024 ** 3)} GB` } : {}),
    }));
    const offset = rows.length;
    setRows((current) => [...current, ...fresh]);
    setBusy(true);
    for (let i = 0; i < files.length; i += 1) {
      if (fresh[i]!.state === 'failed') continue;
      await send(files[i]!, offset + i);
    }
    setBusy(false);
    if (input.current) input.current.value = '';
    router.refresh();
  };

  return (
    <section className={styles.upload} aria-label="Upload films">
      <div className={styles.uploadFields}>
        <label className={styles.field}>
          <span>Films</span>
          <input ref={input} type="file" accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.m4v,.webm,.mkv" multiple className="input" disabled={busy} />
        </label>
        <label className={styles.field}>
          <span>Where they came from</span>
          <input className="input" value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="URL or note" maxLength={500} disabled={busy} />
        </label>
        <label className={styles.field}>
          <span>Rights</span>
          <input className="input" value={rights} onChange={(event) => setRights(event.target.value)} placeholder="Licence or permission" maxLength={500} disabled={busy} />
        </label>
      </div>
      <div className={styles.uploadActions}>
        <label className={styles.check}>
          <input type="checkbox" checked={analyze} onChange={(event) => setAnalyze(event.target.checked)} disabled={busy} /> Analyse on upload
        </label>
        <button type="button" className="btn" onClick={() => void start()} disabled={busy}>
          {busy ? 'Uploading…' : 'Upload'}
        </button>
      </div>
      {rows.length > 0 ? (
        <ul className={styles.uploadList}>
          {rows.map((row, index) => (
            <li key={`${row.name}-${index}`} data-state={row.state}>
              <span className={styles.uploadName}>{row.id ? <Link href={`/admin/benchmarks/${row.id}`}>{row.name}</Link> : row.name}</span>
              <span className={styles.uploadBar} aria-hidden="true">
                <span style={{ width: `${Math.round(row.progress * 100)}%` }} />
              </span>
              <span className={styles.uploadState}>{row.state === 'uploading' ? `${Math.round(row.progress * 100)}%` : row.message ?? row.state}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
