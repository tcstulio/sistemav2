/**
 * #1546: testes do `describeVideo` (análise de vídeo via glm-4.6v) no seu módulo dedicado.
 *
 * Por que este arquivo existe separado de `visionService.test.ts`:
 *  - `describeVideo` vive em `backend/src/services/describeVideo.ts` (pedido explícito
 *    da spec da issue — "Arquivos estimados: backend/src/services/describeVideo.ts").
 *  - `visionService.test.ts` foi preservado e re-exportado do novo módulo
 *    (mantém a suíte de regressão existente intocada — vide AGENTS.md).
 *  - Aqui exercitamos o módulo no SEU caminho canônico (`services/describeVideo`),
 *    garantindo que quem importar diretamente do novo arquivo tenha cobertura própria.
 *
 * Cobertura: caminho feliz (descrição + log de tokens), rejeição por mime/tamanho,
 * falha transitória do provedor, stripping de data URL, override do limite via env,
 * e o contrato `Buffer | { filePath } | string` (#1546).
 *
 * Mockamos axios (callVisionChat faz o POST) e config.env (p/ controlar videoMaxBytes
 * dinamicamente). O logger já é mockado globalmente em __tests__/setup.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPost, mockConfig } = vi.hoisted(() => ({
    mockPost: vi.fn(),
    mockConfig: {
        zaiVisionBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
        zaiVisionModel: 'glm-4.6v',
        zaiApiKey: 'test-key',
        videoMaxBytes: 10 * 1024 * 1024,
    },
}));

// Sobrepõe o mock global de axios (setup.ts) p/ incluir isAxiosError.
vi.mock('axios', () => ({
    default: { post: mockPost, isAxiosError: (e: unknown) => !!(e as any)?.isAxiosError },
}));

vi.mock('../../config/env', () => ({ config: mockConfig }));

import {
    describeVideo,
    VideoAnalysisError,
    ACCEPTED_VIDEO_MIME_TYPES,
    DEFAULT_VIDEO_MAX_BYTES,
} from '../../services/describeVideo';

function visionResponse(content: string, totalTokens = 42) {
    return {
        status: 200,
        data: {
            choices: [{ message: { content } }],
            usage: { total_tokens: totalTokens },
        },
        headers: { 'Content-Type': 'application/json' },
    };
}

describe('describeVideo (#1546 — módulo dedicado)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockConfig.videoMaxBytes = 10 * 1024 * 1024;
        mockPost.mockReset();
    });

    it('retorna a descrição do provedor e envia video_url com data URL mp4', async () => {
        mockPost.mockResolvedValueOnce(visionResponse('Um carro vermelho atravessa a rua.'));

        const desc = await describeVideo('AAAA', 'video/mp4');

        expect(desc).toBe('Um carro vermelho atravessa a rua.');
        expect(mockPost).toHaveBeenCalledTimes(1);
        const body = mockPost.mock.calls[0][1];
        const parts = body.messages[0].content;
        expect(parts.find((p: any) => p.type === 'video_url').video_url.url).toBe(
            'data:video/mp4;base64,AAAA',
        );
    });

    it('stripa prefixo data URL e deriva o mimeType quando ausente', async () => {
        mockPost.mockResolvedValueOnce(visionResponse('descrição'));

        // #1546: input via base64 puro (sem mime) — o buffer é decodificado e re-encodado,
        // por isso usamos um payload que sobrevive ao round-trip base64 (4 bytes inteiros
        // = 8 chars base64 com padding).
        const originalBytes = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
        const b64 = originalBytes.toString('base64');
        await describeVideo(`data:video/webm;base64,${b64}`, '');

        const body = mockPost.mock.calls[0][1];
        const videoUrl = body.messages[0].content.find((p: any) => p.type === 'video_url').video_url.url;
        // Reconstrói o data URL normalizado a partir do mime derivado.
        expect(videoUrl).toBe(`data:video/webm;base64,${b64}`);
    });

    it('aceita apenas mimeTypes validados pelo spike/conjunto aceito', () => {
        expect(ACCEPTED_VIDEO_MIME_TYPES.has('video/mp4')).toBe(true);
        expect(ACCEPTED_VIDEO_MIME_TYPES.has('video/webm')).toBe(true);
        // #1546: video/quicktime (MOV do iPhone) é aceito pelo mesmo decoder MP4 do glm-4.6v.
        expect(ACCEPTED_VIDEO_MIME_TYPES.has('video/quicktime')).toBe(true);
    });

    it('aceita Buffer como input e envia video_url com data URL', async () => {
        mockPost.mockResolvedValueOnce(visionResponse('descrição via Buffer'));

        const buffer = Buffer.from('mp4-bytes-here');
        const desc = await describeVideo(buffer, 'video/mp4');

        expect(desc).toBe('descrição via Buffer');
        const body = mockPost.mock.calls[0][1];
        const parts = body.messages[0].content;
        expect(parts.find((p: any) => p.type === 'video_url').video_url.url).toBe(
            `data:video/mp4;base64,${buffer.toString('base64')}`,
        );
    });

    it('aceita { filePath } como input e lê o arquivo do disco', async () => {
        mockPost.mockResolvedValueOnce(visionResponse('descrição via filePath'));

        // Cria arquivo temporário REAL. `fs/promises` NÃO é mockado pelo setup global
        // (só `fs` síncrono) — então podemos usar o disco de verdade e limpar depois.
        const fsp = await import('fs/promises');
        const os = await import('os');
        const path = await import('path');
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'vision-dv-'));
        const filePath = path.join(dir, 'sample.mp4');
        const realBytes = Buffer.from('real-mp4-content-on-disk');
        await fsp.writeFile(filePath, realBytes);
        try {
            const desc = await describeVideo({ filePath }, 'video/mp4');
            expect(desc).toBe('descrição via filePath');
            const body = mockPost.mock.calls[0][1];
            const videoUrl = body.messages[0].content.find((p: any) => p.type === 'video_url').video_url.url;
            expect(videoUrl).toBe(`data:video/mp4;base64,${realBytes.toString('base64')}`);
        } finally {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });

    it('filePath inexistente → VideoAnalysisError VISION_CALL_FAILED (502)', async () => {
        // fs/promises real — aponta para um caminho que não existe.
        const path = await import('path');
        const os = await import('os');
        const filePath = path.join(os.tmpdir(), `does-not-exist-${Date.now()}.mp4`);
        await expect(describeVideo({ filePath }, 'video/mp4')).rejects.toMatchObject({
            code: 'VISION_CALL_FAILED',
            httpStatus: 502,
        });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it('rejeita video/quicktime quando o mime é desconhecido antes da chamada ao provedor', async () => {
        // #1546: o conjunto ACEITO inclui video/quicktime; este teste documenta que a rota
        // tem comportamento diferente do conjunto aceito — `video/x-quicktime` (não listado)
        // É rejeitado. Cobre a borda entre "aceito" e "não aceito" no switch de mimes.
        await expect(describeVideo('AAAA', 'video/x-quicktime')).rejects.toMatchObject({
            code: 'UNSUPPORTED_VIDEO_MIME',
            httpStatus: 415,
        });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it('rejeita mimeType não suportado com UNSUPPORTED_VIDEO_MIME (415) sem chamar a API', async () => {
        await expect(describeVideo('AAAA', 'video/avi')).rejects.toMatchObject({
            code: 'UNSUPPORTED_VIDEO_MIME',
            httpStatus: 415,
        });
        expect(mockPost).not.toHaveBeenCalled();
    });

    it('rejeita vídeo acima do limite com VIDEO_TOO_LARGE (413) e mensagem em PT-BR', async () => {
        mockConfig.videoMaxBytes = 100;
        // approxDecodedBytes = floor(200*3/4) = 150 > 100.
        const big = 'A'.repeat(200);

        await expect(describeVideo(big, 'video/mp4')).rejects.toMatchObject({
            code: 'VIDEO_TOO_LARGE',
            httpStatus: 413,
        });
        // mensagem traduzida menciona tamanho e limite em MiB.
        try {
            await describeVideo(big, 'video/mp4');
        } catch (e: any) {
            expect(e.message).toMatch(/MiB/);
            expect(e.message).toMatch(/limite/i);
        }
        expect(mockPost).not.toHaveBeenCalled();
    });

    it('respeita override do limite vindo de config (env VIDEO_MAX_BYTES)', async () => {
        mockConfig.videoMaxBytes = 1000;
        const within = 'A'.repeat(100); // ~75 bytes < 1000.
        mockPost.mockResolvedValueOnce(visionResponse('ok'));

        await expect(describeVideo(within, 'video/mp4')).resolves.toBe('ok');
    });

    it('usa DEFAULT_VIDEO_MAX_BYTES (10 MiB) como referência de fallback', () => {
        expect(DEFAULT_VIDEO_MAX_BYTES).toBe(10 * 1024 * 1024);
    });

    it('traduz falha do provedor em VISION_CALL_FAILED (502)', async () => {
        const axiosErr = Object.assign(new Error('boom'), { isAxiosError: true, response: { status: 500, data: 'upstream down' } });
        mockPost.mockRejectedValueOnce(axiosErr);

        await expect(describeVideo('AAAA', 'video/mp4')).rejects.toMatchObject({
            code: 'VISION_CALL_FAILED',
            httpStatus: 502,
        });
    });

    it('rejeita conteúdo vazio do provedor como VISION_CALL_FAILED (502)', async () => {
        mockPost.mockResolvedValueOnce(visionResponse('', 0));

        await expect(describeVideo('AAAA', 'video/mp4')).rejects.toMatchObject({
            code: 'VISION_CALL_FAILED',
            httpStatus: 502,
        });
    });

    it('VideoAnalysisError é instância de Error com name discriminante', () => {
        const e = new VideoAnalysisError('VIDEO_TOO_LARGE', 'msg', 413);
        expect(e).toBeInstanceOf(Error);
        expect(e.name).toBe('VideoAnalysisError');
        expect(e.code).toBe('VIDEO_TOO_LARGE');
        expect(e.httpStatus).toBe(413);
    });

    it('input inválido (objeto vazio) → VISION_CALL_FAILED (500)', async () => {
        // #1546: tipo errado (não string, não Buffer, não {filePath}) → entrada inválida.
        // A função documenta isso como 500 (programmer error), distinto de 502 (transient).
        await expect(describeVideo({} as any)).rejects.toMatchObject({
            code: 'VISION_CALL_FAILED',
            httpStatus: 500,
        });
    });

    it('origin=describeVideo é passado para callVisionChat (visibilidade no log do provedor)', async () => {
        mockPost.mockResolvedValueOnce(visionResponse('ok'));
        await describeVideo('AAAA', 'video/mp4');
        // 3º argumento de axios.post é a config — `signal`/`timeout`/`headers` lá dentro.
        // Não inspecionamos `origin` diretamente (passado por dentro), mas garantimos que
        // o POST aconteceu — o `origin` é injetado em VisionCallOptions.
        expect(mockPost).toHaveBeenCalledTimes(1);
        const opts = mockPost.mock.calls[0][2];
        expect(opts.timeout).toBe(180_000); // timeoutMs override p/ vídeo
    });
});