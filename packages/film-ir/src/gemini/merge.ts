import type { z } from 'zod';
import { inferred, provenance, recommended, unknown, type Evidenced } from '../evidence.ts';
import type { Measured } from '../compile/deterministic.ts';
import type { FilmIR } from '../schema/document.ts';
import type { Contradiction, InterpretationIR, Mechanism, Observation, UnsupportedHypothesis } from '../schema/interpretation.ts';
import type { Ref, Series, TimeRange } from '../schema/primitives.ts';
import type { Method, Producer } from '../schema/source.ts';
import type { Beat } from '../schema/structure.ts';
import { fromSeconds, rt, toSeconds } from '../time.ts';
import { wordErrorRate } from '../narration/asr.ts';
import type { EvidencePack } from './evidence-pack.ts';
import type { Integrator, P01Holistic, P02Narrative, P03Composition, P04CameraMotion, P05Audio, P06Sync, P07Transitions, P08Moments, P09Reconstruction, P10Grammar, PassId } from './passes.ts';
import { PASSES } from './passes.ts';
import type { PassRecord } from './run.ts';

/**
 * A model's answers, merged into the measured document.
 *
 * Every claim goes through the same gate. Its citations are resolved against
 * the document; a claim that cites nothing that exists is not merged but
 * listed as unsupported. Its times are stored on a millisecond clock with the
 * bounds the pass's sampling allows. Where it overlaps a measurement it is
 * checked against it: a beat starting where nothing measurable changes loses
 * confidence, a sound labelled where no transient was measured is refused, a
 * camera move claimed on a shot whose camera is unobservable is recorded as a
 * contradiction and the measurement is kept. Nothing here overwrites a
 * measured value.
 *
 * A model's confidence in its own answer is not calibrated against anything.
 * It is kept for ranking one claim against another, and held below a ceiling
 * so that no interpretation ever carries the confidence of a measurement.
 */
export type GeminiMerge = { document: FilmIR; producers: Producer[]; methods: Method[] };

export const MODEL_CONFIDENCE_CEILING = 0.75;
/** Below all of these a window shows nothing changing at all: calibrated on held frames, where each is zero. */
const CHANGE_FLOOR = { flowMean: 0.0008, pixelDifferenceSum: 0.005, edgeChangeMax: 0.3 };

