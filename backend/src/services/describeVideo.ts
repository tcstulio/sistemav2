/**
 * #1546 — `describeVideo`: análogo a `describeImage`, mas para vídeos via glm-4.6v (`video_url`).
 *
 * Recebe um `Buffer` ou um caminho de arquivo (o caller já salvou temporariamente) e devolve
 * uma descrição textual em português. Mantém a mesma assinatura de retorno do `describeImage`
 * (`string | null` — null em falha / visão indisponível, sem alucinar conteúdo).
 *
 * Por que data URL: o spike #1029 validou que a base Coding do glm-4.6v aceita MP4 via
 * `data:video/mp4;base64,...` em `video_url.url`. Upload para um host público fugiria do
 * escopo desta issue e adicionaria superfície de segurança/privacidade sem ganho real.
 *
 * Por que aceita Buffer OU filePath: o caller (chatRoutes) precisa SALVAR o vídeo em disco
 * temporariamente (audit / observabilidade / ferramentas externas como ffmpeg preview), então
 * recebe o `filePath`. Já outros chamadores (spike #1029, testes, tools internas) operam
 * com Buffer em memória. O contrato flexível evita forçar I/O extra quando não é necessário.
 *
 * Os defaults de configuração (apiKey, baseUrl, model) são os MESMOS do `describeImage`
 * (`config.zaiVisionBaseUrl` / `config.zaiVisionModel`) — visão é um único recurso; se o
 * usuário configurou chave pra imagem, vídeo reusa a mesma.
 */
import * as fsp from 'fs/promises';
import axios from 'axios';
import { config } from '../config/env';
import { createLogger } from '../utils/logger';

const log = createLogger('DescribeVideo');

/** MIMEs de vídeo suportados pelo glm-4.6v (vide spike #1029). */
export const SUPPORTED_VIDEO_MIMES = ['video/mp4', 'video/quicktime'] as const;
export type SupportedVideoMime = (typeof SUPPORTED_VIDEO_MIMES)[number];

export interface DescribeVideoBufferInput {
    /** Bytes brutos do vídeo (decodificado de base64 pelo caller). */
    buffer: Buffer;
    /** MIME do vídeo — default `video/mp4` quando ausente. */
    mimeType?: SupportedVideoMime;
}

export interface DescribeVideoFileInput {
    /** Caminho do arquivo no disco. describeVideo lê e descarta após a chamada. */
    filePath: string;
    /** MIME do vídeo — default `video/mp4` quando ausente. */
    mimeType?: SupportedVideoMime;
}

export type DescribeVideoInput = DescribeVideoBufferInput | DescribeVideoFileInput;

/** Caller LLM injetável (testes substituem pra evitar chamadas reais à API). */
export type VisionCaller = (
    messages: unknown[],
    options: { baseUrl: string; model: string; apiKey: string; timeoutMs: number }
) => Promise<{ data: unknown }>;

export interface DescribeVideoOptions {
    /** Caller LLM injetável. Default: axios POST contra `config.zaiVisionBaseUrl`. */
    callVisionChat?: VisionCaller;
    /** Timeout da chamada HTTP em ms (default 180s — upload de data URL grande). */
    timeoutMs?: number;
}

/** Prompt base em português; `userHint` é concatenado quando presente (mesmo padrão do `describeImage`). */
const VIDEO_PROMPT_BASE = `Analise este vídeo em detalhes, em português.
- Identifique objetos, pessoas, ações, falas (transcreva se houver áudio compreensível) e textos visíveis em tela.
- Se contiver documento/nota/recibo/tela: extraia TODOS os textos legíveis (OCR), incluindo códigos, referências, quantidades, valores e datas.
- Se contiver produtos/objetos: identifique-os e descreva a sequência temporal dos eventos principais.
- Seja factual; não invente o que não estiver visível.`;

async function defaultCallVisionChat(
    messages: unknown[],
    options: { baseUrl: string; model: string; apiKey: string; timeoutMs: number }
): Promise<{ data: unknown }> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;
    const response = await axios.post(
        `${options.baseUrl}/chat/completions`,
        { model: options.model, messages, temperature: 0.1 },
        { headers, timeout: options.timeoutMs }
    );
    return { data: response.data };
}

function mimeToExtension(mime: SupportedVideoMime | undefined): string {
    return mime === 'video/quicktime' ? 'mov' : 'mp4';
}

/** Indica se o input é filePath-based (discriminado pela presença da chave). */
function isFileInput(input: DescribeVideoInput): input is DescribeVideoFileInput {
    return typeof (input as DescribeVideoFileInput).filePath === 'string';
}

/**
 * Descreve um vídeo via glm-4.6v (`video_url`).
 *
 * Retorno:
 *   - `string` com a descrição retornada pela visão em caso de sucesso;
 *   - `null` se a visão está indisponível (sem API key) OU se a chamada falhou (timeout,
 *     4xx/5xx, resposta vazia). Não lança — falha da visão degrada graciosamente,
 *     mesmo contrato do `describeImage` (#934). O caller decide como sinalizar ao usuário.
 */
export async function describeVideo(
    input: DescribeVideoInput,
    userHint?: string,
    options: DescribeVideoOptions = {}
): Promise<string | null> {
    const apiKey = config.zaiApiKey || '';
    const baseUrl = (config.zaiVisionBaseUrl || 'https://api.z.ai/api/coding/paas/v4').replace(/\/+$/, '');
    const model = config.zaiVisionModel || 'glm-4.6v';
    const callVisionChat = options.callVisionChat ?? defaultCallVisionChat;

    if (!apiKey) {
        // #1546: visão indisponível NÃO é erro do caller (ex.: provider Ollama sem multimodal) —
        // retornamos null pra que a integração (chatRoutes) decida o fallback (igual ao image).
        log.warn('describeVideo: ZAI_API_KEY ausente — visão indisponível, retornando null');
        return null;
    }

    let buffer: Buffer;
    try {
        if (isFileInput(input)) {
            buffer = await fsp.readFile(input.filePath);
        } else {
            buffer = input.buffer;
        }
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error(`describeVideo: falha ao ler vídeo (${msg})`);
        return null;
    }

    if (!buffer || !buffer.length) {
        log.warn('describeVideo: buffer de vídeo vazio');
        return null;
    }

    const mimeType: SupportedVideoMime = input.mimeType ?? 'video/mp4';
    const ext = mimeToExtension(mimeType);
    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
    const prompt = `${VIDEO_PROMPT_BASE}${userHint ? `\nContexto do usuário: ${userHint}` : ''}`;

    try {
        const response = await callVisionChat(
            [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'video_url', video_url: { url: dataUrl } },
                    ],
                },
            ],
            { baseUrl, model, apiKey, timeoutMs: options.timeoutMs ?? 180_000 }
        );
        const data = response.data as {
            choices?: Array<{ message?: { content?: unknown } }>;
        } | null | undefined;
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content === 'string') return content;
        return null;
    } catch (error: unknown) {
        // #1546: log com prefixo `video` pra distinguir de `describeImage` nos logs estruturados.
        // Mesmo padrão de captura do `describeImage`: error.response.data se Axios-like, senão message.
        const errObj = error as { response?: { data?: unknown }; message?: string } | null;
        const detail = errObj?.response?.data
            ? JSON.stringify(errObj.response.data).slice(0, 300)
            : (errObj?.message || String(error));
        log.error(`describeVideo falhou (mime=${mimeType}, ${buffer.length} bytes, ext=${ext}): ${detail}`);
        return null;
    }
}

export default describeVideo;