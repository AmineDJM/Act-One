import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BENCHMARK_STAGES, BENCHMARK_STAGE_LABELS, benchmarkBusy, benchmarkRetrievable } from '@act-one/core';
import { getBenchmark, readFilmIr, readValidation } from '@/server/benchmarks.ts';
import { analyzeBenchmarkAction, deleteBenchmarkAction, setRetrievalAction, updateBenchmarkAction } from '../actions.ts';
import { bytes, duration, frameRate, percent, statusBadge, when } from '../format.ts';
import {
  AudioView,
  CameraView,
  EventsView,
  EvidenceMix,
  FindingsView,
  InterpretationView,
  NarrationView,
  OverviewView,
  ReconstructionView,
  TimelineView,
  TransitionsView,
  TypographyView,
  ValidationView,
  WindowView,
} from './inspector.tsx';
import adminStyles from '../../admin.module.css';
import styles from '../benchmarks.module.css';

export const dynamic = 'force-dynamic';

const VIEWS = [
  ['timeline', 'Timeline'],
  ['overview', 'Overview & DNA'],
  ['typography', 'Typography'],
  ['camera', 'Camera'],
  ['audio', 'Sound'],
  ['narration', 'Narration'],
  ['transitions', 'Transitions'],
  ['events', 'AV events'],
  ['interpretation', 'Interpretation'],
  ['reconstruction', 'Reconstruction'],
  ['findings', 'Uncertainties'],
  ['validation', 'Validation'],
  ['window', 'Frame by frame'],
] as const;

/**
 * One reference film: what it is, how far its reading got, and the reading
 * itself, view by view, with the film beside it.
 */
