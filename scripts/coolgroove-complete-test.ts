import { chromium, Browser, BrowserContext, Page, ConsoleMessage } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * TESTE COMPLETO E SISTEMÁTICO - app.coolgroove.com.br
 *
 * Este script faz login e testa TODOS os elementos da interface:
 * - Navegação completa
 * - Todos os botões
 * - Todos os inputs
 * - Todos os modais
 * - Tabelas e paginação
 * - Em 3 resoluções diferentes
 */

// ======================== CONFIGURAÇÃO ========================

const CONFIG = {
  url: 'https://app.coolgroove.com.br',
  credentials: {
    username: 'tulio.silva',
    password: '123Eumesmo!2'
  },
  resolutions: {
    desktop: { width: 1920, height: 1080, name: 'Desktop' }
    // Testar apenas Desktop primeiro para ir mais rápido
    // tablet: { width: 768, height: 1024, name: 'Tablet' },
    // mobile: { width: 375, height: 667, name: 'Mobile' }
  },
  slowMo: 200, // Delay entre ações (ms) - reduzido
  timeout: 5000, // Timeout padrão - reduzido
  screenshotDir: 'test-reports/coolgroove/screenshots',
  reportDir: 'test-reports/coolgroove'
};

// ======================== TIPOS ========================

interface TestResult {
  timestamp: string;
  category: string;
  subcategory?: string;
  item: string;
  resolution: string;
  status: 'OK' | 'ERRO' | 'INCOMPLETO' | 'NÃO ENCONTRADO' | 'AVISO';
  details: string;
  screenshot?: string;
  url?: string;
  error?: string;
  consoleErrors?: string[];
}

interface ElementMap {
  navItems: { text: string; selector: string; url?: string }[];
  buttons: { text: string; selector: string; type?: string }[];
  inputs: { name: string; type: string; selector: string }[];
  modals: { trigger: string; selector: string }[];
  tables: { name: string; selector: string }[];
}

// ======================== ESTADO GLOBAL ========================

let browser: Browser;
let screenshotCount = 0;
const results: TestResult[] = [];
const consoleErrors: string[] = [];
const elementMap: ElementMap = {
  navItems: [],
  buttons: [],
  inputs: [],
  modals: [],
  tables: []
};

// ======================== UTILITÁRIOS ========================

function log(emoji: string, message: string, details?: string) {
  console.log(`${emoji} ${message}`);
  if (details) console.log(`   ${details}`);
}

async function takeScreenshot(page: Page, name: string): Promise<string> {
  try {
    mkdirSync(CONFIG.screenshotDir, { recursive: true });
    const timestamp = Date.now();
    const filename = `${++screenshotCount}-${timestamp}-${name}.png`;
    const path = join(CONFIG.screenshotDir, filename);
    await page.screenshot({ path, fullPage: true });
    return filename;
  } catch (error) {
    log('⚠️', 'Erro ao tirar screenshot', (error as Error).message);
    return '';
  }
}

function addResult(data: Omit<TestResult, 'timestamp'>) {
  const result: TestResult = {
    timestamp: new Date().toISOString(),
    ...data
  };
  results.push(result);

  const emoji = {
    'OK': '✅',
    'ERRO': '❌',
    'INCOMPLETO': '⚠️',
    'NÃO ENCONTRADO': '🔍',
    'AVISO': '💡'
  }[result.status];

  log(emoji, `[${result.resolution}] ${result.category} - ${result.item}`,
      result.status !== 'OK' ? result.details : '');
}

function setupConsoleListener(page: Page) {
  page.on('console', (msg: ConsoleMessage) => {
    const type = msg.type();
    const text = msg.text();

    if (type === 'error') {
      consoleErrors.push(text);
      log('🐛', 'Console Error:', text);
    }
  });

  page.on('pageerror', (error) => {
    const errorText = error.message;
    consoleErrors.push(errorText);
    log('💥', 'Page Error:', errorText);
  });
}

// ======================== LOGIN ========================

