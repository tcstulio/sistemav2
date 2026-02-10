import { chromium, Browser, Page } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * EXPLORAÇÃO COMPLETA DE TODAS AS PÁGINAS
 *
 * Este script navega sistematicamente por TODAS as seções do sistema:
 * 1. Faz login
 * 2. Encontra todos os itens do menu
 * 3. Clica em cada um
 * 4. Tira screenshots de todas as páginas
 * 5. Testa interações básicas em cada página
 */

const CONFIG = {
  url: 'https://app.coolgroove.com.br',
  credentials: {
    username: 'tulio.silva',
    password: '123Eumesmo!2'
  },
  slowMo: 300,
  screenshotDir: 'test-reports/coolgroove-exploration/screenshots',
  reportDir: 'test-reports/coolgroove-exploration'
};

interface PageExploration {
  menuItem: string;
  url: string;
  screenshot: string;
  buttons: number;
  inputs: number;
  tables: number;
  modals: number;
  errors: string[];
  status: 'OK' | 'ERRO' | 'PARCIAL';
}

let browser: Browser;
let screenshotCount = 0;
const explorations: PageExploration[] = [];

async function takeScreenshot(page: Page, name: string): Promise<string> {
  try {
    mkdirSync(CONFIG.screenshotDir, { recursive: true });
    const filename = `${++screenshotCount}-${name}.png`;
    const path = join(CONFIG.screenshotDir, filename);
    await page.screenshot({ path, fullPage: true });
    console.log(`  📸 Screenshot: ${filename}`);
    return filename;
  } catch (error) {
    return '';
  }
}

async function login(page: Page): Promise<boolean> {
  console.log('\n🔐 Fazendo login...');

  try {
    await page.goto(CONFIG.url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Encontrar e preencher campos
    const usernameSelectors = [
      'input[placeholder*="admin" i]',
      'input[placeholder*="usuário" i]',
      'input[type="text"]:not([type="password"])',
      'input:not([type="password"])'
    ];

    let usernameField = null;
    for (const selector of usernameSelectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        usernameField = page.locator(selector).first();
        console.log(`  ✓ Campo de usuário: ${selector}`);
        break;
      }
    }

    const passwordField = page.locator('input[type="password"]').first();
    const loginButton = page.locator('button[type="submit"]').first();

    if (!usernameField) {
      console.log('❌ Campo de usuário não encontrado');
      await takeScreenshot(page, 'login-error-no-username-field');
      return false;
    }

    await usernameField.fill(CONFIG.credentials.username);
    await page.waitForTimeout(500);
    await passwordField.fill(CONFIG.credentials.password);
    await page.waitForTimeout(500);
    await loginButton.click();

    await page.waitForTimeout(3000);

    const stillHasPassword = await page.locator('input[type="password"]').count() > 0;

    if (stillHasPassword) {
      console.log('❌ Login falhou');
      return false;
    }

    console.log('✅ Login bem-sucedido!');
    return true;

  } catch (error) {
    console.log('❌ Erro no login:', (error as Error).message);
    return false;
  }
}

