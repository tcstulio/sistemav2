import { chromium } from 'playwright';

/**
 * Script standalone para automação web com Playwright
 * Execute com: npx tsx scripts/web-scraper.ts
 */

async function main() {
  console.log('🚀 Iniciando navegador...');

  // Iniciar navegador
  const browser = await chromium.launch({
    headless: false, // Mude para true para não mostrar o navegador
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });

  const page = await context.newPage();

  try {
    console.log('📄 Navegando para example.com...');
    await page.goto('https://example.com');

    // Aguardar página carregar
    await page.waitForLoadState('domcontentloaded');

    // Extrair informações
    const title = await page.title();
    const heading = await page.locator('h1').textContent();
    const paragraph = await page.locator('p').first().textContent();

    console.log('\n✅ Dados extraídos:');
    console.log('Título:', title);
    console.log('Heading:', heading);
    console.log('Parágrafo:', paragraph);

    // Exemplo de interação
    console.log('\n🔗 Clicando no link "More information"...');
    await page.click('a:has-text("More information")');
    await page.waitForLoadState('networkidle');

    const newUrl = page.url();
    console.log('Nova URL:', newUrl);

    // Tirar screenshot
    await page.screenshot({ path: 'screenshot.png' });
    console.log('\n📸 Screenshot salvo como screenshot.png');

  } catch (error) {
    console.error('❌ Erro durante a execução:', error);
  } finally {
    console.log('\n🔚 Fechando navegador...');
    await browser.close();
  }
}

// Executar
main().catch(console.error);
