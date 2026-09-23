import Link from 'next/link';
import type { FilmIR, ValidationReport } from '@act-one/film-ir';
import { EVIDENCE_LABEL, EVIDENCE_ORDER, clock, seconds, show, statusBadge, time, type TimeLike } from '../format.ts';
import { composeWindow } from './composition.ts';
import adminStyles from '../../admin.module.css';
import styles from '../benchmarks.module.css';

/**
 * The FilmIR, read by a person.
 *
 * Every value is shown with how it is known — measured, estimated, inferred,
 * unknown — its confidence and what it cites, because the point of the
 * inspector is to check the reading against the film, and a value without
 * its evidence cannot be checked. Views render from the document alone; none
 * of them computes anything the document does not already say, except the
 * window view, which only gathers what the document says about a few frames.
 */
type Evidenced = { evidenceType: string; confidence: number; method: string; sourceRefs: string[]; note?: string | undefined; value?: unknown };
type Doc = FilmIR;

const EVIDENCE_COLOUR: Record<string, string> = {
  SOURCE_EXACT: 'var(--positive)',
  MEASURED: 'color-mix(in oklab, var(--positive) 70%, var(--surface))',
  ESTIMATED: 'var(--accent)',
  INFERRED: 'var(--warning)',
  RECOMMENDED_RECONSTRUCTION: 'color-mix(in oklab, var(--warning) 50%, var(--surface))',
  SPECIFIED: 'var(--text-muted)',
  UNKNOWN: 'var(--line-strong)',
};

export function Tag({ value }: { value: Evidenced | null | undefined }) {
  if (!value) return <span className={styles.evidence} data-type="UNKNOWN">absent</span>;
  return (
    <span className={styles.evidence} data-type={value.evidenceType} title={`${value.method}${value.note ? ` — ${value.note}` : ''}`}>
      {EVIDENCE_LABEL[value.evidenceType] ?? value.evidenceType} {value.evidenceType === 'UNKNOWN' ? '' : value.confidence.toFixed(2)}
    </span>
  );
}

function Refs({ refs }: { refs: readonly string[] }) {
  if (refs.length === 0) return null;
  return <div className={styles.refs}>{refs.slice(0, 12).join(' · ')}{refs.length > 12 ? ` · +${refs.length - 12}` : ''}</div>;
}

export function Claim({ label, value }: { label: string; value: Evidenced | null | undefined }) {
  return (
    <div className={styles.claim}>
      <div className={styles.claimHead}>
        <strong>{label}</strong> <Tag value={value} /> {value ? <span>{value.method}</span> : null}
      </div>
      <div className={styles.claimValue}>
        {value && value.evidenceType !== 'UNKNOWN' ? show(value.value) : <span className="muted">Unknown{value?.note ? ` — ${value.note}` : ''}</span>}
      </div>
      {value ? <Refs refs={value.sourceRefs} /> : null}
    </div>
  );
}


function durationOf(doc: Doc): number {
  const end = seconds(doc.source?.frameTiming?.lastPtsEnd ?? null);
  const start = seconds(doc.source?.frameTiming?.firstPts ?? null) ?? 0;
  return end !== null ? end - Math.min(0, start) : 0;
}

// ——— overview ———

export function OverviewView({ doc }: { doc: Doc }) {
  const interpretation = doc.interpretation;
  if (!interpretation) {
    return <p className={adminStyles.empty}>No interpretation: the multimodal passes did not run for this FilmIR. Every measured view is complete.</p>;
  }
  const dna = interpretation.dna as unknown as Record<string, Evidenced>;
  return (
    <>
      <section className={adminStyles.section}>
        <h2>Identity</h2>
        <div>
          <Claim label="Summary" value={interpretation.identity.summary} />
          <Claim label="Subject" value={interpretation.identity.subject} />
          <Claim label="Format" value={interpretation.identity.format} />
          <Claim label="Audience" value={interpretation.identity.audience} />
          <Claim label="Language" value={interpretation.identity.language} />
        </div>
      </section>
      <section className={adminStyles.section}>
        <h2>Narrative</h2>
        <div>
          <Claim label="Thesis" value={interpretation.narrative.thesis} />
          <Claim label="Arc" value={interpretation.narrative.arc} />
          {interpretation.narrative.acts.map((act) => (
            <Claim key={act.id} label={`${act.id} · ${show(act.label.value)} · ${show(act.range.value)}`} value={act.summary} />
          ))}
        </div>
      </section>
      <section className={adminStyles.section}>
        <h2>Film DNA</h2>
        <div>
          {Object.entries(dna).map(([key, value]) => (
            <Claim key={key} label={key.replace(/([A-Z])/g, ' $1').toLowerCase()} value={value} />
          ))}
        </div>
      </section>
    </>
  );
}

// ——— timeline ———

type Bar = { start: number; end: number; label: string; fill: string; title: string; href?: string };

/** Intervals into as few rows as will hold them without overlap, up to a limit. */
function pack(bars: Bar[], rows: number): { rows: Bar[][]; hidden: number } {
  const lanes: Bar[][] = [];
  let hidden = 0;
  for (const bar of [...bars].sort((a, b) => a.start - b.start)) {
    const lane = lanes.find((candidate) => candidate[candidate.length - 1]!.end <= bar.start);
    if (lane) lane.push(bar);
    else if (lanes.length < rows) lanes.push([bar]);
    else hidden += 1;
  }
  return { rows: lanes, hidden };
}

