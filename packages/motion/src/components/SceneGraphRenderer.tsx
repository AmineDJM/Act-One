import React from 'react';
import {
  AbsoluteFill,
  OffthreadVideo,
  continueRender,
  delayRender,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { contrastRatio, type DesignTokens } from '@act-one/design';
import {
  objectPresent,
  objectProgress,
  valueAt,
  parallaxScale,
  type Animatable,
  type CameraSpec,
  type SceneGraph,
  type SceneObject,
} from '@act-one/core';
import { EASINGS } from '../easing.ts';
import { ElementField, type FieldFigure } from './ElementField.tsx';

/**
 * The executor for the scene language.
 *
 * The recipe renderer next door has a branch per named shot. This has a branch
 * per PRIMITIVE, which is a different kind of list: adding `product_zoom` to
 * the first one is a feature, and everything it can ever draw is already in
 * it. Adding a capture object to this one lets a director compose captures
 * with masks and fields and depth in arrangements nobody has thought of yet.
 *
 * Both exist. A storyboard that names a recipe still renders through the
 * branch that has always rendered it, and a scene that arrives as a graph
 * renders here. The macros in `compile.ts` are the bridge, and the reason
 * neither is going away is that the recipes carry real films today and a
 * migration that breaks them to prove a point is a migration that costs
 * customers their masters.
 *
 * DEPTH IS HONEST. `z` and `focalLengthMm` produce parallax and defocus by
 * scaling and blurring per layer. It is 2.5D, the capability registry says so,
 * and a director who needs real geometry gets the geometry executor instead of
 * an approximation dressed up as a camera.
 */

export type SceneGraphRendererProps = {
  scene: SceneGraph;
  tokens: DesignTokens;
  /** Asset id to resolvable URL, as the pipeline resolves them. */
  assetUrls: Record<string, string>;
};

/** Resolves a brand token path like `onCanvas.primary`, or passes a literal through. */
function colorOf(value: string, tokens: DesignTokens): string {
  if (!value.includes('.')) {
    if (value === 'accent') return tokens.accent;
    if (value === 'canvas') return tokens.canvas;
    if (value === 'line') return tokens.line;
    if (value === 'surface') return tokens.surface;
    return value;
  }
  const [group, key] = value.split('.');
  if (group === 'onCanvas') {
    const palette = tokens.onCanvas as unknown as Record<string, string>;
    return palette[key ?? 'primary'] ?? tokens.onCanvas.primary;
  }
  return value;
}

function animColor(
  value: string | { from: string; to: string; curve: keyof typeof EASINGS },
  t: number,
  tokens: DesignTokens,
): string {
  // Colour is not interpolated: a midpoint between two brand colours is a
  // colour the brand does not have. It swaps on the curve's own midpoint,
  // which is what a designer means by a field change.
  if (typeof value === 'string') return colorOf(value, tokens);
  const eased = EASINGS[value.curve]?.(t) ?? t;
  return colorOf(eased < 0.5 ? value.from : value.to, tokens);
}

const num = (property: Animatable, t: number): number => valueAt(property, t, EASINGS);

/**
 * The camera, as one transform over everything.
 *
 * Objects at different `z` are scaled differently by the dolly, which is where
 * parallax comes from; the focal length decides how strongly. A long lens
 * flattens the separation, a wide one exaggerates it, which is the part of a
 * real lens that reads on screen.
 */
function cameraTransform(camera: CameraSpec, t: number): { transform: string } {
  const x = num(camera.x, t);
  const y = num(camera.y, t);
  const scale = num(camera.scale, t);
  const rotation = num(camera.rotationZ, t);
  return {
    transform:
      `translate(${(x * 100).toFixed(4)}%, ${(y * 100).toFixed(4)}%) ` +
      `scale(${scale.toFixed(5)}) rotate(${rotation.toFixed(3)}deg)`,
  };
}

/** How much a layer at depth `z` is moved by the camera's dolly. */
/**
 * The camera's effect on one layer, from the scene language.
 *
 * A thin wrapper rather than a second implementation: the formula lives in
 * core so that QA, which must never import a renderer, reasons about the same
 * frame the renderer draws. Two copies of it drifted once already — QA passed
 * a headline the camera pushed off both edges — and one of them being right is
 * indistinguishable from both being right until somebody watches the film.
 */
function parallax(z: number, camera: CameraSpec, t: number): number {
  return parallaxScale(z, camera, t, EASINGS);
}

/** Defocus by distance from the focal plane, when the camera asks for any. */
function defocusPx(z: number, camera: CameraSpec, t: number): number {
  const aperture = num(camera.depthOfField, t);
  if (aperture <= 0) return 0;
  // Both read on the clock: a focal plane that travels while the aperture
  // opens is a rack focus, which hands attention between depths without a cut.
  const focus = num(camera.focusZ, t);
  return Math.min(24, Math.abs(z - focus) * aperture * 14);
}


/**
 * A region of a capture, at the shape that region actually is.
 *
 * THE BUG THIS REPLACES was one line: `aspectRatio: crop.width / crop.height`.
 * Those are fractions OF THE SOURCE, so a crop covering the whole of a
 * 1580x680 capture computed 1/1 and the browser drew a square. The image
 * inside was then scaled to fill it, which magnified the interface by more
 * than two and pushed most of it off the frame — the product shot came out as
 * a band of body copy with the headline cut off above it, and the same error
 * was quietly distorting every capture in every scene-graph film by whatever
 * the source aspect happened to be.
 *
 * The region's shape is `(crop.width x sourceWidth) / (crop.height x
 * sourceHeight)`, and the source's dimensions are the part no stylesheet
 * knows. So the image is loaded and measured, and the frame is held open with
 * `delayRender` while that happens. That is what `delayRender` is for: a
 * headless render screenshots whenever the page says it is ready, and a frame
 * that reports ready before its picture has a size is a frame with the wrong
 * picture in it.
 *
 * Falls back to the crop's own ratio if the image cannot be measured, which is
 * the old behaviour — wrong, but no worse than it was, and it renders.
 */
const CroppedImage: React.FC<{
  src: string;
  widthPx: number;
  crop: { x: number; y: number; width: number; height: number };
  radiusPx: number;
  shadow: string | null;
  chrome: { line: string; surface: string } | null;
}> = ({ src, widthPx, crop, radiusPx, shadow, chrome }) => {
  const [natural, setNatural] = React.useState<{ width: number; height: number } | null>(null);
  const [handle] = React.useState(() => delayRender(`Measuring ${src}`));

  React.useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      setNatural({ width: image.naturalWidth, height: image.naturalHeight });
      continueRender(handle);
    };
    image.onerror = () => {
      // Continue rather than hang. A missing asset is a QA problem, and a
      // render that never finishes is a worse way to report it than a frame
      // with a gap in it.
      if (!cancelled) continueRender(handle);
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, handle]);

  const sourceAspect = natural ? natural.width / natural.height : null;
  const aspect = sourceAspect
    ? (crop.width * sourceAspect) / crop.height
    : crop.width / crop.height;

  return (
    <div
      style={{
        width: widthPx,
        aspectRatio: `${aspect}`,
        overflow: 'hidden',
        borderRadius: radiusPx,
        boxShadow: shadow ?? 'none',
        ...(chrome ? { border: `1px solid ${chrome.line}`, background: chrome.surface } : {}),
      }}
    >
      <img
        src={src}
        alt=""
        style={{
          width: `${100 / crop.width}%`,
          marginLeft: `${(-crop.x * 100) / crop.width}%`,
          marginTop: `${(-crop.y * 100) / crop.height}%`,
          display: 'block',
        }}
      />
    </div>
  );
};

