import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
vi.mock('../../config/env', () => ({
    config: {
        minimaxApiKey: 'mm-key',
        minimaxBaseUrl: 'https://api.minimax.io/v1/',
        minimaxGroupId: '',
        minimaxTtsModel: 'speech-2.6-hd',
        minimaxVoiceId: 'male-qn-qingse',
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
        expect(body.voice_setting.voice_id).toBe('male-qn-qingse');
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
