import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
vi.mock('../../config/env', () => ({
    config: {
        minimaxApiKey: 'mm-key',
        minimaxBaseUrl: 'https://api.minimax.io/v1/',
        minimaxGroupId: '',
        minimaxTtsModel: 'speech-2.6-hd',
        minimaxVoiceId: 'Portuguese_ConfidentWoman',
        minimaxImageModel: 'image-01',
        minimaxVideoModel: 'MiniMax-Hailuo-2.3',
    },
}));

import { minimaxService } from '../../services/minimaxService';

describe('minimaxService.generateSpeech', () => {
    beforeEach(() => vi.clearAllMocks());

    it('retorna a URL do áudio e posta em /t2a_v2 com output_format url', async () => {
        (axios.post as any).mockResolvedValue({
            data: { data: { audio: 'https://cdn.minimax.io/audio/abc.mp3' }, base_resp: { status_code: 0, status_msg: 'success' } },
        });
        const { url } = await minimaxService.generateSpeech('Olá mundo');
        expect(url).toBe('https://cdn.minimax.io/audio/abc.mp3');
        const [calledUrl, body] = (axios.post as any).mock.calls[0];
        expect(calledUrl).toBe('https://api.minimax.io/v1/t2a_v2');
        expect(body.output_format).toBe('url');
        expect(body.model).toBe('speech-2.6-hd');
        expect(body.voice_setting.voice_id).toBe('Portuguese_ConfidentWoman');
    });

    it('respeita voice_id customizado', async () => {
        (axios.post as any).mockResolvedValue({ data: { data: { audio: 'https://x/a.mp3' }, base_resp: { status_code: 0 } } });
        await minimaxService.generateSpeech('oi', { voiceId: 'Portuguese_Voice' });
        expect((axios.post as any).mock.calls[0][1].voice_setting.voice_id).toBe('Portuguese_Voice');
    });

    it('lança erro quando o texto é vazio', async () => {
        await expect(minimaxService.generateSpeech('   ')).rejects.toThrow();
    });

    it('lança erro quando a MiniMax retorna base_resp com erro', async () => {
        (axios.post as any).mockResolvedValue({ data: { base_resp: { status_code: 1004, status_msg: 'auth failed' } } });
        await expect(minimaxService.generateSpeech('oi')).rejects.toThrow(/1004/);
    });

    it('lança erro quando não vem URL válida', async () => {
        (axios.post as any).mockResolvedValue({ data: { data: { audio: 'nao-é-url' }, base_resp: { status_code: 0 } } });
        await expect(minimaxService.generateSpeech('oi')).rejects.toThrow(/URL/);
    });
});

describe('minimaxService.generateImage', () => {
    beforeEach(() => vi.clearAllMocks());

    it('retorna as URLs e posta em /image_generation com response_format url', async () => {
        (axios.post as any).mockResolvedValue({
            data: { data: { image_urls: ['https://cdn.minimax.io/img/1.png'] }, base_resp: { status_code: 0 } },
        });
        const { urls } = await minimaxService.generateImage('um gato astronauta', { aspectRatio: '16:9' });
        expect(urls).toEqual(['https://cdn.minimax.io/img/1.png']);
        const [calledUrl, body] = (axios.post as any).mock.calls[0];
        expect(calledUrl).toBe('https://api.minimax.io/v1/image_generation');
        expect(body.response_format).toBe('url');
        expect(body.aspect_ratio).toBe('16:9');
        expect(body.model).toBe('image-01');
    });

    it('limita n ao intervalo [1,9]', async () => {
        (axios.post as any).mockResolvedValue({ data: { data: { image_urls: ['https://x/1.png'] }, base_resp: { status_code: 0 } } });
        await minimaxService.generateImage('x', { n: 50 });
        expect((axios.post as any).mock.calls[0][1].n).toBe(9);
    });

    it('lança erro com prompt vazio', async () => {
        await expect(minimaxService.generateImage('  ')).rejects.toThrow();
    });

    it('lança erro quando não vêm URLs', async () => {
        (axios.post as any).mockResolvedValue({ data: { data: { image_urls: [] }, base_resp: { status_code: 0 } } });
        await expect(minimaxService.generateImage('x')).rejects.toThrow(/URLs/);
    });
});

describe('minimaxService.submitVideo / getVideoStatus', () => {
    beforeEach(() => vi.clearAllMocks());

    it('submitVideo posta em /video_generation e devolve o task_id', async () => {
        (axios.post as any).mockResolvedValue({ data: { task_id: 'task-123', base_resp: { status_code: 0 } } });
        const { taskId } = await minimaxService.submitVideo('um drone sobre a praia', { duration: 6, resolution: '1080P' });
        expect(taskId).toBe('task-123');
        const [calledUrl, body] = (axios.post as any).mock.calls[0];
        expect(calledUrl).toBe('https://api.minimax.io/v1/video_generation');
        expect(body.model).toBe('MiniMax-Hailuo-2.3');
        expect(body.duration).toBe(6);
        expect(body.resolution).toBe('1080P');
    });

    it('submitVideo lança erro com prompt vazio', async () => {
        await expect(minimaxService.submitVideo('  ')).rejects.toThrow();
    });

    it('getVideoStatus devolve só o status enquanto processa', async () => {
        (axios.get as any).mockResolvedValue({ data: { status: 'Processing', base_resp: { status_code: 0 } } });
        const r = await minimaxService.getVideoStatus('task-123');
        expect(r.status).toBe('Processing');
        expect(r.url).toBeUndefined();
    });

    it('getVideoStatus recupera o download_url quando Success', async () => {
        (axios.get as any)
            .mockResolvedValueOnce({ data: { status: 'Success', file_id: 'file-9', base_resp: { status_code: 0 } } })
            .mockResolvedValueOnce({ data: { file: { download_url: 'https://cdn.minimax.io/video/9.mp4' }, base_resp: { status_code: 0 } } });
        const r = await minimaxService.getVideoStatus('task-123');
        expect(r.status).toBe('Success');
        expect(r.url).toBe('https://cdn.minimax.io/video/9.mp4');
        // 1ª chamada = query/video_generation; 2ª = files/retrieve
        expect((axios.get as any).mock.calls[0][0]).toContain('/query/video_generation?task_id=task-123');
        expect((axios.get as any).mock.calls[1][0]).toContain('/files/retrieve?file_id=file-9');
    });

    it('getVideoStatus exige task_id', async () => {
        await expect(minimaxService.getVideoStatus('')).rejects.toThrow();
    });
});