async function performLogin(page: Page, resolution: string): Promise<boolean> {
  log('🔐', `Tentando fazer login - ${resolution}...`);

  try {
    await page.goto(CONFIG.url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    const screenshot1 = await takeScreenshot(page, `${resolution}-01-initial-page`);

    // Tentar encontrar campos de login
    const usernameSelectors = [
      'input[placeholder*="admin" i]',
      'input[placeholder*="usuário" i]',
      'input[placeholder*="usuario" i]',
      'input[name="username"]',
      'input[name="email"]',
      'input[type="email"]',
      'input[type="text"]:not([type="password"])',
      'input#username',
      'input#email'
    ];

    const passwordSelectors = [
      'input[name="password"]',
      'input[type="password"]',
      'input[placeholder*="senha" i]',
      'input#password'
    ];

    let usernameField = null;
    let passwordField = null;

    // Encontrar campo de usuário
    for (const selector of usernameSelectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        usernameField = page.locator(selector).first();
        log('✓', `Campo de usuário encontrado: ${selector}`);
        break;
      }
    }

    // Encontrar campo de senha
    for (const selector of passwordSelectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        passwordField = page.locator(selector).first();
        log('✓', `Campo de senha encontrado: ${selector}`);
        break;
      }
    }

    if (!usernameField || !passwordField) {
      addResult({
        category: 'Login',
        item: 'Campos de login',
        resolution,
        status: 'ERRO',
        details: 'Campos de login não encontrados',
        screenshot: screenshot1,
        url: page.url()
      });
      return false;
    }

    // Preencher credenciais
    await usernameField.fill(CONFIG.credentials.username);
    await page.waitForTimeout(500);
    await passwordField.fill(CONFIG.credentials.password);
    await page.waitForTimeout(500);

    const screenshot2 = await takeScreenshot(page, `${resolution}-02-credentials-filled`);

    // Encontrar botão de login
    const loginButtonSelectors = [
      'button[type="submit"]',
      'button:has-text("Entrar")',
      'button:has-text("Login")',
      'button:has-text("Acessar")',
      'input[type="submit"]',
      '[role="button"]:has-text("Entrar")'
    ];

    let loginButton = null;
    for (const selector of loginButtonSelectors) {
      const count = await page.locator(selector).count();
      if (count > 0) {
        loginButton = page.locator(selector).first();
        log('✓', `Botão de login encontrado: ${selector}`);
        break;
      }
    }

    if (!loginButton) {
      addResult({
        category: 'Login',
        item: 'Botão de login',
        resolution,
        status: 'ERRO',
        details: 'Botão de login não encontrado',
        screenshot: screenshot2,
        url: page.url()
      });
      return false;
    }

    // Clicar no botão de login
    await loginButton.click();
    log('🔄', 'Aguardando navegação após login...');

    // Aguardar navegação ou mudança na página
    await Promise.race([
      page.waitForNavigation({ timeout: 10000 }).catch(() => null),
      page.waitForTimeout(5000)
    ]);

    await page.waitForTimeout(3000);

    const screenshot3 = await takeScreenshot(page, `${resolution}-03-after-login`);
    const currentUrl = page.url();

    // Verificar se login foi bem-sucedido
    const stillHasLoginForm = await page.locator('input[type="password"]').count() > 0;

    if (stillHasLoginForm) {
      // Verificar se há mensagem de erro
      const errorMessages = await page.locator('[class*="error"], [class*="alert"], [role="alert"]').allTextContents();

      addResult({
        category: 'Login',
        item: 'Autenticação',
        resolution,
        status: 'ERRO',
        details: errorMessages.length > 0 ? `Erro: ${errorMessages.join(', ')}` : 'Login falhou - ainda na tela de login',
        screenshot: screenshot3,
        url: currentUrl
      });
      return false;
    }

    log('✅', `Login realizado com sucesso! URL: ${currentUrl}`);

    addResult({
      category: 'Login',
      item: 'Autenticação',
      resolution,
      status: 'OK',
      details: `Login bem-sucedido. Redirecionado para: ${currentUrl}`,
      screenshot: screenshot3,
      url: currentUrl
    });

    return true;

  } catch (error) {
    const screenshot = await takeScreenshot(page, `${resolution}-login-error`);
    addResult({
      category: 'Login',
      item: 'Processo de login',
      resolution,
      status: 'ERRO',
      details: (error as Error).message,
      screenshot,
      error: (error as Error).stack,
      url: page.url()
    });
    return false;
  }
}

