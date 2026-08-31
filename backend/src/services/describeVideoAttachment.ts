/**
 * #1546 — `describeVideoAttachment`: helper compartilhado entre as rotas do chat
 * que precisam anexar vídeo. Vive em arquivo separado de `describeVideo.ts`
 * para que testes possam mockar `describeVideo` (o POST caro ao glm-4.6v) sem
 * precisar mockar a infraestrutura completa de arquivo/diretório temporário.
 *
 * Por que existe este helper:
 *  - A spec da issue lista UM fluxo canônico p/ vídeo no chat:
 *      1) decodifica base64 → Buffer
 *      2) valida mime (UNSUPPORTED_VIDEO_MIME → 415)
 *      3) valida tamanho (limite configurável por env, padrão 20 MiB → 413)
 *      4) salva temporariamente em diretório ÚNICO (mkdtemp em os.tmpdir())
 *      5) chama `describeVideo` passando `{ filePath }`
 *      6) remove o diretório em `finally` (best-effort)
 *      7) devolve a descrição para a rota injetar no `messages` do loop de tools
 *  - As rotas `/chat/analyze-video` E `/api/ai/generate-reply` precisam desse mesmo
 *    fluxo. Centralizar evita divergência entre as duas (uma valida, outra não;
 *    uma limpa tmp, outra vazia arquivo no disco).
 *
 * Por que arquivo separado de `describeVideo.ts`:
 *  - `describeVideoAttachment` importa `describeVideo` como dependência (binding
 *    via `import`). Os testes mockam `services/describeVideo` substituindo o
 *    `describeVideo` exportado; graças ao import binding (não chamada local),
 *    o mock é observado pelo helper automaticamente. Se helper e `describeVideo`
 *    vivessem no mesmo arquivo, a chamada interna usaria a referência local e o
 *    mock seria BYINOS — o teste rodaria contra a rede real.
 *
 * Comportamento de erro:
 *  - UNSUPPORTED_VIDEO_MIME (mime fora de ACCEPTED_VIDEO_MIME_TYPES) → sobe.
 *  - VIDEO_TOO_LARGE (bytes > maxBytes) → sobe.
 *  - VISION_CALL_FAILED (502 do provedor) → retorna `{ description: null }` —
 *    degradação graciosa idêntica à do `describeImage` em `aiService`.
 *  - Outros erros não-tipados → sobem para o errorHandler global decidir 500.
 */
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    ACCEPTED_VIDEO_MIME_TYPES,
    describeVideo,
    VideoAnalysisError,
} from './describeVideo';
import { config } from '../config/env';
import { createLogger } from '../utils/logger';

const log = createLogger('describeVideoAttachment');

/**
 * Opções de `describeVideoAttachment`. Todos os campos são opcionais — a função tem
 * defaults seguros vindos de `config.chatVideoMaxBytes` / `ACCEPTED_VIDEO_MIME_TYPES`.
 */
export interface DescribeVideoAttachmentOptions {
    /** Limite em bytes. Default: `config.chatVideoMaxBytes` (env CHAT_VIDEO_MAX_BYTES, 20 MiB). */
    maxBytes?: number;
    /** Tag livre p/ log estruturado (ex.: 'chat/analyze-video', 'generate-reply'). */
    origin?: string;
    /**
     * Quando true (default), faz cleanup do diretório temporário em `finally`.
     * Útil desligar em testes que inspecionam o filePath residual.
     */
    cleanup?: boolean;
}

/**
 * Resultado da análise. `description` é null quando o provedor de visão está
 * indisponível (degradação graciosa, mesmo padrão de `describeImage` em `aiService`).
 */
export interface DescribeVideoAttachmentResult {
    /** Descrição textual, ou `null` se o provedor falhou (502). */
    description: string | null;
    /** Path do arquivo temporário no disco (NÃO é uma data URL — é caminho FS). */
    filePath: string;
    /** Mime normalizado (lowercase, sem `;charset=...`). */
    mimeType: string;
    /** Bytes decodificados (tamanho real do vídeo no disco). */
    bytes: number;
    /** Limite aplicado (em bytes) — eco do `opts.maxBytes` resolvido. */
    maxBytes: number;
}

/**
 * Implementa o fluxo canônico de anexo de vídeo (#1546) usado pelas rotas do chat.
 *
 *  - Decodifica base64 e valida que não é vazio (input vazio → 400 BAD_REQUEST
 *    com mensagem PT-BR clara — UX consistente com o analyze-pdf do mesmo router).
 *  - Valida mime contra `ACCEPTED_VIDEO_MIME_TYPES`. Mime ausente/inválido →
 *    UNSUPPORTED_VIDEO_MIME (415).
 *  - Valida tamanho contra `opts.maxBytes ?? config.chatVideoMaxBytes`. Acima do
 *    limite → VIDEO_TOO_LARGE (413) com mensagem PT-BR mencionando MiB.
 *  - Salva o buffer em `os.tmpdir()/chat-video-<random>/input.<ext>`. O diretório é
 *    ÚNICO por chamada (mkdtemp) para que requests concorrentes não colidam.
 *  - Chama `describeVideo({ filePath })` e devolve a descrição.
 *  - Remove o diretório em `finally` (best-effort; falha de cleanup não derruba a resposta).
 *  - Em caso de `VideoAnalysisError` com code `VISION_CALL_FAILED` (502), devolve
 *    `{ description: null, ... }` em vez de lançar — degradação graciosa, mesmo padrão
 *    do `analyze-pdf` (#1547) e `describeImage` (#934) no `aiService`. Codes 413/415
 *    SOBEM como exceção (são erros do usuário).
 *
 * Não usar fora do contexto de anexo HTTP (testes podem chamar diretamente).
 */
