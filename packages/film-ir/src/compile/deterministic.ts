import { estimated, measured, provenance, recommended, sourceExact, unknown, type Evidenced } from '../evidence.ts';
import type { ForensicAnimation, ForensicFit, ForensicPanel, ForensicReport, ForensicTextLine } from '../forensics/report.ts';
import type { AudioEvent, AudioIR, MusicIR, NarrationIR, SfxEvent, SoundIR } from '../schema/audio.ts';
import type { ReconstructionIR, Uncertainty } from '../schema/interpretation.ts';
import type { Box, CurveFit, CurveModel, MotionPhase, MotionPhaseKind, Provenance, RationalTime, Ref, Series, TimeRange, VectorSeries } from '../schema/primitives.ts';
import type { FrameTable, Method, Producer, SourceInfo } from '../schema/source.ts';
import type { Boundary, BoundaryKind, BoundaryState, Shot, StructureIR } from '../schema/structure.ts';
import type { TextAnimation, TextBlock, TextTiming, TypographyIR } from '../schema/typography.ts';
import type { AttentionIR, CameraMove, CameraTrack, ProductIR, TrackColumn, TrackedObject } from '../schema/visual.ts';
import { addTime, compareTime, rt, subtractTime } from '../time.ts';
import { FrameClock, SampleClock } from './clock.ts';
import { forensicMethods } from './methods.ts';
import { blockTypeMetrics, lineGeometry } from './type-geometry.ts';

/**
 * Everything in a FilmIR that can be measured, built from the analyzer's report.
 *
 * Nothing here interprets. Where the report could not measure something the
 * value is UNKNOWN with the reason; where a quantity is a model of the signal
 * rather than the signal (saliency, speech-likeness, a fitted curve) it is
 * ESTIMATED; only what was read off the file, or computed from its pixels and
 * samples by a stated method, is MEASURED or SOURCE_EXACT.
 */
export type Measured = {
  source: SourceInfo;
  methods: Method[];
  frames: FrameTable;
  objects: TrackedObject[];
  camera: CameraTrack;
  attention: AttentionIR;
  product: ProductIR;
  typography: TypographyIR;
  audio: AudioIR;
  narration: NarrationIR;
  sound: SoundIR;
  structure: StructureIR;
  curves: { measured: Series[]; inferred: Series[] };
  reconstruction: ReconstructionIR;
  uncertainties: Uncertainty[];
  clock: FrameClock;
  samples: SampleClock | null;
  /** Facts the event graph and the interpretation need, kept beside the document rather than in it. */
  facts: CompileFacts;
};

export type CompileFacts = {
  fps: number;
  width: number;
  height: number;
  lineVisibility: Map<string, { frames: number[]; visibility: number[] }>;
  blockLines: Map<string, string[]>;
  panelBoxes: Map<number, Box[]>;
  voiceSpans: TimeRange[];
  beatTimes: RationalTime[];
};

const PRODUCER = 'producer:forensics';

export function compileMeasured(report: ForensicReport): Measured {
  const methods = forensicMethods({
    analyzer: report.analyzer.version,
    opencv: report.analyzer.opencv,
    pyav: report.analyzer.pyav,
    numpy: report.analyzer.numpy,
    ocr: report.analyzer.ocr,
  });
  const clock = new FrameClock(report.frames.pts, report.frames.durations, report.probe.video.timebase);
  const rate = report.video.measuredRate;
  const fps = rate ? rate.num / rate.den : 30;
  const width = report.video.width;
  const height = report.video.height;
  const audio = report.audio;
  const stream = audio ? report.probe.audio[0] ?? null : null;
  const samples = audio && stream ? new SampleClock(audio.rate, audio.samples, audio.firstPts, audio.timebase) : null;

  const source = buildSource(report, clock);
  const frames = buildFrames(report);
  const uncertainties: Uncertainty[] = [];
  const u = (subjectRefs: Ref[], reason: Uncertainty['reason'], impact: Uncertainty['impact'], description: string) =>
    uncertainties.push({ id: `unc.${String(uncertainties.length + 1).padStart(4, '0')}`, subjectRefs, reason, impact, description });

  const shots = report.shots.map(([first, last], index): Shot => ({
    id: shotId(index),
    index,
    frames: { first, last },
    range: { start: clock.at(first), end: clock.end(last) },
    boundaryIn: null,
    boundaryOut: null,
    measurement: provenance('MEASURED', 'boundary.cut', [PRODUCER, framesRef(first, last)]),
    dominantColours: (report.shotColours[index] ?? []).map((colour) => ({ hex: colour.hex, share: clamp01(colour.share) })),
    meanMotion: mean(sliceValues(report.frames.features['flow_mean'], first, last)),
    objectIds: [],
    cameraMoveIds: [],
    description: null,
  }));

  // Lines first: boundary states need to know where text is.
  const lineIds = report.text.lines.map((_, index) => `obj.text.${String(index + 1).padStart(4, '0')}`);
  const lineVisibility = new Map<string, { frames: number[]; visibility: number[] }>();
  const lineObjects: TrackedObject[] = [];
  report.text.lines.forEach((line, index) => {
    const object = textLineObject(line, lineIds[index]!, clock, fps, shots);
    if (!object) {
      // No object exists for a line that could not be measured, so the uncertainty points at the frames it was read on.
      u([framesRef(line.firstRead, line.lastRead)], 'insufficient_evidence', 'low', `The line "${line.text.slice(0, 60)}" was read but could not be measured on the frames around it.`);
      return;
    }
    lineObjects.push(object);
    const refinement = line.refinement;
    if (refinement && refinement.measured) {
      lineVisibility.set(lineIds[index]!, { frames: refinement.samples.frames, visibility: refinement.samples.opacity.map((v) => v ?? 0) });
    }
  });

  const panelObjects: TrackedObject[] = report.panels.map((panel, index) => panelObject(panel, `obj.ui_panel.${String(index + 1).padStart(4, '0')}`, clock, fps));
  const panelBoxes = new Map<number, Box[]>();
  for (const panel of report.panels) {
    panel.frames.forEach((frame, i) => {
      const x = panel.x[i];
      const y = panel.y[i];
      const w = panel.width[i];
      const h = panel.height[i];
      if (x === null || x === undefined || y === null || y === undefined || !w || !h) return;
      const list = panelBoxes.get(frame) ?? [];
      list.push({ x, y, width: w, height: h });
      panelBoxes.set(frame, list);
    });
  }

  const voiceSpans: TimeRange[] = samples && audio ? audio.voiceSpans.map((span) => ({ start: samples.at(span.startSample), end: samples.at(span.endSample) })) : [];
  const beatTimes: RationalTime[] = samples && audio ? audio.beats.map((beat) => samples.at(beat.sample)) : [];

  const facts: CompileFacts = { fps, width, height, lineVisibility, blockLines: new Map(), panelBoxes, voiceSpans, beatTimes };

  const boundaries = report.boundaries.map((boundary, index) => buildBoundary(report, boundary, index, clock, samples, facts));
  boundaries.forEach((boundary, index) => {
    const before = shots.find((shot) => shot.frames.last === boundary.frames.lastOutgoing);
    const after = shots.find((shot) => shot.frames.first === boundary.frames.firstIncoming);
    if (before) before.boundaryOut = boundary.id;
    if (after) after.boundaryIn = boundary.id;
    if (!before && !after) u([`boundary:${boundary.id}`], 'insufficient_evidence', 'low', `Boundary ${index + 1} does not meet a shot on either side.`);
  });

  const typography = buildTypography(report, lineIds, clock, fps, facts);
  const camera = buildCamera(report, clock, fps, width, shots);
  for (const move of camera.moves) shots.find((shot) => shot.id === move.shotId)?.cameraMoveIds.push(move.id);
  for (const object of [...lineObjects, ...panelObjects]) for (const shotRef of object.shotIds) shots.find((shot) => shot.id === shotRef)?.objectIds.push(object.id);

  for (const report_ of report.camera.shots) {
    if (report_.observability !== 'observable') {
      u([`shot:${shotId(report_.shot)}`], 'unobservable', report_.observability === 'unobservable' ? 'medium' : 'low', `Camera ${report_.observability}: ${report_.reason}.`);
    }
  }

  const attention = buildAttention(report, clock);
  const product: ProductIR = {
    interfaceShown: unknown('compiler.absent', 'Whether the rectangles tracked here are a product\'s interface is an interpretation; no model has made it yet.'),
    regions: panelObjects.map((object, index) => ({
      id: `region.${String(index + 1).padStart(4, '0')}`,
      objectId: object.id,
      kind: unknown('compiler.absent', 'What kind of interface region this is has not been interpreted.'),
      label: unknown('compiler.absent', 'Not interpreted.'),
      frames: object.frames,
      box: object.referenceBox,
    })),
    moments: [],
    occupancySeries: panelObjects.length > 0 ? 'curve.panel_occupancy' : null,
  };

  const { audioIR, sound, narration } = buildAudio(report, samples, facts, boundaries, clock, u);
  const curves = { measured: buildCurves(report, facts, clock), inferred: [] as Series[] };
  const reconstruction = buildReconstruction(typography, camera, panelObjects, new Map([...lineObjects, ...panelObjects].map((object) => [object.id, object])), clock);

  u(['stream:v0'], 'unobservable', 'low', 'No face identification is attempted: a typeface that looks like a known family is not evidence of that family, so every font family is UNKNOWN.');
  u(['producer:forensics'], 'insufficient_resolution', 'low', 'Glyph boxes come from the recogniser\'s alignment and are approximate in width; word and line boxes are reliable, glyph boxes are indicative.');
  if (audioIR.present) u(['stream:a0'], 'no_separation_model', 'medium', 'Voice, music and effects are not separated: their presence is estimated from spectral shape and rhythm, and effects under music or voice can be missed.');

  return {
    source,
    methods,
    frames,
    objects: [...lineObjects, ...panelObjects],
    camera,
    attention,
    product,
    typography,
    audio: audioIR,
    narration,
    sound,
    structure: { shots, boundaries, scenes: [], beats: [], transitions: [] },
    curves,
    reconstruction,
    uncertainties,
    clock,
    samples,
    facts,
  };
}

export function forensicProducer(report: ForensicReport): Producer {
  return {
    id: 'forensics',
    kind: 'analyzer',
    name: report.analyzer.name,
    version: report.analyzer.version,
    model: report.analyzer.ocr,
    status: 'completed',
    startedAt: null,
    finishedAt: null,
    inputHash: report.input.sha256,
    costUsd: 0,
    notes: [
      `python ${report.analyzer.python}, numpy ${report.analyzer.numpy}, opencv ${report.analyzer.opencv}, pyav ${report.analyzer.pyav}`,
      `${report.frames.count} frames in ${report.analyzer.seconds}s`,
      ...report.warnings.map((warning) => `warning: ${warning}`),
    ],
  };
}

