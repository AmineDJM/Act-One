import {
  E_MINOR,
  SAMPLE_RATE,
  type Stereo,
  adsr,
  decay,
  fadeWindow,
  highpass,
  lowpass,
  noise,
  normalizePeak,
  pluck,
  reverb,
  rng,
  saturate,
  saw,
  silence,
  sine,
  square,
  stateVariable,
  triangle,
} from './synthesis.ts';
import type { MusicTrack, SfxKind, SfxSample } from './library.ts';

/**
 * The library, as scores rather than files.
 *
 * Seven pieces and twelve effects, written to the characters the Sound Director
 * asks for. They share one key — E natural minor — and one reverb character, so
 * that two films made by two customers on two different systems still sound
 * like they came out of the same building. That is what a house sound is, and
 * it is the part of this that a stock-music subscription could not give us.
 *
 * Each piece is written against its manifest entry: same tempo, same length,
 * and real changes at the declared drop points, because the Sound Director
 * lands the edit on those and a drop point with nothing behind it is a lie the
 * picture will expose.
 */

type Render = (track: MusicTrack) => Stereo;

/** Seconds per beat. */
function beat(bpm: number): number {
  return 60 / bpm;
}

/** True once `seconds` have elapsed — used to bring layers in at drop points. */
function after(sampleIndex: number, seconds: number): boolean {
  return sampleIndex >= seconds * SAMPLE_RATE;
}

/**
 * A slow ramp in over `seconds`, starting at `atSeconds`.
 *
 * Layers arrive rather than appear. An instrument that switches on at full
 * level is the single most synthetic-sounding thing an arrangement can do.
 */
function arrive(sampleIndex: number, atSeconds: number, seconds = 4): number {
  const t = (sampleIndex / SAMPLE_RATE - atSeconds) / seconds;
  return Math.max(0, Math.min(1, t));
}

/** The final fade, for tracks the manifest says have a clean tail. */
function outro(sampleIndex: number, total: number, seconds: number): number {
  const start = total - seconds * SAMPLE_RATE;
  if (sampleIndex < start) return 1;
  return Math.max(0, 1 - (sampleIndex - start) / (seconds * SAMPLE_RATE));
}

/**
 * Deep Still — sub_tonal, 72bpm.
 *
 * A held low E with almost nothing on top of it. The drops are not events; they
 * are the room getting slightly larger. Written for the scenes where a founder
 * is making a claim and the music's whole job is to not be noticed.
 */
const deepStill: Render = (track) => {
  const out = silence(track.durationSeconds);
  const total = out.left.length;
  const random = rng(0x5eed01);
  const space = reverb({ decaySeconds: 6, mix: 0.34, preDelayMs: 40 });
  const spaceR = reverb({ decaySeconds: 6.4, mix: 0.34, preDelayMs: 47 });
  const air = lowpass(900);
  const airHp = highpass(180);
  const subEnv = adsr({ attack: 6, decay: 2, sustain: 0.92, release: 8, durationSeconds: track.durationSeconds });

  let subPhase = 0;
  let padA = 0;
  let padB = 0;
  let padC = 0;

  for (let i = 0; i < total; i += 1) {
    const t = i / SAMPLE_RATE;

    // The sub. Slightly detuned against itself so it breathes rather than sits.
    subPhase += (E_MINOR.E1 + Math.sin(t * 0.05) * 0.12) / SAMPLE_RATE;
    const sub = sine(subPhase) * 0.55 * subEnv(i);

    padA += E_MINOR.E2 / SAMPLE_RATE;
    padB += (E_MINOR.B2 * (1 + Math.sin(t * 0.031) * 0.0012)) / SAMPLE_RATE;
    padC += (E_MINOR.G3 * (1 - Math.sin(t * 0.027) * 0.001)) / SAMPLE_RATE;

    const pad =
      (triangle(padA) * 0.3 + triangle(padB) * 0.22 * arrive(i, 8, 10) +
        triangle(padC) * 0.16 * arrive(i, 24, 14)) *
      0.5;

    // A breath of filtered noise, at the level where you feel it and do not
    // hear it. This is what stops a synthesised pad sounding like a test tone.
    const breath = airHp(air(noise(random))) * 0.05 * arrive(i, 48, 20);

    const dry = saturate(sub + pad + breath, 1.1);
    const gain = outro(i, total, 10);
    out.left[i] = space(dry * 0.96) * gain;
    out.right[i] = spaceR(dry) * gain;
  }

  return normalizePeak(out, 0.82);
};

