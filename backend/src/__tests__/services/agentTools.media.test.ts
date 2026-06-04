import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/env', () => ({ config: { deeplinkSecret: 'test-secret-media' } }));
vi.mock('../../services/dolibarrService', () => ({ dolibarrService: {} }));
vi.mock('../../services/scraperService', () => ({ ScraperService: {} }));
vi.mock('../../utils/urlValidation', () => ({ isValidExternalUrl: () => true }));
vi.mock('../../services/minimaxService', () => ({
    minimaxService: {
        generateSpeech: vi.fn().mockResolvedValue({ url: 'https://cdn.minimax.io/audio/x.mp3' }),
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
});
