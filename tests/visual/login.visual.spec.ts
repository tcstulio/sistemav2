import { test, expect } from '@playwright/test';

/**
 * Regressão visual — tela de login (`/`).
 *
 * Alvo determinístico e SEM PII (não exige autenticação): a porta de entrada do app. As telas
 * internas do ERP (clientes, faturas, etc.) ficam atrás de login e podem conter dados de clientes,
 * por isso NÃO entram em baseline (e, no self-hosted, nada sairia do CI de qualquer forma).
 *
 * A baseline é gerada na CI (Linux) e versionada em tests/visual/**-snapshots/.
 * Mudança visual intencional → este check falha → humano revisa o diff de imagem no PR do GitHub e
 * roda o workflow de atualização da baseline (aprovação) → merge.
 */
test('tela de login', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  // Garante o app React montado antes de fotografar.
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page).toHaveScreenshot('login.png', { fullPage: true });
});
