import { provenance } from '../evidence.ts';
import type { AudioIR, MusicIR, NarrationIR, SfxEvent } from '../schema/audio.ts';
import type { Provenance, RationalTime, Ref } from '../schema/primitives.ts';
import type { AVEvent, AVRelation, EventGraph, Modality, StructureIR, SyncCluster } from '../schema/structure.ts';
import type { TypographyIR } from '../schema/typography.ts';
import type { AttentionIR, CameraTrack, TrackedObject } from '../schema/visual.ts';
import { addTime, compareTime, rt, subtractTime, ticksOf } from '../time.ts';
import type { FrameClock, SampleClock } from './clock.ts';

/**
 * The film as one timeline of things happening, and how they line up.
 *
 * Every event carries the resolution it was observed at — a frame for what
 * is seen, a sample for an onset located to the sample, the analysis hop or
 * the recogniser's precision for what was only located that well — and every
 * offset between two events carries the sum of their resolutions as its
 * uncertainty. An offset of +42 ms between a word and a camera move is only
 * reported as +42 ms when both were observed finely enough to say so.
 */
const RELATION_WINDOW_MS = 250;
const CLUSTER_WINDOW_MS = 120;
/** Which event anchors a cluster: what a cut or a line of type lands on, rather than what lands on it. */
const PRIORITY: Modality[] = ['visual', 'typography', 'camera', 'motion', 'product', 'narration', 'sfx', 'music', 'audio', 'attention'];

type Pending = Omit<AVEvent, 'id'>;