export const SceneGraphRenderer: React.FC<SceneGraphRendererProps> = ({
  scene,
  tokens: filmTokens,
  assetUrls,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;
  const sceneT = Math.min(1, seconds / Math.max(0.0001, scene.durationSeconds));

  // Resolved against the film's own tokens, because the scene's set is derived
  // from this value and cannot be used to compute it.
  const background =
    scene.background === 'canvas'
      ? filmTokens.canvas
      : animColor(scene.background, sceneT, filmTokens);

  /*
   * A scene that inverts its background inverts what reads on it.
   *
   * `onCanvas.primary` is the film's reading colour, decided once from the
   * film's theme. A scene is free to set its own background, and an editorial
   * cut does exactly that — paper, paper, paper, then ink for the mark. What
   * happened then was that the mark kept the light theme's reading colour and
   * came out as near-black type on a near-black field: present in the DOM,
   * passing every check, and invisible on screen. The film's last shot was its
   * own name, and you could not see it.
   *
   * So the on-canvas set is chosen against the background this scene actually
   * has, not against the one the film started with. Measured by contrast
   * rather than by a theme flag, because the question is only ever "can this
   * be read on that" and a hex the author picked has no theme.
   */
  const tokens = React.useMemo(() => {
    if (contrastRatio(filmTokens.onCanvas.primary, background) >= 4.5) return filmTokens;
    const flipped = {
      primary: filmTokens.canvas,
      secondary: filmTokens.canvas,
      muted: filmTokens.onCanvas.muted,
      accent: filmTokens.onCanvas.accent,
    };
    // Only swap when the swap is actually better; a mid-grey background can
    // fail both ways, and a worse colour is not an improvement.
    return contrastRatio(flipped.primary, background) >
      contrastRatio(filmTokens.onCanvas.primary, background)
      ? { ...filmTokens, onCanvas: { ...filmTokens.onCanvas, ...flipped } }
      : filmTokens;
  }, [filmTokens, background]);

  /*
   * Masks are resolved to the objects they act on before anything draws.
   *
   * They are referential rather than nested, so the pass that applies them has
   * to happen here: an object names nothing, and a mask names what it covers.
   */
  const maskedBy = new Map<string, SceneObject & { kind: 'mask' }>();
  for (const object of scene.objects) {
    if (object.kind !== 'mask') continue;
    for (const target of object.masks) maskedBy.set(target, object);
  }

  // Painter's order: furthest first, so `z` orders the frame as well as
  // separating it.
  const drawable = scene.objects
    .filter((object) => object.kind !== 'mask')
    .filter((object) => objectPresent(object, seconds, scene.durationSeconds))
    .sort((a, b) => num(b.transform.z, 0) - num(a.transform.z, 0));

  return (
    <AbsoluteFill style={{ backgroundColor: background }}>
      <AbsoluteFill
        style={{
          ...cameraTransform(scene.camera, sceneT),
          /*
           * A vanishing point, without which 3D rotation is a squash.
           *
           * `rotationX` and `rotationY` have been in the language since it was
           * written and the renderer has always applied them — into a flat
           * container, where `rotateY(20deg)` makes an element NARROWER and
           * nothing else. No near edge, no far edge, no foreshortening. Every
           * reference film we are asked to match floats cards in real space,
           * and the reason this one could not was one missing property.
           *
           * Tied to the lens rather than picked: a 35mm frame is 36mm wide, so
           * the distance that reproduces a given focal length is the frame's
           * width scaled by `focalLength / 36`. A long lens flattens the
           * perspective and a wide one exaggerates it, which is what those
           * numbers mean everywhere else in the language.
           *
           * On the camera container so every layer shares one vanishing point.
           * Per-object perspective gives each card its own vanishing point,
           * which is what makes a group of them look like stickers rather than
           * like objects in a room.
           */
          perspective: tokens.frame.width * (num(scene.camera.focalLengthMm, sceneT) / 36),
          perspectiveOrigin: '50% 50%',
          transformStyle: 'preserve-3d',
          willChange: 'transform',
        }}
      >
        {drawable.map((object) => {
          const t = objectProgress(object, seconds, scene.durationSeconds);
          const z = num(object.transform.z, t);
          const depthScale = parallax(z, scene.camera, sceneT);
          const blur = num(object.transform.blurPx, t) + defocusPx(z, scene.camera, sceneT);

          /*
           * Depth moves a layer, it does not only resize it.
           *
           * The first version applied the parallax factor to scale alone, and
           * an integration test measuring how far two depths travelled under
           * one dolly found both of them travelling essentially zero. The
           * reason is that a CSS scale grows an element around its own centre:
           * the layer got bigger and stayed exactly where it was, so two
           * objects at opposite depths separated in size and never in space.
           *
           * Parallax is displacement. A layer's distance from the centre of
           * the frame grows with the dolly in proportion to its depth, which
           * is why near things sweep past and far things barely move.
           */
          const px = 0.5 + (num(object.transform.x, t) - 0.5) * depthScale;
          const py = 0.5 + (num(object.transform.y, t) - 0.5) * depthScale;

          const style: React.CSSProperties = {
            position: 'absolute',
            left: `${px * 100}%`,
            top: `${py * 100}%`,
            opacity: Math.max(0, Math.min(1, num(object.transform.opacity, t))),
            /*
             * The anchor is where the transform is applied FROM, and it was
             * only being used to place the object.
             *
             * `anchor` translates the element so the named point sits at
             * `x, y` — correct. But `transform-origin` was left at its default
             * of 50% 50%, so scale and rotation still happened around the
             * element's centre. An object anchored at its left edge and scaled
             * up therefore grew leftwards THROUGH its own anchor: a headline
             * pinned to the page margin at 1.7x ran off the left of the frame
             * while every check, reasoning from the schema's definition, put
             * it comfortably inside.
             *
             * The schema says "where the transform is applied from". This is
             * what makes that sentence true.
             */
            transformOrigin: `${object.transform.anchor.x * 100}% ${object.transform.anchor.y * 100}%`,
            transform:
              `translate(${-object.transform.anchor.x * 100}%, ${-object.transform.anchor.y * 100}%) ` +
              `scale(${(num(object.transform.scale, t) * depthScale).toFixed(5)}) ` +
              `rotateX(${num(object.transform.rotationX, t).toFixed(2)}deg) ` +
              `rotateY(${num(object.transform.rotationY, t).toFixed(2)}deg) ` +
              `rotate(${num(object.transform.rotationZ, t).toFixed(2)}deg)`,
            ...(blur > 0.05 ? { filter: `blur(${blur.toFixed(2)}px)` } : {}),
            willChange: 'transform, opacity',
          };

          const mask = maskedBy.get(object.id);
          const clipPath = mask ? clipPathFor(mask, seconds, scene) : undefined;
          const wrapped = (children: React.ReactNode) => (
            <div key={object.id} style={{ ...style, ...(clipPath ? { clipPath } : {}) }}>
              {children}
            </div>
          );

          switch (object.kind) {
            case 'text': {
              const token = tokens.type[object.token];
              return wrapped(
                <div
                  style={{
                    fontFamily: token.family,
                    fontWeight: token.weight,
                    fontSize: token.sizePx,
                    lineHeight:
                      object.lineHeight === undefined
                        ? token.lineHeight
                        : num(object.lineHeight, t),
                    letterSpacing: `${num(object.tracking ?? token.tracking, t)}em`,
                    textAlign: object.align,
                    width: tokens.frame.width * object.maxWidth,
                    whiteSpace: 'pre-wrap',
                    ...textTreatment(object, t, tokens),
                  }}
                >
                  {object.staggerBy === 'none' || object.staggerSeconds <= 0
                    ? spannedText(object, t, tokens)
                    : staggeredText(object, seconds, t, tokens)}
                </div>,
              );
            }

            case 'shape': {
              const width = num(object.width, t) * tokens.frame.width;
              const height = num(object.height, t) * tokens.frame.height;
              return wrapped(
                <div
                  style={{
                    width: object.shape === 'line' ? width : width,
                    height:
                      object.shape === 'line' ? Math.max(1, num(object.strokeWidthPx, t)) : height,
                    backgroundColor:
                      object.shape === 'line'
                        ? animColor(object.stroke, t, tokens)
                        : animColor(object.fill, t, tokens),
                    border:
                      object.shape === 'line'
                        ? 'none'
                        : `${num(object.strokeWidthPx, t)}px solid ${animColor(object.stroke, t, tokens)}`,
                    borderRadius:
                      object.shape === 'ellipse' ? '50%' : num(object.cornerRadiusPx, t),
                  }}
                />,
              );
            }

            case 'capture':
            case 'ui_layer':
            case 'image': {
              const url = assetUrls[object.assetId];
              if (!url) return null;
              const width = num(object.width, t) * tokens.frame.width;
              // A crop on the clock is a camera inside the capture: the frame
              // travels across the interface rather than the picture sliding.
              const source = object.crop ?? { x: 0, y: 0, width: 1, height: 1 };
              const crop = {
                x: num(source.x, t),
                y: num(source.y, t),
                width: Math.max(0.01, num(source.width, t)),
                height: Math.max(0.01, num(source.height, t)),
              };
              return wrapped(
                <CroppedImage
                  src={url}
                  widthPx={width}
                  crop={crop}
                  radiusPx={'cornerRadiusPx' in object ? num(object.cornerRadiusPx, t) : 0}
                  shadow={
                    'shadow' in object && object.shadow && tokens.shadow ? tokens.shadow.soft : null
                  }
                  chrome={
                    object.kind === 'capture' && object.chrome
                      ? { line: tokens.line, surface: tokens.surface }
                      : null
                  }
                />,
              );
            }

            case 'gradient': {
              const from = animColor(object.from, t, tokens);
              const to = animColor(object.to, t, tokens);
              /*
               * A radial gradient is a light, not a background.
               *
               * Sized in percent of the element rather than pixels so the same
               * scene lights identically at preview and at master resolution —
               * a source measured in pixels moves relative to the frame the
               * moment the frame changes size.
               */
              const background =
                object.shape === 'radial'
                  ? `radial-gradient(circle at ${(num(object.centre.x, t) * 100).toFixed(2)}% ${(num(object.centre.y, t) * 100).toFixed(2)}%, ` +
                    `${from} 0%, ${to} ${(num(object.radius, t) * 100).toFixed(1)}%)`
                  : `linear-gradient(${num(object.angleDeg, t)}deg, ${from}, ${to})`;
              return wrapped(
                <div style={{ width: tokens.frame.width, height: tokens.frame.height, background }} />,
              );
            }

            case 'field':
              // The field owns its own layout and clock; the graph gives it its
              // figure, its count and the area it must keep clear.
              return (
                <ElementField
                  key={object.id}
                  figure={object.figure as FieldFigure}
                  count={object.count}
                  tokens={tokens}
                  durationSeconds={scene.durationSeconds}
                  easing="out_cubic"
                  staggerSeconds={object.staggerSeconds}
                  delaySeconds={object.enterAt}
                  seed={object.seed}
                  {...(object.clearZone ? { clearZone: object.clearZone } : {})}
                />
              );

            case 'clip': {
              const url = assetUrls[object.assetId];
              if (!url) return null;
              /*
               * OffthreadVideo, because a raw <video> does not play in a render.
               *
               * The browser's own element gives whatever it has decoded by the
               * time the screenshot is taken, which in a headless render is a
               * different frame each run and very often the first one. So the
               * scene language could declare a clip, the router would route it,
               * QA would pass it, and the film would come out with a frozen
               * still where the only moving footage in it was supposed to be.
               * The older recipe path already knew this; the scene graph path
               * was written with a plain tag and never had footage put through
               * it to find out.
               *
               * `sourceInSeconds` and `playbackRate` are the clip's own, so a
               * shot can start partway into a take and run slower than life,
               * which is most of what makes four generated seconds usable.
               */
              return wrapped(
                <OffthreadVideo
                  src={url}
                  muted
                  pauseWhenBuffering
                  startFrom={Math.round(object.sourceInSeconds * fps)}
                  playbackRate={object.playbackRate}
                  style={{
                    width: num(object.width, t) * tokens.frame.width,
                    display: 'block',
                    objectFit: 'cover',
                  }}
                />,
              );
            }

            /*
             * A light with no lighting model is nothing, deliberately.
             *
             * The browser compositor does not light a scene. Drawing a glow to
             * stand in for one would be the renderer inventing a look the
             * director did not ask for; the router already refuses a light that
             * no executor can honour, so reaching here at all means somebody
             * allowed it explicitly.
             */
            case 'light':
              return null;

            case 'particles':
              return wrapped(<Particles object={object} tokens={tokens} seconds={seconds} />);

            /*
             * Geometry is not drawn here.
             *
             * A 3D object arrives already rendered, as frames the geometry
             * executor produced. Drawing a placeholder would be the renderer
             * inventing a shot, which is the one thing it must never do — so
             * an unrendered 3D object is nothing, and the routing said so
             * before anybody got here.
             */
            case 'three_d':
              return null;

            default:
              return null;
          }
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * Particles: material in the air, not a simulation.
 *
 * Deterministic from the seed, because a film that cannot be re-rendered
 * identically cannot be repaired — a fix to one shot would quietly change
 * every other. Four behaviours and nothing else; the thing that makes a
 * particle system a tell is that it looks like one.
 */
const Particles: React.FC<{
  object: SceneObject & { kind: 'particles' };
  tokens: DesignTokens;
  seconds: number;
}> = ({ object, tokens, seconds }) => {
  const points = React.useMemo(() => {
    let state = (object.seed * 2654435761) % 4294967296 || 1;
    const next = () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
    return Array.from({ length: object.count }, () => ({
      x: next(),
      y: next(),
      phase: next(),
      drift: next() - 0.5,
    }));
  }, [object.seed, object.count]);

  const colour = colorOf(
    typeof object.color === 'string' ? object.color : object.color.from,
    tokens,
  );
  const life = object.lifetimeSeconds;

  return (
    <div style={{ width: tokens.frame.width, height: tokens.frame.height, position: 'relative' }}>
      {points.map((point, index) => {
        const local = ((seconds - object.enterAt) / life + point.phase) % 1;
        if (local < 0) return null;
        let x = point.x;
        let y = point.y;
        let opacity = 1;

        switch (object.behaviour) {
          case 'drift':
            x = (point.x + point.drift * 0.08 * local + 1) % 1;
            y = (point.y + local * 0.04) % 1;
            opacity = Math.sin(local * Math.PI);
            break;
          case 'settle':
            y = point.y + (1 - local) * -0.2;
            opacity = Math.min(1, local * 3);
            break;
          case 'burst':
            x = 0.5 + (point.x - 0.5) * local * 2;
            y = 0.5 + (point.y - 0.5) * local * 2;
            opacity = 1 - local;
            break;
          case 'rise':
            y = point.y - local * 0.5;
            opacity = Math.sin(local * Math.PI);
            break;
        }

        return (
          <div
            key={index}
            style={{
              position: 'absolute',
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              width: object.sizePx,
              height: object.sizePx,
              borderRadius: '50%',
              backgroundColor: colour,
              opacity: Math.max(0, Math.min(1, opacity)) * 0.5,
            }}
          />
        );
      })}
    </div>
  );
};

/** Words arriving one after another, on the object's own stagger. */
/**
 * The style a character at this position carries, from the object's spans.
 *
 * Built once per line as a lookup by character index, because the two things
 * that decorate a line — spans and the stagger — cut it in different places.
 * Spans are runs of characters chosen by a director; the stagger splits on
 * words. Rendering one inside the other would make the emphasis jump to the
 * nearest word boundary, so both are resolved against the same coordinate: the
 * index of the character in `content`.
 */

/**
 * Fill, outline and glow for a line of type.
 *
 * ORDER MATTERS AND IS NOT OBVIOUS. A gradient fill is painted by clipping a
 * background to the glyphs, which requires `color: transparent` — so anything
 * that also wants to set a colour has to come after it, and a stroke that
 * knocks out the fill has to survive both. The sequence below is the one that
 * composes: colour first, gradient over it, stroke last, glow on top of
 * whatever resulted.
 *
 * `paint-order: stroke fill` rather than the default, because a stroke drawn
 * over its own glyph eats half its weight from the inside and a 2px outline
 * reads as 1px. This is the difference between an outline that looks drawn and
 * one that looks like a rendering artefact.
 */
function textTreatment(
  object: SceneObject & { kind: 'text' },
  t: number,
  tokens: DesignTokens,
): React.CSSProperties {
  const { gradient, stroke, glow } = object.treatment;
  const style: React.CSSProperties = { color: animColor(object.color, t, tokens) };

  if (gradient) {
    const from = colorOf(gradient.from, tokens);
    const to = colorOf(gradient.to, tokens);
    style.backgroundImage = `linear-gradient(${num(gradient.angleDeg, t).toFixed(1)}deg, ${from}, ${to})`;
    /*
     * Clipped to the glyphs AND shrink-wrapped to them.
     *
     * `background-clip: text` clips the background to the letters, but the
     * background still spans the element's box — which is the WRAP WIDTH, not
     * the width of the words. A short number inside a wide box therefore sits
     * in one narrow slice of the sweep and comes out looking like a flat
     * colour, which is exactly what the first render of this showed: a "3-5x"
     * that was supposed to run orange to amber and was uniformly orange.
     *
     * `width: fit-content` makes the box the text, so the gradient spans what
     * you can actually see. The alignment has to be re-applied with a margin,
     * because a shrink-wrapped box no longer has room to align inside.
     */
    style.backgroundClip = 'text';
    style.WebkitBackgroundClip = 'text';
    style.color = 'transparent';
    style.width = 'fit-content';
    style.maxWidth = tokens.frame.width * object.maxWidth;
    if (object.align === 'center') style.marginInline = 'auto';
    if (object.align === 'right') style.marginLeft = 'auto';
  }

  if (stroke) {
    const width = num(stroke.widthPx, t);
    style.WebkitTextStrokeWidth = `${width}px`;
    style.WebkitTextStrokeColor = animColor(stroke.color, t, tokens);
    style.paintOrder = 'stroke fill';
    // Hollow means the outline IS the type: the inside shows the field behind
    // it, which is what makes a stroked word read as neon rather than as bold.
    if (stroke.hollow && !gradient) style.color = 'transparent';
  }

  if (glow) {
    const radius = num(glow.radiusPx, t);
    const strength = Math.max(0, Math.min(1, num(glow.strength, t)));
    const colour = animColor(glow.color, t, tokens);
    /*
     * `drop-shadow` for hollow type, `text-shadow` for solid.
     *
     * A text-shadow is cast by the glyph's FILLED shape, whatever the fill's
     * opacity. On hollow type — transparent inside, stroked outside — it
     * therefore paints a solid glowing slab in the hole the outline was meant
     * to leave, and the word that was supposed to read as neon reads as bold.
     * That is what the first render of "2026" did. `drop-shadow` follows what
     * is actually painted, so an outline glows as an outline.
     *
     * Layered at growing radius either way: one tight halo for the edge, one
     * for the bloom, one wide and faint for the light in the air. A single
     * shadow at a large radius reads as a blur behind the word rather than as
     * light coming off it.
     */
    const radii = strength < 1 ? [0.35, 0.6 + strength] : [0.35, 1, 2.4];
    if (stroke?.hollow) {
      const existing = style.filter ? `${style.filter} ` : '';
      style.filter = existing + radii.map((r) => `drop-shadow(0 0 ${(radius * r).toFixed(1)}px ${colour})`).join(' ');
    } else {
      style.textShadow = radii.map((r) => `0 0 ${(radius * r).toFixed(1)}px ${colour}`).join(', ');
    }
  }

  return style;
}

function spanStyles(
  object: SceneObject & { kind: 'text' },
  t: number,
  tokens: DesignTokens,
): (React.CSSProperties | undefined)[] {
  const styles: (React.CSSProperties | undefined)[] = new Array(object.content.length).fill(
    undefined,
  );
  let cursor = 0;
  for (const span of object.spans) {
    const style: React.CSSProperties = {};
    if (span.color !== null) style.color = animColor(span.color, t, tokens);
    if (span.weight !== null) style.fontWeight = span.weight;
    if (span.italic) style.fontStyle = 'italic';
    if (span.scale !== null) style.fontSize = `${span.scale}em`;
    const decorated = Object.keys(style).length > 0 ? style : undefined;
    for (let i = 0; i < span.text.length && cursor < styles.length; i += 1, cursor += 1) {
      styles[cursor] = decorated;
    }
  }
  return styles;
}

/** A run of text, split into <span>s wherever its styling changes. */
function decorate(
  text: string,
  offset: number,
  styles: (React.CSSProperties | undefined)[],
  keyPrefix: string,
): React.ReactNode {
  if (styles.length === 0) return text;
  const parts: React.ReactNode[] = [];
  let run = '';
  let runStyle = styles[offset];
  const flush = (index: number) => {
    if (run === '') return;
    parts.push(
      runStyle ? (
        <span key={`${keyPrefix}-${index}`} style={runStyle}>
          {run}
        </span>
      ) : (
        run
      ),
    );
    run = '';
  };
  for (let i = 0; i < text.length; i += 1) {
    const style = styles[offset + i];
    if (style !== runStyle) {
      flush(i);
      runStyle = style;
    }
    run += text[i];
  }
  flush(text.length);
  return parts;
}

/** A line with no stagger, set with whatever emphasis its spans carry. */
function spannedText(
  object: SceneObject & { kind: 'text' },
  t: number,
  tokens: DesignTokens,
): React.ReactNode {
  if (object.spans.length === 0) return object.content;
  return decorate(object.content, 0, spanStyles(object, t, tokens), object.id);
}

function staggeredText(
  object: SceneObject & { kind: 'text' },
  seconds: number,
  t: number,
  tokens: DesignTokens,
): React.ReactNode {
  const separator = object.staggerBy === 'line' ? '\n' : ' ';
  const units = object.content.split(separator);
  const styles = object.spans.length > 0 ? spanStyles(object, t, tokens) : [];

  let offset = 0;
  return units.map((unit, index) => {
    const start = object.enterAt + index * object.staggerSeconds;
    const local = Math.max(0, Math.min(1, (seconds - start) / 0.5));
    const eased = EASINGS.out_quint(local);
    const at = offset;
    offset += unit.length + separator.length;
    return (
      <span
        key={index}
        style={{
          display: 'inline-block',
          opacity: eased,
          transform: `translateY(${((1 - eased) * 0.35).toFixed(3)}em)`,
          marginRight: object.staggerBy === 'line' ? 0 : '0.28em',
          ...(object.staggerBy === 'line' ? { width: '100%' } : {}),
        }}
      >
        {decorate(unit, at, styles, `${object.id}-${index}`)}
      </span>
    );
  });
}

/** A mask's shape at a moment, as a CSS clip path. */
function clipPathFor(
  mask: SceneObject & { kind: 'mask' },
  seconds: number,
  scene: SceneGraph,
): string | undefined {
  const t = objectProgress(mask, seconds, scene.durationSeconds);
  const width = num(mask.width, t) * 100;
  const height = num(mask.height, t) * 100;
  const cx = num(mask.transform.x, t) * 100;
  const cy = num(mask.transform.y, t) * 100;

  if (mask.shape === 'ellipse') {
    return `ellipse(${(width / 2).toFixed(2)}% ${(height / 2).toFixed(2)}% at ${cx.toFixed(2)}% ${cy.toFixed(2)}%)`;
  }
  if (mask.shape === 'path' && mask.d) return `path('${mask.d}')`;
  const left = cx - width / 2;
  const top = cy - height / 2;
  return `inset(${top.toFixed(2)}% ${(100 - left - width).toFixed(2)}% ${(100 - top - height).toFixed(2)}% ${left.toFixed(2)}%)`;
}