export function mergeGemini(document: FilmIR, measured: Measured, records: Record<string, PassRecord>, pack: EvidencePack): GeminiMerge {
  const doc: FilmIR = structuredClone(document);
  const clock = measured.clock;
  const duration = pack.durationSeconds;
  const contradictions: Contradiction[] = [...doc.contradictions];
  const unsupported: UnsupportedHypothesis[] = [...doc.unsupported];
  const observations: Observation[] = [];
  const invalidCitations = new Map<string, number>();

  const known = knownIds(doc);
  const methodFor = (passId: string) => (records[passId] ? `model.gemini.${passId}` : 'compiler.absent');
  const passRef = (passId: string): Ref => `pass:${passId}`;
  const passRefs = (passId: string): Ref[] => (records[passId] ? [passRef(passId)] : []);

  const cite = (passId: string, evidence: string[]): Ref[] => {
    const refs: Ref[] = [];
    for (const raw of evidence) {
      const ref = toRef(raw.trim(), known, clock, duration);
      if (ref) refs.push(ref);
      else invalidCitations.set(passId, (invalidCitations.get(passId) ?? 0) + 1);
    }
    return [...new Set(refs)];
  };
  const refuse = (passId: string, claim: string, reason: string) => {
    unsupported.push({ id: `unsupported.${String(unsupported.length + 1).padStart(4, '0')}`, claim: claim.slice(0, 1200), sourceRef: passRef(passId), reason });
  };
  /** A string claim, merged when it cites something real and says something. */
  const claim = (passId: string, value: { value: string | null; evidence: string[]; confidence: number } | undefined, what: string): Evidenced<string> => {
    if (!value || value.value === null || value.value.trim() === '') return unknown(methodFor(passId), `The ${what} was not stated.`, passRefs(passId));
    const refs = cite(passId, value.evidence);
    if (refs.length === 0) {
      refuse(passId, `${what}: ${value.value}`, 'no evidence cited that exists in the document');
      return unknown(methodFor(passId), `The ${what} was offered without evidence and not kept.`, passRefs(passId));
    }
    return inferred(value.value.trim(), methodFor(passId), [passRef(passId), ...refs], value.confidence);
  };
  const halfStep = (passId: string) => {
    const fps = PASSES.find((pass) => pass.id === passId)?.fps ?? 1;
    return 0.5 / fps;
  };
  const range = (passId: string, start: number, end: number, refs: Ref[], confidence: number): Evidenced<TimeRange> | null => {
    if (!(start >= 0 && end >= start && start <= duration + 0.5)) return null;
    const half = halfStep(passId);
    const clampEnd = Math.min(end, duration);
    return inferred(
      { start: fromSeconds(start, 1000), end: fromSeconds(clampEnd, 1000) },
      methodFor(passId),
      [passRef(passId), ...refs],
      confidence,
      {
        lowerBound: { start: fromSeconds(Math.max(0, start - half), 1000), end: fromSeconds(Math.max(0, clampEnd - half), 1000) },
        upperBound: { start: fromSeconds(Math.min(duration, start + half), 1000), end: fromSeconds(Math.min(duration, clampEnd + half), 1000) },
        note: `times from a pass sampling at ${1 / (2 * half)} frame(s) per second`,
      },
    );
  };

  const output = <T extends z.ZodTypeAny>(id: PassId | 'integrator'): z.infer<T> | null => {
    const record = records[id];
    return record && record.status === 'completed' ? (underCeiling(record.output) as z.infer<T>) : null;
  };

  // ——— identity (p01) ———
  const p01 = output<typeof P01Holistic>('p01_holistic');
  const identity: InterpretationIR['identity'] = {
    summary: p01 ? inferred(p01.summary, methodFor('p01_holistic'), [passRef('p01_holistic'), ...allTextRefs(doc)], 0.7) : unknown('compiler.absent', 'The holistic pass did not complete.'),
    subject: claim('p01_holistic', p01?.subject, 'subject'),
    format: claim('p01_holistic', p01?.format, 'format'),
    audience: claim('p01_holistic', p01?.audience, 'audience'),
    language: claim('p01_holistic', p01?.language, 'language'),
  };

  // ——— narrative (p02) ———
  const p02 = output<typeof P02Narrative>('p02_narrative');
  const measuredChanges = changeTimes(doc);
  const beats: Beat[] = [];
  for (const beat of p02?.beats ?? []) {
    const refs = cite('p02_narrative', [...beat.evidence, ...beat.shotIds]);
    if (refs.length === 0) {
      refuse('p02_narrative', `beat ${beat.startSeconds}-${beat.endSeconds}s: ${beat.summary}`, 'no evidence cited that exists');
      continue;
    }
    const nearest = nearestChange(measuredChanges, beat.startSeconds);
    const corroborated = nearest !== null && Math.abs(nearest.seconds - beat.startSeconds) <= 0.25 + halfStep('p02_narrative');
    const confidence = corroborated ? Math.min(1, beat.confidence) : beat.confidence * 0.7;
    const r = range('p02_narrative', beat.startSeconds, beat.endSeconds, corroborated ? [...refs, nearest!.ref] : refs, confidence);
    if (!r) {
      refuse('p02_narrative', `beat ${beat.startSeconds}-${beat.endSeconds}s`, 'times outside the film');
      continue;
    }
    if (!corroborated) r.note = `${r.note}; nothing measurable changes within 0.25 s of its start`;
    beats.push({
      id: `beat.${String(beats.length + 1).padStart(3, '0')}`,
      range: r,
      function: inferred(beat.function, methodFor('p02_narrative'), [passRef('p02_narrative'), ...refs], confidence),
      summary: inferred(beat.summary, methodFor('p02_narrative'), [passRef('p02_narrative'), ...refs], confidence),
      shotIds: beat.shotIds.filter((id) => known.has(`shot:${id}`)),
      refs,
    });
  }
  doc.structure.beats = beats;
  doc.structure.scenes = (p02?.scenes ?? []).flatMap((scene, index) => {
    const refs = cite('p02_narrative', [...scene.evidence, ...scene.shotIds]);
    const r = range('p02_narrative', scene.startSeconds, scene.endSeconds, refs, scene.confidence);
    if (refs.length === 0 || !r) {
      refuse('p02_narrative', `scene ${scene.label}`, refs.length === 0 ? 'no evidence cited that exists' : 'times outside the film');
      return [];
    }
    return [{ id: `scene.${String(index + 1).padStart(3, '0')}`, range: r, shotIds: scene.shotIds.filter((id) => known.has(`shot:${id}`)), label: inferred(scene.label, methodFor('p02_narrative'), [passRef('p02_narrative'), ...refs], scene.confidence) }];
  });
  const acts: InterpretationIR['narrative']['acts'] = (p02?.acts ?? []).flatMap((act, index) => {
    const refs = cite('p02_narrative', act.evidence);
    const r = range('p02_narrative', act.startSeconds, act.endSeconds, refs, act.confidence);
    if (refs.length === 0 || !r) {
      refuse('p02_narrative', `act ${act.label}`, refs.length === 0 ? 'no evidence cited that exists' : 'times outside the film');
      return [];
    }
    return [{
      id: `act.${String(index + 1).padStart(2, '0')}`,
      range: r,
      label: inferred(act.label, methodFor('p02_narrative'), [passRef('p02_narrative'), ...refs], act.confidence),
      summary: inferred(act.summary, methodFor('p02_narrative'), [passRef('p02_narrative'), ...refs], act.confidence),
    }];
  });

  // ——— composition, product, typography (p03) ———
  const p03 = output<typeof P03Composition>('p03_composition');
  for (const entry of p03?.textBlocks ?? []) {
    const block = doc.typography.blocks.find((candidate) => candidate.id === entry.id);
    if (!block) {
      refuse('p03_composition', `text block ${entry.id} (${entry.classification})`, 'no such text block');
      continue;
    }
    const refs: Ref[] = [passRef('p03_composition'), `text:${block.id}`];
    block.classification = inferred(entry.classification, methodFor('p03_composition'), refs, entry.confidence);
    block.metrics.fontCategory = entry.fontCategory
      ? inferred(entry.fontCategory, methodFor('p03_composition'), refs, Math.min(entry.confidence, 0.6), { note: 'a category only; no family is identified' })
      : unknown(methodFor('p03_composition'), 'No category offered.', refs);
    for (const objectId of block.objectIds) {
      const object = doc.objects.find((candidate) => candidate.id === objectId);
      if (object) object.role = inferred(entry.role, methodFor('p03_composition'), refs, entry.confidence);
    }
    if (entry.reading && block.text.value) {
      const similarity = 1 - levenshtein(normalise(entry.reading), normalise(block.text.value)) / Math.max(1, normalise(block.text.value).length);
      if (similarity < 0.95) {
        contradictions.push({
          id: `contradiction.${String(contradictions.length + 1).padStart(4, '0')}`,
          refs: [`text:${block.id}`, passRef('p03_composition')],
          description: `OCR read "${block.text.value.replace(/\n/g, ' / ').slice(0, 200)}"; the model reads "${entry.reading.slice(0, 200)}".`,
          resolution: 'confidence_reduced',
          severity: similarity < 0.7 ? 'medium' : 'low',
        });
        block.text.confidence = Math.round(block.text.confidence * (similarity < 0.7 ? 0.5 : 0.8) * 1000) / 1000;
        block.text.note = `a second reading disagrees: "${entry.reading.slice(0, 200)}"`;
      }
    }
  }
  if (doc.product && p03) {
    const shown = p03.productShown;
    const refs = cite('p03_composition', shown.evidence);
    if (shown.value && refs.length > 0) {
      const yes = /^(yes|true)/i.test(shown.value.trim());
      doc.product.interfaceShown = inferred(yes, methodFor('p03_composition'), [passRef('p03_composition'), ...refs], shown.confidence);
    }
    for (const entry of p03.productRegions) {
      const region = entry.objectId ? doc.product.regions.find((candidate) => candidate.objectId === entry.objectId) : undefined;
      const refs2 = cite('p03_composition', entry.evidence);
      if (!region || refs2.length === 0) {
        refuse('p03_composition', `product region ${entry.label}`, region ? 'no evidence cited that exists' : 'not one of the tracked panels');
        continue;
      }
      region.kind = inferred(entry.kind, methodFor('p03_composition'), [passRef('p03_composition'), ...refs2], entry.confidence);
      region.label = inferred(entry.label, methodFor('p03_composition'), [passRef('p03_composition'), ...refs2], entry.confidence);
    }
    doc.product.moments = p03.productMoments.flatMap((moment, index) => {
      const refs2 = cite('p03_composition', moment.evidence);
      const r = range('p03_composition', moment.startSeconds, moment.endSeconds, refs2, moment.confidence);
      if (refs2.length === 0 || !r || !r.value) {
        refuse('p03_composition', `product moment: ${moment.description}`, 'no evidence or times outside the film');
        return [];
      }
      return [{ id: `product.moment.${String(index + 1).padStart(3, '0')}`, range: r.value, description: inferred(moment.description, methodFor('p03_composition'), [passRef('p03_composition'), ...refs2], moment.confidence), regionIds: [], refs: refs2 }];
    });
  }
  for (const entry of p03?.shots ?? []) {
    const shot = doc.structure.shots.find((candidate) => candidate.id === entry.id);
    const refs = cite('p03_composition', entry.evidence);
    if (!shot) continue;
    shot.description = inferred(entry.composition, methodFor('p03_composition'), [passRef('p03_composition'), `shot:${shot.id}`, ...refs], entry.confidence);
  }

  // ——— camera and motion (p04) ———
  const p04 = output<typeof P04CameraMotion>('p04_camera_motion');
  for (const entry of p04?.cameraMoves ?? []) {
    const refs = cite('p04_camera_motion', entry.evidence);
    const move = entry.id ? doc.camera?.moves.find((candidate) => candidate.id === entry.id) : undefined;
    if (move) {
      move.description = inferred(`${entry.agent}: ${entry.interpretation}`, methodFor('p04_camera_motion'), [passRef('p04_camera_motion'), `camera:${move.id}`, ...refs], entry.confidence);
      continue;
    }
    // A camera move the measurements did not list: only kept where the camera was observable at that time.
    const time = windowStart(entry.evidence);
    const shot = time === null ? undefined : doc.structure.shots.find((candidate) => toSeconds(candidate.range.start) <= time && toSeconds(candidate.range.end) > time);
    const observability = shot ? doc.camera?.shots.find((candidate) => candidate.shotId === shot.id)?.observability : undefined;
    if (entry.agent === 'camera' && observability === 'unobservable' && shot) {
      contradictions.push({
        id: `contradiction.${String(contradictions.length + 1).padStart(4, '0')}`,
        refs: [`shot:${shot.id}`, passRef('p04_camera_motion')],
        description: `A camera move is described in ${shot.id}, where nothing trackable moves as a camera would: "${entry.interpretation.slice(0, 200)}".`,
        resolution: 'measurement_kept',
        severity: 'medium',
      });
      continue;
    }
    if (refs.length === 0) {
      refuse('p04_camera_motion', `camera: ${entry.interpretation}`, 'no evidence cited that exists');
      continue;
    }
    observations.push(observation('camera', inferred(`${entry.agent}: ${entry.interpretation}`, methodFor('p04_camera_motion'), [passRef('p04_camera_motion'), ...refs], entry.confidence * 0.8), null));
  }
  for (const entry of p04?.objectMotion ?? []) {
    const refs = cite('p04_camera_motion', entry.evidence);
    if (refs.length === 0) {
      refuse('p04_camera_motion', `motion: ${entry.description}`, 'no evidence cited that exists');
      continue;
    }
    observations.push(observation(`motion: ${entry.subject.slice(0, 40)}`, inferred(entry.description, methodFor('p04_camera_motion'), [passRef('p04_camera_motion'), ...refs], entry.confidence), range('p04_camera_motion', entry.startSeconds, entry.endSeconds, refs, entry.confidence)));
  }
  for (const entry of p04?.depth ?? []) {
    const shot = doc.structure.shots.find((candidate) => candidate.id === entry.shotId);
    const refs = cite('p04_camera_motion', entry.evidence);
    if (!shot || refs.length === 0) continue;
    observations.push(observation(`depth ${shot.id}`, inferred(`${entry.description}${entry.parallax === null ? '' : entry.parallax ? ' (parallax)' : ' (no parallax)'}`, methodFor('p04_camera_motion'), [passRef('p04_camera_motion'), `shot:${shot.id}`, ...refs], entry.confidence), null));
  }

  // ——— sound (p05) ———
  const p05 = output<typeof P05Audio>('p05_audio');
  if (p05) {
    const heard = p05.transcript.text?.trim() ?? '';
    if (doc.narration.transcript.value && heard) {
      const agreement = wordErrorRate(doc.narration.transcript.value, heard);
      doc.narration.agreement = { comparedWith: passRef('p05_audio'), wordErrorRate: Math.round(agreement.wer * 1000) / 1000, comparedWords: agreement.words };
      if (agreement.wer > 0.25) {
        contradictions.push({
          id: `contradiction.${String(contradictions.length + 1).padStart(4, '0')}`,
          refs: ['producer:asr', passRef('p05_audio')],
          description: `The two listeners disagree on ${Math.round(agreement.wer * 100)}% of the words.`,
          resolution: 'confidence_reduced',
          severity: agreement.wer > 0.5 ? 'high' : 'medium',
        });
        doc.narration.transcript.confidence = Math.round(doc.narration.transcript.confidence * (1 - Math.min(0.8, agreement.wer)) * 1000) / 1000;
      }
    } else if (!doc.narration.transcript.value && heard && heard.split(/\s+/).length >= 3) {
      const speechLike = doc.audio.events.some((event) => event.kind === 'voice_start');
      if (speechLike) {
        doc.narration.transcript = inferred(heard, methodFor('p05_audio'), [passRef('p05_audio'), 'stream:a0'], p05.transcript.confidence * 0.8, { note: 'heard by the multimodal model; no transcription by a dedicated recogniser is available' });
      } else {
        refuse('p05_audio', `speech: "${heard.slice(0, 300)}"`, 'no speech-like signal was measured anywhere in the film');
      }
    } else if (doc.narration.transcript.value && !heard) {
      contradictions.push({
        id: `contradiction.${String(contradictions.length + 1).padStart(4, '0')}`,
        refs: ['producer:asr', passRef('p05_audio')],
        description: 'The recogniser transcribed speech; the multimodal model heard none.',
        resolution: 'confidence_reduced',
        severity: 'medium',
      });
    }
    const withheldSpeech = doc.unsupported.filter((entry) => entry.sourceRef === 'producer:asr' && entry.claim.startsWith('speech '));
    if (heard && withheldSpeech.length > 0) {
      // Two listeners against one measurement: not settled here, and not hidden.
      contradictions.push({
        id: `contradiction.${String(contradictions.length + 1).padStart(4, '0')}`,
        refs: ['producer:asr', passRef('p05_audio')],
        description: `Both the recogniser and the multimodal model heard speech where the analyzer measured no voice activity (${withheldSpeech.map((entry) => entry.claim).join('; ').slice(0, 400)}). The words stay out of the narration until someone listens.`,
        resolution: 'unresolved',
        severity: 'medium',
      });
    }
    doc.narration.speakers = p05.speakers.flatMap((speaker, index) => {
      const refs = cite('p05_audio', speaker.evidence);
      if (refs.length === 0) return [];
      return [{ id: `speaker.${index + 1}`, description: inferred(speaker.description, methodFor('p05_audio'), [passRef('p05_audio'), ...refs], speaker.confidence) }];
    });
    const musicRefs = cite('p05_audio', p05.music.evidence);
    if (p05.music.description && musicRefs.length > 0) {
      doc.sound.music.description = inferred(`${p05.music.description}${p05.music.instrumentation.length ? ` Instrumentation: ${p05.music.instrumentation.join(', ')}.` : ''}`, methodFor('p05_audio'), [passRef('p05_audio'), ...musicRefs], p05.music.confidence);
    }
    const measuredMusic = doc.sound.music.present.value;
    if (p05.music.present !== null && measuredMusic !== null && p05.music.present !== measuredMusic) {
      contradictions.push({
        id: `contradiction.${String(contradictions.length + 1).padStart(4, '0')}`,
        refs: ['series:audio.music_probability', passRef('p05_audio')],
        description: `Music is ${measuredMusic ? '' : 'not '}estimated present from the signal; the model ${p05.music.present ? 'hears' : 'does not hear'} music.`,
        resolution: 'confidence_reduced',
        severity: 'low',
      });
      doc.sound.music.present.confidence = Math.round(doc.sound.music.present.confidence * 0.6 * 1000) / 1000;
    }
    doc.sound.music.sections = p05.musicSections.flatMap((section, index) => {
      const refs = cite('p05_audio', section.evidence);
      const r = range('p05_audio', section.startSeconds, section.endSeconds, refs, section.confidence);
      if (refs.length === 0 || !r || !r.value) return [];
      return [{ id: `music.section.${String(index + 1).padStart(2, '0')}`, range: r.value, label: inferred(section.label, methodFor('p05_audio'), [passRef('p05_audio'), ...refs], section.confidence), provenance: provenance('INFERRED', methodFor('p05_audio'), [passRef('p05_audio'), ...refs], section.confidence) }];
    });
    for (const effect of p05.soundEffects) {
      const byId = effect.id ? doc.sound.sfx.find((candidate) => candidate.id === effect.id) : undefined;
      const byTime = byId ?? nearestSfx(doc, effect.atSeconds, 0.15);
      if (!byTime) {
        refuse('p05_audio', `sound effect "${effect.label}" at ${effect.atSeconds}s`, 'no transient was measured within 150 ms');
        continue;
      }
      byTime.label = inferred(effect.label, methodFor('p05_audio'), [passRef('p05_audio'), `sfx:${byTime.id}`], effect.confidence);
    }
    doc.sound.ambience = {
      present: p05.ambience.value === null ? unknown(methodFor('p05_audio'), 'Not stated.', [passRef('p05_audio')]) : inferred(!/^(none|no)\b/i.test(p05.ambience.value), methodFor('p05_audio'), [passRef('p05_audio'), 'stream:a0'], p05.ambience.confidence),
      description: claim('p05_audio', p05.ambience, 'ambience'),
    };
  }

  // ——— sync (p06) ———
  const p06 = output<typeof P06Sync>('p06_sync');
  for (const entry of p06?.clusters ?? []) {
    const cluster = doc.events.clusters.find((candidate) => candidate.id === entry.id);
    if (!cluster) {
      refuse('p06_sync', `sync ${entry.id}: ${entry.interpretation}`, 'no such cluster');
      continue;
    }
    cluster.interpretation = inferred(entry.interpretation, methodFor('p06_sync'), [passRef('p06_sync'), `sync:${cluster.id}`, `evt:${cluster.anchor}`], entry.confidence);
  }
  for (const entry of p06?.relationships ?? []) {
    const refs = cite('p06_sync', entry.evidence);
    if (refs.length === 0) {
      refuse('p06_sync', entry.description, 'no evidence cited that exists');
      continue;
    }
    observations.push(observation('sync', inferred(entry.description, methodFor('p06_sync'), [passRef('p06_sync'), ...refs], entry.confidence), range('p06_sync', entry.startSeconds, entry.startSeconds, refs, entry.confidence)));
  }

  // ——— transitions (p07) ———
  const p07 = output<typeof P07Transitions>('p07_transitions');
  const transitions: FilmIR['structure']['transitions'] = [];
  for (const entry of p07?.boundaries ?? []) {
    const boundary = doc.structure.boundaries.find((candidate) => candidate.id === entry.id);
    if (!boundary) {
      refuse('p07_transitions', `boundary ${entry.id}: ${entry.description}`, 'no such boundary');
      continue;
    }
    const refs: Ref[] = [passRef('p07_transitions'), `boundary:${boundary.id}`, ...cite('p07_transitions', entry.evidence)];
    boundary.handover = inferred(entry.handover, methodFor('p07_transitions'), refs, entry.confidence);
    boundary.description = inferred(entry.description, methodFor('p07_transitions'), refs, entry.confidence);
    transitions.push({
      id: `transition.${String(transitions.length + 1).padStart(3, '0')}`,
      boundaryId: boundary.id,
      range: inferred(boundary.range, methodFor('p07_transitions'), refs, 1, { note: 'the measured span of the boundary' }),
      handover: inferred(entry.handover, methodFor('p07_transitions'), refs, entry.confidence),
      technique: inferred(entry.technique, methodFor('p07_transitions'), refs, entry.confidence),
      curve: null,
      description: inferred(entry.description, methodFor('p07_transitions'), refs, entry.confidence),
    });
  }
  for (const entry of p07?.continuousChanges ?? []) {
    const refs = cite('p07_transitions', entry.evidence);
    const r = range('p07_transitions', entry.startSeconds, entry.endSeconds, refs, entry.confidence);
    if (refs.length === 0 || !r) {
      refuse('p07_transitions', `continuous change ${entry.startSeconds}-${entry.endSeconds}s: ${entry.technique}`, 'no evidence or times outside the film');
      continue;
    }
    const change = changeIn(doc, entry.startSeconds - halfStep('p07_transitions'), entry.endSeconds + halfStep('p07_transitions'));
    if (!change.changed) {
      refuse('p07_transitions', `continuous change ${entry.startSeconds}-${entry.endSeconds}s: ${entry.technique}`, `nothing measurably changes in that window (${change.detail})`);
      continue;
    }
    transitions.push({
      id: `transition.${String(transitions.length + 1).padStart(3, '0')}`,
      boundaryId: null,
      range: r,
      handover: inferred(entry.handover, methodFor('p07_transitions'), [passRef('p07_transitions'), ...refs], entry.confidence),
      technique: inferred(entry.technique, methodFor('p07_transitions'), [passRef('p07_transitions'), ...refs], entry.confidence),
      curve: null,
      description: inferred(entry.description, methodFor('p07_transitions'), [passRef('p07_transitions'), ...refs], entry.confidence),
    });
  }
  doc.structure.transitions = transitions;

  // ——— moments (p08), reconstruction (p09), grammar (p10) ———
  const p08 = output<typeof P08Moments>('p08_moments');
  const moments: InterpretationIR['moments'] = (p08?.moments ?? []).flatMap((moment, index) => {
    const refs = cite('p08_moments', moment.evidence);
    const r = range('p08_moments', moment.startSeconds, moment.endSeconds, refs, moment.confidence);
    if (refs.length === 0 || !r || !r.value) {
      refuse('p08_moments', `moment: ${moment.title}`, 'no evidence or times outside the film');
      return [];
    }
    return [{
      id: `moment.${String(index + 1).padStart(2, '0')}`,
      range: r.value,
      title: moment.title,
      description: inferred(`${moment.description} Why it works: ${moment.whyItWorks}`, methodFor('p08_moments'), [passRef('p08_moments'), ...refs], moment.confidence),
      measured: [],
      refs,
    }];
  });
  const p09 = output<typeof P09Reconstruction>('p09_reconstruction');
  if (p09 && doc.reconstruction) {
    const refs = cite('p09_reconstruction', p09.strategy.evidence);
    if (p09.strategy.value && refs.length > 0) {
      doc.reconstruction.strategy = recommended(p09.strategy.value, methodFor('p09_reconstruction'), [passRef('p09_reconstruction'), ...refs], p09.strategy.confidence);
    }
    for (const entry of p09.shots) {
      if (!known.has(`shot:${entry.id}`)) continue;
      let shot = doc.reconstruction.shots.find((candidate) => candidate.shotId === entry.id);
      if (!shot) {
        shot = { shotId: entry.id, layers: [], camera: [], audioCues: [], notes: [] };
        doc.reconstruction.shots.push(shot);
      }
      shot.notes.push(`layers: ${entry.layers.join('; ')}`.slice(0, 600), `techniques: ${entry.techniques.join('; ')}`.slice(0, 600));
    }
  }
  const p10 = output<typeof P10Grammar>('p10_grammar');
  const mechanisms: Mechanism[] = (p10?.mechanisms ?? []).flatMap((mechanism, index) => {
    const refs = cite('p10_grammar', mechanism.evidence);
    if (refs.length === 0) {
      refuse('p10_grammar', `mechanism: ${mechanism.transferablePrinciple}`, 'no evidence cited that exists');
      return [];
    }
    return [{
      id: `mechanism.${String(index + 1).padStart(2, '0')}`,
      context: mechanism.context,
      observedDecision: mechanism.observedDecision,
      likelyEffect: inferred(mechanism.likelyEffect, methodFor('p10_grammar'), [passRef('p10_grammar'), ...refs], mechanism.confidence),
      evidence: refs,
      transferablePrinciple: mechanism.transferablePrinciple,
      doNotCopy: mechanism.doNotCopy,
      provenance: provenance('INFERRED', methodFor('p10_grammar'), [passRef('p10_grammar'), ...refs], mechanism.confidence),
    }];
  });
  const signatures: InterpretationIR['signatures'] = (p10?.signatures ?? []).flatMap((signature, index) => {
    const refs = cite('p10_grammar', signature.evidence);
    if (refs.length === 0) return [];
    return [{ id: `signature.${String(index + 1).padStart(2, '0')}`, description: signature.description, whyNotTransferable: signature.whyNotTransferable, refs, provenance: provenance('INFERRED', methodFor('p10_grammar'), [passRef('p10_grammar'), ...refs], signature.confidence) }];
  });

  // ——— inspections ———
  for (const record of Object.values(records)) {
    for (const inspection of record.inspections) {
      if (!inspection.output) continue;
      const refs: Ref[] = [passRef(record.id), `frames:${inspection.firstFrame}-${inspection.lastFrame}`];
      const confidence = Math.min(MODEL_CONFIDENCE_CEILING, inspection.output.confidence);
      const r = inferred(
        { start: clock.at(inspection.firstFrame), end: clock.end(inspection.lastFrame) },
        methodFor(record.id),
        refs,
        confidence,
        { note: 'a window inspected at the film\'s own frames' },
      );
      const detail = inspection.output.observations.map((o) => `frame ${o.frame}: ${o.observation}`).join(' | ');
      observations.push(observation(`inspection (${record.id})`, inferred(`${inspection.question} → ${inspection.output.answer}${detail ? ` [${detail}]` : ''}`.slice(0, 4000), methodFor(record.id), refs, confidence), r));
    }
  }

  // ——— integration ———
  const integrator = output<typeof Integrator>('integrator');
  const dnaKeys = ['thesis', 'narrativeArc', 'mood', 'brandPosture', 'visualPhilosophy', 'typographyPhilosophy', 'motionPhilosophy', 'cameraPhilosophy', 'soundPhilosophy', 'productCinematographyPhilosophy', 'transitionPhilosophy', 'attentionStrategy', 'openingStrategy', 'heroStrategy', 'resolutionStrategy'] as const;
  const fallbacks: Partial<Record<(typeof dnaKeys)[number], { passId: PassId; value: { value: string | null; evidence: string[]; confidence: number } | undefined }>> = {
    thesis: { passId: 'p02_narrative', value: p02?.thesis },
    narrativeArc: { passId: 'p02_narrative', value: p02?.arc },
    motionPhilosophy: { passId: 'p04_camera_motion', value: p04?.motionPhilosophy },
    cameraPhilosophy: { passId: 'p04_camera_motion', value: p04?.cameraPhilosophy },
    soundPhilosophy: { passId: 'p05_audio', value: p05?.soundPhilosophy },
    transitionPhilosophy: { passId: 'p07_transitions', value: p07?.transitionPhilosophy },
    openingStrategy: { passId: 'p08_moments', value: p08?.openingStrategy },
    heroStrategy: { passId: 'p08_moments', value: p08?.heroStrategy },
    resolutionStrategy: { passId: 'p08_moments', value: p08?.resolutionStrategy },
  };
  const dna = Object.fromEntries(
    dnaKeys.map((key) => {
      if (integrator) return [key, claim('integrator', integrator.dna[key], key)];
      const fallback = fallbacks[key];
      return [key, fallback ? claim(fallback.passId, fallback.value, key) : unknown('compiler.absent', 'The integration pass did not complete.')];
    }),
  ) as InterpretationIR['dna'];
  const choices: InterpretationIR['choices'] = (integrator?.choices ?? []).flatMap((choice, index) => {
    const refs = cite('integrator', choice.evidence);
    const start = Math.max(0, Math.min(choice.startSeconds, choice.endSeconds));
    const end = Math.min(duration, Math.max(choice.startSeconds, choice.endSeconds));
    if (refs.length === 0 || start > duration) {
      refuse('integrator', `choice: ${choice.title}`, refs.length === 0 ? 'no evidence cited that exists' : 'times outside the film');
      return [];
    }
    const howMuch = choice.howMuch.flatMap((q) => {
      const ref = toRef(q.ref, known, clock, duration);
      return ref ? [{ quantity: q.quantity, value: q.value, unit: q.unit, ref }] : [];
    });
    return [{
      id: `choice.${String(index + 1).padStart(2, '0')}`,
      title: choice.title,
      what: choice.what,
      how: choice.how,
      when: { start: fromSeconds(start, 1000), end: fromSeconds(end, 1000) },
      howMuch,
      relativeTo: choice.relativeTo,
      factRefs: refs,
      why: inferred(choice.why, methodFor('integrator'), [passRef('integrator'), ...refs], choice.confidence),
    }];
  });
  const narrative: InterpretationIR['narrative'] = {
    thesis: dna.thesis.value ? dna.thesis : claim('p02_narrative', p02?.thesis, 'thesis'),
    arc: dna.narrativeArc.value ? dna.narrativeArc : claim('p02_narrative', p02?.arc, 'arc'),
    acts,
  };
  if (integrator) {
    const seconds = Math.ceil(duration);
    const series = (id: string, quantity: string, values: (number | null)[]): Series => ({
      id,
      quantity,
      unit: 'ratio',
      domain: 'inferred',
      description: 'an interpretation quantified for comparison between films; not a physical measurement',
      provenance: provenance('INFERRED', methodFor('integrator'), [passRef('integrator'), ...allPassRefs(records)], 0.4),
      sampling: { kind: 'regular', start: doc.source?.frameTiming?.firstPts ?? rt(0, 1000), step: rt(1, 1), count: seconds },
      values: Array.from({ length: seconds }, (_, i) => values[i] ?? null),
    });
    doc.curves.inferred = [
      series('curve.inferred.narrative_tension', 'narrative tension', integrator.curves.narrativeTension),
      series('curve.inferred.emotional_intensity', 'emotional intensity', integrator.curves.emotionalIntensity),
      series('curve.inferred.information_density', 'information density', integrator.curves.informationDensity),
    ];
    for (const conflict of integrator.conflicts) {
      const refs = [...new Set(conflict.passes.filter((id) => records[id]).map((id) => passRef(id)))];
      const text = `${conflict.description} Resolution: ${conflict.resolution}`.slice(0, 800);
      if (refs.length >= 2) {
        contradictions.push({ id: `contradiction.${String(contradictions.length + 1).padStart(4, '0')}`, refs, description: text, resolution: 'confidence_reduced', severity: 'low' });
      } else {
        // A disagreement the integrator could not attribute to two passes is a note, not a contradiction.
        observations.push(observation('conflict', inferred(text, methodFor('integrator'), [passRef('integrator'), ...refs], 0.5), null));
      }
    }
  }

  doc.interpretation = {
    identity,
    narrative,
    dna,
    choices,
    moments,
    mechanisms,
    signatures,
    observations: observations.map((entry, index) => ({ ...entry, id: `observation.${String(index + 1).padStart(3, '0')}` })),
  };
  doc.contradictions = contradictions;
  doc.unsupported = unsupported;

  // ——— producers and methods ———
  const producers: Producer[] = [];
  const methods: Method[] = [];
  for (const record of Object.values(records)) {
    const empty = record.status === 'completed' && isEmpty(record.output);
    producers.push({
      id: record.id,
      kind: record.id === 'integrator' ? 'integrator' : 'model_pass',
      name: record.title,
      version: '1.0.0',
      model: record.model,
      status: record.status,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      inputHash: doc.source?.sha256 ?? null,
      costUsd: record.costUsd,
      notes: [
        ...(record.error ? [`error: ${record.error}`] : []),
        ...(empty ? ['empty: the pass returned no findings'] : []),
        ...(record.fps ? [`sampled at ${record.fps} fps`] : []),
        ...(invalidCitations.get(record.id) ? [`${invalidCitations.get(record.id)} citation(s) named nothing in the document and were dropped`] : []),
        ...record.inspections.map((inspection) => `inspected frames ${inspection.firstFrame}–${inspection.lastFrame}${inspection.error ? ` (failed: ${inspection.error})` : ''}`),
      ].map((note) => note.slice(0, 600)),
    });
    methods.push({
      id: methodFor(record.id),
      kind: 'model',
      name: record.title,
      version: record.model ?? 'unknown',
      deterministic: false,
      description: `A focused pass of a multimodal model over the film${record.fps ? ` sampled at ${record.fps} frames per second with its audio` : ', given the measurements and the other passes\' answers'}. Its findings are interpretations, merged only where they cite evidence that exists.`,
      parameters: record.fps ? { fps: record.fps } : {},
      citation: null,
    });
  }
  for (const pass of PASSES) {
    if (!records[pass.id]) {
      doc.uncertainties.push({ id: `unc.${String(doc.uncertainties.length + 1).padStart(4, '0')}`, subjectRefs: ['producer:forensics'], reason: 'not_analyzed', impact: 'medium', description: `The ${pass.title.toLowerCase()} pass did not run.` });
    }
  }
  return { document: doc, producers, methods };
}