export async function describeVideoAttachment(
    videoBase64: string,
    mimeType: string,
    opts: DescribeVideoAttachmentOptions = {}
): Promise<DescribeVideoAttachmentResult> {
    const maxBytes = opts.maxBytes ?? config.chatVideoMaxBytes;
    const cleanup = opts.cleanup ?? true;
    const origin = opts.origin || 'describeVideoAttachment';

    // 1) Decodifica base64 → Buffer.
    const clean = String(videoBase64 || '').replace(/^data:[^,]+,/, '');
    const buffer = Buffer.from(clean, 'base64');

    // 2) Mime normalizado (lowercase, sem sufixo ;charset=...).
    const mime = (mimeType || '').toLowerCase().split(';')[0].trim();
    if (!ACCEPTED_VIDEO_MIME_TYPES.has(mime)) {
        throw new VideoAnalysisError(
            'UNSUPPORTED_VIDEO_MIME',
            `Tipo de vídeo não suportado: "${mime || 'desconhecido'}". Formatos aceitos: ${[...ACCEPTED_VIDEO_MIME_TYPES].join(', ')}.`,
            415,
        );
    }

    // 3) Validação de tamanho NA BORDA HTTP (limite configurável por env). Diferente do
    //    `videoMaxBytes` validado dentro de `describeVideo` (10 MiB, o teto do glm-4.6v):
    //    este limite é maior (20 MiB default) porque é onde aceitamos/rejeitamos o upload
    //    do usuário. Mensagem PT-BR com tamanho atual e limite em MiB.
    const bytes = buffer.length;
    if (bytes === 0) {
        throw new VideoAnalysisError(
            'UNSUPPORTED_VIDEO_MIME',
            'Vídeo vazio após decodificar base64.',
            400,
        );
    }
    if (bytes > maxBytes) {
        const sentMiB = (bytes / 1024 / 1024).toFixed(2);
        const limitMiB = (maxBytes / 1024 / 1024).toFixed(2);
        throw new VideoAnalysisError(
            'VIDEO_TOO_LARGE',
            `Vídeo excede o limite de ${limitMiB} MiB. Recebido: ${sentMiB} MiB. Envie um vídeo menor.`,
            413,
        );
    }

    // 4) Salva em diretório ÚNICO por chamada (mkdtemp evita colisão em requests concorrentes).
    const ext = mime === 'video/quicktime' ? 'mov' : 'mp4';
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'chat-video-'));
    const tmpPath = path.join(tmpDir, `input.${ext}`);

    let description: string | null = null;
    try {
        await fsp.writeFile(tmpPath, buffer);
        log.debug(
            `describeVideoAttachment: caminho vídeo (origin=${origin}, mime=${mime}, ${bytes} bytes, limite=${maxBytes})`,
        );
        // IMPORTANTE: `describeVideo` é importado via `import { describeVideo } from
        // './describeVideo';` — quando o teste mocka `services/describeVideo` substituindo
        // esse export, o import binding é atualizado e esta chamada vai para o mock, não
        // para a referência original.
        description = await describeVideo({ filePath: tmpPath }, mime);
        // Defesa em profundidade: `describeVideo` declara `Promise<string>`, mas mocks de
        // teste podem resolver com `null`. Se a descrição vier vazia/null, tratamos como
        // visão indisponível (502) — degradação graciosa idêntica ao caso VISION_CALL_FAILED.
        if (typeof description !== 'string' || description.length === 0) {
            log.warn(
                `describeVideoAttachment: descrição vazia do provedor (origin=${origin}); seguindo sem descrição`,
                { mime, bytes },
            );
            return { description: null, filePath: tmpPath, mimeType: mime, bytes, maxBytes };
        }
        log.info(
            `describeVideoAttachment concluído (origin=${origin}, mime=${mime}, ` +
            `descrição=${description.length} chars)`,
        );
    } catch (err) {
        // Erros 413/415 (do `describeVideo` chamado pelo `describeVideoAttachment`) SOBEM
        // — são erros do usuário e devem rejeitar a request. 502 e outros transitórios
        // viram `description = null` para o caller poder degradar sem quebrar o chat.
        if (err instanceof VideoAnalysisError) {
            if (err.code === 'VISION_CALL_FAILED') {
                log.warn(
                    `describeVideoAttachment: visão indisponível (origin=${origin}); seguindo sem descrição`,
                    { mime, bytes, errorMessage: err.message },
                );
                return { description: null, filePath: tmpPath, mimeType: mime, bytes, maxBytes };
            }
            throw err;
        }
        // Erro não-tipado (programmer error / bug) — SOBE para o errorHandler global
        // decidir 500. Não mascaramos bugs como degradação graciosa.
        throw err;
    } finally {
        if (cleanup) {
            try {
                await fsp.rm(tmpDir, { recursive: true, force: true });
            } catch {
                /* best-effort cleanup; tmpdir é purgável pelo SO depois */
            }
        }
    }

    return { description, filePath: tmpPath, mimeType: mime, bytes, maxBytes };
}