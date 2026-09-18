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

  const graph =
    `${plan.busGraph};` +
    `[${plan.busses.music}]${gate},ebur128=peak=none[bed];` +
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

export async function measureDialogueLead(
  plan: MixPlan,
  windows: VoiceWindow[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<DialogueLead | null> {
  const args = dialogueLeadArgs(plan, windows);
  if (!args) return null;
  const result = await runFfmpeg(args, { signal: options.signal, timeoutMs: options.timeoutMs ?? 300_000 });
  if (!result.ok) return null;
  const [musicLufs, voiceLufs] = parseEbur128Summaries(result.stderr);
  if (musicLufs === undefined || voiceLufs === undefined) return null;
  if (!Number.isFinite(musicLufs) || !Number.isFinite(voiceLufs)) return null;
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