export function buildEventGraph(input: {
  clock: FrameClock;
  samples: SampleClock | null;
  structure: StructureIR;
  typography: TypographyIR;
  camera: CameraTrack | null;
  objects: TrackedObject[];
  attention: AttentionIR | null;
  audio: AudioIR;
  music: MusicIR;
  sfx: SfxEvent[];
  narration: NarrationIR;
  fieldChanges: { frame: number; deltaE: number }[];
  crossfades: { lastOutgoing: number; firstIncoming: number; scores: Record<string, unknown> }[];
  hopResolution: RationalTime | null;
}): EventGraph {
  const { clock } = input;
  const frame = (index: number) => clock.duration(index);
  const pending: Pending[] = [];
  const add = (event: Pending) => pending.push(event);

  for (const boundary of input.structure.boundaries) {
    add({
      modality: 'visual',
      type: `boundary.${boundary.kind.value ?? 'unknown'}`,
      start: boundary.range.start,
      peak: boundary.at,
      end: boundary.range.end,
      magnitude: null,
      unit: '',
      resolution: frame(boundary.frames.firstIncoming),
      subjectRefs: [`boundary:${boundary.id}`],
      provenance: boundary.measurement,
    });
  }
  for (const change of input.fieldChanges) {
    add({
      modality: 'visual',
      type: 'visual.field_change',
      start: clock.at(change.frame),
      peak: null,
      end: null,
      magnitude: round(change.deltaE, 4),
      unit: 'oklab ΔE',
      resolution: frame(change.frame),
      subjectRefs: [`frame:${change.frame}`],
      provenance: provenance('MEASURED', 'boundary.field', ['producer:forensics', `frame:${change.frame}`]),
    });
  }
  for (const crossfade of input.crossfades) {
    const span = `frames:${crossfade.lastOutgoing}-${crossfade.firstIncoming}` as const;
    const kept = crossfade.scores['edgeChangeRatio'];
    const change = crossfade.scores['totalChange'];
    add({
      modality: 'visual',
      type: 'visual.crossfade',
      // As a boundary's range: after the last frame the mix has not touched, until the first it has completed.
      start: clock.end(crossfade.lastOutgoing),
      peak: null,
      end: clock.at(crossfade.firstIncoming),
      magnitude: typeof change === 'number' ? round(change, 4) : null,
      unit: 'mean luma change',
      resolution: frame(crossfade.firstIncoming),
      subjectRefs: [span],
      provenance: provenance('MEASURED', 'visual.crossfade', ['producer:forensics', span], 1, typeof kept === 'number' ? `part of the picture cross-fades while ${Math.round((1 - kept) * 100)}% of its edges stay: not a boundary` : undefined),
    });
  }
  for (const block of input.typography.blocks) {
    const milestones: [string, typeof block.timing.firstVisible][] = [
      ['text.first_visible', block.timing.firstVisible],
      ['text.half_visible', block.timing.p50],
      ['text.settled', block.timing.settled],
      ['text.exit_start', block.timing.exitStart],
      ['text.last_visible', block.timing.lastVisible],
    ];
    for (const [type, milestone] of milestones) {
      if (!milestone.value) continue;
      add({
        modality: 'typography',
        type,
        start: milestone.value,
        peak: null,
        end: null,
        magnitude: null,
        unit: '',
        resolution: frame(clock.frameAt(milestone.value)),
        subjectRefs: [`text:${block.id}`],
        provenance: withoutValue(milestone),
      });
    }
  }
  for (const move of input.camera?.moves ?? []) {
    for (const phase of move.phases) {
      add({
        modality: 'camera',
        type: `camera.${phase.kind}`,
        start: phase.at,
        peak: null,
        end: null,
        magnitude: phase.value,
        unit: phase.unit,
        resolution: frame(phase.frame),
        subjectRefs: [`camera:${move.id}`],
        provenance: phase.provenance,
      });
    }
  }
  for (const object of input.objects) {
    if (object.kind === 'text_line') continue;
    for (const phase of object.phases) {
      add({
        modality: 'motion',
        type: `motion.${phase.kind}`,
        start: phase.at,
        peak: null,
        end: null,
        magnitude: phase.value,
        unit: phase.unit,
        resolution: frame(phase.frame),
        subjectRefs: [`obj:${object.id}`],
        provenance: phase.provenance,
      });
    }
  }
  for (const shift of input.attention?.shifts ?? []) {
    add({
      modality: 'attention',
      type: 'attention.shift',
      start: shift.at,
      peak: null,
      end: null,
      magnitude: shift.distance,
      unit: 'frame fraction',
      resolution: frame(shift.frame),
      subjectRefs: [`frame:${shift.frame}`],
      provenance: shift.provenance,
    });
  }
  const sampleResolution = input.samples?.resolution ?? rt(1, 48000);
  const sfxAt = new Set(input.sfx.map((effect) => `${effect.at.ticks}/${effect.at.timescale}`));
  for (const event of input.audio.events) {
    if (event.kind === 'onset' || event.kind === 'transient') {
      const isSfx = sfxAt.has(`${event.at.ticks}/${event.at.timescale}`);
      add({
        modality: isSfx ? 'sfx' : 'audio',
        type: isSfx ? 'sfx.transient' : `audio.${event.kind}`,
        start: event.at,
        peak: null,
        end: null,
        magnitude: event.magnitude,
        unit: event.unit,
        resolution: sampleResolution,
        subjectRefs: [`audio_event:${event.id}`],
        provenance: event.provenance,
      });
    } else if (event.kind === 'silence' && event.range) {
      add({
        modality: 'audio',
        type: 'audio.silence',
        start: event.range.start,
        peak: null,
        end: event.range.end,
        magnitude: event.magnitude,
        unit: event.unit,
        resolution: sampleResolution,
        subjectRefs: [`audio_event:${event.id}`],
        provenance: event.provenance,
      });
    } else if (event.kind === 'voice_start' || event.kind === 'voice_end') {
      add({
        modality: 'narration',
        type: event.kind === 'voice_start' ? 'voice.start' : 'voice.end',
        start: event.at,
        peak: null,
        end: null,
        magnitude: event.magnitude,
        unit: event.unit,
        resolution: sampleResolution,
        subjectRefs: [`audio_event:${event.id}`],
        provenance: event.provenance,
      });
    }
  }
  if (input.music.beats.times.length > 0) {
    input.music.beats.times.forEach((time, index) => {
      add({
        modality: 'music',
        type: 'music.beat',
        start: time,
        peak: null,
        end: null,
        magnitude: null,
        unit: '',
        resolution: input.hopResolution ?? sampleResolution,
        subjectRefs: [`beat:${index}`],
        provenance: input.music.beats.provenance,
      });
    });
  }
  for (const phrase of input.narration.phrases) {
    if (!phrase.range.value) continue;
    add({
      modality: 'narration',
      type: 'narration.phrase_start',
      start: phrase.range.value.start,
      peak: null,
      end: phrase.range.value.end,
      magnitude: null,
      unit: '',
      resolution: resolutionOf(phrase.range),
      subjectRefs: [`phrase:${phrase.id}`],
      provenance: withoutValue(phrase.range),
    });
  }
  for (const word of input.narration.words) {
    if (!word.range.value || (word.emphasis.value ?? 0) < 0.6) continue;
    add({
      modality: 'narration',
      type: 'narration.emphasis',
      start: word.range.value.start,
      peak: null,
      end: word.range.value.end,
      magnitude: word.emphasis.value,
      unit: 'emphasis',
      resolution: resolutionOf(word.range),
      subjectRefs: [`word:${word.id}`],
      provenance: withoutValue(word.emphasis),
    });
  }

  pending.sort((a, b) => compareTime(a.start, b.start) || PRIORITY.indexOf(a.modality) - PRIORITY.indexOf(b.modality) || a.type.localeCompare(b.type));
  const events: AVEvent[] = pending.map((event, index) => ({ ...event, id: `evt.${String(index + 1).padStart(4, '0')}` }));
  return { events, relations: relate(events), clusters: cluster(events) };
}

