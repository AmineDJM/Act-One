import type { FilmIR } from '@act-one/film-ir';
import { seconds, show, time, type TimeLike } from '../format.ts';

/**
 * A stretch of film told as a composition: where the model placed it in the
 * story, the shots and every boundary between them to the frame, the camera,
 * what the type does, what is heard, and what lands together.
 *
 * Measured and inferred are said as such in every sentence. Type is told by
 * what it does rather than line by line: what a boundary takes away or brings
 * is counted with the largest named, and only type that moves on its own is
 * told one line at a time — in a film of interface footage, the menus
 * otherwise drown the composition.
 */
export function composeWindow(doc: FilmIR, from: number, to: number): string[] {
  const eventById = new Map(doc.events.events.map((event) => [event.id, event]));
  const beatsIn = (a: number, b: number) => doc.sound.music.beats.times.filter((beat) => { const t = seconds(beat)!; return t >= a && t < b; }).length;
  const blocksHere = doc.typography.blocks.filter((block) => {
    const a = seconds(block.timing.firstVisible.value);
    const b = seconds(block.timing.lastVisible.value);
    return a !== null && b !== null && a < to && b >= from;
  });
  const startsHere = (value: TimeLike | null) => { const t = seconds(value); return t !== null && t >= from && t < to; };
  const overlaps = (range: { start: TimeLike; end: TimeLike } | null | undefined) => {
    const a = seconds(range?.start ?? null);
    const b = seconds(range?.end ?? null);
    return a !== null && b !== null && a < to && b >= from;
  };
  const quote = (text: unknown, max = 60) => {
    const flat = String(show(text)).replace(/\s+/g, ' ');
    return `“${flat.length > max ? `${flat.slice(0, max - 1)}…` : flat}”`;
  };
  // The largest type first: in a film of interface footage, what the eye reads is the headline, not the menu.
  // By the estimated size, which every line has; a cap height needs glyph outlines and is almost always unknown.
  const size = (block: (typeof blocksHere)[number]) => Number(block.metrics.approxSizePx.value) || 0;
  const bySize = (blocks: typeof blocksHere) => [...blocks].sort((a, b) => size(b) - size(a));
  const named = (blocks: typeof blocksHere, count = 3) => {
    const top = bySize(blocks).slice(0, count).map((block) => `${block.id} ${quote(block.text.value)}`);
    return `${top.join(', ')}${blocks.length > count ? ` and ${blocks.length - count} more` : ''}`;
  };

  const story: string[] = [];
  // Where the model placed this window in the film's story: context, not measurement.
  for (const scene of doc.structure.scenes.filter((candidate) => overlaps(candidate.range.value))) {
    story.push(`Inside ${scene.id} ${quote(scene.label.value)} (inferred by the model).`);
  }
  for (const beat of doc.structure.beats.filter((candidate) => overlaps(candidate.range.value))) {
    story.push(`Narrative beat ${beat.id}, ${show(beat.function.value)}: ${quote(beat.summary.value, 200)} (inferred).`);
  }

  // Picture: the shots, and every boundary between them.
  for (const shot of doc.structure.shots.filter((candidate) => overlaps(candidate.range))) {
    story.push(`${shot.id}, frames ${shot.frames.first}–${shot.frames.last} (${time(shot.range.start)}–${time(shot.range.end)}): ${shot.dominantColours.slice(0, 3).map((colour) => `${colour.hex} ${Math.round(colour.share * 100)}%`).join(', ')}; mean motion ${shot.meanMotion?.toFixed(4) ?? '?'} frame-widths a frame (measured).`);
  }
  const boundariesHere = doc.structure.boundaries.filter((candidate) => startsHere(candidate.at) || overlaps(candidate.range));
  for (const boundary of boundariesHere) {
    const frames = boundary.frames.firstIncoming - boundary.frames.lastOutgoing;
    story.push(`${boundary.id}: a ${show(boundary.kind.value)} (${boundary.kind.evidenceType.toLowerCase()}) — frame ${boundary.frames.lastOutgoing} is the last untouched, frame ${boundary.frames.firstIncoming} the first complete${frames > 1 ? `, ${frames - 1} mixed frame(s) between` : ''}; luma ${boundary.outgoing.lumaMean?.toFixed(3) ?? '?'} → ${boundary.incoming.lumaMean?.toFixed(3) ?? '?'}.${boundary.description?.value ? ` The model reads it as ${quote(boundary.description.value, 200)} (inferred).` : ''}`);
  }
  for (const move of (doc.camera?.moves ?? []).filter((candidate) => overlaps(candidate.range))) {
    story.push(`${move.id}: ${show(move.type.value)} over frames ${move.frames.first}–${move.frames.last} (${move.type.evidenceType.toLowerCase()}, ${move.type.confidence.toFixed(2)}).`);
  }

  // Type, by what it does here: what a boundary takes away or brings is counted, the largest named; what moves on its own is told line by line.
  const leavesWith = new Map<string, typeof blocksHere>();
  const arrivesWith = new Map<string, typeof blocksHere>();
  const onItsOwn: string[] = [];
  const holding: typeof blocksHere = [];
  for (const block of blocksHere) {
    const leaving = boundariesHere.find((boundary) => block.frames.last >= boundary.frames.lastOutgoing && block.frames.last < boundary.frames.firstIncoming);
    const arriving = boundariesHere.find((boundary) => block.frames.first > boundary.frames.lastOutgoing && block.frames.first <= boundary.frames.firstIncoming);
    if (leaving) leavesWith.set(leaving.id, [...(leavesWith.get(leaving.id) ?? []), block]);
    if (arriving) arrivesWith.set(arriving.id, [...(arrivesWith.get(arriving.id) ?? []), block]);
    // What a boundary already accounts for is not told again: type that arrives whole with a cut has not moved.
    const settledWithArrival = arriving !== undefined && (seconds(block.timing.settled.value) ?? Infinity) <= (seconds(arriving.range.end) ?? -Infinity) + 1e-6;
    const milestones = (['firstVisible', 'p50', 'settled', 'exitStart', 'lastVisible'] as const)
      .filter((key) => startsHere(block.timing[key].value))
      .filter((key) => !(arriving && (key === 'firstVisible' || key === 'p50' || (key === 'settled' && settledWithArrival))) && !(leaving && (key === 'exitStart' || key === 'lastVisible')));
    if (milestones.length) {
      const enters = milestones.includes('firstVisible') && block.enter.durationMs.value ? `; enters over ${show(block.enter.durationMs.value)} ms` : '';
      const exits = milestones.includes('exitStart') && block.exit.durationMs.value ? `; leaves over ${show(block.exit.durationMs.value)} ms` : '';
      // A milestone inside a transition is the transition mixing the frame, not the type moving: said, not hidden.
      const during = (value: TimeLike | null) => {
        const t = seconds(value);
        const mixing = t === null ? undefined : boundariesHere.find((boundary) => (seconds(boundary.range.end) ?? 0) > (seconds(boundary.range.start) ?? 0) && t >= seconds(boundary.range.start)! && t <= seconds(boundary.range.end)!);
        return mixing ? ` (during ${mixing.id})` : '';
      };
      onItsOwn.push(`${block.id} ${quote(block.text.value)}: ${milestones.map((key) => `${key} ${time(block.timing[key].value)}${during(block.timing[key].value)}`).join(', ')}${enters}${exits}.`);
    } else if (!leaving && !arriving) {
      holding.push(block);
    }
  }
  for (const [boundaryId, blocks] of leavesWith) story.push(`${blocks.length} line(s) of type leave with ${boundaryId}: ${named(blocks)}.`);
  for (const [boundaryId, blocks] of arrivesWith) story.push(`${blocks.length} line(s) of type arrive with ${boundaryId}: ${named(blocks)}.`);
  story.push(...onItsOwn);
  if (holding.length) story.push(`${holding.length} line(s) hold throughout: ${named(holding)}.`);

  // Sound, and what lands with what.
  const heard = doc.audio.events.filter((event) => { const t = seconds(event.at)!; return t >= from && t < to; });
  if (heard.length) story.push(`Heard: ${heard.map((event) => `${event.kind.replace('_', ' ')} at ${time(event.at)}`).join(', ')} (measured).`);
  const beatCount = beatsIn(from, to);
  if (beatCount) {
    const tempo = doc.sound.music.tempoBpm;
    story.push(`${beatCount} musical beat(s) fall in the window${tempo.value ? `, on a ${show(tempo.value)} BPM grid` : ''} (${doc.sound.music.beats.provenance.evidenceType.toLowerCase()}, ${doc.sound.music.beats.provenance.confidence.toFixed(2)}).`);
  }
  for (const cluster of doc.events.clusters) {
    const anchor = eventById.get(cluster.anchor);
    if (anchor && startsHere(anchor.start)) story.push(`${cluster.id}: ${cluster.members.length} events from ${new Set(cluster.members.map((member) => eventById.get(member.eventId)?.modality ?? '?')).size} sense(s) land within ${((seconds(cluster.spread) ?? 0) * 1000).toFixed(0)} ms of ${anchor.type} at ${time(anchor.start)}${cluster.interpretation?.value ? ` — read as ${quote(cluster.interpretation.value, 200)} (inferred)` : ''}.`);
  }

  return story;
}