function buildSource(report: ForensicReport, clock: FrameClock): SourceInfo {
  const video = report.probe.video;
  const durations = report.frames.durations.slice(0, -1).filter((value): value is string => value !== null);
  const distinct = new Map<string, number>();
  for (const value of report.frames.durations) if (value !== null) distinct.set(value, (distinct.get(value) ?? 0) + 1);
  const tags: Record<string, string> = { ...report.probe.tags };
  for (const [key, value] of Object.entries(video.tags)) tags[`stream.video.${key}`] = value;
  return {
    sha256: report.input.sha256,
    bytes: report.input.bytes,
    filename: report.input.filename,
    formatName: report.probe.formatName,
    formatLongName: report.probe.formatLongName,
    containerDuration: report.probe.containerDuration,
    containerBitRate: report.probe.containerBitRate,
    tags,
    video: {
      index: video.index,
      codec: video.codec,
      profile: video.profile,
      level: video.level,
      width: video.width,
      height: video.height,
      sampleAspectRatio: video.sampleAspectRatio,
      displayAspectRatio: video.displayAspectRatio,
      pixelFormat: video.pixelFormat,
      bitDepth: video.bitDepth,
      colorRange: video.colorRange,
      colorPrimaries: video.colorPrimaries,
      colorTransfer: video.colorTransfer,
      colorSpace: video.colorSpace,
      timebase: video.timebase,
      averageFrameRate: video.averageFrameRate,
      baseFrameRate: video.baseFrameRate,
      startPts: video.startPts,
      declaredFrameCount: video.declaredFrameCount,
      declaredDuration: video.declaredDuration,
      bitRate: video.bitRate,
      rotationDegrees: video.rotationDegrees,
    },
    audio: report.probe.audio.map((stream, index) => ({
      ...stream,
      decodedSamples: index === 0 && report.audio ? report.audio.samples : 0,
    })),
    otherStreams: report.probe.other,
    frameTiming: {
      decodedFrames: report.frames.count,
      variableFrameRate: new Set(durations).size > 1,
      distinctDurations: [...distinct.entries()].map(([ticks, count]) => ({ ticks, count })),
      repeatedFrames: report.frames.repeatOf.filter((value) => value !== null).length,
      firstPts: report.frames.count > 0 ? clock.at(0) : null,
      lastPtsEnd: report.frames.count > 0 ? clock.filmEnd : null,
    },
  };
}

type FeatureSpec = { quantity: string; unit: string; method: string; evidence: 'MEASURED' | 'ESTIMATED' };

/** A tempo needs at least this many heard onsets, and this share of its beats on them. */
const MIN_ONSETS_FOR_TEMPO = 8;
const MIN_BEATS_ON_ONSETS = 0.4;
/** Below this correlation margin over the runner-up, a key is a coin toss between two. */
const MIN_KEY_MARGIN = 0.05;
/**
 * The most a music heuristic may claim, however strong its own statistic.
 * Key-profile correlation and beat autocorrelation are right often, not
 * always, on a real mix — a key a fifth away and a tempo an octave off are
 * their ordinary mistakes, and exactly the ones their statistics cannot see —
 * and nothing else in a film can confirm them. The statistic scales the
 * confidence below the ceiling; it never reaches certainty.
 */
const MUSIC_CEILING = { presence: 0.8, tempo: 0.8, key: 0.7, downbeat: 0.6 };

const FEATURES: Record<string, FeatureSpec> = {
  luma_mean: { quantity: 'mean luma', unit: 'ratio', method: 'pixels.luma', evidence: 'MEASURED' },
  luma_std: { quantity: 'luma standard deviation (RMS contrast)', unit: 'ratio', method: 'pixels.luma', evidence: 'MEASURED' },
  luma_p05: { quantity: 'luma 5th percentile', unit: 'ratio', method: 'pixels.luma', evidence: 'MEASURED' },
  luma_p50: { quantity: 'luma median', unit: 'ratio', method: 'pixels.luma', evidence: 'MEASURED' },
  luma_p95: { quantity: 'luma 95th percentile', unit: 'ratio', method: 'pixels.luma', evidence: 'MEASURED' },
  luma_entropy: { quantity: 'luma histogram entropy', unit: 'bits', method: 'pixels.luma', evidence: 'MEASURED' },
  saturation_mean: { quantity: 'mean HSV saturation', unit: 'ratio', method: 'pixels.colour', evidence: 'MEASURED' },
  chroma_mean: { quantity: 'mean Oklab chroma', unit: 'oklab', method: 'pixels.colour', evidence: 'MEASURED' },
  sharpness: { quantity: 'variance of the Laplacian', unit: 'luma²', method: 'pixels.sharpness', evidence: 'MEASURED' },
  edge_density: { quantity: 'edge density', unit: 'ratio', method: 'pixels.edges', evidence: 'MEASURED' },
  spatial_information: { quantity: 'spatial information (SI)', unit: 'luma', method: 'pixels.si_ti', evidence: 'MEASURED' },
  temporal_information: { quantity: 'temporal information (TI)', unit: 'luma', method: 'pixels.si_ti', evidence: 'MEASURED' },
  pixel_difference: { quantity: 'mean absolute luma change from the previous frame', unit: 'ratio', method: 'pixels.change', evidence: 'MEASURED' },
  histogram_distance: { quantity: 'HSV histogram distance from the previous frame', unit: 'bhattacharyya', method: 'pixels.change', evidence: 'MEASURED' },
  edge_change_ratio: { quantity: 'edge change ratio', unit: 'ratio', method: 'pixels.change', evidence: 'MEASURED' },
  flow_mean: { quantity: 'mean optical-flow magnitude', unit: 'frame widths per frame', method: 'motion.flow', evidence: 'MEASURED' },
  flow_p90: { quantity: '90th-percentile optical-flow magnitude', unit: 'frame widths per frame', method: 'motion.flow', evidence: 'MEASURED' },
  local_motion: { quantity: 'flow not explained by the global motion', unit: 'frame widths per frame', method: 'motion.flow', evidence: 'MEASURED' },
  layer_speed_ratio: { quantity: 'speed ratio of the two main motion layers', unit: 'ratio', method: 'motion.flow', evidence: 'ESTIMATED' },
  gm_valid: { quantity: 'global motion measured', unit: 'boolean', method: 'motion.global', evidence: 'MEASURED' },
  gm_tx: { quantity: 'global horizontal motion', unit: 'frame widths per frame', method: 'motion.global', evidence: 'MEASURED' },
  gm_ty: { quantity: 'global vertical motion', unit: 'frame widths per frame', method: 'motion.global', evidence: 'MEASURED' },
  gm_scale: { quantity: 'global scale change', unit: 'ratio per frame', method: 'motion.global', evidence: 'MEASURED' },
  gm_rotation: { quantity: 'global rotation', unit: 'degrees per frame', method: 'motion.global', evidence: 'MEASURED' },
  gm_px: { quantity: 'horizontal perspective term', unit: 'normalised', method: 'motion.global', evidence: 'MEASURED' },
  gm_py: { quantity: 'vertical perspective term', unit: 'normalised', method: 'motion.global', evidence: 'MEASURED' },
  gm_inliers: { quantity: 'homography inliers', unit: 'count', method: 'motion.global', evidence: 'MEASURED' },
  gm_coverage: { quantity: 'share of the frame the inliers cover', unit: 'ratio', method: 'motion.global', evidence: 'MEASURED' },
  gm_residual: { quantity: 'median inlier reprojection error', unit: 'frame widths', method: 'motion.global', evidence: 'MEASURED' },
  gm_tracked_ratio: { quantity: 'share of corners tracked', unit: 'ratio', method: 'motion.global', evidence: 'MEASURED' },
  saliency_x: { quantity: 'saliency centroid x', unit: 'frame fraction', method: 'attention.saliency', evidence: 'ESTIMATED' },
  saliency_y: { quantity: 'saliency centroid y', unit: 'frame fraction', method: 'attention.saliency', evidence: 'ESTIMATED' },
  saliency_spread: { quantity: 'saliency spread', unit: 'frame fraction', method: 'attention.saliency', evidence: 'ESTIMATED' },
  border_luma: { quantity: 'field luma', unit: 'ratio', method: 'pixels.border', evidence: 'MEASURED' },
};

function buildFrames(report: ForensicReport): FrameTable {
  const features: Series[] = [];
  for (const [name, values] of Object.entries(report.frames.features)) {
    const spec = FEATURES[name];
    if (!spec) continue;
    features.push({
      id: `frame.${name}`,
      quantity: spec.quantity,
      unit: spec.unit,
      domain: spec.evidence === 'MEASURED' ? 'measured' : 'estimated',
      description: '',
      provenance: provenance(spec.evidence, spec.method, [PRODUCER], spec.evidence === 'MEASURED' ? 1 : 0.6),
      sampling: { kind: 'frames' },
      values,
    });
  }
  const vector = (id: string, quantity: string, labels: string[], unit: string, method: string, values: (number | null)[][]): VectorSeries => ({
    id,
    quantity,
    labels,
    unit,
    provenance: provenance('MEASURED', method, [PRODUCER]),
    sampling: { kind: 'frames' },
    values: values.map((row) => (row.some((v) => v === null) ? null : (row as number[]))),
  });
  const vectors: VectorSeries[] = [
    vector('frame.hue_histogram', 'chroma-weighted hue histogram', Array.from({ length: 12 }, (_, i) => `h${String(i * 30).padStart(3, '0')}`), 'share', 'pixels.colour', report.frames.vectors.hue_histogram),
    vector(
      'frame.dominant_colours',
      'dominant colours, largest first',
      Array.from({ length: 5 }, (_, i) => [`c${i + 1}_r`, `c${i + 1}_g`, `c${i + 1}_b`, `c${i + 1}_share`]).flat(),
      'srgb 0-255 / share',
      'pixels.dominant',
      report.frames.vectors.dominant_colours.map((frame) => frame.flat()),
    ),
    vector('frame.border_rgb', 'field colour', ['r', 'g', 'b'], 'srgb 0-255', 'pixels.border', report.frames.vectors.border_rgb),
  ];
  const num = report.probe.video.timebase.num;
  return {
    count: report.frames.count,
    timescale: report.probe.video.timebase.den,
    pts: report.frames.pts.map((value) => (BigInt(value) * BigInt(num)).toString()),
    durations: report.frames.durations.map((value) => (value === null ? null : (BigInt(value) * BigInt(num)).toString())),
    keyframe: report.frames.keyframe,
    pictureType: report.frames.pictureType.map((value) => (['I', 'P', 'B', 'S', 'SI', 'SP', 'BI'].includes(value) ? value : '?') as FrameTable['pictureType'][number]),
    decodedHash: report.frames.hash,
    repeatOf: report.frames.repeatOf,
    analysis: {
      workingWidth: report.video.work.width,
      workingHeight: report.video.work.height,
      colour: report.video.assumedMatrix
        ? `decoded as ${report.video.assumedMatrix}, sRGB transfer assumed for colour measures`
        : `decoded as tagged (${report.probe.video.colorSpace ?? 'unspecified'} matrix, ${report.probe.video.colorRange ?? 'unspecified'} range)`,
      provenance: provenance('SOURCE_EXACT', 'decode.pts', [PRODUCER, 'stream:v0']),
    },
    features,
    vectors,
  };
}

