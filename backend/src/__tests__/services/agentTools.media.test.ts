import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-media' } }));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: {} }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));
vi.mock('../../services/minimaxService', () => ({
    minimaxService: {
        generateSpeech: vi.fn().mockResolvedValue({ url: 'https://cdn.minimax.io/audio/x.mp3' }),
        generateImage: vi.fn().mockResolvedValue({ urls: ['https://cdn.minimax.io/img/1.png'] }),
        submitVideo: vi.fn().mockResolvedValue({ taskId: 'task-abc' }),
        getVideoStatus: vi.fn().mockResolvedValue({ status: 'Processing' }),
    },
}));

import { executeTool } from '../../services/agentTools';
import { minimaxService } from '../../services/minimaxService';

describe('agentTools — tools de mídia (MiniMax)', () => {
    it('generate_speech chama o minimaxService e devolve o link', async () => {
        const out = await executeTool('generate_speech', { text: 'Olá, tudo bem?' });
        expect(minimaxService.generateSpeech).toHaveBeenCalledWith('Olá, tudo bem?', { voiceId: undefined });
        expect(out).toContain('https://cdn.minimax.io/audio/x.mp3');
    });

    it('generate_speech repassa voice_id', async () => {
        await executeTool('generate_speech', { text: 'oi', voice_id: 'Portuguese_Voice' });
        expect(minimaxService.generateSpeech).toHaveBeenLastCalledWith('oi', { voiceId: 'Portuguese_Voice' });
    });

    it('generate_speech exige text', async () => {
        await expect(executeTool('generate_speech', {})).rejects.toThrow();
    });

    it('generate_image chama o minimaxService e devolve o(s) link(s)', async () => {
        const out = await executeTool('generate_image', { prompt: 'um gato astronauta', aspect_ratio: '16:9' });
        expect(minimaxService.generateImage).toHaveBeenCalledWith('um gato astronauta', { aspectRatio: '16:9' });
        expect(out).toContain('https://cdn.minimax.io/img/1.png');
    });

    it('generate_image exige prompt', async () => {
        await expect(executeTool('generate_image', {})).rejects.toThrow();
    });

    it('generate_video submete e devolve o task_id', async () => {
        const out = await executeTool('generate_video', { prompt: 'drone na praia', duration: 6, resolution: '1080P' });
        expect(minimaxService.submitVideo).toHaveBeenCalledWith('drone na praia', { duration: 6, resolution: '1080P' });
        expect(out).toContain('task-abc');
    });

    it('check_video informa processando quando não há url', async () => {
        const out = await executeTool('check_video', { task_id: 'task-abc' });
        expect(minimaxService.getVideoStatus).toHaveBeenCalledWith('task-abc');
        expect(out).toMatch(/processando/i);
    });

    it('check_video devolve o link quando pronto', async () => {
        (minimaxService.getVideoStatus as any).mockResolvedValueOnce({ status: 'Success', url: 'https://cdn.minimax.io/video/9.mp4' });
        const out = await executeTool('check_video', { task_id: 'task-abc' });
        expect(out).toContain('https://cdn.minimax.io/video/9.mp4');
    });

    it('generate_video exige prompt e check_video exige task_id', async () => {
        await expect(executeTool('generate_video', {})).rejects.toThrow();
        await expect(executeTool('check_video', {})).rejects.toThrow();
    });
});