export function TimelineView({ doc, id }: { doc: Doc; id: string }) {
  const total = Math.max(durationOf(doc), 0.001);
  const width = 1000;
  const left = 120;
  const span = width - left - 10;
  const x = (t: number) => left + (Math.max(0, Math.min(total, t)) / total) * span;
  const lanes: { name: string; rows: Bar[][]; ticks?: { t: number; title: string; colour: string }[]; curve?: { values: (number | null)[]; step: number; start: number; colour: string } }[] = [];

  lanes.push({
    name: 'Shots',
    rows: [doc.structure.shots.map((shot, i) => ({ start: seconds(shot.range.start)!, end: seconds(shot.range.end)!, label: shot.id.slice(5), fill: i % 2 ? 'var(--line-strong)' : 'var(--line)', title: `${shot.id} ${time(shot.range.start)}–${time(shot.range.end)}` }))],
  });
  lanes.push({
    name: 'Boundaries',
    rows: [doc.structure.boundaries.map((boundary) => ({ start: seconds(boundary.range.start)!, end: Math.max(seconds(boundary.range.end)!, seconds(boundary.range.start)! + total / 400), label: '', fill: 'var(--danger)', title: `${boundary.id} ${show(boundary.kind.value)} at ${time(boundary.at)}` }))],
  });
  if (doc.structure.scenes.length) {
    lanes.push({ name: 'Scenes', rows: pack(doc.structure.scenes.flatMap((scene) => (scene.range.value ? [{ start: seconds(scene.range.value.start)!, end: seconds(scene.range.value.end)!, label: show(scene.label.value), fill: 'var(--accent-quiet)', title: `${scene.id} ${show(scene.label.value)}` }] : [])), 2).rows });
  }
  if (doc.structure.beats.length) {
    lanes.push({ name: 'Beats', rows: pack(doc.structure.beats.flatMap((beat) => (beat.range.value ? [{ start: seconds(beat.range.value.start)!, end: seconds(beat.range.value.end)!, label: show(beat.function.value), fill: 'color-mix(in oklab, var(--warning) 35%, var(--surface))', title: `${beat.id} ${show(beat.function.value)}: ${show(beat.summary.value)}` }] : [])), 2).rows });
  }
  const text = pack(
    doc.typography.blocks.flatMap((block) => {
      const start = seconds(block.timing.firstVisible.value);
      const end = seconds(block.timing.lastVisible.value);
      return start !== null && end !== null ? [{ start, end: Math.max(end, start + total / 500), label: show(block.text.value), fill: 'color-mix(in oklab, var(--positive) 30%, var(--surface))', title: `${block.id} “${show(block.text.value)}” ${time(block.timing.firstVisible.value)}–${time(block.timing.lastVisible.value)} (${block.classification.value ?? 'unclassified'})` }] : [];
    }),
    8,
  );
  lanes.push({ name: `Type${text.hidden ? ` (+${text.hidden})` : ''}`, rows: text.rows });
  if (doc.camera?.moves.length) {
    lanes.push({ name: 'Camera', rows: pack(doc.camera.moves.map((move) => ({ start: seconds(move.range.start)!, end: seconds(move.range.end)!, label: show(move.type.value), fill: 'var(--accent-quiet)', title: `${move.id} ${show(move.type.value)}` })), 2).rows });
  }
  lanes.push({
    name: 'Silence',
    rows: [doc.sound.silences.map((silence) => ({ start: seconds(silence.range.start)!, end: seconds(silence.range.end)!, label: '', fill: 'var(--line)', title: `${silence.id} ${time(silence.range.start)}–${time(silence.range.end)} at ${silence.levelDbfs.toFixed(1)} dBFS` }))],
  });
  lanes.push({
    name: 'Onsets',
    rows: [],
    ticks: doc.audio.events.filter((event) => event.kind === 'onset' || event.kind === 'transient').map((event) => ({ t: seconds(event.at)!, title: `${event.id} ${event.kind} at ${time(event.at)}`, colour: event.kind === 'transient' ? 'var(--danger)' : 'var(--text-muted)' })),
  });
  if (doc.sound.music.beats.times.length) {
    lanes.push({ name: 'Beats (music)', rows: [], ticks: doc.sound.music.beats.times.map((beat, i) => ({ t: seconds(beat)!, title: `beat ${i} at ${time(beat)}`, colour: 'var(--accent)' })) });
  }
  if (doc.narration.phrases.length) {
    lanes.push({ name: 'Narration', rows: pack(doc.narration.phrases.flatMap((phrase) => (phrase.range.value ? [{ start: seconds(phrase.range.value.start)!, end: seconds(phrase.range.value.end)!, label: phrase.text, fill: 'var(--accent-quiet)', title: `${phrase.id} “${phrase.text}”` }] : [])), 2).rows });
  }
  lanes.push({ name: 'Sync', rows: [], ticks: doc.events.clusters.map((cluster) => {
    const anchor = doc.events.events.find((event) => event.id === cluster.anchor);
    return { t: seconds(anchor?.start ?? null) ?? 0, title: `${cluster.id}: ${cluster.members.length} events${cluster.interpretation?.value ? ` — ${cluster.interpretation.value}` : ''}`, colour: 'var(--warning)' };
  }) });
  const loudness = doc.audio.series.find((series) => series.id === 'audio.loudness_short_term');
  if (loudness && loudness.sampling.kind === 'regular') {
    lanes.push({ name: 'Loudness (S)', rows: [], curve: { values: loudness.values, step: seconds(loudness.sampling.step)!, start: seconds(loudness.sampling.start)!, colour: 'var(--accent)' } });
  }
  const motion = doc.frames?.features.find((series) => series.id === 'frame.flow_mean');
  if (motion && doc.frames) {
    const fps = doc.frames.count / total;
    lanes.push({ name: 'Motion', rows: [], curve: { values: motion.values, step: 1 / fps, start: 0, colour: 'var(--positive)' } });
  }
  const tension = doc.curves.inferred.find((series) => series.id === 'curve.inferred.narrative_tension');
  if (tension && tension.sampling.kind === 'regular') {
    lanes.push({ name: 'Tension (inferred)', rows: [], curve: { values: tension.values, step: seconds(tension.sampling.step)!, start: 0, colour: 'var(--warning)' } });
  }

  const ROW = 16;
  let y = 24;
  const rendered: React.ReactNode[] = [];
  for (const lane of lanes) {
    const height = lane.curve ? 34 : Math.max(1, lane.rows.length) * ROW + (lane.ticks ? ROW : 0);
    rendered.push(<text key={`label-${lane.name}`} x={4} y={y + 12} className="lane">{lane.name}</text>);
    lane.rows.forEach((row, r) =>
      row.forEach((bar, b) => {
        const x0 = x(bar.start);
        const w = Math.max(1.5, x(bar.end) - x0);
        rendered.push(
          <g key={`${lane.name}-${r}-${b}`}>
            <title>{bar.title}</title>
            <rect x={x0} y={y + r * ROW + 2} width={w} height={ROW - 4} rx={2} fill={bar.fill} />
            {w > 40 ? <text x={x0 + 3} y={y + r * ROW + 11}>{bar.label.slice(0, Math.floor(w / 6))}</text> : null}
          </g>,
        );
      }),
    );
    lane.ticks?.forEach((tick, i) =>
      rendered.push(
        <line key={`${lane.name}-tick-${i}`} x1={x(tick.t)} x2={x(tick.t)} y1={y + 2} y2={y + ROW - 2} stroke={tick.colour} strokeWidth={1}>
          <title>{tick.title}</title>
        </line>,
      ),
    );
    if (lane.curve) {
      const finite = lane.curve.values.filter((v): v is number => v !== null && Number.isFinite(v));
      const lo = Math.min(...finite);
      const hi = Math.max(...finite);
      const points = lane.curve.values
        .map((v, i) => (v === null || !Number.isFinite(v) ? null : `${x(lane.curve!.start + i * lane.curve!.step).toFixed(1)},${(y + 30 - ((v - lo) / Math.max(1e-9, hi - lo)) * 26).toFixed(1)}`))
        .filter(Boolean)
        .join(' ');
      rendered.push(<polyline key={`${lane.name}-curve`} points={points} fill="none" stroke={lane.curve.colour} strokeWidth={1} />);
    }
    y += height + 6;
  }
  const step = total > 60 ? 10 : total > 20 ? 5 : total > 8 ? 2 : 1;
  const axis: React.ReactNode[] = [];
  for (let t = 0; t <= total + 1e-9; t += step) {
    axis.push(
      <g key={`axis-${t}`}>
        <line x1={x(t)} x2={x(t)} y1={16} y2={y} stroke="var(--line-soft)" strokeWidth={0.5} />
        <text x={x(t) + 2} y={12}>{t.toFixed(0)}s</text>
      </g>,
    );
  }
  const windows: React.ReactNode[] = [];
  for (let t = 0; t < total; t += 2) {
    windows.push(
      <a key={`window-${t}`} href={`/admin/benchmarks/${id}?view=window&start=${t.toFixed(3)}&end=${Math.min(total, t + 2).toFixed(3)}`}>
        <title>{`Inspect ${t.toFixed(0)}–${Math.min(total, t + 2).toFixed(0)} s frame by frame`}</title>
        <rect x={x(t)} y={0} width={Math.max(1, x(Math.min(total, t + 2)) - x(t))} height={16} fill="transparent" />
      </a>,
    );
  }
  return (
    <>
      <p className="muted" style={{ fontSize: '0.84rem' }}>
        Hover for values; click the time axis to open any two seconds frame by frame. Shots, boundaries, type, silences and onsets are measured; scenes, beats and tension are the model&apos;s, placed only where they cited evidence.
      </p>
      <svg className={styles.timeline} viewBox={`0 0 ${width} ${y + 4}`} role="img" aria-label="Timeline of the film">
        {axis}
        {rendered}
        {windows}
      </svg>
    </>
  );
}

