import Link from 'next/link';
import { BenchmarkRetrieval, BenchmarkStatus, type Benchmark } from '@act-one/core';
import { MAX_BENCHMARK_BYTES, listBenchmarks } from '@/server/benchmarks.ts';
import { analyzeAllAction } from './actions.ts';
import { UploadBenchmarks } from './UploadBenchmarks.tsx';
import { bytes, duration, frameRate, percent, statusBadge, when } from './format.ts';
import adminStyles from '../admin.module.css';
import styles from './benchmarks.module.css';

export const dynamic = 'force-dynamic';

const PAGE = 50;

/**
 * The Benchmark Library.
 *
 * Every reference film Act One learns from, with what it is and how far its
 * reading got: the container's facts, each analysis's state, how much of its
 * FilmIR is known and how confidently, and whether the Creative Director may
 * retrieve it. Paged and filtered, because a library of five hundred films
 * must still open in a second.
 */
export default async function BenchmarksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const read = (key: string) => (typeof params[key] === 'string' ? (params[key] as string) : '');
  const status = BenchmarkStatus.safeParse(read('status'));
  const retrieval = BenchmarkRetrieval.safeParse(read('retrieval'));
  const search = read('q').slice(0, 120);
  const page = Math.max(1, Number.parseInt(read('page') || '1', 10) || 1);

  const { benchmarks, total, counts } = await listBenchmarks({
    ...(status.success ? { status: status.data } : {}),
    ...(retrieval.success ? { retrieval: retrieval.data } : {}),
    ...(search ? { search } : {}),
    limit: PAGE,
    offset: (page - 1) * PAGE,
  });
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const pages = Math.max(1, Math.ceil(total / PAGE));

  const href = (over: Record<string, string>) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ status: read('status'), retrieval: read('retrieval'), q: search, page: '', ...over })) {
      if (value) next.set(key, value);
    }
    const query = next.toString();
    return query ? `/admin/benchmarks?${query}` : '/admin/benchmarks';
  };
  const notice = read('notice');
  const error = read('error');

  return (
    <>
      <header className={adminStyles.head}>
        <h1>Benchmark library</h1>
        <p className="lede">
          Reference films, each read into a FilmIR: what can be measured, measured to the frame; what can only be interpreted, cited and marked as such.{' '}
          {all === 0 ? 'Nothing in the library yet.' : `${all} film${all === 1 ? '' : 's'}: ${BenchmarkStatus.options.filter((option) => counts[option]).map((option) => `${counts[option]} ${option}`).join(' · ')}.`}
        </p>
      </header>

      {notice ? <p className={styles.notice}>{notice}</p> : null}
      {error ? <p className={styles.notice} data-tone="error">{error}</p> : null}

      <UploadBenchmarks maxBytes={MAX_BENCHMARK_BYTES} />

      <div className={adminStyles.filterBar}>
        <nav className={adminStyles.windowTabs} aria-label="State">
          <Link href={href({ status: '' })} data-active={!status.success ? 'true' : 'false'}>
            All
          </Link>
          {BenchmarkStatus.options.map((option) => (
            <Link key={option} href={href({ status: option })} data-active={status.success && status.data === option ? 'true' : 'false'}>
              {option}
              {counts[option] ? ` ${counts[option]}` : ''}
            </Link>
          ))}
        </nav>
        <form method="get" className="row" style={{ gap: 'var(--space-2)' }}>
          {status.success ? <input type="hidden" name="status" value={status.data} /> : null}
          <select name="retrieval" className="input" defaultValue={retrieval.success ? retrieval.data : ''} aria-label="Retrieval">
            <option value="">Any retrieval</option>
            <option value="enabled">Retrievable</option>
            <option value="disabled">Disabled</option>
          </select>
          <input name="q" className="input" defaultValue={search} placeholder="Title or file" aria-label="Search" />
          <button type="submit" className="btn btn--secondary">
            Filter
          </button>
        </form>
        {counts['uploaded'] ? (
          <form action={analyzeAllAction}>
            <button type="submit" className="btn btn--secondary" title="Queue every film that has never been analysed">
              Analyse {counts['uploaded']} unanalysed
            </button>
          </form>
        ) : null}
      </div>

      {benchmarks.length === 0 ? (
        <p className={adminStyles.empty}>{all === 0 ? 'Upload a reference film to begin.' : 'No film matches.'}</p>
      ) : (
        <div className={adminStyles.tableWrap}>
          <table className={adminStyles.table}>
            <thead>
              <tr>
                <th>Film</th>
                <th>State</th>
                <th className={adminStyles.num}>Duration</th>
                <th>Picture</th>
                <th>Audio</th>
                <th>Deterministic</th>
                <th>Gemini</th>
                <th>FilmIR</th>
                <th className={adminStyles.num}>Warnings</th>
                <th className={adminStyles.num}>Known</th>
                <th className={adminStyles.num}>Confidence</th>
                <th>Version</th>
                <th>Last analysed</th>
                <th>Retrieval</th>
              </tr>
            </thead>
            <tbody>
              {benchmarks.map((benchmark) => (
                <Row key={benchmark.id} benchmark={benchmark} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
        <nav className={styles.pager} aria-label="Pages">
          {page > 1 ? <Link href={href({ page: String(page - 1) })}>← Newer</Link> : <span />}
          <span className="muted">
            Page {page} of {pages} · {total} film{total === 1 ? '' : 's'}
          </span>
          {page < pages ? <Link href={href({ page: String(page + 1) })}>Older →</Link> : <span />}
        </nav>
      ) : null}
    </>
  );
}

function Row({ benchmark }: { benchmark: Benchmark }) {
  const media = benchmark.media;
  const analysis = benchmark.analysis;
  const failed = analysis.failures.length;
  return (
    <tr>
      <td>
        <div className={styles.titleCell}>
          <Link href={`/admin/benchmarks/${benchmark.id}`}>{benchmark.title}</Link>
          <span className={styles.sub}>
            {benchmark.source.fileName} · {bytes(benchmark.source.bytes)}
          </span>
        </div>
      </td>
      <td>
        <span className={`badge ${statusBadge(benchmark.status)}`}>{benchmark.status}</span>
      </td>
      <td className={adminStyles.num}>{duration(media?.durationSeconds)}</td>
      <td className="mono">
        {media?.width ? `${media.width}×${media.height}` : '—'}
        <br />
        <span className={styles.sub}>
          {frameRate(media?.frameRate ?? null)}
          {media?.variableFrameRate ? ' · VFR' : media?.variableFrameRate === false ? ' · CFR' : ''}
          {media?.frameRateSource === 'declared' ? ' (declared)' : ''}
        </span>
      </td>
      <td className="mono">
        {media?.audio ? `${media.audio.codec} ${media.audio.sampleRate / 1000} kHz ×${media.audio.channels}` : media ? 'none' : '—'}
        {media?.audio?.integratedLufs !== null && media?.audio?.integratedLufs !== undefined ? (
          <>
            <br />
            <span className={styles.sub}>{media.audio.integratedLufs} LUFS</span>
          </>
        ) : null}
      </td>
      <td>
        <span className={`badge ${statusBadge(analysis.deterministic)}`}>{analysis.deterministic}</span>
      </td>
      <td>
        <span className={`badge ${statusBadge(analysis.gemini)}`}>{analysis.gemini}</span>
        {analysis.passesExpected ? <span className={styles.sub}> {analysis.passesCompleted}/{analysis.passesExpected}</span> : null}
      </td>
      <td>
        <span className={`badge ${statusBadge(analysis.filmIr)}`}>{analysis.filmIr}</span>
      </td>
      <td className={adminStyles.num} title={[...analysis.failures, ...analysis.warnings].join('\n')}>
        {analysis.warnings.length}
        {failed ? <span style={{ color: 'var(--danger)' }}> · {failed} failed</span> : null}
      </td>
      <td className={adminStyles.num}>{percent(analysis.knownShare)}</td>
      <td className={adminStyles.num}>{percent(analysis.meanConfidence)}</td>
      <td className={styles.sub} style={{ maxWidth: 200, whiteSpace: 'normal' }}>
        {analysis.version ?? '—'}
      </td>
      <td className="mono">{when(analysis.lastAnalyzedAt)}</td>
      <td>
        <span className={`badge ${benchmark.retrieval === 'enabled' ? 'badge--ok' : ''}`}>{benchmark.retrieval}</span>
      </td>
    </tr>
  );
}
