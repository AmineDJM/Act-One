import sharp from 'sharp';
import {
  DIRECTION_DIMENSIONS,
  directionDimensions,
  DirectorsVerdict,
  FILM_CUTS,
  FILM_FORMATS,
  GRADE_MEANING,
  newId,
  storyboardDuration,
  weakestDimensions,
  type DirectorsVerdict as Verdict,
  type FilmCut,
  type FilmFormat,
  type QaIssue,
  type Scene,
  type Storyboard,
} from '@act-one/core';
import type { CallContext, LlmProvider } from '@act-one/providers';

/**
 * The director, watching the cut.
 *
 * Everything else in this platform checks whether something is wrong. This is
 * the only thing that asks whether the film is any good, and it exists because
 * a generated launch film does not usually fail — it passes every check and is
 * forgettable, which is a worse outcome and an invisible one.
 *
 * Two decisions make it work rather than flatter.
 *
 * The first is that it sees the whole film at once, as a contact sheet: one
 * frame per shot, in order, labelled with its timecode. A reviewer shown one
 * frame at a time can only say whether that frame is sound, which is what the
 * frame reviewer already does. Rhythm, repetition, a palette that drifts, an
 * ending that does not answer the opening — none of those exist inside a
 * single frame, and all of them are what decides whether a film works.
 *
 * The second is the scale. `competent` is a failing grade, stated as such to
 * the model and stated again in the rubric it is given. A reviewer allowed to
 * say "nothing wrong here" says it almost every time; this one has to name the
 * weakest shot in every cut it sees, including the good ones, and has to name
 * the single change that would move the film up a grade.
 */

function systemPrompt(format: FilmFormat, cut: FilmCut): string {
  const spec = FILM_FORMATS[format];
  const cutSpec = FILM_CUTS[cut];
  return [
    'You are a director reviewing a cut of a launch film for a software company. You have made',
    'hundreds of them and you are known for being difficult in the edit and right about it.',
    '',
    'You are not checking for defects. Somebody else has already measured the contrast, the safe',
    'areas, the shot lengths and the loudness, and they were all fine. Assume the craft is sound.',
    'Your job is the question none of those answer: is this film any good?',
    '',
    'The grades, and what they mean:',
    ...Object.entries(GRADE_MEANING).map(([grade, meaning]) => `- ${grade}: ${meaning}`),
    '',
    'Read that third grade again. Most films you are shown will be competent, and competent is a',
    'fail. A film with nothing wrong and nothing memorable is the normal outcome of this process',
    'and the entire reason you are being asked. Do not round it up because the craft is clean.',
    '',
    `This is a ${spec.title.toLowerCase()}, cut as a ${cutSpec.title.toLowerCase()}: ${cutSpec.aspect}, ${cutSpec.seconds[0]}\u2013${cutSpec.seconds[1]} seconds. ${spec.blurb} ${spec.never}`,
    cutSpec.direction,
    'That was the customer\u2019s decision and it is not yours to review. Judge the film they asked',
    'for, and never grade it down for being that film.',
    '',
    'What you are judging, in the order it decides whether the film works:',
    ...directionDimensions(format, cut).map((dimension) => `- ${dimension.title}: ${dimension.asks}`),
    '',
    'How to write a note:',
    '- Say what is on the screen, then why it does or does not work. "The opening holds a logo for',
    '  1.4 seconds" is a note. "The opening could be stronger" is not.',
    '- Tie it to a time. A note nobody can find is a note nobody can act on.',
    '- Never suggest a change to the brief, the product or the claims. You can only change this',
    '  film: what is on a shot, how long it holds, what order the shots are in, what the words say.',
    '',
    'You must name the weakest shot in the cut. Every cut has one, including the good ones, and',
    '"none of them" is not an answer a director gives. You must also name the single change that',
    'would move this film up one grade — one change, the one that matters most, not a list.',
  ].join('\n');
}

export type DirectorInput = {
  storyboard: Storyboard;
  /** One frame per shot, in order, already labelled. */
  contactSheet: { url: string; shots: { sceneId: string; atSeconds: number }[] };
  /** What the company is and who the film is for. */
  brief: string;
  /** The brand's own register, so the director judges against it and not against taste. */
  tone: string;
  /** Which film this is. Defaults to the one every production was before the choice existed. */
  format?: FilmFormat;
  /** How it is cut. Same default, for the same reason. */
  cut?: FilmCut;
};

export async function reviewCut(
  llm: LlmProvider,
  input: DirectorInput,
  context: CallContext,
): Promise<Verdict> {
  const seconds = storyboardDuration(input.storyboard);
  const shots = input.storyboard.scenes.map((scene, index) => ({
    n: index + 1,
    sceneId: scene.id,
    at: round1(scene.startTime),
    runs: round1(scene.duration),
    purpose: scene.purpose,
    onScreen: scene.onScreenText,
    said: scene.narration,
  }));

  const { value } = await llm.completeJson(
    [
      { role: 'system', content: systemPrompt(input.format ?? 'product_tour', input.cut ?? 'feature') },
      {
        role: 'user',
        content: [
          `A ${seconds.toFixed(0)}-second film. ${input.brief}`,
          `The brand sounds like this: ${input.tone}`,
          '',
          'The contact sheet is one frame per shot, in order, each labelled with its number and',
          'the time it appears. The shot list below gives what each shot runs for, what it is',
          'meant to do, what is written on it and what is said over it.',
          '',
          JSON.stringify(shots, null, 1),
          '',
          'Grade the film and each dimension. Name the weakest shot by its sceneId. Return JSON only.',
        ].join('\n'),
      },
    ],
    {
      schema: DirectorsVerdict,
      schemaName: 'DirectorsVerdict',
      tier: 'deep',
      /*
       * Low, because a verdict has to be comparable across a re-direct. A
       * director who grades the same cut differently on Tuesday cannot tell
       * you whether the change you made helped.
       */
      temperature: 0.2,
      images: [{ url: input.contactSheet.url, detail: 'high' }],
      maxOutputTokens: 3000,
    },
    context,
  );

  // A hallucinated scene id is worse than none: it would send the repair loop
  // at a shot that does not exist.
  const known = new Set(input.storyboard.scenes.map((scene) => scene.id));
  return {
    ...value,
    weakestSceneId: value.weakestSceneId && known.has(value.weakestSceneId) ? value.weakestSceneId : null,
    notes: value.notes.map((note) => ({
      ...note,
      sceneId: note.sceneId && known.has(note.sceneId) ? note.sceneId : null,
    })),
  };
}

