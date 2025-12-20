import dotenv from 'dotenv';

dotenv.config();

export const config = {
    port: process.env.PORT || 3004,
    dolibarrUrl: process.env.DOLIBARR_URL || 'https://sistema.coolgroove.com.br/api/index.php',
    dolibarrKey: process.env.DOLIBARR_API_KEY || '',
    adminKey: process.env.ADMIN_KEY || 'admin-secret-123',
    googleApiKey: process.env.GOOGLE_API_KEY || '',
    chromeBin: process.env.CHROME_BIN,
    dolibarrBypassCookie: process.env.DOLIBARR_BYPASS_COOKIE || 'humans_21909=1', // Default to known working cookie
    llmProvider: process.env.LLM_PROVIDER || 'local', // 'google' | 'local'
    localLlmUrl: process.env.LOCAL_LLM_URL || 'http://localhost:11434/v1', // Standard Ollama/LocalAI endpoint
    localModelName: process.env.LOCAL_LLM_MODEL || 'llama3', // Default model
};