/**
 * Low Orbit — sub_tonal, 66bpm.
 *
 * The same weight as Deep Still with a slow pulse under it, for films that
 * need to feel like they are moving without anything actually happening yet.
 */
const lowOrbit: Render = (track) => {
  const out = silence(track.durationSeconds);
  const total = out.left.length;
  const random = rng(0x5eed02);
  const space = reverb({ decaySeconds: 7.5, mix: 0.38, preDelayMs: 55 });
  const spaceR = reverb({ decaySeconds: 7.9, mix: 0.38, preDelayMs: 61 });
  const shimmerFilter = lowpass(2600);
  const shimmerHp = highpass(900);
  const period = beat(track.bpm) * 4;

  let subPhase = 0;
  let padA = 0;
  let padB = 0;
  let shimmerPhase = 0;

  for (let i = 0; i < total; i += 1) {
    const t = i / SAMPLE_RATE;
    const pulse = 0.55 + 0.45 * Math.pow(Math.max(0, Math.sin((t / period) * Math.PI * 2)), 2);

    subPhase += E_MINOR.E1 / SAMPLE_RATE;
    const sub = sine(subPhase) * 0.5 * pulse;

    padA += E_MINOR.B2 / SAMPLE_RATE;
    padB += (E_MINOR.FS3 * 1.0008) / SAMPLE_RATE;
    const pad = (triangle(padA) * 0.24 + triangle(padB) * 0.18 * arrive(i, 12, 12)) * 0.6;

    shimmerPhase += E_MINOR.B4 / SAMPLE_RATE;
    const shimmer =
      (sine(shimmerPhase) * 0.05 + shimmerHp(shimmerFilter(noise(random))) * 0.035) *
      arrive(i, 36, 18);

    const dry = saturate(sub + pad + shimmer, 1.05);
    const gain = outro(i, total, 12);
    out.left[i] = space(dry) * gain;
    out.right[i] = spaceR(dry * 0.94) * gain;
  }

  return normalizePeak(out, 0.82);
};

/**
 * Machine Room — percussive, 124bpm.
 *
 * Rhythm built from filtered noise and a sub kick rather than from samples.
 * For product films that are about throughput: the pulse is the argument.
 */