function buildBoundary(
  report: ForensicReport,
  boundary: ForensicReport['boundaries'][number],
  index: number,
  clock: FrameClock,
  samples: SampleClock | null,
  facts: CompileFacts,
): Boundary {
  const method = boundary.kind === 'hard_cut' ? 'boundary.cut' : boundary.kind === 'wipe' ? 'boundary.wipe' : boundary.kind === 'dissolve' ? 'boundary.dissolve' : 'boundary.fade';
  const kind: BoundaryKind = boundary.kind;
  const outgoing = boundaryState(report, boundary.lastOutgoing, clock, samples, facts);
  const incoming = boundaryState(report, boundary.firstIncoming, clock, samples, facts);
  const difference = (a: number | null, b: number | null) => (a === null || b === null ? null : round(b - a, 6));
  return {
    id: `boundary.${String(index + 1).padStart(3, '0')}`,
    kind: measured(kind, method, [PRODUCER, framesRef(boundary.span[0], boundary.span[1])], 1),
    at: clock.at(boundary.firstIncoming),
    frames: { lastOutgoing: boundary.lastOutgoing, firstIncoming: boundary.firstIncoming },
    span: { first: Math.min(boundary.span[0], boundary.span[1]), last: Math.max(boundary.span[0], boundary.span[1]) },
    // The change itself: after the last frame it has not touched, until the first it has completed — an instant for a cut.
    range: { start: clock.end(boundary.lastOutgoing), end: clock.at(boundary.firstIncoming) },
    outgoing,
    incoming,
    residuals: {
      lumaMean: difference(outgoing.lumaMean, incoming.lumaMean),
      attentionDistance:
        outgoing.attention && incoming.attention
          ? round(Math.hypot(incoming.attention.x - outgoing.attention.x, incoming.attention.y - outgoing.attention.y), 6)
          : null,
      audioLevelDb: difference(outgoing.audioLevelDb, incoming.audioLevelDb),
      textPresent: outgoing.textPresent === null || incoming.textPresent === null ? null : Number(incoming.textPresent) - Number(outgoing.textPresent),
      fieldColourDistance: colourDistance(report.frames.vectors.border_rgb[boundary.lastOutgoing], report.frames.vectors.border_rgb[boundary.firstIncoming]),
      ...numericScores(boundary.scores),
    },
    measurement: provenance('MEASURED', method, [PRODUCER, framesRef(boundary.span[0], boundary.span[1])]),
    handover: unknown('compiler.absent', 'What this boundary does for the film is an interpretation; it has not been made yet.'),
    description: null,
  };
}

function numericScores(scores: Record<string, unknown>): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(scores)) {
    if (typeof value === 'number') out[`score.${key}`] = round(value, 6);
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [inner, innerValue] of Object.entries(value as Record<string, unknown>)) {
        if (typeof innerValue === 'number') out[`score.${key}.${inner}`] = round(innerValue, 6);
      }
    }
  }
  return out;
}

function boundaryState(report: ForensicReport, frame: number, clock: FrameClock, samples: SampleClock | null, facts: CompileFacts): BoundaryState {
  const feature = (name: string) => report.frames.features[name]?.[frame] ?? null;
  const x = feature('saliency_x');
  const y = feature('saliency_y');
  const dominant = report.frames.vectors.dominant_colours[frame] ?? [];
  let textPresent = false;
  for (const { frames, visibility } of facts.lineVisibility.values()) {
    const at = frames.indexOf(frame);
    if (at >= 0 && (visibility[at] ?? 0) >= 0.5) {
      textPresent = true;
      break;
    }
  }
  let audioLevelDb: number | null = null;
  let voiceActive: boolean | null = null;
  let musicalPhase: number | null = null;
  const audio = report.audio;
  if (audio && samples) {
    const hop = hopAt(clock.at(frame), samples, audio.hop);
    audioLevelDb = hop === null ? null : audio.series['rms_db']?.[hop] ?? null;
    const probability = hop === null ? null : audio.series['voice_probability']?.[hop] ?? null;
    voiceActive = probability === null ? null : probability > 0.5;
    musicalPhase = beatPhase(clock.at(frame), facts.beatTimes);
  }
  const boxes = facts.panelBoxes.get(frame) ?? [];
  const largest = boxes.length > 0 ? boxes.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b)) : null;
  return {
    frame,
    attention: x === null || y === null ? null : { x: round(x, 4), y: round(y, 4) },
    motion: feature('gm_tx') === null ? null : { dx: round(feature('gm_tx')!, 6), dy: round(feature('gm_ty') ?? 0, 6) },
    cameraScale: report.camera.samples['scale']?.[frame] ?? null,
    lumaMean: feature('luma_mean'),
    dominantColours: dominant
      .filter((entry) => entry.every((v) => v !== null))
      .slice(0, 3)
      .map((entry) => hex([entry[0]!, entry[1]!, entry[2]!])),
    textPresent,
    audioLevelDb,
    voiceActive,
    musicalPhase,
    productBox: largest,
  };
}

function textLineObject(line: ForensicTextLine, id: string, clock: FrameClock, fps: number, shots: Shot[]): TrackedObject | null {
  const refinement = line.refinement;
  if (!refinement || !refinement.measured) return null;
  const s = refinement.samples;
  const first = refinement.milestones.firstVisible ?? line.firstRead;
  const last = refinement.milestones.lastVisible ?? line.lastRead;
  const columns: Partial<Record<TrackColumn, (number | null)[]>> = {
    x: s.x,
    y: s.y,
    width: s.inkBox.map((box) => (box ? box[2] : null)),
    height: s.inkBox.map((box) => (box ? box[3] : null)),
    cx: s.inkBox.map((box) => (box ? box[0] + box[2] / 2 : null)),
    cy: s.inkBox.map((box) => (box ? box[1] + box[3] / 2 : null)),
    opacity: s.opacity,
    blur: s.blur,
    match: s.match,
    vx: derivative(s.x, fps),
    vy: derivative(s.y, fps),
  };
  const refs = [PRODUCER, framesRef(refinement.window[0], refinement.window[1])];
  const columnProvenance: Partial<Record<TrackColumn, Provenance>> = {
    x: provenance('MEASURED', 'text.visibility', refs, 1, 'top-left of the matched template, native pixels; null where the match is not trusted'),
    y: provenance('MEASURED', 'text.visibility', refs, 1, 'top-left of the matched template, native pixels; null where the match is not trusted'),
    width: provenance('MEASURED', 'text.visibility', refs, 1, 'extent of the ink at the matched location, native pixels'),
    height: provenance('MEASURED', 'text.visibility', refs, 1, 'extent of the ink at the matched location, native pixels'),
    cx: provenance('MEASURED', 'text.visibility', refs, 1),
    cy: provenance('MEASURED', 'text.visibility', refs, 1),
    opacity: provenance('ESTIMATED', 'text.visibility', refs, 0.8, 'ink contrast relative to the settled line; rises with opacity, reveal and scale alike'),
    blur: provenance('ESTIMATED', 'text.visibility', refs, 0.6, 'sharpness relative to the settled line; 1 is as sharp as settled'),
    match: provenance('MEASURED', 'text.visibility', refs, 1, 'normalised cross-correlation with the settled appearance'),
    vx: provenance('ESTIMATED', 'compiler.derivation', refs, 0.6, 'first difference of x, per second'),
    vy: provenance('ESTIMATED', 'compiler.derivation', refs, 0.6, 'first difference of y, per second'),
  };
  const phases: MotionPhase[] = [];
  const phase = (kind: MotionPhaseKind, frame: number | null) => {
    if (frame === null) return;
    phases.push({ kind, frame, at: clock.at(frame), value: null, unit: '', provenance: provenance('MEASURED', 'text.visibility', [PRODUCER, `frame:${frame}`]) });
  };
  phase('start', refinement.milestones.firstVisible);
  phase('settle', refinement.milestones.settled);
  phase('end', refinement.milestones.lastVisible);
  const fits: CurveFit[] = [
    ...animationFits(refinement.enter, `${id}.enter`, clock),
    ...animationFits(refinement.exit, `${id}.exit`, clock),
  ];
  const [bx, by, bw, bh] = line.referenceBox;
  return {
    id,
    kind: 'text_line',
    kindProvenance: provenance('MEASURED', 'text.ocr', [PRODUCER, `frame:${line.referenceFrame}`], clamp01(line.score)),
    name: null,
    role: null,
    detection: provenance('MEASURED', 'text.linking', [PRODUCER, ...line.readings.slice(0, 8).map((reading) => `frame:${reading.frame}` as Ref)], clamp01(line.score)),
    frames: { first: Math.min(first, last), last: Math.max(first, last) },
    shotIds: shots.filter((shot) => shot.frames.first <= last && shot.frames.last >= first).map((shot) => shot.id),
    parentId: null,
    sampleFrames: s.frames,
    columns: columns as Record<TrackColumn, (number | null)[]>,
    columnProvenance: columnProvenance as Record<TrackColumn, Provenance>,
    corners: null,
    zOrder: null,
    occludedFrames: [],
    phases,
    fits,
    referenceFrame: line.referenceFrame,
    referenceBox: { x: bx, y: by, width: bw, height: bh },
  };
}

