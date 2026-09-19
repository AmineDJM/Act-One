import { z } from 'zod';
import { nonEmpty } from '../zod-helpers.ts';

/**
 * What a director says about a finished cut.
 *
 * Every other check in this system asks whether something is wrong. Contrast
 * below a floor, a line too long to read, a shot too short to register, a
 * warped interface. All of them are necessary and none of them can tell the
 * difference between a film that is correct and a film that is good, because
 * the failure mode of a generated launch film is not a defect. It is that
 * nothing is wrong with it and nobody remembers it.
 *
 * So this is the one judgement in the platform with no arithmetic behind it,
 * and the only defence against it becoming a rubber stamp is the shape of the
 * scale. `competent` is a failing grade. A film with nothing wrong and nothing
 * memorable is exactly the film this is looking for, and calling that a pass
 * would make the whole exercise decoration.
 */

/**
 * The grades, in order.
 *
 * Deliberately not a score out of ten. A number invites a model to sit at
 * seven, which means nothing and cannot be argued with; a named grade with a
 * stated meaning has to be chosen.
 */
export const FilmGrade = z.enum(['remarkable', 'strong', 'competent', 'weak']);
export type FilmGrade = z.infer<typeof FilmGrade>;

export const GRADE_MEANING: Record<FilmGrade, string> = {
  remarkable:
    'Somebody would send this to a colleague without being asked to. It does something a ' +
    'template could not, and you could describe that thing in one sentence.',
  strong:
    'A studio would put its name on it. Every choice looks like a choice, and the film argues ' +
    'one thing from the first frame to the last.',
  competent:
    'Nothing is wrong with it and nothing is memorable. It would pass every check in this ' +
    'system and it would not be watched twice. This is a failing grade.',
  weak: 'It reads as generated: assembled from parts, arguing nothing, or wearing its template.',
};

/** Where the bar is. Below this a film goes back, not out. */
export const PASSING_GRADES: readonly FilmGrade[] = ['remarkable', 'strong'];

export function gradePasses(grade: FilmGrade): boolean {
  return PASSING_GRADES.includes(grade);
}

/**
 * The things a director actually looks at.
 *
 * Not a list of everything that could be judged — a list of what decides
 * whether a launch film works, in the order it decides it. Each is graded on
 * its own, because a film with a dead opening and a superb ending is a film
 * nobody saw the ending of, and one number would hide that.
 */
export const DIRECTION_DIMENSIONS = [
  {
    id: 'hook',
    title: 'The first two seconds',
    asks: 'Does the opening earn the next ten, for somebody who did not choose to watch it?',
    /*
     * In a feed the question is not whether the opening earns the film — it is
     * whether there is a film at all after one second. A build, a title card,
     * a logo: each is a frame spent, and the viewer has already gone.
     */
    asksOfAShort:
      'Is the strongest thing in the film in the first second, or does the film build towards it ' +
      'while the viewer scrolls away?',
  },
  {
    id: 'argument',
    title: 'One thing, said once',
    asks: 'Does the film argue a single idea, or list features and hope one lands?',
    asksOfAShort:
      'Does every shot earn its place? At this length a beat that is only texture is a beat ' +
      'that cost you a viewer.',
  },
  {
    id: 'product',
    title: 'The product, working',
    asks: 'Is the product seen doing the thing, or only described while something else is on screen?',
    /*
     * The one dimension the format changes.
     *
     * "Is the product seen working?" is unanswerable in a film that was asked
     * not to show it, and a director handed an unanswerable question answers
     * it badly — it grades the absence of the product as the film's weakness,
     * which is the customer's own decision, and then the re-direct sends back
     * a shot for being exactly what it was meant to be.
     *
     * The question a pitch actually has to survive is the harder one anyway:
     * a film that cannot demonstrate has to make you believe by other means,
     * and most of them do not.
     */
    asksOfAPitch:
      'This film argues rather than demonstrates. Does it make the thing real — a picture, a ' +
      'figure, one well-placed look at it — or does it only assert? And if it does cut to the ' +
      'product, is that a cutaway the story earned, or has it quietly become a walkthrough?',
  },
  {
    id: 'rhythm',
    title: 'The cut',
    asks: 'Do the shot lengths follow the argument, or is every shot the same length as the last?',
    asksOfAShort:
      'Does this move at the speed of the feed it is in, or does it hold shots like a film ' +
      'somebody chose to watch?',
  },
  {
    id: 'sound_off',
    title: 'Watched with the sound off',
    asks: 'Would this still work muted, for the many who watch it that way?',
    asksOfAShort:
      'The sound is off. Does every beat carry its meaning in the picture and the words on it, ' +
      'or are there shots that mean nothing without the voice?',
  },
  {
    id: 'ending',
    title: 'The last two seconds',
    asks: 'Does the film land, or does it stop because it ran out of scenes?',
    asksOfAShort:
      'Does the payoff arrive while people are still watching, and does the film close rather ' +
      'than trail off into an end card nobody stayed for?',
  },
  {
    id: 'image',
    title: 'One frame worth remembering',
    asks: 'Is there a single image somebody could describe a week later?',
  },
  {
    id: 'cohesion',
    title: 'One film',
    asks: 'Does this read as one piece, or as slides with transitions between them?',
  },
] as const;

