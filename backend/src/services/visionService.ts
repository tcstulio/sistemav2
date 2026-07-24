/**
 * Serviço de visão multimodal (GLM-4.6V / Z.AI) — #1029 preparou este esqueleto
 * para que o spike `backend/scripts/test-video-glm.ts` pudesse reusar o cliente
 * JÁ configurado, sem duplicar `ZAI_VISION_BASE_URL` / `ZAI_VISION_MODEL` /
 * `ZAI_API_KEY`.
 *
 * Contexto histórico: até hoje (2026-07-22) a visão multimodal vivia ACOPLADA
 * ao `LocalProvider` em `backend/src/services/aiService.ts` (métodos
 * `describeImage` e `extractReceiptData`). Isso dificultava reuso a partir de
 * scripts de spike e tornava impossível trocar de provedor de visão sem mexer
 * no loop do agente. #1029 é o passo 1: extrair a configuração e o POST
 * `/chat/completions` para cá, mantendo o mesmo contrato (mesma auth, mesma
 * base URL, mesmo formato de request) — passo 2 (futuro, fora deste PR) é
 * migrar `describeImage`/`extractReceiptData` para chamar `callVisionChat`.
 *
 * Por design, NÃO duplica env vars: tudo vem de `../config/env`, mesma fonte
 * que `config.zaiBaseUrl`/`config.zaiModel` e o `LocalProvider`. Se uma env
 * mudar, visão + LLM primário andam juntos.
 */

import axios, { AxiosError } from 'axios';
import { config } from '../config/env';
import { logger } from '../utils/logger';

const log = logger.child('visionService');

export interface VisionClientConfig {
    /** Base URL já normalizada (sem barra final) — evita `//chat/completions`. */
    baseUrl: string;
    /** Modelo (ex.: 'glm-4.6v'). */
    model: string;
    /** API key bruta ('' se não configurado). */
    apiKey: string;
}

export interface VisionCallOptions {
    /** Timeout da chamada em ms. Default 120s (upload de data URI grande pode ser lento). */
    timeoutMs?: number;
    /** AbortSignal p/ cancelamento cooperativo. */
    signal?: AbortSignal;
    /** Tag livre p/ log (ex.: 'spike/test-video-glm' ou 'LocalProvider.describeImage'). */
    origin?: string;
}

export interface VisionCallResult {
    status: number;
    elapsedMs: number;
    data: unknown;
    headers: Record<string, string>;
}

/**
 * Lê a config atual do cliente. SEM cache em memória: permite trocar a env em
 * runtime (testes/E2E/configService update) sem reiniciar o Node.
 */
export function getVisionClientConfig(): VisionClientConfig {
    return {
        baseUrl: (config.zaiVisionBaseUrl || 'https://api.z.ai/api/coding/paas/v4').replace(/\/+$/, ''),
        model: config.zaiVisionModel || 'glm-4.6v',
        apiKey: config.zaiApiKey || '',
    };
}

/**
 * Headers para chamadas de visão (mesmo padrão do `LocalProvider.getHeaders`:
 * Content-Type fixo + Authorization Bearer quando há chave).
 */
export function getVisionHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const apiKey = getVisionClientConfig().apiKey;
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return headers;
}

/**
 * POST /chat/completions no endpoint de visão. Lança em erro (incluindo AxiosError
 * com `response` populado). NÃO tenta fallback: visão é opcional — o chamador
 * decide se cai no Google multimodal ou aborta a feature.
 *
 * Não inclui retry exponencial: quem chama controla a política (vide
 * `LocalProvider.postChatCompletion` para o padrão usado em produção).
 */
export async function callVisionChat(
    messages: unknown[],
    options: VisionCallOptions = {}
): Promise<VisionCallResult> {
    const { baseUrl, model } = getVisionClientConfig();
    const headers = getVisionHeaders();
    const timeoutMs = options.timeoutMs ?? 120_000;
    const startMs = Date.now();
    const resp = await axios.post(
        `${baseUrl}/chat/completions`,
        { model, messages, temperature: 0.1 },
        { headers, timeout: timeoutMs, signal: options.signal }
    );
    return {
        status: resp.status,
        elapsedMs: Date.now() - startMs,
        data: resp.data,
        headers,
    };
}

export interface VisionErrorInfo {
    /** Rótulo curto — 'HTTP_400' / 'ECONNABORTED' / 'axios_error' / 'Error: mensagem'. */
    kind: string;
    /** HTTP status se a API respondeu com 4xx/5xx. */
    status?: number;
    /** Corpo EXATO da resposta (sem mascarar). Pode ser JSON serializado ou texto puro. */
    body?: string;
    /** axios code p/ erros de rede (ECONNABORTED/ETIMEDOUT/ECONNRESET/ECONNREFUSED). */
    code?: string;
}

/**
 * Captura erro do axios preservando o corpo EXATO que a API devolveu, sem
 * truncar de forma a esconder info. Para 4xx/5xx, expõe `response.data`
 * cru (string ou JSON.stringify). Para erros de rede, expõe `code` + `message`.
 *
 * NÃO mede tempo aqui — o tempo é responsabilidade do caller (closure de
 * `startMs`), garantindo que tanto sucesso quanto erro usem o mesmo relógio.
 */
export function describeVisionError(err: unknown): VisionErrorInfo {
    if (axios.isAxiosError(err)) {
        const ax = err as AxiosError;
        const status = ax.response?.status;
        const data = ax.response?.data;
        let body: string | undefined;
        if (data != null) {
            body = typeof data === 'string' ? data : safeStringify(data);
        }
        const code = ax.code;
        return {
            kind: status ? `HTTP_${status}` : (code || 'axios_error'),
            status,
            body,
            code: code || undefined,
        };
    }
    return { kind: (err as Error)?.message || String(err) };
}

function safeStringify(data: unknown): string {
    try {
        return JSON.stringify(data);
    } catch {
        return String(data);
    }
}

/** Versão segura da API key p/ logs (mostra só 4+2 chars) — nunca logar inteira. */
export function redactApiKey(apiKey: string): string {
    if (!apiKey) return '';
    if (apiKey.length <= 6) return '***';
    return `${apiKey.slice(0, 4)}…${apiKey.slice(-2)}`;
}

/** Indica se a base atual parece ser a base CODING (alvo do spike #1029). */
export function isCodingBase(baseUrl?: string): boolean {
    const url = baseUrl ?? getVisionClientConfig().baseUrl;
    return /\/coding\//.test(url);
}

/**
 * Log de "serviço carregado" sob demanda — NÃO roda no import do módulo,
 * porque polui testes (vitest/jest) e logs estruturados quando o módulo
 * é carregado só para reusar config. Chame explicitamente se quiser
 * registrar a inicialização (ex.: no startup do app).
 */
export function logVisionInit(): void {
    const cfg = getVisionClientConfig();
    log.debug('visionService inicializado', { baseUrl: cfg.baseUrl, model: cfg.model });
}