function observation(topic: string, text: Evidenced<string>, range: Evidenced<TimeRange> | null): Observation {
  return { id: 'observation.pending', topic: topic.slice(0, 60), range, text };
}

function knownIds(doc: FilmIR): Set<string> {
  const known = new Set<string>();
  const add = (kind: string, id: string) => known.add(`${kind}:${id}`);
  doc.structure.shots.forEach((shot) => add('shot', shot.id));
  doc.structure.boundaries.forEach((boundary) => add('boundary', boundary.id));
  doc.typography.blocks.forEach((block) => add('text', block.id));
  doc.objects.forEach((object) => add('obj', object.id));
  doc.camera?.moves.forEach((move) => add('camera', move.id));
  doc.sound.sfx.forEach((effect) => add('sfx', effect.id));
  doc.sound.silences.forEach((silence) => add('silence', silence.id));
  doc.events.events.forEach((event) => add('evt', event.id));
  doc.events.clusters.forEach((cluster) => add('sync', cluster.id));
  doc.narration.phrases.forEach((phrase) => add('phrase', phrase.id));
  doc.narration.words.forEach((word) => add('word', word.id));
  return known;
}

const PREFIXES: [RegExp, string][] = [
  [/^shot\.\d+$/, 'shot'],
  [/^boundary\.\d+$/, 'boundary'],
  [/^text\.\d+$/, 'text'],
  [/^obj\.[a-z_]+\.\d+$/, 'obj'],
  [/^camera\.move\.\d+$/, 'camera'],
  [/^sfx\.\d+$/, 'sfx'],
  [/^silence\.\d+$/, 'silence'],
  [/^evt\.\d+$/, 'evt'],
  [/^sync\.\d+$/, 'sync'],
  [/^phrase\.\d+$/, 'phrase'],
  [/^word\.\d+$/, 'word'],
];

