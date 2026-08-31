/**
 * #1546 — testes do helper `describeVideoAttachment`.
 *
 * Cobre o fluxo canônico do anexo de vídeo (validate → save-temp → call → cleanup)
 * independente do contexto da rota HTTP. Os testes de integração do
 * `/chat/analyze-video` e `/api/ai/generate-reply` (que usam o helper) estão em
 * `__tests__/routes/chatRoutes.test.ts` e `__tests__/routes/aiRoutes.test.ts`.
 *
 * Estratégia: mockamos `describeVideo` (o POST caro ao glm-4.6v) e deixamos o
 * helper usar o filesystem real (tmpdir + mkdtemp) para exercitar o cleanup
 * best-effort e a sequência save-temp → describeVideo → cleanup de ponta a ponta.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDescribeVideo = vi.hoisted(() => vi.fn());

vi.mock('../../services/describeVideo', () => ({
    describeVideo: mockDescribeVideo,
    VideoAnalysisError: class VideoAnalysisError extends Error {
        code: string;
        httpStatus: number;
        constructor(code: string, message: string, httpStatus: number) {
            super(message);
            this.code = code;
            this.httpStatus = httpStatus;
            this.name = 'VideoAnalysisError';
        }
    },
    ACCEPTED_VIDEO_MIME_TYPES: new Set(['video/mp4', 'video/quicktime', 'video/webm']),
}));

vi.mock('../../config/env', () => ({
    config: {
        chatVideoMaxBytes: 1024, // 1 KiB p/ testes previsíveis
    },
}));

import {
    describeVideoAttachment,
} from '../../services/describeVideoAttachment';
import { VideoAnalysisError } from '../../services/describeVideo';

describe('describeVideoAttachment (#1546 — helper compartilhado)', () => {
    beforeEach(() => {
        mockDescribeVideo.mockReset();
    });

    it('decodifica base64, valida mime, salva em tmpdir e devolve a descrição', async () => {
        mockDescribeVideo.mockResolvedValueOnce('descrição fake');
        const video = Buffer.alloc(512, 0xab);
        const result = await describeVideoAttachment(
            video.toString('base64'),
            'video/mp4',
            { origin: '/test' },
        );

        expect(result.description).toBe('descrição fake');
        expect(result.mimeType).toBe('video/mp4');
        expect(result.bytes).toBe(512);
        expect(result.maxBytes).toBe(1024);
        // Salvo em tmpdir com extensão mp4.
        expect(result.filePath).toMatch(/chat-video-/);
        expect(result.filePath).toMatch(/\.mp4$/);
        // describeVideo foi chamado com { filePath } apontando para o arquivo salvo.
        expect(mockDescribeVideo).toHaveBeenCalledTimes(1);
        const [inputArg, mimeArg] = mockDescribeVideo.mock.calls[0];
        expect(inputArg).toMatchObject({ filePath: expect.stringMatching(/\.mp4$/) });
        expect(mimeArg).toBe('video/mp4');
    });

    it('aceita video/quicktime (MOV) e salva com extensão .mov', async () => {
        mockDescribeVideo.mockResolvedValueOnce('descrição mov');
        const result = await describeVideoAttachment(
            Buffer.alloc(128).toString('base64'),
            'video/quicktime',
        );
        expect(result.mimeType).toBe('video/quicktime');
        expect(result.filePath.endsWith('.mov')).toBe(true);
    });

    it('remove o diretório temporário após o processamento (cleanup best-effort)', async () => {
        mockDescribeVideo.mockResolvedValueOnce('desc');
        const result = await describeVideoAttachment(
            Buffer.alloc(64).toString('base64'),
            'video/mp4',
        );
        // O arquivo NÃO deve existir mais após a função retornar.
        const fsp = await import('fs/promises');
        await expect(fsp.access(result.filePath)).rejects.toThrow();
    });

    it('cleanup também roda quando describeVideo lança VISION_CALL_FAILED (degradação)', async () => {
        mockDescribeVideo.mockRejectedValueOnce(
            new VideoAnalysisError('VISION_CALL_FAILED', 'provedor caiu', 502),
        );
        const result = await describeVideoAttachment(
            Buffer.alloc(64).toString('base64'),
            'video/mp4',
        );
        // Devolve descrição null sem lançar (degradação graciosa).
        expect(result.description).toBeNull();
        // Cleanup do tmpdir também aconteceu.
        const fsp = await import('fs/promises');
        await expect(fsp.access(result.filePath)).rejects.toThrow();
    });

    it('cleanup=false mantém o arquivo no disco (útil p/ debug)', async () => {
        mockDescribeVideo.mockResolvedValueOnce('desc');
        const result = await describeVideoAttachment(
            Buffer.alloc(64).toString('base64'),
            'video/mp4',
            { cleanup: false },
        );
        const fsp = await import('fs/promises');
        // Arquivo persiste após a função retornar.
        await expect(fsp.access(result.filePath)).resolves.toBeUndefined();
        // Cleanup manual p/ não deixar lixo no disco.
        await fsp.rm(result.filePath.replace(/input\.mp4$/, ''), { recursive: true, force: true });
    });

    it('mimeType ausente → UNSUPPORTED_VIDEO_MIME (415)', async () => {
        await expect(
            describeVideoAttachment(Buffer.alloc(64).toString('base64'), ''),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_VIDEO_MIME', httpStatus: 415 });
    });

    it('mimeType fora do conjunto aceito → UNSUPPORTED_VIDEO_MIME (415)', async () => {
        await expect(
            describeVideoAttachment(Buffer.alloc(64).toString('base64'), 'video/avi'),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_VIDEO_MIME', httpStatus: 415 });
    });

    it('buffer vazio após decodificar base64 → UNSUPPORTED_VIDEO_MIME (400)', async () => {
        await expect(
            describeVideoAttachment(' ', 'video/mp4'),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_VIDEO_MIME', httpStatus: 400 });
    });

    it('bytes > maxBytes → VIDEO_TOO_LARGE (413)', async () => {
        // maxBytes default do mock = 1024. Enviamos 2048 bytes.
        const big = Buffer.alloc(2048, 0xff);
        await expect(
            describeVideoAttachment(big.toString('base64'), 'video/mp4'),
        ).rejects.toMatchObject({ code: 'VIDEO_TOO_LARGE', httpStatus: 413 });
    });

    it('bytes > maxBytes → mensagem em PT-BR com MiB e tamanho recebido', async () => {
        try {
            await describeVideoAttachment(
                Buffer.alloc(2048).toString('base64'),
                'video/mp4',
            );
            throw new Error('deveria ter lançado');
        } catch (e: any) {
            expect(e.message).toMatch(/MiB/);
            expect(e.message).toMatch(/limite/i);
            expect(e.message).toMatch(/0\.00 MiB|2\.00 MiB/);
        }
    });

    it('opts.maxBytes override o config (limite por chamada)', async () => {
        // Config diz 1024, mas passamos 2000 → 1500 bytes passa (não estoura).
        mockDescribeVideo.mockResolvedValueOnce('desc');
        const result = await describeVideoAttachment(
            Buffer.alloc(1500).toString('base64'),
            'video/mp4',
            { maxBytes: 2000 },
        );
        expect(result.description).toBe('desc');
        expect(result.maxBytes).toBe(2000);
    });

    it('Erro 413/415 vindo do describeVideo SOBE (não é absorvido como degradação)', async () => {
        mockDescribeVideo.mockRejectedValueOnce(
            new VideoAnalysisError('UNSUPPORTED_VIDEO_MIME', 'mime não suportado', 415),
        );
        await expect(
            describeVideoAttachment(Buffer.alloc(64).toString('base64'), 'video/mp4'),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_VIDEO_MIME', httpStatus: 415 });
    });

    it('Erro não-tipado (programmer error) SOBE (não mascaramos bugs como degradação)', async () => {
        mockDescribeVideo.mockRejectedValueOnce(new Error('boom'));
        await expect(
            describeVideoAttachment(Buffer.alloc(64).toString('base64'), 'video/mp4'),
        ).rejects.toThrow('boom');
    });

    it('descrição vazia retornada pelo provedor → degrada para null (defesa em profundidade)', async () => {
        mockDescribeVideo.mockResolvedValueOnce('');
        const result = await describeVideoAttachment(
            Buffer.alloc(64).toString('base64'),
            'video/mp4',
        );
        expect(result.description).toBeNull();
    });

    it('descrição null retornada pelo provedor → degrada para null (sem crash em .length)', async () => {
        // Mock malformado que retorna null em vez de string — o helper não pode crashar
        // em `${description.length} chars` no log.
        mockDescribeVideo.mockResolvedValueOnce(null);
        const result = await describeVideoAttachment(
            Buffer.alloc(64).toString('base64'),
            'video/mp4',
        );
        expect(result.description).toBeNull();
    });

    it('stripa prefixo data URL antes de decodificar', async () => {
        mockDescribeVideo.mockResolvedValueOnce('desc');
        const originalBytes = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
        const b64 = originalBytes.toString('base64');
        await describeVideoAttachment(`data:video/mp4;base64,${b64}`, 'video/mp4');
        // describeVideo recebeu um input { filePath } apontando para um arquivo salvo no disco.
        expect(mockDescribeVideo).toHaveBeenCalledTimes(1);
        const [inputArg] = mockDescribeVideo.mock.calls[0];
        expect(typeof inputArg.filePath).toBe('string');
        expect(inputArg.filePath).toMatch(/\.mp4$/);
    });

    it('normaliza mime com charset/sufixo (lowercase, sem ;charset=...)', async () => {
        mockDescribeVideo.mockResolvedValueOnce('desc');
        await describeVideoAttachment(
            Buffer.alloc(64).toString('base64'),
            'VIDEO/MP4; charset=utf-8',
        );
        // O mime que chegou ao describeVideo é o normalizado.
        const [, mimeArg] = mockDescribeVideo.mock.calls[0];
        expect(mimeArg).toBe('video/mp4');
    });
});