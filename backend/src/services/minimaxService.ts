// Cliente das APIs de MÍDIA da MiniMax (TTS / imagem / vídeo).
// Usado pelas tools de geração do agente (generate_speech/image/video).
// Decisão de design: todos os endpoints retornam uma URL HOSPEDADA (válida ~24h),
// então as tools devolvem só a URL (string curta) — sem armazenar binário no backend.
import axios from 'axios';
import { config } from '../config/env';
import { logger } from '../utils/logger';

const log = logger.child('MinimaxService');

function base(): string {
    return (config.minimaxBaseUrl || 'https://api.minimax.io/v1/').replace(/\/+$/, '');
}

function authHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${config.minimaxApiKey}` };
}

// Algumas regiões/endpoints da MiniMax exigem ?GroupId=. Anexa só se configurado.
function withGroup(url: string): string {
    return config.minimaxGroupId ? `${url}?GroupId=${encodeURIComponent(config.minimaxGroupId)}` : url;
}

// Erro de negócio da MiniMax vem em base_resp.status_code (0 = sucesso).
function assertOk(data: any, label: string): void {
    const code = data?.base_resp?.status_code;
    if (code !== undefined && code !== 0) {
        throw new Error(`MiniMax ${label} erro ${code}: ${data?.base_resp?.status_msg || 'desconhecido'}`);
    }
}

export const minimaxService = {
    /** TTS — gera áudio do texto e devolve a URL hospedada (mp3, ~24h). */
    async generateSpeech(text: string, opts?: { voiceId?: string; model?: string; speed?: number; format?: string }): Promise<{ url: string }> {
        if (!config.minimaxApiKey) throw new Error('MINIMAX_API_KEY ausente.');
        const clean = (text || '').trim();
        if (!clean) throw new Error('Texto vazio.');

        const body = {
            model: opts?.model || config.minimaxTtsModel,
            text: clean.slice(0, 10000), // limite da API
            stream: false,
            output_format: 'url', // pede URL em vez de hex
            language_boost: 'auto',
            voice_setting: { voice_id: opts?.voiceId || config.minimaxVoiceId, speed: opts?.speed ?? 1.0, vol: 1.0, pitch: 0 },
            audio_setting: { sample_rate: 32000, format: opts?.format || 'mp3', bitrate: 128000, channel: 1 },
        };

        const resp = await axios.post(withGroup(`${base()}/t2a_v2`), body, { headers: authHeaders(), timeout: 120000 });
        assertOk(resp.data, 'TTS');
        // com output_format='url', a URL vem em data.audio
        const url = resp.data?.data?.audio;
        if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
            throw new Error('MiniMax TTS não retornou URL de áudio.');
        }
        log.info('TTS gerado', { chars: clean.length, model: body.model });
        return { url };
    },

    /** Imagem — text-to-image; devolve as URLs hospedadas (~24h). */
    async generateImage(prompt: string, opts?: { aspectRatio?: string; n?: number; model?: string }): Promise<{ urls: string[] }> {
        if (!config.minimaxApiKey) throw new Error('MINIMAX_API_KEY ausente.');
        const clean = (prompt || '').trim();
        if (!clean) throw new Error('Prompt vazio.');

        const n = Math.min(Math.max(opts?.n ?? 1, 1), 9); // API aceita [1, 9]
        const body = {
            model: opts?.model || config.minimaxImageModel,
            prompt: clean,
            aspect_ratio: opts?.aspectRatio || '1:1',
            n,
            response_format: 'url', // pede URL em vez de base64
            prompt_optimizer: true,
        };

        const resp = await axios.post(withGroup(`${base()}/image_generation`), body, { headers: authHeaders(), timeout: 120000 });
        assertOk(resp.data, 'Image');
        const urls = resp.data?.data?.image_urls;
        if (!Array.isArray(urls) || urls.length === 0) {
            throw new Error('MiniMax Image não retornou URLs.');
        }
        log.info('Imagem gerada', { n, model: body.model });
        return { urls };
    },
};
