import { Storyboard, Scene, type SceneGraph } from '@act-one/core';
import { directSound, type SoundDesign, type SoundDirectionInput } from './sound-director.ts';

/**
 * Sound for a scene graph.
 *
 * FOUND BY A MODEL WATCHING THE FILM. Three creative directions were rendered,
 * inspected, measured and reviewed frame by frame, and every one of them
 * shipped silent. Nobody noticed, because a contact sheet has no sound and a
 * structural check has no ears. The first thing a video model said about the
 * first cut it was shown was "no audio present; sync and sound design cannot
 * be evaluated" — which is also the reason the film could not be judged
 * against a benchmark, since half of what a launch film does is audible.
 *
 * The scene language always carried the intent. Every scene declares its
 * `audio` — an impact where a word lands, a riser under a push, a sting on the
 * mark — with a `causedBy` naming the object responsible. What it never had
 * was anything that read those events. The sound director, the library, the
 * ducking, the loudness targets and the cue placement all existed and all took
 * a `Storyboard`, which is the older representation a scene graph replaced.
 *
 * So this is a translation, not a second sound system. Writing a parallel
 * mixer for the new representation would have duplicated every decision in the
 * old one — how long a riser leads its landing, how many UI clicks stop being
 * rhythm and start being a tutorial, what a film opening on silence does — and
 * the copy would have been the worse of the two within a month.
 */

export type SceneSoundOptions = {
  behaviour: SoundDirectionInput['behaviour'];
  channel?: SoundDirectionInput['channel'];
  library?: SoundDirectionInput['library'];
  hasVoiceOver?: boolean;
};

/**
 * Scene-graph cue kinds that the storyboard vocabulary does not have a word for.
 *
 * `ui_confirm` is the only one, and it maps to a click rather than being
 * dropped: an affirmative click is still a click, and silence would be a worse
 * answer than an approximate sound.
 */
const CUE_KIND: Record<string, string> = {
  impact: 'impact',
  whoosh: 'whoosh',
  riser: 'riser',
  sub_drop: 'sub_drop',
  ui_click: 'ui_click',
  ui_confirm: 'ui_click',
  logo_sting: 'logo_sting',
  texture: 'texture',
  music_duck: 'music_duck',
};

export function soundForScenes(scenes: SceneGraph[], options: SceneSoundOptions): SoundDesign {
  const now = new Date().toISOString();

  let elapsed = 0;
  const storyboardScenes = scenes.map((scene, index) => {
    const startTime = elapsed;
    elapsed += scene.durationSeconds;

    return Scene.parse({
      id: scene.id,
      storyboardId: 'stb_scene_graph',
      index,
      startTime,
      duration: scene.durationSeconds,
      purpose: scene.intent.slice(0, 200) || 'A scene of the film.',
      /*
       * Stand-ins, and marked as such.
       *
       * The older representation requires a named motion recipe and a camera
       * recipe on every scene, because in that world a scene WAS a recipe. A
       * scene graph is not one — that is the whole point of it — so there is no
       * honest value to put here. These are the most neutral entries the
       * vocabulary has, and nothing between this function and the mix reads
       * either of them: the sound director works from durations and cues.
       */
      visualType: 'mixed_media',
      motionRecipe: { name: 'hold' },
      cameraRecipe: { move: 'static' },
      soundCues: scene.audio.map((event) => ({
        /*
         * Film-absolute, because that is what a cue is measured in once a film
         * exists. Scene-relative is the right unit while a scene is being
         * written and the wrong one the moment two scenes are cut together.
         */
        time: startTime + event.at,
        type: CUE_KIND[event.kind] ?? 'impact',
        intensity: event.intensity,
      })),
    });
  });

  const storyboard = Storyboard.parse({
    id: 'stb_scene_graph',
    projectId: 'prj_scene_graph',
    conceptId: 'cpt_scene_graph',
    treatmentId: 'trt_scene_graph',
    scenes: storyboardScenes,
    createdAt: now,
    updatedAt: now,
  });

  return directSound({
    storyboard,
    behaviour: options.behaviour,
    ...(options.channel ? { channel: options.channel } : {}),
    ...(options.library ? { library: options.library } : {}),
    ...(options.hasVoiceOver === undefined ? {} : { hasVoiceOver: options.hasVoiceOver }),
  });
}
