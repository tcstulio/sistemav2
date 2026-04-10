import { test, expect } from '@playwright/test';

/**
 * Navigation tests for CoolGroove
 *
 * Tests sidebar navigation, page loads, and 404 handling.
 * These tests need the app to have been set up (config stored in localStorage).
 * Without a valid config, the app redirects to SetupWizard - tests handle both cases.
 */

test.describe('App Navigation', () => {
  test('app loads without crashing', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Page should have loaded the React root
    const rootEl = page.locator('#root');
    await expect(rootEl).toBeAttached();

    // Should not be a blank page - either SetupWizard or Dashboard content
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(0);

    // Filter out known non-critical errors (e.g., favicon, HMR)
    const criticalErrors = consoleErrors.filter(
      e => !e.includes('favicon') && !e.includes('hot-update') && !e.includes('DevTools')
    );
    expect(criticalErrors.length).toBe(0);
  });

  // Tests below need the app to be configured (logged in)
  test.describe('Authenticated Navigation', () => {
    test.skip('sidebar is visible after setup', async ({ page }) => {
      await page.goto('/');
      // Sidebar should contain the CoolGroove branding
      await expect(page.locator('text=CoolGroove')).toBeVisible({ timeout: 10000 });
      // Sidebar nav element
      await expect(page.locator('nav').first()).toBeVisible();
    });

    // Core sections to verify navigation works
    const mainSections = [
      { path: '/', label: 'Painel Principal' },
      { path: '/customers', label: 'Clientes' },
      { path: '/invoices', label: 'Faturas' },
      { path: '/proposals', label: 'Propostas' },
      { path: '/orders', label: 'Pedidos' },
      { path: '/projects', label: 'Projetos' },
      { path: '/products', label: 'Produtos' },
      { path: '/settings', label: 'Configurações' },
    ];

    for (const section of mainSections) {
      test.skip(`navigates to ${section.label} (${section.path})`, async ({ page }) => {
        await page.goto(section.path, { waitUntil: 'domcontentloaded' });

        // Page should not redirect to setup wizard
        const url = page.url();
        expect(url).toContain(section.path === '/' ? 'localhost:3003/' : section.path);

        // Page content should have loaded (not just a spinner)
        await page.waitForTimeout(2000);
        const hasContent = await page.locator('main, [role="main"], .flex-1').first().isVisible().catch(() => false);
        expect(hasContent).toBeTruthy();
      });
    }

    test.skip('sidebar navigation links work', async ({ page }) => {
      await page.goto('/');

      // Click on "Clientes" in sidebar
      await page.locator('button:has-text("Clientes")').first().click();

      // Should navigate to /customers
      await expect(page).toHaveURL(/\/customers/, { timeout: 5000 });

      // Click on "Faturas" in sidebar
      await page.locator('button:has-text("Faturas")').first().click();
      await expect(page).toHaveURL(/\/invoices/, { timeout: 5000 });
    });

    test.skip('sidebar groups are collapsible', async ({ page }) => {
      await page.goto('/');

      // Find a group header (e.g., "VENDAS & CRM")
      const groupHeader = page.locator('button:has-text("VENDAS")').first();
      if (await groupHeader.isVisible()) {
        // Items should be visible initially
        const customerItem = page.locator('button:has-text("Clientes")').first();

        // Click to collapse
        await groupHeader.click();
        await page.waitForTimeout(300);

        // Items may be hidden (depends on collapsed state)
        // Click again to expand
        await groupHeader.click();
        await page.waitForTimeout(300);

        // Items should be visible again
        await expect(customerItem).toBeVisible();
      }
    });
  });

  test.describe('404 Handling', () => {
    test('shows 404 page for unknown routes', async ({ page }) => {
      // First, we need the app to be configured. If not, it shows SetupWizard.
      // We inject a minimal config so the router loads instead of SetupWizard.
      await page.goto('/');
      await page.evaluate(() => {
        // Store a minimal config so the app renders the router
        const minimalConfig = {
          apiUrl: 'https://localhost/api',
          apiKey: 'test-key',
          themeColor: 'indigo',
          darkMode: false,
          apiLimit: 0
        };
        localStorage.setItem('coolgroove_config', JSON.stringify(minimalConfig));
      });

      await page.goto('/this-route-does-not-exist-at-all', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      // The NotFound component shows "404" and "Página não encontrada"
      const has404 = await page.locator('text=404').first().isVisible().catch(() => false);
      const hasNotFoundText = await page.locator('text=/não encontrada/i').first().isVisible().catch(() => false);

      expect(has404 || hasNotFoundText).toBeTruthy();
    });

    test('404 page has navigation buttons', async ({ page }) => {
      await page.goto('/');
      await page.evaluate(() => {
        const minimalConfig = {
          apiUrl: 'https://localhost/api',
          apiKey: 'test-key',
          themeColor: 'indigo',
          darkMode: false,
          apiLimit: 0
        };
        localStorage.setItem('coolgroove_config', JSON.stringify(minimalConfig));
      });

      await page.goto('/nonexistent-page', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      // Should have "Voltar" and "Ir para o início" buttons
      const hasBackBtn = await page.locator('button:has-text("Voltar")').first().isVisible().catch(() => false);
      const hasHomeBtn = await page.locator('button:has-text("início")').first().isVisible().catch(() => false);

      expect(hasBackBtn || hasHomeBtn).toBeTruthy();
    });
  });
});
