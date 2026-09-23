/**
 * Reads one brand off its site and writes what was measured to a folder:
 * `manifest.json`, every kept file, and `index.html` to look at.
 *
 *   npm run ingest -- https://example.com [--out DIR] [--local] [--timeout MS]
 *
 * Browserbase by default: the key comes from BROWSERBASE_API_KEY, or from the
 * egress proxy when ACT_ONE_BROWSERBASE_KEY_FROM_PROXY=1. `--local` uses a
 * local Chromium (ACT_ONE_CHROMIUM_PATH) instead, which costs nothing and is
 * what CI uses; a customer's site should be read on Browserbase.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { IngestionError, ingestBrand, renderContactSheet, writeIngestion } from '@act-one/ingestion';
import { BrowserbaseProvider, LocalChromiumProvider, loadLocalEnv, NullCostSink } from '@act-one/providers';

type Options = { url: string; out: string; local: boolean; timeoutMs: number };

function readOptions(argv: string[]): Options | null {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }
    const name = argument.slice(2);
    const next = argv[index + 1];
    if (name === 'local') flags.set(name, true);
    else if (next !== undefined && !next.startsWith('--')) {
      flags.set(name, next);
      index += 1;
    } else return null;
  }
  const url = positional[0];
  if (!url) return null;
  const host = (() => {
    try {
      return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/[^a-z0-9.-]/gi, '');
    } catch {
      return 'site';
    }
  })();
  const timeout = Number(flags.get('timeout') ?? 120_000);
  return {
    url,
    out: path.resolve(String(flags.get('out') ?? path.join('.act-one-ingest', host))),
    local: flags.get('local') === true,
    timeoutMs: Number.isFinite(timeout) ? timeout : 120_000,
  };
}

async function main(): Promise<number> {
  loadLocalEnv();
  const options = readOptions(process.argv.slice(2));
  if (!options) {
    console.error('Usage: npm run ingest -- <url> [--out DIR] [--local] [--timeout MS]');
    return 2;
  }

  const costs = new NullCostSink();
  const browserbase = options.local ? null : new BrowserbaseProvider({ costSink: costs });
  if (browserbase && !browserbase.isConfigured()) {
    console.error(
      'Browserbase is not configured: set BROWSERBASE_API_KEY, or ACT_ONE_BROWSERBASE_KEY_FROM_PROXY=1 when the egress proxy adds the key. Or pass --local.',
    );
    return 2;
  }
  const browser = browserbase ?? new LocalChromiumProvider({ costSink: costs });

  console.log(`Reading ${options.url} on ${browser.name}…`);
  try {
    const result = await ingestBrand(
      { url: options.url, organizationId: 'org_cli', projectId: 'prj_cli', timeoutMs: options.timeoutMs },
      { browser },
    );
    await writeIngestion(result, options.out);
    await writeFile(path.join(options.out, 'index.html'), renderContactSheet(result.manifest), 'utf8');

    const { manifest } = result;
    const roles = manifest.palette?.roles;
    console.log('');
    console.log(`Title       ${manifest.title}`);
    console.log(`Palette     ${manifest.palette?.colors.length ?? 0} colours; primary ${roles?.primary ?? '—'}, background ${roles?.background ?? '—'}`);
    for (const face of manifest.typography?.faces ?? []) {
      console.log(`Font        ${face.family} ${face.weight} ${face.style} (${face.format}, ${face.licence.kind}${face.licence.requiresAttestation ? ', needs attestation' : ''})`);
    }
    for (const missing of manifest.typography?.missing ?? []) console.log(`Not kept    ${missing.family}: ${missing.reason}`);
    console.log(`Logo        ${manifest.logo ? `${manifest.logo.source}, fidelity ${manifest.logo.vectorFidelity ?? 'n/a'}` : 'none'}`);
    console.log(`Captures    ${manifest.captures.map((capture) => capture.kind).join(', ') || 'none'}`);
    console.log(`Blocked     ${manifest.diagnostics.blockedRequests.length} request(s)`);
    console.log(`Warnings    ${manifest.diagnostics.warnings.length}`);
    console.log(`Browser     ${costs.records.reduce((sum, record) => sum + (record.quantity ?? 0), 0).toFixed(2)} min, $${costs.records.reduce((sum, record) => sum + record.actualCostUsd, 0).toFixed(4)}`);
    console.log(`Took        ${(manifest.durationMs / 1000).toFixed(1)} s`);
    console.log(`Written to  ${options.out}${path.sep}index.html`);
    return 0;
  } catch (error) {
    if (error instanceof IngestionError) {
      console.error(`Ingestion failed at ${error.stage} (${error.failure}${error.retryable ? ', retryable' : ''}): ${error.message}`);
      return 1;
    }
    console.error(error);
    return 1;
  }
}

process.exitCode = await main();