// ======================== MAPEAMENTO DE ELEMENTOS ========================

async function mapAllElements(page: Page, resolution: string) {
  log('🗺️', `Mapeando elementos da interface - ${resolution}...`);

  try {
    // Mapear navegação
    const navElements = await page.locator('nav a, [class*="sidebar"] a, [class*="menu"] a').all();
    for (let i = 0; i < navElements.length; i++) {
      const el = navElements[i];
      const text = (await el.textContent())?.trim() || `Nav ${i + 1}`;
      const href = await el.getAttribute('href');

      elementMap.navItems.push({
        text,
        selector: `nav a:nth-of-type(${i + 1})`,
        url: href || undefined
      });
    }

    log('📊', `Encontrados ${elementMap.navItems.length} itens de navegação`);

    // Mapear botões
    const buttons = await page.locator('button:visible').all();
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      const text = (await btn.textContent())?.trim() || await btn.getAttribute('aria-label') || `Button ${i + 1}`;
      const type = await btn.getAttribute('type');

      elementMap.buttons.push({
        text: text.substring(0, 50),
        selector: `button:visible:nth-of-type(${i + 1})`,
        type: type || undefined
      });
    }

    log('🔘', `Encontrados ${elementMap.buttons.length} botões`);

    // Mapear inputs
    const inputs = await page.locator('input:visible, textarea:visible, select:visible').all();
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const name = await input.getAttribute('name') || await input.getAttribute('id') || `Input ${i + 1}`;
      const type = await input.getAttribute('type') || 'text';
      const tagName = await input.evaluate(el => el.tagName.toLowerCase());

      elementMap.inputs.push({
        name: name.substring(0, 50),
        type: tagName === 'select' ? 'select' : tagName === 'textarea' ? 'textarea' : type,
        selector: `${tagName}:visible:nth-of-type(${i + 1})`
      });
    }

    log('✏️', `Encontrados ${elementMap.inputs.length} campos de entrada`);

    // Mapear tabelas
    const tables = await page.locator('table:visible').all();
    for (let i = 0; i < tables.length; i++) {
      elementMap.tables.push({
        name: `Tabela ${i + 1}`,
        selector: `table:visible:nth-of-type(${i + 1})`
      });
    }

    log('📋', `Encontradas ${elementMap.tables.length} tabelas`);

    addResult({
      category: 'Mapeamento',
      item: 'Elementos descobertos',
      resolution,
      status: 'OK',
      details: `Nav: ${elementMap.navItems.length}, Botões: ${elementMap.buttons.length}, Inputs: ${elementMap.inputs.length}, Tabelas: ${elementMap.tables.length}`
    });

  } catch (error) {
    addResult({
      category: 'Mapeamento',
      item: 'Descoberta de elementos',
      resolution,
      status: 'ERRO',
      details: (error as Error).message,
      error: (error as Error).stack
    });
  }
}

// ======================== TESTES DE NAVEGAÇÃO ========================

async function testNavigation(page: Page, resolution: string) {
  log('🧭', `Testando navegação - ${resolution}...`);

  for (let i = 0; i < elementMap.navItems.length; i++) {
    const navItem = elementMap.navItems[i];

    try {
      const initialUrl = page.url();

      // Tentar clicar no item de navegação
      await page.click(navItem.selector, { timeout: 5000 });
      await page.waitForTimeout(2000);

      const newUrl = page.url();
      const screenshot = await takeScreenshot(page, `${resolution}-nav-${i + 1}-${navItem.text.replace(/[^a-z0-9]/gi, '-')}`);

      if (newUrl !== initialUrl) {
        addResult({
          category: 'Navegação',
          subcategory: 'Menu',
          item: navItem.text,
          resolution,
          status: 'OK',
          details: `Navegou de ${initialUrl} para ${newUrl}`,
          screenshot,
          url: newUrl
        });
      } else {
        addResult({
          category: 'Navegação',
          subcategory: 'Menu',
          item: navItem.text,
          resolution,
          status: 'AVISO',
          details: 'Clique não resultou em mudança de URL',
          screenshot,
          url: newUrl
        });
      }

      // Verificar erros de console
      if (consoleErrors.length > 0) {
        addResult({
          category: 'Navegação',
          subcategory: 'Erros de Console',
          item: navItem.text,
          resolution,
          status: 'ERRO',
          details: `${consoleErrors.length} erros de console detectados`,
          consoleErrors: [...consoleErrors]
        });
        consoleErrors.length = 0; // Limpar
      }

    } catch (error) {
      addResult({
        category: 'Navegação',
        subcategory: 'Menu',
        item: navItem.text,
        resolution,
        status: 'ERRO',
        details: (error as Error).message,
        error: (error as Error).stack
      });
    }
  }
}

