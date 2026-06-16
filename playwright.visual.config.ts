import { defineConfig, devices } from '@playwright/test';

/**
 * Regressão visual determinística (Fase 2 / Nível B) — Playwright `toHaveScreenshot` SELF-HOSTED.
 *
 * Por quê config separada da E2E (playwright.config.ts):
 * - chromium ÚNICO (baseline por navegador/plataforma; 5 navegadores = flakiness + 5x baselines).
 * - rodada determinística (workers=1, retries=0, animações/caret desligados).
 * - testDir próprio (tests/visual) que a config E2E ignora (testIgnore).
 *
 * Privacidade: os screenshots e baselines NUNCA saem do nosso CI/repo (sem nuvem de terceiros) —
 * importa porque telas de ERP ficam atrás de login e podem ter PII.
 *
 * Baselines: geradas NA CI (Linux) via workflow `.github/workflows/visual.yml` (input
 * update_baselines) e commitadas em tests/visual/**-snapshots/. Mudança visual intencional → o
 * check 'visual' falha → humano revisa o diff de imagem no PR do GitHub + roda o update (aprovação)
 * → merge.
 */
export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['html', { open: 'never' }]],
  // Defaults determinísticos para toda comparação de screenshot.
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    baseURL: 'http://localhost:3003',
  },
  // Só chromium — visual regression não precisa de matriz de navegadores.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Sobe o frontend (vite na 3003). Não precisa do backend para a tela de login.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3003',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
