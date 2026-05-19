import { test, expect } from '@playwright/test';

test.describe('Requests', () => {
  test('page loads', async ({ page }) => {
    await page.goto('/app/requests');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(
      page.getByText(/request|assignment|open|active/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('request detail deep-link works', async ({ page }) => {
    // Request id=1 should exist in the DB
    await page.goto('/app/requests?id=1');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle');
    // Should not show a blank page
    await expect(page.locator('main, [class*="page"], [class*="container"]').first())
      .toBeVisible({ timeout: 10_000 });
  });
});