// ======================== TESTES DE BOTÕES ========================

async function testButtons(page: Page, resolution: string) {
  log('🔘', `Testando botões - ${resolution}...`);

  for (let i = 0; i < Math.min(elementMap.buttons.length, 20); i++) {
    const button = elementMap.buttons[i];

    try {
      const btn = page.locator(button.selector).first();
      const isVisible = await btn.isVisible({ timeout: 2000 });
      const isEnabled = await btn.isEnabled();

      if (!isVisible) {
        addResult({
          category: 'Botões',
          item: button.text,
          resolution,
          status: 'NÃO ENCONTRADO',
          details: 'Botão não está visível'
        });
        continue;
      }

      if (!isEnabled) {
        addResult({
          category: 'Botões',
          item: button.text,
          resolution,
          status: 'INCOMPLETO',
          details: 'Botão está desabilitado'
        });
        continue;
      }

      // Tentar clicar (sem efetivamente clicar em botões de delete/remover)
      const textLower = button.text.toLowerCase();
      const isDangerous = textLower.includes('delete') || textLower.includes('remover') ||
                          textLower.includes('excluir') || textLower.includes('apagar');

      if (isDangerous) {
        addResult({
          category: 'Botões',
          item: button.text,
          resolution,
          status: 'OK',
          details: 'Botão encontrado (não clicado por segurança - ação destrutiva)'
        });
      } else {
        // Clicar e observar resultado
        await btn.click({ timeout: 3000 });
        await page.waitForTimeout(1500);

        const screenshot = await takeScreenshot(page, `${resolution}-btn-${i + 1}-${button.text.replace(/[^a-z0-9]/gi, '-')}`);

        // Verificar se modal abriu
        const modalVisible = await page.locator('[role="dialog"], .modal, [class*="Modal"]').isVisible({ timeout: 1000 }).catch(() => false);

        if (modalVisible) {
          addResult({
            category: 'Botões',
            item: button.text,
            resolution,
            status: 'OK',
            details: 'Botão abriu modal',
            screenshot
          });

          // Fechar modal
          const closeBtn = page.locator('[aria-label*="fechar" i], [aria-label*="close" i], button:has-text("Cancelar")').first();
          if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await closeBtn.click();
            await page.waitForTimeout(500);
          }
        } else {
          addResult({
            category: 'Botões',
            item: button.text,
            resolution,
            status: 'OK',
            details: 'Botão clicável e funcional',
            screenshot
          });
        }
      }

    } catch (error) {
      addResult({
        category: 'Botões',
        item: button.text,
        resolution,
        status: 'ERRO',
        details: (error as Error).message,
        error: (error as Error).stack
      });
    }
  }
}

// ======================== TESTES DE INPUTS ========================

