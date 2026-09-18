import { z } from 'zod';

/**
 * The internal music and SFX library.
 *
 * Licensed once, owned outright, described in enough detail that the Sound
 * Director can choose by character rather than by filename. Keeping this
 * in-house rather than reaching for another API is a deliberate call: audio is
 * the half of a film people notice without being able to name, and a licensing
 * surprise on a customer's launch video is not a recoverable mistake.
 */
export const MusicCharacter = z.enum([
  'sub_tonal',      // sparse, low, almost ambient — Cinematic Black
  'percussive',     // rhythmic, mid-tempo, cuts land on the beat
  'acoustic_sparse',// unhurried, human, editorial
  'driving',        // loud and immediate, short-form
  'ambient_pad',    // texture only, no pulse
  'orchestral_min', // restrained strings, for gravity
]);
export type MusicCharacter = z.infer<typeof MusicCharacter>;

export const MusicTrack = z.object({
  id: z.string(),
  title: z.string(),
  character: MusicCharacter,
  bpm: z.number().int().min(50).max(200),
  /** Seconds. Tracks are longer than any film and get trimmed to the edit. */
  durationSeconds: z.number().min(30),
  /** Points where the track naturally opens up. The edit lands its beat here. */
  dropPoints: z.array(z.number()).default([]),
  /** A clean tail we can fade rather than cutting mid-phrase. */
  hasOutro: z.boolean().default(true),
  storageKey: z.string(),
  /** Integrated loudness of the source, so the mix starts from a known level. */
  lufs: z.number().default(-16),
  // (Music is long enough for BS.1770 to have an opinion; see SfxSample.)
  license: z.literal('owned').default('owned'),
});
export type MusicTrack = z.infer<typeof MusicTrack>;

export const SfxKind = z.enum([
  'impact_soft', 'impact_hard', 'sub_drop', 'riser_short', 'riser_long',
  'whoosh_short', 'whoosh_long', 'ui_click', 'ui_confirm', 'texture_air',
  'logo_sting_warm', 'logo_sting_clean',
]);
export type SfxKind = z.infer<typeof SfxKind>;

export const SfxSample = z.object({
  id: z.string(),
  kind: SfxKind,
  durationSeconds: z.number().min(0.05).max(8),
  storageKey: z.string(),
  /**
   * The level this sample sits at, as dBFS RMS rather than LUFS.
   *
   * BS.1770 integrates over gated 400ms blocks, so an 0.18s click has no
   * integrated loudness: measuring one reports the silence floor for a file
   * that peaks near 0. RMS is defined at any length and close enough to
   * loudness for broadband material, which is all of these.
   */
  lufs: z.number().default(-18),
  /** Seconds before the nominal hit point. Impacts need pre-roll to land on the cut. */
  preRoll: z.number().min(0).max(1).default(0),
});
export type SfxSample = z.infer<typeof SfxSample>;

/**
 * Library manifest.
 *
 * Content is provisioned into object storage under these keys; the manifest is
 * the contract between the Sound Director and whatever is actually on disk.
 * Keeping it declarative means a missing asset is a startup validation failure
 * rather than a silent hole in a finished film.
 */
export type SoundLibrary = {
  music: MusicTrack[];
  sfx: SfxSample[];
};