/** A citation as the model wrote it, as a document reference — or null when it names nothing that exists. */
function toRef(raw: string, known: Set<string>, clock: Measured['clock'], duration: number): Ref | null {
  const text = raw.replace(/^[a-z_]+:(?=[a-z])/, (prefix) => (/^(window|frame|frames):/.test(prefix) ? prefix : ''));
  const window = /^window:\s*([0-9.]+)\s*[-–]\s*([0-9.]+)$/.exec(text);
  if (window) {
    const a = Number(window[1]);
    const b = Number(window[2]);
    if (!(a >= 0 && b >= a && a <= duration + 0.5)) return null;
    const first = clock.frameAt(fromSeconds(a, 1000));
    const last = clock.frameAt(fromSeconds(Math.min(b, duration), 1000));
    return first === last ? `frame:${first}` : `frames:${first}-${last}`;
  }
  const frame = /^frame:(\d+)$/.exec(text);
  if (frame) return Number(frame[1]) < clock.count ? (`frame:${frame[1]}` as Ref) : null;
  for (const [pattern, kind] of PREFIXES) {
    if (pattern.test(text) && known.has(`${kind}:${text}`)) return `${kind}:${text}` as Ref;
  }
  return null;
}

function windowStart(evidence: string[]): number | null {
  for (const item of evidence) {
    const match = /^window:\s*([0-9.]+)/.exec(item.trim());
    if (match) return Number(match[1]);
  }
  return null;
}