const machineRoom: Render = (track) => {
  const out = silence(track.durationSeconds);
  const total = out.left.length;
  const random = rng(0x5eed03);
  const space = reverb({ decaySeconds: 1.6, mix: 0.16, preDelayMs: 14 });
  const spaceR = reverb({ decaySeconds: 1.7, mix: 0.16, preDelayMs: 17 });
  const hatFilter = highpass(6000);
  const bodyFilter = lowpass(220);
  const kickDecay = decay(0.34);
  const hatDecay = decay(0.045);
  const snapDecay = decay(0.12);

  const beatSeconds = beat(track.bpm);
  const eighth = beatSeconds / 2;
  const bar = beatSeconds * 4;

  // The ostinato: four notes that do not resolve, so the loop never lands.
  const figure = [E_MINOR.E3, E_MINOR.B3, E_MINOR.D4, E_MINOR.A3];
  const plucks = figure.map((frequency) => pluck(frequency, 0.7, rng(0x1111 + frequency), 0.32));

  let kickPhase = 0;
  for (let i = 0; i < total; i += 1) {
    const t = i / SAMPLE_RATE;
    const inBar = t % bar;
    const barIndex = Math.floor(t / bar);

    // Kick on 1 and 3, with a pitched-down sine body.
    const sinceKick = inBar % (beatSeconds * 2);
    const kickSample = Math.round(sinceKick * SAMPLE_RATE);
    kickPhase += (E_MINOR.E1 * (1 + kickDecay(kickSample) * 1.6)) / SAMPLE_RATE;
    const kick = bodyFilter(sine(kickPhase)) * kickDecay(kickSample) * 0.9;

    // Hats on eighths, opening up after the first drop.
    const sinceHat = t % eighth;
    const hat =
      hatFilter(noise(random)) * hatDecay(Math.round(sinceHat * SAMPLE_RATE)) * 0.3 * arrive(i, 4, 2);

    // A snap on the backbeat, from the second drop.
    const sinceSnap = (inBar + beatSeconds) % (beatSeconds * 2);
    const snap =
      hatFilter(noise(random)) *
      snapDecay(Math.round(sinceSnap * SAMPLE_RATE)) *
      0.34 *
      arrive(i, 16, 3);

    // The figure, one note per eighth, entering at the third drop.
    const eighthIndex = Math.floor(t / eighth);
    const voice = plucks[eighthIndex % plucks.length]!;
    const intoNote = Math.round((t % eighth) * SAMPLE_RATE);
    const ostinato = (voice[intoNote] ?? 0) * 0.5 * arrive(i, 32, 6);

    const bass = sine((t * E_MINOR.E2) % 1) * 0.16 * arrive(i, 48, 8) * (barIndex % 2 === 0 ? 1 : 0.7);

    const dry = saturate(kick + hat + snap + ostinato + bass, 1.5);
    const gain = outro(i, total, 6);
    out.left[i] = (dry * 0.9 + space(dry) * 0.4) * gain;
    out.right[i] = (dry * 0.9 + spaceR(dry) * 0.4) * gain;
  }

  return normalizePeak(out, 0.9);
};

/**
 * Column — acoustic_sparse, 88bpm.
 *
 * Very few notes, long decays, a lot of room. Written for films that want the
 * viewer to hear the words: silence is the instrument and the plucks are
 * punctuation.
 */
const column: Render = (track) => {
  const out = silence(track.durationSeconds);
  const total = out.left.length;
  const space = reverb({ decaySeconds: 3.4, mix: 0.42, preDelayMs: 34 });
  const spaceR = reverb({ decaySeconds: 3.6, mix: 0.42, preDelayMs: 41 });
  const beatSeconds = beat(track.bpm);

  // A phrase that takes eight bars to say four notes.
  const phrase = [
    { at: 0, frequency: E_MINOR.E3 },
    { at: beatSeconds * 6, frequency: E_MINOR.B3 },
    { at: beatSeconds * 11, frequency: E_MINOR.G3 },
    { at: beatSeconds * 16, frequency: E_MINOR.D4 },
    { at: beatSeconds * 24, frequency: E_MINOR.A3 },
  ];
  const phraseSeconds = beatSeconds * 32;
  const voices = phrase.map((event) => pluck(event.frequency, 4.2, rng(0x2222 + event.frequency), 0.62));

  let padPhase = 0;
  for (let i = 0; i < total; i += 1) {
    const t = i / SAMPLE_RATE;
    const intoPhrase = t % phraseSeconds;

    let plucked = 0;
    for (let v = 0; v < phrase.length; v += 1) {
      const since = intoPhrase - phrase[v]!.at;
      if (since < 0) continue;
      const sample = Math.round(since * SAMPLE_RATE);
      plucked += (voices[v]![sample] ?? 0) * (v === 0 ? 0.55 : 0.4);
    }

    padPhase += E_MINOR.E2 / SAMPLE_RATE;
    const pad = triangle(padPhase) * 0.14 * arrive(i, 10, 12);
    const upper = sine((t * E_MINOR.B3) % 1) * 0.05 * arrive(i, 30, 16);

    const dry = saturate(plucked + pad + upper, 1.1);
    const gain = outro(i, total, 8);
    out.left[i] = space(dry) * gain;
    out.right[i] = spaceR(dry * 0.92) * gain;
  }

  return normalizePeak(out, 0.86);
};