export const DEFAULT_LIBRARY: SoundLibrary = {
  music: [
    {
      id: 'mus_deep_still', title: 'Deep Still', character: 'sub_tonal', bpm: 72,
      durationSeconds: 180, dropPoints: [8, 24, 48], hasOutro: true,
      storageKey: 'library/music/deep-still.wav', lufs: -18, license: 'owned',
    },
    {
      id: 'mus_low_orbit', title: 'Low Orbit', character: 'sub_tonal', bpm: 66,
      durationSeconds: 210, dropPoints: [12, 36], hasOutro: true,
      storageKey: 'library/music/low-orbit.wav', lufs: -18, license: 'owned',
    },
    {
      id: 'mus_machine_room', title: 'Machine Room', character: 'percussive', bpm: 124,
      durationSeconds: 150, dropPoints: [4, 16, 32, 48], hasOutro: true,
      storageKey: 'library/music/machine-room.wav', lufs: -15, license: 'owned',
    },
    {
      id: 'mus_column', title: 'Column', character: 'acoustic_sparse', bpm: 88,
      durationSeconds: 165, dropPoints: [10, 30], hasOutro: true,
      storageKey: 'library/music/column.wav', lufs: -17, license: 'owned',
    },
    {
      id: 'mus_forward', title: 'Forward', character: 'driving', bpm: 140,
      durationSeconds: 120, dropPoints: [2, 8, 16], hasOutro: false,
      storageKey: 'library/music/forward.wav', lufs: -14, license: 'owned',
    },
    {
      id: 'mus_glass_air', title: 'Glass Air', character: 'ambient_pad', bpm: 60,
      durationSeconds: 240, dropPoints: [], hasOutro: true,
      storageKey: 'library/music/glass-air.wav', lufs: -20, license: 'owned',
    },
    {
      id: 'mus_ascent', title: 'Ascent', character: 'orchestral_min', bpm: 76,
      durationSeconds: 195, dropPoints: [16, 40], hasOutro: true,
      storageKey: 'library/music/ascent.wav', lufs: -17, license: 'owned',
    },
  ],
  sfx: [
    { id: 'sfx_impact_soft', kind: 'impact_soft', durationSeconds: 1.2, storageKey: 'library/sfx/impact-soft.wav', lufs: -18, preRoll: 0.04 },
    { id: 'sfx_impact_hard', kind: 'impact_hard', durationSeconds: 1.6, storageKey: 'library/sfx/impact-hard.wav', lufs: -14, preRoll: 0.06 },
    { id: 'sfx_sub_drop', kind: 'sub_drop', durationSeconds: 2.4, storageKey: 'library/sfx/sub-drop.wav', lufs: -12, preRoll: 0.08 },
    { id: 'sfx_riser_short', kind: 'riser_short', durationSeconds: 1.5, storageKey: 'library/sfx/riser-short.wav', lufs: -18, preRoll: 0 },
    { id: 'sfx_riser_long', kind: 'riser_long', durationSeconds: 3.5, storageKey: 'library/sfx/riser-long.wav', lufs: -18, preRoll: 0 },
    { id: 'sfx_whoosh_short', kind: 'whoosh_short', durationSeconds: 0.6, storageKey: 'library/sfx/whoosh-short.wav', lufs: -20, preRoll: 0.12 },
    { id: 'sfx_whoosh_long', kind: 'whoosh_long', durationSeconds: 1.4, storageKey: 'library/sfx/whoosh-long.wav', lufs: -20, preRoll: 0.2 },
    { id: 'sfx_ui_click', kind: 'ui_click', durationSeconds: 0.18, storageKey: 'library/sfx/ui-click.wav', lufs: -22, preRoll: 0 },
    { id: 'sfx_ui_confirm', kind: 'ui_confirm', durationSeconds: 0.4, storageKey: 'library/sfx/ui-confirm.wav', lufs: -20, preRoll: 0 },
    { id: 'sfx_texture_air', kind: 'texture_air', durationSeconds: 4, storageKey: 'library/sfx/texture-air.wav', lufs: -24, preRoll: 0 },
    { id: 'sfx_logo_warm', kind: 'logo_sting_warm', durationSeconds: 2.2, storageKey: 'library/sfx/logo-warm.wav', lufs: -14, preRoll: 0.05 },
    { id: 'sfx_logo_clean', kind: 'logo_sting_clean', durationSeconds: 1.8, storageKey: 'library/sfx/logo-clean.wav', lufs: -14, preRoll: 0.05 },
  ],
};

export function findMusic(library: SoundLibrary, character: MusicCharacter): MusicTrack[] {
  return library.music.filter((track) => track.character === character);
}

export function findSfx(library: SoundLibrary, kind: SfxKind): SfxSample | undefined {
  return library.sfx.find((sample) => sample.kind === kind);
}

/** Startup validation: a missing asset must fail loudly, not silently. */
export function validateLibrary(
  library: SoundLibrary,
  exists: (storageKey: string) => boolean,
): { ok: boolean; missing: string[] } {
  const missing = [...library.music, ...library.sfx]
    .map((item) => item.storageKey)
    .filter((key) => !exists(key));
  return { ok: missing.length === 0, missing };
}
