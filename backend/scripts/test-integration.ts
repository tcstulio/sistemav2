/**
 * Test Script - Integration Module
 *
 * Execute com: npx ts-node scripts/test-integration.ts
 * Ou após build: node dist/scripts/test-integration.js
 */

import http from 'http';

const BASE_URL = 'http://localhost:3001';

// Helper para fazer requests
async function request(method: string, path: string, body?: any): Promise<any> {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options: http.RequestOptions = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method,
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 10000
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        data: JSON.parse(data)
                    });
                } catch {
                    resolve({
                        status: res.statusCode,
                        data: data
                    });
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

// Cores para output
const colors = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    reset: '\x1b[0m',
    bold: '\x1b[1m'
};

function log(message: string, color: keyof typeof colors = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logResult(name: string, success: boolean, details?: string) {
    const icon = success ? '✓' : '✗';
    const color = success ? 'green' : 'red';
    log(`  ${icon} ${name}${details ? `: ${details}` : ''}`, color);
}

// Testes
async function testHealthCheck() {
    log('\n📋 Testing Health Check...', 'blue');
    try {
        const res = await request('GET', '/health');
        logResult('Health endpoint', res.status === 200, res.data?.status);
        return res.status === 200;
    } catch (e: any) {
        logResult('Health endpoint', false, e.message);
        return false;
    }
}

async function testIntegrationStatus() {
    log('\n📋 Testing Integration Status (no auth)...', 'blue');
    try {
        const res = await request('GET', '/api/integration/status');
        // Should return 401 without auth
        logResult('Auth required', res.status === 401, `status ${res.status}`);
        return res.status === 401;
    } catch (e: any) {
        logResult('Integration status', false, e.message);
        return false;
    }
}

async function testFeatures() {
    log('\n📋 Testing Features Endpoint (no auth)...', 'blue');
    try {
        const res = await request('GET', '/api/integration/features');
        // Should return 401 without auth
        logResult('Auth required', res.status === 401, `status ${res.status}`);
        return res.status === 401;
    } catch (e: any) {
        logResult('Features endpoint', false, e.message);
        return false;
    }
}

async function testMoltbotDirect() {
    log('\n📋 Testing Moltbot Gateway Direct (port 18789)...', 'blue');
    try {
        const res = await new Promise<any>((resolve, reject) => {
            const req = http.request({
                hostname: 'localhost',
                port: 18789,
                path: '/api/status',
                method: 'GET',
                timeout: 3000
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ status: res.statusCode, data }));
            });
            req.on('error', () => resolve({ status: 0, error: 'Connection refused' }));
            req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'Timeout' }); });
            req.end();
        });

        if (res.status === 200) {
            logResult('Moltbot Gateway', true, 'Online');
            return true;
        } else {
            logResult('Moltbot Gateway', false, res.error || `status ${res.status}`);
            return false;
        }
    } catch (e: any) {
        logResult('Moltbot Gateway', false, 'Offline (expected if not running)');
        return false;
    }
}

async function testTulipaDirect() {
    log('\n📋 Testing Tulipa Server Direct (port 8081)...', 'blue');
    try {
        const res = await new Promise<any>((resolve, reject) => {
            const req = http.request({
                hostname: 'localhost',
                port: 8081,
                path: '/api/status',
                method: 'GET',
                timeout: 3000
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve({ status: res.statusCode, data }));
            });
            req.on('error', () => resolve({ status: 0, error: 'Connection refused' }));
            req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'Timeout' }); });
            req.end();
        });

        if (res.status === 200) {
            logResult('Tulipa Server', true, 'Online');
            return true;
        } else {
            logResult('Tulipa Server', false, res.error || `status ${res.status}`);
            return false;
        }
    } catch (e: any) {
        logResult('Tulipa Server', false, 'Offline (expected if not running)');
        return false;
    }
}

// Main
async function main() {
    log('\n' + '='.repeat(50), 'bold');
    log('  SISTEMAV2 - Integration Test Suite', 'bold');
    log('='.repeat(50), 'bold');

    const results: boolean[] = [];

    // Test backend health
    results.push(await testHealthCheck());

    // Test auth protection
    results.push(await testIntegrationStatus());
    results.push(await testFeatures());

    // Test external services directly
    results.push(await testMoltbotDirect());
    results.push(await testTulipaDirect());

    // Summary
    log('\n' + '='.repeat(50), 'bold');
    const passed = results.filter(r => r).length;
    const total = results.length;
    const allPassed = passed === total;

    if (allPassed) {
        log(`\n✅ All tests passed (${passed}/${total})`, 'green');
    } else {
        log(`\n⚠️  Tests: ${passed}/${total} passed`, 'yellow');
    }

    log('\n📌 Next Steps:', 'blue');
    log('  1. Se o backend não está rodando: npm run dev');
    log('  2. Para testar com autenticação, use o frontend ou Postman');
    log('  3. Configure .env com MOLTBOT_ENABLED=true para ativar Moltbot');
    log('  4. Configure .env com TULIPA_ENABLED=true para ativar Tulipa');
    log('');

    process.exit(allPassed ? 0 : 1);
}

main().catch(console.error);