function panelObject(panel: ForensicPanel, id: string, clock: FrameClock, fps: number): TrackedObject {
  const refs = [PRODUCER, framesRef(panel.frames[0] ?? 0, panel.frames[panel.frames.length - 1] ?? 0)];
  const columns: Partial<Record<TrackColumn, (number | null)[]>> = {
    x: panel.x,
    y: panel.y,
    width: panel.width,
    height: panel.height,
    cx: panel.cx,
    cy: panel.cy,
    scaleX: panel.scale,
    scaleY: panel.scale,
    occupancy: panel.occupancy,
    match: panel.match,
    vx: derivative(panel.cx, fps),
    vy: derivative(panel.cy, fps),
  };
  const measuredColumn = provenance('MEASURED', 'panel.track', refs, 0.9, 'native pixels; null where the match fell below 0.5');
  const columnProvenance: Partial<Record<TrackColumn, Provenance>> = {
    x: measuredColumn,
    y: measuredColumn,
    width: measuredColumn,
    height: measuredColumn,
    cx: measuredColumn,
    cy: measuredColumn,
    scaleX: provenance('MEASURED', 'panel.track', refs, 0.8, 'width relative to the reference frame; uniform scale assumed'),
    scaleY: provenance('MEASURED', 'panel.track', refs, 0.8, 'height follows width; uniform scale assumed'),
    occupancy: measuredColumn,
    match: provenance('MEASURED', 'panel.track', refs, 1, 'normalised cross-correlation with the reference'),
    vx: provenance('ESTIMATED', 'compiler.derivation', refs, 0.6),
    vy: provenance('ESTIMATED', 'compiler.derivation', refs, 0.6),
  };
  const first = panel.frames[0] ?? 0;
  const last = panel.frames[panel.frames.length - 1] ?? first;
  const [rx, ry, rw, rh] = panel.referenceBox;
  return {
    id,
    kind: 'ui_panel',
    kindProvenance: provenance('ESTIMATED', 'panel.track', refs, 0.5, 'a closed rectangle; that it is interface is for the interpretation to confirm'),
    name: null,
    role: null,
    detection: provenance('MEASURED', 'panel.track', [PRODUCER, `frame:${panel.referenceFrame}`]),
    frames: { first, last },
    shotIds: [shotId(panel.shot)],
    parentId: null,
    sampleFrames: panel.frames,
    columns: columns as Record<TrackColumn, (number | null)[]>,
    columnProvenance: columnProvenance as Record<TrackColumn, Provenance>,
    corners: null,
    zOrder: null,
    occludedFrames: [],
    phases: panel.phases.map((phase) => ({
      kind: phaseKind(phase.kind),
      frame: phase.frame,
      at: clock.at(phase.frame),
      value: phase.value,
      unit: phase.kind === 'peak_velocity' ? 'px/s' : phase.kind.endsWith('_peak') ? 'px/s²' : '',
      provenance: provenance('MEASURED', 'motion.phases', [PRODUCER, `frame:${phase.frame}`]),
    })),
    fits: Object.entries(panel.fits).map(([property, fit]) => curveFit(`${id}.${property}`, property, fit, first, last, clock)),
    referenceFrame: panel.referenceFrame,
    referenceBox: { x: rx, y: ry, width: rw, height: rh },
  };
}

function buildTypography(report: ForensicReport, lineIds: string[], clock: FrameClock, fps: number, facts: CompileFacts): TypographyIR {
  const blocks: TextBlock[] = [];
  report.text.blocks.forEach((members) => {
    const lines = members
      .map((index) => ({ index, line: report.text.lines[index]! }))
      .filter(({ line }) => line.refinement && line.refinement.measured);
    if (lines.length === 0) return;
    const id = `text.${String(blocks.length + 1).padStart(4, '0')}`;
    const objectIds = lines.map(({ index }) => lineIds[index]!);
    facts.blockLines.set(id, objectIds);
    const refinements = lines.map(({ line }) => line.refinement as Extract<NonNullable<ForensicTextLine['refinement']>, { measured: true }>);
    const first = refinements[0]!;
    const minFrame = (key: keyof typeof first.milestones, pick: (a: number, b: number) => number) =>
      refinements.map((r) => r.milestones[key]).filter((v): v is number => v !== null).reduce<number | null>((a, b) => (a === null ? b : pick(a, b)), null);
    const block = blockVisibility(refinements);
    const milestone = (fraction: number) => firstCrossing(block, fraction);
    const firstVisible = minFrame('firstVisible', Math.min);
    const lastVisible = minFrame('lastVisible', Math.max);
    const settled = minFrame('settled', Math.max);
    const exitStart = minFrame('exitStart', Math.min);
    const refs: Ref[] = [PRODUCER, ...objectIds.map((objectId) => `obj:${objectId}` as Ref)];
    const time = (frame: number | null, what: string): Evidenced<RationalTime> =>
      frame === null
        ? unknown('text.visibility', `The ${what} of this block could not be measured.`, refs)
        : measured(clock.at(frame), 'text.visibility', [...refs, `frame:${frame}`], 1, {
            lowerBound: frame > 0 ? clock.at(frame - 1) : clock.at(frame),
            upperBound: clock.at(frame),
            note: 'the first frame at which it holds; it became true after the previous frame was presented',
          });
    const timing: TextTiming = {
      firstVisible: time(firstVisible, 'first visible frame'),
      p10: time(milestone(0.1), '10% point'),
      p25: time(milestone(0.25), '25% point'),
      p50: time(milestone(0.5), 'half-visible point'),
      p75: time(milestone(0.75), '75% point'),
      p90: time(milestone(0.9), '90% point'),
      settled: time(settled, 'settled frame'),
      exitStart: time(exitStart, 'exit start'),
      lastVisible: time(lastVisible, 'last visible frame'),
    };
    const boxes = lines.map(({ line }) => line.referenceBox);
    const x0 = Math.min(...boxes.map((b) => b[0]));
    const y0 = Math.min(...boxes.map((b) => b[1]));
    const x1 = Math.max(...boxes.map((b) => b[0] + b[2]));
    const y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
    const text = lines.map(({ line }) => line.text).join('\n');
    const minScore = Math.min(...lines.map(({ line }) => line.score));
    const lineGeometries = new Map(lines.map(({ line, index }) => [index, lineGeometry(line.geometry, [PRODUCER, `frame:${line.referenceFrame}`])]));
    const typeMetrics = blockTypeMetrics(
      lines.map(({ line, index }) => ({ geometry: line.geometry, measured: lineGeometries.get(index)!, box: line.referenceBox })),
      refs,
    );
    const lineIr = lines.map(({ line, index }) => ({
      id: `${id}.line.${String(lines.findIndex((entry) => entry.index === index) + 1).padStart(2, '0')}`,
      text: measured(line.text, 'text.ocr', [PRODUCER, `frame:${line.referenceFrame}`], clamp01(line.score), {
        note: line.variants.length > 1 ? `other readings: ${line.variants.filter((variant) => variant !== line.text).slice(0, 4).join(' | ')}` : undefined,
      }),
      box: { x: line.referenceBox[0], y: line.referenceBox[1], width: line.referenceBox[2], height: line.referenceBox[3] },
      polygon: line.referencePoly.flat(),
      ...lineGeometries.get(index)!,
      words: line.words.map((word, w) => ({
        id: `${id}.line.${String(lines.findIndex((entry) => entry.index === index) + 1).padStart(2, '0')}.word.${String(w + 1).padStart(2, '0')}`,
        text: word.text,
        box: toBox(word.box),
        provenance: provenance('ESTIMATED', 'text.glyphs', [PRODUCER, `frame:${line.referenceFrame}`], 0.7),
        glyphs: word.glyphs.map((glyph, g) => ({
          id: `g${g + 1}`,
          char: glyph.char.slice(0, 4),
          box: toBox(glyph.box),
          provenance: provenance('ESTIMATED', 'text.glyphs', [PRODUCER, `frame:${line.referenceFrame}`], 0.5),
        })),
      })),
    }));
    const alignment = blockAlignment(boxes, report.video.width);
    const ink = first.inkColour;
    const enter = animation(id, refinements.map((r) => r.enter), lines, 'enter', clock, fps, refs);
    const exit = animation(id, refinements.map((r) => r.exit), lines, 'exit', clock, fps, refs);
    blocks.push({
      id,
      objectIds,
      text: measured(text, 'text.ocr', refs, clamp01(minScore)),
      language: unknown('compiler.absent', 'The language of the text has not been identified.'),
      classification: unknown('compiler.absent', 'Whether this is a subtitle, editorial copy or product copy is an interpretation not yet made.'),
      frames: { first: firstVisible ?? lines[0]!.line.firstRead, last: lastVisible ?? lines[lines.length - 1]!.line.lastRead },
      referenceFrame: lines[0]!.line.referenceFrame,
      box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
      lines: lineIr,
      metrics: {
        capHeightPx: typeMetrics.capHeightPx,
        xHeightPx: typeMetrics.xHeightPx,
        stemPx: typeMetrics.stemPx,
        approxSizePx: typeMetrics.approxSizePx,
        approxWeight: typeMetrics.approxWeight,
        trackingEm: unknown<number>('compiler.absent', 'Letter-spacing needs the face\'s own metrics; not estimated.'),
        lineSpacingPx: typeMetrics.lineSpacingPx,
        alignment: alignment ? measured(alignment, 'text.blocks', refs, lines.length >= 2 ? 0.9 : 0.5) : unknown('text.blocks', 'The lines share no edge or centre closely enough to call an alignment.'),
        colour: ink ? measured(hex(ink), 'text.visibility', refs, 0.9, { note: 'median colour of the ink on the reference frame' }) : unknown('text.visibility', 'The ink colour could not be read.'),
        fontFamily: unknown('compiler.absent', 'No face identification is attempted; a face that looks like a known family is not evidence of it.'),
        fontCategory: unknown('compiler.absent', 'Not interpreted yet.'),
      },
      timing,
      enter,
      exit,
      speech: {
        relation: unknown('compiler.absent', 'The relation of this text to the narration has not been established.'),
        wordRefs: [],
        offset: unknown('compiler.absent', 'No matched speech.'),
      },
    });
  });
  const reads = report.text.lines.flatMap((line) => line.readings.map((reading) => reading.frame));
  return {
    blocks,
    coverage: {
      framesRead: report.text.framesRead,
      stride: report.text.stride,
      readSpan: reads.length > 0 ? { first: Math.min(...reads), last: Math.max(...reads) } : null,
      provenance: provenance('MEASURED', 'text.ocr', [PRODUCER]),
    },
  };
}

type MeasuredRefinement = Extract<NonNullable<ForensicTextLine['refinement']>, { measured: true }>;

function blockVisibility(refinements: MeasuredRefinement[]): { frames: number[]; visibility: number[] } {
  const byFrame = new Map<number, number[]>();
  for (const refinement of refinements) {
    refinement.samples.frames.forEach((frame, i) => {
      const value = refinement.samples.opacity[i];
      if (value === null || value === undefined) return;
      const list = byFrame.get(frame) ?? [];
      list.push(value);
      byFrame.set(frame, list);
    });
  }
  const frames = [...byFrame.keys()].sort((a, b) => a - b);
  return { frames, visibility: frames.map((frame) => mean(byFrame.get(frame)!) ?? 0) };
}

