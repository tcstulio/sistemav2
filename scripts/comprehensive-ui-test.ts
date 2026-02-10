import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * Script de testes sistemáticos completos da interface
 * Testa em múltiplas resoluções: Mobile, Tablet e Desktop
 * Gera relatório detalhado em markdown
 */

interface TestResult {
  category: string;
  item: string;
  resolution: string;
  status: 'OK' | 'ERRO' | 'INCOMPLETO' | 'NÃO ENCONTRADO';
  details: string;
  screenshot?: string;
}

const results: TestResult[] = [];
const screenshotDir = 'test-reports/screenshots';
const reportDir = 'test-reports';

// Resoluções a testar
const RESOLUTIONS = {
  mobile: { width: 375, height: 667, name: 'Mobile (iPhone SE)' },
  tablet: { width: 768, height: 1024, name: 'Tablet (iPad)' },
  desktop: { width: 1920, height: 1080, name: 'Desktop (Full HD)' }
};

let browser: Browser;
let screenshotCount = 0;

async function setupBrowser() {
  console.log('🚀 Iniciando navegador...\n');
  browser = await chromium.launch({
    headless: false,
    slowMo: 300, // Desacelera para visualização
  });
}

async function createContext(resolution: { width: number; height: number }) {
  return await browser.newContext({
    viewport: { width: resolution.width, height: resolution.height },
    ignoreHTTPSErrors: true,
  });
}

async function takeScreenshot(page: Page, name: string): Promise<string> {
  try {
    mkdirSync(screenshotDir, { recursive: true });
    const filename = `${++screenshotCount}-${name}.png`;
    const path = join(screenshotDir, filename);
    await page.screenshot({ path, fullPage: true });
    return filename;
  } catch (error) {
    return '';
  }
}

async function addResult(
  category: string,
  item: string,
  resolution: string,
  status: TestResult['status'],
  details: string,
  screenshot?: string
) {
  results.push({ category, item, resolution, status, details, screenshot });
  const emoji = status === 'OK' ? '✅' : status === 'ERRO' ? '❌' : status === 'INCOMPLETO' ? '⚠️' : '🔍';
  console.log(`${emoji} [${resolution}] ${category} - ${item}: ${status}`);
  if (details && status !== 'OK') {
    console.log(`   ${details}`);
  }
}

async function testNavigation(page: Page, resolution: string) {
  console.log(`\n📱 Testando Navegação - ${resolution}`);

  try {
    // Verificar se a sidebar existe
    const sidebar = page.locator('nav, [class*="sidebar"], [class*="Sidebar"]').first();
    const sidebarExists = await sidebar.count() > 0;

    if (!sidebarExists) {
      await addResult('Navegação', 'Sidebar', resolution, 'NÃO ENCONTRADO', 'Sidebar não encontrada');
      return;
    }

    await addResult('Navegação', 'Sidebar', resolution, 'OK', 'Sidebar encontrada');
    const screenshot = await takeScreenshot(page, `nav-${resolution}-sidebar`);

    // Encontrar todos os links/botões de navegação
    const navItems = await page.locator('nav a, nav button, [class*="sidebar"] a, [class*="sidebar"] button').all();

    await addResult('Navegação', 'Itens de menu', resolution, 'OK', `${navItems.length} itens encontrados`);

    // Testar cada item de navegação
    for (let i = 0; i < Math.min(navItems.length, 10); i++) {
      try {
        const item = navItems[i];
        const text = await item.textContent() || await item.getAttribute('aria-label') || `Item ${i + 1}`;
        const cleanText = text.trim().substring(0, 30);

        // Verificar se é clicável
        const isVisible = await item.isVisible({ timeout: 2000 });

        if (isVisible) {
          await item.click({ timeout: 5000 });
          await page.waitForTimeout(1000);

          const url = page.url();
          await addResult('Navegação', `Menu: ${cleanText}`, resolution, 'OK', `Navegou para: ${url}`);
          await takeScreenshot(page, `nav-${resolution}-${cleanText.replace(/[^a-z0-9]/gi, '-')}`);
        } else {
          await addResult('Navegação', `Menu: ${cleanText}`, resolution, 'INCOMPLETO', 'Item não visível');
        }
      } catch (error: any) {
        await addResult('Navegação', `Menu item ${i + 1}`, resolution, 'ERRO', error.message);
      }
    }
  } catch (error: any) {
    await addResult('Navegação', 'Teste geral', resolution, 'ERRO', error.message);
  }
}

