import dotenv from 'dotenv';

dotenv.config();

export const config = {
    port: process.env.PORT || 3004,
    dolibarrUrl: process.env.DOLIBARR_URL || 'https://sistema.coolgroove.com.br/api/index.php',
    dolibarrKey: process.env.DOLIBARR_API_KEY || '',
    adminKey: process.env.ADMIN_KEY || '',
    googleApiKey: process.env.GOOGLE_API_KEY || '',
    chromeBin: process.env.CHROME_BIN,
    dolibarrBypassCookie: process.env.DOLIBARR_BYPASS_COOKIE || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp', // Default Gemini model
    llmProvider: process.env.LLM_PROVIDER || 'local', // 'google' | 'local'
    localLlmUrl: process.env.LOCAL_LLM_URL || 'http://localhost:11434/v1', // Standard Ollama/LocalAI endpoint
    localModelName: process.env.LOCAL_LLM_MODEL || 'llama3', // Default model
    serperApiKey: process.env.SERPER_API_KEY || '', // Added


    // Banco Inter
    interClientId: process.env.INTER_CLIENT_ID || '',
    interClientSecret: process.env.INTER_CLIENT_SECRET || '',
    interCertPath: process.env.INTER_CERT_PATH || './certs/inter.crt',
    interKeyPath: process.env.INTER_KEY_PATH || './certs/inter.key',
    interSandbox: process.env.INTER_SANDBOX === 'true',
    interWebhookSecret: process.env.INTER_WEBHOOK_SECRET || '',

    // Banco Itaú
    itauClientId: process.env.ITAU_CLIENT_ID || '',
    itauClientSecret: process.env.ITAU_CLIENT_SECRET || '',
    itauCertPath: process.env.ITAU_CERT_PATH || './certs/itau.crt',
    itauKeyPath: process.env.ITAU_KEY_PATH || './certs/itau.key',
    itauSandbox: process.env.ITAU_SANDBOX === 'true',
    itauContaCorrente: process.env.ITAU_CONTA_CORRENTE || '',
    itauAgencia: process.env.ITAU_AGENCIA || '',
};

