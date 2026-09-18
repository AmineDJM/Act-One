/**
 * The synthesis engine behind Act One's own sound library.
 *
 * Act One is limited to four outside providers and none of them sells music, so
 * the library has to be ours. That is a constraint with an upside: a score we
 * synthesise is one we own outright, can regenerate identically, and can tune
 * to the film rather than search for. It is also the honest reading of the
 * manifest, which has always said `license: 'owned'`.
 *
 * Everything here is deterministic. The same seed gives the same samples, so a
 * library rebuilt on another machine is the same library, and a film re-rendered
 * in a year sounds the way it did when it was approved.
 *
 * The primitives are the standard ones — oscillators, one-pole and
 * state-variable filters, envelopes, Karplus-Strong, a Schroeder reverb — kept
 * small and readable rather than general. This is a synthesiser for one job.
 */

export const SAMPLE_RATE = 48_000;

/** A stereo buffer. Interleaving happens once, at the WAV boundary. */
export type Stereo = { left: Float32Array; right: Float32Array };

export function silence(seconds: number): Stereo {
  const length = Math.round(seconds * SAMPLE_RATE);
  return { left: new Float32Array(length), right: new Float32Array(length) };
}

/**
 * Deterministic noise.
 *
 * A 32-bit xorshift rather than Math.random, because a library that sounds
 * different every time it is built is not a library.
 */
