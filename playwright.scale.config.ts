import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The real-browser scale experiment (`e2e/scale.spec.ts`), opt-in:
 * `pnpm e2e:scale`. It loads a million-cell workbook and a 50-sheet workbook
 * into the demo page and measures what a user feels — time to screen and the
 * longest main-thread block per action — so it is a measurement, not a smoke
 * test, and stays out of `pnpm e2e` (what CI runs). Everything else (dev
 * server, base URL, tracing, retries) is the interaction suite's setup.
 */
export default defineConfig({
  ...base,
  testMatch: /scale\.spec\.ts/,
  projects: [
    {
      name: 'scale',
      use: { browserName: 'chromium', viewport: { width: 1400, height: 900 } },
      testMatch: /scale\.spec\.ts/,
      timeout: 600_000,
    },
  ],
});
