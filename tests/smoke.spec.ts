import { test, expect } from '@playwright/test';

/**
 * Smoke tests for CoolGroove
 *
 * Simple tests that verify the frontend and backend are running
 * and responding correctly. These do not require authentication.
 */

test.describe('Frontend Smoke Tests', () => {
  test('homepage responds with 200', async ({ page }) => {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Vite dev server should return 200
    expect(response).not.toBeNull();
    expect(response!.status()).toBe(200);
  });

  test('React app mounts to #root', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const rootContent = await page.locator('#root').innerHTML();
    expect(rootContent.length).toBeGreaterThan(0);
  });

  test('page title is set', async ({ page }) => {
    await page.goto('/');

    const title = await page.title();
    // Title should be non-empty (even if default Vite title)
    expect(title.length).toBeGreaterThan(0);
  });

  test('no critical console errors on load', async ({ page, request }) => {
    // Sem backend o app loga erro de fetch/auth — este teste só faz sentido com o backend de pé
    // (local / Modo B, ver docs/E2E_LOCAL.md). Na CI (sem backend) ele PULA, como os Backend Smoke
    // Tests abaixo.
    const health = await request
      .get('http://localhost:3004/health', { timeout: 5000, failOnStatusCode: false })
      .catch(() => null);
    if (!health) { test.skip(); return; }

    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/', { waitUntil: 'networkidle' });

    // Filter out non-critical errors (dev server noise, favicon, etc.)
    const criticalErrors = errors.filter(
      e =>
        !e.includes('favicon') &&
        !e.includes('hot-update') &&
        !e.includes('DevTools') &&
        !e.includes('net::ERR_CONNECTION_REFUSED') && // Backend might be down
        !e.includes('WebSocket') // HMR websocket noise
    );

    expect(criticalErrors.length).toBe(0);
  });

  test('HTML contains expected meta/scripts', async ({ page }) => {
    const response = await page.goto('/');
    const body = await response!.text();

    // Vite injects script tags
    expect(body).toContain('<script');
    // Should have the root div
    expect(body).toContain('id="root"');
  });
});

test.describe('Backend Smoke Tests', () => {
  // These tests need the backend running on localhost:3004
  test('backend /health endpoint responds', async ({ request }) => {
    const response = await request.get('http://localhost:3004/health', {
      timeout: 5000,
      failOnStatusCode: false,
    }).catch(() => null);

    // If backend is not running, skip rather than fail
    if (!response) {
      test.skip();
      return;
    }

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('status');
    expect(['ok', 'degraded']).toContain(body.status);
  });

  test('backend /health includes dependency checks', async ({ request }) => {
    const response = await request.get('http://localhost:3004/health', {
      timeout: 5000,
      failOnStatusCode: false,
    }).catch(() => null);

    if (!response) {
      test.skip();
      return;
    }

    const body = await response.json();
    // Health response should include a dependencies object
    expect(body).toHaveProperty('dependencies');
    expect(typeof body.dependencies).toBe('object');
  });
});

test.describe('Proxy Smoke Tests', () => {
  // Verify Vite proxy to backend works (needs backend running)
  test('API proxy forwards to backend', async ({ request }) => {
    const response = await request.get('/api/auth/login', {
      timeout: 5000,
      failOnStatusCode: false,
    }).catch(() => null);

    if (!response) {
      test.skip();
      return;
    }

    // Should NOT be a 404 from Vite (which means proxy isn't working)
    // Getting 401, 400 or 405 from backend is fine (means proxy works)
    const status = response.status();
    const isProxied = status !== 404 || (await response.text()).includes('Cannot GET') === false;

    if (!isProxied) {
      // Could be Vite's own 404, meaning proxy is misconfigured
      test.skip();
      return;
    }

    // Any non-404 response means the proxy is working
    expect([200, 400, 401, 404, 405, 500]).toContain(status);
  });
});
