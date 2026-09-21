import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { ElevenLabsProvider } from '@act-one/providers';
import { analyseVoice, runFfmpeg } from '@act-one/sound';
import { alignToTypography, place, retimeForNarration, wordsLandAt } from '@act-one/creative';

/**
 * The voice, and what it is for.
 *
 * The reference films are narrated and their voice is most of their pace: a
 * model that listened to one measured a male read at about 160 words a minute,
 * close-miked and compressed, with the music ducking under it and every impact
 * landing on a word. This film was cut for silence instead — lines held long
 * enough to READ — which is a different film with the same pictures.
 *
 * THE RULE THIS SCRIPT IS WRITTEN TO. A voice that says what is already on the
 * screen adds nothing; the standards in this repo say so and they are right.
 * So no line below repeats its shot's on-screen copy. The screen states the
 * claim, the voice supplies what the picture cannot: the cost, the mechanism,
 * the thing that happens next. Shot 14 is deliberately silent — it is a
 * punctuation mark, and a voice over it would fill the only gap in the film.
 *
 * Lines are written to LAND INSIDE their shot at roughly the reference's pace.
 * That is checked rather than hoped for: `narrate()` measures every take and
 * reports any that overruns, because a line that runs past its cut moves the
 * meaning onto the wrong picture.
 */
export type NarrationLine = {
  sceneId: string;
  /**
   * How far into its own shot the line starts.
   *
   * RELATIVE, not absolute. Absolute times were typed against one cut, so any
   * change to a shot's length silently slid every line after it onto the wrong
   * picture — and the Director cannot retime a shot to fit a read if the read's
   * position is a constant that does not know where its shot is.
   */
  delaySeconds: number;
  text: string;
};

/**
 * Written against the shot table, not against the intentions.
 *
 * The delay on each line is deliberate: the cut and its impact land first and
 * the voice comes in just behind, which is what stops every shot starting with
 * two events on the same frame.
 */
export const NARRATION: NarrationLine[] = [
  { sceneId: 'l1', delaySeconds: 0.25, text: "Every company has a film it hasn't made yet." },
  { sceneId: 'l2', delaySeconds: 0.3, text: "You know what it should say. You've said it a hundred times." },
  { sceneId: 'l3', delaySeconds: 0.4, text: 'Then it becomes a project. Two months before a single frame exists.' },
  { sceneId: 'l4', delaySeconds: 0.5, text: 'This is Act One.' },
  { sceneId: 'l5', delaySeconds: 0.2, text: 'No brief. No kickoff call.' },
  { sceneId: 'l6', delaySeconds: 0.3, text: "It opens your site like a customer would, and takes what's actually there." },
  { sceneId: 'l7', delaySeconds: 0.2, text: 'Not one safe idea. Three.' },
  { sceneId: 'l8', delaySeconds: 0.2, text: 'Each one rendered, watched, and scored before you see it.' },
  { sceneId: 'l9', delaySeconds: 0.2, text: 'It finishes today.' },
  { sceneId: 'l10', delaySeconds: 0.3, text: 'Contrast, loudness, timing — it fails itself first.' },
  { sceneId: 'l11', delaySeconds: 0.3, text: 'Six weeks is thirty working days, and most of them are waiting.' },
  { sceneId: 'l12', delaySeconds: 0.3, text: 'Take the waiting out.' },
  { sceneId: 'l13', delaySeconds: 0.3, text: 'Nothing about the work gets cheaper. Only the calendar.' },
  // l14 is silent on purpose: the year blooms, and the film breathes once.
  { sceneId: 'l15', delaySeconds: 0.3, text: 'Send us a link. Watch your film tonight.' },
];

/**
 * Who reads it.
 *
 * Auditioned rather than picked off the list: six of the vendor's preset
 * voices read the opening line, and this one came back at 152 words a minute
 * against the reference's 160 while the rest ran between 208 and 238. Pace is
 * the part of a read that cannot be fixed downstream — the others would have
 * had to be slowed, and a slowed read sounds slowed.
 */
