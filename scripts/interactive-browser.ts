import { chromium } from 'playwright';

/**
 * Navegador interativo - Mantém aberto para você explorar manualmente
 * Execute com: npm run browser
 */

async function main() {
  console.log('🚀 Iniciando navegador interativo...\n');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 100, // Pequeno delay para melhor visualização
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // Comandos úteis que você pode descomentar:

  // 1. Navegar para seu app local
  await page.goto('http://localhost:5173');

  // 2. Ou usar o codegen para gravar suas ações:
  // Execute: npm run playwright:codegen http://localhost:5173

  console.log('📌 Dicas:');
  console.log('  - O navegador está aberto e sob controle do Playwright');
  console.log('  - Edite este arquivo para adicionar automações');
  console.log('  - Use page.screenshot() para tirar prints');
  console.log('  - Use page.click(), page.fill(), etc para interagir\n');

  console.log('⏸️  Navegador ficará aberto. Pressione Ctrl+C no terminal para fechar.\n');

  // Expor funções úteis no console
  (global as any).page = page;
  (global as any).screenshot = async (name: string = 'screenshot') => {
    await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
    console.log(`📸 Screenshot salvo: screenshots/${name}.png`);
  };

  console.log('💡 Funções disponíveis no código:');
  console.log('  - screenshot("nome") - Tira um print da página\n');

  // Exemplo de automação que você pode descomentar:
  /*
  // Aguardar e clicar em um botão
  await page.click('button:has-text("Login")');

  // Preencher formulário
  await page.fill('input[name="email"]', 'teste@example.com');
  await page.fill('input[name="password"]', 'senha123');

  // Tirar screenshot
  await page.screenshot({ path: 'screenshots/login-form.png' });

  // Clicar e aguardar navegação
  await Promise.all([
    page.waitForNavigation(),
    page.click('button[type="submit"]')
  ]);
  */

  // Manter aberto por muito tempo
  await page.waitForTimeout(300000); // 5 minutos
}

main().catch(console.error);
