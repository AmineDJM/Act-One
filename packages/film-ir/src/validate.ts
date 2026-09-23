import { FilmIR, type ValidationCheck, type ValidationReport } from './schema/document.ts';
import type { EvidenceType, RationalTime } from './schema/primitives.ts';
import { addTime, compareTime, isInt64String, maxTime, minTime, rt, sameTime, subtractTime } from './time.ts';

/**
 * Whether a FilmIR can be trusted.
 *
 * The schema proves the document has the right shape; this proves it is
 * consistent with itself and with the file it describes. A model returning
 * well-formed JSON passes the first and can fail every check here: times that
 * run backwards, references to objects that do not exist, an inference with
 * no evidence under it, a pass that returned nothing.
 */
export const VALIDATOR_VERSION = '1.0.0';

export type ValidationOptions = {
  /** Passes the pipeline intended to run, so a missing one is noticed rather than silently absent. */
  expectedPasses?: string[];
  now?: () => string;
};

const REF_KEYS = new Set(['sourceRefs', 'subjectRefs', 'wordRefs', 'refs', 'factRefs', 'evidence', 'underRefs', 'fitRef', 'eventRef', 'sourceRef', 'ref', 'streamRef']);

export function validateFilmIR(input: unknown, options: ValidationOptions = {}): { report: ValidationReport; document: FilmIR | null } {
  const checks: ValidationCheck[] = [];
  const check = (id: string, title: string, critical: boolean, failures: string[], passMessage: string, warnOnly = false) => {
    checks.push({
      id,
      title,
      critical,
      status: failures.length === 0 ? 'pass' : warnOnly ? 'warn' : 'fail',
      message: failures.length === 0 ? passMessage : `${failures.length} problem(s): ${failures[0]}`,
      count: failures.length,
      examples: failures.slice(0, 8).map((f) => f.slice(0, 300)),
    });
  };

  const parsed = FilmIR.safeParse(input);
  if (!parsed.success) {
    check('schema', 'Schema validity', true, parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`), 'The document matches the schema.');
    return { report: finish(checks, options, null, {}), document: null };
  }
  const doc = parsed.data;
  check('schema', 'Schema validity', true, [], `actone.film-ir ${doc.version}, ${doc.mode}.`);

  // ——— evidence discipline ———
  const methodIds = new Set(doc.methods.map((method) => method.id));
  const evidenceMix: Record<string, number> = {};
  const provenanceFailures: string[] = [];
  const unsupported: string[] = [];
  const modeFailures: string[] = [];
  const refs: { ref: string; at: string }[] = [];
  walk(doc, '', (node, path) => {
    for (const [key, value] of Object.entries(node)) {
      if (!REF_KEYS.has(key)) continue;
      if (typeof value === 'string') refs.push({ ref: value, at: `${path}.${key}` });
      else if (Array.isArray(value)) for (const item of value) if (typeof item === 'string') refs.push({ ref: item, at: `${path}.${key}` });
    }
    if (typeof node['evidenceType'] !== 'string' || typeof node['method'] !== 'string') return;
    const type = node['evidenceType'] as EvidenceType;
    evidenceMix[type] = (evidenceMix[type] ?? 0) + 1;
    if (!methodIds.has(node['method'] as string)) provenanceFailures.push(`${path}: method "${node['method']}" is not registered`);
    const hasValue = 'value' in node;
    if (type === 'UNKNOWN') {
      if (hasValue && node['value'] !== null) provenanceFailures.push(`${path}: UNKNOWN carries a value`);
      if (node['confidence'] !== 0) provenanceFailures.push(`${path}: UNKNOWN with confidence ${node['confidence']}`);
    }
    if (type === 'SOURCE_EXACT' && node['confidence'] !== 1) provenanceFailures.push(`${path}: SOURCE_EXACT with confidence ${node['confidence']}`);
    if (hasValue && node['value'] === null && type !== 'UNKNOWN') provenanceFailures.push(`${path}: a ${type} value that is null should be UNKNOWN`);
    if (type === 'INFERRED' && (!Array.isArray(node['sourceRefs']) || (node['sourceRefs'] as unknown[]).length === 0)) {
      unsupported.push(`${path}: an inference with no evidence cited`);
    }
    if (doc.mode === 'reconstruction' && type === 'SPECIFIED') modeFailures.push(`${path}: SPECIFIED in a reconstruction`);
    if (doc.mode === 'plan' && (type === 'MEASURED' || type === 'SOURCE_EXACT')) modeFailures.push(`${path}: ${type} in a plan, which has nothing to measure`);
  });
  check('provenance', 'Every value knows where it came from', true, provenanceFailures, `${Object.values(evidenceMix).reduce((a, b) => a + b, 0)} evidenced values, all consistent with their evidence type.`);
  check('mode', 'Evidence types fit the mode', true, modeFailures, `No ${doc.mode === 'plan' ? 'measurements in a plan' : 'authored values in a reconstruction'}.`);
  check('unsupported', 'No inference without evidence', true, unsupported, 'Every inference cites what it rests on.');

  // ——— references ———
  const index = referenceIndex(doc);
  const unresolved = refs.filter(({ ref }) => !resolves(ref, index)).map(({ ref, at }) => `${at} → ${ref}`);
  check('references', 'Every reference resolves', true, unresolved, `${refs.length} references, all resolved.`);

  // ——— the frame table ———
  const frameFailures: string[] = [];
  const frames = doc.frames;
  if (doc.mode === 'reconstruction') {
    if (!frames || frames.count === 0) frameFailures.push('a reconstruction with no frames');
    else {
      const n = frames.count;
      for (const [name, column] of [['pts', frames.pts], ['durations', frames.durations], ['keyframe', frames.keyframe], ['pictureType', frames.pictureType], ['decodedHash', frames.decodedHash], ['repeatOf', frames.repeatOf]] as const) {
        if (column.length !== n) frameFailures.push(`${name} has ${column.length} rows for ${n} frames`);
      }
      for (let i = 1; i < frames.pts.length; i += 1) {
        if (BigInt(frames.pts[i]!) <= BigInt(frames.pts[i - 1]!)) {
          frameFailures.push(`presentation time does not increase at frame ${i}`);
          if (frameFailures.length > 5) break;
        }
      }
      frames.durations.forEach((duration, i) => {
        if (duration !== null && BigInt(duration) <= 0n) frameFailures.push(`frame ${i} has a non-positive duration`);
      });
      for (const series of [...frames.features, ...frames.vectors]) {
        if (series.values.length !== n) frameFailures.push(`${series.id} has ${series.values.length} values for ${n} frames`);
      }
    }
  }
  check('frames', 'Frame table complete and monotonic', true, frameFailures, frames ? `${frames.count} frames, timestamps strictly increasing.` : 'No frame table (plan).');

  const coverage = { frames: { expected: 0, analyzed: 0 }, audioSamples: { expected: 0, analyzed: 0 } };
  if (doc.source && frames) {
    const declared = doc.source.frameTiming?.decodedFrames ?? frames.count;
    coverage.frames = { expected: declared, analyzed: frames.features.length > 0 ? frames.count : 0 };
    const durationFailures: string[] = [];
    const container = doc.source.containerDuration;
    const last = doc.source.frameTiming?.lastPtsEnd ?? null;
    if (container && last && frames.count > 0) {
      const gap = Math.abs(seconds(subtractTime(container, last)));
      const frameSeconds = frames.durations[0] ? Number(frames.durations[0]) / frames.timescale : 0.04;
      if (gap > Math.max(2 * frameSeconds, 0.1)) durationFailures.push(`the container says ${seconds(container).toFixed(3)} s and the frames end at ${seconds(last).toFixed(3)} s`);
    }
    const audio = doc.source.audio[0];
    if (audio && doc.audio.analysis) {
      coverage.audioSamples = { expected: audio.decodedSamples, analyzed: doc.audio.analysis.analyzedSamples };
      if (audio.decodedSamples !== doc.audio.analysis.analyzedSamples) durationFailures.push(`${audio.decodedSamples} samples decoded, ${doc.audio.analysis.analyzedSamples} analysed`);
      const audioSeconds = doc.audio.analysis.analyzedSamples / doc.audio.analysis.sampleRate;
      if (last && Math.abs(audioSeconds - seconds(last)) > 0.25) durationFailures.push(`the audio runs ${audioSeconds.toFixed(3)} s and the picture ${seconds(last).toFixed(3)} s`);
    } else if (audio && !doc.audio.analysis) {
      durationFailures.push('the file has audio and none of it was analysed');
    }
    check('duration', 'Source duration and coverage consistent', true, durationFailures, 'Container, frames and audio agree on the length of the film.');
  }

  // ——— structure ———
  const structureFailures: string[] = [];
  if (frames && frames.count > 0 && doc.mode === 'reconstruction') {
    const covered = new Uint8Array(frames.count);
    const shots = [...doc.structure.shots].sort((a, b) => a.frames.first - b.frames.first);
    for (let i = 0; i < shots.length; i += 1) {
      const shot = shots[i]!;
      if (shot.frames.last >= frames.count) structureFailures.push(`${shot.id} ends past the last frame`);
      if (i > 0 && shot.frames.first <= shots[i - 1]!.frames.last) structureFailures.push(`${shot.id} overlaps ${shots[i - 1]!.id}`);
      for (let f = shot.frames.first; f <= Math.min(shot.frames.last, frames.count - 1); f += 1) covered[f] = 1;
    }
    for (const boundary of doc.structure.boundaries) {
      for (let f = boundary.span.first; f <= Math.min(boundary.span.last, frames.count - 1); f += 1) covered[f] = 1;
      if (boundary.frames.firstIncoming < boundary.frames.lastOutgoing) structureFailures.push(`${boundary.id} comes in before it goes out`);
    }
    const gaps = covered.reduce((count, value) => count + (value ? 0 : 1), 0);
    if (gaps > 0) structureFailures.push(`${gaps} frame(s) belong to no shot and no transition`);
  }
  check('structure', 'Shots and transitions cover the film', true, structureFailures, `${doc.structure.shots.length} shot(s), ${doc.structure.boundaries.length} boundary(ies), every frame accounted for.`);

  // ——— tracks ———
  const trackFailures: string[] = [];
  for (const object of doc.objects) {
    const count = object.sampleFrames.length;
    for (const [name, column] of Object.entries(object.columns)) {
      if ((column ?? []).length !== count) trackFailures.push(`${object.id}.${name} has ${(column ?? []).length} values for ${count} frames`);
      if (!object.columnProvenance[name as keyof typeof object.columnProvenance]) trackFailures.push(`${object.id}.${name} has no provenance`);
    }
    for (let i = 1; i < count; i += 1) {
      if (object.sampleFrames[i]! <= object.sampleFrames[i - 1]!) {
        trackFailures.push(`${object.id} samples are not in frame order at ${i}`);
        break;
      }
    }
    if (frames && object.sampleFrames.some((frame) => frame >= frames.count)) trackFailures.push(`${object.id} samples past the last frame`);
  }
  if (doc.camera) {
    for (const [name, column] of Object.entries(doc.camera.columns)) {
      if ((column ?? []).length !== doc.camera.sampleFrames.length) trackFailures.push(`camera.${name} has ${(column ?? []).length} values for ${doc.camera.sampleFrames.length} frames`);
    }
  }
  check('tracks', 'Object and camera tracks intact', true, trackFailures, `${doc.objects.length} object track(s) with every column aligned and sourced.`);

  // ——— timelines ———
  const timeFailures: string[] = [];
  // The film is every stream it carries: audio routinely starts a few
  // milliseconds before the first frame or runs on after the last, and what
  // happens there happens in the film.
  let filmStart = doc.source?.frameTiming?.firstPts ?? null;
  let filmEnd = doc.source?.frameTiming?.lastPtsEnd ?? doc.target?.duration ?? null;
  for (const stream of doc.source?.audio ?? []) {
    if (stream.startPts === null) continue;
    const start = rt(BigInt(stream.startPts) * BigInt(stream.timebase.num), stream.timebase.den);
    const end = addTime(start, rt(stream.decodedSamples, stream.sampleRate));
    filmStart = filmStart ? minTime(filmStart, start) : start;
    filmEnd = filmEnd ? maxTime(filmEnd, end) : end;
  }
  const within = (time: RationalTime, what: string) => {
    if (filmStart && compareTime(time, filmStart) < 0) timeFailures.push(`${what} is before the film starts`);
    if (filmEnd && compareTime(time, filmEnd) > 0) timeFailures.push(`${what} is after the film ends`);
  };
  for (const event of doc.events.events) {
    within(event.start, event.id);
    if (event.end && compareTime(event.end, event.start) < 0) timeFailures.push(`${event.id} ends before it starts`);
  }
  for (let i = 1; i < doc.events.events.length; i += 1) {
    if (compareTime(doc.events.events[i]!.start, doc.events.events[i - 1]!.start) < 0) {
      timeFailures.push(`events are not in time order at ${doc.events.events[i]!.id}`);
      break;
    }
  }
  const events = new Map(doc.events.events.map((event) => [event.id, event]));
  for (const relation of doc.events.relations) {
    const from = events.get(relation.from);
    const to = events.get(relation.to);
    if (!from || !to) continue;
    const recomputed = subtractTime(to[relation.toAnchor === 'start' ? 'start' : relation.toAnchor] ?? to.start, from[relation.fromAnchor === 'start' ? 'start' : relation.fromAnchor] ?? from.start);
    if (!sameTime(recomputed, relation.offset)) timeFailures.push(`${relation.id}: offset does not match its events`);
  }
  for (const block of doc.typography.blocks) {
    within(block.timing.firstVisible.value ?? filmStart ?? { ticks: '0', timescale: 1 }, `${block.id} first visible`);
  }
  check('timelines', 'Times inside the film and consistent', true, timeFailures, `${doc.events.events.length} event(s) and ${doc.events.relations.length} relation(s) consistent with the film's timeline.`);

  const orderWarnings: string[] = [];
  for (const block of doc.typography.blocks) {
    const order = [block.timing.firstVisible, block.timing.p10, block.timing.p25, block.timing.p50, block.timing.p75, block.timing.p90]
      .map((m) => m.value)
      .filter((v): v is RationalTime => v !== null);
    for (let i = 1; i < order.length; i += 1) if (compareTime(order[i]!, order[i - 1]!) < 0) orderWarnings.push(`${block.id}: visibility milestones out of order`);
  }
  check('milestones', 'Text milestones in order', false, orderWarnings, 'Every block becomes visible before it is half visible, and so on.', true);

  // ——— interpretation ———
  const contradictions = doc.contradictions.filter((c) => c.resolution === 'unresolved');
  check('contradictions', 'Contradictions resolved', false, contradictions.map((c) => `${c.id}: ${c.description}`), `${doc.contradictions.length} contradiction(s) found, all resolved in favour of the measurement or with reduced confidence.`, true);

  const passes = doc.producers.filter((producer) => producer.kind === 'model_pass' || producer.kind === 'integrator');
  const expected = options.expectedPasses ?? [];
  const passFailures: string[] = [];
  for (const id of expected) {
    const pass = passes.find((candidate) => candidate.id === id);
    if (!pass) passFailures.push(`${id} did not run`);
    else if (pass.status !== 'completed') passFailures.push(`${id} ${pass.status}`);
  }
  const empty = passes.filter((pass) => pass.notes.some((note) => note.startsWith('empty:')));
  for (const pass of empty) passFailures.push(`${pass.id} returned nothing usable`);
  check('passes', 'Every analysis pass completed', false, passFailures, `${passes.length} model pass(es), all completed.`, true);

  const critical: string[] = [];
  if (doc.mode === 'reconstruction') {
    if (doc.structure.shots.length === 0) critical.push('no shots');
    if (doc.source?.audio.length && !doc.audio.present) critical.push('the file has audio but the document has none');
    if (doc.producers.every((producer) => producer.kind !== 'analyzer')) critical.push('no deterministic analysis');
  }
  check('completeness', 'Critical analysis present', true, critical, 'Deterministic analysis, structure and audio are present.');

  const passCoverage = {
    expected: expected.length,
    completed: passes.filter((pass) => pass.status === 'completed').length,
    failed: passes.filter((pass) => pass.status === 'failed').length,
    empty: empty.length,
  };
  return { report: finish(checks, options, doc, evidenceMix, coverage, passCoverage), document: doc };
}

function finish(
  checks: ValidationCheck[],
  options: ValidationOptions,
  doc: FilmIR | null,
  evidenceMix: Record<string, number>,
  coverage = { frames: { expected: 0, analyzed: 0 }, audioSamples: { expected: 0, analyzed: 0 } },
  passes = { expected: 0, completed: 0, failed: 0, empty: 0 },
): ValidationReport {
  const failedCritical = checks.some((check) => check.critical && check.status === 'fail');
  const anyWarn = checks.some((check) => check.status !== 'pass');
  return {
    status: !doc || failedCritical ? 'FAILED' : anyWarn ? 'PARTIAL' : 'READY',
    validatorVersion: VALIDATOR_VERSION,
    checkedAt: options.now ? options.now() : new Date().toISOString(),
    checks,
    coverage: { ...coverage, passes },
    evidenceMix,
  };
}

function walk(value: unknown, path: string, visit: (node: Record<string, unknown>, path: string) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, visit));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const node = value as Record<string, unknown>;
  visit(node, path || '$');
  for (const [key, child] of Object.entries(node)) {
    if (child && typeof child === 'object') walk(child, path ? `${path}.${key}` : key, visit);
  }
}

