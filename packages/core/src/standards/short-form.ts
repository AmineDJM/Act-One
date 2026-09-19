import type { Standard } from './standard.ts';

/**
 * Short form.
 *
 * A reel is not a shorter film. It is a different medium with a different
 * contract: the viewer did not choose it, is not listening, and leaves at any
 * moment without cost. Everything that makes a classic film good — a held
 * opening, an image given room, a build towards something — is a liability
 * here, and a film that treats the format as "the same work, trimmed" reads
 * exactly as what it is.
 *
 * The temptation in the other direction is worse. Fast cuts, shouted type and
 * a zoom on every beat are what "made for TikTok" means as an insult, and
 * they are not what the work people admire does. The craft is holding premium
 * art direction while engineering attention: a frame somebody would stop on,
 * arriving before they have decided to scroll.
 *
 * Very little of this is standardised, and the file says so. The platform
 * numbers are published; the structure and the pacing are convention and
 * house, stated with their reasoning so they can be argued with rather than
 * dressed up as law.
 */
export const SHORT_FORM_STANDARDS = {
  patternInterrupt: {
    id: 'short.pattern_interrupt',
    rule: 'The first second carries the strongest thing in the film, not an introduction to it.',
    source: 'Platform creative guidance (Meta Reels, TikTok, YouTube Shorts)',
    authority: 'guidance',
    enforcement: 'checked',
    because:
      'Every platform that publishes retention data shows the steepest drop inside the first ' +
      'seconds, before any build can pay off. A film that opens on a logo, an establishing shot ' +
      'or a question spends the only attention it is given on setup for an audience that has ' +
      'already gone.',
  },
  noSlowOpen: {
    id: 'short.no_slow_open',
    rule: 'No logo, title card or establishing shot before the idea.',
    source: 'Platform creative guidance (Meta, TikTok)',
    authority: 'guidance',
    enforcement: 'checked',
    because:
      'Branding at the top is the single most reliable way to lose a feed audience, and it is ' +
      'the first thing a brand asks for. The mark belongs at the end, where somebody who stayed ' +
      'will read it.',
  },
  attentionReset: {
    id: 'short.attention_reset',
    rule: 'Something is happening at all times. The something may be stillness, if the stillness is doing work.',
    source: 'House rule, from editorial practice in short form',
    authority: 'house',
    enforcement: 'checked',
    because:
      'The enemy is dead attention, not stillness. A reset can come from a subject moving, an ' +
      'action inside the frame, type arriving, a sound landing, a cut to something else, a ' +
      'composition that has changed, or a camera that moves — and a held static frame is one of ' +
      'the strongest things in the form when it is a held *reaction*, a beat of tension or a ' +
      'deliberate contrast against everything around it. What fails is a frame where nothing is ' +
      'happening and nothing was meant to be: that is not restraint, it is a film that has ' +
      'stopped asking to be watched. Injecting a slow zoom into every static shot to satisfy the ' +
      'rule is the same mistake wearing motion.',
  },
  density: {
    id: 'short.density',
    rule: 'Every shot earns its place. A beat of texture must be doing something the film needs.',
    source: 'House rule, from editorial practice in short form',
    authority: 'house',
    enforcement: 'checked',
    because:
      'Texture is what a classic film spends its middle on, and here it has to justify itself: ' +
      'at twenty seconds a breath is a twentieth of the film. That is an argument for making the ' +
      'pause deliberate, not for having none — a beat placed to let something land is worth more ' +
      'than the shot it replaced. An accidental one is just the film stopping.',
  },
  silence: {
    id: 'short.silence',
    rule: 'Silence is a tool here, not a default. A pause is short, placed, and doing work.',
    source: 'House rule, from platform retention behaviour',
    authority: 'house',
    enforcement: 'designed_in',
    because:
      'Dead air is a scroll, and a silence budget written for a film somebody chose to watch is ' +
      'dead air by another name. But a micro-pause before a payoff, or a beat of quiet against a ' +
      'dense cut, is one of the few ways this format creates tension at all. The budget is cut ' +
      'hard rather than to nothing.',
  },
  earlyPayoff: {
    id: 'short.early_payoff',
    rule: 'The payoff lands before the last fifth of the film.',
    source: 'House rule, from editorial practice in short form',
    authority: 'house',
    enforcement: 'checked',
    because:
      'A film whose point arrives at the end is a film most of its audience never got to. ' +
      'Landing it earlier and closing on the consequence keeps the people who left with the ' +
      'thing you wanted them to have.',
  },
  captionsComposed: {
    id: 'short.captions_composed',
    rule: 'Captions are part of the composition, inside the safe area, never an overlay bar.',
    source: 'Platform safe-area specifications (Meta Reels, TikTok, YouTube Shorts)',
    authority: 'guidance',
    enforcement: 'checked',
    because:
      'Most feed playback is muted, so the captions are the words — and the bottom and right of ' +
      'a vertical frame belong to the platform’s own interface. A caption laid over that is a ' +
      'caption under a username, and a film that treats it as an afterthought is a film half its ' +
      'audience cannot read.',
  },
  nativeFraming: {
    id: 'short.native_framing',
    rule: 'Composed for the vertical frame, not cropped into it.',
    source: 'Platform specifications (9:16 native delivery)',
    authority: 'guidance',
    enforcement: 'designed_in',
    because:
      'A crop of a landscape master puts the subject off-centre and the safe area under the ' +
      'caption bar. It is the most recognisable sign that nobody cut the film for the place it ' +
      'is playing.',
  },
  notCheap: {
    id: 'short.not_cheap',
    rule: 'Engineered for attention, not decorated for it.',
    source: 'House rule',
    authority: 'house',
    enforcement: 'documented',
    because:
      'A zoom on every beat, a caption on every word and a cut every half second are what the ' +
      'format looks like when somebody has confused retention with noise. The art direction does ' +
      'not get cheaper because the film got shorter; the cutting gets tighter.',
  },
} as const satisfies Record<string, Standard>;