export default async function BenchmarkPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const read = (key: string) => (typeof query[key] === 'string' ? (query[key] as string) : '');
  const benchmark = await getBenchmark(id);
  if (!benchmark) notFound();

  const view = (VIEWS.find(([key]) => key === read('view'))?.[0] ?? 'timeline') as (typeof VIEWS)[number][0];
  const [document, validation] = await Promise.all([readFilmIr(benchmark), readValidation(benchmark)]);
  const media = benchmark.media;
  const analysis = benchmark.analysis;
  const busy = benchmarkBusy(benchmark);
  const anyFailed = BENCHMARK_STAGES.some((stage) => benchmark.stages[stage].status === 'failed');
  const here = `/admin/benchmarks/${id}`;
  const windowStart = Number.parseFloat(read('start') || '0') || 0;
  const windowEnd = Number.parseFloat(read('end') || '') || windowStart + 2;

  return (
    <>
      <p className="muted" style={{ fontSize: '0.84rem' }}>
        <Link href="/admin/benchmarks">Benchmark library</Link> / {benchmark.id}
      </p>
      <header className={adminStyles.head}>
        <h1>{benchmark.title}</h1>
        <p className="row" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <span className={`badge ${statusBadge(benchmark.status)}`}>{benchmark.status}</span>
          <span className={`badge ${benchmarkRetrievable(benchmark) ? 'badge--ok' : ''}`}>{benchmarkRetrievable(benchmark) ? 'retrievable' : benchmark.retrieval === 'disabled' ? 'retrieval disabled' : 'not retrievable yet'}</span>
          {analysis.version ? <span className="muted mono" style={{ fontSize: '0.78rem' }}>{analysis.version}</span> : null}
        </p>
      </header>

      {read('notice') ? <p className={styles.notice}>{read('notice')}</p> : null}
      {read('error') ? <p className={styles.notice} data-tone="error">{read('error')}</p> : null}

      <div className={styles.actions} style={{ marginBottom: 'var(--space-6)' }}>
        {!analysis.runId ? (
          <form action={analyzeBenchmarkAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="mode" value="new" />
            <button className="btn" disabled={busy}>Analyse</button>
          </form>
        ) : null}
        {analysis.runId && anyFailed ? (
          <form action={analyzeBenchmarkAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="mode" value="resume" />
            <button className="btn" disabled={busy} title="Run again from the first stage without a checkpoint">Retry failed stage</button>
          </form>
        ) : null}
        {analysis.runId ? (
          <form action={analyzeBenchmarkAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="mode" value="new" />
            <button className="btn btn--secondary" disabled={busy} title="A fresh run; the current FilmIR stays until the new one is complete">Re-analyse</button>
          </form>
        ) : null}
        {analysis.filmIrKey ? (
          <>
            <a className="btn btn--secondary" href={`/api/admin/benchmarks/${id}/film-ir`}>Download FilmIR</a>
            <a className="btn btn--secondary" href={`/api/admin/benchmarks/${id}/film-ir?part=validation`}>Download validation</a>
          </>
        ) : null}
        <form action={setRetrievalAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="retrieval" value={benchmark.retrieval === 'enabled' ? 'disabled' : 'enabled'} />
          <button className="btn btn--secondary">{benchmark.retrieval === 'enabled' ? 'Disable from retrieval' : 'Enable retrieval'}</button>
        </form>
        <details>
          <summary className="btn btn--secondary">Delete…</summary>
          <form action={deleteBenchmarkAction} className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            <input type="hidden" name="id" value={id} />
            <input name="confirm" className="input" placeholder='Type "delete"' aria-label="Confirm deletion" />
            <button className="btn">Delete the film and its FilmIR</button>
          </form>
        </details>
      </div>

      <section className={adminStyles.section}>
        <h2>The film</h2>
        <dl className={adminStyles.facts}>
          <div><dt>File</dt><dd>{benchmark.source.fileName} · {bytes(benchmark.source.bytes)} · {benchmark.source.container.toUpperCase()}</dd></div>
          <div><dt>SHA-256</dt><dd className="mono" style={{ overflowWrap: 'anywhere' }}>{benchmark.source.sha256}</dd></div>
          <div><dt>Uploaded</dt><dd>{when(benchmark.source.uploadedAt)}</dd></div>
          <div><dt>Duration</dt><dd>{duration(media?.durationSeconds)}</dd></div>
          <div><dt>Picture</dt><dd>{media?.width ? `${media.width}×${media.height} · ${media.videoCodec}` : '—'}</dd></div>
          <div><dt>Frame rate</dt><dd>{frameRate(media?.frameRate ?? null)}{media?.frameRateSource ? ` (${media.frameRateSource})` : ''}{media?.variableFrameRate ? ' · variable' : media?.variableFrameRate === false ? ' · constant' : ''}{media?.frameCount ? ` · ${media.frameCount} frames` : ''}</dd></div>
          <div><dt>Audio</dt><dd>{media?.audio ? `${media.audio.codec} · ${media.audio.sampleRate} Hz · ${media.audio.channels} ch${media.audio.integratedLufs !== null ? ` · ${media.audio.integratedLufs} LUFS` : ''}${media.audio.truePeakDbtp !== null ? ` · peak ${media.audio.truePeakDbtp} dBTP` : ''}` : media ? 'none' : '—'}</dd></div>
          <div><dt>Container</dt><dd>{media?.container ?? '—'}</dd></div>
          <div><dt>Origin</dt><dd>{benchmark.source.origin ?? '—'}</dd></div>
          <div><dt>Rights</dt><dd>{benchmark.source.rights ?? '—'}</dd></div>
        </dl>
      </section>

      <section className={adminStyles.section}>
        <h2>Analysis</h2>
        <ol className={styles.stages}>
          {BENCHMARK_STAGES.map((stage) => {
            const state = benchmark.stages[stage];
            const took = state.startedAt && state.finishedAt ? (Date.parse(state.finishedAt) - Date.parse(state.startedAt)) / 1000 : null;
            return (
              <li key={stage}>
                <span>{BENCHMARK_STAGE_LABELS[stage]}</span>
                <span><span className={`badge ${statusBadge(state.status)}`}>{state.status}</span></span>
                <span className="mono">{state.attempts ? `×${state.attempts}` : ''}</span>
                <span className="mono">{took !== null ? `${took < 60 ? took.toFixed(1) + ' s' : (took / 60).toFixed(1) + ' min'}` : ''}</span>
                <span className={styles.stageDetail}>{state.detail ?? ''}</span>
              </li>
            );
          })}
        </ol>
        <dl className={adminStyles.facts}>
          <div><dt>Deterministic</dt><dd><span className={`badge ${statusBadge(analysis.deterministic)}`}>{analysis.deterministic}</span></dd></div>
          <div><dt>Gemini</dt><dd><span className={`badge ${statusBadge(analysis.gemini)}`}>{analysis.gemini}</span>{analysis.passesExpected ? ` ${analysis.passesCompleted}/${analysis.passesExpected} passes` : ''}</dd></div>
          <div><dt>FilmIR</dt><dd><span className={`badge ${statusBadge(analysis.filmIr)}`}>{analysis.filmIr}</span>{analysis.filmIrBytes ? ` · ${bytes(analysis.filmIrBytes)}` : ''}</dd></div>
          <div><dt>Known</dt><dd>{percent(analysis.knownShare)} of evidenced values</dd></div>
          <div><dt>Confidence</dt><dd>{percent(analysis.meanConfidence)} mean, of known values</dd></div>
          <div><dt>Model cost</dt><dd>${analysis.costUsd.toFixed(3)}</dd></div>
          <div><dt>Last analysed</dt><dd>{when(analysis.lastAnalyzedAt)}</dd></div>
          <div><dt>Run</dt><dd className="mono">{analysis.runId ?? '—'}{analysis.jobId ? <> · <Link href={`/admin/jobs/${analysis.jobId}`}>job</Link></> : null}</dd></div>
          {analysis.counts ? <div><dt>Contents</dt><dd>{analysis.counts.shots} shots · {analysis.counts.boundaries} boundaries · {analysis.counts.textBlocks} text blocks · {analysis.counts.objects} tracks · {analysis.counts.events} events</dd></div> : null}
          {analysis.counts ? <div><dt>Findings</dt><dd>{analysis.counts.contradictions} contradictions · {analysis.counts.unsupported} unsupported claims · {analysis.counts.uncertainties} uncertainties</dd></div> : null}
        </dl>
        {Object.keys(analysis.evidenceMix).length ? <EvidenceMix mix={analysis.evidenceMix} /> : null}
        {analysis.failures.length ? (
          <div className={styles.notice} data-tone="error">
            {analysis.failures.map((failure, i) => <div key={i}>{failure}</div>)}
          </div>
        ) : null}
        {analysis.warnings.length ? (
          <div className={styles.notice}>
            {analysis.warnings.map((warning, i) => <div key={i}>{warning}</div>)}
          </div>
        ) : null}
      </section>

      <details className={adminStyles.section}>
        <summary>Edit title, origin, rights and notes</summary>
        <form action={updateBenchmarkAction} className={adminStyles.formGrid} style={{ marginTop: 'var(--space-3)' }}>
          <input type="hidden" name="id" value={id} />
          <label className={styles.field}><span>Title</span><input name="title" className="input" defaultValue={benchmark.title} maxLength={200} required /></label>
          <label className={styles.field}><span>Origin</span><input name="origin" className="input" defaultValue={benchmark.source.origin ?? ''} maxLength={500} /></label>
          <label className={styles.field}><span>Rights</span><input name="rights" className="input" defaultValue={benchmark.source.rights ?? ''} maxLength={500} /></label>
          <label className={styles.field} style={{ gridColumn: '1 / -1' }}><span>Notes</span><textarea name="notes" className="input" defaultValue={benchmark.notes} rows={3} maxLength={4000} /></label>
          <div><button className="btn btn--secondary">Save</button></div>
        </form>
      </details>

      <section className={adminStyles.section}>
        <h2>FilmIR</h2>
        {!document ? (
          <p className={adminStyles.empty}>{busy ? 'The analysis is under way; the reading appears here when it is complete.' : 'No FilmIR yet. Analyse the film to read it.'}</p>
        ) : (
          <>
            <nav className={styles.tabs} aria-label="Views">
              {VIEWS.map(([key, label]) => (
                <Link key={key} href={`${here}?view=${key}${key === 'window' ? `&start=${windowStart}&end=${windowEnd}` : ''}`} data-active={key === view ? 'true' : 'false'}>
                  {label}
                </Link>
              ))}
            </nav>
            {view !== 'window' ? <video className={styles.player} src={`/api/admin/benchmarks/${id}/source`} controls preload="metadata" /> : null}
            {view === 'timeline' ? <TimelineView doc={document} id={id} /> : null}
            {view === 'overview' ? <OverviewView doc={document} /> : null}
            {view === 'typography' ? <TypographyView doc={document} /> : null}
            {view === 'camera' ? <CameraView doc={document} /> : null}
            {view === 'audio' ? <AudioView doc={document} /> : null}
            {view === 'narration' ? <NarrationView doc={document} /> : null}
            {view === 'transitions' ? <TransitionsView doc={document} /> : null}
            {view === 'events' ? <EventsView doc={document} /> : null}
            {view === 'interpretation' ? <InterpretationView doc={document} /> : null}
            {view === 'reconstruction' ? <ReconstructionView doc={document} /> : null}
            {view === 'findings' ? <FindingsView doc={document} /> : null}
            {view === 'validation' ? <ValidationView validation={validation} /> : null}
            {view === 'window' ? <WindowView doc={document} id={id} start={windowStart} end={windowEnd} /> : null}
          </>
        )}
      </section>
    </>
  );
}