async function exploreMenuItems(page: Page) {
  console.log('\n🗺️  Explorando todos os itens do menu...\n');

  // Encontrar botões do menu lateral
  const menuButtons = await page.locator('nav button, aside button, [class*="sidebar"] button').all();

  console.log(`📋 Encontrados ${menuButtons.length} botões no menu\n`);

  const menuItems: { text: string; button: any }[] = [];

  // Coletar textos dos botões
  for (const button of menuButtons) {
    const text = (await button.textContent())?.trim() || '';
    if (text.length >= 3) {  // Ignorar botões vazios/ícones
      menuItems.push({ text, button });
    }
  }

  console.log(`🎯 ${menuItems.length} itens válidos para explorar\n`);
  console.log('═'.repeat(80) + '\n');

  // Explorar cada item do menu
  for (let i = 0; i < menuItems.length; i++) {
    const { text, button } = menuItems[i];

    console.log(`\n[${i + 1}/${menuItems.length}] 🔍 Explorando: ${text}`);
    console.log('─'.repeat(60));

    const exploration: PageExploration = {
      menuItem: text,
      url: '',
      screenshot: '',
      buttons: 0,
      inputs: 0,
      tables: 0,
      modals: 0,
      errors: [],
      status: 'OK'
    };

    try {
      // Garantir que o botão está visível
      await button.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);

      // Clicar no item do menu
      await button.click({ timeout: 5000 });
      await page.waitForTimeout(2000);

      // Aguardar página carregar
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1000);

      exploration.url = page.url();
      console.log(`  🌐 URL: ${exploration.url}`);

      // Tirar screenshot da página
      exploration.screenshot = await takeScreenshot(page, `page-${i + 1}-${text.replace(/[^a-z0-9]/gi, '-')}`);

      // Contar elementos na página
      exploration.buttons = await page.locator('button:visible').count();
      exploration.inputs = await page.locator('input:visible, textarea:visible, select:visible').count();
      exploration.tables = await page.locator('table:visible').count();

      console.log(`  🔘 Botões: ${exploration.buttons}`);
      console.log(`  ✏️  Inputs: ${exploration.inputs}`);
      console.log(`  📊 Tabelas: ${exploration.tables}`);

      // Tentar encontrar modais (botões que abrem modais)
      const modalTriggers = await page.locator('button:has-text("Adicionar"), button:has-text("Novo"), button:has-text("Criar")').count();
      exploration.modals = modalTriggers;
      console.log(`  📋 Modais potenciais: ${modalTriggers}`);

      // Se há botão de "Adicionar/Novo", testar abertura de modal
      if (modalTriggers > 0) {
        try {
          const addButton = page.locator('button:has-text("Adicionar"), button:has-text("Novo"), button:has-text("Criar")').first();
          await addButton.click({ timeout: 3000 });
          await page.waitForTimeout(1500);

          const modalVisible = await page.locator('[role="dialog"], .modal, [class*="Modal"]').isVisible({ timeout: 2000 }).catch(() => false);

          if (modalVisible) {
            console.log(`  ✅ Modal abriu com sucesso`);
            const modalScreenshot = await takeScreenshot(page, `modal-${i + 1}-${text.replace(/[^a-z0-9]/gi, '-')}`);

            // Fechar modal
            const closeButton = page.locator('[aria-label*="fechar" i], [aria-label*="close" i], button:has-text("Cancelar")').first();
            if (await closeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
              await closeButton.click();
              await page.waitForTimeout(500);
            }
          } else {
            console.log(`  ⚠️  Modal não abriu`);
          }
        } catch (error) {
          console.log(`  ⚠️  Erro ao testar modal: ${(error as Error).message.substring(0, 50)}`);
        }
      }

      // Se há tabela, tentar testar paginação
      if (exploration.tables > 0) {
        const paginationButtons = await page.locator('[class*="pagination"] button, button:has-text("Próximo"), button:has-text("Anterior")').count();
        if (paginationButtons > 0) {
          console.log(`  📄 Paginação encontrada`);
        }
      }

      console.log(`  ✅ Exploração concluída`);

    } catch (error) {
      exploration.status = 'ERRO';
      exploration.errors.push((error as Error).message);
      console.log(`  ❌ Erro: ${(error as Error).message}`);
    }

    explorations.push(exploration);
  }
}