/**
 * Forward — driving, 140bpm.
 *
 * The one track with no patience. Eighth-note bass, a bright arpeggio and no
 * outro, because the manifest says it ends on the cut rather than fading.
 */
const forward: Render = (track) => {
  const out = silence(track.durationSeconds);
  const total = out.left.length;
  const random = rng(0x5eed05);
  const space = reverb({ decaySeconds: 1.1, mix: 0.14, preDelayMs: 10 });
  const spaceR = reverb({ decaySeconds: 1.2, mix: 0.14, preDelayMs: 13 });
  const hatFilter = highpass(7000);
  const hatDecay = decay(0.035);
  const bassDecay = decay(0.11);
  const svf = stateVariable(2.4);

  const beatSeconds = beat(track.bpm);
  const eighth = beatSeconds / 2;
  const sixteenth = beatSeconds / 4;
  const arpeggio = [E_MINOR.E4, E_MINOR.B4, E_MINOR.G4, E_MINOR.D4, E_MINOR.E4, E_MINOR.A4];

  let bassPhase = 0;
  for (let i = 0; i < total; i += 1) {
    const t = i / SAMPLE_RATE;

    bassPhase += E_MINOR.E2 / SAMPLE_RATE;
    const intoEighth = Math.round((t % eighth) * SAMPLE_RATE);
    const bass = saw(bassPhase, E_MINOR.E2, 12) * bassDecay(intoEighth) * 0.6;

    const hat =
      hatFilter(noise(random)) * hatDecay(Math.round((t % sixteenth) * SAMPLE_RATE)) * 0.22 *
      arrive(i, 2, 1.5);

    // The arpeggio runs through a resonant filter that opens across the track,
    // which is how this genre signals that something is building.
    const noteIndex = Math.floor(t / sixteenth) % arpeggio.length;
    const frequency = arpeggio[noteIndex]!;
    const arpPhase = (t * frequency) % 1;
    const cutoff = 700 + 4200 * Math.min(1, arrive(i, 8, 40));
    const arp =
      svf.lp(square(arpPhase, frequency, 10), cutoff) *
      decay(0.09)(Math.round((t % sixteenth) * SAMPLE_RATE)) *
      0.34 *
      arrive(i, 8, 4);

    const sub = sine((t * E_MINOR.E1) % 1) * 0.3 * arrive(i, 16, 4);

    const dry = saturate(bass + hat + arp + sub, 1.8);
    // No outro: the manifest says this one ends on the cut.
    out.left[i] = dry * 0.92 + space(dry) * 0.3;
    out.right[i] = dry * 0.92 + spaceR(dry) * 0.3;
  }

  return normalizePeak(out, 0.92);
};

/**
 * Glass Air — ambient_pad, 60bpm.
 *
 * No rhythm at all. Four chords over four minutes, moving so slowly that the
 * change is felt rather than heard. The default bed for films whose pictures
 * are doing the work.
 */
const glassAir: Render = (track) => {
  const out = silence(track.durationSeconds);
  const total = out.left.length;
  const random = rng(0x5eed06);
  const space = reverb({ decaySeconds: 9, mix: 0.46, preDelayMs: 70 });
  const spaceR = reverb({ decaySeconds: 9.6, mix: 0.46, preDelayMs: 80 });
  const airFilter = lowpass(3400);
  const airHp = highpass(400);

  // Four voicings, each held for a quarter of the track.
  const chords = [
    [E_MINOR.E2, E_MINOR.B2, E_MINOR.G3, E_MINOR.B3],
    [E_MINOR.C3, E_MINOR.G3, E_MINOR.E4, E_MINOR.B3],
    [E_MINOR.A2, E_MINOR.E3, E_MINOR.C4, E_MINOR.G3],
    [E_MINOR.B2, E_MINOR.FS3, E_MINOR.D4, E_MINOR.A3],
  ];
  const chordSeconds = track.durationSeconds / chords.length;
  const phases = chords.map((chord) => chord.map(() => 0));

  for (let i = 0; i < total; i += 1) {
    const t = i / SAMPLE_RATE;

    let voiced = 0;
    for (let c = 0; c < chords.length; c += 1) {
      // Chords crossfade rather than switch, with a long overlap.
      const centre = chordSeconds * (c + 0.5);
      const distance = Math.abs(t - centre) / chordSeconds;
      const weight = Math.max(0, 1 - distance);
      for (let n = 0; n < chords[c]!.length; n += 1) {
        const frequency = chords[c]![n]! * (1 + Math.sin(t * (0.02 + n * 0.007)) * 0.0015);
        // The phase advances whether or not this voice is audible, so a chord
        // fading back in is continuous rather than restarting mid-cycle.
        phases[c]![n] = phases[c]![n]! + frequency / SAMPLE_RATE;
        if (weight <= 0) continue;
        voiced += triangle(phases[c]![n]!) * weight * (n === 0 ? 0.3 : 0.17);
      }
    }

    const air = airHp(airFilter(noise(random))) * 0.04;
    const dry = saturate(voiced * 0.5 + air, 1.0);
    const gain = outro(i, total, 16) * fadeWindow(i, total, 6 * SAMPLE_RATE);
    out.left[i] = space(dry) * gain;
    out.right[i] = spaceR(dry * 0.93) * gain;
  }

  return normalizePeak(out, 0.8);
};

