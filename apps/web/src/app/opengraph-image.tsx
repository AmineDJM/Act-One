import { ImageResponse } from 'next/og';
import { site } from '@/lib/site.ts';

/**
 * Social card, generated rather than hand-designed.
 *
 * At 1200x630 — the size every platform crops from. Built with the same
 * restraint as the films: one statement, one mark, a lot of space.
 */
export const runtime = 'edge';
export const alt = `${site.name} — ${site.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: '#050609',
          padding: '80px 88px',
        }}
      >
        <div
          style={{
            fontSize: 22,
            letterSpacing: 4,
            textTransform: 'uppercase',
            color: '#70737f',
            marginBottom: 32,
          }}
        >
          {site.name}
        </div>
        <div
          style={{
            fontSize: 82,
            lineHeight: 1.05,
            letterSpacing: -3,
            color: '#f4f5f8',
            fontWeight: 600,
            maxWidth: 900,
          }}
        >
          {site.tagline}
        </div>
        <div style={{ fontSize: 30, color: '#a8abb8', marginTop: 32, maxWidth: 820, lineHeight: 1.4 }}>
          {site.subline}
        </div>
        <div
          style={{
            marginTop: 'auto',
            height: 4,
            width: 132,
            background: '#5b7cfa',
          }}
        />
      </div>
    ),
    size,
  );
}