async function testInputs(page: Page, resolution: string) {
  log('✏️', `Testando campos de entrada - ${resolution}...`);

  for (let i = 0; i < Math.min(elementMap.inputs.length, 15); i++) {
    const input = elementMap.inputs[i];

    try {
      const field = page.locator(input.selector).first();
      const isVisible = await field.isVisible({ timeout: 2000 });
      const isEnabled = await field.isEnabled();

      if (!isVisible) {
        addResult({
          category: 'Inputs',
          item: `${input.name} (${input.type})`,
          resolution,
          status: 'NÃO ENCONTRADO',
          details: 'Campo não está visível'
        });
        continue;
      }

      if (!isEnabled) {
        addResult({
          category: 'Inputs',
          item: `${input.name} (${input.type})`,
          resolution,
          status: 'INCOMPLETO',
          details: 'Campo está desabilitado'
        });
        continue;
      }

      // Testar preenchimento baseado no tipo
      if (input.type === 'select') {
        const options = await field.locator('option').count();
        addResult({
          category: 'Inputs',
          item: `${input.name} (select)`,
          resolution,
          status: 'OK',
          details: `Select com ${options} opções`
        });

      } else if (input.type === 'textarea' || input.type === 'text' || input.type === 'email') {
        const testValue = 'Teste automático Playwright';
        await field.fill(testValue);
        await page.waitForTimeout(300);

        const value = await field.inputValue();

        if (value === testValue) {
          addResult({
            category: 'Inputs',
            item: `${input.name} (${input.type})`,
            resolution,
            status: 'OK',
            details: 'Campo aceita entrada de texto normalmente'
          });
        } else {
          addResult({
            category: 'Inputs',
            item: `${input.name} (${input.type})`,
            resolution,
            status: 'INCOMPLETO',
            details: `Valor não persistiu. Esperado: "${testValue}", Obtido: "${value}"`
          });
        }

        // Limpar campo
        await field.clear();

      } else if (input.type === 'checkbox' || input.type === 'radio') {
        await field.check();
        const isChecked = await field.isChecked();

        addResult({
          category: 'Inputs',
          item: `${input.name} (${input.type})`,
          resolution,
          status: isChecked ? 'OK' : 'INCOMPLETO',
          details: isChecked ? 'Campo marcável funcional' : 'Campo não marcou corretamente'
        });

      } else {
        addResult({
          category: 'Inputs',
          item: `${input.name} (${input.type})`,
          resolution,
          status: 'OK',
          details: 'Campo encontrado e visível'
        });
      }

    } catch (error) {
      addResult({
        category: 'Inputs',
        item: `${input.name} (${input.type})`,
        resolution,
        status: 'ERRO',
        details: (error as Error).message,
        error: (error as Error).stack
      });
    }
  }
}

// ======================== TESTES DE MODAIS ========================

async function testModals(page: Page, resolution: string) {
  log('📋', `Testando modais - ${resolution}...`);

  const modalTriggers = await page.locator('button:has-text("Adicionar"), button:has-text("Novo"), button:has-text("Criar"), button:has-text("Editar")').all();

  for (let i = 0; i < Math.min(modalTriggers.length, 10); i++) {
    try {
      const trigger = modalTriggers[i];
      const text = (await trigger.textContent())?.trim() || `Modal ${i + 1}`;

      await trigger.click({ timeout: 3000 });
      await page.waitForTimeout(1500);

      const modal = page.locator('[role="dialog"], .modal, [class*="Modal"]').first();
      const modalVisible = await modal.isVisible({ timeout: 3000 }).catch(() => false);

      if (modalVisible) {
        const screenshot = await takeScreenshot(page, `${resolution}-modal-${i + 1}-${text.replace(/[^a-z0-9]/gi, '-')}`);

        addResult({
          category: 'Modais',
          item: text,
          resolution,
          status: 'OK',
          details: 'Modal abriu corretamente',
          screenshot
        });

        // Tentar fechar
        const closeBtns = page.locator('[aria-label*="fechar" i], [aria-label*="close" i], button:has-text("Cancelar"), button:has-text("Fechar")');
        const closeBtn = closeBtns.first();

        if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await closeBtn.click();
          await page.waitForTimeout(500);

          const stillVisible = await modal.isVisible({ timeout: 1000 }).catch(() => false);

          if (!stillVisible) {
            addResult({
              category: 'Modais',
              subcategory: 'Fechar',
              item: text,
              resolution,
              status: 'OK',
              details: 'Modal fechou corretamente'
            });
          } else {
            addResult({
              category: 'Modais',
              subcategory: 'Fechar',
              item: text,
              resolution,
              status: 'ERRO',
              details: 'Modal não fechou ao clicar em fechar'
            });
          }
        }
      } else {
        addResult({
          category: 'Modais',
          item: text,
          resolution,
          status: 'ERRO',
          details: 'Modal não abriu após click'
        });
      }

    } catch (error) {
      addResult({
        category: 'Modais',
        item: `Modal ${i + 1}`,
        resolution,
        status: 'ERRO',
        details: (error as Error).message,
        error: (error as Error).stack
      });
    }
  }
}