/**
 * The film as one image.
 *
 * Tiled in reading order at a size where a shot is still legible, with its
 * number burned into the corner so a note can point at one. Downscaled hard on
 * purpose: this is for judging composition, rhythm and palette, and a reviewer
 * given twelve full-resolution frames starts reading the type instead of
 * watching the film.
 */
export async function buildContactSheet(
  frames: { sceneId: string; atSeconds: number; data: Uint8Array }[],
  options: { tileWidth?: number; columns?: number } = {},
): Promise<{ png: Uint8Array; shots: { sceneId: string; atSeconds: number }[] }> {
  if (frames.length === 0) throw new Error('A contact sheet needs at least one frame.');

  const tileWidth = options.tileWidth ?? 420;
  const columns = options.columns ?? Math.min(4, frames.length);
  const rows = Math.ceil(frames.length / columns);

  const first = await sharp(Buffer.from(frames[0]!.data)).metadata();
  const ratio = (first.height ?? 9) / (first.width ?? 16);
  const tileHeight = Math.round(tileWidth * ratio);
  const gap = 8;
  const width = columns * tileWidth + (columns + 1) * gap;
  const height = rows * tileHeight + (rows + 1) * gap;

  const tiles = await Promise.all(
    frames.map(async (frame, index) => {
      const resized = await sharp(Buffer.from(frame.data))
        .resize(tileWidth, tileHeight, { fit: 'cover' })
        .composite([{ input: Buffer.from(label(index + 1, frame.atSeconds, tileWidth)), top: 0, left: 0 }])
        .png()
        .toBuffer();
      return {
        input: resized,
        left: gap + (index % columns) * (tileWidth + gap),
        top: gap + Math.floor(index / columns) * (tileHeight + gap),
      };
    }),
  );

  const png = await sharp({
    create: { width, height, channels: 3, background: { r: 24, g: 24, b: 28 } },
  })
    .composite(tiles)
    .png()
    .toBuffer();

  return {
    png: new Uint8Array(png),
    shots: frames.map((frame) => ({ sceneId: frame.sceneId, atSeconds: frame.atSeconds })),
  };
}

/** The shot number and its timecode, as an overlay the tile carries. */
function label(n: number, atSeconds: number, tileWidth: number): string {
  const text = `${n} · ${atSeconds.toFixed(1)}s`;
  const size = Math.round(tileWidth * 0.055);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tileWidth}" height="${size * 2}">` +
    `<rect x="0" y="0" width="${Math.round(size * (text.length * 0.62 + 1.2))}" height="${Math.round(size * 1.7)}" fill="rgba(0,0,0,0.72)"/>` +
    `<text x="${Math.round(size * 0.5)}" y="${Math.round(size * 1.2)}" font-family="monospace" font-size="${size}" fill="#ffffff">${text}</text>` +
    '</svg>'
  );
}

/**
 * The verdict as findings the report already knows how to carry.
 *
 * Notes rather than blockers, always. A film the customer has paid for is not
 * withheld over taste — the director's job here is to send one shot back and,
 * failing that, to say plainly what it thinks, which is worth more to the
 * person deciding whether to ship it than a silent pass.
 */
export function verdictIssues(verdict: Verdict): QaIssue[] {
  return weakestDimensions(verdict).map((note) => ({
    id: newId('evt'),
    check: 'direction' as const,
    severity: 'note' as const,
    sceneId: note.sceneId,
    atSeconds: note.atSeconds,
    message: `${titleOf(note.dimension)}: ${note.note}`,
    evidenceAssetId: null,
    confidence: 0.8,
    repair: null,
    detectedBy: 'vision' as const,
  }));
}

/**
 * The one shot to direct again, if any.
 *
 * A director sends back the weakest shot, not the film. Null when the cut
 * passed, or when the weakest shot is one a re-render cannot change: there is
 * no point regenerating a logo lockup because the ending does not land.
 */
export function redirectFor(verdict: Verdict, scenes: readonly Scene[]): { sceneId: string; reason: string } | null {
  if (verdictPassesGrade(verdict.grade)) return null;
  if (!verdict.weakestSceneId) return null;
  const scene = scenes.find((candidate) => candidate.id === verdict.weakestSceneId);
  if (!scene) return null;
  // Only the shots whose content is generated can be directed again. The rest
  // are drawn from the storyboard, and changing them is a revision the
  // customer asks for rather than one we make on their behalf.
  const directable =
    scene.visualType === 'generated_broll' ||
    scene.visualType === 'mixed_media' ||
    scene.visualType === 'cinematic_3d';
  return directable ? { sceneId: scene.id, reason: verdict.weakestReason } : null;
}

function verdictPassesGrade(grade: Verdict['grade']): boolean {
  return grade === 'remarkable' || grade === 'strong';
}

function titleOf(dimension: string): string {
  return DIRECTION_DIMENSIONS.find((entry) => entry.id === dimension)?.title ?? dimension;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
