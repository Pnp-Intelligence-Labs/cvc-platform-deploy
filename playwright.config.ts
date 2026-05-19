import { defineConfig, devices } from '@playwright/test';

/**
 * CVC Platform — Playwright E2E config
 *
 * Targets the Dell server over Tailscale by default.
 * Override with: CVC_BASE_URL=http://localhost:8001 npx playwright test
 *
 * Auth: auth.setup.ts gets a real JWT via the API and stores it in
 * tests/e2e/.auth/user.json — all test projects reuse that state.
 * Set CVC_SMOKE_PASSWORD before running (same var as smoke_test.py).
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 1,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'tests/e2e/report', open: 'never' }],
  ],

  use: {
    baseURL:    process.env.CVC_BASE_URL || 'http://100.83.104.117:8001',
    screenshot: 'only-on-failure',
    trace:      'retain-on-failure',
  },

  projects: [
    // Runs first — logs in and saves auth state (no storageState dependency)
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    // All feature tests depend on setup and load the saved auth state
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
});