/**
 * Ascent — orchestral_min, 76bpm.
 *
 * Stacked saws with a long attack, which is how you get the swell of a string
 * section out of a synthesiser without pretending to be one. The drops are
 * where the upper octave arrives.
 */
const ascent: Render = (track) => {
  const out = silence(track.durationSeconds);
  const total = out.left.length;
  const space = reverb({ decaySeconds: 4.6, mix: 0.4, preDelayMs: 45 });
  const spaceR = reverb({ decaySeconds: 4.9, mix: 0.4, preDelayMs: 52 });
  const tone = lowpass(5200);
  const toneR = lowpass(5000);

  // A section is built from slightly detuned copies of the same note.
  const section = [
    { frequency: E_MINOR.E2, detune: 0.0, gain: 0.34, from: 0 },
    { frequency: E_MINOR.B2, detune: 0.0011, gain: 0.26, from: 0 },
    { frequency: E_MINOR.G3, detune: -0.0009, gain: 0.22, from: 16 },
    { frequency: E_MINOR.E3, detune: 0.0016, gain: 0.2, from: 16 },
    { frequency: E_MINOR.B3, detune: -0.0013, gain: 0.16, from: 40 },
    { frequency: E_MINOR.E4, detune: 0.0008, gain: 0.13, from: 40 },
  ];
  const phases = section.map(() => 0);
  const swell = adsr({
    attack: 14,
    decay: 6,
    sustain: 0.86,
    release: 18,
    durationSeconds: track.durationSeconds,
  });

  for (let i = 0; i < total; i += 1) {
    const t = i / SAMPLE_RATE;
    let voiced = 0;
    for (let v = 0; v < section.length; v += 1) {
      const layer = section[v]!;
      const frequency = layer.frequency * (1 + layer.detune + Math.sin(t * 0.04 + v) * 0.0006);
      phases[v] = phases[v]! + frequency / SAMPLE_RATE;
      voiced += saw(phases[v]!, frequency, 18) * layer.gain * arrive(i, layer.from, 12);
    }

    const body = voiced * 0.32 * swell(i);
    const gain = outro(i, total, 14);
    out.left[i] = space(tone(body)) * gain;
    out.right[i] = spaceR(toneR(body * 0.95)) * gain;
  }

  return normalizePeak(out, 0.85);
};

export const MUSIC_SCORES: Record<string, Render> = {
  mus_deep_still: deepStill,
  mus_low_orbit: lowOrbit,
  mus_machine_room: machineRoom,
  mus_column: column,
  mus_forward: forward,
  mus_glass_air: glassAir,
  mus_ascent: ascent,
};

/**
 * The effects.
 *
 * Every one of these is synthesis rather than a recording, and every one is the
 * textbook construction: an impact is a pitched sine falling under a filtered
 * noise burst, a whoosh is noise through a moving band-pass, a riser is the
 * same with the band going up and never coming back.
 */