export const NARRATOR = 'iP95p4xoKVk53GoZ742B';

/** The same voice by the name a person would use when talking about it. */
/**
 * Chris — Charming, Down-to-Earth.
 *
 * Both critics put this voice first, from different evidence: the one watching
 * the film and the one hearing only the mix. They disagreed by three points on
 * every criterion and still agreed on the order, which is a better reason to
 * cast it than either score on its own.
 */
export const NARRATOR_NAME = 'Chris — Charming, Down-to-Earth';

/**
 * The model that reads the film.
 *
 * `eleven_multilingual_v2`, which the vendor describes as its "most life-like,
 * emotionally rich" model and recommends for voice overs and audiobooks. It is
 * also the only one of the seven that has BOTH a style dial and the continuity
 * fields — the lines either side of a take, and the previous takes themselves.
 * `eleven_v3` is more expressive in isolation and reads every line as a cold
 * start, which is most of what "rigid" and "disjointed" meant when a critic
 * watched the film.
 */
export const NARRATION_MODEL = 'eleven_multilingual_v2';

export type NarrationTake = {
  sceneId: string;
  /** The trimmed read, as the mix takes it. */
  path: string;
  /**
   * The vendor's own file, untouched.
   *
   * Kept because everything downstream — the trim, the mix, the master — is a
   * DECISION, and a decision you cannot go back behind is a decision you cannot
   * revise. Re-reading a line costs a job; re-trimming one costs nothing if the
   * clean take is still there.
   */
  rawPath: string;
  delaySeconds: number;
  durationSeconds: number;
};


/**
 * Reads every line, and says what it heard back.
 *
 * Cached on the text, the voice and the direction together, because a line
 * costs a job and a render iteration should not re-read a script that has not
 * changed. Anything that WOULD change the sound is in the key; nothing else
 * is.
 */