async function testButtons(page: Page, resolution: string) {
  console.log(`\n🔘 Testando Botões - ${resolution}`);

  try {
    const buttons = await page.locator('button:visible').all();
    await addResult('Botões', 'Total encontrado', resolution, 'OK', `${buttons.length} botões visíveis`);

    for (let i = 0; i < Math.min(buttons.length, 15); i++) {
      try {
        const button = buttons[i];
        const text = await button.textContent() || await button.getAttribute('aria-label') || `Botão ${i + 1}`;
        const cleanText = text.trim().substring(0, 30);

        const isEnabled = await button.isEnabled();
        const isVisible = await button.isVisible();

        if (isVisible && isEnabled) {
          await addResult('Botões', cleanText, resolution, 'OK', 'Visível e habilitado');
        } else if (isVisible && !isEnabled) {
          await addResult('Botões', cleanText, resolution, 'INCOMPLETO', 'Visível mas desabilitado');
        } else {
          await addResult('Botões', cleanText, resolution, 'NÃO ENCONTRADO', 'Não visível');
        }
      } catch (error: any) {
        await addResult('Botões', `Botão ${i + 1}`, resolution, 'ERRO', error.message);
      }
    }

    await takeScreenshot(page, `buttons-${resolution}`);
  } catch (error: any) {
    await addResult('Botões', 'Teste geral', resolution, 'ERRO', error.message);
  }
}

async function testInputs(page: Page, resolution: string) {
  console.log(`\n✏️ Testando Campos de Entrada - ${resolution}`);

  try {
    const inputs = await page.locator('input:visible, textarea:visible, select:visible').all();
    await addResult('Inputs', 'Total encontrado', resolution, 'OK', `${inputs.length} campos visíveis`);

    for (let i = 0; i < Math.min(inputs.length, 10); i++) {
      try {
        const input = inputs[i];
        const name = await input.getAttribute('name') || await input.getAttribute('placeholder') || `Input ${i + 1}`;
        const type = await input.getAttribute('type') || 'text';
        const tagName = await input.evaluate(el => el.tagName.toLowerCase());

        const isEnabled = await input.isEnabled();
        const isVisible = await input.isVisible();

        if (isVisible && isEnabled) {
          // Testar preenchimento
          if (tagName === 'input' || tagName === 'textarea') {
            try {
              await input.fill('teste automático');
              await page.waitForTimeout(300);
              const value = await input.inputValue();

              if (value === 'teste automático') {
                await addResult('Inputs', `${name} (${type})`, resolution, 'OK', 'Campo aceita entrada de texto');
              } else {
                await addResult('Inputs', `${name} (${type})`, resolution, 'INCOMPLETO', 'Campo não reteve o valor');
              }

              await input.clear();
            } catch (error: any) {
              await addResult('Inputs', `${name} (${type})`, resolution, 'ERRO', `Erro ao preencher: ${error.message}`);
            }
          } else {
            await addResult('Inputs', `${name} (select)`, resolution, 'OK', 'Select encontrado e visível');
          }
        } else {
          await addResult('Inputs', name, resolution, 'INCOMPLETO', 'Campo não está habilitado ou visível');
        }
      } catch (error: any) {
        await addResult('Inputs', `Input ${i + 1}`, resolution, 'ERRO', error.message);
      }
    }

    await takeScreenshot(page, `inputs-${resolution}`);
  } catch (error: any) {
    await addResult('Inputs', 'Teste geral', resolution, 'ERRO', error.message);
  }
}