// ——— typography ———

export function TypographyView({ doc }: { doc: Doc }) {
  const blocks = doc.typography.blocks;
  const shown = blocks.slice(0, 400);
  return (
    <>
      <p className="muted" style={{ fontSize: '0.84rem' }}>
        {blocks.length} block(s). Milestones are the first frames where visibility crosses a fraction of its settled value; the bounds are the frame before and the frame itself. Font families are never read from pixels.
        <Shown total={blocks.length} shown={shown.length} />
      </p>
      <div className={adminStyles.tableWrap}>
        <table className={adminStyles.table}>
          <thead>
            <tr>
              <th>Block</th>
              <th>Text</th>
              <th>Class</th>
              <th>First visible</th>
              <th>Half</th>
              <th>Settled</th>
              <th>Exit</th>
              <th>Last visible</th>
              <th>Enter</th>
              <th>Speech</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((block) => (
              <tr key={block.id}>
                <td className="mono">{block.id}</td>
                <td style={{ maxWidth: 280 }}>
                  {show(block.text.value)} <Tag value={block.text} />
                  {block.text.note ? <div className={styles.sub}>{block.text.note}</div> : null}
                </td>
                <td>
                  {show(block.classification.value)} <Tag value={block.classification} />
                </td>
                {[block.timing.firstVisible, block.timing.p50, block.timing.settled, block.timing.exitStart, block.timing.lastVisible].map((milestone, i) => (
                  <td key={i} className="mono" title={milestone.note ?? milestone.method}>
                    {time(milestone.value)}
                  </td>
                ))}
                <td className={styles.sub} style={{ whiteSpace: 'normal', minWidth: 140 }}>
                  {block.enter.durationMs.value !== null ? `${show(block.enter.durationMs.value)} ms` : 'cut'}
                  {block.enter.opacity.value ? ` · opacity ${block.enter.opacity.value.from.toFixed(2)}→${block.enter.opacity.value.to.toFixed(2)}` : ''}
                  {block.enter.translation.value ? ` · moves ${block.enter.translation.value.dx.toFixed(0)},${block.enter.translation.value.dy.toFixed(0)} px` : ''}
                  {block.enter.stagger.value ? ` · ${block.enter.stagger.value.unit} stagger ${block.enter.stagger.value.intervalsMs.map((ms) => ms.toFixed(0)).join('/')} ms` : ''}
                </td>
                <td>
                  {show(block.speech.relation.value)} <Tag value={block.speech.relation} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ——— camera ———

export function CameraView({ doc }: { doc: Doc }) {
  const camera = doc.camera;
  if (!camera) return <p className={adminStyles.empty}>No camera analysis.</p>;
  return (
    <>
      <section className={adminStyles.section}>
        <h2>Observability</h2>
        <p className="muted" style={{ fontSize: '0.84rem' }}>{camera.model}</p>
        <div className={adminStyles.tableWrap}>
          <table className={adminStyles.table}>
            <thead><tr><th>Shot</th><th>Camera</th><th className={adminStyles.num}>Confidence</th><th>Why</th></tr></thead>
            <tbody>
              {camera.shots.map((shot) => (
                <tr key={shot.shotId}>
                  <td className="mono">{shot.shotId}</td>
                  <td><span className={`badge ${shot.observability === 'observable' ? 'badge--ok' : shot.observability === 'partial' ? 'badge--warn' : ''}`}>{shot.observability}</span></td>
                  <td className={adminStyles.num}>{shot.confidence.toFixed(2)}</td>
                  <td className={styles.sub} style={{ whiteSpace: 'normal' }}>{shot.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className={adminStyles.section}>
        <h2>Moves</h2>
        {camera.moves.length === 0 ? <p className={adminStyles.empty}>No camera move was measured.</p> : (
          <div className={adminStyles.tableWrap}>
            <table className={adminStyles.table}>
              <thead><tr><th>Move</th><th>Shot</th><th>Type</th><th>When</th><th className={adminStyles.num}>Travel</th><th className={adminStyles.num}>Scale</th><th>Phases</th><th>Best fit</th><th>Reading</th></tr></thead>
              <tbody>
                {camera.moves.map((move) => (
                  <tr key={move.id}>
                    <td className="mono">{move.id}</td>
                    <td className="mono">{move.shotId}</td>
                    <td>{show(move.type.value)} <Tag value={move.type} /></td>
                    <td className="mono">{time(move.range.start)}–{time(move.range.end)}</td>
                    <td className={adminStyles.num}>{show(move.translationPx.value)} px</td>
                    <td className={adminStyles.num}>{show(move.scaleRatio.value)}</td>
                    <td className={styles.sub}>{move.phases.map((phase) => phase.kind).join(' → ') || '—'}</td>
                    <td className={styles.sub}>{move.fits[0] ? `${move.fits[0].model} r² ${move.fits[0].rSquared.toFixed(3)} (reconstructed)` : '—'}</td>
                    <td style={{ maxWidth: 260 }}>{move.description ? <>{show(move.description.value)} <Tag value={move.description} /></> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className={adminStyles.section}>
        <h2>Lens</h2>
        <div>
          <Claim label="Focal length" value={camera.focalLength} />
          <Claim label="Vanishing point" value={camera.vanishingPoint} />
        </div>
      </section>
    </>
  );
}

// ——— sound ———

export function AudioView({ doc }: { doc: Doc }) {
  const { music } = doc.sound;
  const loudness = doc.audio.loudness;
  return (
    <>
      <section className={adminStyles.section}>
        <h2>Loudness</h2>
        {loudness ? (
          <div>
            <Claim label="Integrated (LUFS)" value={loudness.integratedLufs} />
            <Claim label="Loudness range (LU)" value={loudness.loudnessRangeLu} />
            <Claim label="True peak (dBTP)" value={loudness.truePeakDbtp} />
          </div>
        ) : <p className={adminStyles.empty}>No loudness measurement.</p>}
      </section>
      <section className={adminStyles.section}>
        <h2>Music</h2>
        <div>
          <Claim label="Present" value={music.present} />
          <Claim label="Tempo (BPM)" value={music.tempoBpm} />
          <Claim label="Key" value={music.key} />
          <Claim label="Meter" value={music.meter} />
          <Claim label="Description" value={music.description} />
          <p className="muted" style={{ fontSize: '0.84rem' }}>
            {music.beats.times.length} beat(s) <Tag value={{ ...music.beats.provenance }} /> · {music.downbeats.times.length} downbeat(s) <Tag value={{ ...music.downbeats.provenance }} /> · {music.sections.length} section(s)
          </p>
        </div>
      </section>
      <section className={adminStyles.section}>
        <h2>Effects, silences and bridges</h2>
        <div className={adminStyles.tableWrap}>
          <table className={adminStyles.table}>
            <thead><tr><th>What</th><th>When</th><th>Detail</th><th>Evidence</th></tr></thead>
            <tbody>
              {doc.sound.sfx.map((sfx) => (
                <tr key={sfx.id}><td className="mono">{sfx.id}</td><td className="mono">{time(sfx.at)}</td><td>{show(sfx.label.value)}</td><td><Tag value={sfx.label} /></td></tr>
              ))}
              {doc.sound.silences.map((silence) => (
                <tr key={silence.id}><td className="mono">{silence.id}</td><td className="mono">{time(silence.range.start)}–{time(silence.range.end)}</td><td>{silence.levelDbfs.toFixed(1)} dBFS</td><td><Tag value={silence.provenance} /></td></tr>
              ))}
              {doc.sound.bridges.map((bridge) => (
                <tr key={bridge.id}><td className="mono">{bridge.id} ({bridge.boundaryId})</td><td className="mono">{time(bridge.range.start)}–{time(bridge.range.end)}</td><td>{show(bridge.kind.value)}</td><td><Tag value={bridge.kind} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: '0.84rem' }}>{doc.audio.separation.note}</p>
      </section>
    </>
  );
}

// ——— narration ———

export function NarrationView({ doc }: { doc: Doc }) {
  const narration = doc.narration;
  const withheld = doc.unsupported.filter((entry) => entry.sourceRef === 'producer:asr');
  return (
    <>
      <section className={adminStyles.section}>
        <h2>Narration</h2>
        <div>
          <Claim label="Present" value={narration.present} />
          <Claim label="Language" value={narration.language} />
          <Claim label="Transcript" value={narration.transcript} />
        </div>
        {narration.agreement.comparedWith ? (
          <p className="muted" style={{ fontSize: '0.84rem' }}>
            Word error rate against {narration.agreement.comparedWith}: {((narration.agreement.wordErrorRate ?? 0) * 100).toFixed(1)}% over {narration.agreement.comparedWords} words.
          </p>
        ) : null}
        {withheld.length ? (
          <div className={styles.notice}>
            Withheld as unsupported, each with why:
            <ul>{withheld.map((entry) => <li key={entry.id}>{entry.claim} — <span className="muted">{entry.reason}</span></li>)}</ul>
          </div>
        ) : null}
      </section>
      {narration.phrases.length ? (
        <section className={adminStyles.section}>
          <h2>Phrases</h2>
          <div className={adminStyles.tableWrap}>
            <table className={adminStyles.table}>
              <thead><tr><th>Phrase</th><th>When</th><th>Text</th><th className={adminStyles.num}>Pause before</th><th className={adminStyles.num}>Pause after</th></tr></thead>
              <tbody>
                {narration.phrases.map((phrase) => (
                  <tr key={phrase.id}>
                    <td className="mono">{phrase.id}</td>
                    <td className="mono">{show(phrase.range.value)} <Tag value={phrase.range} /></td>
                    <td>{phrase.text}</td>
                    <td className={adminStyles.num}>{show(phrase.pauseBefore.value)}</td>
                    <td className={adminStyles.num}>{show(phrase.pauseAfter.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}

// ——— transitions ———

export function TransitionsView({ doc }: { doc: Doc }) {
  return (
    <>
      <section className={adminStyles.section}>
        <h2>Boundaries</h2>
        <div className={adminStyles.tableWrap}>
          <table className={adminStyles.table}>
            <thead><tr><th>Boundary</th><th>Kind</th><th>Frames</th><th>Change</th><th>Handover</th><th>Reading</th></tr></thead>
            <tbody>
              {doc.structure.boundaries.map((boundary) => (
                <tr key={boundary.id}>
                  <td className="mono">{boundary.id}</td>
                  <td>{show(boundary.kind.value)} <Tag value={boundary.kind} /></td>
                  <td className="mono">{boundary.frames.lastOutgoing} → {boundary.frames.firstIncoming}</td>
                  <td className="mono">{time(boundary.range.start)}–{time(boundary.range.end)}</td>
                  <td>{show(boundary.handover.value)} <Tag value={boundary.handover} /></td>
                  <td style={{ maxWidth: 300 }}>{boundary.description ? show(boundary.description.value) : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className={adminStyles.section}>
        <h2>Changes of idea without a boundary</h2>
        {doc.structure.transitions.filter((transition) => transition.boundaryId === null).length === 0 ? <p className={adminStyles.empty}>None kept.</p> : (
          <div className={adminStyles.tableWrap}>
            <table className={adminStyles.table}>
              <thead><tr><th>Transition</th><th>When</th><th>Technique</th><th>Handover</th><th>Description</th></tr></thead>
              <tbody>
                {doc.structure.transitions.filter((transition) => transition.boundaryId === null).map((transition) => (
                  <tr key={transition.id}>
                    <td className="mono">{transition.id}</td>
                    <td className="mono">{show(transition.range.value)}</td>
                    <td>{show(transition.technique.value)} <Tag value={transition.technique} /></td>
                    <td>{show(transition.handover.value)}</td>
                    <td style={{ maxWidth: 320 }}>{show(transition.description.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ——— events ———

/** Rows a list view renders at most; a long film's document holds thousands, and the download holds them all. */
const LIST_LIMIT = 300;

function Shown({ total, shown }: { total: number; shown: number }) {
  return total > shown ? <> The first {shown} are shown; download the FilmIR for all.</> : null;
}

export function EventsView({ doc }: { doc: Doc }) {
  const events = new Map(doc.events.events.map((event) => [event.id, event]));
  const ms = (value: TimeLike) => `${((seconds(value) ?? 0) * 1000).toFixed(1)} ms`;
  const clusters = doc.events.clusters.slice(0, LIST_LIMIT);
  const relations = doc.events.relations.slice(0, LIST_LIMIT);
  return (
    <>
      <section className={adminStyles.section}>
        <h2>Sync clusters</h2>
        {doc.events.clusters.length === 0 ? <p className={adminStyles.empty}>No three events from two senses land within 120 ms of each other.</p> : (
          <>
          <p className="muted" style={{ fontSize: '0.84rem' }}>
            {doc.events.clusters.length} cluster(s) of events from two or more senses within 120 ms.
            <Shown total={doc.events.clusters.length} shown={clusters.length} />
          </p>
          <div className={adminStyles.tableWrap}>
            <table className={adminStyles.table}>
              <thead><tr><th>Cluster</th><th>Anchor</th><th>Members (offset from the anchor)</th><th>Spread</th><th>Reading</th></tr></thead>
              <tbody>
                {clusters.map((cluster) => {
                  const anchor = events.get(cluster.anchor);
                  return (
                    <tr key={cluster.id}>
                      <td className="mono">{cluster.id}</td>
                      <td className="mono">{anchor ? `${anchor.type} @ ${time(anchor.start)}` : cluster.anchor}</td>
                      <td className={styles.sub} style={{ whiteSpace: 'normal' }}>
                        {cluster.members.slice(0, 16).map((member) => `${events.get(member.eventId)?.type ?? member.eventId} ${ms(member.offset)}`).join(' · ')}
                        {cluster.members.length > 16 ? ` · +${cluster.members.length - 16} more` : ''}
                      </td>
                      <td className="mono">{ms(cluster.spread)}</td>
                      <td style={{ maxWidth: 280 }}>{cluster.interpretation ? <>{show(cluster.interpretation.value)} <Tag value={cluster.interpretation} /></> : <span className="muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>
      <section className={adminStyles.section}>
        <h2>Relations</h2>
        <p className="muted" style={{ fontSize: '0.84rem' }}>
          {doc.events.relations.length} relation(s) between events of different senses within 250 ms. Each offset is exact; its uncertainty is the sum of the two events&apos; resolutions.
          <Shown total={doc.events.relations.length} shown={relations.length} />
        </p>
        <div className={adminStyles.tableWrap}>
          <table className={adminStyles.table}>
            <thead><tr><th>From</th><th>To</th><th className={adminStyles.num}>Offset</th><th className={adminStyles.num}>±</th><th>Kind</th></tr></thead>
            <tbody>
              {relations.map((relation) => {
                const from = events.get(relation.from);
                const to = events.get(relation.to);
                return (
                  <tr key={relation.id}>
                    <td className="mono">{from ? `${from.type} @ ${time(from.start)}` : relation.from}</td>
                    <td className="mono">{to ? `${to.type} @ ${time(to.start)}` : relation.to}</td>
                    <td className={adminStyles.num}>{ms(relation.offset)}</td>
                    <td className={adminStyles.num}>{ms(relation.uncertainty)}</td>
                    <td>{relation.kind}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// ——— interpretation ———

export function InterpretationView({ doc }: { doc: Doc }) {
  const interpretation = doc.interpretation;
  if (!interpretation) return <p className={adminStyles.empty}>No interpretation for this FilmIR.</p>;
  return (
    <>
      <section className={adminStyles.section}>
        <h2>Memorable moments</h2>
        <div>{interpretation.moments.map((moment) => <Claim key={moment.id} label={`${moment.title} · ${time(moment.range.start)}–${time(moment.range.end)}`} value={moment.description} />)}</div>
      </section>
      <section className={adminStyles.section}>
        <h2>Directorial choices</h2>
        <div className={styles.prose}>
          {interpretation.choices.map((choice) => (
            <div key={choice.id} className={styles.claim}>
              <div className={styles.claimHead}><strong>{choice.title}</strong> <span>{time(choice.when.start)}–{time(choice.when.end)}</span></div>
              <p><strong>What:</strong> {choice.what}</p>
              <p><strong>How:</strong> {choice.how}</p>
              {choice.howMuch.length ? <p><strong>How much:</strong> {choice.howMuch.map((citation) => `${citation.quantity} ${citation.value ?? '?'} ${citation.unit} (${citation.ref})`).join('; ')}</p> : null}
              <p><strong>Relative to:</strong> {choice.relativeTo}</p>
              <p><strong>Why (interpretation):</strong> {show(choice.why.value)} <Tag value={choice.why} /></p>
              <Refs refs={choice.factRefs} />
            </div>
          ))}
        </div>
      </section>
      <section className={adminStyles.section}>
        <h2>Transferable grammar</h2>
        <div className={styles.prose}>
          {interpretation.mechanisms.map((mechanism) => (
            <div key={mechanism.id} className={styles.claim}>
              <div className={styles.claimHead}><strong>{mechanism.id}</strong> <Tag value={mechanism.provenance} /></div>
              <p><strong>Context:</strong> {mechanism.context}</p>
              <p><strong>Decision:</strong> {mechanism.observedDecision}</p>
              <p><strong>Effect:</strong> {show(mechanism.likelyEffect.value)}</p>
              <p><strong>Principle:</strong> {mechanism.transferablePrinciple}</p>
              <p><strong>Do not copy:</strong> {mechanism.doNotCopy.join('; ')}</p>
              <Refs refs={mechanism.evidence} />
            </div>
          ))}
        </div>
      </section>
      <section className={adminStyles.section}>
        <h2>Signature — not transferable</h2>
        <div className={styles.prose}>
          {interpretation.signatures.map((signature) => (
            <div key={signature.id} className={styles.claim}>
              <p>{signature.description}</p>
              <p className="muted">{signature.whyNotTransferable}</p>
              <Refs refs={signature.refs} />
            </div>
          ))}
        </div>
      </section>
      <section className={adminStyles.section}>
        <h2>Observations</h2>
        <div>{interpretation.observations.map((observation) => <Claim key={observation.id} label={`${observation.topic}${observation.range?.value ? ` · ${show(observation.range.value)}` : ''}`} value={observation.text} />)}</div>
      </section>
    </>
  );
}

// ——— reconstruction ———

export function ReconstructionView({ doc }: { doc: Doc }) {
  const reconstruction = doc.reconstruction;
  if (!reconstruction) return <p className={adminStyles.empty}>No reconstruction strategy.</p>;
  return (
    <>
      <section className={adminStyles.section}>
        <h2>Strategy</h2>
        <Claim label="How to rebuild the observable behaviour" value={reconstruction.strategy} />
        <p className="muted" style={{ fontSize: '0.84rem' }}>
          Coverage: {(reconstruction.coverage.measuredShare * 100).toFixed(0)}% measured, {(reconstruction.coverage.estimatedShare * 100).toFixed(0)}% estimated, {(reconstruction.coverage.unknownShare * 100).toFixed(0)}% unknown. A strategy for rebuilding what is seen — never a claim about how the film was made.
        </p>
      </section>
      <section className={adminStyles.section}>
        <h2>Per shot</h2>
        <div className={adminStyles.tableWrap}>
          <table className={adminStyles.table}>
            <thead><tr><th>Shot</th><th className={adminStyles.num}>Layers</th><th className={adminStyles.num}>Camera tracks</th><th>Notes</th></tr></thead>
            <tbody>
              {reconstruction.shots.map((shot) => (
                <tr key={shot.shotId}>
                  <td className="mono">{shot.shotId}</td>
                  <td className={adminStyles.num}>{shot.layers.length}</td>
                  <td className={adminStyles.num}>{shot.camera.length}</td>
                  <td className={styles.sub} style={{ whiteSpace: 'normal' }}>{shot.notes.join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// ——— findings ———

export function FindingsView({ doc }: { doc: Doc }) {
  return (
    <>
      <section className={adminStyles.section}>
        <h2>Contradictions ({doc.contradictions.length})</h2>
        {doc.contradictions.length === 0 ? <p className={adminStyles.empty}>None.</p> : (
          <ul className={adminStyles.plainList}>
            {doc.contradictions.map((contradiction) => (
              <li key={contradiction.id}>
                <span className={`badge ${contradiction.resolution === 'unresolved' ? 'badge--bad' : 'badge--warn'}`}>{contradiction.resolution}</span> <span className="mono">{contradiction.severity}</span> {contradiction.description}
                <Refs refs={contradiction.refs} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={adminStyles.section}>
        <h2>Unsupported hypotheses ({doc.unsupported.length})</h2>
        <p className="muted" style={{ fontSize: '0.84rem' }}>Claims that were offered and not kept, with the reason. Kept so nobody mistakes their absence for an oversight.</p>
        <ul className={adminStyles.plainList}>
          {doc.unsupported.map((entry) => (
            <li key={entry.id}>
              <span className="mono">{entry.sourceRef}</span> — {entry.claim} <span className="muted">({entry.reason})</span>
            </li>
          ))}
        </ul>
      </section>
      <section className={adminStyles.section}>
        <h2>Uncertainties ({doc.uncertainties.length})</h2>
        <ul className={adminStyles.plainList}>
          {doc.uncertainties.map((uncertainty) => (
            <li key={uncertainty.id}>
              <span className={`badge ${uncertainty.impact === 'high' ? 'badge--bad' : uncertainty.impact === 'medium' ? 'badge--warn' : ''}`}>{uncertainty.impact}</span> <span className="mono">{uncertainty.reason}</span> {uncertainty.description}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

// ——— validation ———

export function ValidationView({ validation }: { validation: ValidationReport | null }) {
  if (!validation) return <p className={adminStyles.empty}>No validation report.</p>;
  return (
    <>
      <p>
        <span className={`badge ${statusBadge(validation.status.toLowerCase() === 'ready' ? 'ready' : validation.status.toLowerCase())}`}>{validation.status}</span>{' '}
        <span className="muted">validator {validation.validatorVersion}, {new Date(validation.checkedAt).toLocaleString('en-GB', { hour12: false })}</span>
      </p>
      <EvidenceMix mix={validation.evidenceMix} />
      <div className={adminStyles.tableWrap} style={{ marginTop: 'var(--space-4)' }}>
        <table className={adminStyles.table}>
          <thead><tr><th>Check</th><th>Status</th><th>Critical</th><th>Result</th></tr></thead>
          <tbody>
            {validation.checks.map((check) => (
              <tr key={check.id}>
                <td>{check.title}</td>
                <td><span className={`badge ${check.status === 'pass' ? 'badge--ok' : check.status === 'warn' ? 'badge--warn' : 'badge--bad'}`}>{check.status}</span></td>
                <td>{check.critical ? 'yes' : 'no'}</td>
                <td style={{ whiteSpace: 'normal' }}>
                  {check.message}
                  {check.examples.length > 1 ? <div className={styles.refs}>{check.examples.slice(1).join(' · ')}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: '0.84rem' }}>
        Coverage: {validation.coverage.frames.analyzed}/{validation.coverage.frames.expected} frames, {validation.coverage.audioSamples.analyzed}/{validation.coverage.audioSamples.expected} audio samples, {validation.coverage.passes.completed}/{validation.coverage.passes.expected} passes.
      </p>
    </>
  );
}

export function EvidenceMix({ mix }: { mix: Record<string, number> }) {
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  if (!total) return null;
  const ordered = EVIDENCE_ORDER.filter((type) => mix[type]);
  return (
    <div>
      <div className={styles.mix} role="img" aria-label="Evidence mix">
        {ordered.map((type) => <span key={type} style={{ width: `${(mix[type]! / total) * 100}%`, background: EVIDENCE_COLOUR[type] }} title={`${type} ${mix[type]}`} />)}
      </div>
      <div className={styles.mixLegend}>
        {ordered.map((type) => (
          <span key={type}><span className={styles.swatch} style={{ background: EVIDENCE_COLOUR[type] }} />{EVIDENCE_LABEL[type]} {mix[type]} ({((mix[type]! / total) * 100).toFixed(1)}%)</span>
        ))}
      </div>
    </div>
  );
}

// ——— the window: a few frames as a composition ———

/**
 * Up to two seconds, frame by frame: what is on screen, where, how visible,
 * how the camera sits, what is heard — each with how it is known. Nothing
 * here is computed beyond gathering: every figure is the document's own.
 */
export function WindowView({ doc, id, start, end }: { doc: Doc; id: string; start: number; end: number }) {
  const frames = doc.frames;
  if (!frames) return <p className={adminStyles.empty}>No frame table.</p>;
  const from = Math.max(0, start);
  const to = Math.min(from + 2, Math.max(from + 1 / 60, end));
  const pts = frames.pts.map((value) => Number(value) / frames.timescale);
  const inside = pts.map((t, i) => [t, i] as const).filter(([t]) => t >= from && t < to).map(([, i]) => i);
  const feature = (name: string) => frames.features.find((series) => series.id === `frame.${name}`)?.values ?? [];
  const flow = feature('flow_mean');
  const change = feature('pixel_difference');
  const luma = feature('luma_mean');
  const shotOf = (i: number) => doc.structure.shots.find((shot) => shot.frames.first <= i && shot.frames.last >= i)?.id ?? null;
  const boundaryOf = (i: number) => doc.structure.boundaries.find((boundary) => boundary.span.first <= i && boundary.span.last >= i) ?? null;
  const objectIndex = doc.objects.map((object) => ({ object, at: new Map(object.sampleFrames.map((frame, k) => [frame, k])) }));
  const cameraAt = new Map((doc.camera?.sampleFrames ?? []).map((frame, k) => [frame, k]));
  const cam = (name: 'tx' | 'ty' | 'scale', k: number | undefined) => (k === undefined ? null : doc.camera?.columns[name]?.[k] ?? null);
  const audioIn = (a: number, b: number) => doc.audio.events.filter((event) => { const t = seconds(event.at)!; return t >= a && t < b; });
  const wordsIn = (a: number, b: number) => doc.narration.words.filter((word) => word.range.value && seconds(word.range.value.start)! >= a && seconds(word.range.value.start)! < b);

  const story = composeWindow(doc, from, to);

  return (
    <>
      <p className="muted" style={{ fontSize: '0.84rem' }}>
        {time({ ticks: String(Math.round(from * 1000)), timescale: 1000 })} – {time({ ticks: String(Math.round(to * 1000)), timescale: 1000 })} · {inside.length} frames.{' '}
        <Link href={`/admin/benchmarks/${id}?view=window&start=${Math.max(0, from - 2).toFixed(3)}&end=${from.toFixed(3)}`}>← earlier</Link> ·{' '}
        <Link href={`/admin/benchmarks/${id}?view=window&start=${to.toFixed(3)}&end=${(to + 2).toFixed(3)}`}>later →</Link>
      </p>
      <video className={styles.player} src={`/api/admin/benchmarks/${id}/source#t=${from.toFixed(3)},${to.toFixed(3)}`} controls preload="metadata" />
      <section className={adminStyles.section}>
        <h2>The composition</h2>
        <div className={styles.prose}>{story.length ? story.map((line, i) => <p key={i}>{line}</p>) : <p className="muted">Nothing is measured to change in this window: a held frame.</p>}</div>
      </section>
      <section className={adminStyles.section}>
        <h2>Frame by frame</h2>
        <div className={adminStyles.tableWrap}>
          <table className={`${adminStyles.table} ${styles.frameTable}`}>
            <thead><tr><th>Frame</th><th>Time</th><th>On screen (measured)</th><th>Camera and picture</th><th>Heard</th></tr></thead>
            <tbody>
              {inside.map((i) => {
                const t = pts[i]!;
                const next = pts[i + 1] ?? to;
                const k = cameraAt.get(i);
                const visible = objectIndex.flatMap(({ object, at }) => {
                  const s = at.get(i);
                  if (s === undefined) return [];
                  const opacity = object.columns.opacity?.[s];
                  const x = object.columns.x?.[s];
                  const y = object.columns.y?.[s];
                  if (opacity !== undefined && opacity !== null && opacity < 0.02) return [];
                  return [`${object.id}${object.name?.value ? ` “${object.name.value}”` : ''}${x !== undefined && x !== null ? ` @${x.toFixed(0)},${(y ?? 0).toFixed(0)}` : ''}${opacity !== undefined && opacity !== null ? ` α${opacity.toFixed(2)}` : ''}`];
                });
                const boundary = boundaryOf(i);
                const words = wordsIn(t, next);
                const sounds = audioIn(t, next);
                return (
                  <tr key={i}>
                    <td className="mono">{i}{frames.repeatOf[i] !== null ? ` =${frames.repeatOf[i]}` : ''}</td>
                    <td className="mono">{clock(t)}</td>
                    <td className={styles.sub} style={{ whiteSpace: 'normal' }}>
                      {shotOf(i) ?? (boundary ? `in ${boundary.id}` : '—')}
                      {boundary ? ` · ${boundary.id} ${show(boundary.kind.value)}` : ''}
                      {visible.length ? ` · ${visible.slice(0, 8).join(' · ')}${visible.length > 8 ? ` · +${visible.length - 8}` : ''}` : ''}
                    </td>
                    <td className={styles.sub} style={{ whiteSpace: 'normal' }}>
                      {cam('tx', k) !== null ? `camera Δ ${(cam('tx', k)! * 100).toFixed(2)},${((cam('ty', k) ?? 0) * 100).toFixed(2)}% · scale ${(cam('scale', k) ?? 1).toFixed(4)} · ` : ''}
                      flow {typeof flow[i] === 'number' ? (flow[i] as number).toFixed(4) : '—'} · Δpixels {typeof change[i] === 'number' ? (change[i] as number).toFixed(4) : '—'} · luma {typeof luma[i] === 'number' ? (luma[i] as number).toFixed(3) : '—'}
                    </td>
                    <td className={styles.sub} style={{ whiteSpace: 'normal' }}>
                      {[...sounds.map((event) => `${event.kind} ${clock(seconds(event.at))}`), ...words.map((word) => `“${word.text}”`)].join(' · ') || ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