export function renderSfx(sample: SfxSample): Stereo {
  const out = silence(sample.durationSeconds);
  const total = out.left.length;
  const random = rng(0x5f0000 + sample.kind.length * 7919);
  const build = SFX_BUILDERS[sample.kind];
  build(out, total, random, sample.durationSeconds);
  return normalizePeak(out, sample.kind === 'texture_air' ? 0.5 : 0.92);
}

type SfxBuilder = (
  out: Stereo,
  total: number,
  random: () => number,
  seconds: number,
) => void;

const impact =
  (weight: number): SfxBuilder =>
  (out, total, random, seconds) => {
    const body = decay(seconds * 0.55);
    const click = decay(0.02);
    const tail = lowpass(weight > 0.7 ? 110 : 180);
    const tailR = lowpass(weight > 0.7 ? 108 : 176);
    const noiseFilter = lowpass(2400);
    const space = reverb({ decaySeconds: seconds, mix: 0.3, preDelayMs: 8 });
    let phase = 0;

    for (let i = 0; i < total; i += 1) {
      const env = body(i);
      // The pitch falls through the hit, which is what makes it read as impact
      // rather than as a note.
      phase += (E_MINOR.E1 * (1 + env * 2.4 * weight)) / SAMPLE_RATE;
      const low = tail(sine(phase)) * env * weight;
      const lowR = tailR(sine(phase)) * env * weight;
      const transient = noiseFilter(noise(random)) * click(i) * 0.7;
      const dry = saturate(low + transient, 1.6);
      out.left[i] = space(dry);
      out.right[i] = saturate(lowR + transient, 1.6);
    }
  };

const SFX_BUILDERS: Record<SfxKind, SfxBuilder> = {
  impact_soft: impact(0.6),
  impact_hard: impact(0.95),

  sub_drop: (out, total, _random, seconds) => {
    const env = adsr({ attack: 0.01, decay: 0.3, sustain: 0.7, release: seconds * 0.6, durationSeconds: seconds });
    const shape = lowpass(90);
    let phase = 0;
    for (let i = 0; i < total; i += 1) {
      const t = i / SAMPLE_RATE / seconds;
      // A full octave down over the length of the sample.
      phase += (E_MINOR.E2 * Math.pow(2, -t)) / SAMPLE_RATE;
      out.left[i] = shape(sine(phase)) * env(i);
      out.right[i] = out.left[i]!;
    }
  },

  riser_short: riser(0.35),
  riser_long: riser(0.55),

  whoosh_short: whoosh(0.5),
  whoosh_long: whoosh(0.8),

  ui_click: (out, total, random, seconds) => {
    const env = decay(seconds * 0.35);
    const tone = stateVariable(3.5);
    for (let i = 0; i < total; i += 1) {
      const excitation = noise(random) * env(i);
      const value = tone.bp(excitation, 2600) * 0.9 + sine((i / SAMPLE_RATE) * 1800) * env(i) * 0.2;
      out.left[i] = value;
      out.right[i] = value;
    }
  },

  ui_confirm: (out, total, _random, seconds) => {
    // Two notes a fifth apart, the second landing just after the first.
    const first = decay(seconds * 0.5);
    const second = decay(seconds * 0.45);
    const offset = Math.round(seconds * 0.22 * SAMPLE_RATE);
    for (let i = 0; i < total; i += 1) {
      const t = i / SAMPLE_RATE;
      let value = sine(t * E_MINOR.B4) * first(i) * 0.55;
      if (i > offset) value += sine((t - offset / SAMPLE_RATE) * E_MINOR.E5) * second(i - offset) * 0.45;
      out.left[i] = saturate(value, 1.2);
      out.right[i] = out.left[i]!;
    }
  },

  texture_air: (out, total, random, seconds) => {
    const filterL = lowpass(1400);
    const filterR = lowpass(1500);
    const hp = highpass(300);
    const hpR = highpass(320);
    const fade = Math.round(seconds * 0.25 * SAMPLE_RATE);
    for (let i = 0; i < total; i += 1) {
      const window = fadeWindow(i, total, fade);
      out.left[i] = hp(filterL(noise(random))) * 0.55 * window;
      out.right[i] = hpR(filterR(noise(random))) * 0.55 * window;
    }
  },

  logo_sting_warm: logoSting(true),
  logo_sting_clean: logoSting(false),
};