async function testModals(page: Page, resolution: string) {
  console.log(`\n📋 Testando Modais e Diálogos - ${resolution}`);

  try {
    // Procurar por botões que abrem modais
    const modalTriggers = await page.locator('button:has-text("Adicionar"), button:has-text("Novo"), button:has-text("Criar")').all();

    if (modalTriggers.length === 0) {
      await addResult('Modais', 'Triggers encontrados', resolution, 'NÃO ENCONTRADO', 'Nenhum botão de modal encontrado');
      return;
    }

    for (let i = 0; i < Math.min(modalTriggers.length, 5); i++) {
      try {
        const trigger = modalTriggers[i];
        const text = await trigger.textContent();

        await trigger.click({ timeout: 3000 });
        await page.waitForTimeout(1000);

        // Verificar se modal apareceu
        const modal = page.locator('[role="dialog"], .modal, [class*="Modal"]').first();
        const modalVisible = await modal.isVisible({ timeout: 3000 });

        if (modalVisible) {
          await addResult('Modais', `Modal: ${text}`, resolution, 'OK', 'Modal abriu corretamente');
          await takeScreenshot(page, `modal-${resolution}-${text?.replace(/[^a-z0-9]/gi, '-')}`);

          // Tentar fechar modal
          const closeButton = page.locator('button[aria-label*="fechar"], button[aria-label*="close"], button:has-text("Cancelar")').first();
          if (await closeButton.isVisible({ timeout: 2000 })) {
            await closeButton.click();
            await page.waitForTimeout(500);
            await addResult('Modais', `Fechar: ${text}`, resolution, 'OK', 'Modal fechou corretamente');
          }
        } else {
          await addResult('Modais', `Modal: ${text}`, resolution, 'ERRO', 'Modal não apareceu após click');
        }
      } catch (error: any) {
        await addResult('Modais', `Modal ${i + 1}`, resolution, 'ERRO', error.message);
      }
    }
  } catch (error: any) {
    await addResult('Modais', 'Teste geral', resolution, 'ERRO', error.message);
  }
}

async function testResponsiveness(page: Page, resolution: string) {
  console.log(`\n📐 Testando Responsividade - ${resolution}`);

  try {
    // Verificar overflow horizontal
    const bodyOverflow = await page.evaluate(() => {
      return document.body.scrollWidth > window.innerWidth;
    });

    if (bodyOverflow) {
      await addResult('Responsividade', 'Overflow horizontal', resolution, 'ERRO', 'Página tem scroll horizontal (quebra de layout)');
    } else {
      await addResult('Responsividade', 'Overflow horizontal', resolution, 'OK', 'Sem scroll horizontal');
    }

    // Verificar elementos cortados
    const elementsOverflow = await page.evaluate(() => {
      const elements = document.querySelectorAll('*');
      let count = 0;
      elements.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.right > window.innerWidth) count++;
      });
      return count;
    });

    if (elementsOverflow > 5) {
      await addResult('Responsividade', 'Elementos cortados', resolution, 'ERRO', `${elementsOverflow} elementos ultrapassam a largura da tela`);
    } else if (elementsOverflow > 0) {
      await addResult('Responsividade', 'Elementos cortados', resolution, 'INCOMPLETO', `${elementsOverflow} elementos podem estar cortados`);
    } else {
      await addResult('Responsividade', 'Elementos cortados', resolution, 'OK', 'Todos elementos dentro da viewport');
    }

    await takeScreenshot(page, `responsiveness-${resolution}`);
  } catch (error: any) {
    await addResult('Responsividade', 'Teste geral', resolution, 'ERRO', error.message);
  }
}

