import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LIBRARY,
  SAMPLE_RATE,
  encodeWav,
  parseLoudnormJson,
  parseVolumeDetect,
  renderMusic,
  renderSfx,
  rng,
  validateLibrary,
  type Stereo,
} from '../index.ts';

function peak(buffer: Stereo): number {
  let maximum = 0;
  for (let i = 0; i < buffer.left.length; i += 1) {
    maximum = Math.max(maximum, Math.abs(buffer.left[i]!), Math.abs(buffer.right[i]!));
  }
  return maximum;
}

function rms(buffer: Stereo): number {
  let sum = 0;
  for (let i = 0; i < buffer.left.length; i += 1) {
    sum += buffer.left[i]! ** 2 + buffer.right[i]! ** 2;
  }
  return Math.sqrt(sum / (buffer.left.length * 2));
}

/**
 * The longest run of near-silence, in seconds.
 *
 * Better than counting live samples, because a sparse piece is meant to have
 * gaps in it — Column is three quarters silence by design. What no track may
 * have is a stretch where nothing happens at all, which is what an arrangement
 * whose layers never enter actually sounds like.
 */
function longestSilence(buffer: Stereo): number {
  let longest = 0;
  let run = 0;
  for (let i = 0; i < buffer.left.length; i += 1) {
    const quiet = Math.abs(buffer.left[i]!) < 0.001 && Math.abs(buffer.right[i]!) < 0.001;
    run = quiet ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return longest / SAMPLE_RATE;
}

describe('synthesis', () => {
  it('is deterministic, so a library rebuilt elsewhere is the same library', () => {
    const a = rng(1234);
    const b = rng(1234);
    const first = Array.from({ length: 64 }, () => a());
    const second = Array.from({ length: 64 }, () => b());
    expect(first).toEqual(second);
  });

  it('writes a WAV header the rest of the world can read', () => {
    const frames = 480;
    const buffer: Stereo = { left: new Float32Array(frames), right: new Float32Array(frames) };
    buffer.left[0] = 1;
    buffer.right[0] = -1;

    const wav = encodeWav(buffer);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const text = (at: number) => String.fromCharCode(...wav.slice(at, at + 4));

    expect(text(0)).toBe('RIFF');
    expect(text(8)).toBe('WAVE');
    expect(text(12)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(2); // stereo
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16); // bit depth
    expect(text(36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(frames * 4);
    expect(wav.length).toBe(44 + frames * 4);
    // Full scale, and clamped rather than wrapped.
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32767);
  });
});

describe('the library', () => {
  /*
   * The scores are rendered here rather than mocked, at a fraction of their
   * real length: every one of these has a bug class that only exists in the
   * audio — a voice that never enters, a filter that self-oscillates into
   * clipping, an arrangement that is silent for its first thirty seconds — and
   * none of them are visible in the code.
   */
  // Rendered once and shared: 30 seconds of stereo at 48kHz is 1.4M samples per
  // track, and three assertions over seven tracks is a minute of CPU otherwise.
  const rendered = new Map<string, Stereo>();
  const brief = (id: string) => {
    const existing = rendered.get(id);
    if (existing) return existing;
    const track = DEFAULT_LIBRARY.music.find((t) => t.id === id)!;
    const buffer = renderMusic({ ...track, durationSeconds: 30 });
    rendered.set(id, buffer);
    return buffer;
  };

  it('has a score for every track in the manifest', () => {
    for (const track of DEFAULT_LIBRARY.music) {
      expect(() => brief(track.id), track.id).not.toThrow();
    }
  });

  const effects = new Map<string, Stereo>();
  const effect = (kind: string) => {
    const existing = effects.get(kind);
    if (existing) return existing;
    const buffer = renderSfx(DEFAULT_LIBRARY.sfx.find((s) => s.kind === kind)!);
    effects.set(kind, buffer);
    return buffer;
  };

  it('never clips', () => {
    for (const track of DEFAULT_LIBRARY.music) {
      expect(peak(brief(track.id)), track.id).toBeLessThanOrEqual(1);
    }
    for (const sample of DEFAULT_LIBRARY.sfx) {
      expect(peak(effect(sample.kind)), sample.kind).toBeLessThanOrEqual(1);
    }
  });

  it('produces audible material, not dead air', () => {
    for (const track of DEFAULT_LIBRARY.music) {
      // A track that renders silence is the failure this whole exercise exists
      // to stop, so it is worth asserting rather than assuming.
      expect(rms(brief(track.id)), track.id).toBeGreaterThan(0.01);
      // A sparse piece may breathe; none of them may stop.
      expect(longestSilence(brief(track.id)), track.id).toBeLessThan(2);
    }
    for (const sample of DEFAULT_LIBRARY.sfx) {
      expect(rms(effect(sample.kind)), sample.kind).toBeGreaterThan(0.005);
    }
  });

  it('gives each effect the length its manifest promises', () => {
    for (const sample of DEFAULT_LIBRARY.sfx) {
      expect(effect(sample.kind).left.length, sample.kind).toBe(
        Math.round(sample.durationSeconds * SAMPLE_RATE),
      );
    }
  });

  it('renders the same samples twice', () => {
    const first = renderSfx(DEFAULT_LIBRARY.sfx[0]!);
    const second = renderSfx(DEFAULT_LIBRARY.sfx[0]!);
    expect(Array.from(first.left.slice(0, 256))).toEqual(Array.from(second.left.slice(0, 256)));
  });

  it('starts quiet and ends loud on a riser, which is the whole point of one', () => {
    const buffer = effect('riser_long');
    const window = Math.floor(buffer.left.length / 8);
    const head = buffer.left.slice(0, window).reduce((sum, v) => sum + Math.abs(v), 0) / window;
    const tail = buffer.left.slice(-window).reduce((sum, v) => sum + Math.abs(v), 0) / window;
    expect(tail).toBeGreaterThan(head * 4);
  });

  it('knows when its files are not there', () => {
    expect(validateLibrary(DEFAULT_LIBRARY, () => true).ok).toBe(true);

    const result = validateLibrary(DEFAULT_LIBRARY, () => false);
    expect(result.ok).toBe(false);
    expect(result.missing.length).toBe(DEFAULT_LIBRARY.music.length + DEFAULT_LIBRARY.sfx.length);
  });
});

describe('reading FFmpeg back', () => {
  it('finds a loudnorm measurement in a stream of other output', () => {
    const stderr = [
      '[Parsed_loudnorm_0 @ 0x1] some chatter { not json }',
      'frame=  100 fps=0.0',
      '{',
      '  "input_i" : "-21.30",',
      '  "input_tp" : "-3.20",',
      '  "input_lra" : "6.10",',
      '  "input_thresh" : "-31.40",',
      '  "target_offset" : "0.40"',
      '}',
    ].join('\n');

    expect(parseLoudnormJson(stderr)).toEqual({
      input_i: '-21.30',
      input_tp: '-3.20',
      input_lra: '6.10',
      input_thresh: '-31.40',
      target_offset: '0.40',
    });
  });

  it('refuses a measurement of silence rather than passing -inf to a filter', () => {
    const stderr = '{"input_i":"-inf","input_tp":"-inf","input_lra":"0.00","input_thresh":"-inf","target_offset":"0.00"}';
    expect(parseLoudnormJson(stderr)).toBeNull();
  });

  it('returns null rather than throwing on output it does not recognise', () => {
    expect(parseLoudnormJson('no json at all')).toBeNull();
    expect(parseLoudnormJson('{ truncated')).toBeNull();
  });

  it('reads mean and peak level from volumedetect', () => {
    const stderr = [
      '[Parsed_volumedetect_0 @ 0x1] n_samples: 8640',
      '[Parsed_volumedetect_0 @ 0x1] mean_volume: -22.4 dB',
      '[Parsed_volumedetect_0 @ 0x1] max_volume: -1.5 dB',
    ].join('\n');
    expect(parseVolumeDetect(stderr)).toEqual({ meanDb: -22.4, maxDb: -1.5 });
  });

  it('returns null when volumedetect said nothing useful', () => {
    expect(parseVolumeDetect('')).toBeNull();
  });
});

