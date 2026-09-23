import type { BrandIngestion } from './schema.ts';

/**
 * A page a person can look at to judge a run: every colour with its role,
 * every role's type set in the very files that were kept, the logo as vector
 * and as capture, and every capture on a checkerboard so the transparency is
 * visible rather than assumed.
 *
 * Everything in a manifest came from somebody else's website, so nothing from
 * it reaches this page unescaped: text is escaped, colours are the manifest's
 * own validated hex values, fonts are registered under generated names rather
 * than the site's, and assets are referenced by the manifest's validated file
 * names.
 */
export function renderContactSheet(manifest: BrandIngestion): string {
  const files = new Map(manifest.assets.map((asset) => [asset.id, asset.fileName] as const));
  const file = (id: string | null | undefined): string | null => (id ? (files.get(id) ?? null) : null);

  const faces = manifest.typography?.faces ?? [];
  const alias = new Map<string, string>();
  const fontFaces = faces
    .map((face, index) => {
      const name = `kept-${index}`;
      const source = file(face.assetId);
      if (!source) return '';
      if (!alias.has(face.family.toLowerCase())) alias.set(face.family.toLowerCase(), `kept-family-${alias.size}`);
      const family = alias.get(face.family.toLowerCase())!;
      const weight = /^\d{1,4}( \d{1,4})?$/.test(face.weight) ? face.weight : '400';
      const style = /^(normal|italic|oblique)$/.test(face.style) ? face.style : 'normal';
      return `@font-face{font-family:"${family}";src:url("${source}");font-weight:${weight};font-style:${style};} /* ${name} */`;
    })
    .join('\n');

  const palette = manifest.palette;
  const swatches = (palette?.colors ?? [])
    .map((color) => {
      const roles = palette
        ? Object.entries(palette.roles)
            .filter(([, value]) => value === color.hex8)
            .map(([role]) => role)
        : [];
      return `<figure class="swatch"><div class="chip" style="background:${color.hex8}"></div><figcaption><b>${escape(
        color.hex8,
      )}</b>${roles.length ? ` <em>${escape(roles.join(', '))}</em>` : ''}<br><code>${escape(color.css)}</code><br>${(color.weight * 100).toFixed(
        1,
      )}% · ${escape(color.usages.join(', '))}${color.tokens.length ? `<br><small>${escape(color.tokens.slice(0, 3).join(' '))}</small>` : ''}${
        color.inGamut ? '' : '<br><small>wider than sRGB</small>'
      }</figcaption></figure>`;
    })
    .join('');

  const type = (manifest.typography?.roles ?? [])
    .map((role) => {
      const family = role.stack.map((name) => alias.get(name.toLowerCase())).find(Boolean) ?? 'sans-serif';
      const size = Math.min(96, role.sizePx);
      return `<div class="type"><p class="meta">${escape(role.role)} · ${escape(role.stack[0] ?? '')} ${role.weight} · ${role.sizePx}px${
        role.rendered ? ` · drawn with ${escape(role.rendered.postScriptName ?? role.rendered.family)}${role.rendered.isWebFont ? '' : ' (system)'}` : ''
      }</p><p style="font-family:'${family}',sans-serif;font-weight:${role.weight};font-size:${size}px;letter-spacing:${role.letterSpacingEm}em;text-transform:${role.textTransform};line-height:${
        role.lineHeight ?? 'normal'
      }">${escape(role.sample || 'The quick brown fox')}</p></div>`;
    })
    .join('');

  const faceRows = faces
    .map(
      (face) =>
        `<tr><td>${escape(face.family)}</td><td>${escape(face.weight)} ${escape(face.style)}</td><td>${escape(face.format)}</td><td>${(
          face.bytes / 1024
        ).toFixed(0)} KB</td><td>${escape(face.licence.kind)}${face.licence.requiresAttestation ? ' · needs attestation' : ''}</td><td>${escape(
          face.postScriptName ?? '',
        )}</td></tr>`,
    )
    .join('');
  const missing = (manifest.typography?.missing ?? [])
    .map((entry) => `<li><b>${escape(entry.family)}</b> — ${escape(entry.reason)}</li>`)
    .join('');

  const logos = [manifest.logo, ...manifest.logoAlternates]
    .filter((logo): logo is NonNullable<typeof logo> => logo !== null)
    .map((logo) => {
      const svg = file(logo.svgAssetId);
      const png = file(logo.pngAssetId);
      return `<div class="logo"><p class="meta">${escape(logo.source)} · confidence ${logo.confidence}${
        logo.vectorFidelity !== null ? ` · vector fidelity ${(logo.vectorFidelity * 100).toFixed(0)}%` : ''
      }</p>${svg ? `<div class="board"><img alt="vector" src="${svg}" style="height:64px"></div>` : ''}${
        png ? `<div class="board"><img alt="capture" src="${png}" style="height:64px"></div>` : ''
      }<p class="meta">${escape(logo.reasons.join(' · '))}</p></div>`;
    })
    .join('');

  const captures = manifest.captures
    .map((capture) => {
      const source = file(capture.assetId);
      if (!source) return '';
      return `<figure class="capture"><div class="board"><img alt="${escape(capture.kind)}" src="${source}"></div><figcaption><b>${escape(
        capture.kind,
      )}</b> · ${escape(capture.label.slice(0, 80))}<br>${capture.pixelWidth}×${capture.pixelHeight} @${capture.scale}x · ${
        capture.transparent ? 'transparent' : 'opaque'
      } · ${(capture.opaqueCoverage * 100).toFixed(0)}% opaque${capture.cropped ? ' · cropped' : ''}</figcaption></figure>`;
    })
    .join('');

  const warnings = manifest.diagnostics.warnings.map((warning) => `<li>${escape(warning)}</li>`).join('');
  const blocked = manifest.diagnostics.blockedRequests.map((entry) => `<li><code>${escape(entry.url)}</code> — ${escape(entry.reason)}</li>`).join('');
  const stages = manifest.diagnostics.stages
    .map((stage) => `<li>${escape(stage.name)}: ${stage.ok ? 'ok' : `failed — ${escape(stage.error ?? '')}`} (${stage.ms} ms)</li>`)
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Brand ingestion</title>
<style>
${fontFaces}
:root{--ink:#16171a;--muted:#62656d;--line:#e3e4e8;--bg:#fbfbfc}
body{margin:0;padding:32px 16px;font:14px/1.5 system-ui,sans-serif;color:var(--ink);background:var(--bg)}
main{max-width:1200px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:32px 0 12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.meta{color:var(--muted);font-size:12px;margin:0 0 6px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
.swatch{margin:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff}
.chip{height:64px;border-bottom:1px solid var(--line)}
.swatch figcaption{padding:8px;font-size:12px;word-break:break-word}
.type{border-bottom:1px solid var(--line);padding:12px 0;overflow:hidden}
.type p:last-child{margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
table{border-collapse:collapse;width:100%;font-size:12px}td{border-bottom:1px solid var(--line);padding:6px 8px 6px 0;vertical-align:top}
.board{background-color:#fff;background-image:linear-gradient(45deg,#d9dade 25%,transparent 25%),linear-gradient(-45deg,#d9dade 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#d9dade 75%),linear-gradient(-45deg,transparent 75%,#d9dade 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0;border-radius:8px;padding:12px;display:inline-block;max-width:100%}
.board img{display:block;max-width:100%;height:auto}
.captures{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
.capture{margin:0}.capture figcaption{font-size:12px;color:var(--muted);margin-top:6px}
.logo{display:inline-block;margin:0 24px 16px 0;vertical-align:top}.logo .board{margin-right:8px}
code{font-size:12px}ul{padding-left:18px}
</style></head><body><main>
<h1>${escape(manifest.title || manifest.finalUrl)}</h1>
<p class="meta">${escape(manifest.finalUrl)} · ${escape(manifest.capturedAt)} · ${manifest.durationMs} ms · ${escape(manifest.provider)}</p>
<h2>Palette</h2><div class="grid">${swatches || '<p>None measured.</p>'}</div>
<h2>Type</h2>${type || '<p>None measured.</p>'}
<h2>Font files</h2>${faceRows ? `<table>${faceRows}</table>` : '<p>None kept.</p>'}${missing ? `<ul>${missing}</ul>` : ''}
<h2>Logo</h2>${logos || '<p>None found.</p>'}
<h2>Captures</h2><div class="captures">${captures || '<p>None.</p>'}</div>
<h2>Diagnostics</h2><ul>${stages}</ul>${warnings ? `<ul>${warnings}</ul>` : ''}${blocked ? `<p class="meta">Blocked requests</p><ul>${blocked}</ul>` : ''}
</main></body></html>
`;
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