function firstCrossing(block: { frames: number[]; visibility: number[] }, fraction: number): number | null {
  const settled = block.visibility.length > 0 ? Math.max(...block.visibility.map((v) => Math.min(1, v))) : 0;
  if (settled <= 0.05) return null;
  for (let i = 0; i < block.frames.length; i += 1) if ((block.visibility[i] ?? 0) >= fraction * settled) return block.frames[i]!;
  return null;
}

function animation(
  blockId: string,
  animations: ForensicAnimation[],
  lines: { index: number; line: ForensicTextLine }[],
  which: 'enter' | 'exit',
  clock: FrameClock,
  fps: number,
  refs: Ref[],
): TextAnimation {
  const main = animations.find((a) => a.kind === 'measured') ?? animations[0]!;
  const absent = (what: string) => unknown<never>('text.visibility', `The ${which} ${what} could not be measured.`, refs);
  if (main.kind === 'cut' || main.kind === 'instant') {
    const cut = measured({ from: 1, to: 1 }, 'text.visibility', main.kind === 'instant' && main.frames ? [...refs, framesRef(main.frames[0], main.frames[0])] : refs, 1, {
      note: main.kind === 'cut'
        ? `the block is fully visible on the first frame of its window: it ${which === 'enter' ? 'arrives' : 'leaves'} with a boundary, not an animation`
        : `the block is whole on one frame and absent on the frame ${which === 'enter' ? 'before' : 'after'}, inside the shot: it ${which === 'enter' ? 'pops on' : 'pops off'} within a frame`,
    });
    return {
      translation: measured({ dx: 0, dy: 0 }, 'text.visibility', refs, 1),
      scale: cut,
      opacity: cut,
      blur: absent('blur'),
      rotation: absent('rotation'),
      mask: measured('none', 'text.visibility', refs, 1),
      stagger: absent('stagger'),
      durationMs: measured(0, 'text.visibility', refs, 1, { unit: 'ms' }),
      fits: [],
    };
  }
  if (main.kind !== 'measured' || !main.frames) {
    return {
      translation: absent('translation'),
      scale: absent('scale'),
      opacity: absent('opacity'),
      blur: absent('blur'),
      rotation: absent('rotation'),
      mask: absent('mask'),
      stagger: absent('stagger'),
      durationMs: absent('duration'),
      fits: [],
    };
  }
  const translation = main.translation
    ? measured({ dx: round(main.translation.dx, 2), dy: round(main.translation.dy, 2) }, 'text.visibility', [...refs, framesRef(main.translation.fromFrame, main.translation.toFrame)], 0.9, {
        unit: 'px',
        note: 'between the first and last frames where the line matches its settled appearance',
      })
    : unknown<{ dx: number; dy: number }>('text.visibility', 'The line never matched its settled appearance reliably enough during the move to measure it.', refs);
  const staggerFrames = lines.length >= 2
    ? lines.map(({ line }) => (line.refinement && line.refinement.measured ? line.refinement.milestones.p50 : null))
    : (lines[0]?.line.refinement && lines[0].line.refinement.measured ? lines[0].line.refinement.words.map((word) => word.p50) : []);
  const staggerTimes = staggerFrames.filter((frame): frame is number => frame !== null);
  const intervals = staggerTimes.slice(1).map((frame, i) => round(((frame - staggerTimes[i]!) * 1000) / fps, 1));
  return {
    translation,
    scale: main.scale && main.scale.from !== null && main.scale.to !== null
      ? estimated({ from: round(main.scale.from, 3), to: round(main.scale.to, 3) }, 'text.visibility', refs, 0.6, { note: 'ink height at the first and last trusted frames' })
      : unknown('text.visibility', 'Scale was not measurable.', refs),
    opacity: main.opacity ? estimated({ from: round(main.opacity.from, 3), to: round(main.opacity.to, 3) }, 'text.visibility', refs, 0.7, { note: 'relative ink contrast; reveals and scale changes read as opacity too' }) : unknown('text.visibility', 'Not measurable.', refs),
    blur: main.blur ? estimated({ from: round(main.blur.from, 3), to: round(main.blur.to, 3) }, 'text.visibility', refs, 0.5, { note: 'sharpness relative to settled' }) : unknown('text.visibility', 'Not measurable.', refs),
    rotation: unknown('compiler.absent', 'Rotation of type is not measured.'),
    mask: main.mask ? estimated(main.mask, 'text.visibility', refs, 0.6) : estimated('none', 'text.visibility', refs, 0.4, { note: 'no directional reveal was seen in the ink extent' }),
    stagger: intervals.length > 0 && which === 'enter'
      ? measured({ unit: lines.length >= 2 ? 'line' : 'word', intervalsMs: intervals }, 'text.visibility', refs, 0.8, { note: 'between half-visible frames; quantised to the frame' })
      : unknown('text.visibility', 'Only one unit arrived, or its parts arrived together.', refs),
    durationMs: measured(round(((main.frames[1] - main.frames[0]) * 1000) / fps, 1), 'text.visibility', [...refs, framesRef(main.frames[0], main.frames[1])], 1, { unit: 'ms' }),
    fits: Object.entries(main.fits ?? {}).map(([property, fit]) => curveFit(`${blockId}.${which}.${property}`, property, fit, main.frames![0], main.frames![1], clock)),
  };
}

function animationFits(animation: ForensicAnimation, prefix: string, clock: FrameClock): CurveFit[] {
  if (animation.kind !== 'measured' || !animation.frames) return [];
  return Object.entries(animation.fits ?? {}).map(([property, fit]) => curveFit(`${prefix}.${property}`, property, fit, animation.frames![0], animation.frames![1], clock));
}

function curveFit(id: string, property: string, fit: ForensicFit, first: number, last: number, clock: FrameClock): CurveFit {
  return {
    id,
    property,
    frames: { first, last },
    range: { start: clock.at(first), end: clock.end(last) },
    model: fit.model as CurveModel,
    parameters: Object.fromEntries(Object.entries(fit.parameters).map(([key, value]) => [key, round(value, 5)])),
    from: round(fit.from, 4),
    to: round(fit.to, 4),
    residualRms: round(Math.max(0, fit.residualRms), 5),
    rSquared: round(Math.min(1, fit.rSquared), 5),
    samples: fit.samples,
    runnerUp: fit.runnerUp ? { model: fit.runnerUp.model as CurveModel, rSquared: round(Math.min(1, fit.runnerUp.rSquared), 5) } : null,
    provenance: provenance('ESTIMATED', 'fit.curves', [PRODUCER, framesRef(first, last)], clamp01(Math.max(0, fit.rSquared)), 'the best description found of the observed curve, not the curve it was made with'),
  };
}

function buildCamera(report: ForensicReport, clock: FrameClock, fps: number, width: number, shots: Shot[]): CameraTrack {
  const samples = report.camera.samples;
  const columns = {} as CameraTrack['columns'];
  const columnProvenance: Record<string, Provenance> = {};
  for (const name of ['tx', 'ty', 'scale', 'rotation', 'perspectiveX', 'perspectiveY', 'residual', 'inliers', 'coverage', 'vx', 'vy', 'vscale', 'speed', 'acceleration'] as const) {
    columns[name] = samples[name] ?? new Array(report.frames.count).fill(null);
    const derived = ['vx', 'vy', 'vscale', 'speed', 'acceleration'].includes(name);
    columnProvenance[name] = derived
      ? provenance('ESTIMATED', 'motion.camera', [PRODUCER], 0.6, 'finite differences of the pose, per second')
      : provenance('MEASURED', 'motion.camera', [PRODUCER], 1, name === 'tx' || name === 'ty' ? 'frame widths, content transform relative to the first frame of the shot' : undefined);
  }
  const moves: CameraMove[] = report.camera.moves.map((move, index) => {
    const refs = [PRODUCER, framesRef(move.first, move.last)];
    const observed = report.camera.shots.find((shot) => shot.shot === move.shot);
    const confidence = observed?.confidence ?? 0.5;
    return {
      id: `camera.move.${String(index + 1).padStart(3, '0')}`,
      shotId: shotId(move.shot),
      frames: { first: move.first, last: move.last },
      range: { start: clock.at(move.first), end: clock.end(move.last) },
      type: estimated(move.type as CameraMove['type']['value'] & string, 'motion.camera', refs, confidence, {
        note: move.observability === 'partial' ? 'measured on part of the frame; may be one layer moving rather than a camera' : 'content transform classified by its largest component',
      }),
      translationPx: measured(round(move.translation * width, 2), 'motion.camera', refs, confidence, { unit: 'px' }),
      scaleRatio: move.scaleRatio === null ? unknown<number>('motion.camera', 'Scale could not be measured.', refs) : measured(round(move.scaleRatio, 5), 'motion.camera', refs, confidence),
      rotationDegrees: measured(round(move.rotation, 4), 'motion.camera', refs, confidence, { unit: 'degrees' }),
      peakSpeedPxPerSecond: move.peakSpeed === null ? unknown<number>('motion.camera', 'Speed could not be measured.', refs) : estimated(round(move.peakSpeed * width, 2), 'motion.camera', refs, confidence * 0.8, { unit: 'px/s' }),
      phases: move.phases.map((phase) => ({
        kind: phaseKind(phase.kind),
        frame: phase.frame,
        at: clock.at(phase.frame),
        value: phase.value === null ? null : round(phase.value, 6),
        unit: phase.kind === 'peak_velocity' ? `${move.dominantProperty}/s` : phase.kind.endsWith('_peak') ? `${move.dominantProperty}/s²` : '',
        provenance: provenance('MEASURED', 'motion.phases', [PRODUCER, `frame:${phase.frame}`], confidence),
      })),
      fits: move.fit ? [curveFit(`camera.move.${String(index + 1).padStart(3, '0')}.${move.dominantProperty}`, move.dominantProperty, move.fit, Math.max(0, move.first - 1), move.last, clock)] : [],
      description: null,
    };
  });
  void fps;
  return {
    model: 'apparent camera: the image-content transform relative to the first frame of each shot, from chained frame-to-frame homographies',
    shots: report.camera.shots.map((shot) => ({
      shotId: shots[shot.shot]?.id ?? shotId(shot.shot),
      observability: shot.observability,
      reason: shot.reason.slice(0, 400),
      confidence: clamp01(shot.confidence),
    })),
    sampleFrames: Array.from({ length: report.frames.count }, (_, i) => i),
    columns,
    columnProvenance,
    moves,
    focalLength: unknown('compiler.absent', 'Focal length is not recoverable from a composited motion-design film, and nothing in the file states it.'),
    vanishingPoint: unknown('compiler.absent', 'No vanishing-point analysis is performed.'),
  };
}

