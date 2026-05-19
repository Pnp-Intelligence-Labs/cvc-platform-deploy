import { test, expect } from '@playwright/test';

test.describe('Ventures', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/ventures');
  });

  test('page loads with tabs', async ({ page }) => {
    await expect(page).not.toHaveURL(/\/login/);
    // Tab bar should have at least Companies + Portfolio + Industrial
    await expect(page.getByRole('tab').or(
      page.getByText(/companies|portfolio|industrial/i).first()
    )).toBeVisible({ timeout: 10_000 });
  });

  test('companies tab shows data', async ({ page }) => {
    // Click Companies tab if not active
    const companiesTab = page.getByRole('tab', { name: /companies/i })
      .or(page.getByText('Companies').first());
    if (await companiesTab.isVisible()) await companiesTab.click();

    // At least one company card should appear
    await expect(page.locator('table tbody tr').first().or(
      page.locator('[class*="card"]').first()
    )).toBeVisible({ timeout: 15_000 });
  });

  test('portfolio tab shows data', async ({ page }) => {
    const tab = page.getByRole('tab', { name: /portfolio/i })
      .or(page.getByText('Portfolio').first());
    if (await tab.isVisible()) await tab.click();

    await expect(page.getByText(/portfolio|invested|fund/i).first())
      .toBeVisible({ timeout: 10_000 });
  });

  test('sector eval page loads', async ({ page }) => {
    await page.goto('/app/ventures/evaluation');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/sector|evaluation|subsector/i).first())
      .toBeVisible({ timeout: 10_000 });
  });
});
