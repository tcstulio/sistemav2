/**
 * #1546 — `describeVideo`: análise multimodal de vídeo via glm-4.6v (`video_url`).
 *
 * Análoga à `describeImage` (LocalProvider.aiService), mas vivendo em arquivo
 * próprio — explicitamente pedido pela spec da issue (#1546 — "Arquivos estimados:
 * backend/src/services/describeVideo.ts"). Reusa o cliente multimodal compartilhado
 * em `visionService` (`callVisionChat`, `describeVisionError`) — não duplica a
 * config/env nem o POST /chat/completions, mesmo princípio que #1029/#1030.
 *
 * Histórico:
 *   - #1030: primeira encarnação da função, dentro de `visionService.ts`.
 *   - #1546: extraída para cá para casar com a spec da issue e isolar o
 *     `VideoAnalysisError` (que tem semântica específica de chat — 413/415/502).
 *
 * O handler HTTP está em `backend/src/routes/chatRoutes.ts` (POST /chat/analyze-video),
 * análogo ao POST /chat/analyze-pdf (#1547) e ao /api/ai/generate-reply (#1030) —
 * três pontos de entrada para o mesmo serviço, dependendo do chamador.
 */
import * as fsp from 'fs/promises';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { callVisionChat, describeVisionError } from './visionService';

const log = logger.child('describeVideo');

/** MimeTypes aceitos. Spike #1029 validou `video/mp4`; `video/webm` aceito por analogia
 *  do endpoint; `video/quicktime` (#1546 — MOV do iPhone) também passa pelo mesmo
 *  decoder MP4 do glm-4.6v (mesma família H.264/HEVC). Restringir se quiser limitar
 *  ao estritamente validado em produção. */
export const ACCEPTED_VIDEO_MIME_TYPES: ReadonlySet<string> = new Set([
    'video/mp4',
    'video/webm',
    'video/quicktime',
]);

/**
 * Limite padrão (bytes decodificados) quando config.videoMaxBytes não definido. Spike
 * confirmou ≥8.48 MiB aceitos; 10 MiB dá folha sobre o provado sem exagerar.
 */
export const DEFAULT_VIDEO_MAX_BYTES = 10 * 1024 * 1024;

export type VideoErrorCode = 'VIDEO_TOO_LARGE' | 'UNSUPPORTED_VIDEO_MIME' | 'VISION_CALL_FAILED';

/**
 * Erro tipado de análise de vídeo. `code` discrimina a causa; `httpStatus` sugere o status
 * HTTP adequado. O handler do chat checa `.code` (duck-typing, não instanceof) para seguir
 * degradando o chat mesmo quando o `describeVideo` está mockado nos testes de rota.
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
 * Input aceito por `describeVideo` (#1546). Três formas suportadas, discriminadas pelo
 * tipo em runtime:
 *
 *  - `string`  → base64 puro OU data URL `data:video/mp4;base64,...`. Compat com a
 *                integração já existente em `aiRoutes.ts` (issue #1030).
 *  - `Buffer`  → bytes brutos do vídeo em memória. Útil para tools / testes.
 *  - `{ filePath }` → caminho em disco; a função lê, descreve e libera a referência.
 *                O handler do chat (#1546) salva temporariamente o anexo do usuário
 *                para suportar auditoria / preview externo, e passa o `filePath`.
 */
export type DescribeVideoInput =
    | string
    | Buffer
    | { filePath: string };

/**
 * Descreve o conteúdo de um vídeo via glm-4.6v (`video_url`), análoga à `describeImage`
 * do `LocalProvider`. Usa o cliente multimodal compartilhado (`callVisionChat` em
 * `visionService.ts`) — não duplica config nem endpoint. Suporta três formatos de input:
 *
 *  - `string` (data URL ou base64 puro) — compat com a integração original (#1030).
 *  - `Buffer` — bytes brutos do vídeo.
 *  - `{ filePath }` — caminho em disco (lê o arquivo, descarta a referência após).
 *
 * Lança `VideoAnalysisError` em:
 *  - UNSUPPORTED_VIDEO_MIME (mimeType fora de ACCEPTED_VIDEO_MIME_TYPES) → 415
 *  - VIDEO_TOO_LARGE (bytes decodificados > config.videoMaxBytes) → 413
 *  - VISION_CALL_FAILED (provedor indisponível / resposta vazia / file não existe) → 502
 *
 * O chamador (handler do chat) decide: 413/415 são erros do usuário e DEVEM rejeitar a
 * requisição; 502 é transitório e degrada para aviso (não quebra o chat), como nas imagens.
 */
export async function describeVideo(input: DescribeVideoInput, mimeType?: string): Promise<string> {
    // 1) Normaliza o input para `{ buffer, mimeHint }`. `mimeHint` é o mime declarado
    //    pelo caller (ou extraído do prefixo data:). Validação final do mime acontece
    //    depois de sabermos o mime efetivo.
    let buffer: Buffer;
    let mimeHint: string | undefined;
    if (typeof input === 'string') {
        const clean = input.replace(/^data:[^,]+,/, '');
        buffer = Buffer.from(clean, 'base64');
        mimeHint = mimeType || mimeFromDataUrl(input) || undefined;
    } else if (Buffer.isBuffer(input)) {
        buffer = input;
        mimeHint = mimeType;
    } else if (input && typeof input.filePath === 'string') {
        try {
            buffer = await fsp.readFile(input.filePath);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.warn('describeVideo: falha ao ler arquivo', { filePath: input.filePath, error: msg });
            throw new VideoAnalysisError(
                'VISION_CALL_FAILED',
                'Não foi possível ler o arquivo de vídeo temporário.',
                502,
            );
        }
        mimeHint = mimeType;
    } else {
        throw new VideoAnalysisError(
            'VISION_CALL_FAILED',
            'Entrada inválida para describeVideo: esperava string base64, Buffer ou { filePath }.',
            500,
        );
    }

    const mime = (mimeHint || '').toLowerCase().split(';')[0].trim();
    if (!ACCEPTED_VIDEO_MIME_TYPES.has(mime)) {
        throw new VideoAnalysisError(
            'UNSUPPORTED_VIDEO_MIME',
            `Tipo de vídeo não suportado: "${mime || 'desconhecido'}". Formatos aceitos: ${[...ACCEPTED_VIDEO_MIME_TYPES].join(', ')}.`,
            415,
        );
    }

    const maxBytes = config.videoMaxBytes || DEFAULT_VIDEO_MAX_BYTES;
    const bytes = buffer.length;
    if (bytes > maxBytes) {
        const sentMiB = (bytes / 1024 / 1024).toFixed(2);
        const limitMiB = (maxBytes / 1024 / 1024).toFixed(2);
        throw new VideoAnalysisError(
            'VIDEO_TOO_LARGE',
            `O vídeo possui ${sentMiB} MiB, acima do limite de ${limitMiB} MiB. Envie um vídeo menor.`,
            413,
        );
    }

    const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
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