/**
 * The shape a short usually takes.
 *
 * Five beats, as fractions of the runtime. Not a template — the Creative
 * Director may depart from it where the concept genuinely calls for something
 * else, and the best short films in any format break their own shape. It is a
 * default that is right far more often than "the classic structure, faster",
 * which is what the system reached for without it.
 */
export const SHORT_STRUCTURE = [
  {
    id: 'hook',
    title: 'Hook',
    /** Fraction of the runtime this beat occupies, start and end. */
    at: [0, 0.1] as [number, number],
    asks: 'The strongest frame in the film, immediately. Not a set-up for one.',
  },
  {
    id: 'curiosity',
    title: 'Curiosity or problem',
    at: [0.1, 0.3] as [number, number],
    asks: 'Why this matters, or what is wrong. The reason to still be here at three seconds.',
  },
  {
    id: 'escalation',
    title: 'Escalation',
    at: [0.3, 0.62] as [number, number],
    asks: 'It gets better, bigger or worse. Each shot raises what the last one established.',
  },
  {
    id: 'payoff',
    title: 'Payoff',
    at: [0.62, 0.86] as [number, number],
    asks: 'The thing the film promised, delivered while people are still watching.',
  },
  {
    id: 'close',
    title: 'Close',
    at: [0.86, 1] as [number, number],
    asks: 'The mark, and one action — short. Nobody watches a reel for its end card.',
  },
] as const;

export type ShortBeatId = (typeof SHORT_STRUCTURE)[number]['id'];

/** Which structural beat a moment in the film belongs to. */
export function shortBeatAt(fraction: number): ShortBeatId {
  const clamped = Math.min(0.999, Math.max(0, fraction));
  for (const beat of SHORT_STRUCTURE) {
    if (clamped >= beat.at[0] && clamped < beat.at[1]) return beat.id;
  }
  return 'close';
}

/**
 * Seconds. The window the opening has to be interesting in.
 *
 * Deliberately shorter than the three-second hook a classic film works to: by
 * three seconds in a feed the decision has been made, and a film aiming at
 * three is aiming past the moment it needed to land.
 */
export const PATTERN_INTERRUPT_SECONDS = 1.5;

/**
 * Seconds. The longest a frame may hold with nothing happening in it.
 *
 * Not a cutting rhythm and not a ceiling on a shot — a held frame can run
 * much longer than this and be the best thing in the film, provided something
 * is happening: a subject moving, an action inside the frame, type arriving, a
 * sound landing, a composition that has changed from the shot before. This is
 * the window after which a frame where *nothing* is happening stops reading as
 * a held beat and starts reading as a film that has stopped.
 */
export const ATTENTION_RESET_SECONDS = 2;

/**
 * Seconds of deliberate quiet a short may spend.
 *
 * Enough for one micro-pause before a payoff or one beat of contrast against a
 * dense cut; not enough for a film of pauses. A classic film's budget is two
 * to four seconds, which at twenty seconds of runtime is a fifth of the film
 * spent on nothing.
 */
export const SHORT_SILENCE_BUDGET = 0.6;

/** Fraction of the runtime by which the payoff must have landed. */
export const PAYOFF_BY = 0.86;
