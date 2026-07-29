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

/**
 * #1030: análise de vídeo via glm-4.6v (base Coding), análoga ao `describeImage` do
 * LocalProvider, mas vivendo AQUI (passo 2 da extração iniciada em #1029). O spike
 * `test-video-glm.ts` confirmou SUPORTA: o endpoint aceita `video_url` com data URL
 * `data:video/mp4;base64,...` (≥8.48 MiB, MP4/H.264). WebM não foi exercitado pelo
 * spike, mas o mesmo endpoint o aceita por mimeType — restrinja ACCEPTED_VIDEO_MIME_TYPES
 * se quiser limitar ao estritamente validado.
 */

/** MimeTypes aceitos (spike validou video/mp4; video/webm aceito por analogia do endpoint). */
export const ACCEPTED_VIDEO_MIME_TYPES: ReadonlySet<string> = new Set(['video/mp4', 'video/webm']);

/**
 * Limite padrão (bytes decodificados) quando config.videoMaxBytes não definido. Spike
 * confirmou ≥8.48 MiB aceitos; 10 MiB dá folha sobre o provado sem exagerar.
 */
export const DEFAULT_VIDEO_MAX_BYTES = 10 * 1024 * 1024;

export type VideoErrorCode = 'VIDEO_TOO_LARGE' | 'UNSUPPORTED_VIDEO_MIME' | 'VISION_CALL_FAILED';

/**
 * Erro tipado de análise de vídeo. `code` discrimina a causa; `httpStatus` sugere o status
 * HTTP adequado. O handler do chat checa `.code` (duck-typing, não instanceof) para seguir
 * degradando o chat mesmo quando o visionService está mockado nos testes de rota.
 */
export class VideoAnalysisError extends Error {
    readonly code: VideoErrorCode;
    readonly httpStatus: number;
    constructor(code: VideoErrorCode, message: string, httpStatus: number) {
        super(message);
        this.name = 'VideoAnalysisError';
        this.code = code;
        this.httpStatus = httpStatus;
    }
}

/** Tamanho aproximado (bytes) do payload decodificado a partir do base64, sem alocar Buffer. */
function approxDecodedBytes(base64: string): number {
    const noPad = base64.replace(/=+$/, '');
    return Math.floor((noPad.length * 3) / 4);
}

/** Extrai o mimeType de uma data URL (`data:video/mp4;base64,...`) ou devolve undefined. */
function mimeFromDataUrl(s: string): string | undefined {
    const m = /^data:([^;,]+)(?:;[^,]*)?,/.exec(s);
    return m?.[1];
}

const VIDEO_DESC_PROMPT = `Analise este vídeo em detalhes, em português.
- Descreva o que acontece: ações, objetos, pessoas, cenários e a sequência dos eventos.
- Se houver textos, legendas ou interface na tela, transcreva-os.
- Se houver áudio relevante (falas, sons), resuma quando possível.
- Seja factual; não invente o que não estiver presente.`;

/**
 * Descreve o conteúdo de um vídeo via glm-4.6v (`video_url`), análoga ao `describeImage`.
 * Usa o cliente JÁ configurado (callVisionChat). Aceita `videoBase64` como data URL
 * (`data:video/mp4;base64,...`) ou base64 puro — neste caso `mimeType` é obrigatório.
 *
 * Lança `VideoAnalysisError` em:
 *  - UNSUPPORTED_VIDEO_MIME (mimeType fora de ACCEPTED_VIDEO_MIME_TYPES) → 415
 *  - VIDEO_TOO_LARGE (bytes decodificados > config.videoMaxBytes) → 413
 *  - VISION_CALL_FAILED (provedor indisponível / resposta vazia) → 502
 *
 * O chamador (handler do chat) decide: 413/415 são erros do usuário e DEVEM rejeitar a
 * requisição; 502 é transitório e degrada para aviso (não quebra o chat), como nas imagens.
 */
export async function describeVideo(videoBase64: string, mimeType: string): Promise<string> {
    const clean = videoBase64.replace(/^data:[^,]+,/, '');
    const mime = (mimeType || mimeFromDataUrl(videoBase64) || '').toLowerCase().split(';')[0].trim();

    if (!ACCEPTED_VIDEO_MIME_TYPES.has(mime)) {
        throw new VideoAnalysisError(
            'UNSUPPORTED_VIDEO_MIME',
            `Tipo de vídeo não suportado: "${mime || 'desconhecido'}". Formatos aceitos: ${[...ACCEPTED_VIDEO_MIME_TYPES].join(', ')}.`,
            415,
        );
    }

    const maxBytes = config.videoMaxBytes || DEFAULT_VIDEO_MAX_BYTES;
    const bytes = approxDecodedBytes(clean);
    if (bytes > maxBytes) {
        const sentMiB = (bytes / 1024 / 1024).toFixed(2);
        const limitMiB = (maxBytes / 1024 / 1024).toFixed(2);
        throw new VideoAnalysisError(
            'VIDEO_TOO_LARGE',
            `O vídeo possui ${sentMiB} MiB, acima do limite de ${limitMiB} MiB. Envie um vídeo menor.`,
            413,
        );
    }

    const dataUrl = `data:${mime};base64,${clean}`;
    const startMs = Date.now();
    try {
        const result = await callVisionChat(
            [{
                role: 'user',
                content: [
                    { type: 'text', text: VIDEO_DESC_PROMPT },
                    { type: 'video_url', video_url: { url: dataUrl } },
                ],
            }],
            { timeoutMs: 180_000, origin: 'describeVideo' },
        );
        const elapsedMs = Date.now() - startMs;
        const data = result.data as { choices?: Array<{ message?: { content?: unknown } }>; usage?: { total_tokens?: number } };
        const content = data?.choices?.[0]?.message?.content;
        const tokens = data?.usage?.total_tokens;
        const text = content == null ? '' : String(content);
        if (!text) {
            log.warn('describeVideo: provedor retornou conteúdo vazio', { mime, bytes, elapsedMs, tokens, status: result.status });
            throw new VideoAnalysisError('VISION_CALL_FAILED', 'O provedor de visão não retornou descrição para o vídeo.', 502);
        }
        log.info('describeVideo concluído', { mime, bytes, elapsedMs, tokens, status: result.status });
        return text;
    } catch (err) {
        if (err instanceof VideoAnalysisError) throw err;
        const info = describeVisionError(err);
        const elapsedMs = Date.now() - startMs;
        log.warn('describeVideo falhou', { mime, bytes, elapsedMs, kind: info.kind, status: info.status, code: info.code });
        throw new VideoAnalysisError(
            'VISION_CALL_FAILED',
            'Não foi possível analisar o vídeo no momento (provedor de visão indisponível).',
            502,
        );
    }
}