export type DimensionId = (typeof DIRECTION_DIMENSIONS)[number]['id'];

export type DirectionDimension = {
  id: DimensionId;
  title: string;
  asks: string;
};

/**
 * The rubric for one kind of film.
 *
 * Every dimension is asked of both formats; one of them is asked differently,
 * because the question that decides whether a product tour works is not the
 * question that decides whether a pitch does.
 */
export function directionDimensions(
  format: 'product_tour' | 'pitch' = 'product_tour',
  cut: 'feature' | 'short' = 'feature',
): DirectionDimension[] {
  return DIRECTION_DIMENSIONS.map((dimension) => ({
    id: dimension.id,
    title: dimension.title,
    /*
     * The cut asks first, because it changes the viewing: a hook question
     * written for somebody sitting down to watch is the wrong question for a
     * feed whatever the film is about. The format then changes what the film
     * is allowed to show.
     */
    asks:
      cut === 'short' && 'asksOfAShort' in dimension
        ? dimension.asksOfAShort
        : format === 'pitch' && 'asksOfAPitch' in dimension
          ? dimension.asksOfAPitch
          : dimension.asks,
  }));
}

export const DimensionId = z.enum(
  DIRECTION_DIMENSIONS.map((dimension) => dimension.id) as unknown as [DimensionId, ...DimensionId[]],
);

export const DirectionNote = z.object({
  dimension: DimensionId,
  grade: FilmGrade,
  /** What is actually on screen, and why it does or does not work. */
  note: nonEmpty(400),
  /** Seconds into the film. Null when the note is about the whole piece. */
  atSeconds: z.number().min(0).nullable().default(null),
  sceneId: z.string().nullable().default(null),
});
export type DirectionNote = z.infer<typeof DirectionNote>;

export const DirectorsVerdict = z.object({
  grade: FilmGrade,
  /** One sentence. What this film is, as somebody who just watched it would say. */
  summary: nonEmpty(300),
  notes: z.array(DirectionNote).min(1).max(12),
  /**
   * The weakest shot, always named.
   *
   * Required, and required even when the film is good: a director asked for
   * the weakest shot in a strong cut names one, and a reviewer that can answer
   * "none" will answer "none" almost every time.
   */
  weakestSceneId: z.string().nullable().default(null),
  weakestReason: nonEmpty(300),
  /**
   * What would move it up a grade. One change, not a list.
   *
   * The test of whether a note is worth anything: it has to be actionable by
   * somebody who can only change this film, not the brief behind it.
   */
  oneChange: nonEmpty(300),
});
export type DirectorsVerdict = z.infer<typeof DirectorsVerdict>;

/** Whether this cut goes out, by the director's grade alone. */
export function verdictPasses(verdict: Pick<DirectorsVerdict, 'grade'>): boolean {
  return gradePasses(verdict.grade);
}

/**
 * The dimensions that came back failing, worst first.
 *
 * What the re-direct works from: a film goes back for the thing that is most
 * wrong with it, not for everything at once.
 */
export function weakestDimensions(verdict: DirectorsVerdict): DirectionNote[] {
  const rank: Record<FilmGrade, number> = { weak: 0, competent: 1, strong: 2, remarkable: 3 };
  return verdict.notes
    .filter((note) => !gradePasses(note.grade))
    .sort((left, right) => rank[left.grade] - rank[right.grade]);
}
