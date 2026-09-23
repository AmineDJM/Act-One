import type { FilmIR } from '../schema/document.ts';
import type { RationalTime, TimeRange } from '../schema/primitives.ts';
import { toSeconds } from '../time.ts';

/**
 * What software measured, as a model can read it.
 *
 * Not the measurements themselves — a model given sixty thousand numbers
 * attends to none of them — but an index of them: every shot, boundary, line
 * of type, panel, camera move, sound event and phrase, with its id and its
 * times, and a per-second digest of the curves. The ids are what a model's
 * answer must cite; an answer that cites nothing on this list is not merged
 * as a finding.
 */
export type EvidencePack = { text: string; ids: Set<string>; durationSeconds: number };

export function evidencePack(doc: FilmIR): EvidencePack {
  const ids = new Set<string>();
  const lines: string[] = [];
  const s = (time: RationalTime | null | undefined) => (time ? toSeconds(time).toFixed(3) : '?');
  const span = (range: TimeRange | null | undefined) => (range ? `${s(range.start)}–${s(range.end)}s` : '?');
  const note = (id: string) => {
    ids.add(id);
    return id;
  };

  const duration = doc.source?.frameTiming?.lastPtsEnd ? toSeconds(doc.source.frameTiming.lastPtsEnd) : 0;
  const video = doc.source?.video;
  lines.push('FILM');
  lines.push(`  duration ${duration.toFixed(3)}s; ${video?.width}×${video?.height}; ${doc.frames?.count ?? 0} frames; ${doc.source?.frameTiming?.variableFrameRate ? 'variable' : 'constant'} frame rate; audio ${doc.audio.present ? `${doc.audio.analysis?.sampleRate} Hz, ${doc.audio.analysis?.channels} ch` : 'none'}`);

  lines.push('SHOTS (measured: a shot is uninterrupted picture between boundaries)');
  for (const shot of doc.structure.shots) {
    lines.push(`  ${note(shot.id)} ${span(shot.range)} frames ${shot.frames.first}–${shot.frames.last}; colours ${shot.dominantColours.slice(0, 3).map((c) => `${c.hex} ${Math.round(c.share * 100)}%`).join(', ')}; mean motion ${shot.meanMotion?.toFixed(4) ?? '?'} frame-widths/frame`);
  }
  lines.push('BOUNDARIES (measured on the frames either side)');
  if (doc.structure.boundaries.length === 0) lines.push('  none: the picture is never replaced by a cut, fade or dissolve');
  for (const boundary of doc.structure.boundaries) {
    lines.push(`  ${note(boundary.id)} ${boundary.kind.value} at ${s(boundary.at)}s (span ${span(boundary.range)}); luma ${fmt(boundary.outgoing.lumaMean)}→${fmt(boundary.incoming.lumaMean)}, text ${boundary.outgoing.textPresent}→${boundary.incoming.textPresent}, audio ${fmt(boundary.outgoing.audioLevelDb)}→${fmt(boundary.incoming.audioLevelDb)} dBFS`);
  }

  lines.push('TEXT ON SCREEN (read by OCR, timed on every frame; times are first visible / half visible / settled / exit starts / last visible)');
  for (const block of doc.typography.blocks) {
    const t = block.timing;
    const enter = block.enter;
    const enterText = enter.durationMs.value === 0
      ? 'arrives with a cut'
      : `enters over ${enter.durationMs.value ?? '?'}ms${enter.translation.value ? `, moves (${enter.translation.value.dx}, ${enter.translation.value.dy})px` : ''}${enter.mask.value && enter.mask.value !== 'none' ? `, ${enter.mask.value}` : ''}${enter.stagger.value ? `, ${enter.stagger.value.unit} stagger ${enter.stagger.value.intervalsMs.join('/')}ms` : ''}${enter.fits[0] ? `, ${enter.fits[0].property} curve best fit ${enter.fits[0].model} (R² ${enter.fits[0].rSquared})` : ''}`;
    lines.push(`  ${note(block.id)} "${(block.text.value ?? '').replace(/\n/g, ' / ').slice(0, 160)}" ${s(t.firstVisible.value)} / ${s(t.p50.value)} / ${s(t.settled.value)} / ${s(t.exitStart.value)} / ${s(t.lastVisible.value)}s; box ${Math.round(block.box.x)},${Math.round(block.box.y)} ${Math.round(block.box.width)}×${Math.round(block.box.height)}px; ink ${block.metrics.colour.value ?? '?'}; ${enterText}; OCR confidence ${block.text.confidence}`);
    for (const id of block.objectIds) ids.add(id);
  }
  const panels = doc.objects.filter((object) => object.kind !== 'text_line');
  if (panels.length > 0) {
    lines.push('PANELS (rectangles found and tracked; what they are is not known)');
    for (const panel of panels) {
      const fits = panel.fits.map((fit) => `${fit.property} ${fit.from.toFixed(0)}→${fit.to.toFixed(0)} ${fit.model}`).join(', ');
      lines.push(`  ${note(panel.id)} ${panel.shotIds.join(',')} frames ${panel.frames.first}–${panel.frames.last}; box ${panel.referenceBox ? `${Math.round(panel.referenceBox.x)},${Math.round(panel.referenceBox.y)} ${Math.round(panel.referenceBox.width)}×${Math.round(panel.referenceBox.height)}` : '?'}${fits ? `; ${fits}` : ''}`);
    }
  }

  lines.push('APPARENT CAMERA (from tracked corners; "unobservable" means nothing trackable, "partial" means it may be one layer moving)');
  for (const shot of doc.camera?.shots ?? []) lines.push(`  ${shot.shotId}: ${shot.observability} — ${shot.reason}`);
  for (const move of doc.camera?.moves ?? []) {
    lines.push(`  ${note(move.id)} ${move.shotId} ${span(move.range)} ${move.type.value}; translation ${move.translationPx.value ?? '?'}px, scale ×${move.scaleRatio.value ?? '?'}, peak ${move.peakSpeedPxPerSecond.value ?? '?'}px/s`);
  }

  lines.push('SOUND (measured)');
  if (!doc.audio.present) lines.push('  no audio');
  else {
    const loud = doc.audio.loudness;
    lines.push(`  loudness ${loud?.integratedLufs.value ?? '?'} LUFS integrated, range ${loud?.loudnessRangeLu.value ?? '?'} LU, true peak ${loud?.truePeakDbtp.value ?? '?'} dBTP`);
    lines.push(`  music-like: ${doc.sound.music.present.value ?? 'unknown'} (${doc.sound.music.present.note ?? ''}); tempo ${doc.sound.music.tempoBpm.value ?? 'unknown'} BPM; key ${doc.sound.music.key.value ?? 'unknown'}`);
    for (const silence of doc.sound.silences) lines.push(`  ${note(silence.id)} silence ${span(silence.range)} at ${silence.levelDbfs} dBFS`);
    for (const effect of doc.sound.sfx.slice(0, 80)) lines.push(`  ${note(effect.id)} transient at ${s(effect.at)}s, strength ${effect.onsetStrength}, centroid ${effect.spectralCentroidHz} Hz`);
    const speech = doc.audio.events.filter((event) => event.kind === 'voice_start');
    lines.push(`  speech-like stretches start at: ${speech.map((event) => `${s(event.at)}s`).join(', ') || 'none detected'}`);
  }
  if (doc.narration.phrases.length > 0) {
    lines.push('NARRATION (transcribed; phrase times)');
    for (const phrase of doc.narration.phrases) lines.push(`  ${note(phrase.id)} ${span(phrase.range.value)} "${phrase.text.slice(0, 200)}"`);
    for (const word of doc.narration.words) if ((word.emphasis.value ?? 0) >= 0.7) lines.push(`  ${note(word.id)} emphasised "${word.text}" at ${s(word.range.value?.start)}s`);
  }

  const clusters = doc.events.clusters;
  if (clusters.length > 0) {
    lines.push('SYNC CLUSTERS (events of different kinds within 120 ms of each other; offsets from the anchor)');
    const events = new Map(doc.events.events.map((event) => [event.id, event]));
    for (const cluster of clusters.slice(0, 60)) {
      const members = cluster.members.map((member) => {
        const event = events.get(member.eventId);
        return `${note(member.eventId)} ${event?.type ?? '?'} ${Math.round(toSeconds(member.offset) * 1000)}ms`;
      });
      lines.push(`  ${note(cluster.id)} at ${s(events.get(cluster.anchor)?.start)}s: ${members.join('; ')}`);
    }
  }

  lines.push('PER-SECOND DIGEST (measured; motion = mean optical flow, text = share of frame covered by visible type, level = RMS dBFS)');
  const perSecond = digest(doc, Math.ceil(duration));
  lines.push(`  motion: ${perSecond.motion.join(' ')}`);
  lines.push(`  text:   ${perSecond.text.join(' ')}`);
  if (doc.audio.present) lines.push(`  level:  ${perSecond.level.join(' ')}`);
  return { text: lines.join('\n'), ids, durationSeconds: duration };
}

