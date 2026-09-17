import React from 'react';
import { Composition, continueRender, delayRender, registerRoot } from 'remotion';
// Side-effectful: injects @font-face rules and bundles the woff2 files.
import './fonts.ts';
import { waitForFonts } from './fonts.ts';
import { ASPECT_DIMENSIONS, DEFAULT_FPS, dimensionsFor, type AspectRatio, type RenderQuality } from '@act-one/core';
import { Film } from './Film.tsx';
import { compositionId, filmDurationInFrames, type FilmProps } from './composition.ts';
import { PLACEHOLDER_FILM_PROPS } from './placeholder.ts';

/**
 * Remotion entry point.
 *
 * One composition per aspect ratio rather than one per film: the film itself is
 * entirely input props, so the render worker selects an aspect and hands over a
 * storyboard. This is also what the Remotion Studio opens for previewing scenes
 * during development.
 */
const ASPECTS: AspectRatio[] = ['16:9', '9:16', '1:1', '4:5'];

export const RemotionRoot: React.FC = () => {
  // Frame 0 renders the moment this mounts. Without the handle, a film's
  // opening frames can be set in the fallback face even though the fonts are
  // bundled and about to be ready.
  const [handle] = React.useState(() => delayRender('Loading bundled fonts'));
  React.useEffect(() => {
    let cancelled = false;
    void waitForFonts().then(() => {
      if (!cancelled) continueRender(handle);
    });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  return (
    <>
    {ASPECTS.map((aspect) => {
      const { width, height } = ASPECT_DIMENSIONS[aspect];
      return (
        <Composition
          key={aspect}
          id={compositionId(aspect)}
          component={Film as React.FC<Record<string, unknown>>}
          durationInFrames={filmDurationInFrames(PLACEHOLDER_FILM_PROPS.storyboard, DEFAULT_FPS)}
          fps={DEFAULT_FPS}
          width={width}
          height={height}
          defaultProps={PLACEHOLDER_FILM_PROPS as unknown as Record<string, unknown>}
          calculateMetadata={({ props }) => {
            const typed = props as unknown as FilmProps;
            return {
              durationInFrames: filmDurationInFrames(typed.storyboard, DEFAULT_FPS),
            };
          }}
        />
      );
    })}
    </>
  );
};

registerRoot(RemotionRoot);