function buildAttention(report: ForensicReport, clock: FrameClock): AttentionIR {
  const xs = report.frames.features['saliency_x'] ?? [];
  const ys = report.frames.features['saliency_y'] ?? [];
  const shifts: AttentionIR['shifts'] = [];
  for (let f = 1; f < xs.length; f += 1) {
    const x0 = xs[f - 1];
    const y0 = ys[f - 1];
    const x1 = xs[f];
    const y1 = ys[f];
    if (x0 === null || x0 === undefined || y0 === null || y0 === undefined || x1 === null || x1 === undefined || y1 === null || y1 === undefined) continue;
    const distance = Math.hypot(x1 - x0, y1 - y0);
    if (distance < 0.2) continue;
    shifts.push({
      id: `attention.shift.${String(shifts.length + 1).padStart(4, '0')}`,
      frame: f,
      at: clock.at(f),
      from: { x: round(x0, 4), y: round(y0, 4) },
      to: { x: round(x1, 4), y: round(y1, 4) },
      distance: round(distance, 4),
      cause: null,
      provenance: provenance('ESTIMATED', 'attention.saliency', [PRODUCER, `frame:${f}`], 0.5, 'a jump of the saliency centroid by a fifth of the frame or more in one frame'),
    });
  }
  return {
    centroidSeries: ['frame.saliency_x', 'frame.saliency_y', 'frame.saliency_spread'],
    shifts,
    provenance: provenance('ESTIMATED', 'attention.saliency', [PRODUCER], 0.5, 'a computational saliency model; where attention may go, not where it went'),
  };
}

function buildAudio(
  report: ForensicReport,
  samples: SampleClock | null,
  facts: CompileFacts,
  boundaries: Boundary[],
  clock: FrameClock,
  u: (subjectRefs: Ref[], reason: Uncertainty['reason'], impact: Uncertainty['impact'], description: string) => void,
): { audioIR: AudioIR; sound: SoundIR; narration: NarrationIR } {
  const audio = report.audio;
  const noAudio = (why: string) => ({
    audioIR: {
      present: false,
      streamRef: null,
      analysis: null,
      loudness: null,
      series: [],
      events: [],
      separation: { performed: false, method: null, note: why },
    } satisfies AudioIR,
    sound: emptySound(why),
    narration: emptyNarration(why),
  });
  if (!audio || !samples) return noAudio('The file has no audio stream.');
  const hopTime = rt(audio.hop, audio.rate);
  const refs: Ref[] = [PRODUCER, 'stream:a0'];
  const spec: Record<string, { quantity: string; unit: string; method: string; evidence: 'MEASURED' | 'ESTIMATED' }> = {
    rms_db: { quantity: 'RMS level', unit: 'dBFS', method: 'audio.spectrum', evidence: 'MEASURED' },
    peak_db: { quantity: 'sample peak per hop', unit: 'dBFS', method: 'audio.spectrum', evidence: 'MEASURED' },
    spectral_centroid_hz: { quantity: 'spectral centroid', unit: 'Hz', method: 'audio.spectrum', evidence: 'MEASURED' },
    spectral_rolloff_hz: { quantity: '85% spectral roll-off', unit: 'Hz', method: 'audio.spectrum', evidence: 'MEASURED' },
    spectral_flatness: { quantity: 'spectral flatness', unit: 'ratio', method: 'audio.spectrum', evidence: 'MEASURED' },
    spectral_flux: { quantity: 'spectral flux', unit: 'log-magnitude', method: 'audio.spectrum', evidence: 'MEASURED' },
    onset_strength: { quantity: 'onset strength', unit: 'normalised', method: 'audio.onset', evidence: 'MEASURED' },
    zero_crossing_rate: { quantity: 'zero-crossing rate', unit: 'ratio', method: 'audio.spectrum', evidence: 'MEASURED' },
    voice_band_share: { quantity: 'share of 60–8000 Hz energy in 300–3400 Hz', unit: 'ratio', method: 'audio.spectrum', evidence: 'MEASURED' },
    syllabic_modulation: { quantity: 'voice-band modulation at 3–9 Hz', unit: 'ratio', method: 'audio.voice', evidence: 'MEASURED' },
    voiced_share: { quantity: 'share of voiced frames within ±0.5 s', unit: 'ratio', method: 'audio.voice', evidence: 'MEASURED' },
    voicing_alternation_hz: { quantity: 'voiced/unvoiced alternations', unit: 'per second', method: 'audio.voice', evidence: 'MEASURED' },
    intonation_octaves: { quantity: 'pitch spread within ±0.5 s', unit: 'octaves', method: 'audio.voice', evidence: 'MEASURED' },
    pitch_hz: { quantity: 'fundamental frequency', unit: 'Hz', method: 'audio.pitch', evidence: 'ESTIMATED' },
    aperiodicity: { quantity: 'YIN aperiodicity', unit: 'ratio', method: 'audio.pitch', evidence: 'MEASURED' },
    voice_probability: { quantity: 'speech-likeness', unit: 'probability', method: 'audio.voice', evidence: 'ESTIMATED' },
    music_probability: { quantity: 'music-likeness', unit: 'probability', method: 'audio.music', evidence: 'ESTIMATED' },
    band_sub_db: { quantity: 'level 20–60 Hz', unit: 'dB', method: 'audio.spectrum', evidence: 'MEASURED' },
    band_low_db: { quantity: 'level 60–250 Hz', unit: 'dB', method: 'audio.spectrum', evidence: 'MEASURED' },
    band_low_mid_db: { quantity: 'level 250–500 Hz', unit: 'dB', method: 'audio.spectrum', evidence: 'MEASURED' },
    band_mid_db: { quantity: 'level 500–2000 Hz', unit: 'dB', method: 'audio.spectrum', evidence: 'MEASURED' },
    band_high_mid_db: { quantity: 'level 2–4 kHz', unit: 'dB', method: 'audio.spectrum', evidence: 'MEASURED' },
    band_presence_db: { quantity: 'level 4–6 kHz', unit: 'dB', method: 'audio.spectrum', evidence: 'MEASURED' },
    band_brilliance_db: { quantity: 'level 6–20 kHz', unit: 'dB', method: 'audio.spectrum', evidence: 'MEASURED' },
  };
  const series: Series[] = Object.entries(audio.series)
    .filter(([name]) => spec[name])
    .map(([name, values]) => {
      const s = spec[name]!;
      return {
        id: `audio.${name}`,
        quantity: s.quantity,
        unit: s.unit,
        domain: s.evidence === 'MEASURED' ? 'measured' : 'estimated',
        description: '',
        provenance: provenance(s.evidence, s.method, refs, s.evidence === 'MEASURED' ? 1 : 0.6),
        sampling: { kind: 'regular', start: samples.start, step: hopTime, count: values.length },
        values,
      } satisfies Series;
    });
  if (audio.loudness.ok && audio.loudness.blockIndices.length > 0) {
    const first = audio.loudness.blockIndices[0]!;
    for (const [name, values] of [['momentary_lufs', audio.loudness.momentary], ['short_term_lufs', audio.loudness.shortTerm]] as const) {
      series.push({
        id: `audio.${name}`,
        quantity: name === 'momentary_lufs' ? 'momentary loudness (400 ms)' : 'short-term loudness (3 s)',
        unit: 'LUFS',
        domain: 'measured',
        description: 'each value is the loudness of the window ending at its time',
        provenance: provenance('MEASURED', 'loudness.r128', refs),
        sampling: { kind: 'regular', start: addTime(samples.start, rt(first, 10)), step: rt(1, 10), count: values.length },
        values: values.map((v) => (v !== null && v < -69.9 ? null : v)),
      });
    }
  } else {
    u(['stream:a0'], 'not_analyzed', 'medium', 'EBU R128 loudness could not be measured for this file.');
  }

  const events: AudioEvent[] = [];
  for (const event of audio.events) {
    events.push({
      id: `audio.event.${String(events.length + 1).padStart(4, '0')}`,
      kind: event.kind,
      at: samples.at(event.sample),
      range: null,
      magnitude: round(event.magnitude, 5),
      unit: 'normalised onset strength',
      provenance: provenance('MEASURED', 'audio.onset', [...refs, `sample:${event.sample}`]),
    });
  }
  for (const silence of audio.silences) {
    events.push({
      id: `audio.event.${String(events.length + 1).padStart(4, '0')}`,
      kind: 'silence',
      at: samples.at(silence.startSample),
      range: { start: samples.at(silence.startSample), end: samples.at(silence.endSample) },
      magnitude: round(silence.levelDb, 2),
      unit: 'dBFS',
      provenance: provenance('MEASURED', 'audio.silence', [...refs, `sample:${silence.startSample}`]),
    });
  }
  for (const span of audio.voiceSpans) {
    for (const [kind, sample] of [['voice_start', span.startSample], ['voice_end', span.endSample]] as const) {
      events.push({
        id: `audio.event.${String(events.length + 1).padStart(4, '0')}`,
        kind,
        at: samples.at(sample),
        range: null,
        magnitude: round(span.meanProbability, 4),
        unit: 'mean speech-likeness',
        provenance: provenance('ESTIMATED', 'audio.voice', [...refs, `sample:${sample}`], 0.6, 'edge of a speech-like stretch, refined to the sample'),
      });
    }
  }
  events.sort((a, b) => compareTime(a.at, b.at));

  const loud = audio.loudness;
  const loudness: AudioIR['loudness'] = {
    integratedLufs: loud.integratedLufs === null ? unknown('loudness.r128', 'Not measured.', refs) : measured(loud.integratedLufs, 'loudness.r128', refs, 1, { unit: 'LUFS' }),
    loudnessRangeLu: loud.loudnessRangeLu === null ? unknown('loudness.r128', 'Not measured.', refs) : measured(loud.loudnessRangeLu, 'loudness.r128', refs, 1, { unit: 'LU' }),
    truePeakDbtp: loud.truePeakDbtp === null ? unknown('loudness.r128', 'Not measured.', refs) : measured(loud.truePeakDbtp, 'loudness.r128', refs, 1, { unit: 'dBTP' }),
    samplePeakDbfs: loud.samplePeakDbfs === null ? unknown('loudness.r128', 'Not measured.', refs) : measured(loud.samplePeakDbfs, 'loudness.r128', refs, 1, { unit: 'dBFS' }),
  };

  const audioIR: AudioIR = {
    present: true,
    streamRef: 'stream:a0',
    analysis: {
      sampleRate: audio.rate,
      channels: audio.channels,
      mixdown: 'mean of all channels',
      hop: hopTime,
      window: rt(audio.window, audio.rate),
      analyzedSamples: audio.samples,
    },
    loudness,
    series,
    events,
    separation: {
      performed: false,
      method: null,
      note: 'No source-separation model was used. Voice, music and effects are estimated from spectral shape, syllabic modulation, periodicity and rhythm; they are probabilities, not stems.',
    },
  };

  const musicShare = share(audio.series['music_probability'] ?? [], (v) => v > 0.5, audio.series['rms_db'] ?? [], (v) => v > -50);
  /*
   * A tempo is a claim about many onsets. An autocorrelation of three clicks
   * in four seconds is strong and says nothing, and a beat grid laid over it
   * would put forty events on a timeline where nothing happens. So a tempo
   * needs enough onsets to establish a period, and beats that actually land
   * on what was heard.
   */
  const onsetCount = audio.events.length;
  const snappedShare = audio.beats.length ? audio.beats.filter((beat) => beat.snapped).length / audio.beats.length : 0;
  const tempoGap = audio.tempo.bpm === null
    ? 'No periodicity in the onsets strong enough to call a tempo.'
    : audio.tempo.strength < 0.1
      ? `A periodicity was found but too weak (strength ${round(audio.tempo.strength, 3)}) to call a tempo.`
      : onsetCount < MIN_ONSETS_FOR_TEMPO
        ? `Only ${onsetCount} onset(s) were heard: too few to establish a period.`
        : snappedShare < MIN_BEATS_ON_ONSETS
          ? `Only ${Math.round(snappedShare * 100)}% of the beats a ${round(audio.tempo.bpm, 1)} BPM grid would place land on a heard onset.`
          : null;
  const tempoKnown = tempoGap === null;
  const keyUsable = audio.key !== null && musicShare !== null && musicShare >= 0.3 && audio.key.margin >= MIN_KEY_MARGIN;
  const tempoConfidence = round(MUSIC_CEILING.tempo * clamp01(audio.tempo.strength * 2), 3);
  const accented = tempoKnown && audio.downbeat !== null && audio.downbeat.contrast >= 1.25;
  const music: MusicIR = {
    present: musicShare === null
      ? unknown('audio.music', 'Nothing audible to judge.', refs)
      // A spectral heuristic, not a trained classifier: however one-sided the share, it is never certain.
      : estimated(musicShare >= 0.3, 'audio.music', refs, Math.min(MUSIC_CEILING.presence, round(Math.abs(musicShare - 0.3) + 0.4, 3)), { note: `${Math.round(musicShare * 100)}% of the audible stretches sound like music` }),
    tempoBpm: tempoKnown
      ? estimated(round(audio.tempo.bpm!, 2), 'audio.beats', refs, tempoConfidence, { unit: 'BPM', note: `autocorrelation strength ${round(audio.tempo.strength, 3)}; ${Math.round(snappedShare * 100)}% of beats on heard onsets; half or double this tempo is not excluded` })
      : unknown('audio.beats', tempoGap!, refs),
    meter: unknown('audio.beats', 'The meter is not established: bar grouping would be an assumption.', refs),
    key: keyUsable
      ? estimated(audio.key!.key, 'audio.key', refs, round(MUSIC_CEILING.key * clamp01(audio.key!.margin * 4), 3), { note: `correlation ${round(audio.key!.correlation, 3)}; runner-up ${audio.key!.runnerUp}` })
      : unknown('audio.key', audio.key && musicShare !== null && musicShare >= 0.3
        ? `Ambiguous: ${audio.key.key} and ${audio.key.runnerUp} fit the pitch content almost equally (margin ${round(audio.key.margin, 3)}).`
        : 'No key is estimated where the sound is not clearly music.', refs),
    beats: {
      times: tempoKnown ? audio.beats.map((beat) => samples.at(beat.sample)) : [],
      provenance: provenance(tempoKnown ? 'ESTIMATED' : 'UNKNOWN', 'audio.beats', refs, tempoKnown ? tempoConfidence : 0, 'beats within 35 ms of an onset sit on that onset\'s sample; the others on the 10 ms grid'),
    },
    downbeats: accented
      ? {
          times: audio.beats.filter((_, i) => i % 4 === audio.downbeat!.phase).map((beat) => samples.at(beat.sample)),
          provenance: provenance('ESTIMATED', 'audio.beats', refs, round(MUSIC_CEILING.downbeat * clamp01((audio.downbeat!.contrast - 1) / 2), 3), 'every fourth beat, phase chosen by accent; four beats to a bar is an assumption'),
        }
      : { times: [], provenance: provenance('UNKNOWN', 'audio.beats', refs, 0, tempoKnown ? 'No beat in four stands out by its accent.' : 'No tempo, so no bar to begin.') },
    sections: [],
    ducking: audio.ducking.map((duck, index) => ({
      id: `music.ducking.${String(index + 1).padStart(3, '0')}`,
      range: { start: samples.at(duck.startSample), end: samples.at(duck.endSample) },
      depthDb: estimated(round(duck.depthDb, 2), 'audio.ducking', refs, 0.5, { unit: 'dB' }),
      underRefs: [`sample:${duck.startSample}`],
    })),
    description: unknown('compiler.absent', 'Not interpreted yet.'),
  };

  const voiceAt = (sample: number) => audio.series['voice_probability']?.[Math.min(Math.floor(sample / audio.hop), (audio.series['voice_probability']?.length ?? 1) - 1)] ?? 0;
  const sfx: SfxEvent[] = audio.events
    .filter((event) => event.kind === 'transient' && (voiceAt(event.sample) ?? 0) < 0.5)
    .map((event, index) => ({
      id: `sfx.${String(index + 1).padStart(4, '0')}`,
      at: samples.at(event.sample),
      range: { start: samples.at(event.sample), end: samples.at(Math.min(audio.samples, event.sample + Math.round(0.15 * audio.rate))) },
      label: unknown('compiler.absent', 'What the sound is has not been identified.'),
      onsetStrength: round(event.magnitude, 5),
      spectralCentroidHz: round(event.centroidHz, 1),
      eventRef: null,
      provenance: provenance('ESTIMATED', 'audio.onset', [...refs, `sample:${event.sample}`], 0.5, 'a transient outside speech-like stretches; an effect, or a percussive note'),
    }));

  const bridges: SoundIR['bridges'] = boundaries.map((boundary, index) => {
    const at = boundary.at;
    const cutSample = sampleAt(at, samples, audio.rate);
    const silent = audio.silences.some((silence) => silence.startSample <= cutSample && silence.endSample >= cutSample);
    const hit = audio.events.some((event) => Math.abs(event.sample - cutSample) <= Math.round((2 / facts.fps) * audio.rate) && event.kind === 'transient');
    const before = boundary.outgoing.audioLevelDb;
    const after = boundary.incoming.audioLevelDb;
    const sustained = before !== null && after !== null && Math.abs(after - before) < 6 && before > -50;
    const kind = silent ? 'silence_on_cut' : hit ? 'hit_on_cut' : sustained ? 'sustain_across' : 'none';
    return {
      id: `bridge.${String(index + 1).padStart(3, '0')}`,
      boundaryId: boundary.id,
      kind: measured(kind, 'compiler.derivation', [...refs, `boundary:${boundary.id}`], 0.8, { note: 'silence across the boundary, a transient within two frames of it, or a level held within 6 dB' }),
      range: boundary.range,
    };
  });

  const sound: SoundIR = {
    music,
    sfx,
    ambience: { present: unknown('compiler.absent', 'Ambience is not separable from music by the measurements alone.'), description: unknown('compiler.absent', 'Not interpreted yet.') },
    silences: audio.silences.map((silence, index) => ({
      id: `silence.${String(index + 1).padStart(3, '0')}`,
      range: { start: samples.at(silence.startSample), end: samples.at(silence.endSample) },
      levelDbfs: round(silence.levelDb, 2),
      provenance: provenance('MEASURED', 'audio.silence', [...refs, `sample:${silence.startSample}`]),
    })),
    bridges,
  };

  const speechShare = share(audio.series['voice_probability'] ?? [], (v) => v > 0.5, audio.series['rms_db'] ?? [], (v) => v > -50);
  const narration = emptyNarration('No transcription has been made yet.');
  narration.present = speechShare === null
    ? unknown('audio.voice', 'Nothing audible to judge.', refs)
    : estimated(audio.voiceSpans.length > 0, 'audio.voice', refs, 0.5, { note: `${audio.voiceSpans.length} speech-like stretch(es), ${Math.round((speechShare ?? 0) * 100)}% of audible time; a heuristic, confirmed or refuted by transcription` });
  void clock;
  return { audioIR, sound, narration };
}

