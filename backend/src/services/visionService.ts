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
 * #1546: `describeVideo` (análise via `video_url`, que reusa `callVisionChat`)
 * foi extraída para `backend/src/services/describeVideo.ts` conforme pedido
 * pela spec da issue. Este arquivo continua sendo o "cliente multimodal"
 * compartilhado — config/env, POST /chat/completions, fallback MiniMax VLM
 * e helpers de erro vivem aqui. A função de domínio específica do vídeo
 * mora no arquivo dedicado, evitando inflar este módulo com tipos que só o
 * chat consome.
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
    try {
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
    } catch (err) {
        // Fallback: MiniMax VLM. Devolve null quando não se aplica (vídeo, sem
        // chave, erro não-recuperável) — aí o erro ORIGINAL do primário sobe,
        // que é o mais informativo pro operador.
        const fallback = await tryMinimaxVisionFallback(messages, err, options, startMs);
        if (fallback) return fallback;
        throw err;
    }
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



// ---------------------------------------------------------------------------
// Fallback de visão: MiniMax VLM (chave de plano / Coding Plan)
// ---------------------------------------------------------------------------
/**
 * Por que um endpoint DIFERENTE e não `/chat/completions`: a chave de plano
 * (`sk-cp-*`) atende `POST {minimaxApiHost}/v1/coding_plan/vlm` com o corpo
 * `{ prompt, image_url }`. O `/v1/chat/completions` com content-blocks
 * `image_url` devolve `400 invalid params` — VERIFICADO em 2026-07-30 contra a
 * conta real, e é o mesmo endpoint que `packages/mcp-minimax` da Tulipa usa em
 * `understand_image` ("confirmado 2026-05-03" no comentário de `tools.ts`).
 * Isso fecha o item 8 de `docs/operations/env-audit-2026-05-07.md`, que pedia
 * validar se o host de chaves de plano era `api.minimax.io`. É.
 *
 * ESCOPO DELIBERADO — só IMAGEM. O endpoint VLM recebe um único `image_url`;
 * `describeVideo` manda `video_url`, que ele não aceita. Quando as mensagens não
 * contêm exatamente uma imagem, o fallback é PULADO e o erro do primário sobe
 * intacto (melhor um 429 honesto do GLM que um 400 confuso da MiniMax).
 */

/** Config do fallback. `apiKey` vazio = fallback desligado. */
export function getMinimaxVisionConfig(): { url: string; apiKey: string } {
    return {
        url: `${config.minimaxApiHost}/v1/coding_plan/vlm`,
        // Mesma precedência do `minimaxKey()` em aiService: a chave da ASSINATURA
        // primeiro (créditos do plano), a pay-as-you-go como reserva — a confusão
        // de carteiras do #942 já quebrou esse fallback silenciosamente antes.
        apiKey: config.minimaxMediaKey || config.minimaxApiKey || '',
    };
}

/**
 * Vale tentar o fallback? Mesma regra do `LocalProvider.isRecoverable`: 429,
 * 5xx e erros de rede. Somados os códigos de CARTEIRA da Z.AI, que chegam como
 * 429 mas significam coisas diferentes: `1310` = cota do plano esgotada (volta
 * sozinha na renovação) e `1113` = saldo pay-as-you-go zerado (não volta sozinha).
 * Ambos merecem fallback. 4xx restante (400/401/403) NÃO — é request inválido.
 */
function isRecoverableVisionError(err: unknown): boolean {
    if (!axios.isAxiosError(err)) return false;
    const ax = err as AxiosError;
    const status = ax.response?.status;
    if (status === 429) return true;
    if (status && status >= 500) return true;
    if (!status && ax.code) return true; // timeout / ECONNRESET / ECONNABORTED
    return false;
}

/**
 * Extrai `{ prompt, imageUrl }` do formato content-blocks. Devolve null quando
 * o payload não é "exatamente uma imagem" — inclusive quando há `video_url`.
 */
