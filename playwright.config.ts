import { defineConfig, devices } from '@playwright/test';

/**
 * Configuração do Playwright para testes e automação de navegador
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',

  // Os testes de regressão VISUAL têm config própria (playwright.visual.config.ts, chromium-only,
  // baselines geradas na CI). O check E2E 'test' os IGNORA para não falhar por baseline ausente.
  testIgnore: '**/visual/**',

  // Timeout máximo por teste
  timeout: 30 * 1000,

  // Configurações de expect
  expect: {
    timeout: 5000
  },

  // Configurações de execução
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  // Configuração de relatórios
  reporter: 'html',

  // Configurações compartilhadas para todos os projetos
  use: {
    baseURL: 'http://localhost:3003',

    // Coletar trace em falhas
    trace: 'on-first-retry',

    // Screenshot em falhas
    screenshot: 'only-on-failure',

    // Video em retry
    video: 'retain-on-failure',
  },

  // Configurar projetos para diferentes navegadores
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    // Mobile viewports
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3003',
    reuseExistingServer: !process.env.CI,
  },
});
