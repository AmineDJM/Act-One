import { DIALOGUE_LEAD_MIN } from '@act-one/core';
import { runFfmpeg } from './ffmpeg.ts';
import type { MixPlan } from './mix.ts';

/**
 * How far the voice sits above the music while it is speaking.
 *
 * The mix ducks the bed under narration with a sidechain compressor, which
 * is the right tool and still a guess about how much: a bed that is quiet
 * already ducks to nothing, a loud one ducks to not enough. This measures the
 * result the way a dubbing stage would — the bed and the voice, separately,
 * over the stretches where the voice is speaking — so the number the standard
 * names is a number we have, not a setting we hope produced it.
 */
export type VoiceWindow = { atSeconds: number; durationSeconds: number };

export type DialogueLead = {
  voiceLufs: number;
  musicLufs: number;
  /** Voice minus music, in LU. */
  leadLu: number;
};

/**
 * FFmpeg arguments that run the mix's bus graph and meter the music bed and
 * the voice bus inside the voice windows, each with its own ebur128.
 *
 * No output file: both meters print their integrated loudness to stderr.
 */
export function dialogueLeadArgs(plan: MixPlan, windows: VoiceWindow[]): string[] | null {
  if (!plan.busses.music || !plan.busses.voice || windows.length === 0) return null;

  const select = windows
    .map((w) => `between(t,${fixed(w.atSeconds)},${fixed(w.atSeconds + w.durationSeconds)})`)
    .join('+');
  const gate = `aselect='${select}',asetpts=N/SR/TB`;

  /*
   * THE BED IS EVERYTHING THAT IS NOT THE VOICE, AND IT USED TO BE THE MUSIC.
   *
   * This graph reuses the mix's own bus graph and taps its busses. The effects
   * bus is built there too, and it was sent to `anullsink` — first because
   * leaving it unconnected made ffmpeg refuse the whole graph, and then
   * because this measurement was only ever asking about music. That second
   * part was wrong, and quietly: a viewer does not hear a music bus and an
   * effects bus, they hear the voice and everything under it. A check that
   * certifies intelligibility while discarding half of what is playing is
   * certifying a mix nobody listens to.
   *
   * Measured in the master it passed: the cues that land in a gap read +10 to
   * +35 dB over the moment before them, and the cues that land WHILE THE VOICE
   * IS SPEAKING read +0.7, -3.2 and +2.9. The worst is at 41.0s, which is the
   * film's own turn. A model watching both films said ours "lacks sound
   * effects for on-screen changes"; it is not wrong, and the meter that was
   * supposed to notice was looking the other way.
   *
   * So the two are summed before the gate and metered as one. `normalize=0`
   * because this is a sum and not an average — halving both busses to keep a
   * peak would report a bed 6 dB quieter than the one playing.
   */
  const nonVoice = plan.busses.sfx
    ? `[${plan.busses.music}][${plan.busses.sfx}]amix=inputs=2:duration=longest:normalize=0[nonvoice];[nonvoice]`
    : `[${plan.busses.music}]`;

  const graph =
    `${plan.busGraph};` +
    `${nonVoice}${gate},ebur128=peak=none[bed];` +
    `[${plan.busses.voice}]${gate},ebur128=peak=none[voice]`;

  const args: string[] = ['-hide_banner', '-nostdin'];
  for (const input of plan.inputs) args.push('-i', input.path);
  args.push('-filter_complex', graph);
  args.push('-map', '[bed]', '-f', 'null', '-');
  args.push('-map', '[voice]', '-f', 'null', '-');
  return args;
}

/**
 * The integrated loudness each ebur128 instance reported, in the order the
 * instances appear in the graph. FFmpeg names them Parsed_ebur128_N.
 */
export function parseEbur128Summaries(stderr: string): number[] {
  const found: { index: number; lufs: number }[] = [];
  const pattern = /\[Parsed_ebur128_(\d+) @ [^\]]+\] Summary:[\s\S]*?I:\s+(-?[\d.]+) LUFS/g;
  for (const match of stderr.matchAll(pattern)) {
    found.push({ index: Number(match[1]), lufs: Number(match[2]) });
  }
  return found.sort((a, b) => a.index - b.index).map((entry) => entry.lufs);
}

/**
 * Why a measurement did not happen.
 *
 * `null` was the only answer for four different failures — no music bus, no
 * voice bus, ffmpeg refusing the graph, and a meter that printed nothing — and
 * the caller could do nothing with it but skip the correction silently. The
 * film that is this project's acceptance criterion went out unmeasured for
 * weeks behind that null, and so would any production hitting the same graph,
 * because the pipeline skips its correction on null too.
 */
export type LeadFailure = { reason: 'no_music_bus' | 'no_voice_bus' | 'no_windows' | 'ffmpeg_failed' | 'no_meter_output'; detail: string };

export async function measureDialogueLead(
  plan: MixPlan,
  windows: VoiceWindow[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<DialogueLead | null> {
  const out = await readDialogueLead(plan, windows, options);
  return 'leadLu' in out ? out : null;
}

/** The same measurement, with the reason when it could not be taken. */
export async function readDialogueLead(
  plan: MixPlan,
  windows: VoiceWindow[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<DialogueLead | LeadFailure> {
  if (!plan.busses.music) return { reason: 'no_music_bus', detail: 'The mix has no music bus, so there is nothing for the voice to lead.' };
  if (!plan.busses.voice) return { reason: 'no_voice_bus', detail: 'The mix has no voice bus.' };
  if (windows.length === 0) return { reason: 'no_windows', detail: 'No voice windows were given, so there is no stretch to meter over.' };

  const args = dialogueLeadArgs(plan, windows)!;
  const result = await runFfmpeg(args, { signal: options.signal, timeoutMs: options.timeoutMs ?? 300_000 });
  if (!result.ok) return { reason: 'ffmpeg_failed', detail: result.stderr.trim().split('\n').slice(-3).join(' | ').slice(-400) };

  const [musicLufs, voiceLufs] = parseEbur128Summaries(result.stderr);
  if (musicLufs === undefined || voiceLufs === undefined || !Number.isFinite(musicLufs) || !Number.isFinite(voiceLufs)) {
    return { reason: 'no_meter_output', detail: `The meters printed ${parseEbur128Summaries(result.stderr).length} reading(s); two are needed.` };
  }
  return { voiceLufs, musicLufs, leadLu: voiceLufs - musicLufs };
}

/**
 * How much quieter the bed has to go for the voice to lead by the minimum,
 * with half a decibel of margin. Zero when it already does — and zero when
 * the bed is effectively silent, where a smaller number would be meaningless.
 */
export function bedReductionDb(lead: DialogueLead): number {
  if (lead.leadLu >= DIALOGUE_LEAD_MIN) return 0;
  if (lead.musicLufs < -60) return 0;
  return Math.round((DIALOGUE_LEAD_MIN + 0.5 - lead.leadLu) * 10) / 10;
}

function fixed(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, '') || '0';
}