export function extractImagePrompt(messages: unknown[]): { prompt: string; imageUrl: string } | null {
    const texts: string[] = [];
    const images: string[] = [];
    let hasVideo = false;

    for (const msg of messages ?? []) {
        const content = (msg as { content?: unknown })?.content;
        if (typeof content === 'string') { texts.push(content); continue; }
        if (!Array.isArray(content)) continue;
        for (const block of content) {
            const b = block as { type?: string; text?: string; image_url?: { url?: string }; video_url?: unknown };
            if (b?.type === 'text' && typeof b.text === 'string') texts.push(b.text);
            else if (b?.type === 'image_url' && typeof b.image_url?.url === 'string') images.push(b.image_url.url);
            else if (b?.type === 'video_url') hasVideo = true;
        }
    }

    if (hasVideo || images.length !== 1) return null;
    return { prompt: texts.join('\n\n').trim() || 'Descreva esta imagem em detalhes, em português.', imageUrl: images[0] };
}

/**
 * Tenta a MiniMax e ADAPTA a resposta para o formato que os chamadores já
 * esperam (`data.choices[0].message.content`), para que `describeImage` e afins
 * não precisem saber qual provedor respondeu. `_visionProvider` fica no payload
 * como marcador de observabilidade.
 *
 * Devolve `null` (em vez de lançar) sempre que o fallback não se aplica ou
 * também falha — o caller então relança o erro ORIGINAL do primário, que é o
 * mais informativo para o operador.
 */
async function tryMinimaxVisionFallback(
    messages: unknown[],
    primaryErr: unknown,
    options: VisionCallOptions,
    startMs: number,
): Promise<VisionCallResult | null> {
    const info = describeVisionError(primaryErr);

    if (!isRecoverableVisionError(primaryErr)) return null;

    const { url, apiKey } = getMinimaxVisionConfig();
    if (!apiKey) {
        log.warn('visão: primário falhou e não há chave MiniMax para fallback', { kind: info.kind, status: info.status });
        return null;
    }

    const extracted = extractImagePrompt(messages);
    if (!extracted) {
        log.warn('visão: fallback MiniMax PULADO — payload não é imagem única (vídeo ou múltiplas imagens)', { kind: info.kind });
        return null;
    }

    log.warn('visão: primário falhou — tentando fallback MiniMax VLM', { kind: info.kind, status: info.status, origin: options.origin });

    const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
    try {
        const resp = await axios.post(
            url,
            { prompt: extracted.prompt, image_url: extracted.imageUrl },
            { headers, timeout: options.timeoutMs ?? 120_000, signal: options.signal },
        );
        const body = resp.data as { content?: unknown; base_resp?: { status_code?: number; status_msg?: string } };
        const statusCode = body?.base_resp?.status_code;
        const text = body?.content == null ? '' : String(body.content);

        // A MiniMax devolve 200 com base_resp.status_code != 0 em erro de aplicação.
        if ((statusCode != null && statusCode !== 0) || !text) {
            log.warn('visão: fallback MiniMax respondeu sem conteúdo útil', { statusCode, statusMsg: body?.base_resp?.status_msg });
            return null;
        }

        const elapsedMs = Date.now() - startMs;
        log.info('visão: fallback MiniMax OK', { elapsedMs, chars: text.length, origin: options.origin });
        return {
            status: resp.status,
            elapsedMs,
            data: { choices: [{ message: { content: text } }], _visionProvider: 'minimax-vlm' },
            headers,
        };
    } catch (fbErr) {
        const fbInfo = describeVisionError(fbErr);
        log.warn('visão: fallback MiniMax também falhou', { kind: fbInfo.kind, status: fbInfo.status, body: fbInfo.body?.slice(0, 200) });
        return null;
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

// ---------------------------------------------------------------------------
// Re-exports p/ compat (#1546). O conteúdo foi extraído para
// `backend/src/services/describeVideo.ts` (arquivo pedido pela spec da issue);
// mantemos aqui só pra não quebrar callers legados que importam do visionService
// (ex.: scripts de spike, mocks parciais em testes de integração).
// ---------------------------------------------------------------------------
export {
    describeVideo,
    ACCEPTED_VIDEO_MIME_TYPES,
    DEFAULT_VIDEO_MAX_BYTES,
    VideoAnalysisError,
    type DescribeVideoInput,
    type VideoErrorCode,
} from './describeVideo';
