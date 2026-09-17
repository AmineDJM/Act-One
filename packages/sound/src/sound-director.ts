import {
  LUFS_BROADCAST,
  LUFS_STREAMING_PLATFORM,
  LUFS_WEB,
  newId,
  storyboardDuration,
  type Scene,
  type SoundCue,
  type SoundCueType,
  type Storyboard,
} from '@act-one/core';
import { DEFAULT_LIBRARY, findMusic, findSfx, type MusicCharacter, type MusicTrack, type SfxKind, type SoundLibrary } from './library.ts';

/**
 * The Sound Director.
 *
 * Sound is not a layer added at the end; it is half of why a film feels
 * expensive. The things that separate a designed mix from a music bed:
 *
 *  - The music starts where the film earns it, not at frame zero.
 *  - Impacts land ON the cut, which means they start slightly BEFORE it — a
 *    transient played at the cut point reads as late, because the attack has
 *    already begun by the time the picture changes.
 *  - There is deliberate silence somewhere. A film with wall-to-wall music has
 *    no dynamics, and neither does one with wall-to-wall voice.
 *  - UI sounds are sparse. One click sells the interaction; four makes it a
 *    tutorial.
 */
export type SoundDesign = {
  id: string;
  storyboardId: string;
  music: {
    trackId: string;
    storageKey: string;
    /** Where in the track we start, so a drop lands on the film's own turn. */
    startOffsetSeconds: number;
    /** When the music enters in film time. */
    enterAtSeconds: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
    baseGainDb: number;
  } | null;
  cues: PlacedCue[];
  /** Seconds of deliberate silence in the film. Reported for QA. */
  silenceSeconds: number;
  /** Target integrated loudness for the master. */
  targetLufs: number;
  notes: string[];
};

export type PlacedCue = {
  id: string;
  /** Film time at which the sample must START, pre-roll already applied. */
  atSeconds: number;
  type: SoundCueType;
  sfxKind: SfxKind | null;
  storageKey: string | null;
  gainDb: number;
  durationSeconds: number | null;
};

export type SoundDirectionInput = {
  storyboard: Storyboard;
  /** From the creative system. */
  behaviour: {
    musicCharacter: string;
    openOnMusic: boolean;
    uiSoundDensity: 'none' | 'sparse' | 'rhythmic';
    impactsOnCuts: boolean;
    endWithSting: boolean;
  };
  /** Where the film will be watched — decides loudness and low-end. */
  channel?: 'web' | 'social' | 'broadcast';
  library?: SoundLibrary;
  hasVoiceOver?: boolean;
};

/**
 * Loudness targets, per channel.
 *
 * Getting this wrong is the single most common audio defect in automated video:
 * a film mastered at broadcast loudness is turned down by every social platform
 * and comes back sounding limp, while one mastered too quietly is inaudible on
 * a laptop speaker.
 *
 * Broadcast is EBU R 128's −23 LUFS and is not ours to choose. The other two
 * are the platform normalisation targets: social sits at the platforms' own
 * −14, and web a little under it, which leaves the dynamics intact instead of
 * having them limited on the way in. See AUDIO_STANDARDS.
 */
const LOUDNESS_TARGETS = {
  web: LUFS_WEB,
  social: LUFS_STREAMING_PLATFORM,
  broadcast: LUFS_BROADCAST,
} as const;

