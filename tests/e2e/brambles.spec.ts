import { test, expect } from '@playwright/test';

test.describe('Brambles', () => {
  test('portal lists companies', async ({ page }) => {
    await page.goto('/app/brambles');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(
      page.getByText(/brambles|tier|pipeline/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('review page loads for company 3', async ({ page }) => {
    await page.goto('/app/brambles/review/3');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle');
    // Should show the review panel or a loading state — not a blank crash
    await expect(
      page.locator('main, [class*="page"], [class*="card"]').first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