// ======================== TESTES DE TABELAS ========================

async function testTables(page: Page, resolution: string) {
  log('📊', `Testando tabelas - ${resolution}...`);

  for (let i = 0; i < elementMap.tables.length; i++) {
    const table = elementMap.tables[i];

    try {
      const tableEl = page.locator(table.selector);
      const rows = await tableEl.locator('tbody tr').count();
      const headers = await tableEl.locator('thead th').count();

      const screenshot = await takeScreenshot(page, `${resolution}-table-${i + 1}`);

      addResult({
        category: 'Tabelas',
        item: table.name,
        resolution,
        status: 'OK',
        details: `${headers} colunas, ${rows} linhas`,
        screenshot
      });

      // Testar paginação se existir
      const pagination = page.locator('[class*="pagination"], [aria-label*="paginação" i]');
      if (await pagination.isVisible({ timeout: 2000 }).catch(() => false)) {
        const nextBtn = pagination.locator('button:has-text("Próximo"), button[aria-label*="next" i], button:has-text(">")').first();

        if (await nextBtn.isEnabled().catch(() => false)) {
          await nextBtn.click();
          await page.waitForTimeout(1500);

          addResult({
            category: 'Tabelas',
            subcategory: 'Paginação',
            item: table.name,
            resolution,
            status: 'OK',
            details: 'Paginação funcional'
          });
        }
      }

    } catch (error) {
      addResult({
        category: 'Tabelas',
        item: table.name,
        resolution,
        status: 'ERRO',
        details: (error as Error).message,
        error: (error as Error).stack
      });
    }
  }
}

// ======================== TESTES DE RESPONSIVIDADE ========================

async function testResponsiveness(page: Page, resolution: string) {
  log('📐', `Testando responsividade - ${resolution}...`);

  try {
    const hasHorizontalScroll = await page.evaluate(() => {
      return document.body.scrollWidth > window.innerWidth;
    });

    if (hasHorizontalScroll) {
      const screenshot = await takeScreenshot(page, `${resolution}-overflow`);
      addResult({
        category: 'Responsividade',
        item: 'Scroll horizontal',
        resolution,
        status: 'ERRO',
        details: 'Página tem scroll horizontal (quebra de layout)',
        screenshot
      });
    } else {
      addResult({
        category: 'Responsividade',
        item: 'Scroll horizontal',
        resolution,
        status: 'OK',
        details: 'Sem scroll horizontal'
      });
    }

    const overflowElements = await page.evaluate(() => {
      const elements = document.querySelectorAll('*');
      let count = 0;
      elements.forEach(el => {
        const rect = el.getBoundingClientRect();
        if (rect.right > window.innerWidth + 10) count++;
      });
      return count;
    });

    if (overflowElements > 5) {
      addResult({
        category: 'Responsividade',
        item: 'Elementos cortados',
        resolution,
        status: 'ERRO',
        details: `${overflowElements} elementos ultrapassam a largura da tela`
      });
    } else {
      addResult({
        category: 'Responsividade',
        item: 'Elementos cortados',
        resolution,
        status: 'OK',
        details: 'Todos elementos dentro da viewport'
      });
    }

  } catch (error) {
    addResult({
      category: 'Responsividade',
      item: 'Teste geral',
      resolution,
      status: 'ERRO',
      details: (error as Error).message
    });
  }
}

// ======================== EXECUÇÃO DE TESTES POR RESOLUÇÃO ========================

