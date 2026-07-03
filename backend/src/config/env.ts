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
    zaiModel: process.env.ZAI_MODEL || 'glm-5.2',
    // Visão (OCR/análise de imagem) via GLM-4.6V. Default: base CODING — verificado em
    // 2026-07-03 que o plano Coding serve o glm-4.6v com image_url; a base PaaS exige saldo
    // separado (erro 1113 sem recarga). Permite OCR sem depender do Gemini nem de recarga.
    zaiVisionBaseUrl: process.env.ZAI_VISION_BASE_URL || 'https://api.z.ai/api/coding/paas/v4',
    zaiVisionModel: process.env.ZAI_VISION_MODEL || 'glm-4.6v',
    // ASR (transcrição de voz) via GLM-ASR-2512 (~US$0,0024/min). NÃO está no plano Coding —
    // é cobrado do saldo PaaS (pay-as-you-go). Áudio ≤30s e ≤25MB por chamada (doc oficial).
    zaiAsrBaseUrl: process.env.ZAI_ASR_BASE_URL || 'https://api.z.ai/api/paas/v4',
    zaiAsrModel: process.env.ZAI_ASR_MODEL || 'glm-asr-2512',
    minimaxApiKey: process.env.MINIMAX_API_KEY || '',
    // Chave da ASSINATURA MiniMax (Subscription Key do Token Plan) — separada da API key
    // pay-as-you-go. Usada pelos endpoints de MÍDIA (TTS/voz/imagem/vídeo) quando presente;
    // o texto (fallback M3) continua na MINIMAX_API_KEY. Mesmos endpoints, mesma auth Bearer.
    minimaxMediaKey: process.env.MINIMAX_MEDIA_KEY || process.env.MINIMAX_SUBSCRIPTION_KEY || '',
    minimaxBaseUrl: process.env.MINIMAX_BASE_URL || 'https://api.minimax.io/v1/',
    minimaxModel: process.env.MINIMAX_MODEL || 'MiniMax-M3',
    // GroupId é exigido por algumas regiões/endpoints da MiniMax (mídia). Opcional: se vazio, não é enviado.
    minimaxGroupId: process.env.MINIMAX_GROUP_ID || '',
    // Geração de mídia (tools do agente). Modelos e voz default — todos configuráveis.
    minimaxTtsModel: process.env.MINIMAX_TTS_MODEL || 'speech-2.6-hd',
    minimaxVoiceId: process.env.MINIMAX_VOICE_ID || 'Portuguese_ConfidentWoman',
    minimaxImageModel: process.env.MINIMAX_IMAGE_MODEL || 'image-01',
    minimaxVideoModel: process.env.MINIMAX_VIDEO_MODEL || 'MiniMax-Hailuo-2.3',
    serperApiKey: process.env.SERPER_API_KEY || '',
    // Segredo opcional p/ os endpoints públicos de webhook (/trigger e /dolibarr/*).
    // Se vazio, a verificação é pulada (compat). Defina p/ exigir header x-webhook-secret.
    webhookSecret: process.env.WEBHOOK_SECRET || '',

    // Cap de destinatários por broadcast do scheduler (anti-spam em massa). Configurável.
    schedulerMaxBroadcast: parseInt(process.env.SCHEDULER_MAX_BROADCAST || '500', 10),

    // Resiliência LLM: backoff exponencial em erros de infra (429/timeout/5xx).
    // LLM_PRIMARY_TIMEOUT_MS: tempo máximo por chamada ao provider primário (ms). Default 180s.
    // LLM_RETRY_DEADLINE_MS:  prazo total para re-tentativas em erro de infra (ms). Default 60s.
    llmPrimaryTimeoutMs: parseInt(process.env.LLM_PRIMARY_TIMEOUT_MS || '180000', 10),
    llmRetryDeadlineMs: parseInt(process.env.LLM_RETRY_DEADLINE_MS || '60000', 10),


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
    // Segredo p/ verificar assinatura HMAC-SHA256 dos webhooks Itaú. Se vazio, a verificação
    // é pulada (compat). Defina em produção para rejeitar webhooks forjados.
    itauWebhookSecret: process.env.ITAU_WEBHOOK_SECRET || '',
    itauContaCorrente: process.env.ITAU_CONTA_CORRENTE || '',
    itauAgencia: process.env.ITAU_AGENCIA || '',
};