type Index = {
  frames: number;
  samples: number;
  ids: Map<string, Set<string>>;
};

function referenceIndex(doc: FilmIR): Index {
  const ids = new Map<string, Set<string>>();
  const add = (kind: string, id: string) => {
    const set = ids.get(kind) ?? new Set<string>();
    set.add(id);
    ids.set(kind, set);
  };
  for (const object of doc.objects) {
    add('obj', object.id);
    for (const fit of object.fits) add('fit', fit.id);
  }
  for (const block of doc.typography.blocks) {
    add('text', block.id);
    for (const fit of [...block.enter.fits, ...block.exit.fits]) add('fit', fit.id);
  }
  for (const shot of doc.structure.shots) add('shot', shot.id);
  for (const boundary of doc.structure.boundaries) add('boundary', boundary.id);
  for (const beat of doc.structure.beats) add('beat', beat.id);
  for (const event of doc.events.events) add('evt', event.id);
  for (const move of doc.camera?.moves ?? []) {
    add('camera', move.id);
    for (const fit of move.fits) add('fit', fit.id);
  }
  for (const producer of doc.producers) {
    add('producer', producer.id);
    add('pass', producer.id);
  }
  for (const word of doc.narration.words) add('word', word.id);
  for (const phrase of doc.narration.phrases) add('phrase', phrase.id);
  for (const sentence of doc.narration.sentences) add('sentence', sentence.id);
  for (const event of doc.audio.events) add('audio_event', event.id);
  for (const series of [...(doc.frames?.features ?? []), ...(doc.frames?.vectors ?? []), ...doc.audio.series, ...doc.curves.measured, ...doc.curves.inferred]) add('series', series.id);
  for (const region of doc.product?.regions ?? []) add('region', region.id);
  for (const effect of doc.sound.sfx) add('sfx', effect.id);
  for (const silence of doc.sound.silences) add('silence', silence.id);
  for (const cluster of doc.events.clusters) add('sync', cluster.id);
  for (const pause of doc.narration.pauses) add('pause', pause.id);
  doc.sound.music.beats.times.forEach((_, i) => add('beat', String(i)));
  add('stream', 'v0');
  doc.source?.audio.forEach((_, i) => add('stream', `a${i}`));
  return { frames: doc.frames?.count ?? 0, samples: doc.audio.analysis?.analyzedSamples ?? 0, ids };
}

function resolves(ref: string, index: Index): boolean {
  const colon = ref.indexOf(':');
  if (colon < 0) return false;
  const kind = ref.slice(0, colon);
  const id = ref.slice(colon + 1);
  if (kind === 'frame') return /^\d+$/.test(id) && Number(id) < index.frames;
  if (kind === 'frames') {
    const match = /^(\d+)-(\d+)$/.exec(id);
    return Boolean(match) && Number(match![1]) <= Number(match![2]) && Number(match![2]) < index.frames;
  }
  if (kind === 'sample') return isInt64String(id) && Number(id) <= index.samples;
  return index.ids.get(kind)?.has(id) ?? false;
}

function seconds(time: RationalTime): number {
  return Number(BigInt(time.ticks)) / time.timescale;
}
