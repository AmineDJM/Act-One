import type { Standard } from './standard.ts';

/**
 * Loudness law.
 *
 * Loudness is fully standardised, internationally, with a measurement algorithm
 * and a number — and it is still the thing most self-produced films get wrong,
 * because a mix that sounds right while you are making it is almost always too
 * loud. The measurement exists precisely because ears cannot do this.
 */
export const AUDIO_STANDARDS = {
  measurement: {
    id: 'audio.measurement',
    rule: 'Loudness is measured, not judged: gated integrated loudness in LUFS.',
    source: 'ITU-R BS.1770-4',
    clause: 'Algorithms to measure audio programme loudness and true-peak level',
    authority: 'normative',
    because:
      'It is the only measurement that corresponds to what people hear, and it is what ' +
      'every broadcaster and streaming platform normalises against.',
  },
  broadcastTarget: {
    id: 'audio.broadcast_target',
    rule: 'A broadcast deliverable sits at −23 LUFS integrated.',
    source: 'EBU R 128',
    clause: 'Programme Loudness target',
    authority: 'normative',
    because: 'European broadcast requires it. A film delivered louder will be turned down for you.',
  },
  truePeak: {
    id: 'audio.true_peak',
    rule: 'True peak never exceeds −1 dBTP.',
    source: 'EBU R 128',
    clause: 'Maximum Permitted True Peak Level',
    authority: 'normative',
    because:
      'Inter-sample peaks exceed sample peaks after encoding, so a mix that peaks at 0 dBFS ' +
      'distorts once it is an AAC file. The one decibel is the headroom that lossy encoding eats.',
  },
  webTarget: {
    id: 'audio.web_target',
    rule: 'A film for the web sits near −16 LUFS.',
    source: 'Common streaming normalisation targets (−14 LUFS)',
    authority: 'guidance',
    because:
      'Web players normalise toward −14, and a launch film usually plays next to a page ' +
      'rather than inside a broadcast chain. Slightly under the platform target leaves the ' +
      'dynamics intact instead of having them limited on the way in.',
  },
  dialogueLead: {
    id: 'audio.dialogue_lead',
    rule: 'Voice sits 4 to 6 LU above the music bed while it is speaking.',
    source: 'Standard dubbing-stage practice',
    authority: 'convention',
    because:
      'Below about 4 LU the words stop carrying over a bed; above about 6 the music stops ' +
      'doing anything. Automated mixes fail on the first side almost every time.',
  },
  ducking: {
    id: 'audio.ducking',
    rule: 'Music ducks under voice by sidechain, not by a fade drawn in advance.',
    source: 'Standard dubbing-stage practice',
    authority: 'convention',
    because:
      'A sidechain follows the actual envelope of the voice, so it releases in the gaps ' +
      'between phrases. A drawn fade holds the music down through the whole line.',
  },
  silence: {
    id: 'audio.silence',
    rule: 'A film may be silent. It may not have music because a film is expected to.',
    source: 'Act One house rule',
    authority: 'house',
    because:
      'Library music underneath something that did not ask for it is the sound of a template. ' +
      'The same is true of narration: a voice reading text already on screen adds nothing.',
  },
} as const satisfies Record<string, Standard>;

/** Integrated loudness targets, LUFS. */
export const LUFS_BROADCAST = -23;
export const LUFS_WEB = -16;
export const LUFS_STREAMING_PLATFORM = -14;

/** EBU R 128 permits ±1 LU around the target for programmes of this length. */
export const LUFS_TOLERANCE = 1;

/** Maximum true peak, dBTP. */
export const TRUE_PEAK_CEILING = -1;

/** How far voice sits above the bed, in LU. */
export const DIALOGUE_LEAD_MIN = 4;
export const DIALOGUE_LEAD_MAX = 6;

export type DeliveryTarget = 'broadcast' | 'web';

export function loudnessTargetFor(target: DeliveryTarget): number {
  return target === 'broadcast' ? LUFS_BROADCAST : LUFS_WEB;
}

/** True when a measured mix is inside tolerance of its target. */
export function loudnessWithinTolerance(measuredLufs: number, target: DeliveryTarget): boolean {
  return Math.abs(measuredLufs - loudnessTargetFor(target)) <= LUFS_TOLERANCE;
}
