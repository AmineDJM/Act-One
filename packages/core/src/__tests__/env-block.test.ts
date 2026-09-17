import { describe, it, expect } from 'vitest';
import { parseEnvBlock, routeEnvEntries } from '../env-block.ts';

describe('parseEnvBlock', () => {
  it('reads a plain .env file', () => {
    expect(parseEnvBlock('OPENAI_API_KEY=sk-abc\nSTRIPE_SECRET_KEY=sk_live_def')).toEqual([
      { key: 'OPENAI_API_KEY', value: 'sk-abc' },
      { key: 'STRIPE_SECRET_KEY', value: 'sk_live_def' },
    ]);
  });

  it('tolerates the shapes a paste actually arrives in', () => {
    const pasted = [
      '# Production',
      'export OPENAI_API_KEY="sk-quoted"',
      "  BROWSERBASE_API_KEY: 'bb_yaml_style'",
      '• STRIPE_SECRET_KEY=sk_live_bulleted',
      '',
      'HIGGSFIELD_API_KEY=hf_plain   # the one we rotate',
    ].join('\n');

    expect(parseEnvBlock(pasted)).toEqual([
      { key: 'OPENAI_API_KEY', value: 'sk-quoted' },
      { key: 'BROWSERBASE_API_KEY', value: 'bb_yaml_style' },
      { key: 'STRIPE_SECRET_KEY', value: 'sk_live_bulleted' },
      { key: 'HIGGSFIELD_API_KEY', value: 'hf_plain' },
    ]);
  });

  it('does not treat a hash inside a key as a comment', () => {
    // Truncating here would store a credential that silently never works.
    expect(parseEnvBlock('OPENAI_API_KEY=sk-abc#def')).toEqual([
      { key: 'OPENAI_API_KEY', value: 'sk-abc#def' },
    ]);
  });

  it('keeps the last value when a key repeats, as a shell would', () => {
    expect(parseEnvBlock('OPENAI_API_KEY=old\nOPENAI_API_KEY=new')).toEqual([
      { key: 'OPENAI_API_KEY', value: 'new' },
    ]);
  });

  it('skips blank values rather than storing an empty credential', () => {
    expect(parseEnvBlock('OPENAI_API_KEY=\nSTRIPE_SECRET_KEY=   ')).toEqual([]);
  });

  it('ignores prose that happens to be in the clipboard', () => {
    expect(parseEnvBlock('Here are the keys you asked for:\n\nthanks!')).toEqual([]);
  });
});

describe('routeEnvEntries', () => {
  const routes = [
    { envVar: 'OPENAI_API_KEY', provider: 'openai', field: 'apiKey' },
    { envVar: 'STRIPE_SECRET_KEY', provider: 'stripe', field: 'secretKey' },
  ] as const;

  it('routes what it knows and reports what it does not', () => {
    const { matched, unmatched } = routeEnvEntries(
      parseEnvBlock('OPENAI_API_KEY=sk-abc\nDATABASE_URL=postgres://x\nNODE_ENV=production'),
      routes,
    );

    expect(matched).toEqual([{ route: routes[0], value: 'sk-abc' }]);
    // An operator who pasted their whole .env must be told what went nowhere,
    // not left assuming all of it landed.
    expect(unmatched).toEqual(['DATABASE_URL', 'NODE_ENV']);
  });
});
