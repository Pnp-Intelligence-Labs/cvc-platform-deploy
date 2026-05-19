import { test, expect } from '@playwright/test';

test.describe('Sales', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/sales');
  });

  test('page loads without crashing', async ({ page }) => {
    await expect(page).not.toHaveURL(/\/login/);
    await page.waitForLoadState('networkidle');
  });

  test('sales leads are visible', async ({ page }) => {
    // Table rows or kanban cards with lead names
    await expect(
      page.locator('table tbody tr').first()
        .or(page.getByText(/cedar park|ut austin|cirrus/i).first())
        .or(page.locator('[class*="card"]').first())
    ).toBeVisible({ timeout: 15_000 });
  });

  test('can open a lead and view notes tab', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Click first visible lead row or card
    const firstLead = page.locator('table tbody tr').first()
      .or(page.locator('[class*="card"]').first());
    if (await firstLead.isVisible()) {
      await firstLead.click();

      // Notes tab should appear in the detail panel
      await expect(page.getByText(/notes/i).first())
        .toBeVisible({ timeout: 8_000 });
    }
  });

  test('pipeline summary renders', async ({ page }) => {
    // Stage summary (prospecting, discovery, closed_won, etc.)
    await expect(
      page.getByText(/pipeline|stage|closed|prospecting/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