export function rng(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/** White noise in [-1, 1]. */
export function noise(random: () => number): number {
  return random() * 2 - 1;
}

// --- oscillators -----------------------------------------------------------

export function sine(phase: number): number {
  return Math.sin(phase * Math.PI * 2);
}

export function triangle(phase: number): number {
  const t = phase % 1;
  return 4 * Math.abs(t - 0.5) - 1;
}

/**
 * A band-limited sawtooth, by additive synthesis.
 *
 * Summing harmonics up to Nyquist rather than using the naive ramp: the naive
 * one aliases audibly on anything that moves in pitch, and the alias is the
 * harshness people mean when they call synthesis "cheap".
 */
export function saw(phase: number, frequency: number, harmonics = 24): number {
  const maxHarmonic = Math.min(harmonics, Math.floor(SAMPLE_RATE / 2 / Math.max(1, frequency)));
  let value = 0;
  for (let h = 1; h <= maxHarmonic; h += 1) {
    value += Math.sin(phase * Math.PI * 2 * h) / h;
  }
  return value * (2 / Math.PI);
}

/** A band-limited square, for percussive plucks and pulses. */
export function square(phase: number, frequency: number, harmonics = 16): number {
  const maxHarmonic = Math.min(harmonics, Math.floor(SAMPLE_RATE / 2 / Math.max(1, frequency)));
  let value = 0;
  for (let h = 1; h <= maxHarmonic; h += 2) {
    value += Math.sin(phase * Math.PI * 2 * h) / h;
  }
  return value * (4 / Math.PI);
}

// --- filters ---------------------------------------------------------------

/** One-pole lowpass. Cheap, gentle, and the right tool for a slow sweep. */
export function lowpass(cutoffHz: number): (input: number) => number {
  const coefficient = Math.exp((-2 * Math.PI * cutoffHz) / SAMPLE_RATE);
  let previous = 0;
  return (input) => {
    previous = input * (1 - coefficient) + previous * coefficient;
    return previous;
  };
}

export function highpass(cutoffHz: number): (input: number) => number {
  const coefficient = Math.exp((-2 * Math.PI * cutoffHz) / SAMPLE_RATE);
  let previousIn = 0;
  let previousOut = 0;
  return (input) => {
    previousOut = coefficient * (previousOut + input - previousIn);
    previousIn = input;
    return previousOut;
  };
}

/**
 * A state-variable filter, which is what a resonant sweep needs.
 *
 * The one-pole above cannot resonate, and resonance is most of the character in
 * a riser or a filtered pad. Cutoff is per-sample so it can be modulated.
 */
export function stateVariable(q = 1): {
  lp: (input: number, cutoffHz: number) => number;
  bp: (input: number, cutoffHz: number) => number;
} {
  let low = 0;
  let band = 0;
  const damping = 1 / Math.max(0.5, q);
  const step = (input: number, cutoffHz: number) => {
    const f = 2 * Math.sin((Math.PI * Math.min(cutoffHz, SAMPLE_RATE / 3)) / SAMPLE_RATE);
    low += f * band;
    const high = input - low - damping * band;
    band += f * high;
    return { low, band };
  };
  return {
    lp: (input, cutoffHz) => step(input, cutoffHz).low,
    bp: (input, cutoffHz) => step(input, cutoffHz).band,
  };
}

// --- envelopes -------------------------------------------------------------

/** Exponential decay from 1 to 0 over `seconds`, as a function of sample index. */
export function decay(seconds: number): (sample: number) => number {
  const tau = Math.max(1, seconds * SAMPLE_RATE) / 5;
  return (sample) => Math.exp(-sample / tau);
}

/** A simple attack-decay-sustain-release envelope, in seconds. */
export function adsr(params: {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  durationSeconds: number;
}): (sample: number) => number {
  const attack = params.attack * SAMPLE_RATE;
  const decayLength = params.decay * SAMPLE_RATE;
  const release = params.release * SAMPLE_RATE;
  const total = params.durationSeconds * SAMPLE_RATE;
  const releaseStart = Math.max(attack + decayLength, total - release);

  return (sample) => {
    if (sample < attack) return attack === 0 ? 1 : sample / attack;
    if (sample < attack + decayLength) {
      const t = (sample - attack) / Math.max(1, decayLength);
      return 1 - t * (1 - params.sustain);
    }
    if (sample < releaseStart) return params.sustain;
    const t = (sample - releaseStart) / Math.max(1, total - releaseStart);
    return params.sustain * Math.max(0, 1 - t);
  };
}

/** Equal-power crossfade window, for looping a texture without a seam. */
export function fadeWindow(sample: number, total: number, fadeSamples: number): number {
  if (sample < fadeSamples) return Math.sin((Math.PI / 2) * (sample / fadeSamples));
  if (sample > total - fadeSamples) {
    return Math.sin((Math.PI / 2) * ((total - sample) / fadeSamples));
  }
  return 1;
}

// --- voices ----------------------------------------------------------------

/**
 * Karplus-Strong: a plucked string.
 *
 * A burst of noise in a delay line that is low-pass filtered each time round.
 * It is the oldest trick in physical modelling and still the most convincing
 * pluck for the money — which matters here, because a sampled piano is not
 * something we can license.
 */
export function pluck(
  frequency: number,
  seconds: number,
  random: () => number,
  brightness = 0.5,
): Float32Array {
  const length = Math.round(seconds * SAMPLE_RATE);
  const delayLength = Math.max(2, Math.round(SAMPLE_RATE / frequency));
  const buffer = new Float32Array(delayLength);
  for (let i = 0; i < delayLength; i += 1) buffer[i] = noise(random);

  const output = new Float32Array(length);
  const damping = 0.5 + brightness * 0.49;
  let index = 0;
  for (let i = 0; i < length; i += 1) {
    const current = buffer[index]!;
    const next = buffer[(index + 1) % delayLength]!;
    const averaged = (current + next) * 0.5 * damping;
    buffer[index] = averaged;
    output[i] = current;
    index = (index + 1) % delayLength;
  }
  return output;
}

/** Soft saturation. Glues a mix without the brittleness of hard clipping. */
export function saturate(input: number, drive = 1.4): number {
  return Math.tanh(input * drive) / Math.tanh(drive);
}

// --- space -----------------------------------------------------------------

/**
 * A Schroeder reverb: four combs into two allpasses.
 *
 * Not a convolution and not trying to be a room you could name. What it
 * provides is the one thing dry synthesis always lacks — a sense that the
 * sound is somewhere — and at these settings it stays out of the way of a
 * voice-over, which is what this library exists to sit under.
 */
export function reverb(options: { decaySeconds: number; mix: number; preDelayMs?: number }) {
  const combDelays = [1687, 1601, 2053, 2251];
  const allpassDelays = [389, 127];
  const preDelay = Math.round(((options.preDelayMs ?? 20) / 1000) * SAMPLE_RATE);

  const combs = combDelays.map((length) => ({
    buffer: new Float32Array(length),
    index: 0,
    feedback: Math.pow(0.001, length / SAMPLE_RATE / Math.max(0.1, options.decaySeconds)),
    damp: lowpass(4200),
  }));
  const allpasses = allpassDelays.map((length) => ({
    buffer: new Float32Array(length),
    index: 0,
  }));
  const preBuffer = new Float32Array(Math.max(1, preDelay));
  let preIndex = 0;

  return (input: number): number => {
    const delayed = preBuffer[preIndex]!;
    preBuffer[preIndex] = input;
    preIndex = (preIndex + 1) % preBuffer.length;

    let wet = 0;
    for (const comb of combs) {
      const sample = comb.buffer[comb.index]!;
      wet += sample;
      comb.buffer[comb.index] = delayed + comb.damp(sample) * comb.feedback;
      comb.index = (comb.index + 1) % comb.buffer.length;
    }
    wet /= combs.length;

    for (const allpass of allpasses) {
      const sample = allpass.buffer[allpass.index]!;
      const output = -wet + sample;
      allpass.buffer[allpass.index] = wet + sample * 0.5;
      allpass.index = (allpass.index + 1) % allpass.buffer.length;
      wet = output;
    }

    return input * (1 - options.mix) + wet * options.mix;
  };
}

// --- output ----------------------------------------------------------------

/**
 * Normalises a buffer to a peak, leaving loudness to FFmpeg.
 *
 * Peak-normalising here and measuring loudness properly afterwards is the right
 * division of labour: RMS is not loudness, and the library declares LUFS, which
 * only a BS.1770 meter can actually deliver.
 */
export function normalizePeak(buffer: Stereo, peak = 0.89): Stereo {
  let maximum = 0;
  for (let i = 0; i < buffer.left.length; i += 1) {
    maximum = Math.max(maximum, Math.abs(buffer.left[i]!), Math.abs(buffer.right[i]!));
  }
  if (maximum === 0) return buffer;
  const gain = peak / maximum;
  for (let i = 0; i < buffer.left.length; i += 1) {
    buffer.left[i] = buffer.left[i]! * gain;
    buffer.right[i] = buffer.right[i]! * gain;
  }
  return buffer;
}

/** 16-bit PCM WAV. The one format everything downstream reads without argument. */
export function encodeWav(buffer: Stereo): Uint8Array {
  const frames = buffer.left.length;
  const blockAlign = 2 * 2;
  const dataBytes = frames * blockAlign;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) out[offset + i] = text.charCodeAt(i);
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // stereo
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    // Rounded, not truncated: truncation is a DC offset on quiet material.
    const l = Math.max(-1, Math.min(1, buffer.left[i]!));
    const r = Math.max(-1, Math.min(1, buffer.right[i]!));
    view.setInt16(offset, Math.round(l * 32767), true);
    view.setInt16(offset + 2, Math.round(r * 32767), true);
    offset += blockAlign;
  }

  return out;
}

/** Note frequencies, equal temperament, A4 = 440. */
export function note(semitonesFromA4: number): number {
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

/** Named degrees of the key the whole library sits in: E natural minor. */
export const E_MINOR = {
  E1: note(-33), G1: note(-30), A1: note(-28), B1: note(-26),
  E2: note(-21), FS2: note(-19), G2: note(-18), A2: note(-16), B2: note(-14),
  C3: note(-9), D3: note(-7), E3: note(-5), FS3: note(-3), G3: note(-2),
  A3: note(0), B3: note(2), C4: note(3), D4: note(5), E4: note(7),
  G4: note(10), A4: note(12), B4: note(14), E5: note(19),
} as const;
