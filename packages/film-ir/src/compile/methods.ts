import type { Method } from '../schema/source.ts';

/**
 * Every method a FilmIR value can cite, registered once.
 *
 * The id is what a value's provenance names; the entry says what the method
 * is, with the parameters that would reproduce it. Deterministic methods are
 * recomputable from the file; model methods are not, and say so.
 */
export function forensicMethods(versions: { analyzer: string; opencv: string; pyav: string; numpy: string; ocr: string | null }): Method[] {
  const analyzer = `actone-forensics ${versions.analyzer}`;
  const m = (
    id: string,
    kind: Method['kind'],
    name: string,
    description: string,
    parameters: Record<string, unknown> = {},
    citation: string | null = null,
    deterministic = true,
    version = analyzer,
  ): Method => ({ id, kind, name, version, deterministic, description, parameters, citation });
  return [
    m('container.pyav', 'container', 'Container and stream metadata', `Read by FFmpeg's demuxer through PyAV ${versions.pyav}; verbatim.`),
    m('decode.pts', 'decoder', 'Decoded presentation timestamps', 'Each decoded frame\'s pts and duration in its stream time base, in presentation order.'),
    m('decode.hash', 'decoder', 'Decoded frame hash', 'BLAKE2b-128 of the decoded frame at native resolution and pixel format. Equal hashes: identical pictures.'),
    m('pixels.luma', 'vision', 'Luma statistics', 'Rec. 709 luma (0.2126R′+0.7152G′+0.0722B′) of the frame at working resolution, 0..1: mean, standard deviation, percentiles, 64-bin entropy.', { workingWidth: 480 }),
    m('pixels.colour', 'vision', 'Colour statistics', 'Mean HSV saturation; mean Oklab chroma; a 12-bin hue histogram weighted by chroma, at 160 px wide.', { colourWidth: 160 }, 'Ottosson (2020), Oklab'),
    m('pixels.dominant', 'vision', 'Dominant colours', 'k-means (k=5, k-means++, fixed seed) in Oklab at 160 px wide; clusters sorted by share.', { k: 5, seed: 0 }),
    m('pixels.border', 'vision', 'Field colour', 'Median colour of the outer 6% of the frame: the background the picture sits on.'),
    m('pixels.sharpness', 'vision', 'Sharpness', 'Variance of the Laplacian of the working-resolution luma.'),
    m('pixels.edges', 'vision', 'Edge density', 'Share of pixels on a Canny edge (thresholds 80/160) at working resolution.'),
    m('pixels.si_ti', 'vision', 'Spatial and temporal information', 'SI: standard deviation of the Sobel magnitude; TI: standard deviation of the frame difference.', {}, 'ITU-T P.910'),
    m('pixels.change', 'vision', 'Frame-to-frame change', 'Mean absolute luma difference at 160 px; Bhattacharyya distance of 16×4×4 HSV histograms; edge change ratio.', {}, 'Zabih, Miller & Mai (1995), edge change ratio'),
    m('motion.flow', 'vision', 'Dense optical flow', `DIS optical flow (fast preset, OpenCV ${versions.opencv}) at 320 px wide: mean and 90th-percentile magnitude as a share of frame width; residual after the global homography; two-cluster layer speed ratio.`, { flowWidth: 320 }, 'Kroeger et al. (2016), DIS'),
    m('motion.global', 'vision', 'Global motion', 'Shi-Tomasi corners tracked by pyramidal Lucas-Kanade forward and back (1 px round trip), homography by RANSAC (1.5 px, fixed seed); pose of the frame centre, scale, rotation, perspective, inliers, 8×6 coverage.', { maxCorners: 500, ransacThreshold: 1.5 }),
    m('motion.camera', 'derivation', 'Apparent camera', 'Frame-to-frame homographies chained from the first frame of each shot; resets at each boundary; stops at the first untracked frame. Observability from tracked coverage.'),
    m('attention.saliency', 'vision', 'Computational saliency', 'Spectral residual saliency on a 64×64 luma thumbnail; the saliency-weighted centroid and spread. A model of where attention may go, not a measurement of anybody\'s attention.', {}, 'Hou & Zhang (2007)'),
    m('boundary.cut', 'vision', 'Hard cut detection', 'A single-frame discontinuity where histogram distance, pixel difference and edge change ratio all exceed adaptive thresholds; one-frame flashes excluded.', { histogramFloor: 0.3, pixelFloor: 0.05 }),
    m('boundary.fade', 'vision', 'Fade detection', 'A ramp into or out of a uniform field (luma std < 0.02) whose frames fit α·picture + (1−α)·field with mean RMS residual ≤ 0.02 and monotonic α.'),
    m('boundary.dissolve', 'vision', 'Dissolve detection', 'A run of frames fitting α·A + (1−α)·B with A and B the frames either side, α monotonic from ≥0.7 to ≤0.3, mean RMS residual ≤ 0.02.'),
    m('boundary.field', 'vision', 'Field change', 'The border colour moving by ≥0.12 in Oklab within half a second: a change of world without a cut.'),
    m('text.ocr', 'ocr', 'Text reading', `RapidOCR (PP-OCR detection and recognition, ONNX) at 1280 px wide on a stride, with unchanged frames reused; recogniser confidence ≥ 0.5.`, {}, null, true, versions.ocr ?? 'unavailable'),
    m('text.glyphs', 'ocr', 'Glyph boxes', 'Per-character boxes from the recogniser\'s CTC alignment on the reference frame. Approximate: widths are the alignment\'s, not the glyph outlines.', {}, null, true, versions.ocr ?? 'unavailable'),
    m('text.geometry', 'vision', 'Type geometry', 'On each line\'s reference frame at the film\'s own resolution. Each letter is read from its own connected ink where the letters stand apart (matched to the reading in order), else from the middle of its recogniser box; its top and bottom are where its coverage crosses half, to a fraction of a pixel. Baseline, cap height and x-height are the edges most glyphs of their class agree on, within max(0.75 px, 2% of the line box); a class too few agree on is not reported. Stems are the ink across straight vertical strokes in the middle of the type, as area. Only ink lying mostly inside the line\'s box counts.', { agreementPx: 0.75, agreementShareOfBox: 0.02, hairlinePx: 1.5 }),
    m('type.proportions', 'derivation', 'Size and weight from proportions', 'Size: cap height over 0.708 of the em (x-height over 0.542), bounded by 0.646–0.750 (0.458–0.583). Weight: stem over cap height (or x-height) placed among the weight classes\' medians, bounded by every class whose range holds it. Ratios measured through this analyzer on 30 faces at 48 and 96 px: Inter, Roboto, Montserrat, Poppins, Open Sans and Lato at 100–900; DejaVu Sans and Serif, Liberation Sans and Serif, FreeSans, FreeSerif and Loma at 400 and 700. An estimate from the proportions of faces in general, never an identification of this one.', { capPerEm: 0.708, xPerEm: 0.542, weightMinimumCapPx: 16 }),
    m('text.linking', 'derivation', 'Text tracks', 'Readings linked across samples by box overlap and text similarity, letter-by-letter growth kept as one line; the most confident reading is the line\'s text.'),
    m('text.visibility', 'vision', 'Text visibility', 'The line\'s settled appearance matched on every frame of its window (NCC ≥ 0.6 trusted); ink contrast relative to the settled line where it matches, or in place weighted by correlation where it does not. Milestones are the first frames crossing fixed fractions.', { trustedCorrelation: 0.6, inPlaceFloor: 0.15, inkThreshold: 28 }),
    m('text.blocks', 'derivation', 'Text blocks', 'Lines grouped when they overlap in time by 60%, stack within 1.3 line heights and share an edge or centre.'),
    m('panel.track', 'vision', 'Panel tracking', 'Closed four-sided contours filling ≥85% of their bounding box on each shot\'s middle frame; followed through the shot by NCC template matching at three scales.'),
    m('fit.curves', 'derivation', 'Curve fits', 'Linear, power ease-in/out/in-out, exponential ease-out, CSS cubic-bezier and damped spring fitted by grid search then Nelder–Mead; chosen by small-sample AIC; reported with R², residual and the runner-up. A description of the observed curve, never a claim about the original.'),
    m('motion.phases', 'derivation', 'Motion phases', 'Start, peak velocity, acceleration and deceleration peaks, settle and reversals of a trajectory, with thresholds relative to its own peak speed.'),
    m('audio.decode', 'decoder', 'Audio decode', `Decoded by FFmpeg through PyAV at the stream's own rate; channels averaged for the curves; sample positions from the first frame's timestamp.`),
    m('audio.spectrum', 'signal', 'Spectral curves', 'Hann-windowed STFT (2048 samples) on a 10 ms hop centred on sample k·hop: RMS, peak, centroid, 85% roll-off, flatness, flux, band levels, zero-crossing rate.', { window: 2048, hopMs: 10 }),
    m('audio.pitch', 'signal', 'Pitch', 'YIN on each 2048-sample frame, 60–500 Hz, threshold 0.15, parabolic refinement.', {}, 'de Cheveigné & Kawahara (2002)'),
    m('audio.onset', 'signal', 'Onsets', 'Peaks of spectral flux above a local median, refined to the sample where a 1 ms energy envelope rises fastest; transients are onsets that decay ≥6 dB in 150 ms with ≥10% energy above 4 kHz.'),
    m('audio.silence', 'signal', 'Silence', 'RMS below −60 dBFS for at least 200 ms; edges refined to where a 5 ms RMS crosses the threshold.', { thresholdDb: -60, minimumMs: 200 }),
    m('audio.voice', 'signal', 'Speech-likeness', 'A heuristic, not a classifier: syllable-rate (3–9 Hz) modulation of the voice band, voiced/unvoiced alternation, intonation and voice-band share, through a logistic. It says a stretch sounds like speech.'),
    m('audio.music', 'signal', 'Music-likeness', 'A heuristic: onset periodicity at the film\'s tempo, tonality (low spectral flatness) and low-band energy, through a logistic.'),
    m('audio.beats', 'signal', 'Tempo and beats', 'Tempo from the onset envelope\'s autocorrelation with a log-normal prior at 120 BPM; beats by dynamic programming; a beat within 35 ms of an onset is moved onto it.', {}, 'Ellis (2007)'),
    m('audio.key', 'signal', 'Key', 'Pitch-class energy over music-like frames correlated with the Krumhansl–Kessler profiles for all 24 keys.', {}, 'Krumhansl & Kessler (1982)'),
    m('audio.ducking', 'signal', 'Ducking', 'Level outside the voice band during a speech-like span against the second before it, where the second before sounds like music.'),
    m('loudness.r128', 'signal', 'Loudness', 'FFmpeg\'s ebur128 filter: momentary and short-term loudness every 100 ms, integrated loudness, loudness range, true and sample peak.', {}, 'ITU-R BS.1770-4, EBU R 128'),
    m('events.relations', 'derivation', 'Event relations', 'Offsets between events of different modalities within 250 ms, computed exactly on their clocks; uncertainty is the sum of the two events\' resolutions.'),
    m('compiler.derivation', 'derivation', 'Derived value', 'Computed by the compiler from other values in the document, which it cites.'),
    m('compiler.absent', 'derivation', 'Not analyzed', 'No analysis produced this value; it is unknown, not zero.'),
  ];
}

export const ASR_METHOD_ID = 'asr.whisper';
export const GEMINI_METHOD_PREFIX = 'model.gemini';