function relate(events: AVEvent[]): AVRelation[] {
  const relations: AVRelation[] = [];
  const seen = new Set<string>();
  const window = rt(RELATION_WINDOW_MS, 1000);
  for (let i = 0; i < events.length; i += 1) {
    const from = events[i]!;
    const nearest = new Map<Modality, { event: AVEvent; distance: RationalTime }>();
    for (let j = i + 1; j < events.length; j += 1) {
      const to = events[j]!;
      const offset = subtractTime(to.start, from.start);
      if (compareTime(offset, window) > 0) break;
      if (to.modality === from.modality) continue;
      const known = nearest.get(to.modality);
      if (!known || compareTime(offset, known.distance) < 0) nearest.set(to.modality, { event: to, distance: offset });
    }
    for (let j = i - 1; j >= 0; j -= 1) {
      const to = events[j]!;
      const offset = subtractTime(from.start, to.start);
      if (compareTime(offset, window) > 0) break;
      if (to.modality === from.modality) continue;
      const known = nearest.get(to.modality);
      if (!known || compareTime(offset, known.distance) < 0) nearest.set(to.modality, { event: to, distance: offset });
    }
    for (const { event: to } of nearest.values()) {
      const key = from.id < to.id ? `${from.id}|${to.id}` : `${to.id}|${from.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const [a, b] = compareTime(from.start, to.start) <= 0 ? [from, to] : [to, from];
      const offset = subtractTime(b.start, a.start);
      const uncertainty = addTime(a.resolution, b.resolution);
      relations.push({
        id: `rel.${String(relations.length + 1).padStart(5, '0')}`,
        from: a.id,
        to: b.id,
        fromAnchor: 'start',
        toAnchor: 'start',
        offset,
        uncertainty,
        kind: compareTime(offset, uncertainty) <= 0 ? 'coincident' : 'precedes',
        provenance: provenance(
          weakest(a.provenance, b.provenance),
          'events.relations',
          [`evt:${a.id}`, `evt:${b.id}`],
          Math.min(a.provenance.confidence, b.provenance.confidence),
        ),
      });
    }
  }
  return relations;
}

function cluster(events: AVEvent[]): SyncCluster[] {
  const clusters: SyncCluster[] = [];
  const used = new Set<string>();
  const window = rt(CLUSTER_WINDOW_MS, 1000);
  for (let i = 0; i < events.length; i += 1) {
    const first = events[i]!;
    if (used.has(first.id)) continue;
    const members = [first];
    for (let j = i + 1; j < events.length; j += 1) {
      const next = events[j]!;
      if (compareTime(subtractTime(next.start, first.start), window) > 0) break;
      if (!used.has(next.id)) members.push(next);
    }
    const modalities = new Set(members.map((member) => member.modality));
    if (members.length < 3 || modalities.size < 2) continue;
    const anchor = [...members].sort((a, b) => PRIORITY.indexOf(a.modality) - PRIORITY.indexOf(b.modality))[0]!;
    for (const member of members) used.add(member.id);
    const starts = members.map((member) => member.start).sort(compareTime);
    clusters.push({
      id: `sync.${String(clusters.length + 1).padStart(4, '0')}`,
      anchor: anchor.id,
      members: members.map((member) => ({ eventId: member.id, offset: subtractTime(member.start, anchor.start) })),
      spread: subtractTime(starts[starts.length - 1]!, starts[0]!),
      interpretation: null,
    });
  }
  return clusters;
}

const ORDER: Provenance['evidenceType'][] = ['SOURCE_EXACT', 'MEASURED', 'ESTIMATED', 'INFERRED', 'UNKNOWN'];

/** An offset is only as good as the weaker of the two times it is computed from. */
function weakest(a: Provenance, b: Provenance): Provenance['evidenceType'] {
  const rank = (type: Provenance['evidenceType']) => {
    const index = ORDER.indexOf(type);
    return index < 0 ? ORDER.length : index;
  };
  const worst = rank(a.evidenceType) >= rank(b.evidenceType) ? a.evidenceType : b.evidenceType;
  // Two measured times give a measured offset; anything weaker is carried through as it is.
  return worst === 'SOURCE_EXACT' ? 'MEASURED' : worst;
}

function withoutValue(value: Provenance & { value?: unknown }): Provenance {
  const out: Provenance = {
    evidenceType: value.evidenceType,
    confidence: value.confidence,
    method: value.method,
    sourceRefs: value.sourceRefs,
  };
  if (value.note !== undefined) out.note = value.note;
  return out;
}

function resolutionOf(range: { lowerBound?: { start: RationalTime; end: RationalTime }; value: { start: RationalTime } | null }): RationalTime {
  if (range.lowerBound && range.value) {
    const spread = subtractTime(range.value.start, range.lowerBound.start);
    return ticksOf(spread) < 0n ? rt(-ticksOf(spread), spread.timescale) : spread;
  }
  return rt(1, 100);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

