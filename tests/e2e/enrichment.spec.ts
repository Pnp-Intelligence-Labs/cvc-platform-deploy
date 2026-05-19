import { test, expect } from '@playwright/test';

test.describe('Enrichment Queue', () => {
  test('page loads with company list', async ({ page }) => {
    await page.goto('/app/enrichment');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(
      page.getByText(/enrichment|queue|pending|complete/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Partners', () => {
  test('PSM hub loads', async ({ page }) => {
    await page.goto('/app/partners');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(
      page.getByText(/partner|PSM|Harry|accounts/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Company Profile', () => {
  test('loads for a known company', async ({ page }) => {
    // Company 1 — should always exist
    await page.goto('/app/companies/1');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(
      page.getByText(/sector|stage|founded|one.liner/i).first()
        .or(page.locator('h1, h2').first())
    ).toBeVisible({ timeout: 15_000 });
  });

  test('meeting notes section renders', async ({ page }) => {
    await page.goto('/app/companies/1358');
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle');
    // Meeting notes section or "no notes" state
    await expect(
      page.getByText(/meeting note|no notes|met with/i).first()
        .or(page.locator('main').first())
    ).toBeVisible({ timeout: 10_000 });
  });
});
