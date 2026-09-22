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
import { planEnding, type EndingPlan } from './ending.ts';

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
    /**
     * Film time at which the music is gone.
     *
     * It used to be the end of the film by construction, which meant every
     * ending was "music fades under the last frame" no matter what the last
     * frame was. A film that ends on its own product sound, or on a held
     * silence, needs the bed out of the way before it gets there.
     */
    exitAtSeconds: number;
    baseGainDb: number;
  } | null;
  cues: PlacedCue[];
  /** How this film stops, and why. Chosen from the cut, not applied to it. */
  ending: EndingPlan;
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
  /**
   * Where the film turns, so the score's drop can land on it.
   *
   * Optional, and when it is absent the old scan runs. That scan cannot find
   * anything in a scene-graph film, which is how this whole mechanism came to
   * be dead code that ran on every render.
   */
  turnAtSeconds?: number;

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

  /*
   * How the film stops.
   *
   * This runs after the cues are placed because the decision is read out of
   * the film — how much of it was spent operating the product, how dense the
   * sound got, what the last frame holds — and then it is enforced back onto
   * them. `endWithSting` is a preference the creative system expresses; an
   * ending that belongs to no film in particular is not a preference worth
   * honouring, so the plan wins and says why in the notes.
   */
  const dense = total > 0 && cues.filter((cue) => cue.storageKey !== null).length / total > 0.45;
  const ending = planEnding(storyboard, { loud: dense, hasVoiceOver: input.hasVoiceOver ?? false });
  const removed = applyEnding(cues, ending, total);
  if (removed.length > 0) {
    notes.push(`${ending.strategy.replace(/_/g, ' ')}: dropped ${removed.join(', ')} from the last seconds. ${ending.reason}`);
  } else {
    notes.push(`Ending — ${ending.strategy.replace(/_/g, ' ')}. ${ending.reason}`);
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
          startOffsetSeconds: chooseStartOffset(track, storyboard, enterAt, input.turnAtSeconds),
          enterAtSeconds: Number(enterAt.toFixed(3)),
          fadeInSeconds: input.behaviour.openOnMusic ? 0.8 : 1.6,
          /*
           * A hard stop is a cut, not a fade: 120 ms so the tail does not
           * click, and nothing that reads as a resolution.
           */
          fadeOutSeconds:
            ending.strategy === 'hard_stop' ? 0.12 : track.hasOutro ? 2.2 : 1.2,
          exitAtSeconds: Number(
            Math.max(enterAt + 0.5, total - ending.musicOutSeconds).toFixed(3),
          ),
          /*
           * One bed level, whether or not anybody is speaking.
           *
           * It used to drop to −18 dB for the whole film the moment there was
           * narration, which is the drawn fade AUDIO_STANDARDS.ducking exists
           * to rule out: it holds the music down through every pause and every
           * passage with no voice in it at all. The sidechain in the mix is
           * what creates room for the voice, and it releases in the gaps.
           */
          /*
           * -8 dB, and the number was measured rather than chosen.
           *
           * The bed sat at -13, which is where a bed goes when a voice has to
           * be heard over it. Sampled at a tenth of a second — fine enough to
           * see between transients — three reference films hold their beds at
           * 0.116, 0.148 and 0.169 RMS with accents 2.3 to 5.7 times above
           * them. This system's films measured 0.052 with accents 10.6 times
           * above: a quiet bed punctuated by bangs, which is what an
           * automated mix sounds like and is audible immediately.
           *
           * Still ONE level whether or not anybody is speaking, which is the
           * part that matters. The bed used to drop to -18 for the whole film
           * the moment there was narration — the drawn fade that holds music
           * down through every pause — and the sidechain in the mix is what
           * makes room for a voice and releases in the gaps. Raising the
           * resting level does not touch that; making it conditional would.
           *
           * A first attempt at this fixed the ratio by making the level
           * depend on `hasVoiceOver`, and a test caught it. The test was
           * right.
           */
          baseGainDb: -8,
        }
      : null,
    cues: cues.sort((a, b) => a.atSeconds - b.atSeconds),
    ending,
    silenceSeconds: Number(silence.toFixed(2)),
    targetLufs: LOUDNESS_TARGETS[channel],
    notes,
  };
}