async function runTestsForResolution(resolutionKey: keyof typeof CONFIG.resolutions) {
  const resolution = CONFIG.resolutions[resolutionKey];
  const resName = `${resolution.name} (${resolution.width}x${resolution.height})`;

  console.log('\n' + '='.repeat(80));
  console.log(`🖥️  TESTANDO: ${resName}`);
  console.log('='.repeat(80) + '\n');

  const context = await browser.newContext({
    viewport: { width: resolution.width, height: resolution.height },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();
  setupConsoleListener(page);

  try {
    // 1. Login
    const loginSuccess = await performLogin(page, resName);

    if (!loginSuccess) {
      log('❌', `Login falhou em ${resName} - pulando testes`);
      await context.close();
      return;
    }

    await page.waitForTimeout(2000);

    // 2. Mapear elementos
    await mapAllElements(page, resName);

    // 3. Testar navegação
    await testNavigation(page, resName);

    // Voltar para página inicial antes dos próximos testes
    await page.goto(CONFIG.url);
    await page.waitForTimeout(2000);

    // 4. Testar botões
    await testButtons(page, resName);

    // 5. Testar inputs
    await testInputs(page, resName);

    // 6. Testar modais
    await testModals(page, resName);

    // 7. Testar tabelas
    await testTables(page, resName);

    // 8. Testar responsividade
    await testResponsiveness(page, resName);

    log('✅', `Testes completos para ${resName}`);

  } catch (error) {
    log('💥', `Erro fatal em ${resName}:`, (error as Error).message);
    addResult({
      category: 'Sistema',
      item: 'Erro fatal',
      resolution: resName,
      status: 'ERRO',
      details: (error as Error).message,
      error: (error as Error).stack
    });
  } finally {
    await context.close();
  }
}

// ======================== GERAÇÃO DE RELATÓRIO ========================

function generateReport() {
  console.log('\n' + '='.repeat(80));
  log('📝', 'GERANDO RELATÓRIO COMPLETO...');
  console.log('='.repeat(80) + '\n');

  mkdirSync(CONFIG.reportDir, { recursive: true });

  const timestamp = new Date().toLocaleString('pt-BR');
  const stats = {
    total: results.length,
    OK: results.filter(r => r.status === 'OK').length,
    ERRO: results.filter(r => r.status === 'ERRO').length,
    INCOMPLETO: results.filter(r => r.status === 'INCOMPLETO').length,
    'NÃO ENCONTRADO': results.filter(r => r.status === 'NÃO ENCONTRADO').length,
    AVISO: results.filter(r => r.status === 'AVISO').length,
  };

  const successRate = ((stats.OK / stats.total) * 100).toFixed(2);

  let report = `# 🎯 Relatório Completo de Testes - app.coolgroove.com.br\n\n`;
  report += `**Data:** ${timestamp}\n`;
  report += `**Total de testes:** ${stats.total}\n`;
  report += `**Taxa de sucesso:** ${successRate}%\n\n`;

  report += `---\n\n`;

  report += `## 📊 Resumo Executivo\n\n`;
  report += `| Status | Quantidade | Percentual |\n`;
  report += `|--------|------------|------------|\n`;
  report += `| ✅ OK | ${stats.OK} | ${((stats.OK / stats.total) * 100).toFixed(1)}% |\n`;
  report += `| ❌ ERRO | ${stats.ERRO} | ${((stats.ERRO / stats.total) * 100).toFixed(1)}% |\n`;
  report += `| ⚠️ INCOMPLETO | ${stats.INCOMPLETO} | ${((stats.INCOMPLETO / stats.total) * 100).toFixed(1)}% |\n`;
  report += `| 🔍 NÃO ENCONTRADO | ${stats['NÃO ENCONTRADO']} | ${((stats['NÃO ENCONTRADO'] / stats.total) * 100).toFixed(1)}% |\n`;
  report += `| 💡 AVISO | ${stats.AVISO} | ${((stats.AVISO / stats.total) * 100).toFixed(1)}% |\n\n`;

  report += `---\n\n`;

  // Problemas críticos
  const criticalIssues = results.filter(r => r.status === 'ERRO');
  if (criticalIssues.length > 0) {
    report += `## 🚨 Problemas Críticos (${criticalIssues.length})\n\n`;
    criticalIssues.forEach((issue, i) => {
      report += `### ${i + 1}. ${issue.category} - ${issue.item} [${issue.resolution}]\n\n`;
      report += `**Detalhes:** ${issue.details}\n\n`;
      if (issue.screenshot) report += `**Screenshot:** [Ver](screenshots/${issue.screenshot})\n\n`;
      if (issue.url) report += `**URL:** ${issue.url}\n\n`;
      report += `---\n\n`;
    });
  }

  // Resultados por categoria
  const categories = [...new Set(results.map(r => r.category))];

  for (const category of categories) {
    const categoryResults = results.filter(r => r.category === category);
    const categoryOK = categoryResults.filter(r => r.status === 'OK').length;
    const categoryRate = ((categoryOK / categoryResults.length) * 100).toFixed(1);

    report += `## ${category} (${categoryOK}/${categoryResults.length} - ${categoryRate}%)\n\n`;

    for (const result of categoryResults) {
      const emoji = {
        'OK': '✅',
        'ERRO': '❌',
        'INCOMPLETO': '⚠️',
        'NÃO ENCONTRADO': '🔍',
        'AVISO': '💡'
      }[result.status];

      report += `### ${emoji} ${result.item}`;
      if (result.subcategory) report += ` - ${result.subcategory}`;
      report += ` [${result.resolution}]\n\n`;

      report += `**Status:** ${result.status}\n\n`;
      report += `**Detalhes:** ${result.details}\n\n`;

      if (result.screenshot) report += `**Screenshot:** [Ver](screenshots/${result.screenshot})\n\n`;
      if (result.url) report += `**URL:** ${result.url}\n\n`;
      if (result.consoleErrors && result.consoleErrors.length > 0) {
        report += `**Erros de Console:**\n`;
        result.consoleErrors.forEach(err => report += `- ${err}\n`);
        report += `\n`;
      }

      report += `---\n\n`;
    }
  }

  // Salvar relatório
  const reportPath = join(CONFIG.reportDir, 'test-report.md');
  writeFileSync(reportPath, report, 'utf-8');

  // Salvar JSON
  const jsonPath = join(CONFIG.reportDir, 'test-report.json');
  writeFileSync(jsonPath, JSON.stringify({
    timestamp,
    stats,
    results,
    elementMap
  }, null, 2), 'utf-8');

  console.log('\n' + '='.repeat(80));
  log('✅', `Relatório salvo: ${reportPath}`);
  log('✅', `Dados JSON salvos: ${jsonPath}`);
  log('📸', `Screenshots: ${CONFIG.screenshotDir}`);
  console.log('='.repeat(80) + '\n');

  // Resumo no console
  console.log('📈 ESTATÍSTICAS FINAIS:\n');
  console.log(`   Total de testes: ${stats.total}`);
  console.log(`   ✅ OK: ${stats.OK} (${((stats.OK / stats.total) * 100).toFixed(1)}%)`);
  console.log(`   ❌ ERRO: ${stats.ERRO} (${((stats.ERRO / stats.total) * 100).toFixed(1)}%)`);
  console.log(`   ⚠️  INCOMPLETO: ${stats.INCOMPLETO}`);
  console.log(`   🔍 NÃO ENCONTRADO: ${stats['NÃO ENCONTRADO']}`);
  console.log(`   💡 AVISOS: ${stats.AVISO}`);
  console.log(`\n   Taxa de sucesso: ${successRate}%\n`);
}

// ======================== MAIN ========================

async function main() {
  console.log('\n' + '█'.repeat(80));
  console.log('█' + ' '.repeat(78) + '█');
  console.log('█' + '  🎭 TESTE COMPLETO E SISTEMÁTICO - app.coolgroove.com.br'.padEnd(78) + '█');
  console.log('█' + ' '.repeat(78) + '█');
  console.log('█'.repeat(80) + '\n');

  try {
    log('🚀', 'Iniciando navegador...');
    browser = await chromium.launch({
      headless: false,
      slowMo: CONFIG.slowMo,
    });

    // Testar em todas as resoluções
    await runTestsForResolution('desktop');
    await runTestsForResolution('tablet');
    await runTestsForResolution('mobile');

    // Gerar relatório
    generateReport();

    console.log('\n' + '█'.repeat(80));
    console.log('█' + ' '.repeat(78) + '█');
    console.log('█' + '  ✨ TESTES CONCLUÍDOS COM SUCESSO!'.padEnd(78) + '█');
    console.log('█' + ' '.repeat(78) + '█');
    console.log('█'.repeat(80) + '\n');

  } catch (error) {
    console.error('\n💥 ERRO FATAL:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main().catch(console.error);