export function directSound(input: SoundDirectionInput): SoundDesign {
  const library = input.library ?? DEFAULT_LIBRARY;
  const storyboard = input.storyboard;
  const total = storyboardDuration(storyboard);
  const channel = input.channel ?? 'web';
  const notes: string[] = [];

  const character = mapCharacter(input.behaviour.musicCharacter);
  const candidates = findMusic(library, character);
  const track = pickTrack(candidates, total, storyboard);

  // Music enters where the film earns it. A system that opens on silence holds
  // it until the first real beat; one that opens on music starts at zero.
  const firstScene = storyboard.scenes[0];
  const enterAt = input.behaviour.openOnMusic
    ? 0
    : Math.min(firstScene ? firstScene.duration * 0.55 : 1.2, 2.2);

  const cues: PlacedCue[] = [];
  for (const scene of storyboard.scenes) {
    for (const cue of scene.soundCues) {
      const placed = placeCue(cue, library, input, scene);
      if (placed) cues.push(placed);
    }
  }

  const uiCues = cues.filter((c) => c.type === 'ui_click');
  const uiBudget = input.behaviour.uiSoundDensity === 'none' ? 0 : input.behaviour.uiSoundDensity === 'sparse' ? 3 : 8;
  if (uiCues.length > uiBudget) {
    // One click sells the interaction; four makes it a tutorial.
    const keep = new Set(uiCues.slice(0, uiBudget).map((c) => c.id));
    for (let i = cues.length - 1; i >= 0; i -= 1) {
      if (cues[i]!.type === 'ui_click' && !keep.has(cues[i]!.id)) cues.splice(i, 1);
    }
    notes.push(`Thinned UI sounds from ${uiCues.length} to ${uiBudget}.`);
  }

  const silence = computeSilence(cues, enterAt, total);
  if (silence < 0.6 && total > 20) {
    notes.push('No deliberate silence in this film — the mix has no dynamics to play against.');
  }

  return {
    id: newId('ast'),
    storyboardId: storyboard.id,
    music: track
      ? {
          trackId: track.id,
          storageKey: track.storageKey,
          startOffsetSeconds: chooseStartOffset(track, storyboard, enterAt),
          enterAtSeconds: Number(enterAt.toFixed(3)),
          fadeInSeconds: input.behaviour.openOnMusic ? 0.8 : 1.6,
          fadeOutSeconds: track.hasOutro ? 2.2 : 1.2,
          /*
           * One bed level, whether or not anybody is speaking.
           *
           * It used to drop to −18 dB for the whole film the moment there was
           * narration, which is the drawn fade AUDIO_STANDARDS.ducking exists
           * to rule out: it holds the music down through every pause and every
           * passage with no voice in it at all. The sidechain in the mix is
           * what creates room for the voice, and it releases in the gaps.
           */
          baseGainDb: -13,
        }
      : null,
    cues: cues.sort((a, b) => a.atSeconds - b.atSeconds),
    silenceSeconds: Number(silence.toFixed(2)),
    targetLufs: LOUDNESS_TARGETS[channel],
    notes,
  };
}

function placeCue(
  cue: SoundCue,
  library: SoundLibrary,
  input: SoundDirectionInput,
  scene: Scene,
): PlacedCue | null {
  const kind = sfxKindFor(cue.type, input.behaviour, scene);
  if (kind === null) {
    // Structural cues (music in/out/duck, silence) carry no sample; they drive
    // the mix graph instead.
    return {
      id: newId('ast'),
      atSeconds: Number(cue.time.toFixed(3)),
      type: cue.type,
      sfxKind: null,
      storageKey: null,
      gainDb: gainFor(cue.type, cue.intensity),
      durationSeconds: cue.durationSeconds,
    };
  }

  const sample = findSfx(library, kind);
  if (!sample) return null;

  // Pre-roll: a transient played exactly at the cut reads as late, because its
  // attack has already started by the time the picture changes.
  const at = Math.max(0, cue.time - sample.preRoll);

  return {
    id: newId('ast'),
    atSeconds: Number(at.toFixed(3)),
    type: cue.type,
    sfxKind: kind,
    storageKey: sample.storageKey,
    gainDb: gainFor(cue.type, cue.intensity),
    durationSeconds: sample.durationSeconds,
  };
}

function sfxKindFor(
  type: SoundCueType,
  behaviour: SoundDirectionInput['behaviour'],
  scene: Scene,
): SfxKind | null {
  switch (type) {
    case 'impact':
      // Hard impacts belong on hard cuts; a held editorial frame wants the soft one.
      return scene.duration < 2 ? 'impact_hard' : 'impact_soft';
    case 'riser':
      return scene.duration > 2.5 ? 'riser_long' : 'riser_short';
    case 'sub_drop':
      return 'sub_drop';
    case 'whoosh':
      return scene.duration > 2 ? 'whoosh_long' : 'whoosh_short';
    case 'ui_click':
      return behaviour.uiSoundDensity === 'none' ? null : 'ui_click';
    case 'texture':
      return 'texture_air';
    case 'logo_sting':
      return behaviour.endWithSting ? 'logo_sting_clean' : null;
    default:
      return null;
  }
}

