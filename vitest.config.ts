import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    testTimeout: 20_000,
    // Stands in for the Next.js request scope so the web app's server
    // modules — sessions, permissions, rate limits — run under test.
    setupFiles: ['./apps/web/src/server/__tests__/request-scope.ts'],
  },
  resolve: {
    alias: {
      '@': r('./apps/web/src'),
      '@act-one/core': r('./packages/core/src/index.ts'),
      '@act-one/db': r('./packages/db/src/index.ts'),
      '@act-one/providers': r('./packages/providers/src/index.ts'),
      '@act-one/queue': r('./packages/queue/src/index.ts'),
      '@act-one/research': r('./packages/research/src/index.ts'),
      '@act-one/ingestion': r('./packages/ingestion/src/index.ts'),
      '@act-one/creative': r('./packages/creative/src/index.ts'),
      '@act-one/design': r('./packages/design/src/index.ts'),
      '@act-one/motion': r('./packages/motion/src/index.ts'),
      '@act-one/three-d': r('./packages/three-d/src/index.ts'),
      '@act-one/sound': r('./packages/sound/src/index.ts'),
      '@act-one/qa': r('./packages/qa/src/index.ts'),
      '@act-one/pipeline': r('./packages/pipeline/src/index.ts'),
    },
  },
});