/**
 * How much of the tail counts as "the ending".
 *
 * A fixed three and a half seconds is the whole ending of a five-second film,
 * and clearing it took out an impact that was doing structural work in the
 * middle of the cut. The ending is the last quarter, and on a long film that
 * is still only the last few seconds.
 */
const LAST_SHARE = 0.25;
const LAST_SECONDS_MAX = 3.5;

/**
 * The ending, enforced on the cues that were already placed.
 *
 * Every strategy but one removes rather than adds, which is the point: the
 * generic ending is what you get by adding a gesture, and the way out of it is
 * not a different gesture. Returns what it took away, so the notes can say so
 * instead of the film quietly losing a sound somebody asked for.
 */
function applyEnding(cues: PlacedCue[], ending: EndingPlan, total: number): string[] {
  const from = total - Math.min(LAST_SECONDS_MAX, total * LAST_SHARE);
  const doomed = new Set<string>();
  for (const cue of cues) {
    if (cue.atSeconds <= from) continue;
    switch (ending.strategy) {
      case 'product_sound_last':
        // Everything that is not the product's own sound clears out of its way.
        if (cue.type !== 'ui_click') doomed.add(cue.id);
        break;
      case 'let_it_go_quiet':
      case 'hard_stop':
        if (cue.type === 'logo_sting' || cue.type === 'impact' || cue.type === 'riser') doomed.add(cue.id);
        break;
      case 'subtract_to_one':
        if (cue.type === 'logo_sting' || cue.type === 'riser') doomed.add(cue.id);
        break;
      case 'small_impact':
        // One mark. A sting under it is the ending this exists to avoid.
        if (cue.type === 'logo_sting' || cue.type === 'riser') doomed.add(cue.id);
        break;
    }
  }
  const dropped: string[] = [];
  for (let i = cues.length - 1; i >= 0; i -= 1) {
    const cue = cues[i]!;
    if (!doomed.has(cue.id)) continue;
    dropped.push(cue.type);
    cues.splice(i, 1);
  }
  return [...new Set(dropped)];
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
  /*
   * ACCENTS SIT ON THE BED, NOT OVER IT.
   *
   * The bed rests at -13 dB. These windows let an impact reach -6 and a
   * logo sting -5, which is 7 to 8 dB ABOVE the thing they are supposed to
   * punctuate — and a measured master showed exactly that: a continuous bed
   * at 0.07 RMS with three hits at 0.5, which is three bangs and a whisper
   * rather than a mix. Measured against the reference films, which hold a
   * steady 0.13 to 0.18 with accents that land on it, the ceilings were
   * simply too high.
   *
   * Lowered rather than raising the bed, and that distinction matters. The
   * one-bed-level rule above is deliberate — the sidechain creates room for a
   * voice dynamically and releases in the gaps, which is what stops a mix
   * holding the music down through every pause. Making the resting level
   * depend on whether there is narration would undo that to fix a problem
   * that lives in the cues.
   */
  const windows: Partial<Record<SoundCueType, [number, number]>> = {
    impact: [-20, -9],
    sub_drop: [-18, -8],
    riser: [-24, -12],
    whoosh: [-27, -15],
    ui_click: [-31, -21],
    texture: [-34, -24],
    logo_sting: [-16, -8],
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
function chooseStartOffset(
  track: MusicTrack,
  storyboard: Storyboard,
  enterAt: number,
  turnAtSeconds?: number,
): number {
  if (track.dropPoints.length === 0) return 0;

  /*
   * The caller's turn if it named one, otherwise the old scan.
   *
   * The scan looks for the first product scene, and a scene-graph film has
   * none by construction — the bridge marks every scene `mixed_media` because
   * a scene graph is not a recipe. So this returned 0 on every film this
   * project has rendered, and the score started at the top of the track with
   * its drop wherever the track happened to put it. Three separate readings
   * called the music a passive bed that ignores the film's structure. It was.
   */
  const turnStart = turnAtSeconds ?? storyboard.scenes.find(
    (scene) => scene.visualType === 'product_ui' || scene.visualType === 'screenshot_motion',
  )?.startTime;
  if (turnStart === undefined) return 0;

  const wantedAt = turnStart - enterAt;
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
