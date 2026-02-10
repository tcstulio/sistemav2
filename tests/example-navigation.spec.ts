import { test, expect } from '@playwright/test';

/**
 * Exemplo básico de navegação e automação com Playwright
 */
test.describe('Exemplos de Navegação', () => {

  test('Navegar para um site e fazer uma busca', async ({ page }) => {
    // Navegar para o Google
    await page.goto('https://www.google.com');

    // Aceitar cookies se necessário (pode variar)
    try {
      await page.click('button:has-text("Aceitar tudo")', { timeout: 3000 });
    } catch {
      // Ignorar se não aparecer
    }

    // Preencher campo de busca
    await page.fill('textarea[name="q"]', 'Playwright automation');

    // Pressionar Enter
    await page.press('textarea[name="q"]', 'Enter');

    // Aguardar resultados
    await page.waitForLoadState('networkidle');

    // Verificar se há resultados
    const results = await page.locator('#search').isVisible();
    expect(results).toBeTruthy();

    console.log('Busca realizada com sucesso!');
  });

  test('Capturar screenshot de uma página', async ({ page }) => {
    await page.goto('https://playwright.dev');

    // Aguardar página carregar
    await page.waitForLoadState('domcontentloaded');

    // Tirar screenshot
    await page.screenshot({
      path: 'tests/screenshots/playwright-homepage.png',
      fullPage: true
    });

    console.log('Screenshot salvo em tests/screenshots/playwright-homepage.png');
  });

  test('Extrair informações de uma página', async ({ page }) => {
    await page.goto('https://example.com');

    // Extrair título
    const title = await page.title();
    console.log('Título da página:', title);

    // Extrair texto do h1
    const heading = await page.locator('h1').textContent();
    console.log('Heading:', heading);

    // Extrair todos os links
    const links = await page.locator('a').all();
    console.log(`Encontrados ${links.length} links na página`);

    expect(title).toBeTruthy();
  });
});