function changeTimes(doc: FilmIR): { seconds: number; ref: Ref }[] {
  const out: { seconds: number; ref: Ref }[] = [];
  for (const boundary of doc.structure.boundaries) out.push({ seconds: toSeconds(boundary.at), ref: `boundary:${boundary.id}` });
  for (const block of doc.typography.blocks) {
    if (block.timing.firstVisible.value) out.push({ seconds: toSeconds(block.timing.firstVisible.value), ref: `text:${block.id}` });
    if (block.timing.exitStart.value) out.push({ seconds: toSeconds(block.timing.exitStart.value), ref: `text:${block.id}` });
  }
  for (const move of doc.camera?.moves ?? []) out.push({ seconds: toSeconds(move.range.start), ref: `camera:${move.id}` });
  for (const phrase of doc.narration.phrases) if (phrase.range.value) out.push({ seconds: toSeconds(phrase.range.value.start), ref: `phrase:${phrase.id}` });
  return out.sort((a, b) => a.seconds - b.seconds);
}

function nearestChange(changes: { seconds: number; ref: Ref }[], seconds: number): { seconds: number; ref: Ref } | null {
  let best: { seconds: number; ref: Ref } | null = null;
  for (const change of changes) if (!best || Math.abs(change.seconds - seconds) < Math.abs(best.seconds - seconds)) best = change;
  return best;
}

