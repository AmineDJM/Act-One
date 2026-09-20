import React from 'react';
import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion';
import { resolveTokens, type DesignTokens } from '@act-one/design';
import type { AspectRatio, BrandSystem, RenderQuality, SceneGraph } from '@act-one/core';
import { SceneGraphRenderer } from './components/SceneGraphRenderer.tsx';

/**
 * A film made of scene graphs rather than of named recipes.
 *
 * The second door. `Film.tsx` takes a storyboard and renders each scene
 * through the branch its recipe names; this takes graphs and renders each one
 * through the primitives it is made of. They coexist deliberately — the
 * recipes carry real films and are not going to be broken to prove a point,
 * and the macros in the core compiler are the bridge between them.
 *
 * Scenes are laid end to end on one clock, which is the same editorial model
 * the storyboard has always had. What is new is that the contents of a scene
 * are no longer drawn from a fixed list.
 */

export type SceneGraphFilmProps = {
  scenes: SceneGraph[];
  brand: BrandSystem;
  assetUrls: Record<string, string>;
  /**
   * The film's canvas, when the director has chosen one.
   *
   * `auto` asks the brand, and the brand's answer is dark for every visual
   * style except editorial and playful — which is most brands, and which is
   * the single line responsible for Act One's films all arriving on a
   * near-black field. That default is right for a brand nobody has looked at
   * and wrong as a thing a director cannot override.
   *
   * A scene graph is the level where a director HAS looked, so the choice
   * belongs here rather than in a fallback three packages away.
   */
  theme?: 'dark' | 'light' | 'auto';
};

export const SceneGraphFilm: React.FC<SceneGraphFilmProps> = ({ scenes, brand, assetUrls, theme }) => {
  const { fps, width, height } = useVideoConfig();
  const aspect: AspectRatio = aspectOf(width, height);
  const quality: RenderQuality = width >= 3000 ? 'uhd' : width >= 1500 ? 'hd' : 'preview';
  const tokens: DesignTokens = React.useMemo(
    () => resolveTokens(brand, { aspect, quality, theme: theme ?? 'auto' }),
    [brand, aspect, quality, theme],
  );

  let elapsed = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: tokens.canvas }}>
      {scenes.map((scene) => {
        const from = Math.round(elapsed * fps);
        const duration = Math.max(1, Math.round(scene.durationSeconds * fps));
        elapsed += scene.durationSeconds;
        return (
          <Sequence key={scene.id} from={from} durationInFrames={duration} name={scene.id}>
            <SceneGraphRenderer scene={scene} tokens={tokens} assetUrls={assetUrls} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

/** The delivery aspect nearest these dimensions. */
function aspectOf(width: number, height: number): AspectRatio {
  const ratio = width / height;
  if (ratio > 1.4) return '16:9';
  if (ratio < 0.62) return '9:16';
  if (ratio < 0.9) return '4:5';
  return '1:1';
}

export function sceneGraphDurationInFrames(scenes: readonly SceneGraph[], fps: number): number {
  const seconds = scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  return Math.max(1, Math.round(seconds * fps));
}
