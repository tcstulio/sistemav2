import { test, expect } from '@playwright/test';

/**
 * Authentication smoke tests for CoolGroove
 *
 * When the app has no stored config, it shows the SetupWizard (login form).
 * These tests verify the setup/login flow behaves correctly.
 * Tests that need the backend are marked with test.skip when backend is unavailable.
 */

test.describe('Authentication / Setup Wizard', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage so the app shows the SetupWizard instead of the dashboard
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.goto('/');
  });

  test('shows SetupWizard when no config is stored', async ({ page }) => {
    // The SetupWizard contains fields for API URL, login and password
    await expect(page.locator('input[type="text"], input[name="apiUrl"], input[placeholder*="api"], input[placeholder*="URL"]').first()).toBeVisible({ timeout: 10000 });

    // Should have a password field
    await expect(page.locator('input[type="password"]').first()).toBeVisible();

    // Should have a connect/submit button
    await expect(page.locator('button[type="submit"], button:has-text("Conectar"), button:has-text("Conect"), button:has-text("Entrar")').first()).toBeVisible();
  });

  test('shows validation error when submitting empty credentials', async ({ page }) => {
    // Click connect without filling in credentials
    const submitBtn = page.locator('button[type="submit"], button:has-text("Conectar"), button:has-text("Conect"), button:has-text("Entrar")').first();
    await submitBtn.click();

    // Should show some error or validation message (Portuguese)
    const errorVisible = await page.locator('text=/informe|preencha|obrigat|erro|falha|usuário.*senha/i').first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(errorVisible).toBeTruthy();
  });

  // This test requires the backend running on localhost:3004
  test.skip('shows error with invalid credentials', async ({ page }) => {
    // Fill in invalid credentials
    const apiUrlInput = page.locator('input[type="text"], input[name="apiUrl"], input[placeholder*="api"], input[placeholder*="URL"]').first();
    await apiUrlInput.fill('https://sistema.coolgroove.com.br/api/index.php');

    // Find login/user input (second text input or one with login-related placeholder)
    const loginInput = page.locator('input').filter({ hasText: '' }).nth(1);
    const allInputs = page.locator('input:visible');
    const inputCount = await allInputs.count();

    if (inputCount >= 2) {
      await allInputs.nth(1).fill('invalid_user');
    }

    const passwordInput = page.locator('input[type="password"]').first();
    await passwordInput.fill('wrong_password');

    const submitBtn = page.locator('button[type="submit"], button:has-text("Conectar"), button:has-text("Entrar")').first();
    await submitBtn.click();

    // Should show an error about invalid credentials
    await expect(page.locator('text=/falha|erro|inválid|negado|incorret/i').first()).toBeVisible({ timeout: 10000 });
  });

  // This test requires the backend and valid Dolibarr credentials
  test.skip('logs in successfully with valid credentials', async ({ page }) => {
    const apiUrlInput = page.locator('input[type="text"], input[name="apiUrl"], input[placeholder*="api"], input[placeholder*="URL"]').first();
    await apiUrlInput.fill('https://sistema.coolgroove.com.br/api/index.php');

    const allInputs = page.locator('input:visible');
    const inputCount = await allInputs.count();

    if (inputCount >= 2) {
      // TODO: Replace with test credentials from environment or test config
      await allInputs.nth(1).fill(process.env.TEST_LOGIN || 'admin');
    }

    const passwordInput = page.locator('input[type="password"]').first();
    await passwordInput.fill(process.env.TEST_PASSWORD || 'changeme');

    const submitBtn = page.locator('button[type="submit"], button:has-text("Conectar"), button:has-text("Entrar")').first();
    await submitBtn.click();

    // After successful login, should redirect to dashboard with sidebar
    await expect(page.locator('text=CoolGroove, text=Painel Principal, nav').first()).toBeVisible({ timeout: 15000 });
  });
});
