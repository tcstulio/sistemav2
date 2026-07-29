/**
 * #1030: testes do describeVideo (análise de vídeo via glm-4.6v).
 *
 * O spike #1029 confirmou SUPORTA — o endpoint aceita `video_url` com data URL MP4.
 * Aqui cobrimos: caminho feliz (descrição + log de tokens), rejeição por mime/tamanho,
 * falha transitória do provedor, stripping de data URL e override do limite via env.
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
} from '../../services/visionService';

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

describe('describeVideo (#1030)', () => {
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

        await describeVideo('data:video/webm;base64,BB==', '');

        const body = mockPost.mock.calls[0][1];
        const videoUrl = body.messages[0].content.find((p: any) => p.type === 'video_url').video_url.url;
        // Reconstrói o data URL normalizado a partir do mime derivado.
        expect(videoUrl).toBe('data:video/webm;base64,BB==');
    });

    it('aceita apenas mimeTypes validados pelo spike/conjunto aceito', () => {
        expect(ACCEPTED_VIDEO_MIME_TYPES.has('video/mp4')).toBe(true);
        expect(ACCEPTED_VIDEO_MIME_TYPES.has('video/webm')).toBe(true);
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
});
