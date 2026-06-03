import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Sem isto, ao re-importar env.ts o dotenv.config() relê o .env e repõe PORT/DOLIBARR_API_KEY/
// LLM_PROVIDER, anulando os delete do teste. Mockar torna o teste determinístico (só o que o teste setar).
vi.mock('dotenv', () => ({ default: { config: vi.fn() }, config: vi.fn() }));

describe('env config', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    async function importConfig() {
        vi.resetModules();
        const mod = await import('../../config/env');
        return mod;
    }

    it('has default port 3004 when PORT is not set', async () => {
        delete process.env.PORT;
        const { config } = await importConfig();
        expect(config.port).toBe(3004);
    });

    it('reads PORT from env', async () => {
        process.env.PORT = '8080';
        const { config } = await importConfig();
        expect(config.port).toBe('8080');
    });

    it('has default dolibarrUrl', async () => {
        delete process.env.DOLIBARR_URL;
        const { config } = await importConfig();
        expect(config.dolibarrUrl).toBe('https://sistema.coolgroove.com.br/api/index.php');
    });

    it('reads dolibarrUrl from env', async () => {
        process.env.DOLIBARR_URL = 'http://custom-url';
        const { config } = await importConfig();
        expect(config.dolibarrUrl).toBe('http://custom-url');
    });

    it('has default empty strings for keys', async () => {
        delete process.env.DOLIBARR_API_KEY;
        delete process.env.ADMIN_KEY;
        delete process.env.GOOGLE_API_KEY;
        delete process.env.SERPER_API_KEY;
        const { config } = await importConfig();
        expect(config.dolibarrKey).toBe('');
        expect(config.adminKey).toBe('');
        expect(config.googleApiKey).toBe('');
        expect(config.serperApiKey).toBe('');
    });

    it('reads dolibarrKey from env', async () => {
        process.env.DOLIBARR_API_KEY = 'mykey123';
        const { config } = await importConfig();
        expect(config.dolibarrKey).toBe('mykey123');
    });

    it('reads adminKey from env', async () => {
        process.env.ADMIN_KEY = 'admin123';
        const { config } = await importConfig();
        expect(config.adminKey).toBe('admin123');
    });

    it('reads googleApiKey from env', async () => {
        process.env.GOOGLE_API_KEY = 'google-key';
        const { config } = await importConfig();
        expect(config.googleApiKey).toBe('google-key');
    });

    it('reads chromeBin from env', async () => {
        process.env.CHROME_BIN = '/usr/bin/chrome';
        const { config } = await importConfig();
        expect(config.chromeBin).toBe('/usr/bin/chrome');
    });

    it('chromeBin is undefined when not set', async () => {
        delete process.env.CHROME_BIN;
        const { config } = await importConfig();
        expect(config.chromeBin).toBeUndefined();
    });

    it('has default dolibarrBypassCookie', async () => {
        delete process.env.DOLIBARR_BYPASS_COOKIE;
        const { config } = await importConfig();
        expect(config.dolibarrBypassCookie).toBe('humans_21909=1');
    });

    it('has default geminiModel', async () => {
        delete process.env.GEMINI_MODEL;
        const { config } = await importConfig();
        expect(config.geminiModel).toBe('gemini-2.0-flash-exp');
    });

    it('reads geminiModel from env', async () => {
        process.env.GEMINI_MODEL = 'gemini-3.0';
        const { config } = await importConfig();
        expect(config.geminiModel).toBe('gemini-3.0');
    });

    it('has default llmProvider local', async () => {
        delete process.env.LLM_PROVIDER;
        const { config } = await importConfig();
        expect(config.llmProvider).toBe('local');
    });

    it('reads llmProvider from env', async () => {
        process.env.LLM_PROVIDER = 'google';
        const { config } = await importConfig();
        expect(config.llmProvider).toBe('google');
    });

    it('has default localLlmUrl', async () => {
        delete process.env.LOCAL_LLM_URL;
        const { config } = await importConfig();
        expect(config.localLlmUrl).toBe('http://localhost:11434/v1');
    });

    it('reads localLlmUrl from env', async () => {
        process.env.LOCAL_LLM_URL = 'http://custom:1234';
        const { config } = await importConfig();
        expect(config.localLlmUrl).toBe('http://custom:1234');
    });

    it('has default localModelName', async () => {
        delete process.env.LOCAL_LLM_MODEL;
        const { config } = await importConfig();
        expect(config.localModelName).toBe('llama3');
    });

    it('reads localModelName from env', async () => {
        process.env.LOCAL_LLM_MODEL = 'mistral';
        const { config } = await importConfig();
        expect(config.localModelName).toBe('mistral');
    });

    it('reads serperApiKey from env', async () => {
        process.env.SERPER_API_KEY = 'serper-key';
        const { config } = await importConfig();
        expect(config.serperApiKey).toBe('serper-key');
    });

    it('has inter banking config defaults', async () => {
        delete process.env.INTER_CLIENT_ID;
        delete process.env.INTER_CLIENT_SECRET;
        delete process.env.INTER_CERT_PATH;
        delete process.env.INTER_KEY_PATH;
        delete process.env.INTER_SANDBOX;
        delete process.env.INTER_WEBHOOK_SECRET;
        const { config } = await importConfig();
        expect(config.interClientId).toBe('');
        expect(config.interClientSecret).toBe('');
        expect(config.interCertPath).toBe('./certs/inter.crt');
        expect(config.interKeyPath).toBe('./certs/inter.key');
        expect(config.interSandbox).toBe(false);
        expect(config.interWebhookSecret).toBe('');
    });

    it('reads inter banking config from env', async () => {
        process.env.INTER_CLIENT_ID = 'ic';
        process.env.INTER_CLIENT_SECRET = 'ics';
        process.env.INTER_CERT_PATH = '/certs/inter.pem';
        process.env.INTER_KEY_PATH = '/certs/inter.key.pem';
        process.env.INTER_SANDBOX = 'true';
        process.env.INTER_WEBHOOK_SECRET = 'wh-secret';
        const { config } = await importConfig();
        expect(config.interClientId).toBe('ic');
        expect(config.interClientSecret).toBe('ics');
        expect(config.interCertPath).toBe('/certs/inter.pem');
        expect(config.interKeyPath).toBe('/certs/inter.key.pem');
        expect(config.interSandbox).toBe(true);
        expect(config.interWebhookSecret).toBe('wh-secret');
    });

    it('interSandbox is false when not "true"', async () => {
        process.env.INTER_SANDBOX = 'false';
        const { config } = await importConfig();
        expect(config.interSandbox).toBe(false);
    });

    it('has itau banking config defaults', async () => {
        delete process.env.ITAU_CLIENT_ID;
        delete process.env.ITAU_CLIENT_SECRET;
        delete process.env.ITAU_CERT_PATH;
        delete process.env.ITAU_KEY_PATH;
        delete process.env.ITAU_SANDBOX;
        delete process.env.ITAU_CONTA_CORRENTE;
        delete process.env.ITAU_AGENCIA;
        const { config } = await importConfig();
        expect(config.itauClientId).toBe('');
        expect(config.itauClientSecret).toBe('');
        expect(config.itauCertPath).toBe('./certs/itau.crt');
        expect(config.itauKeyPath).toBe('./certs/itau.key');
        expect(config.itauSandbox).toBe(false);
        expect(config.itauContaCorrente).toBe('');
        expect(config.itauAgencia).toBe('');
    });

    it('reads itau banking config from env', async () => {
        process.env.ITAU_CLIENT_ID = 'itid';
        process.env.ITAU_CLIENT_SECRET = 'itsecret';
        process.env.ITAU_CERT_PATH = '/certs/itau.pem';
        process.env.ITAU_KEY_PATH = '/certs/itau.key.pem';
        process.env.ITAU_SANDBOX = 'true';
        process.env.ITAU_CONTA_CORRENTE = '12345';
        process.env.ITAU_AGENCIA = '0001';
        const { config } = await importConfig();
        expect(config.itauClientId).toBe('itid');
        expect(config.itauClientSecret).toBe('itsecret');
        expect(config.itauCertPath).toBe('/certs/itau.pem');
        expect(config.itauKeyPath).toBe('/certs/itau.key.pem');
        expect(config.itauSandbox).toBe(true);
        expect(config.itauContaCorrente).toBe('12345');
        expect(config.itauAgencia).toBe('0001');
    });

    it('itauSandbox is false when not "true"', async () => {
        process.env.ITAU_SANDBOX = 'false';
        const { config } = await importConfig();
        expect(config.itauSandbox).toBe(false);
    });
});
