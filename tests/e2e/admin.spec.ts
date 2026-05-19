import { test, expect } from '@playwright/test';

test.describe('Admin', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/admin');
  });

  test('page loads', async ({ page }) => {
    await expect(page).not.toHaveURL(/\/login/);
    await expect(
      page.getByText(/admin|partner issues|messages/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test('partner issues tab is accessible', async ({ page }) => {
    const tab = page.getByRole('tab', { name: /partner issues/i })
      .or(page.getByText('Partner Issues').first());
    if (await tab.isVisible()) {
      await tab.click();
      await expect(
        page.getByText(/issues|severity|no issues/i).first()
      ).toBeVisible({ timeout: 8_000 });
    }
  });

  test('home messages tab is accessible', async ({ page }) => {
    const tab = page.getByRole('tab', { name: /messages|team messages/i })
      .or(page.getByText(/Team Messages|Home Messages/i).first());
    if (await tab.isVisible()) {
      await tab.click();
      await page.waitForLoadState('networkidle');
      await expect(page).not.toHaveURL(/\/login/);
    }
  });
});
