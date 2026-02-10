import { chromium } from 'playwright';

/**
 * Script para testar e tirar screenshots do próprio projeto
 * Execute com: npm run test:app
 */

async function main() {
  console.log('🚀 Iniciando navegador...');

  const browser = await chromium.launch({
    headless: false, // Mostra o navegador
    slowMo: 500, // Desacelera as ações para você ver melhor (500ms)
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    // Aceitar certificados SSL auto-assinados (útil para dev local)
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  try {
    // URL do seu projeto local
    const baseUrl = 'http://localhost:5173'; // Ajuste se necessário

    console.log(`📄 Navegando para ${baseUrl}...`);
    await page.goto(baseUrl, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Aguardar um pouco para garantir que a página carregou
    await page.waitForTimeout(2000);

    // Tirar screenshot da página inicial
    console.log('📸 Tirando screenshot da página inicial...');
    await page.screenshot({
      path: 'screenshots/homepage.png',
      fullPage: true
    });

    // Extrair informações da página
    const title = await page.title();
    console.log('✅ Título da página:', title);

    // Exemplo: Verificar se há elementos específicos
    const sidebar = await page.locator('[class*="sidebar"], nav').count();
    console.log(`📊 Encontrados ${sidebar} elementos de navegação`);

    // Exemplo: Clicar em um link/botão (ajuste o seletor conforme necessário)
    // await page.click('a:has-text("Dashboard")');
    // await page.waitForLoadState('networkidle');
    // await page.screenshot({ path: 'screenshots/dashboard.png', fullPage: true });

    console.log('\n✨ Screenshots salvas em ./screenshots/');
    console.log('💡 Você pode editar este script para navegar pelo seu app!');

    // Manter o navegador aberto para você explorar
    console.log('\n⏸️  Navegador ficará aberto. Pressione Ctrl+C para fechar.');
    await page.waitForTimeout(60000); // Aguarda 60 segundos

  } catch (error: any) {
    console.error('❌ Erro durante a execução:', error.message);

    // Tirar screenshot do erro
    try {
      await page.screenshot({ path: 'screenshots/error.png' });
      console.log('📸 Screenshot do erro salvo em screenshots/error.png');
    } catch {}
  } finally {
    console.log('\n🔚 Fechando navegador...');
    await browser.close();
  }
}

// Executar
main().catch(console.error);