function generateReport() {
  console.log('\n' + '═'.repeat(80));
  console.log('📝 GERANDO RELATÓRIO DE EXPLORAÇÃO');
  console.log('═'.repeat(80) + '\n');

  mkdirSync(CONFIG.reportDir, { recursive: true });

  const timestamp = new Date().toLocaleString('pt-BR');
  const totalPages = explorations.length;
  const successfulPages = explorations.filter(e => e.status === 'OK').length;

  let report = `# 🗺️ Relatório de Exploração Completa - app.coolgroove.com.br\n\n`;
  report += `**Data:** ${timestamp}\n`;
  report += `**Total de páginas exploradas:** ${totalPages}\n`;
  report += `**Páginas com sucesso:** ${successfulPages} (${((successfulPages / totalPages) * 100).toFixed(1)}%)\n\n`;

  report += `---\n\n`;

  report += `## 📊 Resumo por Página\n\n`;
  report += `| # | Página | Status | Botões | Inputs | Tabelas | Modais | Screenshot |\n`;
  report += `|---|--------|--------|--------|--------|---------|--------|-----------|\n`;

  explorations.forEach((exp, i) => {
    const statusEmoji = exp.status === 'OK' ? '✅' : '❌';
    report += `| ${i + 1} | ${exp.menuItem} | ${statusEmoji} | ${exp.buttons} | ${exp.inputs} | ${exp.tables} | ${exp.modals} | [Ver](screenshots/${exp.screenshot}) |\n`;
  });

  report += `\n---\n\n`;

  // Detalhes de cada página
  report += `## 📄 Detalhes das Páginas\n\n`;

  explorations.forEach((exp, i) => {
    const statusEmoji = exp.status === 'OK' ? '✅' : '❌';
    report += `### ${statusEmoji} ${i + 1}. ${exp.menuItem}\n\n`;
    report += `**URL:** ${exp.url}\n\n`;
    report += `**Elementos encontrados:**\n`;
    report += `- 🔘 Botões: ${exp.buttons}\n`;
    report += `- ✏️  Inputs: ${exp.inputs}\n`;
    report += `- 📊 Tabelas: ${exp.tables}\n`;
    report += `- 📋 Modais: ${exp.modals}\n\n`;

    if (exp.screenshot) {
      report += `**Screenshot:** [Ver tela completa](screenshots/${exp.screenshot})\n\n`;
    }

    if (exp.errors.length > 0) {
      report += `**Erros:**\n`;
      exp.errors.forEach(err => report += `- ${err}\n`);
      report += `\n`;
    }

    report += `---\n\n`;
  });

  // Estatísticas gerais
  const totalButtons = explorations.reduce((sum, e) => sum + e.buttons, 0);
  const totalInputs = explorations.reduce((sum, e) => sum + e.inputs, 0);
  const totalTables = explorations.reduce((sum, e) => sum + e.tables, 0);
  const totalModals = explorations.reduce((sum, e) => sum + e.modals, 0);

  report += `## 📈 Estatísticas Gerais\n\n`;
  report += `- **Total de páginas:** ${totalPages}\n`;
  report += `- **Total de botões:** ${totalButtons}\n`;
  report += `- **Total de inputs:** ${totalInputs}\n`;
  report += `- **Total de tabelas:** ${totalTables}\n`;
  report += `- **Total de modais:** ${totalModals}\n`;
  report += `- **Screenshots capturados:** ${screenshotCount}\n\n`;

  // Salvar relatório
  const reportPath = join(CONFIG.reportDir, 'exploration-report.md');
  writeFileSync(reportPath, report, 'utf-8');

  // Salvar JSON
  const jsonPath = join(CONFIG.reportDir, 'exploration-report.json');
  writeFileSync(jsonPath, JSON.stringify({
    timestamp,
    totalPages,
    successfulPages,
    explorations,
    stats: {
      totalButtons,
      totalInputs,
      totalTables,
      totalModals,
      totalScreenshots: screenshotCount
    }
  }, null, 2), 'utf-8');

  console.log(`✅ Relatório salvo: ${reportPath}`);
  console.log(`✅ JSON salvo: ${jsonPath}`);
  console.log(`📸 Screenshots: ${CONFIG.screenshotDir}`);
}

async function main() {
  console.log('\n' + '█'.repeat(80));
  console.log('█  🗺️  EXPLORAÇÃO COMPLETA DE TODAS AS PÁGINAS');
  console.log('█  app.coolgroove.com.br');
  console.log('█'.repeat(80));

  try {
    console.log('\n🚀 Iniciando navegador...');
    browser = await chromium.launch({
      headless: false,
      slowMo: CONFIG.slowMo,
    });

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
    });

    const page = await context.newPage();

    // Login
    const loginSuccess = await login(page);
    if (!loginSuccess) {
      console.log('\n❌ Login falhou. Encerrando...');
      await browser.close();
      return;
    }

    // Explorar todas as páginas
    await exploreMenuItems(page);

    // Gerar relatório
    generateReport();

    console.log('\n' + '█'.repeat(80));
    console.log('█  ✨ EXPLORAÇÃO CONCLUÍDA!');
    console.log('█'.repeat(80) + '\n');

    console.log(`📊 Resumo:`);
    console.log(`   Páginas exploradas: ${explorations.length}`);
    console.log(`   Screenshots: ${screenshotCount}`);
    console.log(`   Sucesso: ${explorations.filter(e => e.status === 'OK').length}/${explorations.length}\n`);

  } catch (error) {
    console.error('\n💥 ERRO FATAL:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main().catch(console.error);
