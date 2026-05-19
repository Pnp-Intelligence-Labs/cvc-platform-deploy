/**
 * auth.setup.ts — One-time login that saves auth state for all tests.
 *
 * Gets a real JWT from the API, injects it into localStorage, then
 * saves the browser storage state to .auth/user.json. All test projects
 * load that file so they start already authenticated.
 *
 * Requires: CVC_SMOKE_PASSWORD env var (same as smoke_test.py)
 */

import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const AUTH_FILE = 'tests/e2e/.auth/user.json';

setup('authenticate as nate', async ({ page, request }) => {
  const password = process.env.CVC_SMOKE_PASSWORD;
  if (!password) throw new Error('CVC_SMOKE_PASSWORD env var is required');

  // Get JWT from the API
  const resp = await request.post('/auth/login', {
    data: { username: 'nate', password },
  });
  expect(resp.ok(), `Login failed: ${resp.status()} ${await resp.text()}`).toBeTruthy();
  const { access_token, username, role, full_name } = await resp.json();

  // Inject token into the app's localStorage
  await page.goto('/app/login');
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('cvc_jwt', token);
    localStorage.setItem('cvc_user', JSON.stringify(user));
  }, {
    token: access_token,
    user: { username, role, full_name: full_name ?? null },
  });

  // Verify auth guard passes
  await page.goto('/app/');
  await expect(page).not.toHaveURL(/\/login/);

  // Save auth state for all tests
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
});
