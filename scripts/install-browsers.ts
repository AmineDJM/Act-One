/**
 * Installs the two browsers the worker needs, at build time.
 *
 *   npm run browsers
 *
 * Research runs in Playwright's Chromium; rendering runs in Remotion's
 * chrome-headless-shell (current Chrome binaries no longer ship the old
 * headless mode Remotion drives, so a full Chrome fails to launch). Both are
 * downloaded once here rather than on the first job, where a cold download
 * would be charged to a customer's wait — and on a host with no egress at
 * run time, would never happen at all.
 *
 * Honours PLAYWRIGHT_BROWSERS_PATH for the Chromium and puts the headless
 * shell under node_modules/.remotion, where the renderer looks by default.
 * ACT_ONE_CHROMIUM_PATH and ACT_ONE_CHROME_HEADLESS_SHELL still override both
 * at run time for hosts that ship their own.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ensureBrowser } from '@remotion/renderer';

const require = createRequire(import.meta.url);

function step(label: string): void {
  console.log(`\x1b[1m${label}\x1b[0m`);
}

step('Playwright Chromium (research)');
if (process.env.ACT_ONE_CHROMIUM_PATH) {
  console.log(`  using ACT_ONE_CHROMIUM_PATH=${process.env.ACT_ONE_CHROMIUM_PATH}`);
} else {
  // The CLI is not in the package's export map, so it is located beside the
  // entry point rather than resolved by name.
  const cli = path.join(path.dirname(require.resolve('playwright-core')), 'cli.js');
  const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error('  Chromium install failed.');
    process.exit(result.status ?? 1);
  }
}

step('chrome-headless-shell (rendering)');
if (process.env.ACT_ONE_CHROME_HEADLESS_SHELL) {
  console.log(`  using ACT_ONE_CHROME_HEADLESS_SHELL=${process.env.ACT_ONE_CHROME_HEADLESS_SHELL}`);
} else {
  await ensureBrowser({
    onBrowserDownload: () => ({
      version: null,
      onProgress: ({ percent }) => {
        if (percent === 1) console.log('  downloaded');
      },
    }),
  });
  console.log('  ready');
}