function riser(sharpness: number): SfxBuilder {
  return (out, total, random, seconds) => {
    const svf = stateVariable(4.5);
    const svfR = stateVariable(4.3);
    const space = reverb({ decaySeconds: 1.4, mix: 0.25, preDelayMs: 12 });
    for (let i = 0; i < total; i += 1) {
      const t = i / SAMPLE_RATE / seconds;
      // Exponential, because a linear sweep sounds like it is slowing down.
      const cutoff = 200 * Math.pow(90, Math.pow(t, 1 + sharpness));
      const envelope = Math.pow(t, 1.4);
      const source = noise(random);
      /*
       * Driven hard into saturation, which is how risers are actually made and
       * not only a level trick: a resonant band-pass on noise has an enormous
       * crest factor, so an unsaturated riser hits the true-peak ceiling while
       * still sounding thin, and levelling it then leaves it 8dB under every
       * other effect in the library.
       */
      out.left[i] = saturate(space(svf.bp(source, cutoff)) * envelope * 2.6, 2.2) * 0.8;
      out.right[i] = saturate(svfR.bp(source, cutoff * 1.02) * envelope * 2.6, 2.2) * 0.8;
    }
  };
}

function whoosh(width: number): SfxBuilder {
  return (out, total, random, seconds) => {
    const svf = stateVariable(2.2);
    const svfR = stateVariable(2.1);
    for (let i = 0; i < total; i += 1) {
      const t = i / SAMPLE_RATE / seconds;
      // Up and back down: a whoosh passes, a riser arrives.
      const curve = Math.sin(Math.PI * t);
      const cutoff = 300 + 6000 * curve * width;
      const envelope = Math.pow(curve, 0.7);
      const source = noise(random);
      // Panned across the move, which is most of what sells it.
      out.left[i] = svf.bp(source, cutoff) * envelope * (1 - t * 0.6);
      out.right[i] = svfR.bp(source, cutoff * 1.03) * envelope * (0.4 + t * 0.6);
    }
  };
}

function logoSting(warm: boolean): SfxBuilder {
  return (out, total, random, seconds) => {
    const space = reverb({ decaySeconds: seconds * 1.6, mix: warm ? 0.4 : 0.26, preDelayMs: 22 });
    const spaceR = reverb({ decaySeconds: seconds * 1.7, mix: warm ? 0.4 : 0.26, preDelayMs: 27 });
    const tone = lowpass(warm ? 2600 : 6200);
    const chord = warm
      ? [E_MINOR.E2, E_MINOR.B2, E_MINOR.G3]
      : [E_MINOR.E3, E_MINOR.B3, E_MINOR.E4];
    const phases = chord.map(() => 0);
    const env = adsr({
      attack: warm ? 0.05 : 0.012,
      decay: seconds * 0.3,
      sustain: 0.5,
      release: seconds * 0.6,
      durationSeconds: seconds,
    });
    const transient = decay(0.03);

    for (let i = 0; i < total; i += 1) {
      let voiced = 0;
      for (let v = 0; v < chord.length; v += 1) {
        phases[v] = phases[v]! + chord[v]! / SAMPLE_RATE;
        voiced += (warm ? triangle(phases[v]!) : saw(phases[v]!, chord[v]!, 14)) * (v === 0 ? 0.4 : 0.26);
      }
      const dry = saturate(tone(voiced) * env(i) + noise(random) * transient(i) * 0.25, 1.3);
      out.left[i] = space(dry);
      out.right[i] = spaceR(dry * 0.95);
    }
  };
}

export function renderMusic(track: MusicTrack): Stereo {
  const score = MUSIC_SCORES[track.id];
  if (!score) throw new Error(`No score for ${track.id}. The manifest and the scores disagree.`);
  return score(track);
}