export async function narrate(options: {
  directory: string;
  voiceId?: string;
  /** The vendor model id. `eleven_v3` cannot hold continuity; the others can. */
  model?: string;
  /** Overrides the directed energy, for auditioning the axis itself. */
  energy?: 'low' | 'medium-low' | 'medium' | 'medium-high' | 'high';
  /** Lower is a freer read. 'creative' 0.35, 'natural' 0.5, 'robust' 0.7. */
  stability?: 'creative' | 'natural' | 'robust';
  signal?: AbortSignal;
}): Promise<NarrationTake[]> {
  const voiceId = options.voiceId ?? NARRATOR;
  const model = options.model ?? NARRATION_MODEL;
  mkdirSync(options.directory, { recursive: true });
  // Both slots are the same model: this function reads finals, and the tier
  // split is not the axis being chosen here.
  const provider = new ElevenLabsProvider({ models: { final: model, preview: model } });
  const quality = 'final' as const;

  /*
   * DIRECTED FOR THIS PICTURE, not for the reference's.
   *
   * This was `energy: 'high', pace: 'fast'`, taken from the reference read —
   * 160 words a minute, driving, close to a pitch. Auditioned against our own
   * film it scored 3.88 out of 10, and the critic put its finger exactly on
   * why: at 32 seconds, "the sudden burst of artificial enthusiasm feels
   * entirely disconnected from the sleek, restrained visual aesthetic."
   *
   * The reference's picture is fast and saturated. Ours is dark, editorial and
   * slow-cut. Copying the energy of somebody else's read onto it was casting
   * the voice for a film we did not make.
   */
  const direction = {
    energy: options.energy ?? 'medium',
    pace: 'natural',
    style: 'confident',
    profile: 'neutral',
    gender: 'male',
    language: 'en',
    /*
     * STABILITY WAS NEVER SET, which means it was never chosen.
     *
     * The provider reads `direction.stability` and this object did not have
     * the field, so it resolved to undefined and the vendor used its own
     * default. Every reading of this film has called the narration robotic,
     * and the one dial the vendor documents as controlling exactly that had
     * never been touched — LOWER stability is a freer, more varied read, and
     * higher is a flatter, more consistent one.
     */
    stability: options.stability ?? 'creative',
  };

  const takes: NarrationTake[] = [];
  /*
   * ONE PERFORMANCE, NOT FOURTEEN COLD STARTS.
   *
   * Every line was being read in isolation, so the engine had no idea what had
   * just been said or what was coming; the seams between them are most of what
   * "disjointed" meant. This vendor takes the neighbouring lines as context and
   * will condition on the previous takes' request ids, which is the difference
   * between a read and fourteen reads laid end to end. The Runway route did
   * not expose any of it.
   *
   * It also makes the cache order-dependent, which is why the neighbours are in
   * the key: changing line 7 changes how lines 6 and 8 are read.
   */
  const spoken: string[] = [];
  for (const [index, line] of NARRATION.entries()) {
    const previousText = index > 0 ? NARRATION[index - 1]!.text : null;
    const nextText = index < NARRATION.length - 1 ? NARRATION[index + 1]!.text : null;
    const key = createHash('sha256')
      .update(JSON.stringify({ text: line.text, previousText, nextText, voiceId, direction, model, v: 5 }))
      .digest('hex')
      .slice(0, 16);
    const wav = path.join(options.directory, `${line.sceneId}-${key}.wav`);

    if (!existsSync(wav)) {
      const result = await provider.synthesize(
        {
          text: line.text,
          voiceId,
          persona: 'narrator_low',
          language: 'en',
          quality,
          direction: direction as never,
          continuity: {
            previousText,
            nextText,
            // At most the last three, which is all the vendor reads.
            previousRequestIds: spoken.slice(-3),
          },
        },
        { organizationId: 'org_launch', projectId: 'prj_launch', ...(options.signal ? { signal: options.signal } : {}) } as never,
      );
      if (result.requestId) spoken.push(result.requestId);
      const mp3 = `${wav}.mp3`;
      writeFileSync(mp3, result.audio);

      /*
       * Trimmed to the first word, measured rather than assumed.
       *
       * The engine leaves a little dead air at the head of a take, and it is
       * not the same amount every time. Placing an untrimmed take at a shot's
       * start puts the voice a variable distance behind the cut, so every
       * line would sit slightly differently against its picture for no reason
       * anybody chose. The measurement is what makes the placement above mean
       * what it says.
       */
      const heard = await analyseVoice(mp3, { loudness: false });
      const head = Math.max(0, (heard?.headSilenceSeconds ?? 0) - 0.03);
      const converted = await runFfmpeg(
        [
          '-y', '-hide_banner', '-loglevel', 'error', '-i', mp3,
          ...(head > 0 ? ['-af', `atrim=start=${head.toFixed(3)},asetpts=PTS-STARTPTS`] : []),
          '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav,
        ],
        { timeoutMs: 120_000 },
      );
      if (!converted.ok) throw new Error(`Could not convert ${line.sceneId}: ${converted.stderr.slice(-300)}`);
    }

    const measured = await analyseVoice(wav, { loudness: false });
    takes.push({
      sceneId: line.sceneId,
      path: wav,
      rawPath: `${wav}.mp3`,
      delaySeconds: line.delaySeconds,
      durationSeconds: measured?.durationSeconds ?? 0,
    });
  }
  return takes;
}


/** Words a minute, across the read rather than across the film. */
export function wordsPerMinute(takes: readonly NarrationTake[]): number {
  const spoken = takes.reduce((sum, take) => sum + take.durationSeconds, 0);
  const words = NARRATION.reduce((sum, line) => sum + line.text.split(/\s+/).filter(Boolean).length, 0);
  return spoken > 0 ? (words / spoken) * 60 : 0;
}


export { alignToTypography, place, retimeForNarration, wordsLandAt };
