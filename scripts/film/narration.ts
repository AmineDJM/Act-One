import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { RunwayAudioProvider } from '@act-one/providers';
import { analyseVoice, runFfmpeg } from '@act-one/sound';

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
  /** Film time the read starts, seconds. */
  atSeconds: number;
  /** The shot's own length, so an overrun can be named. */
  windowSeconds: number;
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
  { sceneId: 'l1', atSeconds: 0.25, windowSeconds: 3.35, text: "Every company has a film it hasn't made yet." },
  { sceneId: 'l2', atSeconds: 3.9, windowSeconds: 4.5, text: "You know what it should say. You've said it a hundred times." },
  { sceneId: 'l3', atSeconds: 8.8, windowSeconds: 4.8, text: 'Then it becomes a project. Two months before a single frame exists.' },
  { sceneId: 'l4', atSeconds: 14.1, windowSeconds: 2.9, text: 'This is Act One.' },
  { sceneId: 'l5', atSeconds: 17.2, windowSeconds: 2.4, text: 'No brief. No kickoff call.' },
  { sceneId: 'l6', atSeconds: 19.9, windowSeconds: 4.3, text: "It opens your site like a customer would, and takes what's actually there." },
  { sceneId: 'l7', atSeconds: 24.4, windowSeconds: 2.4, text: 'Not one safe idea. Three.' },
  { sceneId: 'l8', atSeconds: 27.0, windowSeconds: 4.4, text: 'Each one rendered, watched, and scored before you see it.' },
  { sceneId: 'l9', atSeconds: 31.6, windowSeconds: 1.8, text: 'It finishes today.' },
  { sceneId: 'l10', atSeconds: 33.7, windowSeconds: 4.3, text: 'Contrast, loudness, timing — it fails itself first.' },
  { sceneId: 'l11', atSeconds: 38.3, windowSeconds: 4.9, text: 'Six weeks is thirty working days, and most of them are waiting.' },
  { sceneId: 'l12', atSeconds: 43.5, windowSeconds: 2.9, text: 'Take the waiting out.' },
  { sceneId: 'l13', atSeconds: 46.7, windowSeconds: 4.1, text: 'Nothing about the work gets cheaper. Only the calendar.' },
  // l14 is silent on purpose: the year blooms, and the film breathes once.
  { sceneId: 'l15', atSeconds: 54.3, windowSeconds: 3.5, text: 'Send us a link. Watch your film tonight.' },
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
export const NARRATOR = 'Mark';

export type NarrationTake = {
  sceneId: string;
  path: string;
  atSeconds: number;
  durationSeconds: number;
  /** How far past its shot the read runs. Zero is what we want. */
  overrunSeconds: number;
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
  signal?: AbortSignal;
}): Promise<NarrationTake[]> {
  const voiceId = options.voiceId ?? NARRATOR;
  mkdirSync(options.directory, { recursive: true });
  const provider = new RunwayAudioProvider({ voiceId });

  const direction = {
    energy: 'high',
    pace: 'fast',
    style: 'confident',
    profile: 'neutral',
    gender: 'male',
    language: 'en',
  };

  const takes: NarrationTake[] = [];
  for (const line of NARRATION) {
    const key = createHash('sha256')
      .update(JSON.stringify({ text: line.text, voiceId, direction, v: 2 }))
      .digest('hex')
      .slice(0, 16);
    const wav = path.join(options.directory, `${line.sceneId}-${key}.wav`);

    if (!existsSync(wav)) {
      const result = await provider.synthesize(
        {
          text: line.text,
          persona: 'narrator_low',
          language: 'en',
          quality: 'final',
          direction: direction as never,
        },
        { organizationId: 'org_launch', projectId: 'prj_launch', ...(options.signal ? { signal: options.signal } : {}) } as never,
      );
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
    const durationSeconds = measured?.durationSeconds ?? 0;
    takes.push({
      sceneId: line.sceneId,
      path: wav,
      atSeconds: line.atSeconds,
      durationSeconds,
      overrunSeconds: Math.max(0, durationSeconds - line.windowSeconds),
    });
  }
  return takes;
}

/** Words a minute, across the read rather than across the film. */
export function wordsPerMinute(takes: NarrationTake[]): number {
  const spoken = takes.reduce((sum, take) => sum + take.durationSeconds, 0);
  const words = NARRATION.reduce((sum, line) => sum + line.text.split(/\s+/).filter(Boolean).length, 0);
  return spoken > 0 ? (words / spoken) * 60 : 0;
}