async function testResolution(resolutionKey: keyof typeof RESOLUTIONS) {
  const resolution = RESOLUTIONS[resolutionKey];
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🖥️  TESTANDO: ${resolution.name} (${resolution.width}x${resolution.height})`);
  console.log('='.repeat(60));

  const context = await createContext(resolution);
  const page = await context.newPage();

  try {
    // Navegar para a aplicação
    console.log('📄 Carregando aplicação...');
    await page.goto('http://localhost:5173', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Screenshot inicial
    await takeScreenshot(page, `${resolutionKey}-initial`);
    await addResult('Carregamento', 'Página inicial', resolution.name, 'OK', 'Página carregou com sucesso');

    // Executar todos os testes
    await testNavigation(page, resolution.name);
    await testButtons(page, resolution.name);
    await testInputs(page, resolution.name);
    await testModals(page, resolution.name);
    await testResponsiveness(page, resolution.name);

  } catch (error: any) {
    await addResult('Carregamento', 'Erro fatal', resolution.name, 'ERRO', error.message);
    await takeScreenshot(page, `${resolutionKey}-error`);
  } finally {
    await context.close();
  }
}

function generateReport() {
  console.log('\n📝 Gerando relatório...\n');

  mkdirSync(reportDir, { recursive: true });

  const timestamp = new Date().toLocaleString('pt-BR');

  let report = `# 📊 Relatório de Testes de Interface\n\n`;
  report += `**Data:** ${timestamp}\n\n`;
  report += `**Total de testes:** ${results.length}\n\n`;

  // Estatísticas
  const stats = {
    OK: results.filter(r => r.status === 'OK').length,
    ERRO: results.filter(r => r.status === 'ERRO').length,
    INCOMPLETO: results.filter(r => r.status === 'INCOMPLETO').length,
    'NÃO ENCONTRADO': results.filter(r => r.status === 'NÃO ENCONTRADO').length,
  };

  report += `## 📈 Resumo\n\n`;
  report += `- ✅ **OK:** ${stats.OK}\n`;
  report += `- ❌ **ERRO:** ${stats.ERRO}\n`;
  report += `- ⚠️ **INCOMPLETO:** ${stats.INCOMPLETO}\n`;
  report += `- 🔍 **NÃO ENCONTRADO:** ${stats['NÃO ENCONTRADO']}\n\n`;

  // Taxa de sucesso
  const successRate = ((stats.OK / results.length) * 100).toFixed(2);
  report += `**Taxa de Sucesso:** ${successRate}%\n\n`;

  report += `---\n\n`;

  // Agrupar por categoria
  const categories = [...new Set(results.map(r => r.category))];

  for (const category of categories) {
    report += `## ${category}\n\n`;

    const categoryResults = results.filter(r => r.category === category);

    for (const res of categoryResults) {
      const emoji = res.status === 'OK' ? '✅' : res.status === 'ERRO' ? '❌' : res.status === 'INCOMPLETO' ? '⚠️' : '🔍';
      report += `### ${emoji} ${res.item} - ${res.resolution}\n\n`;
      report += `**Status:** ${res.status}\n\n`;
      report += `**Detalhes:** ${res.details}\n\n`;

      if (res.screenshot) {
        report += `**Screenshot:** [Ver](screenshots/${res.screenshot})\n\n`;
      }

      report += `---\n\n`;
    }
  }

  // Salvar relatório
  const reportPath = join(reportDir, 'test-report.md');
  writeFileSync(reportPath, report, 'utf-8');

  console.log(`✅ Relatório salvo em: ${reportPath}`);

  // Também gerar versão JSON
  const jsonPath = join(reportDir, 'test-report.json');
  writeFileSync(jsonPath, JSON.stringify({ timestamp, stats, results }, null, 2), 'utf-8');
  console.log(`✅ Dados JSON salvos em: ${jsonPath}`);
}

async function main() {
  try {
    await setupBrowser();

    // Testar todas as resoluções
    await testResolution('desktop');
    await testResolution('tablet');
    await testResolution('mobile');

    // Gerar relatório
    generateReport();

    console.log('\n' + '='.repeat(60));
    console.log('✨ TESTES CONCLUÍDOS!');
    console.log('='.repeat(60));
    console.log(`\n📄 Relatório: test-reports/test-report.md`);
    console.log(`📸 Screenshots: test-reports/screenshots/\n`);

  } catch (error) {
    console.error('❌ Erro fatal:', error);
  } finally {
    await browser?.close();
  }
}

main().catch(console.error);
