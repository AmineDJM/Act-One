import type { SoundDesign, PlacedCue } from './sound-director.ts';

/**
 * The audio mix, expressed as an FFmpeg filter graph.
 *
 * Built as a data structure and only then serialised to arguments, for two
 * reasons: it can be unit-tested without FFmpeg installed, and a graph that is
 * constructed rather than string-concatenated cannot be broken by a filename
 * containing a quote.
 *
 * What the graph does, in order:
 *   1. Trims and gains each source to a known level.
 *   2. Delays every element to its exact film time.
 *   3. Ducks music under narration with a real sidechain compressor, rather
 *      than a static volume envelope — static ducking pumps audibly whenever
 *      the narration pauses.
 *   4. Mixes, then normalises the master to a channel-appropriate loudness.
 */
export type AudioInput = {
  /** Local path or URL FFmpeg can read. */
  path: string;
  role: 'music' | 'voice' | 'sfx';
  /** Where this element starts in film time. */
  atSeconds: number;
  gainDb: number;
  trimStartSeconds?: number;
  durationSeconds?: number | null;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
};

export type MixPlan = {
  inputs: AudioInput[];
  filterGraph: string;
  outputLabel: string;
  targetLufs: number;
  durationSeconds: number;
};

export type BuildMixOptions = {
  design: SoundDesign;
  /** Resolved local paths, keyed by storage key. */
  resolvedPaths: Record<string, string>;
  voiceTracks?: { path: string; atSeconds: number; durationSeconds: number }[];
  durationSeconds: number;
};

export function buildMix(options: BuildMixOptions): MixPlan {
  const inputs: AudioInput[] = [];
  const { design } = options;

  if (design.music) {
    const path = options.resolvedPaths[design.music.storageKey];
    if (path) {
      inputs.push({
        path,
        role: 'music',
        atSeconds: design.music.enterAtSeconds,
        gainDb: design.music.baseGainDb,
        trimStartSeconds: design.music.startOffsetSeconds,
        durationSeconds: options.durationSeconds - design.music.enterAtSeconds,
        fadeInSeconds: design.music.fadeInSeconds,
        fadeOutSeconds: design.music.fadeOutSeconds,
      });
    }
  }

  for (const cue of design.cues) {
    if (!cue.storageKey) continue;
    const path = options.resolvedPaths[cue.storageKey];
    if (!path) continue;
    inputs.push({
      path,
      role: 'sfx',
      atSeconds: cue.atSeconds,
      gainDb: cue.gainDb,
      durationSeconds: cue.durationSeconds,
    });
  }

  for (const voice of options.voiceTracks ?? []) {
    inputs.push({
      path: voice.path,
      role: 'voice',
      atSeconds: voice.atSeconds,
      // Voice is normalised separately and sits at unity here; the sidechain
      // below is what creates headroom for it.
      gainDb: 0,
      durationSeconds: voice.durationSeconds,
    });
  }

  return {
    inputs,
    filterGraph: buildFilterGraph(inputs, design, options.durationSeconds),
    outputLabel: 'mixout',
    targetLufs: design.targetLufs,
    durationSeconds: options.durationSeconds,
  };
}