export function emptyNarration(why: string): NarrationIR {
  return {
    present: unknown('compiler.absent', why),
    language: unknown('compiler.absent', why),
    transcript: unknown('compiler.absent', why),
    speakers: [],
    sentences: [],
    phrases: [],
    words: [],
    pauses: [],
    agreement: { comparedWith: null, wordErrorRate: null, comparedWords: 0 },
  };
}

function emptySound(why: string): SoundIR {
  const none = <T>() => unknown<T>('compiler.absent', why);
  return {
    music: {
      present: none(),
      tempoBpm: none(),
      meter: none(),
      key: none(),
      beats: { times: [], provenance: provenance('UNKNOWN', 'compiler.absent', [], 0, why) },
      downbeats: { times: [], provenance: provenance('UNKNOWN', 'compiler.absent', [], 0, why) },
      sections: [],
      ducking: [],
      description: none(),
    },
    sfx: [],
    ambience: { present: none(), description: none() },
    silences: [],
    bridges: [],
  };
}

function buildCurves(report: ForensicReport, facts: CompileFacts, clock: FrameClock): Series[] {
  const n = report.frames.count;
  const area = facts.width * facts.height;
  const textOccupancy = new Array<number>(n).fill(0);
  for (const line of report.text.lines) {
    const refinement = line.refinement;
    if (!refinement || !refinement.measured) continue;
    const boxArea = line.referenceBox[2] * line.referenceBox[3];
    refinement.samples.frames.forEach((frame, i) => {
      const visibility = refinement.samples.opacity[i] ?? 0;
      if (visibility >= 0.5 && frame < n) textOccupancy[frame] = Math.min(1, textOccupancy[frame]! + boxArea / area);
    });
  }
  const curves: Series[] = [
    {
      id: 'curve.text_occupancy',
      quantity: 'share of the frame covered by visible text',
      unit: 'ratio',
      domain: 'measured',
      description: 'sum of the settled boxes of lines at least half visible, capped at 1',
      provenance: provenance('MEASURED', 'compiler.derivation', [PRODUCER], 0.9),
      sampling: { kind: 'frames' },
      values: textOccupancy.map((v) => round(v, 5)),
    },
  ];
  if (facts.panelBoxes.size > 0) {
    const panel = new Array<number | null>(n).fill(0);
    for (const [frame, boxes] of facts.panelBoxes) {
      if (frame < n) panel[frame] = round(Math.min(1, boxes.reduce((sum, box) => sum + (box.width * box.height) / area, 0)), 5);
    }
    curves.push({
      id: 'curve.panel_occupancy',
      quantity: 'share of the frame covered by tracked panels',
      unit: 'ratio',
      domain: 'measured',
      description: 'sum of tracked panel boxes, capped at 1; overlapping panels are counted twice',
      provenance: provenance('MEASURED', 'compiler.derivation', [PRODUCER], 0.8),
      sampling: { kind: 'frames' },
      values: panel,
    });
  }
  void clock;
  return curves;
}