function digest(doc: FilmIR, seconds: number): { motion: string[]; text: string[]; level: string[] } {
  const frames = doc.frames;
  const motion: string[] = [];
  const text: string[] = [];
  const level: string[] = [];
  const flow = frames?.features.find((series) => series.id === 'frame.flow_mean')?.values ?? [];
  const occupancy = doc.curves.measured.find((series) => series.id === 'curve.text_occupancy')?.values ?? [];
  const pts = frames?.pts ?? [];
  const scale = frames?.timescale ?? 1;
  for (let second = 0; second < seconds; second += 1) {
    const indices: number[] = [];
    pts.forEach((value, i) => {
      const t = Number(value) / scale;
      if (t >= second && t < second + 1) indices.push(i);
    });
    const avg = (values: (number | null)[]) => {
      const picked = indices.map((i) => values[i]).filter((v): v is number => v !== null && v !== undefined);
      return picked.length ? picked.reduce((a, b) => a + b, 0) / picked.length : null;
    };
    const m = avg(flow);
    const o = avg(occupancy);
    motion.push(m === null ? '-' : m.toFixed(3));
    text.push(o === null ? '-' : o.toFixed(2));
  }
  const rms = doc.audio.series.find((series) => series.id === 'audio.rms_db');
  if (rms && rms.sampling.kind === 'regular') {
    const step = Number(rms.sampling.step.ticks) / rms.sampling.step.timescale;
    for (let second = 0; second < seconds; second += 1) {
      const from = Math.floor(second / step);
      const to = Math.floor((second + 1) / step);
      const values = rms.values.slice(from, to).filter((v): v is number => v !== null);
      level.push(values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(0) : '-');
    }
  }
  return { motion, text, level };
}

function fmt(value: number | null | undefined): string {
  return value === null || value === undefined ? '?' : value.toFixed(2);
}
