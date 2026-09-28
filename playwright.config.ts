import { defineConfig } from '@playwright/test';

/**
 * Real-browser e2e for the interaction surfaces jsdom cannot reach:
 * context menus (right-click), sheet-tab menus, hover submenus and the
 * dialogs behind them. Reuses a running dev server on :5199 when present;
 * otherwise boots one for the run.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5199',
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
  },
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: './node_modules/.bin/vite --port 5199 --strictPort',
        url: 'http://localhost:5199',
        reuseExistingServer: true,
        timeout: 30_000,
      },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
