import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('loads dashboard without errors', async ({ page }) => {
    await page.goto('/');
    // No error boundary visible
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  test('shows connect wallet button when not connected', async ({ page }) => {
    await page.goto('/');
    const connectButton = page.locator('button', { hasText: /connect/i });
    await expect(connectButton).toBeVisible();
  });

  test('navigates between pages without crashes', async ({ page }) => {
    const routes = ['/', '/markets', '/create', '/market/create', '/oracle/decode', '/settings'];
    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator('text=Something went wrong')).not.toBeVisible();
    }
  });

  test('sidebar navigation works', async ({ page }) => {
    await page.goto('/');
    // Click on Markets link in sidebar
    await page.click('a[href="/markets"]');
    await expect(page).toHaveURL('/markets');
    await expect(page.locator('text=Something went wrong')).not.toBeVisible();
  });

  test('no console errors on initial load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await page.waitForTimeout(2000);

    const realErrors = errors.filter(
      (e) =>
        !e.includes('ResizeObserver') &&
        !e.includes('favicon') &&
        !e.includes('Failed to fetch'),
    );
    expect(realErrors).toHaveLength(0);
  });
});