function nearestSfx(doc: FilmIR, seconds: number, tolerance: number) {
  let best: FilmIR['sound']['sfx'][number] | undefined;
  for (const effect of doc.sound.sfx) {
    const distance = Math.abs(toSeconds(effect.at) - seconds);
    if (distance <= tolerance && (!best || distance < Math.abs(toSeconds(best.at) - seconds))) best = effect;
  }
  return best;
}

/**
 * Whether anything measurably changes in a window.
 *
 * Motion alone is the wrong test: a crossfade, a counter ticking over or type
 * changing in place moves no pixels anywhere and changes the picture
 * completely. So a window changes if something moves, if the picture's
 * pixels or edges change, or if a text milestone or a boundary was measured
 * inside it. Only a window where all of these are flat is a window where the
 * model saw a change that the film does not contain.
 */
function changeIn(doc: FilmIR, start: number, end: number): { changed: boolean; detail: string } {
  if (!doc.frames) return { changed: true, detail: 'no frame measurements to check against' };
  const series = (id: string) => doc.frames!.features.find((candidate) => candidate.id === id)?.values ?? [];
  const inside: number[] = [];
  doc.frames.pts.forEach((pts, index) => {
    const t = Number(pts) / doc.frames!.timescale;
    if (t >= start && t <= end) inside.push(index);
  });
  const values = (id: string) => {
    const all = series(id);
    return inside.map((index) => all[index]).filter((value): value is number => typeof value === 'number');
  };
  const flow = values('frame.flow_mean');
  const flowMean = flow.length ? flow.reduce((a, b) => a + b, 0) / flow.length : 0;
  const pixelDifferenceSum = values('frame.pixel_difference').reduce((a, b) => a + b, 0);
  const edgeChangeMax = Math.max(0, ...values('frame.edge_change_ratio'));
  const within = (time: { ticks: string; timescale: number } | null | undefined) => {
    if (!time) return false;
    const t = toSeconds(time);
    return t >= start && t <= end;
  };
  const milestone = doc.typography.blocks.some((block) => within(block.timing.firstVisible.value) || within(block.timing.exitStart.value) || within(block.timing.lastVisible.value))
    || doc.structure.boundaries.some((boundary) => within(boundary.at));
  const detail = `mean flow ${flowMean.toFixed(5)} frame widths per frame, summed pixel change ${pixelDifferenceSum.toFixed(4)}, largest edge change ${edgeChangeMax.toFixed(2)}, ${milestone ? 'a' : 'no'} text milestone or boundary inside`;
  const changed = milestone
    || flowMean >= CHANGE_FLOOR.flowMean
    || pixelDifferenceSum >= CHANGE_FLOOR.pixelDifferenceSum
    || edgeChangeMax >= CHANGE_FLOOR.edgeChangeMax;
  return { changed, detail };
}

/** Every `confidence` a model wrote, held under the ceiling; everything else as it was. */
function underCeiling(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(underCeiling);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      key === 'confidence' && typeof child === 'number' ? Math.min(MODEL_CONFIDENCE_CEILING, child) : underCeiling(child),
    ]),
  );
}

function allTextRefs(doc: FilmIR): Ref[] {
  return doc.typography.blocks.slice(0, 6).map((block) => `text:${block.id}` as Ref);
}

function allPassRefs(records: Record<string, PassRecord>): Ref[] {
  return Object.values(records).filter((r) => r.status === 'completed' && r.id !== 'integrator').map((r) => `pass:${r.id}` as Ref);
}

/** Whether an answer says anything at all. A confidence on its own is not a finding: `{ value: null, confidence: 0 }` says nothing. */
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.every(isEmpty);
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>).every(([key, child]) => key === 'confidence' || isEmpty(child));
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    previous = current;
  }
  return previous[b.length]!;
}