function gainFor(type: SoundCueType, intensity: number): number {
  // Intensity 0..1 mapped to a sensible dB window per cue family. Linear gain
  // on a log scale is how automated mixes end up with inaudible textures and
  // deafening impacts.
  const windows: Partial<Record<SoundCueType, [number, number]>> = {
    impact: [-18, -6],
    sub_drop: [-16, -5],
    riser: [-22, -10],
    whoosh: [-26, -14],
    ui_click: [-30, -20],
    texture: [-34, -24],
    logo_sting: [-14, -5],
  };
  const [min, max] = windows[type] ?? [-24, -12];
  return Number((min + (max - min) * Math.min(1, Math.max(0, intensity))).toFixed(1));
}

function mapCharacter(description: string): MusicCharacter {
  const text = description.toLowerCase();
  if (/percussive|rhythm|beat|tempo/.test(text)) return 'percussive';
  if (/acoustic|unhurried|sparse.*acoustic/.test(text)) return 'acoustic_sparse';
  if (/driving|loud|immediate|energy/.test(text)) return 'driving';
  if (/ambient|pad|tone|almost ambient/.test(text)) return 'ambient_pad';
  if (/orchestral|strings/.test(text)) return 'orchestral_min';
  return 'sub_tonal';
}

function pickTrack(candidates: MusicTrack[], filmSeconds: number, storyboard: Storyboard): MusicTrack | null {
  const usable = candidates.filter((track) => track.durationSeconds >= filmSeconds + 4);
  if (usable.length === 0) return candidates[0] ?? null;

  // Prefer a track whose tempo suits the cut rate. A 140bpm track under a film
  // averaging four-second scenes fights the edit.
  const cuts = storyboard.scenes.length;
  const cutsPerMinute = filmSeconds > 0 ? (cuts / filmSeconds) * 60 : 12;
  const idealBpm = Math.min(150, Math.max(60, cutsPerMinute * 6));

  return [...usable].sort((a, b) => Math.abs(a.bpm - idealBpm) - Math.abs(b.bpm - idealBpm))[0]!;
}

/**
 * Chooses where in the track to start so a natural drop lands on the film's
 * own turn — usually the first product scene.
 */
function chooseStartOffset(track: MusicTrack, storyboard: Storyboard, enterAt: number): number {
  if (track.dropPoints.length === 0) return 0;

  const turn = storyboard.scenes.find(
    (scene) => scene.visualType === 'product_ui' || scene.visualType === 'screenshot_motion',
  );
  if (!turn) return 0;

  const wantedAt = turn.startTime - enterAt;
  if (wantedAt <= 0) return 0;

  const drop = [...track.dropPoints].sort(
    (a, b) => Math.abs(a - wantedAt) - Math.abs(b - wantedAt),
  )[0]!;
  return Number(Math.max(0, drop - wantedAt).toFixed(3));
}

/**
 * How much of the film is deliberately quiet.
 *
 * Counts the cold open before music enters, any explicit silence cues, and the
 * tail after the final music fade. Reported so QA can flag a film that never
 * stops talking — wall-to-wall music has no dynamics to play against.
 */
function computeSilence(cues: PlacedCue[], musicEntersAt: number, total: number): number {
  const explicit = cues
    .filter((cue) => cue.type === 'silence')
    .reduce((sum, cue) => sum + (cue.durationSeconds ?? 0), 0);

  const musicOut = cues.find((cue) => cue.type === 'music_out');
  const tail = musicOut ? Math.max(0, total - musicOut.atSeconds - (musicOut.durationSeconds ?? 0)) : 0;

  return explicit + musicEntersAt + tail;
}
