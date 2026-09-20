import { describe, it, expect } from 'vitest';
import { undecodableFrom } from '../render.ts';

/**
 * A picture Chromium refuses does not stop a render: the frame is drawn
 * without it and the encode finishes. The only evidence is one line in a tab
 * log, which is how a film with five shots of real product material came out
 * looking like a film with none.
 */
describe('pictures the browser would not take', () => {
  it('recognises the ways Chromium says an image failed', () => {
    expect(undecodableFrom('EncodingError: The source image cannot be decoded.')).toBe(
      'an image the film asked for',
    );
    expect(undecodableFrom('Failed to load resource: http://localhost:3000/asset/ast_1.png')).toBe(
      'http://localhost:3000/asset/ast_1.png',
    );
    expect(undecodableFrom('Failed to load image file:///tmp/frames/shot-3.png')).toBe(
      'file:///tmp/frames/shot-3.png',
    );
  });

  it('ignores a line that is not about a picture failing', () => {
    // Better to miss one and have the readiness pass catch an empty shot than
    // to fail a customer's master over a warning about a font.
    expect(undecodableFrom('Download the React DevTools for a better experience')).toBeNull();
    expect(undecodableFrom('[Tab 0] rendering frame 42')).toBeNull();
    expect(undecodableFrom('')).toBeNull();
  });
});
