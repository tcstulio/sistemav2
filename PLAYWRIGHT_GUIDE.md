# 🎭 Guia de Uso do Playwright

## 📋 Scripts Disponíveis

### 1. Testar o próprio aplicativo
```bash
npm run test:app
```
Abre o navegador, navega para `http://localhost:5173` e tira screenshots automáticos.

### 2. Navegador interativo
```bash
npm run browser
```
Mantém o navegador aberto por 5 minutos para você explorar e testar manualmente.

### 3. Gerar código automaticamente (Codegen)
```bash
npm run playwright:codegen http://localhost:5173
```
**⭐ MAIS ÚTIL!** Abre um navegador e grava todas as suas ações, gerando código automaticamente!

### 4. Executar testes
```bash
npm test                 # Modo headless (sem interface)
npm run test:headed      # Com navegador visível
npm run test:ui          # Interface gráfica interativa
npm run test:debug       # Modo debug passo-a-passo
```

### 5. Script de exemplo (web scraping)
```bash
npm run scrape
```
Exemplo de navegação e extração de dados de websites.

---

## 🚀 Como Usar

### Passo 1: Inicie seu aplicativo
```bash
npm run dev:all
```

### Passo 2: Em outro terminal, teste com Playwright

#### Opção A: Codegen (Recomendado para iniciantes)
```bash
npm run playwright:codegen http://localhost:5173
```
- Navegue pelo seu app normalmente
- Suas ações serão gravadas automaticamente
- Copie o código gerado e cole em um novo arquivo de teste

#### Opção B: Script personalizado
Edite [scripts/test-own-app.ts](scripts/test-own-app.ts) e adicione suas automações:

```typescript
// Exemplo: Testar login
await page.goto('http://localhost:5173');
await page.fill('input[name="email"]', 'usuario@teste.com');
await page.fill('input[name="password"]', 'senha123');
await page.click('button[type="submit"]');

// Tirar screenshot
await page.screenshot({ path: 'screenshots/depois-login.png' });

// Verificar se está logado
const userName = await page.locator('.user-name').textContent();
console.log('Usuário logado:', userName);
```

---

## 📸 Screenshots

Todos os screenshots são salvos na pasta `screenshots/` (ignorada pelo git).

```typescript
// Screenshot de toda a página
await page.screenshot({ path: 'screenshots/nome.png', fullPage: true });

// Screenshot de um elemento específico
await page.locator('.dashboard').screenshot({ path: 'screenshots/dashboard.png' });
```

---

## 🎯 Seletores Úteis

```typescript
// Por texto
await page.click('button:has-text("Entrar")');

// Por classe CSS
await page.click('.btn-login');

// Por ID
await page.click('#submit-button');

// Por atributo
await page.click('button[type="submit"]');

// Por data-testid (recomendado!)
await page.click('[data-testid="login-btn"]');
```

---

## 🔍 Ações Comuns

### Navegação
```typescript
await page.goto('http://localhost:5173/dashboard');
await page.goBack();
await page.goForward();
await page.reload();
```

### Interação com elementos
```typescript
// Clicar
await page.click('button');

// Preencher input
await page.fill('input[name="email"]', 'teste@email.com');

// Selecionar dropdown
await page.selectOption('select#country', 'BR');

// Checkbox
await page.check('input[type="checkbox"]');
await page.uncheck('input[type="checkbox"]');

// Upload de arquivo
await page.setInputFiles('input[type="file"]', 'caminho/arquivo.pdf');
```

### Esperar por elementos
```typescript
// Esperar por seletor
await page.waitForSelector('.dashboard');

// Esperar por navegação
await page.waitForNavigation();

// Esperar por tempo específico
await page.waitForTimeout(2000); // 2 segundos

// Esperar por estado da página
await page.waitForLoadState('networkidle');
```

### Extrair dados
```typescript
// Texto de um elemento
const title = await page.locator('h1').textContent();

// Valor de um input
const email = await page.inputValue('input[name="email"]');

// Atributo
const href = await page.getAttribute('a', 'href');

// Múltiplos elementos
const items = await page.locator('.item').all();
for (const item of items) {
  const text = await item.textContent();
  console.log(text);
}
```

---

## 🐛 Debug

### Modo Debug Interativo
```bash
npm run test:debug
```

### Console do navegador
```typescript
page.on('console', msg => console.log('Browser:', msg.text()));
```

### Pausar execução
```typescript
await page.pause(); // Abre inspector do Playwright
```

---

## 📁 Estrutura de Arquivos

```
c:\Projetos\Sistema\
├── playwright.config.ts          # Configuração principal
├── tests/
│   ├── example-navigation.spec.ts  # Exemplos de testes
│   └── screenshots/               # Screenshots dos testes
├── scripts/
│   ├── test-own-app.ts           # Testar seu app
│   ├── interactive-browser.ts    # Navegador interativo
│   └── web-scraper.ts            # Exemplo de scraping
└── screenshots/                   # Screenshots gerais
```

---

## 💡 Dicas

1. **Use data-testid** nos seus componentes React para facilitar testes:
   ```tsx
   <button data-testid="submit-btn">Enviar</button>
   ```
   ```typescript
   await page.click('[data-testid="submit-btn"]');
   ```

2. **Execute testes em paralelo** para múltiplos navegadores (já configurado)

3. **Use o modo UI** para debug visual:
   ```bash
   npm run test:ui
   ```

4. **Capturas automáticas**: Screenshots e vídeos são salvos automaticamente quando testes falham

5. **Network idle**: Útil para SPAs que fazem muitas requisições
   ```typescript
   await page.goto(url, { waitUntil: 'networkidle' });
   ```

---

## 🔗 Documentação Oficial

- [Playwright Docs](https://playwright.dev)
- [API Reference](https://playwright.dev/docs/api/class-playwright)
- [Best Practices](https://playwright.dev/docs/best-practices)

---

## 🎓 Próximos Passos

1. Inicie seu app: `npm run dev:all`
2. Grave suas ações: `npm run playwright:codegen http://localhost:5173`
3. Copie o código gerado
4. Crie testes automatizados
5. Execute: `npm test`

Boa sorte! 🚀