function buildReconstruction(typography: TypographyIR, camera: CameraTrack, panels: TrackedObject[], objects: Map<string, TrackedObject>, clock: FrameClock): ReconstructionIR {
  const shots = new Map<string, ReconstructionIR['shots'][number]>();
  const shotFor = (id: string) => {
    let entry = shots.get(id);
    if (!entry) {
      entry = { shotId: id, layers: [], camera: [], audioCues: [], notes: [] };
      shots.set(id, entry);
    }
    return entry;
  };
  let measuredCount = 0;
  let estimatedCount = 0;
  let unknownCount = 0;
  for (const block of typography.blocks) {
    const first = block.timing.firstVisible;
    const settled = block.timing.settled;
    if (first.value === null || settled.value === null) {
      unknownCount += 1;
      continue;
    }
    const fit = block.enter.fits.find((candidate) => candidate.property === 'opacity');
    const properties: ReconstructionIR['shots'][number]['layers'][number]['properties'] = [
      {
        property: 'opacity',
        keyframes: [
          { frame: block.frames.first, value: 0 },
          { frame: clock.frameAt(settled.value), value: 1 },
        ],
        easing: fit ? describeFit(fit) : 'unknown',
        fitRef: fit ? (`fit:${fit.id}` as Ref) : null,
        provenance: provenance('RECOMMENDED_RECONSTRUCTION', 'compiler.derivation', [`text:${block.id}`], fit ? clamp01(fit.rSquared) : 0.4),
      },
    ];
    const translation = block.enter.translation.value;
    if (translation && (Math.abs(translation.dx) >= 1 || Math.abs(translation.dy) >= 1)) {
      properties.push({
        property: 'translate',
        keyframes: [
          { frame: block.frames.first, value: round(-Math.hypot(translation.dx, translation.dy), 2) },
          { frame: clock.frameAt(settled.value), value: 0 },
        ],
        easing: 'as the opacity',
        fitRef: null,
        provenance: provenance('RECOMMENDED_RECONSTRUCTION', 'compiler.derivation', [`text:${block.id}`], 0.6, `direction (${round(translation.dx, 1)}, ${round(translation.dy, 1)}) px`),
      });
    }
    measuredCount += 1;
    const shot = objects.get(block.objectIds[0]!)?.shotIds[0] ?? 'unassigned';
    shotFor(shot).layers.push({ objectId: block.objectIds[0]!, properties });
  }
  for (const move of camera.moves) {
    const fit = move.fits[0];
    shotFor(move.shotId).camera.push({
      property: fit?.property ?? 'pose',
      keyframes: [
        { frame: move.frames.first, value: fit ? fit.from : 0 },
        { frame: move.frames.last, value: fit ? fit.to : 0 },
      ],
      easing: fit ? describeFit(fit) : 'unknown',
      provenance: provenance('RECOMMENDED_RECONSTRUCTION', 'compiler.derivation', [`camera:${move.id}`], fit ? clamp01(fit.rSquared) : 0.3),
    });
    if (fit) estimatedCount += 1;
    else unknownCount += 1;
  }
  for (const panel of panels) {
    for (const fit of panel.fits) {
      shotFor(panel.shotIds[0] ?? 'unassigned').layers.push({
        objectId: panel.id,
        properties: [{
          property: fit.property,
          keyframes: [
            { frame: fit.frames.first, value: fit.from },
            { frame: fit.frames.last, value: fit.to },
          ],
          easing: describeFit(fit),
          fitRef: `fit:${fit.id}` as Ref,
          provenance: provenance('RECOMMENDED_RECONSTRUCTION', 'compiler.derivation', [`obj:${panel.id}`], clamp01(fit.rSquared)),
        }],
      });
      estimatedCount += 1;
    }
  }
  const total = Math.max(1, measuredCount + estimatedCount + unknownCount);
  return {
    strategy: recommended(
      'Rebuild each shot as layers: every text block on its own layer with its measured entry and exit, every tracked panel with its fitted move, and the apparent camera where it is observable. Timings are frame-exact from the measurements; curves are best fits, to be matched in feel rather than copied.',
      'compiler.derivation',
      [PRODUCER],
      0.6,
    ),
    shots: [...shots.values()],
    coverage: {
      measuredShare: round(measuredCount / total, 3),
      estimatedShare: round(estimatedCount / total, 3),
      unknownShare: round(unknownCount / total, 3),
    },
  };
}

function describeFit(fit: CurveFit): string {
  const p = fit.parameters;
  switch (fit.model) {
    case 'cubic_bezier':
      return `cubic-bezier(${p['x1']}, ${p['y1']}, ${p['x2']}, ${p['y2']}), R² ${fit.rSquared}`;
    case 'damped_spring':
      return `damped spring ω=${p['angularFrequency']} ζ=${p['dampingRatio']} (normalised time), R² ${fit.rSquared}`;
    case 'power_ease_out':
    case 'power_ease_in':
    case 'power_ease_in_out':
      return `${fit.model.replace(/_/g, ' ')} power ${p['power']}, R² ${fit.rSquared}`;
    case 'exponential_ease_out':
      return `exponential ease-out rate ${p['rate']}, R² ${fit.rSquared}`;
    default:
      return `${fit.model}, R² ${fit.rSquared}`;
  }
}

// ——— small utilities ———

export function shotId(index: number): string {
  return `shot.${String(index + 1).padStart(3, '0')}`;
}

export function framesRef(first: number, last: number): Ref {
  return first === last ? `frame:${first}` : `frames:${Math.min(first, last)}-${Math.max(first, last)}`;
}

function phaseKind(kind: string): MotionPhaseKind {
  const known: MotionPhaseKind[] = ['start', 'acceleration_peak', 'peak_velocity', 'deceleration_peak', 'settle', 'reversal', 'pause', 'end'];
  return (known as string[]).includes(kind) ? (kind as MotionPhaseKind) : 'pause';
}

function derivative(values: (number | null)[], fps: number): (number | null)[] {
  return values.map((value, i) => {
    if (i === 0 || value === null) return null;
    const before = values[i - 1];
    return before === null || before === undefined ? null : round((value - before) * fps, 3);
  });
}

function sliceValues(values: (number | null)[] | undefined, first: number, last: number): number[] {
  if (!values) return [];
  return values.slice(first, last + 1).filter((v): v is number => v !== null);
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : round(values.reduce((a, b) => a + b, 0) / values.length, 6);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length === 0 ? 0 : sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function share(values: (number | null)[], predicate: (v: number) => boolean, gate: (number | null)[], gatePredicate: (v: number) => boolean): number | null {
  let total = 0;
  let hits = 0;
  values.forEach((value, i) => {
    const g = gate[i];
    if (value === null || g === null || g === undefined || !gatePredicate(g)) return;
    total += 1;
    if (predicate(value)) hits += 1;
  });
  return total === 0 ? null : hits / total;
}

function hopAt(time: RationalTime, samples: SampleClock, hop: number): number | null {
  const offset = subtractTime(time, samples.start);
  const seconds = Number(BigInt(offset.ticks)) / offset.timescale;
  if (seconds < 0) return null;
  return Math.round((seconds * samples.rate) / hop);
}

function sampleAt(time: RationalTime, samples: SampleClock, rate: number): number {
  const offset = subtractTime(time, samples.start);
  return Math.round((Number(BigInt(offset.ticks)) / offset.timescale) * rate);
}

function beatPhase(time: RationalTime, beats: RationalTime[]): number | null {
  if (beats.length < 2) return null;
  let previous = -1;
  for (let i = 0; i < beats.length; i += 1) {
    if (compareTime(beats[i]!, time) <= 0) previous = i;
    else break;
  }
  if (previous < 0 || previous + 1 >= beats.length) return null;
  const a = Number(BigInt(beats[previous]!.ticks)) / beats[previous]!.timescale;
  const b = Number(BigInt(beats[previous + 1]!.ticks)) / beats[previous + 1]!.timescale;
  const t = Number(BigInt(time.ticks)) / time.timescale;
  return round((t - a) / (b - a), 4);
}

function blockAlignment(boxes: [number, number, number, number][], frameWidth: number): 'left' | 'center' | 'right' | null {
  if (boxes.length < 2) {
    const box = boxes[0];
    if (!box) return null;
    const centre = box[0] + box[2] / 2;
    return Math.abs(centre - frameWidth / 2) < frameWidth * 0.02 ? 'center' : null;
  }
  const tolerance = frameWidth * 0.006;
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
  if (spread(boxes.map((b) => b[0])) <= tolerance) return 'left';
  if (spread(boxes.map((b) => b[0] + b[2] / 2)) <= tolerance) return 'center';
  if (spread(boxes.map((b) => b[0] + b[2])) <= tolerance) return 'right';
  return null;
}

function colourDistance(a: (number | null)[] | undefined, b: (number | null)[] | undefined): number | null {
  if (!a || !b || a.some((v) => v === null) || b.some((v) => v === null)) return null;
  const [l1, a1, b1] = oklab(a as number[]);
  const [l2, a2, b2] = oklab(b as number[]);
  return round(Math.hypot(l2 - l1, a2 - a1, b2 - b1), 5);
}

function oklab([r, g, b]: number[]): [number, number, number] {
  const linear = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [linear(r!), linear(g!), linear(b!)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function hex(rgb: number[]): string {
  return `#${rgb.slice(0, 3).map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
}

function toBox(box: [number, number, number, number]): Box {
  return { x: round(box[0], 2), y: round(box[1], 2), width: round(Math.max(0, box[2]), 2), height: round(Math.max(0, box[3]), 2) };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
