import fs from 'fs';
import path from 'path';
import { atomicWriteSync } from '../utils/atomicWrite';
import { logger } from '../utils/logger';

const log = logger.child('VoiceConfig');

const DATA_DIR = path.join(__dirname, '../../data');
const STORE_FILE = path.join(DATA_DIR, 'voice_config.json');

/**
 * Config org-wide da VOZ do agente (TTS MiniMax) — selecionável pelo admin na UI
 * (tela de Automações). Usada como default pelo endpoint /voice/tts e pela tool
 * generate_speech do agente. 73 vozes Portuguese_* disponíveis via get_voice.
 */
export interface VoiceConfig {
    /** voice_id da MiniMax (ex.: 'Portuguese_ConfidentWoman'). */
    voiceId: string;
    /** Velocidade da fala (0.5–2.0). */
    speed: number;
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
    voiceId: 'Portuguese_ConfidentWoman',
    speed: 1.0,
};

class VoiceConfigStore {
    private data: VoiceConfig;

    constructor() {
        this.data = { ...DEFAULT_VOICE_CONFIG };
        this.load();
    }

    private load(): void {
        try {
            if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
            if (fs.existsSync(STORE_FILE)) {
                const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
                this.data = { ...DEFAULT_VOICE_CONFIG, ...parsed };
            }
        } catch (e) {
            log.error('Load error', e);
        }
    }

    get(): VoiceConfig {
        return { ...this.data };
    }

    update(patch: Partial<VoiceConfig>): VoiceConfig {
        if (typeof patch.voiceId === 'string' && patch.voiceId.trim()) this.data.voiceId = patch.voiceId.trim();
        if (typeof patch.speed === 'number' && patch.speed >= 0.5 && patch.speed <= 2.0) this.data.speed = patch.speed;
        try { atomicWriteSync(STORE_FILE, this.data); } catch (e) { log.error('Save error', e); }
        return this.get();
    }
}

export const voiceConfigStore = new VoiceConfigStore();
