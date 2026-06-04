import dotenv from 'dotenv';

dotenv.config();

export const config = {
    port: process.env.PORT || 3004,
    dolibarrUrl: process.env.DOLIBARR_URL || 'https://sistema.coolgroove.com.br/api/index.php',
    dolibarrKey: process.env.DOLIBARR_API_KEY || '',
    adminKey: process.env.ADMIN_KEY || '',
    // Segredo p/ assinar deeplinks HITL do agente (#57 Peça 2). Cai p/ ADMIN_KEY se não definido.
    deeplinkSecret: process.env.DEEPLINK_TOKEN_SECRET || process.env.ADMIN_KEY || '',
    googleApiKey: process.env.GOOGLE_API_KEY || '',
    chromeBin: process.env.CHROME_BIN,
    dolibarrBypassCookie: process.env.DOLIBARR_BYPASS_COOKIE || 'humans_21909=1', // Default to known working cookie
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp', // Default Gemini model
    llmProvider: process.env.LLM_PROVIDER || 'local', // 'google' | 'local' | 'glm' | 'minimax'
    localLlmUrl: process.env.LOCAL_LLM_URL || 'http://localhost:11434/v1',
    localModelName: process.env.LOCAL_LLM_MODEL || 'llama3',
    zaiApiKey: process.env.ZAI_API_KEY || '',
    zaiBaseUrl: process.env.ZAI_BASE_URL || 'https://api.z.ai/api/coding/paas/v4/',
    zaiModel: process.env.ZAI_MODEL || 'glm-5.1',
    // Visão (OCR/análise de imagem) via GLM-4.6V — usa a base PaaS padrão (NÃO a base 'coding'),
    // que é onde o modelo multimodal é servido. Permite OCR sem depender do Gemini.
    zaiVisionBaseUrl: process.env.ZAI_VISION_BASE_URL || 'https://api.z.ai/api/paas/v4',
    zaiVisionModel: process.env.ZAI_VISION_MODEL || 'glm-4.6v',
    minimaxApiKey: process.env.MINIMAX_API_KEY || '',
    minimaxBaseUrl: process.env.MINIMAX_BASE_URL || 'https://api.minimax.io/v1/',
    minimaxModel: process.env.MINIMAX_MODEL || 'MiniMax-M3',
    // GroupId é exigido por algumas regiões/endpoints da MiniMax (mídia). Opcional: se vazio, não é enviado.
    minimaxGroupId: process.env.MINIMAX_GROUP_ID || '',
    // Geração de mídia (tools do agente). Modelos e voz default — todos configuráveis.
    minimaxTtsModel: process.env.MINIMAX_TTS_MODEL || 'speech-2.6-hd',
    minimaxVoiceId: process.env.MINIMAX_VOICE_ID || 'male-qn-qingse',
    minimaxImageModel: process.env.MINIMAX_IMAGE_MODEL || 'image-01',
    minimaxVideoModel: process.env.MINIMAX_VIDEO_MODEL || 'MiniMax-Hailuo-2.3',
    serperApiKey: process.env.SERPER_API_KEY || '',


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