function buildFilterGraph(inputs: AudioInput[], design: SoundDesign, duration: number): string {
  const chains: string[] = [];
  const musicLabels: string[] = [];
  const voiceLabels: string[] = [];
  const sfxLabels: string[] = [];

  inputs.forEach((input, index) => {
    const label = `${input.role}${index}`;
    const steps: string[] = ['aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo'];

    if (input.trimStartSeconds && input.trimStartSeconds > 0) {
      steps.push(`atrim=start=${fixed(input.trimStartSeconds)}`, 'asetpts=PTS-STARTPTS');
    }
    if (input.durationSeconds && input.durationSeconds > 0) {
      steps.push(`atrim=duration=${fixed(input.durationSeconds)}`, 'asetpts=PTS-STARTPTS');
    }
    if (input.gainDb !== 0) {
      steps.push(`volume=${fixed(input.gainDb)}dB`);
    }
    if (input.fadeInSeconds && input.fadeInSeconds > 0) {
      steps.push(`afade=t=in:st=0:d=${fixed(input.fadeInSeconds)}`);
    }
    if (input.fadeOutSeconds && input.fadeOutSeconds > 0 && input.durationSeconds) {
      const start = Math.max(0, input.durationSeconds - input.fadeOutSeconds);
      steps.push(`afade=t=out:st=${fixed(start)}:d=${fixed(input.fadeOutSeconds)}`);
    }
    if (input.atSeconds > 0) {
      // adelay is in milliseconds, per channel.
      const ms = Math.round(input.atSeconds * 1000);
      steps.push(`adelay=${ms}|${ms}`);
    }

    chains.push(`[${index}:a]${steps.join(',')}[${label}]`);
    if (input.role === 'music') musicLabels.push(label);
    else if (input.role === 'voice') voiceLabels.push(label);
    else sfxLabels.push(label);
  });

  const parts = [...chains];

  const musicBus = combine(parts, musicLabels, 'musicbus');
  const voiceBus = combine(parts, voiceLabels, 'voicebus');
  const sfxBus = combine(parts, sfxLabels, 'sfxbus');

  let duckedMusic = musicBus;
  if (musicBus && voiceBus) {
    // A real sidechain, not a static envelope: static ducking pumps audibly
    // every time the narration pauses for breath.
    parts.push(
      `[${musicBus}][${voiceBus}]sidechaincompress=` +
        'threshold=0.055:ratio=7:attack=12:release=320:makeup=1[musicducked]',
    );
    duckedMusic = 'musicducked';
  } else if (musicBus && hasDuckCues(design.cues)) {
    // No narration but the storyboard asked for ducking — usually under a
    // product moment we want to hear.
    parts.push(`[${musicBus}]volume=enable='${duckWindows(design.cues)}':volume=0.45[musicducked]`);
    duckedMusic = 'musicducked';
  }

  const busses = [duckedMusic, voiceBus, sfxBus].filter((label): label is string => Boolean(label));
  if (busses.length === 0) {
    // Silence still needs to be a real track, or the muxer drops the stream.
    parts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${fixed(duration)}[mixout]`);
    return parts.join(';');
  }

  const mixInputs = busses.map((label) => `[${label}]`).join('');
  parts.push(
    `${mixInputs}amix=inputs=${busses.length}:duration=longest:dropout_transition=0:normalize=0[premaster]`,
  );

  // Two-stage master: a gentle limiter to catch impact transients, then
  // loudness normalisation to the channel target.
  /*
   * A gentle limiter to catch impact transients, and then nothing.
   *
   * Loudness is deliberately not normalised inside this graph. It used to be,
   * in one pass, which lands a decibel or two from the target — most of the
   * tolerance EBU R 128 allows for a whole programme, spent here. The mix now
   * produces a premaster and `masterLoudness` does the two-pass normalisation
   * afterwards, using the same code that masters the sound library.
   */
  parts.push(`[premaster]alimiter=limit=0.95:attack=5:release=120[limited]`);
  parts.push(
    `[limited]atrim=duration=${fixed(duration)},` +
      `afade=t=out:st=${fixed(Math.max(0, duration - 0.35))}:d=0.35[mixout]`,
  );

  return parts.join(';');
}

function combine(parts: string[], labels: string[], outLabel: string): string | null {
  if (labels.length === 0) return null;
  if (labels.length === 1) return labels[0]!;
  parts.push(
    `${labels.map((l) => `[${l}]`).join('')}amix=inputs=${labels.length}:duration=longest:normalize=0[${outLabel}]`,
  );
  return outLabel;
}

function hasDuckCues(cues: PlacedCue[]): boolean {
  return cues.some((cue) => cue.type === 'music_duck');
}

function duckWindows(cues: PlacedCue[]): string {
  return cues
    .filter((cue) => cue.type === 'music_duck')
    .map((cue) => `between(t,${fixed(cue.atSeconds)},${fixed(cue.atSeconds + (cue.durationSeconds ?? 2))})`)
    .join('+');
}

function fixed(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, '') || '0';
}

/**
 * FFmpeg arguments for the mix.
 *
 * Returned as an argv array, never a shell string: a customer's project name
 * ends up in these paths, and shell interpolation is how that becomes a
 * command-injection bug.
 */
export function mixArgs(plan: MixPlan, outputPath: string): string[] {
  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const input of plan.inputs) {
    args.push('-i', input.path);
  }
  if (plan.inputs.length === 0) {
    args.push('-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${plan.durationSeconds}`);
  }
  args.push('-filter_complex', plan.filterGraph);
  args.push('-map', `[${plan.outputLabel}]`);
  /*
   * Lossless out of the mix.
   *
   * This wrote AAC, the master then wrote AAC again, and the mux wrote it a
   * third time — three generations of lossy encoding on the way to one file.
   * Each one raises inter-sample peaks, which is how a master aimed at
   * −1.5 dBTP came out at −0.9, over the EBU R 128 ceiling. The premaster is
   * an intermediate; the single encode that matters happens at the mux.
   */
  args.push('-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2');
  args.push('-t', String(plan.durationSeconds));
  args.push(outputPath);
  return args;
}

/** Muxes a rendered video with the finished mix, without re-encoding video. */
export function muxArgs(videoPath: string, audioPath: string, outputPath: string): string[] {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', videoPath,
    '-i', audioPath,
    '-map', '0:v:0', '-map', '1:a:0',
    // Video is copied: it was already encoded at the quality we chose, and
    // re-encoding to attach audio costs time and a generation of quality.
    '-c:v', 'copy',
    /*
     * Colour tagged completely, in the bitstream, without re-encoding.
     *
     * The encoder writes the primaries and leaves the transfer function and the
     * matrix unset, so the file reads as `bt709/unknown/unknown` and every
     * player downstream guesses two of the three — differently from each other.
     * FFmpeg's `-color_*` output options only apply when it is encoding, so on
     * a stream copy they are silently ignored; rewriting the VUI in the
     * bitstream is what actually sets them, and costs nothing.
     */
    '-bsf:v',
    'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0',
    '-c:a', 'aac', '-b:a', '256k',
    '-shortest',
    '-movflags', '+faststart',
    outputPath,
  ];
}

/** Extracts a poster frame. */
export function posterArgs(videoPath: string, atSeconds: number, outputPath: string): string[] {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', String(atSeconds),
    '-i', videoPath,
    '-frames:v', '1',
    '-q:v', '2',
    outputPath,
  ];
}
